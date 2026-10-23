// Fight engine: one shared initiative queue, wind-ups, reactions, upkeep, interrupts,
// Forged constructs, and three damage types (physical, technique, spiritual).
import * as R from './rules.js';
import { PATHS } from './data.js';

const EPS = 1e-9;
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const pct = (p) => `${Math.round(p * 100)}%`;
const clampWait = (t) => Math.min(R.TIMING.waitMax, Math.max(R.TIMING.waitMin, Number(t) || R.TIMING.waitDefault));

// Constructs don't dodge; rolled attacks against them need to beat this.
const CONSTRUCT_DEFENSE = 10;
// Crown stars: 2 spiritual damage per madra before reduction, +1 to hit. Forging one gives you
// your next turn after 1 tick; dropping stars takes 0.5 ticks and they land 0.5 ticks later.
const STAR = { damagePerMadra: 2, toHit: 1, forgeRecovery: 1, dropTime: 0.5 };

export class Game {
  constructor(defs, rng = Math.random) {
    this.rng = rng;
    this.time = 0;
    this.distance = 1;
    this.events = [];
    this.log = [];
    this.nextId = 1;
    this.prompt = null;
    this.result = null;
    this.decision = 0; // counts every new decision point, so outside moves can't be applied twice
    this.drawOffers = [false, false]; // the fight ends in a draw when both fighters are offering one
    this.fighters = defs.map((d, i) => ({
      ...d,
      stats: { ...d.stats },
      index: i,
      health: d.stats.health,
      spirit: d.stats.spirit,
      madra: d.stats.pool,
      nextTurn: i * 0.01, // first fighter listed acts first on a tie
      stances: {},        // id -> { raisedAt }
      lockedUntil: {},    // id -> time a dropped stance can be raised again
      windups: [],        // own wind-ups in progress; a hit over the threshold breaks them all
      moving: null,       // move in progress: { end, dir }
      constructs: [],     // Forged constructs: { id, kind, name, hp, maxHp, madra?, range? }
      seen: [],           // technique ids this fighter has used, so the opponent can look them up
    }));
    this.addLog(`The fight begins at ${R.RANGES[this.distance]} range.`, 'system');
    this.advance();
  }

  // ---------- save and restore ----------
  // Everything but the dice is plain data, so a fight survives a page reload.
  serialize() {
    const { rng, ...state } = this;
    return JSON.parse(JSON.stringify(state));
  }

  // Rebuild a saved fight with the current code. Each fighter's fixed details (stats, Path,
  // traits, weapon) come from the current data, so rule and number changes apply from here on;
  // health, madra, stances, wind-ups and the queue carry over.
  static restore(state, defs, rng = Math.random) {
    const g = Object.create(Game.prototype);
    Object.assign(g, state, { rng });
    g.fighters = state.fighters.map((f) => {
      const def = defs.find((d) => d.id === f.id);
      const out = def ? { ...f, ...def, stats: { ...def.stats } } : f;
      out.health = Math.min(out.health, out.stats.health);
      out.spirit = Math.min(out.spirit, out.stats.spirit);
      out.madra = Math.min(out.madra, out.stats.pool);
      return out;
    });
    // Fights saved before techniques were tracked: rebuild the list from the fighter's log lines.
    for (const f of g.fighters) {
      if (f.seen) continue;
      const lines = g.log.filter((l) => l.who === f.index).map((l) => l.text);
      f.seen = g.techList(f).filter((t) => lines.some((x) => x.includes(t.name)
        || (t.kind === 'forge' && x.includes('Forging')) || (t.kind === 'command' && x.includes('from the Crown')))).map((t) => t.id);
    }
    // Drop stances whose technique no longer exists.
    for (const f of g.fighters) {
      for (const id of Object.keys(f.stances)) if (!g.tech(f, id)) delete f.stances[id];
    }
    return g;
  }

  // ---------- lookups ----------
  opponent(f) { return this.fighters[1 - f.index]; }
  // A fighter on a custom Path carries its definition; otherwise look it up.
  path(f) { return f.pathDef || PATHS[f.path]; }
  // A built fighter carries its own (refined) technique list; otherwise the Path's full list.
  techList(f) { return f.techniques || this.path(f).techniques; }
  tech(f, id) { return this.techList(f).find((t) => t.id === id.split(':')[0]); }

  // Technique wind-up, including a build's Quickness refinement.
  twind(t, nominal, control) { return R.techWindup(nominal, control) * ((t && t.windupMult) || 1); }

  // The fighter's Crown technique (for star accuracy and size), if they have one.
  crownTech(f) { return this.techList(f).find((t) => t.kind === 'forge'); }
  current() { return this.prompt ? this.fighters[this.prompt.fighter] : null; }
  hasTrait(f, t) { return f.traits.includes(t); }
  weaponDamage(f) { return f.weapon ? f.weapon.damage || 0 : 0; }

  activeStances(f) {
    return Object.keys(f.stances).map((id) => this.tech(f, id));
  }

  stanceFlag(f, flag) {
    return this.activeStances(f).some((d) => d[flag]);
  }

  buildUp(f, def) {
    const st = f.stances[def.id];
    if (!def.buildUp || !st) return 0;
    return Math.floor((this.time - st.raisedAt) / def.buildUp.every + EPS);
  }

  // When a building stance gains its next build-up.
  nextBuildUp(f, def) {
    const st = f.stances[def.id];
    if (!def.buildUp || !st) return null;
    return st.raisedAt + (this.buildUp(f, def) + 1) * def.buildUp.every;
  }

  speed(f) {
    let s = f.stats.speed;
    for (const def of this.activeStances(f)) {
      if (def.speedMult) s *= def.speedMult;
      if (def.buildUp) s *= 1 + def.buildUp.speed * this.buildUp(f, def);
    }
    return s;
  }

  physBonus(f) {
    return this.activeStances(f).reduce((sum, d) => sum + (d.physBonus || 0), 0);
  }

  stanceDR(f) {
    return this.activeStances(f).reduce((sum, d) => sum + (d.dr || 0), 0);
  }

  stanceSharpness(f) {
    return this.activeStances(f).reduce(
      (sum, d) => sum + (d.buildUp ? d.buildUp.sharpness * this.buildUp(f, d) : 0), 0);
  }

  upkeepRate(f, def) {
    const base = def.upkeep + (def.buildUp ? def.buildUp.upkeep * this.buildUp(f, def) : 0);
    return base * R.controlFactor(f.stats.control);
  }

  threshold(f) { return R.interruptThreshold(f.stats); }
  stanceThreshold(f) {
    const mult = this.activeStances(f).reduce((m, d) => m * (d.stanceBreakMult || 1), 1);
    return this.threshold(f) * R.STANCE_BREAK_MULT * mult;
  }

  barrier(f) { return f.constructs.find((c) => c.kind === 'barrier'); }
  stars(f) { return f.constructs.filter((c) => c.kind === 'star'); }

  // Where a construct is, for range checks. The Crown hangs high overhead at Far range;
  // barriers sit on their owner, at the fighters' current distance.
  constructRange(c) { return c.range ?? this.distance; }

  // The range at time t, counting moves already underway (a move takes effect when it ends).
  distanceAt(t) {
    let d = this.distance;
    const moves = this.fighters.map((x) => x.moving).filter((m) => m && m.end <= t + EPS).sort((a, b) => a.end - b.end);
    for (const m of moves) d = Math.min(2, Math.max(0, d + m.dir));
    return d;
  }

  // Range check for an attack: what counts is the range when it lands. An attack that won't
  // reach can still be chosen; it just gets a warning.
  rangeGate(ranges, landAt, shortReason) {
    const later = this.distanceAt(landAt);
    const ok = ranges.includes(later);
    const changes = later !== this.distance;
    return {
      warning: ok ? null : `${changes ? `Out of range when it lands (${R.RANGES[later]} by then)` : shortReason}: wasted unless the range changes`,
      note: changes && ok ? `Range will be ${R.RANGES[later]} when it lands (t=${fmt(landAt)})` : null,
    };
  }

  constructGate(ranges, c, shortReason) {
    return { warning: ranges.includes(this.constructRange(c)) ? null : `${shortReason}: can't reach ${c.name}`, note: null };
  }

  // ---------- log ----------
  addLog(text, cls = '', who = null) {
    this.log.push({ time: this.time, text, cls, who });
  }

  // ---------- madra ----------
  spend(f, amount, burn) {
    f.madra = Math.max(0, f.madra - amount);
    if (burn) {
      f.health -= amount / 5;
      f.spirit -= amount / 10;
      // Fire and destruction in the area feed a boostable wind-up (Void Dragon's Dance).
      for (const w of f.windups) if (w.boostPerMadra) w.boost += amount * w.boostPerMadra;
    }
  }

  // Most actions are limited by channel cap; Ruler techniques draw on aura over their long
  // build-up and are limited only by the madra you have.
  maxMadra(f, t = null) {
    const limit = t && t.ruler ? f.madra : Math.min(f.stats.cap, f.madra);
    return Math.max(0, Math.floor(limit));
  }

