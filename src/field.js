// The arena from above. Everything sits in a world layer the size of the whole arena; the
// camera is a transform on it that frames the fighters and whatever threatens them. Tokens
// persist between updates (matched by key), so fighters glide along the route they walked.
import { fmt } from './engine.js';
import { RANGES } from './rules.js';
import * as A from './arena.js';

const NS = 'http://www.w3.org/2000/svg';
const view = { game: null, picking: null, onPick: null, hoverAt: null, aiming: null, reach: null, onTarget: null, flight: null, onHover: null, whole: loadWhole() };
// What the mouse is on, for the page to preview (a spot "x:y", or a target id).
let hoverValue = null;
let lastHover = 'none';
// Per fighter: where the token was last sent, at what game time, and the route ahead then.
const trail = new Map();

function loadWhole() {
  try { return localStorage.getItem('fieldView') === 'whole'; } catch { return false; }
}

// ---------- camera ----------
const PAD = 5;         // metres kept clear around what's framed
const MIN_WIDTH = 24;  // the closest the camera gets
const MIN_HEIGHT = 11;
const STEP = 4;        // the view widens and narrows in steps, so it doesn't twitch

// The part of the arena to show: both fighters, where they're walking, and every area on the
// field or winding up. Game state only, so hovering never moves the camera.
function frame(game, aspect) {
  const { width: W, height: H } = game.arena;
  // The whole arena, with room to spare on whichever side the viewport is longer.
  const whole = Math.max(W, H * aspect);
  const centred = (w, cx, cy) => ({ x: cx - w / 2, y: cy - w / aspect / 2, w });
  if (view.whole) return centred(whole, W / 2, H / 2);
  const pts = [];
  for (const f of game.fighters) {
    pts.push(game.pos(f));
    if (f.walk || f.flight) { const r = game.routeAhead(f, game.time + 3); if (r) pts.push(r.path[r.path.length - 1]); }
    for (const z of f.zones) pts.push(...extent(z.shape));
  }
  for (const e of game.events) {
    const prof = e.action.kind === 'attack' && e.action.profile;
    if (prof && (prof.radius != null || prof.shape)) pts.push(...extent(game.areaShape(game.fighters[e.actor], prof, e.time)));
  }
  const clampX = (v) => Math.min(W, Math.max(0, v));
  const clampY = (v) => Math.min(H, Math.max(0, v));
  const x0 = clampX(Math.min(...pts.map((q) => q.x)) - PAD);
  const x1 = clampX(Math.max(...pts.map((q) => q.x)) + PAD);
  const y0 = clampY(Math.min(...pts.map((q) => q.y)) - PAD);
  const y1 = clampY(Math.max(...pts.map((q) => q.y)) + PAD);
  const w = Math.ceil(Math.max(MIN_WIDTH, MIN_HEIGHT * aspect, x1 - x0, (y1 - y0) * aspect) / STEP) * STEP;
  if (w >= whole) return centred(whole, W / 2, H / 2);
  // Stay inside the arena where the view fits in it; otherwise centre on it.
  const h = w / aspect;
  const within = (c, size, max) => (size >= max ? max / 2 : Math.min(max - size / 2, Math.max(size / 2, c)));
  return centred(w, within(Math.round((x0 + x1) / 2), w, W), within(Math.round((y0 + y1) / 2), h, H));
}

const extent = (shape) => (shape.shape === 'line' ? [shape.from, shape.to]
  : [{ x: shape.centre.x - shape.radius, y: shape.centre.y - shape.radius }, { x: shape.centre.x + shape.radius, y: shape.centre.y + shape.radius }]);

function aim(world, game) {
  const { width: W, height: H } = game.arena;
  const port = world.parentElement;
  if (!port.clientHeight) return;
  const v = frame(game, port.clientWidth / port.clientHeight);
  const zoom = W / v.w;
  world.style.setProperty('--zoom', zoom);
  world.style.transform = `translate(${(-v.x / W) * 100 * zoom}%, ${(-v.y / H) * 100 * zoom}%) scale(${zoom})`;
}

