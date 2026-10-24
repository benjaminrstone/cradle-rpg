// Fighters, Paths and traits from paths.md and traits.md.
//
// Technique kinds:
//   attack    - a damaging technique (scales with madra unless noted)
//   stance    - held technique with upkeep
//   construct - Forged object that persists on the field (scales with madra)
//   disrupt   - breaks the target's wind-ups and stances (fixed cost)
//   launch    - fast movement, one range band either way (fixed cost)
// Damage types (dtype): 'technique' (default), 'physical', 'spiritual'.

export const BASE_STATS = {
  health: 100, toughness: 3, speed: 100,
  pool: 100, cap: 15, spirit: 50,
  precision: 5, control: 5, perception: 5,
};

// One point-buy step of each stat (stats.md "Building a fighter").
export const STAT_STEP = { health: 10, toughness: 1, speed: 5, pool: 15, cap: 2, spirit: 10, precision: 1, control: 1, perception: 1 };

// A fighter's stats from their point-buy steps.
export function statsFrom(steps = {}) {
  const stats = { ...BASE_STATS };
  for (const [k, step] of Object.entries(STAT_STEP)) stats[k] = BASE_STATS[k] + step * (steps[k] || 0);
  return stats;
}

export const STAT_GROUPS = [
  ['Body', [['health', 'Health'], ['toughness', 'Toughness'], ['speed', 'Speed']]],
  ['Spirit', [['pool', 'Madra pool'], ['cap', 'Channel cap'], ['spirit', 'Spirit']]],
  ['Mind', [['precision', 'Precision'], ['control', 'Control'], ['perception', 'Perception']]],
];

