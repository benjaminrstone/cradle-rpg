// Fight engine: one shared initiative queue, wind-ups, reactions, upkeep, interrupts,
// Forged constructs, and three damage types (physical, technique, spiritual).
// Turn choices are worked out in plans.js.
import * as R from './rules.js';
import * as A from './arena.js';
import { PATHS } from './data.js';
import { fmt, pct } from './format.js';
import { PLANS, TURN } from './plans.js';

const EPS = 1e-9;
const { STAR, CONSTRUCT_DEFENSE } = R;

export class Game {
  constructor(defs, rng = Math.random) {
    this.rng = rng;
    this.time = 0;
    this.arena = A.ARENA;
    this.events = [];
    this.log = [];
    this.nextId = 1;
    this.prompt = null;
    this.result = null;
    this.decision = 0; // counts every new decision point, so outside moves can't be applied twice
    this.drawOffers = [false, false]; // the fight ends in a draw when both fighters are offering one
    this.history = [];                // turns taken and events resolved, for the whole-fight queue view
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
      pos: { ...this.arena.starts[i] }, // where the fighter stands (the start of a move in progress)
      moving: null,       // move in progress: { start, end, from, path: [points after from] }
      constructs: [],     // Forged constructs: { id, kind, name, hp, maxHp, madra? }
      seen: [],           // technique ids this fighter has used, so the opponent can look them up
    }));
    this.addLog(`The fight begins in the ${this.arena.name}, ${fmt(this.gap())} m apart (${R.RANGES[this.band()]} range).`, 'system');
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
  // A save too old to restore (from before the arena, the fight history or technique tracking)
  // throws, and the app starts a new fight instead.
  static restore(state, defs, rng = Math.random) {
    if (!state.arena || !state.history || state.fighters.some((f) => !f.seen)) throw new Error('This fight was saved by an older version of the game.');
    const g = Object.create(Game.prototype);
    Object.assign(g, state, { rng });
    // Fights saved on an older arena layout: stand the fighters on the current arena's start
    // line, as far apart as they were, and drop any move in progress.
    if (JSON.stringify(g.arena) !== JSON.stringify(A.ARENA)) {
      const gap = Math.min(30, A.dist(g.pos(state.fighters[0]), g.pos(state.fighters[1])));
      g.arena = A.ARENA;
      const [a, b] = g.arena.starts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      state.fighters.forEach((f, i) => { f.pos = { x: mid.x + (i ? 1 : -1) * gap / 2, y: mid.y }; f.moving = null; });
      g.events = g.events.filter((e) => e.action.kind !== 'move');
    }
    g.fighters = state.fighters.map((f) => {
      const def = defs.find((d) => d.id === f.id);
      const out = def ? { ...f, ...def, stats: { ...def.stats } } : f;
      out.health = Math.min(out.health, out.stats.health);
      out.spirit = Math.min(out.spirit, out.stats.spirit);
      out.madra = Math.min(out.madra, out.stats.pool);
      return out;
    });
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

  // extra: Speed from a ring that isn't formed yet, for previews.
  speed(f, extra = 0) {
    let s = f.stats.speed + extra + this.rings(f).reduce((sum, c) => sum + c.speedBonus, 0);
    for (const def of this.activeStances(f)) {
      if (def.speedMult) s *= def.speedMult;
      if (def.buildUp) s *= 1 + def.buildUp.speed * this.buildUp(f, def);
    }
    return s;
  }

  physBonus(f) {
    return this.activeStances(f).reduce((sum, d) => sum + (d.physBonus || 0), 0)
      + this.rings(f).reduce((sum, c) => sum + c.meleeBonus, 0);
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
  rings(f) { return f.constructs.filter((c) => c.kind === 'ring'); }

  // ---------- positions ----------
  // Where a fighter is at time t, partway along a move in progress.
  pos(f, t = this.time) {
    const m = f.moving;
    if (!m) return f.pos;
    const k = Math.min(1, Math.max(0, (t - m.start) / Math.max(EPS, m.end - m.start)));
    return A.along(m.from, m.path, k * A.pathLength(m.from, m.path));
  }

  gap(t = this.time) { return A.dist(this.pos(this.fighters[0], t), this.pos(this.fighters[1], t)); }
  band(t = this.time) { return A.bandOf(this.gap(t)); }

  // Where a construct is. Crown stars hang high over their owner (always Far, over every obstacle);
  // barriers and rings sit on their owner.
  constructPos(owner, c, t = this.time) {
    const p = this.pos(owner, t);
    return c.kind === 'star' ? { x: p.x, y: p.y, z: A.STAR_HEIGHT } : p;
  }

  ownerOf(c) { return this.fighters.find((f) => f.constructs.includes(c)); }

  // From one point to another: the distance, its range band, and the obstacle in the way, if any.
  sight(from, to) {
    const dist = A.dist(from, to);
    return { dist, band: A.bandOf(dist), blockedBy: A.blocker(this.arena, from, to) };
  }

  // Can something with these ranges get from `from` to `to`? Overhead attacks (Crown stars) always can.
  reaches(prof, from, to) {
    if (prof.overhead) return true;
    const s = this.sight(from, to);
    return prof.ranges.includes(s.band) && !s.blockedBy;
  }

  // Range check for an attack: what counts is where both fighters are when it lands. An attack
  // that won't reach can still be chosen; it just gets a warning.
  rangeGate(f, ranges, landAt, shortReason) {
    const o = this.opponent(f);
    const now = this.sight(this.pos(f), this.pos(o));
    const later = this.sight(this.pos(f, landAt), this.pos(o, landAt));
    const ok = ranges.includes(later.band);
    const changes = later.band !== now.band;
    let warning = null;
    if (!ok) warning = `${changes ? `Out of range when it lands (${R.RANGES[later.band]} by then)` : shortReason}: wasted unless the range changes`;
    else if (later.blockedBy) warning = `A ${later.blockedBy.name} is in the way${landAt > this.time + EPS && now.blockedBy !== later.blockedBy ? ' when it lands' : ''}: wasted unless someone moves`;
    return {
      warning,
      note: changes && ok ? `Range will be ${R.RANGES[later.band]} when it lands (t=${fmt(landAt)})` : null,
    };
  }

  constructGate(f, ranges, c, shortReason) {
    const s = this.sight(this.pos(f), this.constructPos(this.ownerOf(c), c));
    const warning = !ranges.includes(s.band) ? `${shortReason}: can't reach ${c.name}`
      : s.blockedBy ? `A ${s.blockedBy.name} is in the way of ${c.name}` : null;
    return { warning, note: null };
  }

  // The route a move would take: walking (around obstacles) or a straight flight up to `reach`.
  // `to` is a point ("x:y") or "toward" / "away" (from the opponent).
  planMove(f, to, { reach = Infinity, flight = false } = {}) {
    const from = this.pos(f);
    const o = this.opponent(f);
    const dest = to === 'toward' || to === 'away' ? A.spotFrom(this.arena, from, this.pos(o), to, reach, flight) : typeof to === 'string' ? A.parsePoint(to) : to;
    if (!dest) return { error: 'Choose where to go: click the field' };
    if (!A.standable(this.arena, dest)) return { error: "Can't stand there", dest };
    if (A.dist(from, dest) < 0.05) return { error: 'Already there', dest };
    const path = flight ? A.straight(this.arena, from, dest) : A.route(this.arena, from, dest);
    if (!path) return { error: flight ? 'An obstacle is in the way of a straight flight' : 'No way through', dest };
    const length = A.pathLength(from, path);
    if (length > reach + EPS) return { error: `Too far: it reaches ${fmt(reach)} m (that's ${fmt(length)} m)`, dest };
    return { from, path, dest, length };
  }

  // ---------- area attacks ----------
  // An area attack is a circle. Its centre depends on the technique's aim:
  //   self:    on the attacker, wherever they are when it lands (the default);
  //   release: built up, then released at a target: on wherever that target is when it lands;
  //   set:     built up at a spot picked when it starts, within the technique's bands, in sight.
  // Its radius grows with madra, up to the edge of its farthest band (centred on you) or
  // AIMED_AREA_MAX (aimed). It hits everything inside with a clear line from the centre.
  areaRadius(t, madra) {
    const cap = (t.aim || 'self') === 'self' ? A.BAND_EDGES[Math.max(...t.ranges)] : A.AIMED_AREA_MAX;
    return Math.min(cap, (t.radius ?? 4) + (t.radiusPerMadra ?? 0.5) * madra);
  }

  // Fill in where an area attack is aimed: the spot for `set` ("x:y", or "them" for the
  // opponent's spot now), the target for `release` (a construct id, or '' for the opponent).
  // Returns an error message, or null.
  aimArea(f, prof, target) {
    if (prof.aim === 'release') {
      prof.aimAt = target || '';
      prof.target = '';
      return null;
    }
    if (prof.aim !== 'set') return null;
    prof.target = '';
    const plan = this.planArea(f, prof, target);
    if (plan.error) return plan.error;
    prof.centre = plan.centre;
    return null;
  }

  planArea(f, prof, to) {
    const o = this.opponent(f);
    const raw = to === 'them' ? this.pos(o) : typeof to === 'string' ? A.parsePoint(to) : to;
    if (!raw) return { error: 'Choose where: click the field' };
    const centre = { x: Math.round(raw.x * 10) / 10, y: Math.round(raw.y * 10) / 10 };
    if (centre.x < 0 || centre.y < 0 || centre.x > this.arena.width || centre.y > this.arena.height) return { error: 'Outside the arena', centre };
    if (this.arena.obstacles.some((r) => centre.x > r.x && centre.x < r.x + r.w && centre.y > r.y && centre.y < r.y + r.h)) return { error: 'Inside an obstacle', centre };
    const s = this.sight(this.pos(f), centre);
    if (!prof.ranges.includes(s.band)) return { error: `Too far: it reaches ${prof.ranges.map((r) => R.RANGES[r]).join('/')} (that's ${fmt(s.dist)} m, ${R.RANGES[s.band]})`, centre };
    if (s.blockedBy) return { error: `A ${s.blockedBy.name} is in the way`, centre };
    return { centre, dist: s.dist };
  }

  // Where an area attack's centre is at time t.
  areaCentre(f, prof, t = this.time) {
    if (prof.aim === 'set' && prof.centre) return prof.centre;
    if (prof.aim === 'release') {
      const o = this.opponent(f);
      const c = prof.aimAt ? o.constructs.find((x) => x.id === prof.aimAt) : null;
      if (c) return this.constructPos(o, c, t);
      return this.pos(o, t);
    }
    return this.pos(f, t);
  }

  // Is a point inside the circle, with a clear line from its centre?
  areaCatch(centre, radius, p) {
    const dist = A.dist(centre, p);
    const blockedBy = A.blocker(this.arena, centre, p);
    return { inside: dist <= radius + EPS && !blockedBy, dist, blockedBy, outside: dist > radius + EPS };
  }

  // Would an area attack landing at time t catch the opponent? For a release, the target must
  // also be within the technique's bands and in sight when it lands.
  areaLands(f, prof, t) {
    const o = this.opponent(f);
    if (prof.aim === 'release') {
      const c = prof.aimAt ? o.constructs.find((x) => x.id === prof.aimAt) : null;
      if (prof.aimAt && !c) return { ok: false, out: true, why: 'its target is gone' };
      const s = this.sight(this.pos(f, t), c ? this.constructPos(o, c, t) : this.pos(o, t));
      if (!prof.ranges.includes(s.band)) return { ok: false, out: true, why: `${c ? c.name : o.name} is out of range (${R.RANGES[s.band]})` };
      if (s.blockedBy) return { ok: false, out: true, why: `a ${s.blockedBy.name} is in the way` };
    }
    const centre = this.areaCentre(f, prof, t);
    const k = this.areaCatch(centre, prof.radius, this.pos(o, t));
    if (k.inside) return { ok: true, centre, dist: k.dist };
    return { ok: false, centre, dist: k.dist, why: k.outside ? `${o.name} is outside it (${fmt(k.dist)} m from the centre)` : `${o.name} is sheltered by a ${k.blockedBy.name}` };
  }

  areaGate(f, prof, landAt) {
    const o = this.opponent(f);
    const l = this.areaLands(f, prof, landAt);
    const later = landAt > this.time + EPS;
    const near = later && !(prof.aim === 'release' && !prof.aimAt);
    if (l.ok) return { warning: null, note: near ? `${o.name} will be ${fmt(l.dist)} m from the centre when it lands (t=${fmt(landAt)})` : null };
    return { warning: `${later ? 'When it lands, ' : ''}${l.why}: ${l.out ? 'wasted' : 'it only hits what is inside'}, unless someone moves`, note: null };
  }

  areaLine(f, prof) {
    const o = this.opponent(f);
    const r = `${fmt(prof.radius)} m`;
    if (prof.aim === 'set') return `Forms at (${fmt(prof.centre.x)}, ${fmt(prof.centre.y)}): everything within ${r} of it, wherever anyone moves`;
    if (prof.aim === 'release') {
      const c = prof.aimAt ? o.constructs.find((x) => x.id === prof.aimAt) : null;
      return `Released at ${c ? `${o.name}'s ${c.name}` : o.name} when it lands (${prof.ranges.map((x) => R.RANGES[x]).join('/')}): everything within ${r} of ${c ? 'it' : 'them'}`;
    }
    return `Hits everything within ${r} of you when it lands, in sight`;
  }

  // An area attack also hits the defender's constructs inside it (barriers only soak).
  areaConstructHits(att, def, prof, hits) {
    const from = prof.centre || this.pos(att);
    for (const c of [...def.constructs]) {
      if (c.kind === 'barrier') continue;
      const p = this.constructPos(def, c);
      const ok = prof.radius != null ? this.areaCatch(from, prof.radius, p).inside : this.reaches(prof, from, p);
      if (ok) this.damageConstruct(def, c, this.constructDamage(prof) * hits, prof.name);
    }
  }

  // ---------- log ----------
  addLog(text, cls = '', who = null) {
    this.log.push({ time: this.time, text, cls, who });
  }

  // ---------- madra ----------
  spend(f, amount, burn) {
    f.madra = Math.max(0, f.madra - amount);
    if (burn) {
      const b = R.burn(amount);
      f.health -= b.health;
      f.spirit -= b.spirit;
      // Fire and destruction in the area feed a boostable wind-up (Void Dragon's Dance).
      for (const w of f.windups) if (w.boostPerMadra) w.boost += amount * w.boostPerMadra;
    }
  }

  // Most actions are limited by channel cap; Ruler techniques draw on aura over their long
  // build-up and are limited only by the madra you have.
  // The most madra-power a technique can be used at. A technique with costMult spends that many
  // madra per point of power, and what it spends is what the channel cap limits.
  maxMadra(f, t = null) {
    const limit = t && t.ruler ? f.madra : Math.min(f.stats.cap, f.madra);
    return Math.max(0, Math.floor(limit / ((t && t.costMult) || 1)));
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
      ...(t.area ? { aim: t.aim || 'self', radius: this.areaRadius(t, madra) } : {}),
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
      overhead: true, // they come down from above: any range, over every obstacle
      ownerName: owner.name,
      pure: !!this.path(owner).pureMadra,
    };
  }

  hitsAgainst(attacker, defender, profile) {
    if (!profile.bladeHits) return profile.hits;
    let hits = 1;
    if (this.hasTrait(attacker, 'swordArms') && this.band() === 0) hits += 1;
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

  // Range penalty between the fighters (or at a given band, for a construct).
  rangePenalty(prof, band = this.band()) {
    return prof.area ? 0 : R.rangePenalty(band, prof.bestRange);
  }

  // Area attacks don't roll, so they always hit.
  hitChance(attacker, defender, prof, dodging = false, hitIndex = 0) {
    if (prof.area) return 1;
    const need = this.defense(attacker, defender, dodging, hitIndex) - attacker.stats.precision - prof.toHit + this.rangePenalty(prof);
    return R.chanceAtLeast(need);
  }

  constructHitChance(attacker, prof, c) {
    if (prof.area) return 1;
    const pen = R.rangePenalty(this.sight(this.pos(attacker), this.constructPos(this.ownerOf(c), c)).band, prof.bestRange);
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
      { key: 'move', label: 'Move', group: 'basic', point: { reach: null } },
      {
        key: 'wait', label: 'Wait', group: 'basic',
        slider: { label: 'Ticks', min: R.TIMING.waitMin, max: R.TIMING.waitMax, step: 0.5, initial: R.TIMING.waitDefault },
      },
    ];
    // Single-target attacks can be aimed at the opponent or one of their (non-barrier) constructs
    // that the attack can reach.
    const withTargets = (opt, ranges) => {
      const where = (c) => this.sight(this.pos(f), this.constructPos(o, c));
      const targets = o.constructs.filter((c) => c.kind !== 'barrier' && ranges.includes(where(c).band) && !where(c).blockedBy)
        .map((c) => ({ id: c.id, label: `${o.name}'s ${c.name} (${fmt(c.hp)} HP, ${c.kind === 'star' ? 'overhead' : R.RANGES[where(c).band]})` }));
      return targets.length ? { ...opt, targets: [{ id: '', label: o.name }, ...targets] } : opt;
    };
    opts[0] = withTargets(opts[0], [0]);

    for (const t of this.techList(f)) {
      if (t.kind === 'stance' && f.stances[t.id]) {
        opts.push({ key: `drop:${t.id}`, label: `Drop ${t.name}`, group: 'drop' });
        continue;
      }
      const cardInfo = { card: t.card, cardTitle: t.cardTitle || t.name, cardType: t.cardType, cardDesc: t.cardDesc };
      if (t.kind === 'launch') {
        opts.push({ key: t.id, label: t.label || t.name, group: 'path', type: t.type, desc: t.desc, point: { reach: this.launchReach(t) }, ...cardInfo });
        continue;
      }
      let opt = { key: t.id, label: t.label || t.name, group: 'path', type: t.type, desc: t.desc, ...cardInfo };
      if (t.kind === 'command') {
        const n = this.stars(f).length;
        if (n >= 1) opt.slider = { label: 'Stars', min: 1, max: n, step: 1, initial: n };
        opts.push(opt);
        continue;
      }
      const max = this.maxMadra(f, t);
      if ((t.kind === 'attack' || t.kind === 'construct' || t.kind === 'forge' || t.kind === 'pulse') && max >= (t.minMadra || 1)) {
        const min = t.minMadra || 1;
        opt.slider = { label: 'Madra', min, max, step: 1, initial: Math.max(min, Math.min(10, max)) };
      }
      if (t.kind === 'attack' && (!t.area || t.aim === 'release')) opt = withTargets(opt, t.ranges);
      if (t.kind === 'attack' && t.area && t.aim === 'set') opt.point = { area: true };
      opts.push(opt);
    }
    return opts;
  }

  // ---------- turn plans ----------
  // Everything about one turn choice, worked out once: what the preview says, what it costs,
  // when the fighter's next turn comes, what goes on the queue, and what it starts.
  // preview(), project() and act() all read from the same plan (one planner per kind, PLANS below).
  //   enabled, reason, warning, lines  the preview
  //   cost      madra spent up front (Black Flame burns its user for it)
  //   nextTurn  when the fighter acts again
  //   queue     ghost queue items, in order; TURN marks the fighter's next turn
  //   path      a move's route, for the field
  //   project   (p) => adds the expected effect on the bars to a projection
  //   apply     () => starts it: wind-ups, events, log (act pays the cost and sets nextTurn)
  //   free      a free action (dropping a stance): act applies it and the turn goes on
  plan(f, key, amount = 0, target = '') {
    const o = this.opponent(f);
    const t = this.tech(f, key);
    const kind = key === 'strike' || key === 'move' || key === 'wait' ? key : key.startsWith('drop:') ? 'drop' : t.kind;
    const ctx = { key, t, amount, target, o, spd: this.speed(f), tc: target ? o.constructs.find((c) => c.id === target) : null };
    return PLANS[kind](this, f, ctx);
  }

  // Preview of a turn choice: { enabled, reason, warning, lines }
  preview(f, key, amount = 0, target = '') {
    const { enabled, reason, warning, lines } = this.plan(f, key, amount, target);
    return { enabled, reason, warning, lines };
  }

  // The madra a scaling technique would use for a slider amount.
  madraFor(f, t, amount) {
    return Math.min(Math.max(t.minMadra || 1, Math.round(amount)), this.maxMadra(f, t));
  }

  reraiseDelay(f) { return R.TIMING.reraiseDelay * R.controlFactor(f.stats.control); }

  // A preview line for an attack: damage after the target's reduction, and the chance to hit.
  attackLines(f, prof, hits, tc = null) {
    const o = this.opponent(f);
    if (tc) {
      const dmg = this.constructDamage(prof);
      return `${hits > 1 ? hits + ' hits × ' : ''}${dmg} damage to ${tc.name} · ${pct(this.constructHitChance(f, prof, tc))} to hit`;
    }
    const res = this.hitResult(f, o, prof);
    const soak = res.absorbed ? ` (barrier soaks ${fmt(res.absorbed)})` : '';
    const where = res.track === 'spirit' ? ' to spirit' : '';
    return `${hits > 1 ? hits + ' hits × ' : ''}${fmt(prof.damage)} damage (${res.dmg}${where} after reduction${soak}) · ${this.hitText(f, o, prof)}`;
  }

  // The end of an attack's preview: sharpness, Black Flame boost, and the burn.
  attackNotes(f, t, prof, madra) {
    const lines = [];
    if (prof.sharpness) lines.push(`Sharpness ${prof.sharpness}`);
    if (t.boostPerMadra) lines.push(`+${t.boostPerMadra} damage per Black Flame madra you spend while it winds up`);
    if (this.path(f).selfBurn) { const b = R.burn(madra); lines.push(`Burns you for ${fmt(b.health)} health and ${fmt(b.spirit)} spirit`); }
    return lines;
  }

  // " at Yerin's Star (5)" when a target is one of the opponent's constructs.
  aimedAt(f, target) {
    const o = this.opponent(f);
    const c = target ? o.constructs.find((x) => x.id === target) : null;
    return c ? ` at ${o.name}'s ${c.name}` : '';
  }

  launchReach(t) { return t.reach || A.LAUNCH_REACH; }

  // Preview lines for a move: where to, how far, when you arrive, and the range then.
  moveLines(f, plan, travel, nextIn) {
    const o = this.opponent(f);
    const arrive = this.time + travel;
    const gap = A.dist(plan.dest, this.pos(o, arrive));
    return [
      `To (${fmt(plan.dest.x)}, ${fmt(plan.dest.y)}): ${fmt(plan.length)} m${plan.path.length > 1 ? ' around obstacles' : ''} · arrives t=${fmt(arrive)} · next turn ${nextIn > travel + EPS ? `in ${fmt(nextIn)}` : 'then'}`,
      `${o.name} will be ${fmt(gap)} m away (${R.RANGES[A.bandOf(gap)]})${o.moving ? ` counting their move` : ''}`,
      'Attacks that land while you move are aimed at where you are by then',
    ];
  }

  // Madra Pulse: what it would cancel on f at a given strength (madra, less blocks). It cancels
  // wind-ups, stances and constructs (in range of the opponent) that cost at most half its strength.
  pulseTargets(f, strength, ranges) {
    const from = this.pos(this.opponent(f));
    const limit = strength / 2 + EPS;
    const out = [];
    for (const w of f.windups) {
      if (this.isPlainStrike(w)) continue;
      if (w.madra <= limit) out.push({ kind: 'windup', ref: w, name: `${w.label} (winding up)`, cost: w.madra });
    }
    for (const s of this.activeStances(f)) if (s.raiseCost <= limit) out.push({ kind: 'stance', ref: s, name: s.name, cost: s.raiseCost });
    for (const c of f.constructs) {
      const cost = c.kind === 'barrier' ? c.hp / 2 : c.madra;
      if (this.reaches({ ranges }, from, this.constructPos(f, c)) && cost <= limit) out.push({ kind: 'construct', ref: c, name: c.name, cost });
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
    const p = this.plan(f, key, amount, target);
    if (!p.enabled || p.free) return null;
    const o = this.opponent(f);
    const out = { deltas: [{}, {}], notes: ['', ''], queue: [], replacesTurn: f.index };
    const add = (who, k, v) => { out.deltas[who][k] = (out.deltas[who][k] || 0) + v; };
    if (p.cost != null) {
      add(f.index, 'madra', -p.cost);
      if (this.path(f).selfBurn) { const b = R.burn(p.cost); add(f.index, 'health', -b.health); add(f.index, 'spirit', -b.spirit); }
    }
    // Queue item types: turn, attack, move, stance, construct, buildup (each gets its own marker shape).
    for (const q of p.queue) {
      out.queue.push(q === TURN
        ? { time: p.nextTurn, label: `${f.name}'s next turn`, who: f.index, kind: 'turn', type: 'turn', ghost: true }
        : { time: q.time, label: `${f.name}: ${q.label}`, who: f.index, kind: 'resolve', type: q.type, ghost: true });
    }
    if (p.path) out.path = p.path;
    // The expected damage of an attack on the opponent, if it lands.
    const hit = (prof, hits) => {
      if (target) { out.notes[o.index] = 'aimed at a construct'; return; }
      const res = this.hitResult(f, o, prof);
      add(o.index, res.track, -res.dmg * hits);
      out.notes[o.index] = prof.area
        ? `${hits > 1 ? `${hits} hits, ` : ''}no roll`
        : `if ${hits > 1 ? `all ${hits} hit` : 'it hits'} (${pct(this.hitChance(f, o, prof))}${hits > 1 ? ' each' : ''})`;
    };
    if (p.project) p.project({ out, add, hit });
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
    const block = (chance) => ({ chance, factor, hits: a.hits, maxBase: Math.floor(this.maxMadra(def) / factor), delay: R.TIMING.blockDelay });
    const c = a.construct ? def.constructs.find((x) => x.id === a.construct) : null;
    if (c) {
      // Defending a construct: no dodge or redirect, only reinforcing it with madra (a block).
      const chance = this.constructHitChance(att, a.profile, c);
      const dmg = this.constructDamage(a.profile);
      return {
        construct: c,
        take: { chance, damage: dmg, damageText: `${dmg}` },
        dodge: { available: false, chance, bonus: 0, reduction: 0, delay: 0 },
        block: block(chance),
        redirect: { available: false, shown: false, cost: 0 },
      };
    }
    const redirectCost = Math.ceil((a.profile.madra || 0) / 2);
    const canRedirect = this.stanceFlag(def, 'redirect') && !a.profile.area && a.profile.dtype !== 'physical'
      && !a.profile.fromConstruct && (a.profile.madra || 0) > 0;
    const chance = this.hitChance(att, def, a.profile);
    const each = this.hitProfiles(a.profile, a.hits).map((hp) => this.hitResult(att, def, hp).dmg);
    const bonus = R.dodgeBonus(this.speed(def), this.speed(att));
    return {
      take: { chance, damage: each[0], damageText: a.profile.hitDamages ? each.join(' + ') : `${each[0]}` },
      dodge: {
        available: a.profile.effect !== 'pulse',
        chance: this.hitChance(att, def, a.profile, true),
        // Chance to hit for each hit of the attack while dodging (the dodge tapers off).
        chances: Array.from({ length: a.hits }, (_, i) => this.hitChance(att, def, a.profile, true, i)),
        bonuses: Array.from({ length: a.hits }, (_, i) => Math.max(0, bonus - i)),
        bonus,
        reduction: a.profile.area ? R.areaDodgeReduction(bonus) : 0,
        delay: R.physTime(R.TIMING.dodge, this.speed(def)),
      },
      block: block(chance),
      redirect: { available: canRedirect && def.madra >= redirectCost, shown: canRedirect, cost: redirectCost },
    };
  }

  // The base madra of a block (before the multi-hit and pure-madra factors), within what the defender can channel.
  blockAmount(ro, blockBase) {
    return Math.min(Math.max(0, Math.round(blockBase)), ro.block.maxBase);
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
    const pulse = a.profile.effect === 'pulse';
    const dodging = choice === 'dodge' || choice === 'dodgeBlock';
    const blocking = choice === 'block' || choice === 'dodgeBlock';
    // A pulse or an attack on a construct can only be blocked on its own, not with a dodge.
    const m = (pulse || ro.construct ? choice === 'block' : blocking) ? this.blockAmount(ro, blockBase) : 0;
    const madraCost = m * ro.block.factor;
    const blockDelay = m > 0 ? R.TIMING.blockDelay : 0;
    if (pulse) {
      const strength = Math.max(0, a.profile.madra - R.blockReduction(m));
      return {
        perHit: 0, total: 0, perHitText: null, track: 'health', absorbed: 0, hits: 1, chance: 1,
        madraCost, delay: blockDelay, interrupts: false, breaksStances: false,
        pulse: { strength, targets: this.pulseTargets(def, strength, a.profile.ranges) },
      };
    }
    if (ro.construct) {
      const per = Math.max(0, Math.round(ro.take.damage - R.blockReduction(m)));
      return {
        perHit: per, total: per * a.hits, perHitText: null, track: 'construct', absorbed: 0, hits: a.hits,
        chance: ro.take.chance, madraCost, delay: blockDelay,
        interrupts: false, breaksStances: false, construct: ro.construct,
      };
    }
    const each = this.hitProfiles(a.profile, a.hits).map((hp, i) => this.hitResult(att, def, hp, { dodging, blockDR: R.blockReduction(m), hitIndex: i }));
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
      madraCost,
      delay: (dodging ? ro.dodge.delay : 0) + blockDelay,
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
    const tk = this.tech(f, key) || {};
    const pointed = key === 'move' || tk.kind === 'launch' || (tk.area && tk.aim === 'set');
    if (target && !pointed && !o.constructs.some((c) => c.id === target)) target = '';
    const p = this.plan(f, key, amount, target);
    if (!p.enabled) return;
    if (p.free) { p.apply(); return; } // still their turn

    const what = key === 'strike' ? 'strikes' : key === 'move' ? 'moves' : key === 'wait' ? 'waits' : tk.label || tk.name || key;
    this.history.push({ key: `turn:${f.index}:${Math.round(f.nextTurn * 1000)}`, time: this.time, label: `${f.name}: ${what}`, who: f.index, kind: 'turn', type: 'turn' });
    if (!['strike', 'move', 'wait'].includes(key)) {
      const id = key.split(':')[0];
      if (!f.seen.includes(id)) f.seen.push(id);
    }
    if (p.cost != null) this.spend(f, p.cost, this.path(f).selfBurn);
    p.apply();
    f.nextTurn = p.nextTurn;
    this.prompt = null;
    this.advance();
  }

  startMove(f, plan, travel, via = '') {
    const ev = { id: this.nextId++, time: this.time + travel, type: 'resolve', actor: f.index, action: { kind: 'move', to: plan.dest, via } };
    this.events.push(ev);
    f.pos = { ...plan.from };
    f.moving = { start: this.time, end: ev.time, from: { ...plan.from }, path: plan.path.map((p) => ({ x: p.x, y: p.y })) };
    const where = `(${fmt(plan.dest.x)}, ${fmt(plan.dest.y)})`;
    this.addLog(`${f.name} ${via ? `uses ${via} to fly` : 'moves'} ${fmt(plan.length)} m to ${where} (arrives t=${fmt(ev.time)}).`, '', f.index);
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
    const pulse = a.profile.effect === 'pulse';
    const c = ro.construct;
    // A pulse or an attack on a construct can only be taken or blocked.
    if ((pulse || c) && choice !== 'take' && choice !== 'block') return;
    if (choice === 'redirect' && !ro.redirect.available) return;
    const dodging = choice === 'dodge' || choice === 'dodgeBlock';
    const blocking = choice === 'block' || choice === 'dodgeBlock';
    const m = blocking ? this.blockAmount(ro, blockBase) : 0;
    const cost = m * ro.block.factor;
    const dr = R.blockReduction(m);
    const payBlock = () => { this.spend(def, cost, false); def.nextTurn += R.TIMING.blockDelay; };

    if (choice === 'redirect') {
      this.spend(def, ro.redirect.cost, false);
      const back = { ...a.profile, name: `${a.profile.name} (redirected)`, target: '', redirected: true };
      this.events.push({ id: this.nextId++, time: this.time + 1, type: 'resolve', actor: def.index, action: { kind: 'attack', profile: back } });
      this.addLog(`${def.name} catches ${att.name}'s ${a.profile.name} in the Mantle and throws it back (${ro.redirect.cost} madra, lands t=${fmt(this.time + 1)}).`, 'hit', def.index);
    } else if (pulse) {
      if (m > 0) {
        payBlock();
        this.addLog(`${def.name} braces against the pulse with ${fmt(cost)} madra (−${fmt(dr)} strength).`, '', def.index);
      } else this.addLog(`${def.name} lets the pulse come.`, 'dim', def.index);
    } else if (c) {
      if (m > 0) {
        payBlock();
        this.addLog(`${def.name} reinforces ${c.name} with ${fmt(cost)} madra (−${fmt(dr)} damage${a.hits > 1 ? ' on each hit' : ''}).`, '', def.index);
      } else this.addLog(`${def.name} leaves ${c.name} to take it.`, 'dim', def.index);
    } else {
      if (dodging) {
        def.nextTurn += ro.dodge.delay;
        this.addLog(a.profile.area
          ? `${def.name} dodges (−${pct(ro.dodge.reduction)} area damage).`
          : `${def.name} dodges (+${ro.dodge.bonus} Defense).`, '', def.index);
      }
      if (m > 0) {
        payBlock();
        this.addLog(`${def.name} blocks with ${fmt(cost)} madra (−${fmt(dr)} damage on ${a.hits > 1 ? `each of ${a.hits} hits` : 'the hit'}).`, '', def.index);
      }
      if (!dodging && !blocking) this.addLog(`${def.name} lets it come.`, 'dim', def.index);
    }
    this.prompt = null;
    if (pulse) this.applyPulse(att, def, a.profile, dr);
    else if (c) this.resolveConstructAttack(att, def, a.profile, c, dr);
    else if (choice !== 'redirect') this.resolveAttack(att, def, a.profile, a.hits, dodging, dr);
    this.advance();
  }

  rollHit(att, defense, prof, pen = this.rangePenalty(prof)) {
    const [d1, d2] = R.roll2d6(this.rng);
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
    if (prof.area && prof.effect !== 'disrupt') this.areaConstructHits(att, def, prof, hits);
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
    this.dropStance(f, s.id);
    this.addLog(`${f.name}'s ${s.name} ${reason}.`, 'warn', f.index);
  }

  // However a stance comes down (dropped, broken, or out of madra), it can't be raised again
  // until the re-raise delay passes.
  dropStance(f, id) {
    delete f.stances[id];
    f.lockedUntil[id] = this.time + this.reraiseDelay(f);
  }

  // Disruption (Madra Pulse, Oathsign Seal): breaks wind-ups and stances, and constructs if it can.
  disrupt(f, prof, from = this.pos(this.opponent(f))) {
    this.interrupt(f);
    this.breakStances(f);
    if (prof.destroysConstructs) {
      const hit = f.constructs.filter((c) => this.reaches(prof, from, this.constructPos(f, c)));
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

  // What a queued event would do to its target if it landed now: damage after reduction,
  // chance to hit, and whether it breaks wind-ups or stances. Shown when hovering a wind-up.
  describeEvent(e) {
    if (!e) return '';
    const f = this.fighters[e.actor];
    const o = this.opponent(f);
    const a = e.action;
    const breaks = (list) => (list.some((r) => r.breaksStances) ? ` · breaks ${o.name}'s stances` : list.some((r) => r.interrupts) ? ` · breaks ${o.name}'s wind-ups` : '');
    if (a.kind === 'forged') {
      const res = this.hitResult(f, o, this.starProfile(f, a.madra));
      return `When dropped: ${res.dmg} spirit damage to ${o.name} · ${pct(this.hitChance(f, o, this.starProfile(f, a.madra)))} to hit${breaks([res])}`;
    }
    if (a.kind === 'stance') return `Raises ${this.tech(f, a.id).name}`;
    if (a.kind === 'ring') { const t = this.tech(f, a.id); return `+${t.speedBonus} Speed and +${t.meleeBonus} melee damage for ${f.name}`; }
    if (a.kind === 'piece') return `Adds ${fmt(a.madra * 2 * ((this.tech(f, a.id) || {}).sizeMult || 1))} HP to ${f.name}'s barrier`;
    if (a.kind === 'move') return '';
    const prof = a.profile;
    if (!prof) return '';
    const area = prof.radius != null ? this.areaLands(f, prof, e.time) : null;
    const landsIn = area ? area.ok : prof.target || prof.overhead ? true : this.reaches(prof, this.pos(f, e.time), this.pos(o, e.time));
    const out = landsIn ? '' : area ? ` · when it lands: ${area.why}` : ' · out of range or blocked when it lands';
    if (a.kind === 'pulse' || prof.effect === 'pulse') {
      const names = this.pulseTargets(o, prof.madra, prof.ranges).map((x) => x.name);
      return `Cancels ${names.length ? names.join(', ') : `nothing of ${o.name}'s right now`} unless ${o.name} blocks${out}`;
    }
    if (prof.effect === 'disrupt') return `${pct(this.hitChance(f, o, prof))} to hit · breaks ${o.name}'s wind-ups and stances${out}`;
    const w = f.windups.find((x) => x.eventId === e.id);
    const boosted = w && w.boost ? { ...prof, damage: prof.damage + w.boost } : prof;
    if (boosted.target) {
      const c = o.constructs.find((x) => x.id === boosted.target);
      return c ? `${this.constructDamage(boosted)} damage to ${o.name}'s ${c.name} (${fmt(c.hp)} HP) · ${pct(this.constructHitChance(f, boosted, c))} to hit` : '';
    }
    const hits = this.hitsAgainst(f, o, boosted);
    const each = this.hitProfiles(boosted, hits).map((hp) => this.hitResult(f, o, hp));
    const track = each[0].track === 'spirit' ? ' spirit' : '';
    const dmg = boosted.hitDamages || hits > 1 ? `${each.map((r) => r.dmg).join(' + ')}${track} damage` : `${each[0].dmg}${track} damage`;
    const roll = boosted.area ? 'area attack, no roll' : `${pct(this.hitChance(f, o, boosted))} to hit${hits > 1 ? ' each' : ''}`;
    return `${dmg} to ${o.name} after reduction · ${roll}${breaks(each)}${out}`;
  }

  // The same, for one of a fighter's wind-ups.
  describeWindup(w) {
    return this.describeEvent(this.events.find((e) => e.id === w.eventId));
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
            this.dropStance(f, def.id);
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
    const { detail, ...item } = this.eventItem(ev);
    this.history.push(item);
    const f = this.fighters[ev.actor];
    const o = this.opponent(f);
    const a = ev.action;
    if (a.kind === 'move') {
      f.pos = { x: a.to.x, y: a.to.y };
      f.moving = null;
      this.addLog(`${f.name} ${a.via ? 'lands' : 'arrives'}: ${fmt(this.gap())} m apart (${R.RANGES[this.band()]} range).`, '', f.index);
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
      f.constructs.push({ id: `c${this.nextId++}`, kind: 'star', name: `Star (${a.madra})`, hp, maxHp: hp, madra: a.madra });
      this.addLog(`${f.name}'s Crown gains a ${a.madra}-madra star: ${this.stars(f).length} overhead.`, '', f.index);
      return;
    }
    if (a.kind === 'ring') {
      const t = this.tech(f, a.id);
      f.constructs.push({ id: `c${this.nextId++}`, kind: 'ring', name: t.ringName, hp: t.fixedCost, maxHp: t.fixedCost, madra: t.fixedCost, speedBonus: t.speedBonus, meleeBonus: t.meleeBonus });
      const n = this.rings(f).length;
      this.addLog(`${f.name}'s ${t.ringName} forms: +${t.speedBonus} Speed, +${t.meleeBonus} melee damage (${n} ring${n > 1 ? 's' : ''}: Speed ${fmt(this.speed(f))}, strike ${fmt(this.attackProfile(f, 'strike').damage)}).`, '', f.index);
      return;
    }
    if (a.kind === 'stance') {
      f.stances[a.id] = { raisedAt: this.time };
      this.addLog(`${f.name}'s ${this.tech(f, a.id).name} is up.`, '', f.index);
      return;
    }

    const profile0 = a.profile;
    if (profile0.radius != null) {
      this.landArea(f, o, profile0, boost);
      return;
    }
    if (!profile0.target && !profile0.overhead) {
      const s = this.sight(this.pos(f), this.pos(o));
      if (!profile0.ranges.includes(s.band)) {
        this.addLog(`${f.name}'s ${profile0.name} lands, but ${o.name} is out of range (${fmt(s.dist)} m).`, 'miss', f.index);
        return;
      }
      if (s.blockedBy) {
        this.addLog(`${f.name}'s ${profile0.name} lands, but a ${s.blockedBy.name} is in the way.`, 'miss', f.index);
        return;
      }
    }
    if (a.kind === 'pulse') {
      const factor = R.blockCostFactor(1) * (profile0.pure ? 2 : 1);
      if (this.pulseTargets(o, profile0.madra, profile0.ranges).length && this.maxMadra(o) >= factor) {
        this.askReaction(o, { attacker: f.index, profile: profile0, hits: 1 });
        return;
      }
      this.applyPulse(f, o, profile0, 0);
      return;
    }
    if (a.kind === 'disrupt' && profile0.area) {
      this.addLog(`${f.name}'s ${profile0.name} washes over ${o.name}.`, 'hit', f.index);
      this.disrupt(o, profile0, this.pos(f));
      return;
    }

    // Aimed at a construct: rolls against Defense 10. The owner may reinforce it (a block).
    if (profile0.target) {
      const c = o.constructs.find((x) => x.id === profile0.target);
      if (!c) {
        this.addLog(`${f.name}'s ${profile0.name} lands where its target used to be.`, 'miss', f.index);
        return;
      }
      if (!this.reaches(profile0, this.pos(f), this.constructPos(o, c))) {
        this.addLog(`${f.name}'s ${profile0.name} can't reach ${o.name}'s ${c.name}.`, 'miss', f.index);
        return;
      }
      if (this.maxMadra(o) >= 1) {
        this.askReaction(o, { attacker: f.index, profile: profile0, hits: profile0.hits, construct: c.id });
        return;
      }
      this.resolveConstructAttack(f, o, profile0, c, 0);
      return;
    }

    const profile = this.boosted(f, profile0, boost);
    this.askReaction(o, { attacker: f.index, profile, hits: this.hitsAgainst(f, o, profile) });
  }

  // The defender gets to choose how to react to an attack that is landing.
  askReaction(def, attack) {
    this.prompt = { kind: 'reaction', fighter: def.index, attack };
    this.decision++;
  }

  // A wind-up fed while it built (Void Dragon's Dance and Black Flame) lands with the extra damage.
  boosted(f, prof, boost) {
    if (!(boost > 0)) return prof;
    this.addLog(`${f.name}'s ${prof.name} is boosted by ${fmt(boost)} from Black Flame spent while it built up.`, '', f.index);
    return { ...prof, damage: prof.damage + boost };
  }

  // An area attack lands: find its centre, then hit everything inside with a clear line from it.
  // The opponent gets to react if they're inside; constructs inside are hit either way.
  landArea(f, o, profile0, boost) {
    const l = this.areaLands(f, profile0, this.time);
    if (l.out || !l.centre) {
      this.addLog(`${f.name}'s ${profile0.name} is wasted: ${l.why}.`, 'miss', f.index);
      return;
    }
    const profile = this.boosted(f, { ...profile0, centre: l.centre }, boost);
    const where = profile.aim === 'self' ? '' : ` at (${fmt(l.centre.x)}, ${fmt(l.centre.y)})`;
    if (!l.ok) {
      this.addLog(`${f.name}'s ${profile.name} lands${where}, but ${l.why}.`, 'miss', f.index);
      this.areaConstructHits(f, o, profile, 1);
      this.checkEnd();
      return;
    }
    this.askReaction(o, { attacker: f.index, profile, hits: this.hitsAgainst(f, o, profile) });
  }

  resolveConstructAttack(att, owner, prof, c, blockDR) {
    const band = this.sight(this.pos(att), this.constructPos(owner, c)).band;
    const roll = this.rollHit(att, CONSTRUCT_DEFENSE, prof, this.rangePenalty(prof, band));
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
  // A queued event as a queue item (the same key before and after it resolves).
  eventItem(e) {
    const f = this.fighters[e.actor];
    const k = e.action.kind;
    const label = k === 'move' ? (e.action.via ? 'lands' : 'arrives')
      : k === 'stance' ? `${(this.tech(f, e.action.id) || {}).name} is up`
      : k === 'piece' ? `barrier piece ${e.action.n}/${e.action.of} forms`
      : k === 'forged' ? `Crown star (${e.action.madra}) forms`
      : k === 'ring' ? `${(this.tech(f, e.action.id) || {}).ringName} forms`
      : `${e.action.profile.name} lands`;
    const type = k === 'move' ? 'move' : k === 'stance' ? 'stance' : k === 'piece' || k === 'forged' || k === 'ring' ? 'construct' : 'attack';
    return { key: `ev:${e.id}`, time: e.time, label: `${f.name}: ${label}`, detail: this.describeEvent(e), who: e.actor, kind: 'resolve', type };
  }

  upcoming() {
    const items = [];
    for (const f of this.fighters) {
      const acting = this.prompt && this.prompt.fighter === f.index && this.prompt.kind === 'turn';
      // Keys stay the same while an item is waiting, so the timeline can animate it between updates.
      items.push({ key: `turn:${f.index}:${Math.round(f.nextTurn * 1000)}`, time: f.nextTurn, label: acting ? `${f.name} acts now` : `${f.name}'s next turn`, who: f.index, kind: 'turn', type: 'turn' });
    }
    for (const e of this.events) items.push(this.eventItem(e));
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
