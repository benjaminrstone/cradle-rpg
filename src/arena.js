// The battlefield: a walled arena with obstacles. Positions are free (x, y in metres, z for
// height); range bands are distance rings; obstacles block movement and line of sight.

export const ARENA = {
  name: 'Courtyard',
  width: 40,
  height: 24,
  starts: [{ x: 16, y: 12 }, { x: 24, y: 12 }],
  obstacles: [
    { name: 'pillar', x: 18.5, y: 5, w: 3, h: 2 },
    { name: 'pillar', x: 18.5, y: 17, w: 3, h: 2 },
    { name: 'wall', x: 6, y: 8.5, w: 1, h: 7 },
    { name: 'wall', x: 33, y: 8.5, w: 1, h: 7 },
  ],
};

// Range words for distances: Close up to 2 m, Mid up to 10 m, Far beyond. Attacks reach and
// lose accuracy by the metre (rules.js); the words are shorthand.
export const BANDS = [2, 10];
// The largest an area can grow, and the longest a line (a beam) can reach.
export const AREA_MAX = 14;
export const LINE_MAX = 24;
// A fighter's size, for keeping clear of walls and obstacles.
export const RADIUS = 0.5;
// Crown stars hang this high over their owner: out of reach of anything short-ranged, and over every obstacle.
export const STAR_HEIGHT = 14;
// Launch: the farthest a ring can fling you, enough to go from the start to Close or Far.
export const LAUNCH_REACH = 7;
// Closing in stops this far from the opponent, well inside Close.
export const TOWARD_GAP = 1.5;
// How far a Launch "away" goes when nothing else limits it.
export const AWAY_STEP = 6.5;

const EPS = 1e-6;

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

export function bandOf(d) {
  return d <= BANDS[0] + EPS ? 0 : d <= BANDS[1] + EPS ? 1 : 2;
}

// Does the segment a→b pass through the inside of rectangle r, widened by pad?
// Running along an edge or touching a corner doesn't count.
function crosses(a, b, r, pad = 0) {
  const x0 = r.x - pad + EPS;
  const x1 = r.x + r.w + pad - EPS;
  const y0 = r.y - pad + EPS;
  const y1 = r.y + r.h + pad - EPS;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1 - 1e-9;
}

// Where the segment a→b first enters an obstacle (as a fraction of the way, 0–1), or 1 if it doesn't.
function entry(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return 1; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return 1; if (t > t0) t0 = t; } else { if (t < t0) return 1; if (t < t1) t1 = t; }
  }
  return t0 < t1 - 1e-9 ? t0 : 1;
}

// A beam from a toward b stops at the first obstacle or the arena wall: where it ends.
export function lineStop(arena, a, b) {
  let k = Math.min(1, ...arena.obstacles.map((r) => entry(a, b, r)));
  const clampT = (v0, d, lo, hi) => (d > 0 ? (hi - v0) / d : d < 0 ? (lo - v0) / d : Infinity);
  k = Math.min(k, clampT(a.x, b.x - a.x, 0, arena.width), clampT(a.y, b.y - a.y, 0, arena.height));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// The distance from p to the segment a→b, and which side of the line p is on (+1 or -1).
export function segDist(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const q = { x: a.x + dx * k, y: a.y + dy * k };
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
  return { dist: Math.hypot(p.x - q.x, p.y - q.y), side: cross >= 0 ? 1 : -1, along: k };
}

// The obstacle in the way of a line from a to b, if any. Anything high overhead sees over them all.
export function blocker(arena, a, b) {
  if ((a.z || 0) > 0 || (b.z || 0) > 0) return null;
  return arena.obstacles.find((r) => crosses(a, b, r)) || null;
}

const insideRect = (p, r, pad) => p.x > r.x - pad + EPS && p.x < r.x + r.w + pad - EPS && p.y > r.y - pad + EPS && p.y < r.y + r.h + pad - EPS;

// Can a fighter stand here: inside the arena walls and clear of every obstacle?
export function standable(arena, p) {
  return p.x >= RADIUS - EPS && p.x <= arena.width - RADIUS + EPS && p.y >= RADIUS - EPS && p.y <= arena.height - RADIUS + EPS
    && !arena.obstacles.some((r) => insideRect(p, r, RADIUS));
}

const clearWalk = (arena, a, b) => !arena.obstacles.some((r) => crosses(a, b, r, RADIUS));

// The shortest walking route from a to b, around obstacles by way of their corners.
// Returns the points after a (ending at b), or null if b can't be stood on or reached.
export function route(arena, a, b) {
  if (!standable(arena, b)) return null;
  if (clearWalk(arena, a, b)) return [b];
  const pad = RADIUS + 0.05;
  const nodes = [a, b];
  for (const r of arena.obstacles) {
    for (const [x, y] of [[r.x - pad, r.y - pad], [r.x + r.w + pad, r.y - pad], [r.x - pad, r.y + r.h + pad], [r.x + r.w + pad, r.y + r.h + pad]]) {
      const p = { x, y };
      if (standable(arena, p)) nodes.push(p);
    }
  }
  const n = nodes.length;
  const best = Array(n).fill(Infinity);
  const prev = Array(n).fill(-1);
  const done = Array(n).fill(false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && best[i] < Infinity && (u < 0 || best[i] < best[u])) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || !clearWalk(arena, nodes[u], nodes[v])) continue;
      const d = best[u] + dist(nodes[u], nodes[v]);
      if (d < best[v]) { best[v] = d; prev[v] = u; }
    }
  }
  if (best[1] === Infinity) return null;
  const out = [];
  for (let i = 1; i !== 0; i = prev[i]) out.unshift(nodes[i]);
  return out;
}

