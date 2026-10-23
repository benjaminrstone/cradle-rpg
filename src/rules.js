// Core formulas from stats.md and techniques.md.

export const RANGES = ['Close', 'Mid', 'Far'];

export const TIMING = {
  strikeWindup: 1,      // physical, scaled by Speed
  strikeRecovery: 2,    // physical, scaled by Speed
  move: 3,              // physical, scaled by Speed
  dodge: 2,             // physical, scaled by Speed; pushes your next action later
  blockDelay: 1,        // pushes your next action later
  waitDefault: 2,
  waitMin: 0.5,
  waitMax: 10,
  techRecovery: 2,
  stanceWindup: 1,      // technique wind-up, scaled by Control
  reraiseDelay: 4,      // scaled by Control
  interruptStagger: 1,  // an interrupted fighter's next action comes this soon
};

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

export function physTime(base, speed) {
  return (base * 100) / speed;
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

// Dodging an area attack can't avoid it, but cuts its damage by 15% per point of dodge bonus.
export function areaDodgeReduction(bonus) {
  return Math.min(0.9, 0.15 * bonus);
}

// Blocking several hits: each extra hit covered costs 1.5x the base.
// 1 hit = 1x, 2 hits = 2.5x, 3 hits = 4x, 4 hits = 5.5x.
export function blockCostFactor(hits) {
  return 1 + 1.5 * (hits - 1);
}

// -1 to hit for each range band past the attack's best range.
export function rangePenalty(distance, bestRange) {
  return Math.max(0, distance - bestRange);
}
