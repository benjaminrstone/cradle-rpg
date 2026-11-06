// Field map: the arena from above, with its obstacles, both fighters, their stances, wind-ups,
// barriers and Crown stars, the line between them, and range rings around whoever is acting.
// Tokens persist between updates (matched by key), so fighters glide to new positions along
// the route they walked, and wind-ups fade in as they build instead of the map redrawing.
// On your turn, hovering the field shows the route a move would take, and a click picks it.
// Area attacks show as circles: ones winding up, the hovered card's, and (while aiming an area set
// at a point) the one under the mouse.
import { fmt } from './engine.js';
import { RANGES, moveTime } from './rules.js';
import * as A from './arena.js';

const NS = 'http://www.w3.org/2000/svg';
const view = { game: null, picking: null, onPick: null, hoverAt: null, aiming: null, reach: null, onTarget: null, flight: null };
// Per fighter: where the token was last sent, at what game time, and the moves seen so far.
const trail = new Map();
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

// The corners of a move's route still ahead at time t.
function remaining(m, t) {
  const done = Math.min(1, Math.max(0, (t - m.start) / Math.max(0.01, m.end - m.start))) * A.pathLength(m.from, m.path);
  let walked = 0;
  let prev = m.from;
  const out = [];
  for (const p of m.path) {
    walked += A.dist(prev, p);
    prev = p;
    if (walked > done + 1e-6 || out.length) out.push(p);
  }
  return out.length ? out : [m.path[m.path.length - 1]];
}

// Place an HTML element at a point on the arena.
const pctOf = (game, p) => ({ left: `${(p.x / game.arena.width) * 100}%`, top: `${(p.y / game.arena.height) * 100}%` });
function place(el, game, p) {
  Object.assign(el.style, pctOf(game, p));
}

// The corners of move m passed between times t0 and t1, in order.
function cornersBetween(m, t0, t1) {
  const len = A.pathLength(m.from, m.path);
  const at = (t) => Math.min(1, Math.max(0, (t - m.start) / Math.max(0.01, m.end - m.start))) * len;
  const s0 = at(t0);
  const s1 = at(t1);
  const out = [];
  let walked = 0;
  let prev = m.from;
  for (const p of m.path) {
    walked += A.dist(prev, p);
    prev = p;
    if (walked > s0 + 1e-6 && walked <= s1 + 1e-6) out.push(p);
  }
  return out;
}

// Move a fighter's token to where they are now, sliding along the route they walked since the
// last update: through each corner of any move in progress or finished in between.
function glide(el, game, f, now) {
  const key = `${f.index}`;
  const last = trail.get(key);
  const moves = (last && last.game === game ? last.moves : []).filter((m) => m.end > (last ? last.time : 0));
  if (f.moving && !moves.some((m) => m.start === f.moving.start && m.end === f.moving.end)) moves.push(f.moving);
  trail.set(key, { game, time: game.time, p: now, moves });
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
  const pts = [start];
  for (const m of moves.sort((a, b) => a.start - b.start)) pts.push(...cornersBetween(m, last.time, game.time));
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

// Build the arena once per layout: the floor grid, obstacles and the layers drawn over them.
function build(root, game) {
  const { width: W, height: H } = game.arena;
  root.innerHTML = `<div class="field-head"><span class="label">${game.arena.name}</span><span class="field-info"></span><span class="rng"></span></div>
    <div class="arena-wrap"><div class="arena" style="aspect-ratio:${W} / ${H}; --aspect:${W / H}"><div class="arena-tip" hidden></div></div></div>`;
  const arena = root.querySelector('.arena');
  arena.dataset.layout = `${game.arena.name}:areas`;
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
  arena.prepend(s);
  arena.appendChild(div('sight-label'));

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
      if (t && t.ok && view.onTarget) view.onTarget(view.reach.key, t.id);
      return;
    }
    if (view.onPick) view.onPick(A.pointText(toPoint(arena, e)));
  });
}