// A straight flight from a to b (Launch): null if an obstacle is in the way or b can't be stood on.
export function straight(arena, a, b) {
  return standable(arena, b) && clearWalk(arena, a, b) ? [b] : null;
}

export function pathLength(from, pts) {
  let len = 0;
  let p = from;
  for (const q of pts) { len += dist(p, q); p = q; }
  return len;
}

// The point s metres along the path from `from` through pts.
export function along(from, pts, s) {
  let p = from;
  for (const q of pts) {
    const d = dist(p, q);
    if (s <= d) {
      const k = d > 0 ? s / d : 0;
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
    s -= d;
    p = q;
  }
  return { x: p.x, y: p.y };
}

// Walk s metres along the path from `from` through pts: where you get to, and the points still ahead.
export function walkAlong(from, pts, s) {
  let p = from;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const d = dist(p, q);
    if (s < d - 1e-9) {
      const k = s / d;
      return { p: { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }, rest: pts.slice(i) };
    }
    s -= d;
    p = q;
  }
  return { p: { x: p.x, y: p.y }, rest: [] };
}

// Back s metres off from `from`: straight back if the way is clear, else along whatever is in
// the way, as long as that still opens the gap. Cornered, you stay put.
export function backOff(arena, p, from, s) {
  const d = dist(p, from);
  const base = d > EPS ? Math.atan2(p.y - from.y, p.x - from.x) : 0;
  let best = null;
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const q = { x: p.x + Math.cos(base + turn) * s, y: p.y + Math.sin(base + turn) * s };
    if (!standable(arena, q) || !clearWalk(arena, p, q)) continue;
    if (turn === 0) return q;
    const gain = dist(q, from) - d;
    if (gain > 1e-4 && (!best || gain > best.gain + 1e-9)) best = { q, gain };
  }
  return best ? best.q : p;
}

// The nearest spot a fighter can stand to p: p itself, or the closest found on rings around it.
export function nearestStandable(arena, p) {
  const c = { x: Math.min(arena.width - RADIUS, Math.max(RADIUS, p.x)), y: Math.min(arena.height - RADIUS, Math.max(RADIUS, p.y)) };
  if (standable(arena, c)) return c;
  for (let r = 0.25; r <= 6; r += 0.25) {
    let found = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      const q = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
      if (standable(arena, q) && (!found || dist(q, p) < dist(found, p))) found = q;
    }
    if (found) return found;
  }
  return null;
}

// A spot toward or away from the opponent: toward stops TOWARD_GAP short of them (or at `reach`),
// away goes straight back `reach` metres (AWAY_STEP if unlimited), kept inside the arena.
// Backing away (and any flight) stops short of obstacles instead of going around them; walking
// toward the opponent goes around whatever is between you.
export function spotFrom(arena, me, them, way, reach = Infinity, flight = false) {
  const d = dist(me, them);
  const ux = d > EPS ? (them.x - me.x) / d : 1;
  const uy = d > EPS ? (them.y - me.y) / d : 0;
  const full = way === 'toward' ? Math.min(reach, Math.max(0, d - TOWARD_GAP)) : -Math.min(reach, AWAY_STEP);
  const direct = flight || way === 'away';
  let fallback = null;
  for (let k = 1; k > 0.05; k -= 0.05) {
    const p = nearestStandable(arena, { x: me.x + ux * full * k, y: me.y + uy * full * k });
    const spot = p && { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    if (!spot) continue;
    if (!direct || straight(arena, me, spot)) return spot;
    fallback = fallback || spot;
  }
  return flight ? null : fallback;
}

// A point written as "x:y" (or "x,y").
export function parsePoint(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[:,]\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

export const pointText = (p) => `${Math.round(p.x * 10) / 10}:${Math.round(p.y * 10) / 10}`;
