// Regression harness for the fight engine. Plays many seeded random fights and records
// everything the UI reads at each decision point: the prompt, every turn option with its
// preview and projection, every reaction with its outcome and projection, the queue, and the
// state and log after each action. Each fight's record is hashed; the hashes are compared
// with tests/baseline.json.
//
//   node tests/regress.mjs            compare with the baseline (exit 1 on any difference)
//   node tests/regress.mjs --update   write a new baseline (after an intended rule change)
//   node tests/regress.mjs --dump DIR also write each fight's full record to DIR/<name>.json,
//                                     to diff two runs and find where they part ways
//   node tests/regress.mjs --only lindon-yerin-3   run one fight
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Game } = await import('../src/engine.js');
const { FIGHTERS, PATHS, statsFrom } = await import('../src/data.js');
const { compilePath, defaultKnobs } = await import('../src/paths.js');
const { refineTechnique } = await import('../src/builds.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SEEDS = Number(opt('--seeds') || 6);
const MAX_DECISIONS = 140;

// ---------- seeded randomness ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- extra fighters: a custom Path that uses every template, incl. aimed areas ----------
const entry = (uid, template, name, knobs = {}, cost = 0) => ({ uid, template, name, cost, flavor: '', knobs: { ...defaultKnobs(template), ...knobs } });
const customPath = compilePath({
  id: 'path-test', name: 'Path of Tests', summary: '', element: '', madraName: 'Test madra', color: '#7fd1c7',
  signatureStat: 'control', efficiencyMult: 1.1, sharpness: 1, pureMadra: false, selfBurn: false,
  techniques: [
    entry('s', 'striker', 'Test Bolt', { dtype: 'spiritual', toHit: 1 }),
    entry('set', 'area', 'Test Mortar', { aim: 'set', minRange: 0, maxRange: 2, radius: 2, radiusPerMadra: 0.3 }),
    entry('rel', 'ruler', 'Test Storm', { aim: 'release', minRange: 0, maxRange: 2, radius: 3 }),
    entry('emp', 'empowered', 'Test Fist', { toHit: 1 }),
    entry('st', 'stance', 'Test Mantle', { redirect: true, dr: 2, buildUp: true, speedMult: 1.1 }),
    entry('bar', 'barrier', 'Test Wall', { sizeMult: 1.25 }),
    entry('cr', 'crown', 'Test Crown', { toHit: 1 }),
    entry('dis', 'disrupt', 'Test Seal', { fixedCost: 6 }),
    entry('la', 'launch', 'Test Leap', {}),
    entry('pu', 'pulse', 'Test Pulse', { divisor: 5 }),
  ],
});
const customPure = compilePath({
  id: 'path-pure', name: 'Path of Pure Tests', summary: '', element: '', madraName: 'Pure test', color: '#ffffff',
  signatureStat: 'pool', efficiencyMult: 1, sharpness: 0, pureMadra: true, selfBurn: true,
  techniques: [
    entry('a', 'area', 'Pure Burst', { aim: 'release', minRange: 0, maxRange: 1, bladeHits: true }),
    entry('b', 'striker', 'Pure Lance', {}),
    entry('c', 'stance', 'Pure Guard', { halvesTechniques: true, stanceBreakMult: 1.5 }),
  ],
});
// A refined build of a canon fighter (Quickness, Economy, Size, Accuracy, Reach, Power).
const refinedEithan = (() => {
  const e = FIGHTERS.find((f) => f.id === 'eithan');
  const refine = { hollowSpear: { quickness: 1, power: 1, reach: -1 }, hollowArmor: { economy: 1 }, crown: { size: 1, accuracy: 1 }, madraPulse: { quickness: -1 } };
  return { ...e, id: 'eithan-refined', name: 'Eithan (refined)', techniques: PATHS.hollowKing.techniques.map((t) => refineTechnique(t, refine[t.id])), isBuild: true };
})();
const custom = (id, name, pathDef, steps, extra = {}) => ({
  id, name, path: pathDef.id, pathDef, stage: 'Lowgold', theme: pathDef.theme, stats: statsFrom(steps),
  traits: [], weapon: null, techniques: pathDef.techniques, isBuild: true, ...extra,
});
const TESTER = custom('tester', 'Tester', customPath, { control: 2, cap: 2, speed: 1 }, { weapon: { name: 'sword', blade: true, damage: 0 }, traits: ['swordArms'] });
const PURIST = custom('purist', 'Purist', customPure, { pool: 2, perception: 2 }, { weapon: { name: 'hammer', blade: false, damage: 4 } });

const ROSTER = [...FIGHTERS, TESTER, PURIST, refinedEithan];

// ---------- recording ----------
// Recorded values are canonical, so only differences a caller could notice count: numbers are
// rounded to 1e-9 (floating-point reordering), object keys are sorted, and fields that are null
// or missing are treated alike.
function canon(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e9) / 1e9;
  if (Array.isArray(v)) return v.map((x) => (x == null ? null : canon(x)));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] != null && typeof v[k] !== 'function') out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const snap = (x) => canon(JSON.parse(JSON.stringify(x ?? null)));

