// Field map: a strip showing both fighters at their range, with their stances, wind-ups,
// barriers and Crown stars. Elements persist between updates (matched by key), so positions
// slide and wind-ups fade in as they build instead of the strip redrawing.
import { fmt } from './engine.js';
import { RANGES } from './rules.js';

// Gap between the fighters, as % of the strip, at each range band.
const GAP = [16, 44, 76];

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

const progress = (game, w) => Math.min(1, Math.max(0, (game.time - w.start) / Math.max(0.01, w.end - w.start)));

// Where each fighter stands (% from the left), including a move in progress.
function positions(game) {
  const base = GAP[game.distance];
  const x = [50 - base / 2, 50 + base / 2];
  game.fighters.forEach((f, i) => {
    const m = f.moving;
    if (!m || m.start == null) return;
    const target = GAP[Math.min(2, Math.max(0, game.distance + m.dir))];
    const p = Math.min(1, Math.max(0, (game.time - m.start) / Math.max(0.01, m.end - m.start)));
    x[i] += (i === 0 ? -1 : 1) * ((target - base) / 2) * p;
  });
  return x;
}

export function renderField(game) {
  const root = document.getElementById('field');
  if (!root) return;
  if (!root.querySelector('.field-stage')) {
    root.innerHTML = `<div class="section-label">Field</div>
      <div class="field-stage"><div class="field-ground"></div><div class="field-gap"><span class="field-range"></span></div></div>`;
  }
  const stage = root.querySelector('.field-stage');
  const x = positions(game);

  // The gap between the fighters, labelled with the range band.
  const gap = stage.querySelector('.field-gap');
  gap.style.left = `${x[0]}%`;
  gap.style.width = `${x[1] - x[0]}%`;
  gap.querySelector('.field-range').textContent = RANGES[game.distance];

  sync(stage, '.ftoken', game.fighters, (f) => f.index, (f) => div(`ftoken theme-${f.theme}`, `
      <div class="fbody"><div class="fwindups"></div><div class="fbarrier"></div><div class="fdot">${f.name[0]}</div></div>
      <div class="fname">${f.name}</div><div class="fstances"></div>`),
  (el, f) => {
    // A restart can swap fighters into the same slot: refresh name and theme every time.
    el.className = `ftoken theme-${f.theme}`;
    el.querySelector('.fdot').textContent = f.name[0];
    el.querySelector('.fname').textContent = f.name;
    el.style.left = `${x[f.index]}%`;
    el.classList.toggle('right', f.index === 1);
    el.classList.toggle('moving', !!f.moving);
    const stances = game.activeStances(f);
    const body = el.querySelector('.fbody');
    body.style.setProperty('--rings', stances.length);
    body.classList.toggle('has-stance', stances.length > 0);
    el.querySelector('.fstances').textContent = stances.map((s) => {
      const b = game.buildUp(f, s);
      return b ? `${s.name} ·${b}` : s.name;
    }).join(' · ');

    // Barrier: a shield bar facing the opponent, more solid with more HP.
    const barrier = game.barrier(f);
    const bar = el.querySelector('.fbarrier');
    bar.style.opacity = barrier ? String(0.35 + 0.65 * Math.min(1, barrier.hp / Math.max(1, barrier.maxHp))) : '0';
    bar.title = barrier ? `${barrier.name}: ${fmt(barrier.hp)} HP` : '';

    // Wind-ups other than forging stars: orbs on the side facing the opponent, fading in as they build.
    const windups = f.windups.filter((w) => !/^Crown star/.test(w.label));
    sync(el.querySelector('.fwindups'), '.forb', windups, (w) => w.eventId ?? w.label, () => div('forb', '<span></span>'), (orb, w) => {
      const p = progress(game, w);
      orb.style.opacity = String(0.45 + 0.55 * p);
      orb.style.setProperty('--p', p);
      orb.querySelector('span').textContent = w.label;
      const detail = game.describeWindup(w);
      orb.title = `${w.label}: lands t=${fmt(w.end)}${detail ? `\n${detail}` : ''}`;
    });

  });

  // Crown stars hang high overhead at Far range: drawn that far from the opponent, on the owner's side.
  sync(stage, '.fstars', game.fighters, (f) => f.index, (f) => div(`fstars theme-${f.theme}`), (group, f) => {
    group.className = `fstars theme-${f.theme}`;
    const other = x[1 - f.index];
    group.style.left = `${Math.min(96, Math.max(4, other + (f.index === 0 ? -GAP[2] : GAP[2])))}%`;
    const stars = [
      ...f.constructs.filter((c) => c.kind === 'star').map((c) => ({ key: c.id, label: c.name, p: 1, title: `${c.name}: ${fmt(c.hp)} HP` })),
      ...f.windups.filter((w) => /^Crown star/.test(w.label)).map((w) => ({ key: `w${w.eventId}`, label: w.label, p: progress(game, w), title: `${w.label} forming: t=${fmt(w.end)}` })),
    ];
    sync(group, '.fstar', stars, (s) => s.key, () => div('fstar', '★'), (st, s) => {
      st.style.opacity = String(s.p >= 1 ? 1 : 0.35 + 0.45 * s.p);
      st.classList.toggle('forming', s.p < 1);
      st.title = s.title;
    });
  });
}