export const PATHS = {
  blackFlame: {
    name: 'Path of Black Flame',
    signatureStat: 'cap',
    summary: '1.3× damage per madra. Burns its user: 1 health per 5 madra and 1 spirit per 10, upkeep included.',
    efficiencyMult: 1.3,
    sharpness: 0,
    selfBurn: true,
    techniques: [
      {
        id: 'dragonsBreath', name: "Dragon's Breath", kind: 'attack', type: 'Striker',
        divisor: 4, toHit: 1, ranges: [0, 1, 2], bestRange: 1,
        desc: 'A beam of black fire. +1 to hit. Any range; best at Mid.',
      },
      {
        id: 'burningCloak', name: 'Burning Cloak', kind: 'stance', type: 'Enforcer stance',
        raiseCost: 6, upkeep: 1.5, speedMult: 1.5, physBonus: 5,
        desc: 'Speed ×1.5 and +5 physical damage. Upkeep 1.5 madra per tick.',
      },
      {
        id: 'voidDragonsDance', name: "Void Dragon's Dance", kind: 'attack', type: 'Ruler',
        divisor: 2, toHit: 0, ranges: [0, 1], area: true, boostPerMadra: 1, ruler: true,
        desc: 'Finisher: a long build-up, then a wide blast. Ruler: no channel cap, and you act again soon while it builds. Area attack, no roll; hits Close and Mid. +1 damage per Black Flame madra you spend while it winds up.',
      },
    ],
  },
  endlessSword: {
    name: 'Path of the Endless Sword',
    signatureStat: 'precision',
    summary: 'Sharpness: Path techniques ignore 3 points of physical damage reduction.',
    efficiencyMult: 1,
    sharpness: 3,
    selfBurn: false,
    techniques: [
      {
        id: 'endlessSword', name: 'Endless Sword', kind: 'attack', type: 'Striker / Ruler',
        divisor: 3, toHit: 0, ranges: [0, 1], area: true, bladeHits: true,
        desc: 'Area attack, no roll: slashes everything at close and mid range, constructs included. One extra hit per other blade close to the target.',
      },
      {
        id: 'ripplingSword', name: 'Rippling Sword', kind: 'attack', type: 'Striker',
        divisor: 4, toHit: 0, ranges: [0, 1, 2], bestRange: 1, base: 10, physical: true,
        desc: 'A strike whose edge extends into a wave of sword aura. Any range; best at Close or Mid (−1 to hit at Far).',
      },
      {
        id: 'flowingSword', name: 'Flowing Sword', kind: 'stance', type: 'Enforcer stance',
        raiseCost: 4, upkeep: 0.5, buildUp: { every: 5, speed: 0.1, sharpness: 1, upkeep: 0.1 },
        desc: 'Every 5 ticks held: +10% Speed, +1 sharpness, +0.1 upkeep per tick. Like every stance, a hit of twice your interrupt threshold breaks it.',
      },
    ],
  },
  hollowKing: {
    name: 'Path of the Hollow King',
    signatureStat: 'pool',
    summary: 'Pure madra: tools for taking techniques apart. Breaks defenses, constructs and stances, and turns attacks back on their owners.',
    efficiencyMult: 1,
    sharpness: 0,
    selfBurn: false,
    // Pure madra: blocking it (or reinforcing a construct against it) costs double, and it does
    // double damage to madra constructs such as barriers and stars.
    pureMadra: true,
    techniques: [
      {
        id: 'hollowSpear', name: "Hollow King's Spear", kind: 'attack', type: 'Striker',
        divisor: 4, toHit: 1, ranges: [0, 1, 2], bestRange: 1, effMult: 0.85, dtype: 'spiritual',
        desc: 'Hyper-compressed pure madra: a spiritual attack. Blocks against it cost double, and barriers soak it but take double damage. +1 to hit. Any range; best at Mid.',
      },
      {
        id: 'hollowArmor', name: 'Hollow Armor', kind: 'stance', type: 'Enforcer stance',
        raiseCost: 5, upkeep: 1, halvesTechniques: true,
        desc: 'A layer of pure madra that halves technique and spiritual damage. No help against physical strikes. Upkeep 1 madra per tick.',
      },
      {
        id: 'crown', name: 'Crown of the Hollow King', label: 'Forge a star', card: 'crown', kind: 'forge', type: 'Forger',
        divisor: 2,
        cardDesc: 'Forge stars high overhead at Far range, then drop them when the timing is right. Each star is its own construct with HP equal to its madra.',
        desc: 'Forge one star for the Crown of the Hollow King, high overhead at Far range. The madra you put in sets its size; it takes madra ÷ 2 ticks to form, but your next turn comes after 1 tick. Each star is its own construct with HP equal to its madra.',
      },
      {
        id: 'dropStars', name: 'Crown of the Hollow King', label: 'Drop stars', card: 'crown', kind: 'command', type: 'Forger',
        desc: 'Drop any number of your forged stars, biggest first. A quick action: they land 0.5 ticks later and your next turn comes then. Stars dropped together are one attack with a hit per star, so the defender reacts once and blocks them all at the multi-hit rate. Each hit is a rolled spiritual attack doing 2 × the star’s madra, +1 to hit, at any range.',
      },
      {
        id: 'hollowMantle', cost: 1, name: "Hollow King's Mantle", kind: 'stance', type: 'Striker stance',
        raiseCost: 5, upkeep: 1, redirect: true,
        desc: 'A whirlpool of madra. While it is up, you can catch an incoming non-area technique and throw it back at its owner for half the madra that went into it. Upkeep 1 madra per tick.',
      },
      {
        id: 'madraPulse', cost: 2, name: 'Madra Pulse', kind: 'pulse', type: 'Striker / Ruler',
        divisor: 6, minMadra: 2, area: true, ranges: [0],
        desc: 'A wash of pure madra at Close range. It cancels every wind-up, stance and construct of your opponent\u2019s there that cost at most half the madra you put in. They can block it, at double cost: each point of block takes 1.5 off its strength. No damage, no roll.',
      },
    ],
  },
  dawnOath: {
    name: 'Path of the Dawn Oath',
    signatureStat: 'toughness',
    summary: 'Force madra and Oathsign scripts: barriers, launches, seals and a heavy hammer. Holds ground and controls the fight.',
    efficiencyMult: 1,
    sharpness: 0,
    selfBurn: false,
    techniques: [
      {
        id: 'stoneAnchor', name: 'Stone Anchor', kind: 'stance', type: 'Enforcer stance',
        raiseCost: 5, upkeep: 0.5, dr: 6, stanceBreakMult: 1.5,
        desc: '+6 damage reduction (not against spiritual hits), and your stances take 50% more to break. Upkeep 0.5 madra per tick.',
      },
      {
        id: 'forceRing', name: 'Oathsign: Force Ring', kind: 'attack', type: 'Enforcer', dtype: 'physical',
        divisor: 3, toHit: 0, ranges: [0], bestRange: 0, base: 10, physical: true, weaponBonus: true,
        desc: 'Script rings around the hammer multiply the blow: 10 + weapon + madra × efficiency, physical. Close range only.',
      },
      {
        id: 'barrier', name: 'Oathsign: Barrier', kind: 'construct', type: 'Forger', construct: 'barrier',
        divisor: 3,
        desc: 'A script-circle shield with HP of 2 × madra, filling in as it builds while you keep acting. It soaks physical, technique and piercing hits aimed at you before they reach you; other spiritual hits pass through it. Casting again adds to it.',
      },
      {
        id: 'launch', cost: 1, name: 'Oathsign: Launch', kind: 'launch', type: 'Forger',
        fixedCost: 4, travel: 0.5, recovery: 1,
        desc: 'A ring flings you one range band in 0.5 ticks; your next turn comes 1 tick after you land.',
      },
      {
        id: 'seal', cost: 2, name: 'Oathsign: Seal', kind: 'disrupt', type: 'Forger',
        fixedCost: 10, windup: 2, toHit: 0, ranges: [0, 1, 2], bestRange: 1,
        desc: 'A script circle Forged on your opponent. Rolled; if it hits, it breaks all their wind-ups and stances. No damage. Any range; best at Mid.',
      },
    ],
  },
};

