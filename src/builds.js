// Character building (stats.md "Building a fighter", techniques.md "Building a technique set").
// A build starts from a template fighter, then spends points on stat steps, extra Path
// techniques and technique refinements. Saved builds live in the browser and can fight.
import { FIGHTERS, TRAITS, STAT_STEP, statsFrom } from './data.js';
import { getPath } from './paths.js';

export const BUDGET = 6;

export { STAT_STEP };
export const STAT_FLOOR = 3;            // steps down per stat (raising has no limit)
export const REFINE_UP_LIMIT = 3;       // steps up per technique
export const REFINE_DOWN_LIMIT = 2;     // steps down per technique

export const REFINEMENTS = {
  accuracy: { label: 'Accuracy', up: '+1 to hit', down: '−1 to hit' },
  power: { label: 'Power', up: '+0.1 efficiency', down: '−0.1 efficiency' },
  quickness: { label: 'Quickness', up: '−10% wind-up', down: '+10% wind-up' },
  reach: { label: 'Reach', up: 'best range one band further', down: 'best range one band shorter' },
  economy: { label: 'Economy', up: '−20% madra cost and upkeep', down: '+20% madra cost and upkeep' },
  size: { label: 'Size', up: '+25% HP', down: '−25% HP' },
};

// Which refinements make sense for each kind of technique.
const REFINE_BY_KIND = {
  attack: ['accuracy', 'power', 'quickness', 'reach'],
  stance: ['quickness', 'economy'],
  forge: ['accuracy', 'quickness', 'size'],
  construct: ['quickness', 'size'],
  pulse: ['quickness'],
  disrupt: ['accuracy', 'quickness', 'reach'],
  launch: ['economy'],
  command: [],
};

export const refinementsFor = (t) => REFINE_BY_KIND[t.kind] || [];
export const isCore = (t) => !t.cost;
const round1 = (x) => Math.round(x * 10) / 10;

export function newBuild(templateId) {
  const tpl = FIGHTERS.find((f) => f.id === templateId) || FIGHTERS[0];
  const path = getPath(tpl.path);
  return {
    id: `build-${Math.random().toString(36).slice(2, 8)}`,
    name: `${tpl.name} (custom)`,
    base: tpl.id,
    path: tpl.path,
    theme: tpl.theme,
    traits: [...tpl.traits],
    weapon: tpl.weapon ? { ...tpl.weapon } : null,
    steps: Object.fromEntries(Object.keys(STAT_STEP).map((k) => [k, (tpl.steps && tpl.steps[k]) || 0])),
    learned: path.techniques.filter((t) => !isCore(t)).map((t) => t.id),
    refine: {},
  };
}

// ---------- costs ----------
export function statCost(build, stat) {
  const n = build.steps[stat] || 0;
  if (n <= 0) return n; // each step down pays back 1
  const free = getPath(build.path).signatureStat === stat ? 1 : 0;
  return n - free; // every step up costs 1
}

export function refineSteps(build, techId) {
  const r = build.refine[techId] || {};
  const vals = Object.values(r);
  return { up: vals.filter((v) => v > 0).reduce((a, b) => a + b, 0), down: -vals.filter((v) => v < 0).reduce((a, b) => a + b, 0) };
}

export function refineCost(build, techId) {
  const { up, down } = refineSteps(build, techId);
  return up - down;
}

export const weaponCost = (w) => Math.ceil(((w && w.damage) || 0) / 2);
export const traitCost = (id) => (TRAITS[id] && TRAITS[id].cost) || 0;

export function costs(build) {
  const stats = Object.keys(STAT_STEP).reduce((sum, k) => sum + statCost(build, k), 0);
  const techs = getPath(build.path).techniques.filter((t) => build.learned.includes(t.id)).reduce((sum, t) => sum + (t.cost || 0), 0);
  const refine = known(build).reduce((sum, t) => sum + refineCost(build, t.id), 0);
  const gear = build.traits.reduce((sum, id) => sum + traitCost(id), 0) + weaponCost(build.weapon);
  const total = stats + techs + refine + gear;
  return { stats, techs, refine, gear, total, budget: BUDGET, left: BUDGET - total };
}

// ---------- the fighter a build makes ----------
// The techniques a build knows: its Path's core ones plus the ones it paid for.
export function known(build) {
  return getPath(build.path).techniques.filter((t) => isCore(t) || build.learned.includes(t.id));
}

export function refineTechnique(t, r = {}) {
  const out = { ...t };
  const notes = [];
  for (const [key, n] of Object.entries(r)) {
    if (!n) continue;
    notes.push(`${REFINEMENTS[key].label} ${n > 0 ? '+' : ''}${n}`);
    if (key === 'accuracy') out.toHit = (t.toHit || 0) + n;
    if (key === 'power') out.effBonus = (t.effBonus || 0) + 0.1 * n;
    if (key === 'quickness') out.windupMult = round1((t.windupMult || 1) * (1 - 0.1 * n));
    if (key === 'size') out.sizeMult = (t.sizeMult || 1) * (1 + 0.25 * n);
    if (key === 'economy') {
      const k = 1 - 0.2 * n;
      if (t.raiseCost) out.raiseCost = round1(t.raiseCost * k);
      if (t.upkeep) out.upkeep = round1(t.upkeep * k);
      if (t.fixedCost) out.fixedCost = round1(t.fixedCost * k);
    }
    if (key === 'reach' && t.ranges) {
      const best = Math.min(2, Math.max(0, (t.bestRange ?? t.ranges[0]) + n));
      out.bestRange = best;
      const ranges = new Set(t.ranges);
      for (let b = 0; b <= best; b++) if (b >= Math.min(...t.ranges)) ranges.add(b);
      out.ranges = [...ranges].sort();
    }
  }
  if (notes.length) out.desc = `${t.desc} (Refined: ${notes.join(', ')}.)`;
  return out;
}

export function toFighter(build) {
  const stats = statsFrom(build.steps);
  return {
    id: build.id,
    name: build.name,
    path: build.path,
    stage: 'Lowgold',
    theme: build.theme,
    stats,
    traits: [...build.traits],
    weapon: build.weapon && build.weapon.name !== 'unarmed' ? build.weapon : null,
    techniques: known(build).map((t) => refineTechnique(t, build.refine[t.id])),
    pathDef: getPath(build.path).custom ? getPath(build.path) : undefined,
    isBuild: true,
  };
}

// ---------- saved builds ----------
const KEY = 'builds';
export function loadBuilds() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((b) => b && getPath(b.path)) : [];
  } catch { return []; }
}
export function saveBuilds(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

// Everyone who can be picked to fight: the canon fighters plus saved builds.
export function allFighters() {
  return [...FIGHTERS, ...loadBuilds().map(toFighter)];
}
