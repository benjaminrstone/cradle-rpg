// Core formulas from stats.md and techniques.md.

export const RANGES = ['Close', 'Mid', 'Far'];

export const TIMING = {
  strikeWindup: 2,      // physical, scaled by Speed
  moveRate: 2,          // metres per tick at Speed 100; physical, so scaled by Speed
  moveMin: 0.5,         // the shortest a move takes
  dodge: 2,             // physical, scaled by Speed; pushes your next action later
  sidestep: 2,          // metres a dodge carries you out of an area at Speed 100, scaled by Speed
  blockDelay: 1,        // pushes your next action later
  waitDefault: 2,
  waitMin: 0.5,
  waitMax: 10,
  actWhileBuilding: 1.5, // techniques that build while you act (Ruler techniques, barriers, Crown stars): next turn this soon after starting
  stanceWindup: 1,      // technique wind-up, scaled by Control
  reraiseDelay: 4,      // scaled by Control
  interruptStagger: 1,  // an interrupted fighter's next action comes this soon
};

// How long a wait is: as chosen, within the limits.
export function waitTime(t) {
  return Math.min(TIMING.waitMax, Math.max(TIMING.waitMin, Number(t) || TIMING.waitDefault));
}

// Crown stars: 2 spiritual damage per madra before reduction, +1 to hit. Dropping stars takes
// 0.5 ticks and they land 0.5 ticks later.
export const STAR = { damagePerMadra: 2, toHit: 1, dropTime: 0.5 };

// Constructs don't dodge; rolled attacks against them need to beat this.
export const CONSTRUCT_DEFENSE = 10;

export const STRIKE_DAMAGE = 10;

// Area attacks can't miss, so they pay for it in damage.
export const AREA_EFFICIENCY = 0.75;

export function nominalWindup(madra, divisor = 3) {
  return Math.max(1, madra / divisor);
}

// Damage per madra. Based on madra (as if the wind-up were madra / 3), so faster-scaling
// techniques don't lose damage; techniques with a longer wind-up than that get extra.
export function efficiency(madra, nominal) {
  return Math.min(2.2, 1.2 + 0.1 * Math.max(madra / 3, nominal));
}

export function techWindup(nominal, control) {
  return nominal * (1 - 0.03 * control);
}

export function controlFactor(control) {
  return 1 - 0.05 * control;
}

// Speed counts squared, so fast fighters act much more often.
export function physTime(base, speed) {
  return base * (100 / speed) ** 2;
}

// Walking a route: time grows with distance, shortened by Speed like any physical action.
export function moveTime(metres, speed) {
  return Math.max(TIMING.moveMin, physTime(metres / TIMING.moveRate, speed));
}

export function speedMod(defenderSpeed, attackerSpeed) {
  return Math.round(3 * Math.log2(defenderSpeed / attackerSpeed));
}

export function dodgeBonus(defenderSpeed, attackerSpeed) {
  return Math.max(0, 2 + speedMod(defenderSpeed, attackerSpeed));
}

// Chance that 2d6 >= target. No automatic hits.
export function chanceAtLeast(target) {
  let count = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= target) count++;
  return count / 36;
}

export function roll2d6(rng) {
  const a = 1 + Math.floor(rng() * 6);
  const b = 1 + Math.floor(rng() * 6);
  return [a, b];
}

// A hit interrupts if, after damage reduction, it deals at least 1.6 x Control% of max Health.
export function interruptThreshold(stats) {
  return ((1.6 * stats.control) / 100) * stats.health;
}

// Stances are held more firmly than wind-ups: breaking one takes twice the interrupt threshold.
export const STANCE_BREAK_MULT = 2;

// Dodging an area attack is a quick sidestep straight out of it: this far, scaled by Speed
// like walking. If it takes you outside (or behind cover), the attack misses you.
export function sidestep(speed) {
  return TIMING.sidestep * (speed / 100) ** 2;
}

// A block soaks this much damage in all, per madra, spread over the attack's hits.
export function blockReduction(madra) {
  return 1.5 * madra;
}

// Black Flame burns its user for the madra they spend: 1 health per 5, 1 spirit per 10.
export function burn(madra) {
  return { health: madra / 5, spirit: madra / 10 };
}

// ---------- range ----------
// Distances are in metres. Close, Mid and Far are shorthand for 2, 10 and 20 m.
export const RANGE_METRES = [2, 10, 20];
// Past its best distance an attack takes -1 to hit for every this many metres (rounded up).
export const FALLOFF = 4;

// What a technique (or attack profile) can reach, in metres: { min, max, best }.
// Written either directly (reach, minReach, best) or as bands (ranges, bestRange): reaching Far
// means no limit; best at Far means 20 m.
export function rangeSpec(t) {
  if (t.reachSpec) return t.reachSpec;
  const ranges = t.ranges || [0];
  const top = Math.max(...ranges);
  const low = Math.min(...ranges);
  return {
    min: t.minReach ?? (low > 0 ? RANGE_METRES[low - 1] : 0),
    max: t.reach ?? (top >= 2 ? Infinity : RANGE_METRES[top]),
    best: t.best ?? RANGE_METRES[t.bestRange ?? low],
  };
}

export const inReach = (spec, d) => d <= spec.max + 1e-6 && d >= spec.min - 1e-6;

// -1 to hit for every FALLOFF metres (or part of it) past the best distance.
export function rangePenalty(d, spec) {
  return d <= spec.best + 1e-6 ? 0 : Math.ceil((d - spec.best - 1e-6) / FALLOFF);
}

// How a reach reads: "Close", "up to 10 m", "any range".
export function reachText(spec) {
  if (spec.max === Infinity) return spec.min > 0 ? `${spec.min} m or more` : 'any range';
  if (spec.max <= RANGE_METRES[0]) return 'Close';
  return `${spec.min > 0 ? `${spec.min}–` : 'up to '}${spec.max} m`;
}
