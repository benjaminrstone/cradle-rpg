// Custom Paths: made in the Path editor from technique templates the engine already supports,
// each with a few tunable numbers. Saved in the browser; builds can use them like any Path.
import { PATHS } from './data.js';

const R = ['Close', 'Mid', 'Far'];
const span = (min, max) => (min === max ? `${R[min]} range` : `${R[min]}–${R[max]}`);
const rangeList = (min, max) => Array.from({ length: Math.max(0, max - min) + 1 }, (_, i) => min + i);
const pct = (x) => `${Math.round(x * 100)}%`;

// Knob helpers.
const num = (key, label, min, max, step, def) => ({ key, label, type: 'number', min, max, step, def });
const bool = (key, label, def = false) => ({ key, label, type: 'bool', def });
const pick = (key, label, options, def) => ({ key, label, type: 'select', options, def });
const DTYPE = pick('dtype', 'Damage type', [['technique', 'Technique'], ['spiritual', 'Spiritual']], 'technique');
const RANGE_OPTS = [[0, 'Close'], [1, 'Mid'], [2, 'Far']];
const MIN_R = (def = 0) => pick('minRange', 'Closest range', RANGE_OPTS, def);
const MAX_R = (def = 1) => pick('maxRange', 'Farthest range', RANGE_OPTS, def);