// ---------- what just happened ----------
// Hits, misses and breaks float up from the fighter they landed on; a technique shown for the
// first time gets a banner.
export function showFx(game, list) {
  const arena = document.querySelector('#field .arena');
  if (!arena || !list.length) return;
  const n = [0, 0];
  for (const fx of list) {
    const f = game.fighters[fx.on];
    if (fx.kind === 'reveal') {
      const el = div(`reveal theme-${f.theme}`, `<span>${f.name} shows</span><b>${fx.text}</b>`);
      arena.querySelector('.reveals').appendChild(el);
      setTimeout(() => el.remove(), 2600);
      continue;
    }
    const token = arena.querySelector(`.ftoken[data-key="${fx.on}"]`);
    if (!token) continue;
    const el = div(`fx fx-${fx.kind}`, fx.text);
    const delay = n[fx.on]++ * 280;
    el.style.animationDelay = `${delay}ms`;
    token.appendChild(el);
    setTimeout(() => el.remove(), delay + 1700);
    if (fx.kind === 'hit' || fx.kind === 'spirit') {
      token.classList.remove('struck');
      requestAnimationFrame(() => token.classList.add('struck'));
      setTimeout(() => token.classList.remove('struck'), 600);
    }
  }
}
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Keep one child element per key inside `parent`: create missing ones, update all, remove stale ones.
function sync(parent, selector, items, keyOf, create, update) {
  const existing = new Map([...parent.querySelectorAll(`:scope > ${selector}`)].map((el) => [el.dataset.key, el]));
  for (const item of items) {
    const key = String(keyOf(item));
    let el = existing.get(key);
    if (!el) {
      el = create(item);
      el.dataset.key = key;
      el.classList.add('fresh');
      parent.appendChild(el);
      setTimeout(() => el.classList.remove('fresh'), 30);
    }
    existing.delete(key);
    update(el, item);
  }
  for (const el of existing.values()) el.remove();
}

function div(cls, html = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return el;
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// An area's shape on the map: a circle, or a beam drawn as a rectangle along its line.
function shapeEl(shape, cls) {
  if (shape.shape === 'line') {
    const { from, to, width } = shape;
    const L = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const nx = (-(to.y - from.y) / L) * (width / 2);
    const ny = ((to.x - from.x) / L) * (width / 2);
    const pts = [[from.x + nx, from.y + ny], [to.x + nx, to.y + ny], [to.x - nx, to.y - ny], [from.x - nx, from.y - ny]];
    return svg('polygon', { class: cls, points: pts.map((q) => q.join(',')).join(' ') });
  }
  return svg('circle', { class: cls, cx: shape.centre.x, cy: shape.centre.y, r: shape.radius });
}

const progress = (game, w) => Math.min(1, Math.max(0, (game.time - w.start) / Math.max(0.01, w.end - w.start)));
const points = (from, path) => [from, ...path].map((p) => `${p.x},${p.y}`).join(' ');

// Place an HTML element at a point on the arena.
const pctOf = (game, p) => ({ left: `${(p.x / game.arena.width) * 100}%`, top: `${(p.y / game.arena.height) * 100}%` });
function place(el, game, p) {
  Object.assign(el.style, pctOf(game, p));
}

// Move a fighter's token to where they are now, sliding along the route they were on at the
// last update (through its corners) when that's where they went.
function glide(el, game, f, now) {
  const key = `${f.index}`;
  const last = trail.get(key);
  const ahead = f.walk || f.flight ? game.routeAhead(f, game.time + 10) : null;
  trail.set(key, { game, time: game.time, p: now, ahead });
  place(el, game, now);
  if (!last || last.game !== game || game.time < last.time || reduceMotion) return;

  // Start from where the token is drawn right now, in case it's still gliding.
  let start = last.p;
  if (el.glide && el.glide.playState === 'running') {
    const box = el.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    start = { x: ((r.left - box.left) / box.width) * game.arena.width, y: ((r.top - box.top) / box.height) * game.arena.height };
    el.glide.cancel();
  }
  // The points of the old route up to the one nearest where they are now, if they kept to it.
  const pts = [start];
  if (last.ahead) {
    const path = last.ahead.path;
    let near = -1;
    path.forEach((p, i) => { if (A.dist(p, now) < 1 && (near < 0 || A.dist(p, now) <= A.dist(path[near], now))) near = i; });
    if (near >= 0) pts.push(...path.slice(0, near));
  }
  pts.push(now);
  const route = pts.filter((p, i) => i === 0 || A.dist(p, pts[i - 1]) > 0.01);
  if (route.length < 2) return;
  const len = A.pathLength(route[0], route.slice(1));
  let walked = 0;
  const frames = route.map((p, i) => {
    if (i) walked += A.dist(route[i - 1], p);
    return { ...pctOf(game, p), offset: len > 0 ? walked / len : i / (route.length - 1) };
  });
  el.glide = el.animate(frames, { duration: Math.min(1400, 400 + 45 * len), easing: 'ease-in-out' });
}

function build(root, game) {
  const { width: W, height: H } = game.arena;
  root.innerHTML = `<div class="field-head"><span class="label">${game.arena.name}</span><span class="rng"></span><span class="field-info"></span>
      <span class="q-toggle"><button class="ghost" data-fview="follow">Follow</button><button class="ghost" data-fview="whole">Whole arena</button></span></div>
    <div class="arena-wrap"><div class="arena"><div class="world" style="aspect-ratio:${W} / ${H}"><div class="arena-tip" hidden></div></div><div class="reveals"></div></div></div>`;
  const arena = root.querySelector('.arena');
  const world = arena.querySelector('.world');
  arena.dataset.layout = `${game.arena.name}:world`;
  new ResizeObserver(() => aim(world, view.game)).observe(arena);
  root.querySelector('.q-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fview]');
    if (!b) return;
    view.whole = b.dataset.fview === 'whole';
    try { localStorage.setItem('fieldView', view.whole ? 'whole' : 'follow'); } catch { /* storage unavailable */ }
    renderField(view.game, view.opts);
  });
  const s = svg('svg', { class: 'arena-svg', viewBox: `0 0 ${W} ${H}` });
  const grid = svg('g', { class: 'grid' });
  for (let x = 2; x < W; x += 2) grid.appendChild(svg('line', { x1: x, y1: 0, x2: x, y2: H }));
  for (let y = 2; y < H; y += 2) grid.appendChild(svg('line', { x1: 0, y1: y, x2: W, y2: y }));
  s.appendChild(grid);
  for (const r of game.arena.obstacles) {
    const o = svg('rect', { class: `obstacle ${r.name}`, x: r.x, y: r.y, width: r.w, height: r.h, rx: r.name === 'pillar' ? 0.3 : 0.15 });
    o.appendChild(svg('title')).textContent = r.name;
    s.appendChild(o);
  }
  for (const layer of ['areas', 'rings', 'sight', 'routes', 'plan', 'hover']) s.appendChild(svg('g', { class: layer }));
  world.prepend(s);
  world.appendChild(div('sight-label'));

  arena.addEventListener('mousemove', (e) => {
    view.hoverAt = toPoint(arena, e);
    drawHover(arena);
  });
  arena.addEventListener('mouseleave', () => {
    view.hoverAt = null;
    drawHover(arena);
  });
  arena.addEventListener('click', (e) => {
    if (view.picking == null) return;
    if (view.reach) {
      const t = snapTarget(toPoint(arena, e));
      if (t) {
        if (t.ok && view.onTarget) view.onTarget(view.reach.key, t.id);
        return;
      }
    }
    if (view.onPick) view.onPick(A.pointText(toPoint(arena, e)));
  });
}