  // ---------- attacks ----------
  attackProfile(f, key, madra) {
    if (key === 'strike') {
      return {
        name: this.hasTrait(f, 'swordArms') ? 'Strike (sword arms: twice)' : 'Strike',
        damage: R.STRIKE_DAMAGE + this.weaponDamage(f) + this.physBonus(f),
        dtype: 'physical',
        toHit: 0,
        sharpness: this.stanceSharpness(f),
        ranges: [0],
        bestRange: 0,
        area: false,
        hits: this.hasTrait(f, 'swordArms') ? 2 : 1,
        madra: 0,
      };
    }
    const t = this.tech(f, key);
    const p = this.path(f);
    const nominal = R.nominalWindup(madra, t.divisor);
    let damage = madra * (R.efficiency(madra, nominal) + (t.effBonus || 0)) * p.efficiencyMult * (t.effMult || 1) * (t.area ? R.AREA_EFFICIENCY : 1);
    if (t.base) damage += t.base + (t.physical ? this.physBonus(f) : 0) + (t.weaponBonus ? this.weaponDamage(f) : 0);
    return {
      name: t.name,
      damage,
      dtype: t.dtype || 'technique',
      toHit: t.toHit || 0,
      sharpness: p.sharpness + this.stanceSharpness(f),
      ranges: t.ranges,
      bestRange: t.bestRange ?? t.ranges[0],
      area: !!t.area,
      pure: !!p.pureMadra && !t.physical && t.dtype !== 'physical',
      hits: 1,
      bladeHits: !!t.bladeHits,
      madra,
    };
  }

  // Stars dropped together land as one attack with one hit per star (biggest first).
  starsProfile(owner, madras) {
    const first = this.starProfile(owner, madras[0]);
    if (madras.length === 1) return first;
    return {
      ...first,
      name: `Crown stars (${madras.join(', ')})`,
      hits: madras.length,
      hitDamages: madras.map((m) => m * STAR.damagePerMadra),
      madra: madras.reduce((s, m) => s + m, 0),
    };
  }

  // The profile of each hit of an attack: the same profile repeated, unless hits differ (dropped stars).
  hitProfiles(prof, hits) {
    return Array.from({ length: hits }, (_, i) =>
      prof.hitDamages ? { ...prof, damage: prof.hitDamages[i] ?? prof.hitDamages[prof.hitDamages.length - 1] } : prof);
  }

  starProfile(owner, madra) {
    return {
      name: `Crown star (${madra})`,
      damage: madra * STAR.damagePerMadra,
      dtype: 'spiritual',
      toHit: STAR.toHit + ((this.crownTech(owner) || {}).toHit || 0),
      sharpness: 0,
      ranges: [0, 1, 2],
      bestRange: 2,
      area: false,
      hits: 1,
      madra,
      fromConstruct: true,
      ownerName: owner.name,
      pure: !!this.path(owner).pureMadra,
    };
  }

  hitsAgainst(attacker, defender, profile) {
    if (!profile.bladeHits) return profile.hits;
    let hits = 1;
    if (this.hasTrait(attacker, 'swordArms') && this.distance === 0) hits += 1;
    if (defender.weapon && defender.weapon.blade) hits += 1;
    return hits;
  }

  // A dodge helps less against each extra hit of an attack: full bonus on the first hit,
  // 1 less on each hit after it, down to 0.
  dodgeBonusFor(defender, attacker, hitIndex = 0) {
    return Math.max(0, R.dodgeBonus(this.speed(defender), this.speed(attacker)) - hitIndex);
  }

  defense(attacker, defender, dodging, hitIndex = 0) {
    const sm = R.speedMod(this.speed(defender), this.speed(attacker));
    let d = 6 + defender.stats.perception + sm;
    if (dodging) d += this.dodgeBonusFor(defender, attacker, hitIndex);
    return d;
  }

  rangePenalty(prof) {
    return prof.area ? 0 : R.rangePenalty(this.distance, prof.bestRange);
  }

  // Area attacks don't roll, so they always hit.
  hitChance(attacker, defender, prof, dodging = false, hitIndex = 0) {
    if (prof.area) return 1;
    const need = this.defense(attacker, defender, dodging, hitIndex) - attacker.stats.precision - prof.toHit + this.rangePenalty(prof);
    return R.chanceAtLeast(need);
  }

  constructHitChance(attacker, prof, c) {
    if (prof.area) return 1;
    const pen = R.rangePenalty(this.constructRange(c), prof.bestRange);
    return R.chanceAtLeast(CONSTRUCT_DEFENSE - attacker.stats.precision - prof.toHit + pen);
  }

  hitText(attacker, defender, prof) {
    if (prof.area) return 'area attack, no roll';
    const pen = this.rangePenalty(prof);
    return `${pct(this.hitChance(attacker, defender, prof))} to hit${pen ? ` (−${pen} range)` : ''}`;
  }

  // What one hit does to a fighter. Pure: doesn't change anything.
  //   Hollow Armor halves technique and spiritual damage; a barrier soaks physical, technique and
  //   pure-madra damage first (other spiritual hits pass through), losing double HP to pure madra;
  //   then damage reduction: Spirit/10
  //   for spiritual hits, otherwise Toughness (less sharpness) plus stance reduction, plus any block.
  //   Spiritual damage goes to the spirit track and counts double against thresholds.
  hitResult(att, def, prof, { dodging = false, blockDR = 0, barrierHp = null, hitIndex = 0 } = {}) {
    let raw = prof.damage;
    if (prof.area && dodging) raw *= 1 - R.areaDodgeReduction(this.dodgeBonusFor(def, att, hitIndex));
    if (prof.dtype !== 'physical' && this.stanceFlag(def, 'halvesTechniques')) raw *= 0.5;
    let absorbed = 0;
    let barrierLoss = 0;
    const barrier = this.barrier(def);
    const bhp = barrierHp ?? (barrier ? barrier.hp : 0);
    if (bhp > 0 && (prof.dtype !== 'spiritual' || prof.pure)) {
      const rate = prof.pure ? 2 : 1;
      absorbed = Math.min(bhp / rate, raw);
      barrierLoss = absorbed * rate;
      raw -= absorbed;
    }
    const spiritual = prof.dtype === 'spiritual';
    const block = blockDR;
    const dr = spiritual
      ? def.stats.spirit / 10 + block
      : Math.max(0, def.stats.toughness - prof.sharpness) + this.stanceDR(def) + block;
    const dmg = Math.max(0, Math.round(raw - dr));
    const pressure = spiritual ? dmg * 2 : dmg;
    const stanceLimit = this.stanceThreshold(def);
    return {
      dmg,
      absorbed,
      barrierLoss,
      track: spiritual ? 'spirit' : 'health',
      interrupts: dmg > 0 && pressure >= this.threshold(def) - EPS,
      breaksStances: dmg > 0 && pressure >= stanceLimit - EPS && this.activeStances(def).length > 0,
    };
  }

  // Damage a hit does to a construct: no reduction; spiritual and pure-madra hits do double (not both).
  constructDamage(prof, raw = prof.damage) {
    return Math.round(raw * (prof.dtype === 'spiritual' || prof.pure ? 2 : 1));
  }

  // ---------- turn options ----------
  turnOptions(f) {
    const o = this.opponent(f);
    const opts = [
      { key: 'strike', label: 'Strike', group: 'basic' },
      { key: 'moveIn', label: 'Move closer', group: 'basic' },
      { key: 'moveOut', label: 'Move away', group: 'basic' },
      {
        key: 'wait', label: 'Wait', group: 'basic',
        slider: { label: 'Ticks', min: R.TIMING.waitMin, max: R.TIMING.waitMax, step: 0.5, initial: R.TIMING.waitDefault },
      },
    ];
    // Single-target attacks can be aimed at the opponent or one of their (non-barrier) constructs
    // that the attack can reach.
    const withTargets = (opt, ranges) => {
      const targets = o.constructs.filter((c) => c.kind !== 'barrier' && ranges.includes(this.constructRange(c)))
        .map((c) => ({ id: c.id, label: `${o.name}'s ${c.name} (${fmt(c.hp)} HP, ${R.RANGES[this.constructRange(c)]})` }));
      return targets.length ? { ...opt, targets: [{ id: '', label: o.name }, ...targets] } : opt;
    };
    opts[0] = withTargets(opts[0], [0]);

    for (const t of this.techList(f)) {
      if (t.kind === 'stance' && f.stances[t.id]) {
        opts.push({ key: `drop:${t.id}`, label: `Drop ${t.name}`, group: 'drop' });
        continue;
      }
      if (t.kind === 'launch') {
        opts.push({ key: `${t.id}:in`, label: `${t.name} in`, group: 'path', type: t.type, desc: t.desc });
        opts.push({ key: `${t.id}:out`, label: `${t.name} away`, group: 'path', type: t.type, desc: t.desc });
        continue;
      }
      let opt = { key: t.id, label: t.label || t.name, group: 'path', type: t.type, desc: t.desc, card: t.card, cardTitle: t.name, cardDesc: t.cardDesc };
      if (t.kind === 'command') {
        const n = this.stars(f).length;
        if (n >= 1) opt.slider = { label: 'Stars', min: 1, max: n, step: 1, initial: n };
        opts.push(opt);
        continue;
      }
      const max = this.maxMadra(f, t);
      if ((t.kind === 'attack' || t.kind === 'construct' || t.kind === 'forge' || t.kind === 'pulse') && max >= (t.minMadra || 1)) {
        const step = t.madraStep || 1;
        const min = t.minMadra || 1;
        const top = Math.floor(max / step) * step;
        opt.slider = { label: 'Madra', min, max: top, step, initial: Math.max(min, Math.min(10, top)) };
      }
      if (t.kind === 'attack' && !t.area) opt = withTargets(opt, t.ranges);
      opts.push(opt);
    }
    return opts;
  }