// Each template: what it is, its knobs, and how knobs become technique fields and a description.
export const TEMPLATES = {
  striker: {
    label: 'Striker attack', type: 'Striker',
    knobs: [DTYPE, num('effMult', 'Damage ×', 0.6, 1.4, 0.05, 1), num('toHit', 'To hit', -2, 2, 1, 0), MIN_R(0), MAX_R(2), pick('bestRange', 'Best range', RANGE_OPTS, 1)],
    make: (k) => ({ kind: 'attack', divisor: 4, dtype: k.dtype === 'spiritual' ? 'spiritual' : undefined, effMult: k.effMult, toHit: k.toHit, ranges: rangeList(k.minRange, k.maxRange), bestRange: k.bestRange }),
    describe: (k) => `A shot that scales with madra (wind-up madra ÷ 4), ${k.effMult !== 1 ? `${k.effMult}× damage, ` : ''}${k.dtype === 'spiritual' ? 'spiritual damage, ' : ''}${k.toHit ? `${k.toHit > 0 ? '+' : ''}${k.toHit} to hit, ` : ''}${span(k.minRange, k.maxRange)}, best at ${R[k.bestRange]}.`,
  },
  area: {
    label: 'Area attack', type: 'Striker / Ruler',
    knobs: [DTYPE, num('effMult', 'Damage ×', 0.6, 1.4, 0.05, 1), MIN_R(0), MAX_R(1), bool('bladeHits', 'Extra hit per other blade')],
    make: (k) => ({ kind: 'attack', divisor: 3, area: true, dtype: k.dtype === 'spiritual' ? 'spiritual' : undefined, effMult: k.effMult, ranges: rangeList(k.minRange, k.maxRange), bladeHits: k.bladeHits }),
    describe: (k) => `Area attack, no roll, ${span(k.minRange, k.maxRange)}; wind-up madra ÷ 3${k.effMult !== 1 ? `, ${k.effMult}× damage` : ''}${k.dtype === 'spiritual' ? ', spiritual damage' : ''}${k.bladeHits ? '; one extra hit per other blade close to the target' : ''}.`,
  },
  empowered: {
    label: 'Empowered strike', type: 'Enforcer',
    knobs: [num('effMult', 'Damage ×', 0.6, 1.4, 0.05, 1), num('toHit', 'To hit', -2, 2, 1, 0)],
    make: (k) => ({ kind: 'attack', divisor: 3, dtype: 'physical', base: 10, physical: true, weaponBonus: true, ranges: [0], bestRange: 0, effMult: k.effMult, toHit: k.toHit }),
    describe: (k) => `A physical blow powered by madra: 10 + weapon + madra × efficiency${k.effMult !== 1 ? ` (× ${k.effMult})` : ''}${k.toHit ? `, ${k.toHit > 0 ? '+' : ''}${k.toHit} to hit` : ''}. Close range only; if broken, it still lands as a plain strike.`,
  },
  ruler: {
    label: 'Ruler technique', type: 'Ruler',
    knobs: [DTYPE, num('effMult', 'Damage ×', 0.6, 1.4, 0.05, 1), MIN_R(0), MAX_R(1)],
    make: (k) => ({ kind: 'attack', divisor: 2, area: true, ruler: true, dtype: k.dtype === 'spiritual' ? 'spiritual' : undefined, effMult: k.effMult, ranges: rangeList(k.minRange, k.maxRange) }),
    describe: (k) => `Long build-up, then a wide blast: no channel cap, wind-up madra ÷ 2, and you act again soon while it builds. Area attack, no roll, ${span(k.minRange, k.maxRange)}${k.effMult !== 1 ? `, ${k.effMult}× damage` : ''}.`,
  },
  stance: {
    label: 'Stance', type: 'Enforcer stance',
    knobs: [num('raiseCost', 'Raise cost', 2, 10, 1, 5), num('upkeep', 'Upkeep / tick', 0.2, 2, 0.1, 1),
      num('speedMult', 'Speed ×', 1, 1.6, 0.05, 1), num('physBonus', 'Physical damage +', 0, 8, 1, 0), num('dr', 'Damage reduction +', 0, 8, 1, 0),
      num('stanceBreakMult', 'Stances harder to break ×', 1, 2, 0.25, 1), bool('halvesTechniques', 'Halves technique and spiritual damage'),
      bool('redirect', 'Can redirect techniques'), bool('buildUp', 'Builds up over time (like Flowing Sword)')],
    make: (k) => ({
      kind: 'stance', raiseCost: k.raiseCost, upkeep: k.upkeep,
      speedMult: k.speedMult !== 1 ? k.speedMult : undefined, physBonus: k.physBonus || undefined, dr: k.dr || undefined,
      stanceBreakMult: k.stanceBreakMult !== 1 ? k.stanceBreakMult : undefined, halvesTechniques: k.halvesTechniques || undefined,
      redirect: k.redirect || undefined, buildUp: k.buildUp ? { every: 5, speed: 0.1, sharpness: 1, upkeep: 0.1 } : undefined,
    }),
    describe: (k) => {
      const bits = [];
      if (k.speedMult !== 1) bits.push(`Speed ×${k.speedMult}`);
      if (k.physBonus) bits.push(`+${k.physBonus} physical damage`);
      if (k.dr) bits.push(`+${k.dr} damage reduction (not against spiritual hits)`);
      if (k.stanceBreakMult !== 1) bits.push(`your stances take ${pct(k.stanceBreakMult - 1)} more to break`);
      if (k.halvesTechniques) bits.push('halves technique and spiritual damage');
      if (k.redirect) bits.push('lets you catch a non-area technique and throw it back for half its madra');
      if (k.buildUp) bits.push('every 5 ticks held: +10% Speed, +1 sharpness, +0.1 upkeep');
      const text = bits.join('; ');
      return `${text ? `${text[0].toUpperCase()}${text.slice(1)}. ` : ''}Costs ${k.raiseCost} to raise, upkeep ${k.upkeep} madra per tick.`;
    },
  },
  barrier: {
    label: 'Barrier (Forger)', type: 'Forger',
    knobs: [num('sizeMult', 'HP ×', 0.5, 2, 0.25, 1)],
    make: (k) => ({ kind: 'construct', divisor: 3, sizeMult: k.sizeMult !== 1 ? k.sizeMult : undefined }),
    describe: (k) => `A shield with HP of ${2 * k.sizeMult} × madra, filling in as it builds while you keep acting. It soaks physical, technique and pure-madra hits aimed at you.`,
  },
  crown: {
    label: 'Star crown (Forger)', type: 'Forger',
    knobs: [num('toHit', 'Star to hit', -1, 2, 1, 0), num('sizeMult', 'Star HP ×', 0.5, 2, 0.25, 1)],
    make: (k) => ({ kind: 'forge', divisor: 2, toHit: k.toHit || undefined, sizeMult: k.sizeMult !== 1 ? k.sizeMult : undefined }),
    describe: () => 'Forge stars high overhead at Far range, one at a time while you keep acting, then drop any number at once. Each hit is spiritual: 2 × the star’s madra, +1 to hit.',
  },
  disrupt: {
    label: 'Disruption (rolled)', type: 'Forger',
    knobs: [num('fixedCost', 'Madra', 4, 15, 1, 10), num('windup', 'Wind-up', 1, 4, 0.5, 2), num('toHit', 'To hit', -2, 2, 1, 0), MIN_R(0), MAX_R(2), pick('bestRange', 'Best range', RANGE_OPTS, 1)],
    make: (k) => ({ kind: 'disrupt', fixedCost: k.fixedCost, windup: k.windup, toHit: k.toHit, ranges: rangeList(k.minRange, k.maxRange), bestRange: k.bestRange }),
    describe: (k) => `Costs ${k.fixedCost}, wind-up ${k.windup}. Rolled; if it hits, it breaks the opponent's wind-ups and stances. No damage. ${span(k.minRange, k.maxRange)}, best at ${R[k.bestRange]}.`,
  },
  launch: {
    label: 'Launch (movement)', type: 'Forger',
    knobs: [num('fixedCost', 'Madra', 2, 8, 1, 4), num('recovery', 'Next turn after landing', 0.5, 2, 0.5, 1)],
    make: (k) => ({ kind: 'launch', fixedCost: k.fixedCost, travel: 0.5, recovery: k.recovery }),
    describe: (k) => `Moves you one range band in 0.5 ticks for ${k.fixedCost} madra; your next turn comes ${k.recovery} tick${k.recovery === 1 ? '' : 's'} after you land.`,
  },
  pulse: {
    label: 'Madra pulse', type: 'Striker / Ruler',
    knobs: [num('divisor', 'Wind-up: madra ÷', 4, 8, 1, 6)],
    make: (k) => ({ kind: 'pulse', divisor: k.divisor, minMadra: 2, area: true, ranges: [0] }),
    describe: (k) => `At Close range, cancels the opponent's wind-ups, stances and constructs that cost at most half the madra put in (wind-up madra ÷ ${k.divisor}). They can block it. No damage, no roll.`,
  },
};

