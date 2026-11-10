export const RANGES = ['Close', 'Mid', 'Far'];

export const TIMING = {
  // Physical times shrink with Speed squared; technique times with Control.
  strikeWindup: 2,
  moveRate: 2,           // metres per tick
  moveMin: 0.5,
  paceStriker: 2 / 3,
  paceSlow: 1 / 3,       // Forger and Ruler wind-ups
  reroute: 0.5,          // a change of course as a reaction
  chaseMax: 6,           // a strike waiting to come into reach gives up
  dodge: 2,
  sidestep: 2,           // metres
  blockDelay: 1,
  waitDefault: 2,
  waitMin: 0.5,
  waitMax: 10,
  actWhileBuilding: 1.5, // Ruler techniques, barriers, Crown stars: next turn this soon after starting
  stanceWindup: 1,
  reraiseDelay: 4,
  interruptStagger: 1,
};

export function waitTime(t) {
  return Math.min(TIMING.waitMax, Math.max(TIMING.waitMin, Number(t) || TIMING.waitDefault));
}

export const STAR = { damagePerMadra: 2, toHit: 1, dropTime: 0.5 };

export const CONSTRUCT_DEFENSE = 10;

export const STRIKE_DAMAGE = 10;

// Area attacks can't miss, so they pay for it in damage.
export const AREA_EFFICIENCY = 0.75;

// All of a zone's pulses together, against a one-off area attack of the same madra.
export const ZONE_TOTAL = 1.5;
export const ZONE_SLOW_MAX = 0.5;

// Ruler techniques draw on aura as they build: they take this many times the channel cap.
export const RULER_CAP = 2;

// Madra comes back at this share of the pool per tick.
export const REGEN = 0.003;

// The dial: wind-up grows faster than madra, and damage per madra grows with it too. So a
// small technique is quick and a big one is efficient. At TYPICAL_CAP madra the wind-up is
// madra / divisor.
export const TYPICAL_CAP = 15;
export const WINDUP_MIN = 1;

export function windup(madra, divisor = 3) {
  return (madra / divisor) * Math.sqrt(madra / TYPICAL_CAP);
}

export function efficiency(madra, divisor = 3) {
  return Math.min(2.2, 1.2 + (0.1 * madra) / Math.min(3, divisor));
}

export function techWindup(nominal, control) {
  return nominal * (1 - 0.03 * control);
}

export function controlFactor(control) {
  return 1 - 0.05 * control;
}

export function physTime(base, speed) {
  return base * (100 / speed) ** 2;
}

export function speedMod(defenderSpeed, attackerSpeed) {
  return Math.round(3 * Math.log2(defenderSpeed / attackerSpeed));
}

export function dodgeBonus(defenderSpeed, attackerSpeed) {
  return Math.max(0, 2 + speedMod(defenderSpeed, attackerSpeed));
}

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

// After reduction, as a share of max Health.
export function interruptThreshold(stats) {
  return ((1.6 * stats.control) / 100) * stats.health;
}

export const STANCE_BREAK_MULT = 2;

export function sidestep(speed) {
  return TIMING.sidestep * (speed / 100) ** 2;
}

// A block trades madra for damage one for one, in all, across the attack's hits.
export const BLOCK_SOAK = 1;
export function blockReduction(madra) {
  return BLOCK_SOAK * madra;
}

// Black Flame burns its user for the madra they spend.
export function burn(madra) {
  return { health: madra / 5, spirit: madra / 10 };
}

// Close, Mid and Far, in metres.
export const RANGE_METRES = [2, 10, 20];
// Past its best distance an attack takes -1 to hit for every this many metres.
export const FALLOFF = 4;

// { min, max, best } in metres, from bands (ranges, bestRange) or direct values (reach,
// minReach, best). Reaching Far means no limit.
export function rangeSpec(t) {
  // A saved fight stores Infinity as null.
  if (t.reachSpec) return { ...t.reachSpec, max: t.reachSpec.max ?? Infinity };
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

export function rangePenalty(d, spec) {
  return d <= spec.best + 1e-6 ? 0 : Math.ceil((d - spec.best - 1e-6) / FALLOFF);
}

export function reachText(spec) {
  if (spec.max === Infinity) return spec.min > 0 ? `${spec.min} m or more` : 'any range';
  if (spec.max <= RANGE_METRES[0]) return 'Close';
  return `${spec.min > 0 ? `${spec.min}–` : 'up to '}${spec.max} m`;
}