  // Preview of a turn choice: { enabled, reason, lines }
  preview(f, key, amount = 0, target = '') {
    const o = this.opponent(f);
    const spd = this.speed(f);
    const tc = target ? o.constructs.find((c) => c.id === target) : null;
    const attackLines = (prof, hits) => {
      if (tc) {
        const dmg = this.constructDamage(prof);
        return `${hits > 1 ? hits + ' hits × ' : ''}${dmg} damage to ${tc.name} · ${pct(this.constructHitChance(f, prof, tc))} to hit`;
      }
      const res = this.hitResult(f, o, prof);
      const soak = res.absorbed ? ` (barrier soaks ${fmt(res.absorbed)})` : '';
      const where = res.track === 'spirit' ? ' to spirit' : '';
      return `${hits > 1 ? hits + ' hits × ' : ''}${fmt(prof.damage)} damage (${res.dmg}${where} after reduction${soak}) · ${this.hitText(f, o, prof)}`;
    };

    if (key === 'strike') {
      const prof = this.attackProfile(f, 'strike');
      const w = R.physTime(R.TIMING.strikeWindup, spd);
      const next = R.physTime(R.TIMING.strikeWindup + R.TIMING.strikeRecovery, spd);
      const gate = tc ? this.constructGate([0], tc, 'Close range only') : this.rangeGate([0], this.time + w, 'Close range only');
      const lines = [`Wind-up ${fmt(w)} · next turn in ${fmt(next)}`, attackLines(prof, prof.hits)];
      if (gate.note) lines.push(gate.note);
      return { enabled: true, reason: '', warning: gate.warning, lines };
    }
    if (key === 'moveIn' || key === 'moveOut') {
      // Like attacks, a move checks the range when it finishes, counting the opponent's move underway.
      const w = R.physTime(R.TIMING.move, spd);
      const nd = this.distanceAt(this.time + w - EPS) + (key === 'moveIn' ? -1 : 1);
      const ok = nd >= 0 && nd <= 2;
      return {
        enabled: ok,
        reason: ok ? '' : (key === 'moveIn' ? 'Already at close range' : 'Already at far range'),
        lines: [ok ? `To ${R.RANGES[nd]} range · arrives t=${fmt(this.time + w)} (next turn then)` : '', ok ? 'Attacks that land before you arrive still hit' : ''],
      };
    }
    if (key === 'wait') {
      return { enabled: true, reason: '', lines: [`Next turn in ${fmt(clampWait(amount))}`] };
    }
    if (key.startsWith('drop:')) {
      const def = this.tech(f, key.slice(5));
      const delay = R.TIMING.reraiseDelay * R.controlFactor(f.stats.control);
      return { enabled: true, reason: '', lines: [`Free. Can be raised again after ${fmt(delay)} ticks${def.buildUp ? '; build-up is lost' : ''}`] };
    }

    const t = this.tech(f, key);
    if (t.kind === 'stance') {
      const locked = f.lockedUntil[t.id] && f.lockedUntil[t.id] > this.time + EPS;
      const w = this.twind(t, R.TIMING.stanceWindup, f.stats.control);
      const enough = f.madra >= t.raiseCost;
      const reason = locked ? `Can be raised again at t=${fmt(f.lockedUntil[t.id])}` : !enough ? 'Not enough madra' : '';
      return {
        enabled: !locked && enough,
        reason,
        lines: [
          `Costs ${t.raiseCost} madra · wind-up ${fmt(w)} · next turn in ${fmt(w + R.TIMING.techRecovery)}`,
          `Upkeep ${fmt(t.upkeep * R.controlFactor(f.stats.control))} madra per tick${t.buildUp ? ', rising with build-up' : ''}`,
        ],
      };
    }
    if (t.kind === 'launch') {
      const dir = key.endsWith(':in') ? -1 : 1;
      const nd = this.distanceAt(this.time + t.travel - EPS) + dir;
      const ok = nd >= 0 && nd <= 2;
      const enough = f.madra >= t.fixedCost;
      return {
        enabled: ok && enough,
        reason: !ok ? (dir < 0 ? 'Already at close range' : 'Already at far range') : enough ? '' : 'Not enough madra',
        lines: [`Costs ${t.fixedCost} madra · to ${ok ? R.RANGES[nd] : '—'} range, arrives t=${fmt(this.time + t.travel)} · next turn in ${fmt(t.travel + t.recovery)}`],
      };
    }
    if (t.kind === 'command') {
      const stars = this.stars(f).sort((a, b) => b.madra - a.madra);
      if (!stars.length) return { enabled: false, reason: 'No stars forged', lines: [] };
      const n = Math.min(Math.max(1, Math.round(amount) || stars.length), stars.length);
      const chosen = stars.slice(0, n);
      const after = chosen.map((c) => this.hitResult(f, o, this.starProfile(f, c.madra)).dmg);
      const chance = this.hitChance(f, o, this.starProfile(f, chosen[0].madra));
      return {
        enabled: true, reason: '',
        lines: [
          `Drops ${n} of ${stars.length} star(s), biggest first · they land t=${fmt(this.time + STAR.dropTime)} · next turn then`,
          `${chosen.map((c) => c.madra).join(' + ')} madra: ${after.join(' + ')} spirit damage after reduction · ${pct(chance)} to hit each`,
        ],
      };
    }
    if (t.kind === 'pulse') {
      const max = this.maxMadra(f, t);
      if (max < t.minMadra) return { enabled: false, reason: 'Not enough madra', lines: [] };
      const madra = Math.min(Math.max(t.minMadra, Math.round(amount)), max);
      const w = this.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
      const gate = this.rangeGate(t.ranges, this.time + w, 'Out of range (Close)');
      const targets = this.pulseTargets(o, madra, t.ranges);
      const lines = [
        `Wind-up ${fmt(w)} (lands t=${fmt(this.time + w)}) · next turn in ${fmt(w + R.TIMING.techRecovery)}`,
        `Cancels ${o.name}'s wind-ups, stances and constructs costing up to ${fmt(madra / 2)} · no roll`,
        targets.length ? `Right now: ${targets.map((x) => `${x.name} (${fmt(x.cost)})`).join(', ')}` : `Nothing of ${o.name}'s is that cheap right now`,
        `${o.name} can block it at double cost: each point takes 1.5 off its strength`,
      ];
      if (gate.note) lines.push(gate.note);
      return { enabled: true, reason: '', warning: gate.warning, lines };
    }
    if (t.kind === 'disrupt') {
      const enough = f.madra >= t.fixedCost;
      const w = this.twind(t, t.windup, f.stats.control);
      const rangeText = `Out of range (${t.ranges.map((r) => R.RANGES[r]).join('/')})`;
      const gate = this.rangeGate(t.ranges, this.time + w, rangeText);
      const prof = this.disruptProfile(f, t);
      const lines = [`Costs ${t.fixedCost} madra · wind-up ${fmt(w)} (lands t=${fmt(this.time + w)}) · next turn in ${fmt(w + R.TIMING.techRecovery)}`];
      lines.push(t.area
        ? `Breaks ${o.name}'s wind-ups, stances${t.destroysConstructs ? ' and constructs' : ''} at ${t.ranges.map((r) => R.RANGES[r]).join('/')} range · no roll`
        : `If it hits, breaks ${o.name}'s wind-ups and stances · ${this.hitText(f, o, prof)}`);
      if (gate.note) lines.push(gate.note);
      return { enabled: enough, reason: enough ? '' : 'Not enough madra', warning: gate.warning, lines };
    }

    const max = this.maxMadra(f, t);
    if (max < (t.minMadra || 1)) return { enabled: false, reason: 'Not enough madra', lines: [] };
    const step = t.madraStep || 1;
    const madra = Math.min(Math.max(t.minMadra || 1, Math.round(amount / step) * step), Math.floor(max / step) * step);
    const nominal = R.nominalWindup(madra, t.divisor);
    const w = this.twind(t, nominal, f.stats.control);
    const next = (t.ruler ? 0 : w) + R.TIMING.techRecovery;
    const timing = `Wind-up ${fmt(w)} (lands t=${fmt(this.time + w)}) · next turn in ${fmt(next)}${t.ruler ? ' (Ruler: act while it builds)' : ''}`;

    if (t.kind === 'forge') {
      const sp = this.starProfile(f, madra);
      return {
        enabled: true, reason: '',
        lines: [
          `Star forms at t=${fmt(this.time + w)} (${fmt(w)} ticks) · next turn in ${fmt(STAR.forgeRecovery)} (keep acting while it forms)`,
          `When dropped: ${fmt(sp.damage)} spiritual (${this.hitResult(f, o, sp).dmg} after ${o.name}'s reduction) · star HP ${fmt(madra * (t.sizeMult || 1))}, at Far range`,
        ],
      };
    }
    if (t.kind === 'construct') {
      const pieces = this.forgePieces(t, madra);
      const build = `Builds over ${fmt(w)} ticks, one piece every ${fmt(w / pieces.length)} · next turn in ${fmt(R.TIMING.techRecovery)} (Forger: act while it builds)`;
      const line = `Barrier HP +${fmt(madra * 2 * (t.sizeMult || 1))}${this.barrier(f) ? ` (now ${fmt(this.barrier(f).hp)})` : ''}, filling in as it builds`;
      return { enabled: true, reason: '', lines: [build, line] };
    }

    const prof = this.attackProfile(f, key, madra);
    const rangeText = `Out of range (${prof.ranges.map((r) => R.RANGES[r]).join('/')})`;
    const gate = tc ? this.constructGate(prof.ranges, tc, rangeText) : this.rangeGate(prof.ranges, this.time + w, rangeText);
    const hits = tc ? 1 : this.hitsAgainst(f, o, prof);
    const lines = [timing, attackLines(prof, hits)];
    if (gate.note) lines.push(gate.note);
    if (prof.sharpness) lines.push(`Sharpness ${prof.sharpness}`);
    if (t.boostPerMadra) lines.push(`+${t.boostPerMadra} damage per Black Flame madra you spend while it winds up`);
    if (this.path(f).selfBurn) lines.push(`Burns you for ${fmt(madra / 5)} health and ${fmt(madra / 10)} spirit`);
    return { enabled: true, reason: '', warning: gate.warning, lines };
  }