// The arena point under the mouse, snapped to half a metre.
function toPoint(arena, e) {
  const r = arena.getBoundingClientRect();
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

// While picking a destination: the route to the spot under the mouse, how long it takes, and the range then.
// While a targeted attack is open: which target the mouse is on, and whether it's in reach.
function drawHover(arena) {
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
  if (view.reach) {
    const t = snapTarget(view.hoverAt);
    if (!t) { tip.hidden = true; return; }
    layer.appendChild(svg('circle', { class: `snap${t.ok ? '' : ' bad'}`, cx: t.at.x, cy: t.at.y, r: 1.1 }));
    tip.classList.toggle('bad', !t.ok);
    tip.textContent = t.ok ? `${t.label}${t.chance != null ? ` · ${Math.round(t.chance * 100)}% to hit` : ''} · click to target` : `${t.label}: ${t.why}`;
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
      return;
    }
    const spot = game.planArea(f, prof, view.hoverAt);
    g.appendChild(svg('circle', { class: `area aim${spot.error ? ' bad' : ''}`, cx: view.hoverAt.x, cy: view.hoverAt.y, r: prof.radius }));
    tip.classList.toggle('bad', !!spot.error);
    if (spot.error) { tip.textContent = spot.error; return; }
    const k = game.areaCatch(spot.centre, prof.radius, game.pos(o));
    tip.textContent = `${fmt(spot.dist)} m away · ${fmt(prof.radius)} m radius · ${o.name} ${k.inside ? 'inside' : k.outside ? 'outside' : `behind a ${k.blockedBy.name}`} now`;
    return;
  }
  const plan = view.flight ? game.planMove(f, view.hoverAt, view.flight) : game.planMove(f, view.hoverAt);
  if (plan.error) {
    tip.textContent = plan.error;
    tip.classList.add('bad');
    layer.appendChild(svg('circle', { class: 'spot bad', cx: view.hoverAt.x, cy: view.hoverAt.y, r: 0.35 }));
    return;
  }
  const w = view.flight ? view.flight.travel : moveTime(plan.length, game.speed(f));
  const o = game.opponent(f);
  const gap = A.dist(plan.dest, game.pos(o, game.time + w));
  tip.classList.remove('bad');
  tip.textContent = `${fmt(plan.length)} m · ${fmt(w)} ticks · ${RANGES[A.bandOf(gap)]} (${fmt(gap)} m)`;
  const g = svg('g', { class: `theme-${f.theme}` });
  g.appendChild(svg('polyline', { class: 'route hover-route', points: points(plan.from, plan.path) }));
  g.appendChild(svg('circle', { class: 'spot', cx: plan.dest.x, cy: plan.dest.y, r: 0.35 }));
  layer.appendChild(g);
}

// opts.picking: index of the fighter choosing a destination (a person's turn), or null.
// opts.plan: a route to show as a ghost ({ who, from, path }), e.g. the hovered move card's.
// opts.onPick: called with "x:y" when the field is clicked while picking.
export function renderField(game, opts = {}) {
  const root = document.getElementById('field');
  if (!root) return;
  view.game = game;
  view.aiming = opts.aiming || null;
  view.reach = opts.reach || null;
  view.flight = opts.flight || null;
  view.picking = opts.picking ?? null;
  view.onPick = opts.onPick || null;
  view.onTarget = opts.onTarget || null;
  if (root.querySelector('.arena')?.dataset.layout !== `${game.arena.name}:areas`) build(root, game);
  const arena = root.querySelector('.arena');
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
    for (const t of view.reach.targets) els.push(svg('circle', { class: `target${t.ok ? '' : ' out'}${t.chosen ? ' chosen' : ''}`, cx: t.at.x, cy: t.at.y, r: 0.9 }));
    rings.replaceChildren(...els);
  } else rings.replaceChildren(...A.BANDS.map((r) => svg('circle', { cx: pos[acting.index].x, cy: pos[acting.index].y, r })));

  // The line between the fighters, broken when an obstacle blocks it.
  arena.querySelector('.sight').replaceChildren(svg('line', {
    class: sight.blockedBy ? 'blocked' : '', x1: pos[0].x, y1: pos[0].y, x2: pos[1].x, y2: pos[1].y,
  }));
  const label = arena.querySelector('.sight-label');
  place(label, game, { x: (pos[0].x + pos[1].x) / 2, y: (pos[0].y + pos[1].y) / 2 });
  label.textContent = `${fmt(sight.dist)} m`;

  // Moves in progress: the rest of the route, to where they'll arrive.
  arena.querySelector('.routes').replaceChildren(...game.fighters.filter((f) => f.moving).map((f) => {
    const m = f.moving;
    const g = svg('g', { class: `theme-${f.theme}` });
    g.appendChild(svg('polyline', { class: 'route', points: points(pos[f.index], remaining(m, game.time)) }));
    const end = m.path[m.path.length - 1];
    g.appendChild(svg('circle', { class: 'spot', cx: end.x, cy: end.y, r: 0.35 }));
    g.appendChild(svg('title')).textContent = `${f.name} arrives t=${fmt(m.end)}`;
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
    g.appendChild(svg('circle', { class: 'spot', cx: end.x, cy: end.y, r: 0.35 }));
    return g;
  })()] : []));

  sync(arena, '.ftoken', game.fighters, (f) => f.index, (f) => div(`ftoken theme-${f.theme}`, `
      <div class="fstars"></div><div class="fbody"><div class="fbarrier"></div><div class="fdot">${f.name[0]}</div></div>
      <div class="fwindups"></div><div class="fname">${f.name}</div><div class="fstances"></div>`),
  (el, f) => {
    // A restart can swap fighters into the same slot: refresh name and theme every time.
    el.className = `ftoken theme-${f.theme}`;
    el.querySelector('.fdot').textContent = f.name[0];
    el.querySelector('.fname').textContent = f.name;
    glide(el, game, f, pos[f.index]);
    // Labels go on the side away from the opponent, so the two don't overlap.
    el.classList.toggle('right', pos[f.index].x > pos[1 - f.index].x);
    el.classList.toggle('moving', !!f.moving);
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