function pointsFor(game, f, o, rnd) {
  const out = [];
  if (o.point.area) out.push('them');
  else out.push('toward', 'away');
  const opp = game.pos(game.opponent(f));
  out.push(`${Math.round(rnd() * 400) / 10}:${Math.round(rnd() * 240) / 10}`);
  out.push(`${Math.round((opp.x + (rnd() * 6 - 3)) * 10) / 10}:${Math.round((opp.y + (rnd() * 6 - 3)) * 10) / 10}`);
  return out;
}

function variants(game, f, o, rnd) {
  const amounts = o.slider ? [...new Set([o.slider.min, o.slider.max, o.slider.initial,
    o.slider.min + Math.round(rnd() * (o.slider.max - o.slider.min) / o.slider.step) * o.slider.step])] : [0];
  const targets = o.point ? pointsFor(game, f, o, rnd) : o.targets ? o.targets.map((t) => t.id) : [''];
  const out = [];
  for (const a of amounts) for (const t of targets) out.push([a, t]);
  return out;
}

function playFight(defs, seed) {
  const rnd = mulberry32(seed * 7919 + 13);
  const game = new Game(defs, mulberry32(seed));
  const rec = [];
  const step = (kind, data) => rec.push([kind, snap(data)]);
  step('start', { state: game.serialize(), upcoming: game.upcoming() });
  for (let d = 0; d < MAX_DECISIONS && !game.result; d++) {
    const p = game.prompt;
    step('prompt', p);
    if (p.kind === 'turn') {
      const f = game.current();
      const opts = game.turnOptions(f);
      step('options', opts);
      const choices = [];
      for (const o of opts) {
        for (const [a, t] of variants(game, f, o, rnd)) {
          const pv = game.preview(f, o.key, a, t);
          const pj = game.project(f, o.key, a, t);
          step('preview', { key: o.key, a, t, pv, pj });
          if (pv.enabled) choices.push([o.key, a, t]);
        }
      }
      // Prefer real actions; drops and waits only sometimes, so fights move.
      const weighted = choices.filter(([k]) => !(k.startsWith('drop:') || k === 'wait') || rnd() < 0.15);
      const pool = weighted.length ? weighted : choices;
      const [k, a, t] = pool[Math.floor(rnd() * pool.length)];
      if (rnd() < 0.02) game.setDrawOffer(f.index, !game.drawOffers[f.index]);
      game.act(k, a, t);
      step('act', { k, a, t });
    } else if (p.kind === 'reaction') {
      const ro = game.reactionOptions();
      step('reaction', ro);
      const max = ro.block.maxBase;
      const blocks = [...new Set([0, Math.min(1, max), max, Math.round(rnd() * max)])];
      const legal = [];
      for (const c of ['take', 'dodge', 'block', 'dodgeBlock', 'redirect']) {
        for (const b of blocks) {
          step('outcome', { c, b, out: game.reactionOutcome(c, b), pj: game.projectReaction(c, b) });
        }
        const pulse = p.attack.profile.effect === 'pulse';
        const ok = c === 'take' || (c === 'redirect' ? ro.redirect.available
          : (ro.construct || pulse) ? c === 'block' : c !== 'redirect');
        if (ok) legal.push(c);
      }
      const c = legal[Math.floor(rnd() * legal.length)];
      const b = blocks[Math.floor(rnd() * blocks.length)];
      game.react(c, b);
      step('react', { c, b });
    } else if (p.kind === 'opportunity') {
      step('opportunity', game.opportunityOptions());
      const c = rnd() < 0.6 ? 'strike' : 'let';
      game.opportunity(c);
      step('opp', { c });
    } else break;
    step('after', { state: game.serialize(), upcoming: game.upcoming(), history: game.history });
    // Describe every wind-up, as the fighter panels do.
    step('windups', game.fighters.map((f) => f.windups.map((w) => ({ d: game.describeWindup(w), p: game.windupProfile(w) }))));
  }
  // A save/restore round trip must reproduce the same state and options.
  const restored = Game.restore(JSON.parse(JSON.stringify(game.serialize())), defs, mulberry32(seed + 1));
  step('restored', { state: restored.serialize(), upcoming: restored.upcoming() });
  if (restored.prompt && restored.prompt.kind === 'turn') step('restoredOptions', restored.turnOptions(restored.current()));
  step('end', { result: game.result, log: game.log, time: game.time });
  return rec;
}