  // Madra Pulse: what it would cancel on f at a given strength (madra, less blocks). It cancels
  // wind-ups, stances and constructs (in range) that cost at most half its strength.
  pulseTargets(f, strength, ranges) {
    const limit = strength / 2 + EPS;
    const out = [];
    for (const w of f.windups) {
      if (this.isPlainStrike(w)) continue;
      if (w.madra <= limit) out.push({ kind: 'windup', ref: w, name: `${w.label} (winding up)`, cost: w.madra });
    }
    for (const s of this.activeStances(f)) if (s.raiseCost <= limit) out.push({ kind: 'stance', ref: s, name: s.name, cost: s.raiseCost });
    for (const c of f.constructs) {
      const cost = c.kind === 'barrier' ? c.hp / 2 : c.madra;
      if (ranges.includes(this.constructRange(c)) && cost <= limit) out.push({ kind: 'construct', ref: c, name: c.name, cost });
    }
    return out;
  }

  pulseProfile(f, t, madra) {
    return {
      name: t.name, damage: 0, dtype: 'technique', toHit: 0, sharpness: 0, ranges: t.ranges, bestRange: t.ranges[0],
      area: true, hits: 1, madra, effect: 'pulse', pure: !!this.path(f).pureMadra,
    };
  }

  applyPulse(att, def, prof, blockDR) {
    const strength = Math.max(0, prof.madra - blockDR);
    const targets = this.pulseTargets(def, strength, prof.ranges);
    this.addLog(`${att.name}'s ${prof.name} washes over ${def.name}, cancelling anything that cost ${fmt(strength / 2)} or less.`, 'hit', att.index);
    if (!targets.length) {
      this.addLog(`Nothing of ${def.name}'s is that cheap.`, 'dim', def.index);
      return;
    }
    const windups = targets.filter((x) => x.kind === 'windup').map((x) => x.ref);
    if (windups.length) this.interrupt(def, windups);
    for (const x of targets.filter((x) => x.kind === 'stance')) this.breakStance(def, x.ref);
    for (const x of targets.filter((x) => x.kind === 'construct')) {
      def.constructs = def.constructs.filter((c) => c !== x.ref);
      this.addLog(`${def.name}'s ${x.name} is dispersed.`, 'warn', def.index);
    }
  }

  disruptProfile(f, t) {
    return {
      name: t.name, damage: 0, dtype: 'technique', toHit: t.toHit || 0, sharpness: 0,
      ranges: t.ranges, bestRange: t.bestRange ?? t.ranges[0], area: !!t.area, hits: 1,
      madra: t.fixedCost, effect: 'disrupt', destroysConstructs: !!t.destroysConstructs,
    };
  }

  // ---------- projections (hover previews) ----------
  // What a turn choice would change: bar deltas per fighter and ghost queue items.
  project(f, key, amount = 0, target = '') {
    if (!this.preview(f, key, amount, target).enabled || key.startsWith('drop:')) return null;
    const o = this.opponent(f);
    const spd = this.speed(f);
    const out = { deltas: [{}, {}], notes: ['', ''], queue: [], replacesTurn: f.index };
    const add = (who, k, v) => { out.deltas[who][k] = (out.deltas[who][k] || 0) + v; };
    // Queue item types: turn, attack, move, stance, construct, buildup (each gets its own marker shape).
    const q = (time, label, type) => out.queue.push({ time, label: `${f.name}: ${label}`, who: f.index, kind: 'resolve', type, ghost: true });
    const nextTurn = (time) => out.queue.push({ time, label: `${f.name}'s next turn`, who: f.index, kind: 'turn', type: 'turn', ghost: true });
    const spendM = (m) => {
      add(f.index, 'madra', -m);
      if (this.path(f).selfBurn) { add(f.index, 'health', -m / 5); add(f.index, 'spirit', -m / 10); }
    };
    const hitDelta = (prof, hits) => {
      if (target) { out.notes[o.index] = `aimed at a construct`; return; }
      const res = this.hitResult(f, o, prof);
      add(o.index, res.track, -res.dmg * hits);
      out.notes[o.index] = prof.area
        ? `${hits > 1 ? `${hits} hits, ` : ''}no roll`
        : `if ${hits > 1 ? `all ${hits} hit` : 'it hits'} (${pct(this.hitChance(f, o, prof))}${hits > 1 ? ' each' : ''})`;
    };

    if (key === 'strike') {
      const prof = this.attackProfile(f, 'strike');
      q(this.time + R.physTime(R.TIMING.strikeWindup, spd), `${prof.name} lands`, 'attack');
      nextTurn(this.time + R.physTime(R.TIMING.strikeWindup + R.TIMING.strikeRecovery, spd));
      hitDelta(prof, prof.hits);
      return out;
    }
    if (key === 'moveIn' || key === 'moveOut') {
      const w = R.physTime(R.TIMING.move, spd);
      q(this.time + w, `arrives at ${R.RANGES[this.distance + (key === 'moveIn' ? -1 : 1)]}`, 'move');
      nextTurn(this.time + w);
      return out;
    }
    if (key === 'wait') {
      nextTurn(this.time + clampWait(amount));
      return out;
    }

    const t = this.tech(f, key);
    if (t.kind === 'stance') {
      spendM(t.raiseCost);
      const w = this.twind(t, R.TIMING.stanceWindup, f.stats.control);
      q(this.time + w, `${t.name} is up`, 'stance');
      nextTurn(this.time + w + R.TIMING.techRecovery);
      return out;
    }
    if (t.kind === 'launch') {
      spendM(t.fixedCost);
      const dir = key.endsWith(':in') ? -1 : 1;
      q(this.time + t.travel, `lands at ${R.RANGES[this.distance + dir]}`, 'move');
      nextTurn(this.time + t.travel + t.recovery);
      return out;
    }
    if (t.kind === 'command') {
      const stars = this.stars(f).sort((a, b) => b.madra - a.madra);
      const n = Math.min(Math.max(1, Math.round(amount) || stars.length), stars.length);
      q(this.time + STAR.dropTime, `${n} star(s) land`, 'attack');
      nextTurn(this.time + STAR.dropTime);
      for (const c of stars.slice(0, n)) add(o.index, 'spirit', -this.hitResult(f, o, this.starProfile(f, c.madra)).dmg);
      out.notes[o.index] = 'if every star hits';
      return out;
    }
    if (t.kind === 'pulse') {
      const madra = Math.min(Math.max(t.minMadra, Math.round(amount)), this.maxMadra(f, t));
      spendM(madra);
      const w = this.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
      q(this.time + w, `${t.name} lands`, 'attack');
      nextTurn(this.time + w + R.TIMING.techRecovery);
      const targets = this.pulseTargets(o, madra, t.ranges);
      out.notes[o.index] = targets.length ? `unless blocked: ${targets.map((x) => x.name).join(', ')} break` : 'nothing cheap enough to break';
      return out;
    }
    if (t.kind === 'disrupt') {
      spendM(t.fixedCost);
      const w = this.twind(t, t.windup, f.stats.control);
      q(this.time + w, `${t.name} lands`, 'attack');
      nextTurn(this.time + w + R.TIMING.techRecovery);
      out.notes[o.index] = t.area ? 'wind-ups, stances and constructs break' : 'if it hits: wind-ups and stances break';
      return out;
    }

    const step = t.madraStep || 1;
    const madra = Math.min(Math.max(t.minMadra || 1, Math.round(amount / step) * step), this.maxMadra(f, t));
    spendM(madra);
    const w = this.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
    if (t.kind === 'forge') {
      nextTurn(this.time + STAR.forgeRecovery);
      q(this.time + w, `star (${madra}) forms`, 'construct');
      return out;
    }
    nextTurn(this.time + (t.ruler || t.kind === 'construct' ? 0 : w) + R.TIMING.techRecovery);
    if (t.kind === 'construct') {
      const pieces = this.forgePieces(t, madra);
      pieces.forEach((pc, i) => q(this.time + w * ((i + 1) / pieces.length), `barrier piece ${i + 1}/${pieces.length} forms`, 'construct'));
      return out;
    }
    const prof = this.attackProfile(f, key, madra);
    q(this.time + w, `${t.name} lands`, 'attack');
    hitDelta(prof, this.hitsAgainst(f, o, prof));
    return out;
  }