export const defaultKnobs = (template) => Object.fromEntries(TEMPLATES[template].knobs.map((k) => [k.key, k.def]));

// Drop undefined fields so the technique looks like the hand-written ones.
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Turn one editor entry into the technique(s) the engine uses. A star crown makes two:
// forging a star, and dropping them (both on one card).
export function compileTechnique(pathId, entry) {
  const tpl = TEMPLATES[entry.template];
  const knobs = { ...defaultKnobs(entry.template), ...entry.knobs };
  const id = `${pathId}-${entry.uid}`;
  const desc = `${entry.flavor ? `${entry.flavor.trim()} ` : ''}${tpl.describe(knobs)}`;
  const base = clean({ id, name: entry.name || tpl.label, type: tpl.type, cost: entry.cost || undefined, desc, ...tpl.make(knobs) });
  if (entry.template !== 'crown') return [base];
  return [
    { ...base, label: 'Forge a star', card: id, cardDesc: desc, desc: 'Forge one star; the madra you put in sets its size and it forms after madra ÷ 2 ticks, but your next turn comes after 1 tick.' },
    { id: `${id}-drop`, name: base.name, label: 'Drop stars', card: id, kind: 'command', type: tpl.type, desc: 'Drop any number of forged stars, biggest first. They land 0.5 ticks later as one attack with a hit per star.' },
  ];
}

export function compilePath(draft) {
  const madra = draft.madraName || 'Custom madra';
  return {
    id: draft.id,
    custom: true,
    name: draft.name,
    summary: draft.summary || `${madra}.${draft.element ? ` ${draft.element}` : ''}`,
    element: draft.element,
    madraName: madra,
    color: draft.color,
    theme: draft.color ? themeKey(draft.id) : draft.theme || 'pure',
    signatureStat: draft.signatureStat,
    efficiencyMult: draft.efficiencyMult,
    sharpness: draft.sharpness,
    pureMadra: draft.pureMadra || undefined,
    selfBurn: draft.selfBurn,
    techniques: draft.techniques.flatMap((e) => compileTechnique(draft.id, e)),
  };
}

export function newPathDraft() {
  return {
    id: `path-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Path of the New Path',
    summary: '',
    element: '',
    madraName: 'New madra',
    color: '#7fd1c7',
    signatureStat: 'precision',
    efficiencyMult: 1,
    sharpness: 0,
    pureMadra: false,
    selfBurn: false,
    techniques: [{ uid: 't1', template: 'striker', name: 'New Striker technique', cost: 0, flavor: '', knobs: defaultKnobs('striker') }],
  };
}

// ---------- custom madra colors ----------
// Each custom madra type gets a theme class, like the built-in ones: the chosen color as the
// accent, and a dark shade of it for fills.
export const themeKey = (id) => `custom-${id}`;

export function dimColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#2b2f4a';
  const n = parseInt(m[1], 16);
  const bg = [0x14, 0x17, 0x1d];
  const mix = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(c * 0.3 + bg[i] * 0.7));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function applyCustomThemes() {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('custom-themes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-themes';
    document.head.appendChild(style);
  }
  style.textContent = loadPathDrafts().filter((d) => d.color)
    .map((d) => `.theme-${themeKey(d.id)} { --accent: ${d.color}; --accent-dim: ${dimColor(d.color)}; }`).join(' ');
}

// ---------- storage ----------
const KEY = 'customPaths';
export function loadPathDrafts() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
export function savePathDrafts(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

applyCustomThemes();

// Every Path: the hand-written ones plus custom ones, keyed by id.
export function allPaths() {
  const out = { ...PATHS };
  for (const d of loadPathDrafts()) out[d.id] = compilePath(d);
  return out;
}
export const getPath = (id) => allPaths()[id];