export const TRAITS = {
  swordArms: {
    name: 'Sword arms (Goldsign)',
    cost: 3,
    desc: 'Lowgold: strikes are made twice at once. The arms count as one blade for Endless Sword.',
  },
};

// Weapons a build can carry. Price: 1 point per +2 damage (rounded up); being a blade is free.
export const WEAPONS = [
  { name: 'unarmed', blade: false, damage: 0 },
  { name: 'sword', blade: true, damage: 0 },
  { name: 'scissors', blade: true, damage: 0 },
  { name: 'hammer', blade: false, damage: 4 },
];

export const FIGHTERS_RAW = [
  {
    id: 'lindon', name: 'Lindon', path: 'blackFlame', stage: 'Lowgold', theme: 'flame',
    // Black Flame and a Bloodforged Iron body; refined control, still learning to fight.
    steps: { pool: 3, control: 2, perception: 1, toughness: 2, precision: -1, speed: -1 },
    traits: [], weapon: null,
  },
  {
    id: 'yerin', name: 'Yerin', path: 'endlessSword', stage: 'Lowgold', theme: 'sword',
    // The fastest and sharpest; fights with her blades rather than finesse.
    steps: { precision: 4, speed: 1, perception: 1, toughness: 1, control: -1, pool: -1, spirit: -1 },
    traits: ['swordArms'], weapon: { name: 'sword', blade: true, damage: 0 },
  },
  {
    id: 'eithan', name: 'Eithan', path: 'hollowKing', stage: 'Lowgold', theme: 'pure',
    // Sees everything and moves well; fragile, with little raw power.
    steps: { perception: 3, control: 1, pool: 5, speed: 1, cap: -1, toughness: -3, health: -2 },
    traits: [], weapon: { name: 'scissors', blade: true, damage: 0 },
  },
  {
    id: 'ziel', name: 'Ziel', path: 'dawnOath', stage: 'Lowgold', theme: 'force',
    // Hard to hurt; slow, with a damaged spirit.
    steps: { toughness: 3, health: 3, control: -1, speed: -1, spirit: -1, pool: -1 },
    traits: [], weapon: { name: 'hammer', blade: false, damage: 4 },
  },
];

// Canon fighters, with their stats worked out from their steps.
export const FIGHTERS = FIGHTERS_RAW.map((f) => ({ ...f, stats: statsFrom(f.steps) }));