  // ---------- reactions ----------
  reactionOptions() {
    const p = this.prompt;
    const a = p.attack;
    const att = this.fighters[a.attacker];
    const def = this.fighters[p.fighter];
    // Pure madra makes blocks (and reinforcing a construct) cost double.
    const factor = R.blockCostFactor(a.hits) * (a.profile.pure ? 2 : 1);
    const c = a.construct ? def.constructs.find((x) => x.id === a.construct) : null;
    if (c) {
      // Defending a construct: no dodge or redirect, only reinforcing it with madra (a block).
      const chance = this.constructHitChance(att, a.profile, c);
      const dmg = this.constructDamage(a.profile);
      return {
        construct: c,
        take: { chance, damage: dmg, damageText: `${dmg}` },
        dodge: { available: false, chance, bonus: 0, reduction: 0, delay: 0 },
        block: { chance, factor, hits: a.hits, maxBase: Math.floor(this.maxMadra(def) / factor), delay: R.TIMING.blockDelay },
        redirect: { available: false, shown: false, cost: 0 },
      };
    }
    const redirectCost = Math.ceil((a.profile.madra || 0) / 2);
    const canRedirect = this.stanceFlag(def, 'redirect') && !a.profile.area && a.profile.dtype !== 'physical'
      && !a.profile.fromConstruct && (a.profile.madra || 0) > 0;
    return {
      take: (() => {
        const each = this.hitProfiles(a.profile, a.hits).map((hp) => this.hitResult(att, def, hp).dmg);
        return { chance: this.hitChance(att, def, a.profile), damage: each[0], damageText: a.profile.hitDamages ? each.join(' + ') : `${each[0]}` };
      })(),
      dodge: (() => {
        const bonus = R.dodgeBonus(this.speed(def), this.speed(att));
        return {
          available: a.profile.effect !== 'pulse',
          chance: this.hitChance(att, def, a.profile, true),
          // Chance to hit for each hit of the attack while dodging (the dodge tapers off).
          chances: Array.from({ length: a.hits }, (_, i) => this.hitChance(att, def, a.profile, true, i)),
          bonuses: Array.from({ length: a.hits }, (_, i) => Math.max(0, bonus - i)),
          bonus,
          reduction: a.profile.area ? R.areaDodgeReduction(bonus) : 0,
          delay: R.physTime(R.TIMING.dodge, this.speed(def)),
        };
      })(),
      block: {
        chance: this.hitChance(att, def, a.profile),
        factor,
        hits: a.hits,
        maxBase: Math.floor(this.maxMadra(def) / factor),
        delay: R.TIMING.blockDelay,
      },
      redirect: {
        available: canRedirect && def.madra >= redirectCost,
        shown: canRedirect,
        cost: redirectCost,
      },
    };
  }