// The arena point under the mouse, snapped to half a metre.
function toPoint(arena, e) {
  const r = arena.querySelector('.world').getBoundingClientRect();
  const { width: W, height: H } = view.game.arena;
  const snap = (v) => Math.round(v * 2) / 2;
  return { x: snap(((e.clientX - r.left) / r.width) * W), y: snap(((e.clientY - r.top) / r.height) * H) };
}

// A targeted attack is open: the target nearest the mouse (the opponent, or one of their constructs).
function snapTarget(p) {
  const list = view.reach ? view.reach.targets : [];
  let best = null;
  for (const t of list) {
    const d = Math.hypot(t.at.x - p.x, t.at.y - p.y);
    if (!best || d < best.d) best = { ...t, d };
  }
  return best && best.d < 3 ? best : null;
}

// Draw the hover, then tell the page what's under the mouse when that changes, so it can
// preview the choice there (a move's time on the timeline, say).
function drawHover(arena) {
  hoverValue = null;
  drawHoverAt(arena);
  const key = hoverValue == null ? 'none' : `v:${hoverValue}`;
  if (key !== lastHover) {
    lastHover = key;
    if (view.onHover) view.onHover(hoverValue);
  }
}

// Walking: the route to the spot under the mouse. Launch: the flight there.
// While a targeted attack is open: which target the mouse is on, and whether it's in reach
// (away from any target, walking as usual).
function drawHoverAt(arena) {
  const layer = arena.querySelector('.hover');
  const tip = arena.querySelector('.arena-tip');
  layer.replaceChildren();
  tip.hidden = true;
  arena.classList.toggle('picking', view.picking != null);
  const game = view.game;
  if (view.picking == null || !view.hoverAt || !game) return;
  const f = game.fighters[view.picking];
  place(tip, game, view.hoverAt);
  tip.classList.toggle('flip', view.hoverAt.x > game.arena.width * 0.6);
  tip.hidden = false;
  const t = view.reach ? snapTarget(view.hoverAt) : null;
  if (t) {
    layer.appendChild(svg('circle', { class: `snap${t.ok ? '' : ' bad'}`, cx: t.at.x, cy: t.at.y }));
    tip.classList.toggle('bad', !t.ok);
    tip.textContent = t.ok ? `${t.label}${t.chance != null ? ` · ${Math.round(t.chance * 100)}% to hit` : ''} · click to target` : `${t.label}: ${t.why}`;
    if (t.ok) hoverValue = t.id;
    return;
  }
  if (view.aiming) {
    // Aiming an area: the shape it would make here, and whether the opponent is inside it now.
    const prof = game.attackProfile(f, view.aiming.key, view.aiming.amount);
    const o = game.opponent(f);
    const g = svg('g', { class: `theme-${f.theme}` });
    layer.appendChild(g);
    if (prof.shape === 'line') {
      const line = game.planLine(f, prof, view.hoverAt);
      tip.classList.toggle('bad', !!line.error);
      if (line.error) { tip.textContent = line.error; return; }
      const shape = { shape: 'line', from: line.origin, to: line.end, width: prof.width };
      g.appendChild(shapeEl(shape, 'area aim'));
      const k = game.inArea(shape, game.pos(o));
      tip.textContent = `${fmt(A.dist(line.origin, line.end))} m beam · ${o.name} ${k.inside ? 'in its path' : 'out of its path'} now`;
      hoverValue = A.pointText(view.hoverAt);
      return;
    }
    const spot = game.planArea(f, prof, view.hoverAt);
    g.appendChild(svg('circle', { class: `area aim${spot.error ? ' bad' : ''}`, cx: view.hoverAt.x, cy: view.hoverAt.y, r: prof.radius }));
    tip.classList.toggle('bad', !!spot.error);
    if (spot.error) { tip.textContent = spot.error; return; }
    const k = game.areaCatch(spot.centre, prof.radius, game.pos(o), prof.fills);
    tip.textContent = `${fmt(spot.dist)} m away · ${fmt(prof.radius)} m radius · ${o.name} ${k.inside ? 'inside' : k.outside ? 'outside' : `behind a ${k.blockedBy.name}`} now`;
    hoverValue = A.pointText(view.hoverAt);
    return;
  }
  const plan = view.flight ? game.planMove(f, view.hoverAt, view.flight) : game.planMove(f, view.hoverAt);
  if (plan.error) {
    tip.textContent = plan.error;
    tip.classList.add('bad');
    layer.appendChild(svg('circle', { class: 'spot bad', cx: view.hoverAt.x, cy: view.hoverAt.y }));
    return;
  }
  tip.classList.remove('bad');
  if (view.flight) {
    const gap = A.dist(plan.dest, game.pos(game.opponent(f), game.time + view.flight.travel));
    tip.textContent = `${fmt(plan.length)} m · lands in ${fmt(view.flight.travel)} · ${RANGES[A.bandOf(gap)]} (${fmt(gap)} m)`;
  } else tip.textContent = `${fmt(plan.length)} m · click to walk here`;
  const g = svg('g', { class: `theme-${f.theme}` });
  hoverValue = A.pointText(view.hoverAt);
  g.appendChild(svg('polyline', { class: 'route hover-route', points: points(plan.from, plan.path) }));
  g.appendChild(svg('circle', { class: 'spot', cx: plan.dest.x, cy: plan.dest.y }));
  layer.appendChild(g);
}