// ---------- run ----------
const fights = [];
for (const a of ROSTER) for (const b of ROSTER) {
  if (a.id === b.id) continue;
  const canon = FIGHTERS.includes(a) && FIGHTERS.includes(b);
  const seeds = canon ? SEEDS : Math.max(1, Math.ceil(SEEDS / 3));
  for (let s = 1; s <= seeds; s++) fights.push({ name: `${a.id}-${b.id}-${s}`, defs: [a, b], seed: s });
}

const only = opt('--only');
const dump = opt('--dump');
if (dump) mkdirSync(dump, { recursive: true });
const hashes = {};
let decisions = 0;
for (const fight of fights) {
  if (only && fight.name !== only) continue;
  let rec;
  try {
    rec = playFight(fight.defs, fight.seed);
  } catch (err) {
    rec = [['error', String(err && err.stack || err)]];
  }
  if (rec[0][0] === 'error') console.log(`${fight.name}: ${rec[0][1]}`);
  decisions += rec.filter(([k]) => k === 'prompt').length;
  const text = JSON.stringify(rec);
  hashes[fight.name] = createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (dump) writeFileSync(join(dump, `${fight.name}.json`), rec.map((r) => JSON.stringify(r)).join('\n'));
}

const basePath = join(here, 'baseline.json');
if (flag('--update')) {
  writeFileSync(basePath, `${JSON.stringify(hashes, null, 1)}\n`);
  console.log(`Baseline written: ${Object.keys(hashes).length} fights, ${decisions} decisions.`);
  process.exit(0);
}
if (!existsSync(basePath)) {
  console.log('No baseline yet: run with --update first.');
  process.exit(1);
}
const base = JSON.parse(readFileSync(basePath, 'utf8'));
const bad = Object.keys(hashes).filter((k) => base[k] !== hashes[k]);
const errors = Object.keys(hashes).length;
if (bad.length) {
  console.log(`${bad.length} of ${errors} fights differ from the baseline: ${bad.slice(0, 12).join(', ')}${bad.length > 12 ? ', …' : ''}`);
  console.log('Use --dump DIR on both versions and diff the files to see where.');
  process.exit(1);
}
console.log(`All ${errors} fights match the baseline (${decisions} decisions).`);