  // The result of a reaction choice: damage per hit, chance per hit, madra and time it costs.
  reactionOutcome(choice, blockBase = 0) {
    const a = this.prompt.attack;
    const att = this.fighters[a.attacker];
    const def = this.fighters[this.prompt.fighter];
    const ro = this.reactionOptions();
    if (choice === 'redirect') {
      return { perHit: 0, hits: a.hits, chance: 0, madraCost: ro.redirect.cost, delay: 0, interrupts: false, breaksStances: false, track: 'health' };
    }
    if (a.profile.effect === 'pulse') {
      const m = choice === 'block' ? Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase) : 0;
      const strength = Math.max(0, a.profile.madra - 1.5 * m);
      return {
        perHit: 0, total: 0, perHitText: null, track: 'health', absorbed: 0, hits: 1, chance: 1,
        madraCost: m * ro.block.factor, delay: m > 0 ? R.TIMING.blockDelay : 0, interrupts: false, breaksStances: false,
        pulse: { strength, targets: this.pulseTargets(def, strength, a.profile.ranges) },
      };
    }
    if (ro.construct) {
      const m = choice === 'block' ? Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase) : 0;
      const per = Math.max(0, Math.round(ro.take.damage - 1.5 * m));
      return {
        perHit: per, total: per * a.hits, perHitText: null, track: 'construct', absorbed: 0, hits: a.hits,
        chance: ro.take.chance, madraCost: m * ro.block.factor, delay: m > 0 ? R.TIMING.blockDelay : 0,
        interrupts: false, breaksStances: false, construct: ro.construct,
      };
    }
    const dodging = choice === 'dodge' || choice === 'dodgeBlock';
    const blocking = choice === 'block' || choice === 'dodgeBlock';
    const m = blocking ? Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase) : 0;
    const each = this.hitProfiles(a.profile, a.hits).map((hp, i) => this.hitResult(att, def, hp, { dodging, blockDR: 1.5 * m, hitIndex: i }));
    const res = each[0];
    return {
      perHit: res.dmg,
      total: each.reduce((s, r) => s + r.dmg, 0),
      perHitText: a.profile.hitDamages ? each.map((r) => r.dmg).join(' + ') : null,
      track: res.track,
      absorbed: res.absorbed,
      hits: a.hits,
      chance: a.profile.area ? 1 : dodging ? ro.dodge.chance : ro.take.chance,
      chances: a.profile.area ? null : dodging ? ro.dodge.chances : null,
      madraCost: m * ro.block.factor,
      delay: (dodging ? ro.dodge.delay : 0) + (m > 0 ? R.TIMING.blockDelay : 0),
      interrupts: each.some((r) => r.interrupts),
      breaksStances: each.some((r) => r.breaksStances),
    };
  }

  // What a reaction would change for the defender.
  projectReaction(choice, blockBase = 0) {
    if (!this.prompt || this.prompt.kind !== 'reaction') return null;
    const a = this.prompt.attack;
    const def = this.fighters[this.prompt.fighter];
    const o = this.reactionOutcome(choice, blockBase);
    const out = { deltas: [{}, {}], notes: ['', ''], queue: [], replacesTurn: null, shiftTurn: null };
    if (o.madraCost) out.deltas[def.index].madra = -o.madraCost;
    if (choice !== 'redirect' && a.profile.effect !== 'disrupt' && !o.pulse) out.deltas[def.index][o.track] = -o.total;
    out.notes[def.index] = o.pulse ? (o.pulse.targets.length ? `${o.pulse.targets.map((x) => x.name).join(', ')} break` : 'nothing breaks')
      : o.construct ? `${o.construct.name}: −${o.total} HP if it hits (${pct(o.chance)})`
      : choice === 'redirect' ? 'thrown back'
      : a.profile.area ? `${o.hits > 1 ? `${o.hits} hits, ` : ''}no roll`
      : `if ${o.hits > 1 ? `all ${o.hits} hit` : 'it hits'} (${pct(o.chance)}${o.hits > 1 ? ' each' : ''})`;
    if (o.delay) {
      out.shiftTurn = def.index;
      out.queue.push({ time: def.nextTurn + o.delay, label: `${def.name}'s next turn`, who: def.index, kind: 'turn', type: 'turn', ghost: true });
    }
    return out;
  }

  // ---------- acting ----------
  act(key, amount = 0, target = '') {
    const f = this.current();
    if (!f || this.prompt.kind !== 'turn') return;
    const o = this.opponent(f);
    if (target && !o.constructs.some((c) => c.id === target)) target = '';
    const pv = this.preview(f, key, amount, target);
    if (!pv.enabled) return;
    const spd = this.speed(f);

    if (key.startsWith('drop:')) {
      const id = key.slice(5);
      delete f.stances[id];
      f.lockedUntil[id] = this.time + R.TIMING.reraiseDelay * R.controlFactor(f.stats.control);
      this.addLog(`${f.name} drops ${this.tech(f, id).name}.`, '', f.index);
      return; // free action: still their turn
    }

    if (!['strike', 'moveIn', 'moveOut', 'wait'].includes(key)) {
      const id = key.split(':')[0];
      f.seen = f.seen || [];
      if (!f.seen.includes(id)) f.seen.push(id);
    }

    const aimed = target ? ` at ${o.name}'s ${o.constructs.find((c) => c.id === target).name}` : '';
    if (key === 'strike') {
      const prof = { ...this.attackProfile(f, 'strike'), target };
      const w = R.physTime(R.TIMING.strikeWindup, spd);
      this.startWindup(f, w, { kind: 'attack', profile: prof }, 0);
      f.nextTurn = this.time + R.physTime(R.TIMING.strikeWindup + R.TIMING.strikeRecovery, spd);
      this.addLog(`${f.name} winds up a strike${aimed}.`, '', f.index);
    } else if (key === 'moveIn' || key === 'moveOut') {
      this.startMove(f, key === 'moveIn' ? -1 : 1, R.physTime(R.TIMING.move, spd), 0);
    } else if (key === 'wait') {
      const t = clampWait(amount);
      f.nextTurn = this.time + t;
      this.addLog(`${f.name} waits ${fmt(t)} ticks.`, 'dim', f.index);
    } else {
      const t = this.tech(f, key);
      const burn = this.path(f).selfBurn;
      if (t.kind === 'stance') {
        this.spend(f, t.raiseCost, burn);
        const w = this.twind(t, R.TIMING.stanceWindup, f.stats.control);
        this.startWindup(f, w, { kind: 'stance', id: t.id }, t.raiseCost);
        f.nextTurn = this.time + w + R.TIMING.techRecovery;
        this.addLog(`${f.name} begins raising ${t.name} (${t.raiseCost} madra).`, '', f.index);
      } else if (t.kind === 'launch') {
        this.spend(f, t.fixedCost, burn);
        this.startMove(f, key.endsWith(':in') ? -1 : 1, t.travel, t.recovery, t.name);
      } else if (t.kind === 'command') {
        const stars = this.stars(f).sort((a, b) => b.madra - a.madra);
        const n = Math.min(Math.max(1, Math.round(amount) || stars.length), stars.length);
        const chosen = stars.slice(0, n);
        f.constructs = f.constructs.filter((c) => !chosen.includes(c));
        const profile = { ...this.starsProfile(f, chosen.map((c) => c.madra)), target: '' };
        this.events.push({ id: this.nextId++, time: this.time + STAR.dropTime, type: 'resolve', actor: f.index, action: { kind: 'attack', profile } });
        f.nextTurn = this.time + STAR.dropTime;
        this.addLog(`${f.name} drops ${n} star${n > 1 ? 's' : ''} from the Crown (${chosen.map((c) => c.madra).join(', ')} madra; landing t=${fmt(this.time + STAR.dropTime)}).`, '', f.index);
      } else if (t.kind === 'pulse') {
        const madra = Math.min(Math.max(t.minMadra, Math.round(amount)), this.maxMadra(f, t));
        this.spend(f, madra, burn);
        const w = this.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
        this.startWindup(f, w, { kind: 'pulse', id: t.id, profile: this.pulseProfile(f, t, madra) }, madra);
        f.nextTurn = this.time + w + R.TIMING.techRecovery;
        this.addLog(`${f.name} winds up ${t.name} with ${madra} madra (lands t=${fmt(this.time + w)}).`, '', f.index);
      } else if (t.kind === 'disrupt') {
        this.spend(f, t.fixedCost, burn);
        const w = this.twind(t, t.windup, f.stats.control);
        this.startWindup(f, w, { kind: 'disrupt', id: t.id, profile: this.disruptProfile(f, t) }, t.fixedCost);
        f.nextTurn = this.time + w + R.TIMING.techRecovery;
        this.addLog(`${f.name} winds up ${t.name} (lands t=${fmt(this.time + w)}).`, '', f.index);
      } else {
        const step = t.madraStep || 1;
        const madra = Math.min(Math.max(t.minMadra || 1, Math.round(amount / step) * step), Math.floor(this.maxMadra(f, t) / step) * step);
        this.spend(f, madra, burn);
        const w = this.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
        if (t.kind === 'forge') {
          this.startWindup(f, w, { kind: 'forged', id: t.id, madra }, madra, { label: `Crown star (${madra})` });
          f.nextTurn = this.time + STAR.forgeRecovery;
          this.addLog(`${f.name} begins Forging a ${madra}-madra star (forms t=${fmt(this.time + w)}).`, '', f.index);
        } else {
          if (t.kind === 'construct') {
            this.startForge(f, t, w, madra);
          } else {
            const prof = { ...this.attackProfile(f, key, madra), target };
            this.startWindup(f, w, { kind: 'attack', profile: prof }, madra, { boostPerMadra: t.boostPerMadra || 0 });
          }
          f.nextTurn = this.time + (t.ruler || t.kind === 'construct' ? 0 : w) + R.TIMING.techRecovery;
          this.addLog(t.kind === 'construct'
            ? `${f.name} begins Forging ${t.name} with ${madra} madra (complete at t=${fmt(this.time + w)}).`
            : `${f.name} winds up ${t.name} with ${madra} madra${aimed} (lands t=${fmt(this.time + w)}).`, '', f.index);
        }
      }
    }
    this.prompt = null;
    this.advance();
  }

  startMove(f, dir, travel, recovery, via = '') {
    const ev = { id: this.nextId++, time: this.time + travel, type: 'resolve', actor: f.index, action: { kind: 'move', dir } };
    this.events.push(ev);
    f.moving = { start: this.time, end: ev.time, dir };
    f.nextTurn = ev.time + recovery;
    this.addLog(`${f.name} ${via ? `uses ${via} to move` : 'starts moving'} ${dir < 0 ? 'in' : 'away'} (arrives t=${fmt(ev.time)}).`, '', f.index);
  }

  // A barrier builds in pieces of 5 madra spread over the wind-up. Each piece joins the
  // barrier as it forms; an interrupt stops the rest.
  forgePieces(t, madra) {
    const size = 5;
    const pieces = [];
    for (let left = madra; left > 0; left -= size) pieces.push(Math.min(size, left));
    return pieces;
  }

  startForge(f, t, duration, madra) {
    const pieces = this.forgePieces(t, madra);
    const ids = pieces.map((pm, i) => {
      const ev = {
        id: this.nextId++, time: this.time + duration * ((i + 1) / pieces.length), type: 'resolve', actor: f.index,
        action: { kind: 'piece', id: t.id, madra: pm, n: i + 1, of: pieces.length },
      };
      this.events.push(ev);
      return ev.id;
    });
    f.windups.push({ eventId: ids[ids.length - 1], eventIds: ids, start: this.time, end: this.time + duration, madra, boost: 0, boostPerMadra: 0, label: t.name });
  }

  startWindup(f, duration, action, madra, extra = {}) {
    const ev = { id: this.nextId++, time: this.time + duration, type: 'resolve', actor: f.index, action };
    this.events.push(ev);
    const label = extra.label || (action.profile ? action.profile.name : this.tech(f, action.id).name);
    f.windups.push({ eventId: ev.id, start: this.time, end: ev.time, madra, boost: 0, boostPerMadra: 0, ...extra, label });
  }

  react(choice, blockBase = 0) {
    if (!this.prompt || this.prompt.kind !== 'reaction') return;
    const a = this.prompt.attack;
    const att = this.fighters[a.attacker];
    const def = this.fighters[this.prompt.fighter];
    const ro = this.reactionOptions();

    if (a.profile.effect === 'pulse') {
      if (choice !== 'take' && choice !== 'block') return;
      const m = choice === 'block' ? Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase) : 0;
      if (m > 0) {
        const cost = m * ro.block.factor;
        this.spend(def, cost, false);
        def.nextTurn += R.TIMING.blockDelay;
        this.addLog(`${def.name} braces against the pulse with ${fmt(cost)} madra (−${fmt(1.5 * m)} strength).`, '', def.index);
      } else {
        this.addLog(`${def.name} lets the pulse come.`, 'dim', def.index);
      }
      this.prompt = null;
      this.applyPulse(att, def, a.profile, 1.5 * m);
      this.advance();
      return;
    }

    if (ro.construct) {
      if (choice !== 'take' && choice !== 'block') return;
      const c = ro.construct;
      const m = choice === 'block' ? Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase) : 0;
      if (m > 0) {
        const cost = m * ro.block.factor;
        this.spend(def, cost, false);
        def.nextTurn += R.TIMING.blockDelay;
        this.addLog(`${def.name} reinforces ${c.name} with ${fmt(cost)} madra (−${fmt(1.5 * m)} damage${a.hits > 1 ? ' on each hit' : ''}).`, '', def.index);
      } else {
        this.addLog(`${def.name} leaves ${c.name} to take it.`, 'dim', def.index);
      }
      this.prompt = null;
      this.resolveConstructAttack(att, def, a.profile, c, 1.5 * m);
      this.advance();
      return;
    }

    if (choice === 'redirect') {
      if (!ro.redirect.available) return;
      this.spend(def, ro.redirect.cost, false);
      const back = { ...a.profile, name: `${a.profile.name} (redirected)`, target: '', redirected: true };
      this.events.push({ id: this.nextId++, time: this.time + 1, type: 'resolve', actor: def.index, action: { kind: 'attack', profile: back } });
      this.addLog(`${def.name} catches ${att.name}'s ${a.profile.name} in the Mantle and throws it back (${ro.redirect.cost} madra, lands t=${fmt(this.time + 1)}).`, 'hit', def.index);
      this.prompt = null;
      this.advance();
      return;
    }

    const dodging = choice === 'dodge' || choice === 'dodgeBlock';
    const blocking = choice === 'block' || choice === 'dodgeBlock';
    let blockDR = 0;
    if (dodging) {
      def.nextTurn += ro.dodge.delay;
      this.addLog(a.profile.area
        ? `${def.name} dodges (−${pct(ro.dodge.reduction)} area damage).`
        : `${def.name} dodges (+${ro.dodge.bonus} Defense).`, '', def.index);
    }
    if (blocking) {
      const m = Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase);
      if (m > 0) {
        const cost = m * ro.block.factor;
        this.spend(def, cost, false);
        blockDR = 1.5 * m;
        def.nextTurn += R.TIMING.blockDelay;
        this.addLog(`${def.name} blocks with ${fmt(cost)} madra (−${fmt(blockDR)} damage on ${a.hits > 1 ? `each of ${a.hits} hits` : 'the hit'}).`, '', def.index);
      }
    }
    if (!dodging && !blocking) this.addLog(`${def.name} lets it come.`, 'dim', def.index);
    this.prompt = null;
    this.resolveAttack(att, def, a.profile, a.hits, dodging, blockDR);
    this.advance();
  }

  rollHit(att, defense, prof) {
    const [d1, d2] = R.roll2d6(this.rng);
    const pen = this.rangePenalty(prof);
    const total = d1 + d2 + att.stats.precision + prof.toHit - pen;
    const text = `2d6 ${d1}+${d2} +${att.stats.precision}${prof.toHit ? ` +${prof.toHit}` : ''}${pen ? ` −${pen} range` : ''} = ${total} vs ${defense}`;
    return { hit: total >= defense, text };
  }

  resolveAttack(att, def, prof, hits, dodging, blockDR) {
    const perHit = this.hitProfiles(prof, hits);
    for (let i = 0; i < hits; i++) {
      if (this.checkEnd()) return;
      const hp = perHit[i];
      const label = hits > 1 ? `${prof.name} (hit ${i + 1}/${hits})` : prof.name;
      let rollText = 'area attack, no roll';
      if (!prof.area) {
        const roll = this.rollHit(att, this.defense(att, def, dodging, i), hp);
        rollText = roll.text;
        if (!roll.hit) {
          this.addLog(`${att.name}'s ${label} misses. ${rollText}`, 'miss', att.index);
          continue;
        }
      }
      if (prof.effect === 'disrupt') {
        this.addLog(`${att.name}'s ${label} hits ${def.name}. ${rollText}`, 'hit', att.index);
        this.disrupt(def, prof);
        continue;
      }
      const res = this.hitResult(att, def, hp, { dodging, blockDR, hitIndex: i });
      const soak = res.absorbed ? ` (barrier soaks ${fmt(res.absorbed)})` : '';
      this.addLog(`${att.name}'s ${label} hits ${def.name} for ${res.dmg}${res.track === 'spirit' ? ' spirit' : ''}${soak}. ${rollText}`, 'hit', att.index);
      this.applyHit(def, res);
    }
    // Area attacks also hit the defender's constructs in range (barriers only soak).
    if (prof.area && prof.effect !== 'disrupt') {
      for (const c of [...def.constructs]) {
        if (c.kind === 'barrier' || !prof.ranges.includes(this.constructRange(c))) continue;
        this.damageConstruct(def, c, this.constructDamage(prof) * hits, prof.name);
      }
    }
    this.checkEnd();
  }

  applyHit(def, res) {
    if (res.absorbed) {
      const b = this.barrier(def);
      b.hp -= res.barrierLoss || res.absorbed;
      if (b.hp < 0.5) {
        def.constructs = def.constructs.filter((c) => c !== b);
        this.addLog(`${def.name}'s ${b.name} shatters.`, 'warn', def.index);
      }
    }
    def[res.track] -= res.dmg;
    if (res.interrupts) this.interrupt(def);
    if (res.breaksStances) this.breakStances(def);
  }

  breakStances(f, reason = 'is broken and drops') {
    for (const s of this.activeStances(f)) this.breakStance(f, s, reason);
  }

  breakStance(f, s, reason = 'is broken and drops') {
    delete f.stances[s.id];
    f.lockedUntil[s.id] = this.time + R.TIMING.reraiseDelay * R.controlFactor(f.stats.control);
    this.addLog(`${f.name}'s ${s.name} ${reason}.`, 'warn', f.index);
  }

  // Disruption (Madra Pulse, Oathsign Seal): breaks wind-ups and stances, and constructs if it can.
  disrupt(f, prof) {
    this.interrupt(f);
    this.breakStances(f);
    if (prof.destroysConstructs) {
      const hit = f.constructs.filter((c) => prof.ranges.includes(this.constructRange(c)));
      for (const c of hit) this.addLog(`${f.name}'s ${c.name} is dispersed.`, 'warn', f.index);
      f.constructs = f.constructs.filter((c) => !hit.includes(c));
    }
  }

  damageConstruct(owner, c, amount, source, note = '') {
    c.hp -= amount;
    this.addLog(`${source} hits ${owner.name}'s ${c.name} for ${fmt(amount)}${c.hp < 0.5 ? ' and destroys it' : ` (${fmt(c.hp)} HP left)`}.${note ? ` ${note}` : ''}`, 'hit', 1 - owner.index);
    if (c.hp < 0.5) {
      owner.constructs = owner.constructs.filter((x) => x !== c);
    }
  }

  // The attack a wind-up will deliver, if it is one.
  windupProfile(w) {
    const ev = this.events.find((e) => e.id === w.eventId);
    return ev && ev.action.kind === 'attack' ? ev.action.profile : null;
  }

  // Physical attacks: a plain strike has no madra to break; an enforced strike (madra in a
  // physical blow) can lose its madra but still lands as a plain strike.
  isPlainStrike(w) { const p = this.windupProfile(w); return !!p && p.dtype === 'physical' && !p.madra; }
  isEnforcedStrike(w) { const p = this.windupProfile(w); return !!p && p.dtype === 'physical' && p.madra > 0; }

  // Breaks wind-ups: all of them, or only the ones given (Madra Pulse picks the cheap ones).
  // Plain strikes can't be broken; a broken enforced strike drops to a plain strike.
  interrupt(f, only = null) {
    const hit = (only || f.windups).filter((w) => !this.isPlainStrike(w));
    if (!hit.length) return;
    let cancelled = false;
    for (const p of hit) {
      const frac = Math.max(0, (p.end - this.time) / (p.end - p.start));
      const kept = p.madra * frac;
      f.madra = Math.min(f.stats.pool, f.madra + kept);
      const lost = `${fmt(p.madra - kept)} madra lost${kept > 0 ? `, ${fmt(kept)} kept` : ''}`;
      if (this.isEnforcedStrike(p)) {
        const ev = this.events.find((e) => e.id === p.eventId);
        ev.action.profile = { ...this.attackProfile(f, 'strike'), target: ev.action.profile.target || '' };
        this.addLog(`${f.name}'s ${p.label} is broken down to a plain strike! ${lost}.`, 'warn', f.index);
        p.label = ev.action.profile.name;
        p.madra = 0;
        p.boost = 0;
        p.boostPerMadra = 0;
        continue;
      }
      const ids = p.eventIds || [p.eventId];
      this.events = this.events.filter((e) => !ids.includes(e.id));
      this.addLog(`${f.name}'s ${p.label} is interrupted! ${lost}.`, 'warn', f.index);
      cancelled = true;
    }
    f.windups = f.windups.filter((w) => !hit.includes(w) || this.isPlainStrike(w));
    if (cancelled) f.nextTurn = Math.min(f.nextTurn, this.time + R.TIMING.interruptStagger);
  }

  // ---------- time ----------
  advanceTo(t) {
    let remaining = t - this.time;
    while (remaining > EPS) {
      const step = Math.min(0.25, remaining);
      for (const f of this.fighters) {
        for (const def of this.activeStances(f)) {
          const cost = this.upkeepRate(f, def) * step;
          if (f.madra + EPS < cost) {
            delete f.stances[def.id];
            f.lockedUntil[def.id] = this.time + R.TIMING.reraiseDelay * R.controlFactor(f.stats.control);
            this.addLog(`${f.name} runs out of madra; ${def.name} drops.`, 'warn', f.index);
          } else {
            this.spend(f, cost, this.path(f).selfBurn);
          }
        }
      }
      this.time += step;
      remaining -= step;
    }
    this.time = t;
  }

  advance() {
    while (!this.prompt && !this.result) {
      const ev = this.events.reduce((m, e) => (!m || e.time < m.time ? e : m), null);
      const fNext = this.fighters.reduce((m, f) => (!m || f.nextTurn < m.nextTurn ? f : m), null);
      if (ev && ev.time <= fNext.nextTurn + EPS) {
        this.advanceTo(ev.time);
        if (this.checkEnd()) return;
        this.events = this.events.filter((e) => e !== ev);
        this.processEvent(ev);
      } else {
        this.advanceTo(fNext.nextTurn);
        if (this.checkEnd()) return;
        this.prompt = { kind: 'turn', fighter: fNext.index };
        this.decision++;
      }
      if (this.checkEnd()) return;
    }
  }

  processEvent(ev) {
    const f = this.fighters[ev.actor];
    const o = this.opponent(f);
    const a = ev.action;
    if (a.kind === 'move') {
      f.moving = null;
      const nd = Math.min(2, Math.max(0, this.distance + a.dir));
      if (nd === this.distance) {
        this.addLog(`${f.name} finishes moving, but the range is already ${R.RANGES[nd]}.`, 'dim', f.index);
      } else {
        this.distance = nd;
        this.addLog(`${f.name} arrives: now at ${R.RANGES[nd]} range.`, '', f.index);
      }
      return;
    }
    if (a.kind === 'piece') {
      // The wind-up only finishes with its last piece.
      if (a.n === a.of) f.windups = f.windups.filter((w) => !(w.eventIds || []).includes(ev.id));
      this.formPiece(f, this.tech(f, a.id), a.madra, a.n, a.of);
      return;
    }
    const done = f.windups.find((w) => w.eventId === ev.id);
    const boost = done ? done.boost : 0;
    f.windups = f.windups.filter((w) => w !== done);

    if (a.kind === 'forged') {
      const hp = Math.round(a.madra * ((this.crownTech(f) || {}).sizeMult || 1));
      f.constructs.push({ id: `c${this.nextId++}`, kind: 'star', name: `Star (${a.madra})`, hp, maxHp: hp, madra: a.madra, range: 2 });
      this.addLog(`${f.name}'s Crown gains a ${a.madra}-madra star: ${this.stars(f).length} overhead.`, '', f.index);
      return;
    }
    if (a.kind === 'stance') {
      f.stances[a.id] = { raisedAt: this.time };
      this.addLog(`${f.name}'s ${this.tech(f, a.id).name} is up.`, '', f.index);
      return;
    }

    const profile0 = a.profile;
    if (!profile0.target && !profile0.ranges.includes(this.distance)) {
      this.addLog(`${f.name}'s ${profile0.name} lands, but ${o.name} is out of range.`, 'miss', f.index);
      return;
    }
    if (a.kind === 'pulse') {
      const factor = R.blockCostFactor(1) * (profile0.pure ? 2 : 1);
      if (this.pulseTargets(o, profile0.madra, profile0.ranges).length && this.maxMadra(o) >= factor) {
        this.prompt = { kind: 'reaction', fighter: o.index, attack: { attacker: f.index, profile: profile0, hits: 1 } };
        this.decision++;
        return;
      }
      this.applyPulse(f, o, profile0, 0);
      return;
    }
    if (a.kind === 'disrupt' && profile0.area) {
      this.addLog(`${f.name}'s ${profile0.name} washes over ${o.name}.`, 'hit', f.index);
      this.disrupt(o, profile0);
      return;
    }

    // Aimed at a construct: rolls against Defense 10. The owner may reinforce it (a block).
    if (profile0.target) {
      const c = o.constructs.find((x) => x.id === profile0.target);
      if (!c) {
        this.addLog(`${f.name}'s ${profile0.name} lands where its target used to be.`, 'miss', f.index);
        return;
      }
      if (!profile0.ranges.includes(this.constructRange(c))) {
        this.addLog(`${f.name}'s ${profile0.name} can't reach ${o.name}'s ${c.name}.`, 'miss', f.index);
        return;
      }
      if (this.maxMadra(o) >= 1) {
        this.prompt = { kind: 'reaction', fighter: o.index, attack: { attacker: f.index, profile: profile0, hits: profile0.hits, construct: c.id } };
        this.decision++;
        return;
      }
      this.resolveConstructAttack(f, o, profile0, c, 0);
      return;
    }

    let profile = profile0;
    if (boost > 0) {
      profile = { ...profile, damage: profile.damage + boost };
      this.addLog(`${f.name}'s ${profile.name} is boosted by ${fmt(boost)} from Black Flame spent while it built up.`, '', f.index);
    }
    const hits = this.hitsAgainst(f, o, profile);
    this.prompt = { kind: 'reaction', fighter: o.index, attack: { attacker: f.index, profile, hits } };
    this.decision++;
  }

  resolveConstructAttack(att, owner, prof, c, blockDR) {
    const roll = this.rollHit(att, CONSTRUCT_DEFENSE, { ...prof, bestRange: prof.bestRange - (this.constructRange(c) - this.distance) });
    if (!roll.hit) {
      this.addLog(`${att.name}'s ${prof.name} misses ${owner.name}'s ${c.name}. ${roll.text}`, 'miss', att.index);
      return;
    }
    const per = Math.max(0, Math.round(this.constructDamage(prof) - blockDR));
    this.damageConstruct(owner, c, per * prof.hits, `${att.name}'s ${prof.name}`, roll.text);
  }

  formPiece(f, t, madra, n, of) {
    let b = this.barrier(f);
    if (!b) {
      b = { id: `c${this.nextId++}`, kind: 'barrier', name: 'Oathsign barrier', hp: 0, maxHp: 0 };
      f.constructs.push(b);
    }
    b.hp += madra * 2 * (t.sizeMult || 1);
    b.maxHp = Math.max(b.maxHp, b.hp);
    this.addLog(`${f.name}'s Oathsign barrier builds: ${fmt(b.hp)} HP (piece ${n}/${of}).`, n === of ? '' : 'dim', f.index);
  }

  // Offer or withdraw a draw. When both fighters are offering at once, the fight ends in a draw.
  setDrawOffer(index, on) {
    if (this.result || this.drawOffers[index] === on) return;
    const f = this.fighters[index];
    this.drawOffers[index] = on;
    this.addLog(on ? `${f.name} offers a draw.` : `${f.name} withdraws the draw offer.`, 'dim', index);
    if (this.drawOffers.every(Boolean)) {
      this.result = { draw: true, agreed: true };
      this.addLog('Both fighters agree to a draw.', 'system');
      this.prompt = { kind: 'over' };
      this.decision++;
    }
  }

  checkEnd() {
    if (this.result) return true;
    const down = this.fighters.filter((f) => f.health <= 0 || f.spirit <= 0);
    if (!down.length) return false;
    if (down.length === 2) {
      this.result = { draw: true };
      this.addLog('Both fighters fall.', 'system');
    } else {
      const loser = down[0];
      const winner = this.opponent(loser);
      const how = loser.health <= 0 ? 'health' : 'spirit';
      this.result = { winner: winner.index };
      this.addLog(`${loser.name} falls (${how} gone). ${winner.name} wins.`, 'system');
    }
    this.prompt = { kind: 'over' };
    this.decision++;
    return true;
  }

  // ---------- queue view ----------
  upcoming() {
    const items = [];
    for (const f of this.fighters) {
      const acting = this.prompt && this.prompt.fighter === f.index && this.prompt.kind === 'turn';
      // Keys stay the same while an item is waiting, so the timeline can animate it between updates.
      items.push({ key: `turn:${f.index}:${Math.round(f.nextTurn * 1000)}`, time: f.nextTurn, label: acting ? `${f.name} acts now` : `${f.name}'s next turn`, who: f.index, kind: 'turn', type: 'turn' });
    }
    for (const e of this.events) {
      const f = this.fighters[e.actor];
      const k = e.action.kind;
      const label = k === 'move' ? `finishes moving ${e.action.dir < 0 ? 'in' : 'away'}`
        : k === 'stance' ? `${this.tech(f, e.action.id).name} is up`
        : k === 'piece' ? `barrier piece ${e.action.n}/${e.action.of} forms`
        : k === 'forged' ? `Crown star (${e.action.madra}) forms`
        : `${e.action.profile.name} lands`;
      const type = k === 'move' ? 'move' : k === 'stance' ? 'stance' : k === 'piece' || k === 'forged' ? 'construct' : 'attack';
      items.push({ key: `ev:${e.id}`, time: e.time, label: `${f.name}: ${label}`, who: e.actor, kind: 'resolve', type });
    }
    for (const f of this.fighters) {
      for (const def of this.activeStances(f)) {
        const t = this.nextBuildUp(f, def);
        const n = this.buildUp(f, def) + 1;
        if (t != null) items.push({ key: `bu:${f.index}:${def.id}:${n}`, time: t, label: `${f.name}: ${def.name} builds up (${n})`, who: f.index, kind: 'resolve', type: 'buildup' });
      }
    }
    return items.sort((a, b) => a.time - b.time);
  }
}

export { fmt, pct };