// opts.picking: index of the fighter choosing a spot (a person's decision), or null.
// opts.plan: a route to show as a ghost ({ who, from, path }).
// opts.onPick: called with "x:y" when the field is clicked while picking.
export function renderField(game, opts = {}) {
  const root = document.getElementById('field');
  if (!root) return;
  view.game = game;
  view.opts = opts;
  view.aiming = opts.aiming || null;
  view.reach = opts.reach || null;
  view.flight = opts.flight || null;
  view.picking = opts.picking ?? null;
  view.onPick = opts.onPick || null;
  view.onTarget = opts.onTarget || null;
  view.onHover = opts.onHover || null;
  // A new decision: report the spot under the mouse afresh.
  if (view.decision !== game.decision) { view.decision = game.decision; lastHover = 'none'; }
  if (root.querySelector('.arena')?.dataset.layout !== `${game.arena.name}:world`) build(root, game);
  const arena = root.querySelector('.arena');
  const world = arena.querySelector('.world');
  aim(world, game);
  root.querySelectorAll('[data-fview]').forEach((b) => b.classList.toggle('on', (b.dataset.fview === 'whole') === view.whole));
  const pos = game.fighters.map((f) => game.pos(f));
  const sight = game.sight(pos[0], pos[1]);

  // The range, shown once: the band the fighters are in, with the gap.
  root.querySelector('.field-info').textContent = sight.blockedBy ? `a ${sight.blockedBy.name} blocks the line between them` : '';
  root.querySelector('.rng').innerHTML = RANGES.map((r, i) => `<span class="${i === sight.band ? 'on' : ''}">${r}${i === sight.band ? ` · ${fmt(sight.dist)} m` : ''}</span>`).join('');

  // Range rings around whoever is acting (or the first fighter between turns).
  const acting = game.prompt && game.prompt.fighter != null ? game.fighters[game.prompt.fighter] : game.fighters[0];
  const rings = arena.querySelector('.rings');
  rings.setAttribute('class', `rings theme-${acting.theme}`);
  // An open targeted attack shows its own reach instead: best distance dashed, farthest solid,
  // and marks each target in or out of reach.
  if (view.reach) {
    const at = pos[acting.index];
    const { best, max } = view.reach.spec;
    const els = [];
    if (Number.isFinite(max)) els.push(svg('circle', { class: 'reach', cx: at.x, cy: at.y, r: max }));
    if (best < (Number.isFinite(max) ? max - 0.01 : 60)) els.push(svg('circle', { class: 'reach best', cx: at.x, cy: at.y, r: best }));
    for (const t of view.reach.targets) els.push(svg('circle', { class: `target${t.ok ? '' : ' out'}${t.chosen ? ' chosen' : ''}`, cx: t.at.x, cy: t.at.y }));
    rings.replaceChildren(...els);
  } else rings.replaceChildren(...A.BANDS.map((r) => svg('circle', { cx: pos[acting.index].x, cy: pos[acting.index].y, r })));

  // The line between the fighters, broken when an obstacle blocks it.
  arena.querySelector('.sight').replaceChildren(svg('line', {
    class: sight.blockedBy ? 'blocked' : '', x1: pos[0].x, y1: pos[0].y, x2: pos[1].x, y2: pos[1].y,
  }));
  const label = arena.querySelector('.sight-label');
  place(label, game, { x: (pos[0].x + pos[1].x) / 2, y: (pos[0].y + pos[1].y) / 2 });
  label.textContent = `${fmt(sight.dist)} m`;

  // Courses: where each walker (or flight) goes over the next few ticks, as things stand.
  arena.querySelector('.routes').replaceChildren(...game.fighters.filter((f) => f.walk || f.flight).map((f) => {
    const arr = f.flight ? f.flight.end : game.arrival(f, 6);
    const r = game.routeAhead(f, arr ?? game.time + 6);
    const g = svg('g', { class: `theme-${f.theme}` });
    if (!r) return g;
    g.appendChild(svg('polyline', { class: 'route', points: points(r.from, r.path) }));
    const end = r.path[r.path.length - 1];
    g.appendChild(svg('circle', { class: 'spot', cx: end.x, cy: end.y }));
    g.appendChild(svg('title')).textContent = `${f.name}: ${f.flight ? 'flying' : `walking ${game.walkText(f)}`}${arr != null ? `, arrives t=${fmt(arr)}` : ''}`;
    return g;
  }));

  // Zones lingering on the field, area attacks winding up (where they'll be when they land),
  // and the hovered card's.
  const areas = game.fighters.flatMap((f) => (f.zones || []).map((z) => {
    const g = svg('g', { class: `theme-${f.theme}` });
    g.appendChild(shapeEl(z.shape, 'area zone'));
    g.appendChild(svg('title')).textContent = `${f.name}'s ${z.name}: until t=${fmt(z.until)}${z.slow ? `, Speed −${Math.round(z.slow * 100)}% inside` : ''}`;
    return g;
  }));
  for (const e of game.events) {
    const prof = e.action.kind === 'attack' && e.action.profile;
    if (!prof || !(prof.radius != null || prof.shape)) continue;
    const f = game.fighters[e.actor];
    const g = svg('g', { class: `theme-${f.theme}` });
    g.appendChild(shapeEl(game.areaShape(f, prof, e.time), `area pending${prof.zone ? ' zone' : ''}`));
    g.appendChild(svg('title')).textContent = `${f.name}'s ${prof.name}: ${prof.zone ? 'forms' : 'lands'} t=${fmt(e.time)}`;
    areas.push(g);
  }
  if (opts.area && opts.area.shape) {
    const g = svg('g', { class: `theme-${game.fighters[opts.area.who].theme}` });
    g.appendChild(shapeEl(opts.area.shape, `area ghost${opts.area.zone ? ' zone' : ''}`));
    areas.push(g);
  }
  arena.querySelector('.areas').replaceChildren(...areas);

  // A previewed route (hovering a move card, or the destination already chosen).
  const plan = opts.plan;
  arena.querySelector('.plan').replaceChildren(...(plan ? [(() => {
    const g = svg('g', { class: `theme-${game.fighters[plan.who].theme}` });
    g.appendChild(svg('polyline', { class: 'route plan-route', points: points(plan.from, plan.path) }));
    const end = plan.path[plan.path.length - 1];
    g.appendChild(svg('circle', { class: 'spot', cx: end.x, cy: end.y }));
    return g;
  })()] : []));

  sync(world, '.ftoken', game.fighters, (f) => f.index, (f) => div(`ftoken theme-${f.theme}`, `
      <div class="fstars"></div><div class="fbody"><div class="fbarrier"></div><div class="fdot">${f.name[0]}</div></div>
      <div class="fwindups"></div><div class="fname">${f.name}</div><div class="fstances"></div>`),
  (el, f) => {
    // A restart can swap fighters into the same slot: refresh name and theme every time.
    el.className = `ftoken theme-${f.theme}`;
    el.querySelector('.fdot').textContent = f.name[0];
    el.querySelector('.fname').textContent = f.name;
    glide(el, game, f, pos[f.index]);
    el.classList.toggle('right', pos[f.index].x > pos[1 - f.index].x);
    el.classList.toggle('moving', !!(f.walk || f.flight));
    el.classList.toggle('acting', acting === f && !!game.prompt && game.prompt.kind !== 'over');
    const stances = game.activeStances(f);
    el.querySelector('.fbody').classList.toggle('has-stance', stances.length > 0);
    const rings = game.rings(f).length;
    el.querySelector('.fstances').textContent = [
      ...stances.map((s) => { const b = game.buildUp(f, s); return b ? `${s.name} ·${b}` : s.name; }),
      ...(rings ? [`${rings} ring${rings > 1 ? 's' : ''}`] : []),
    ].join(' · ');

    // Barrier: a shield ring around the fighter, more solid with more HP.
    const barrier = game.barrier(f);
    const bar = el.querySelector('.fbarrier');
    bar.style.opacity = barrier ? String(0.35 + 0.65 * Math.min(1, barrier.hp / Math.max(1, barrier.maxHp))) : '0';
    bar.title = barrier ? `${barrier.name}: ${fmt(barrier.hp)} HP` : '';

    // Wind-ups other than forging stars: orbs beside the fighter, fading in as they build.
    const windups = f.windups.filter((w) => !/^Crown star/.test(w.label));
    sync(el.querySelector('.fwindups'), '.forb', windups, (w) => w.eventId ?? w.label, () => div('forb', '<span></span>'), (orb, w) => {
      const p = progress(game, w);
      orb.style.opacity = String(0.45 + 0.55 * p);
      orb.style.setProperty('--p', p);
      orb.querySelector('span').textContent = w.label;
      const detail = game.describeWindup(w);
      orb.title = `${w.label}: lands t=${fmt(w.end)}${detail ? `\n${detail}` : ''}`;
    });

    // Crown stars hang high over their owner.
    const stars = [
      ...f.constructs.filter((c) => c.kind === 'star').map((c) => ({ key: c.id, p: 1, title: `${c.name}: ${fmt(c.hp)} HP, high overhead` })),
      ...f.windups.filter((w) => /^Crown star/.test(w.label)).map((w) => ({ key: `w${w.eventId}`, p: progress(game, w), title: `${w.label} forming: t=${fmt(w.end)}` })),
    ];
    sync(el.querySelector('.fstars'), '.fstar', stars, (s) => s.key, () => div('fstar', '★'), (st, s) => {
      st.style.opacity = String(s.p >= 1 ? 1 : 0.35 + 0.45 * s.p);
      st.classList.toggle('forming', s.p < 1);
      st.title = s.title;
    });
  });

  drawHover(arena);
}
