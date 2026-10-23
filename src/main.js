import { Game, fmt, pct } from './engine.js';
import { STAT_GROUPS, TRAITS } from './data.js';
import { allFighters } from './builds.js';
import { openBuilder } from './builder.js';
import { RANGES } from './rules.js';
import { renderField } from './field.js';
import { initClaude, claudeToAct, waitingPanel, syncClaude, claudeSide, syncFetch } from './claude.js';

let game;
const ui = { amount: {}, target: {}, block: 0, hover: null, picks: loadPicks(), openStances: new Set() };
const $ = (id) => document.getElementById(id);

// ---------- fighter picker ----------
function loadPicks() {
  try {
    const saved = JSON.parse(localStorage.getItem('fighterPicks') || 'null');
    const all = allFighters();
    if (Array.isArray(saved) && saved.every((id) => all.some((f) => f.id === id)) && saved[0] !== saved[1]) return saved;
  } catch { /* storage unavailable */ }
  return ['lindon', 'yerin'];
}

function savePicks() {
  try { localStorage.setItem('fighterPicks', JSON.stringify(ui.picks)); } catch { /* storage unavailable */ }
}

function renderPicker() {
  for (const side of [0, 1]) {
    const sel = $(`pick${side}`);
    sel.innerHTML = allFighters().map((f) => `<option value="${f.id}" ${f.id === ui.picks[1 - side] ? 'disabled' : ''}>${f.name}</option>`).join('');
    sel.value = ui.picks[side];
  }
}

function start() {
  const all = allFighters();
  if (!ui.picks.every((id) => all.some((f) => f.id === id))) ui.picks = ['lindon', 'yerin'];
  game = new Game(ui.picks.map((id) => all.find((f) => f.id === id)));
  game.id = Math.random().toString(36).slice(2, 10);
  resetView();
}

function resetView() {
  ui.amount = {};
  ui.target = {};
  ui.block = 0;
  ui.hover = null;
  renderPicker();
  render();
}

// ---------- saving finished fights ----------
function saveFight() {
  if (!game.result || game.saved) return;
  game.saved = true;
  const r = game.result;
  const result = r.agreed ? 'Agreed draw' : r.draw ? 'Both fall: draw' : `${game.fighters[r.winner].name} wins`;
  const side = claudeSide();
  // Saving needs the sync key on the hosted site; without it the save is quietly skipped.
  syncFetch('/api/fight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: game.id,
      result,
      time: game.time,
      claude: side == null ? null : game.fighters[side].name,
      fighters: game.fighters.map((f) => ({
        name: f.name, path: game.path(f).name, health: fmt(f.health), spirit: fmt(f.spirit), madra: fmt(f.madra),
      })),
      log: game.log.map((l) => `t=${fmt(l.time)} ${l.text}`),
    }),
  }, { ask: false }).catch(() => { /* server not reachable */ });
}

// ---------- fighters ----------
const clampPct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));

function bar(label, value, max, cls, delta = 0, note = '') {
  const now = Math.max(0, value);
  const after = Math.max(0, value + delta);
  const changed = Math.abs(delta) > 0.05;
  const text = changed
    ? `${fmt(now)} → <b class="after">${fmt(after)}</b>${note ? ` <span class="note">${note}</span>` : ''}`
    : `${fmt(now)} / ${max}`;
  return `<div class="bar ${cls}${changed ? ' previewing' : ''}">
    <div class="bar-label"><span>${label}</span><span>${text}</span></div>
    <div class="bar-track">
      <div class="bar-fill" style="width:${clampPct(changed ? after : now, max)}%"></div>
      ${changed ? `<div class="bar-ghost" style="left:${clampPct(after, max)}%;width:${clampPct(now, max) - clampPct(after, max)}%"></div>` : ''}
    </div>
  </div>`;
}

function renderFighter(f, ghost = null) {
  const d = ghost ? ghost.deltas[f.index] : {};
  const note = ghost ? ghost.notes[f.index] : '';
  const el = $(`f${f.index}`);
  el.className = `fighter panel theme-${f.theme}${game.prompt && game.prompt.fighter === f.index && game.prompt.kind !== 'over' ? ' active' : ''}`;
  const path = game.path(f);
  const spd = game.speed(f);
  const stats = STAT_GROUPS.map(([group, list]) => `
    <div class="stat-group"><div class="stat-group-name">${group}</div>
    ${list.map(([k, label]) => {
      const v = f.stats[k];
      const extra = k === 'speed' && Math.abs(spd - v) > 0.01 ? ` <span class="mod">→ ${fmt(spd)}</span>` : '';
      return `<div class="stat"><span>${label}</span><span>${v}${extra}</span></div>`;
    }).join('')}</div>`).join('');

  const stances = game.activeStances(f).map((s) => {
    const b = game.buildUp(f, s);
    const bits = [];
    if (s.speedMult) bits.push(`Speed ×${s.speedMult}`);
    if (s.physBonus) bits.push(`+${s.physBonus} physical damage`);
    if (s.dr) bits.push(`+${s.dr} damage reduction`);
    if (s.halvesTechniques) bits.push('halves technique damage');
    if (s.redirect) bits.push('can redirect techniques');
    if (s.buildUp) bits.push(`build-up ${b}: +${b * 10}% Speed, +${b} sharpness (next at t=${fmt(game.nextBuildUp(f, s))})`);
    bits.push(`upkeep ${fmt(game.upkeepRate(f, s))}/tick`);
    const key = `${f.index}:${s.id}`;
    return `<li><details data-stance="${key}" ${ui.openStances.has(key) ? 'open' : ''}><summary><b>${s.name}</b> — ${bits.join(' · ')}</summary>`
      + `<div class="stance-desc">${s.desc}</div></details></li>`;
  }).join('');

  const constructs = f.constructs.map((c) => `<li><b>${c.name}</b> — ${fmt(c.hp)} / ${c.maxHp} HP${c.range != null ? ` · ${RANGES[c.range]}` : ''}</li>`).join('');

  const pending = f.windups.map((w) =>
    `<div class="pending">Winding up <b>${w.label}</b>${w.madra ? ` (${w.madra} madra)` : ''}${w.boost ? ` · boosted +${fmt(w.boost)}` : ''} · lands t=${fmt(w.end)}</div>`).join('')
    + (f.moving ? `<div class="pending">Moving ${f.moving.dir < 0 ? 'in' : 'away'} · arrives t=${fmt(f.moving.end)}</div>` : '');

  // Techniques this fighter has used so far, expandable to their full description.
  const seen = (f.seen || []).map((id) => game.tech(f, id)).filter(Boolean).map((t) => {
    const key = `${f.index}:seen:${t.id}`;
    const name = t.label && t.label !== t.name ? `${t.name}: ${t.label}` : t.name;
    return `<li><details data-stance="${key}" ${ui.openStances.has(key) ? 'open' : ''}><summary><b>${name}</b> <span class="muted">${t.type || ''}</span></summary>`
      + `<div class="stance-desc">${t.desc || t.cardDesc || ''}</div></details></li>`;
  }).join('');

  const traits = f.traits.map((t) => `<li><b>${TRAITS[t].name}</b> — ${TRAITS[t].desc}</li>`).join('');
  const weapon = f.weapon ? `${f.weapon.name}${f.weapon.damage ? ` (+${f.weapon.damage} damage)` : ''}${f.weapon.blade ? ', blade' : ''}` : 'none';

  el.innerHTML = `
    <div class="fighter-head">
      <div class="name">${f.name}</div>
      <div class="sub">${f.stage} · ${path.name}</div>
      ${drawControl(f)}
    </div>
    ${bar('Health', f.health, f.stats.health, 'health', d.health, note)}
    ${bar('Spirit', f.spirit, f.stats.spirit, 'spirit', d.spirit, d.health ? '' : note)}
    ${bar('Madra', f.madra, f.stats.pool, 'madra', d.madra)}
    ${pending}
    <div class="facts">
      <div><span>Next turn</span><span>t=${fmt(f.nextTurn)}</span></div>
      <div><span>Interrupt threshold</span><span>${fmt(game.threshold(f))}</span></div>
      <div><span>Stance break</span><span>${fmt(game.stanceThreshold(f))}</span></div>
      <div><span>Weapon</span><span>${weapon}</span></div>
    </div>
    <h3>Stances</h3>
    ${stances ? `<ul class="list">${stances}</ul>` : '<div class="muted">None up</div>'}
    ${constructs ? `<h3>Constructs</h3><ul class="list">${constructs}</ul>` : ''}
    <h3>Stats</h3>
    <div class="stats">${stats}</div>
    ${seen ? `<h3>Techniques seen</h3><ul class="list">${seen}</ul>` : ''}
    <h3>Path</h3>
    <div class="muted small">${path.summary}</div>
    ${traits ? `<h3>Traits</h3><ul class="list">${traits}</ul>` : ''}
  `;
}

// Draw offers: a toggle for each side you control; Claude's offer is shown as a label.
function drawControl(f) {
  if (game.result) return '';
  const offering = game.drawOffers[f.index];
  if (claudeSide() === f.index) {
    return offering ? '<div class="draw-offer on">Claude is offering a draw</div>' : '';
  }
  return `<button class="ghost draw-offer${offering ? ' on' : ''}" data-draw="${f.index}">${offering ? 'Withdraw draw offer' : 'Offer draw'}</button>`;
}

// ---------- prompt ----------
// The controls for one option: slider, target picker, preview and button.
function optionControls(f, o, buttonLabel) {
  let amount = 0;
  let slider = '';
  if (o.slider) {
    const s = o.slider;
    if (ui.amount[o.key] == null) ui.amount[o.key] = s.initial;
    amount = Math.min(Math.max(ui.amount[o.key], s.min), s.max);
    ui.amount[o.key] = amount;
    slider = `<label class="slider">${s.label} <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${amount}" data-amount="${o.key}"><b data-amount-val="${o.key}">${amount}</b></label>`;
  }
  let targetSelect = '';
  if (o.targets) {
    if (!o.targets.some((t) => t.id === ui.target[o.key])) ui.target[o.key] = '';
    targetSelect = `<label class="slider">Target <select data-target="${o.key}">${o.targets.map((t) =>
      `<option value="${t.id}" ${t.id === ui.target[o.key] ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
  }
  const pv = game.preview(f, o.key, amount, ui.target[o.key] || '');
  return {
    enabled: pv.enabled,
    warn: !!pv.warning,
    html: `${slider}${targetSelect}
    <div class="card-preview" data-preview="${o.key}">${previewHtml(pv)}</div>
    <button data-act="${o.key}" ${pv.enabled ? '' : 'disabled'}>${buttonLabel}</button>`,
  };
}

function optionCard(f, o) {
  const c = optionControls(f, o, o.group === 'drop' ? 'Drop' : 'Use');
  return `<div class="card${c.enabled ? '' : ' disabled'}${c.warn ? ' warn' : ''}" data-card="${o.key}">
    <div class="card-head"><span class="card-name">${o.label}</span>${o.type ? `<span class="tag">${o.type}</span>` : ''}</div>
    ${o.desc ? `<div class="card-desc">${o.desc}</div>` : ''}
    ${c.html}
  </div>`;
}

// One technique with several uses (like the Crown: forge a star, drop stars) shares a card.
function multiCard(f, list) {
  const first = list[0];
  const parts = list.map((o) => {
    const c = optionControls(f, o, o.label);
    return `<div class="card-part${c.enabled ? '' : ' disabled'}${c.warn ? ' warn' : ''}" data-card="${o.key}">${c.html}</div>`;
  }).join('');
  return `<div class="card">
    <div class="card-head"><span class="card-name">${first.cardTitle}</span>${first.type ? `<span class="tag">${first.type}</span>` : ''}</div>
    ${first.cardDesc ? `<div class="card-desc">${first.cardDesc}</div>` : ''}
    ${parts}
  </div>`;
}

function renderOptions(f, list) {
  const out = [];
  const seen = new Set();
  for (const o of list) {
    if (!o.card) { out.push(optionCard(f, o)); continue; }
    if (seen.has(o.card)) continue;
    seen.add(o.card);
    out.push(multiCard(f, list.filter((x) => x.card === o.card)));
  }
  return out.join('');
}

function previewHtml(pv) {
  return pv.lines.filter(Boolean).map((l) => `<div>${l}</div>`).join('')
    + (pv.enabled ? '' : `<div class="reason">${pv.reason}</div>`)
    + (pv.enabled && pv.warning ? `<div class="reason">${pv.warning}</div>` : '');
}

function renderPrompt() {
  const el = $('prompt');
  const p = game.prompt;
  if (!p) { el.innerHTML = ''; return; }

  if (p.kind === 'over') {
    const r = game.result;
    const text = r.agreed ? 'Both fighters agree to a draw.' : r.draw ? 'Both fighters fall. A draw.' : `${game.fighters[r.winner].name} wins.`;
    el.innerHTML = `<div class="prompt-title">Fight over</div><p class="big">${text}</p><p class="muted small">Saved to the fights folder.</p><button data-restart>Fight again</button>`;
    return;
  }

  if (claudeToAct(game)) {
    el.innerHTML = waitingPanel(game);
    return;
  }

  const f = game.fighters[p.fighter];
  if (p.kind === 'turn') {
    const opts = game.turnOptions(f);
    const group = (g) => renderOptions(f, opts.filter((o) => o.group === g));
    const drops = group('drop');
    el.innerHTML = `
      <div class="prompt-title theme-${f.theme}">${f.name}'s turn <span class="muted">t=${fmt(game.time)}</span></div>
      <div class="section-label">Path techniques</div>
      <div class="cards">${group('path')}</div>
      ${drops ? `<div class="section-label">Stances up</div><div class="cards">${drops}</div>` : ''}
      <div class="section-label">Basic actions</div>
      <div class="cards">${group('basic')}</div>`;
    return;
  }

  if (p.kind === 'reaction') {
    const a = p.attack;
    const att = game.fighters[a.attacker];
    const ro = game.reactionOptions();
    if (ui.block > ro.block.maxBase) ui.block = ro.block.maxBase;
    const canBlock = ro.block.maxBase >= 1;
    const disrupt = a.profile.effect === 'disrupt';
    const pulse = a.profile.effect === 'pulse';
    const what = pulse
      ? `a ${a.profile.madra}-madra pulse: cancels your wind-ups, stances and constructs that cost ${fmt(a.profile.madra / 2)} or less · each point of block takes 1.5 off its strength, at double cost (pure madra)`
      : ro.construct
      ? `aimed at your ${ro.construct.name} (${fmt(ro.construct.hp)} HP): ${ro.take.damage} damage${a.hits > 1 ? ' per hit' : ''} · you can reinforce it with madra, but not dodge for it`
      : disrupt
      ? 'breaks your wind-ups and stances if it hits'
      : `${a.hits > 1 ? `${a.hits} hits of ` : ''}${a.profile.hitDamages ? a.profile.hitDamages.map(fmt).join(' + ') : fmt(a.profile.damage)} ${a.profile.dtype === 'spiritual' ? 'spiritual ' : ''}damage
        ${a.profile.sharpness ? `· sharpness ${a.profile.sharpness}` : ''}${a.profile.pure ? ' · pure madra: blocks cost double' : ''}
        · ${ro.take.damageText} after ${f.name}'s reduction`;
    el.innerHTML = `
      <div class="prompt-title theme-${f.theme}">${f.name} reacts <span class="muted">t=${fmt(game.time)}</span></div>
      <div class="incoming theme-${att.theme}">
        <b>${att.name}'s ${a.profile.name}</b> is landing: ${what}${a.profile.toHit ? ` · +${a.profile.toHit} to hit` : ''}${a.profile.area ? ' · area attack, no roll' : ''}
        · your threshold is ${fmt(game.threshold(f))} (stances ${fmt(game.stanceThreshold(f))})
      </div>
      ${canBlock && !disrupt ? `<label class="slider block-amount">Block per hit <input type="range" min="0" max="${ro.block.maxBase}" value="${ui.block}" data-block><b data-block-val>${ui.block}</b><span class="muted" data-block-dr>−${fmt(1.5 * ui.block)} damage each</span></label>` : ''}
      <div class="cards">
        ${reactCard('take', 'Take it')}
        ${ro.construct || pulse ? '' : reactCard('dodge', 'Dodge')}
        ${canBlock && !disrupt ? (ro.construct ? reactCard('block', 'Reinforce') : pulse ? reactCard('block', 'Block') : reactCard('block', 'Block') + reactCard('dodgeBlock', 'Dodge and block')) : ''}
        ${ro.redirect.shown ? reactCard('redirect', 'Redirect', !ro.redirect.available) : ''}
      </div>`;
  }
}

const REACTIONS = ['take', 'dodge', 'block', 'dodgeBlock', 'redirect'];

function reactCard(choice, label, disabled = false) {
  return `<div class="card${disabled ? ' disabled' : ''}" data-react-card="${choice}">
    <div class="card-head"><span class="card-name">${label}</span></div>
    <div class="card-preview" data-react-preview="${choice}">${reactPreview(choice)}</div>
    <button data-react="${choice}" ${disabled ? 'disabled' : ''}>${label}</button>
  </div>`;
}

function reactPreview(choice) {
  const a = game.prompt.attack;
  const ro = game.reactionOptions();
  if (choice === 'redirect') {
    return `<div>Catch it in the Mantle and throw it back at ${game.fighters[a.attacker].name}</div>`
      + `<div>${ro.redirect.cost} madra · lands on them in 1 tick</div>`
      + (ro.redirect.available ? '' : '<div class="reason">Not enough madra</div>');
  }
  const o = game.reactionOutcome(choice, ui.block);
  if (o.pulse) {
    const names = o.pulse.targets.map((x) => `${x.name} (${fmt(x.cost)})`);
    return [
      `Strength ${fmt(o.pulse.strength)}: cancels anything that cost ${fmt(o.pulse.strength / 2)} or less`,
      names.length ? `<span class="reason">Breaks ${names.join(', ')}</span>` : 'Nothing of yours breaks',
      o.madraCost ? `${fmt(o.madraCost)} madra (double: pure madra) · next turn ${fmt(o.delay)} later` : 'No cost',
    ].map((l) => `<div>${l}</div>`).join('');
  }
  const dodging = choice === 'dodge' || choice === 'dodgeBlock';
  const lines = [];
  if (a.profile.area) lines.push(dodging ? `Area: no roll, damage −${pct(ro.dodge.reduction)}` : 'Area: no roll');
  else if (dodging && a.hits > 1) lines.push(`${o.chances.map(pct).join(' / ')} to hit (dodge +${ro.dodge.bonuses.join(' / +')}: it tapers per hit)`);
  else lines.push(`${pct(o.chance)} to hit${a.hits > 1 ? ' (each)' : ''}${dodging ? ` (+${ro.dodge.bonus} Defense)` : ''}`);
  if (a.profile.effect === 'disrupt') {
    lines.push('<span class="reason">breaks your wind-ups and stances</span> if it hits');
  } else {
    const flag = o.breaksStances ? ' · <span class="reason">breaks your stances</span>' : o.interrupts ? ' · <span class="reason">over your threshold</span>' : '';
    lines.push(`${o.perHitText ? o.perHitText : `${a.hits > 1 ? `${a.hits} hits × ` : ''}${o.perHit}`}${o.track === 'spirit' ? ' spirit' : ''} damage${o.construct ? ` to ${o.construct.name}` : ''}${o.absorbed ? ` (barrier soaks ${fmt(o.absorbed)})` : ''}${flag}`);
  }
  const costs = [];
  if (o.madraCost) costs.push(`${fmt(o.madraCost)} madra${a.hits > 1 ? ` (${ro.block.factor}× for ${a.hits} hits)` : ''}`);
  if (o.delay) costs.push(`next turn ${fmt(o.delay)} later`);
  lines.push(costs.length ? costs.join(' · ') : 'No cost');
  return lines.map((l) => `<div>${l}</div>`).join('');
}

// ---------- stale-code check ----------
// The page remembers which version of the code it loaded, and shows a banner once the
// files on disk change, since a reload is needed to pick up the new rules.
async function fetchCodeVersion() {
  try {
    const r = await fetch('/api/version');
    return r.ok ? (await r.json()).version : null;
  } catch { return null; }
}

async function watchCodeVersion() {
  const loaded = await fetchCodeVersion();
  if (!loaded) return;
  document.documentElement.dataset.codeVersion = loaded;
  setInterval(async () => {
    const now = await fetchCodeVersion();
    if (!now || now === loaded || document.getElementById('stale-banner')) return;
    const b = document.createElement('div');
    b.id = 'stale-banner';
    b.textContent = 'The game code has changed. Reload the page to use it; the fight carries on.';
    document.body.prepend(b);
  }, 4000);
}
watchCodeVersion();

// ---------- queue, clock, range, log ----------
// List icons match the marker shapes on the track.
const QUEUE_ICONS = { turn: '▮', attack: '▼', move: '➜', stance: '◆', construct: '★', buildup: '▲' };

function renderQueue(ghost = null) {
  let items = game.upcoming();
  if (ghost) {
    // The previewed choice replaces the acting fighter's "acts now" entry; a dodge or block shifts the defender's next turn.
    const replaced = ghost.replacesTurn ?? ghost.shiftTurn;
    if (replaced != null) {
      items = items.map((i) => (i.kind === 'turn' && i.who === replaced ? { ...i, replaced: true } : i));
    }
    items = items.concat(ghost.queue).sort((a, b) => a.time - b.time);
  }
  // The timeline spans what's queued (at least 6 ticks), so near events don't bunch up.
  const horizon = Math.max(6, ...items.map((i) => Math.ceil(i.time - game.time + 1)));
  const list = items.map((i, n) => {
    const f = game.fighters[i.who];
    return `<li class="theme-${f.theme} ${i.kind}${i.ghost ? ' ghost' : ''}${i.replaced ? ' replaced' : ''}" data-qi="${n}"><span class="qi">${QUEUE_ICONS[i.type] || '•'}</span><span class="qt">t=${fmt(i.time)}</span><span class="qd">+${fmt(i.time - game.time)}</span><span>${i.label}</span></li>`;
  }).join('');
  const q = $('queue');
  if (!q.querySelector('.track')) {
    q.innerHTML = `<div class="section-label">Initiative queue</div>
      <div class="track"><div class="track-now"></div><div class="track-end"></div></div>
      <ul class="qlist"></ul>`;
  }
  updateTrack(q.querySelector('.track'), items, horizon);
  animateLabel(q.querySelector('.track-end'), horizon);
  q.querySelector('.qlist').innerHTML = list;
}

// The "+N" length label counts to its new value instead of jumping.
function animateLabel(el, target) {
  const from = Number(el.dataset.value || target);
  el.dataset.value = target;
  if (from === target) { el.textContent = `+${fmt(target)}`; return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 500);
    el.textContent = `+${Math.round(from + (target - from) * k)}`;
    if (k < 1 && el.dataset.value === String(target)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Markers persist between updates (matched by key), so when time moves on they slide left
// instead of the whole timeline redrawing. Passed events slide into the "now" line and fade;
// new ones fade in where they belong. Each marker is a wider invisible hover area around its
// shape; data-qi links it to its list row.
// Positions are ticks-from-now (--offset) over the timeline length (--horizon); both animate in CSS,
// so time passing slides markers left and a change of length zooms the timeline smoothly.
function updateTrack(track, items, horizon) {
  track.style.setProperty('--horizon', horizon);
  const seen = new Set();
  items.forEach((i, n) => {
    if (i.time - game.time > horizon) return;
    const key = i.ghost ? `ghost:${n}` : i.key;
    seen.add(key);
    const f = game.fighters[i.who];
    const cls = `marker ${i.kind} t-${i.type || i.kind} lane-${i.who} theme-${f.theme}${i.ghost ? ' ghost' : ''}${i.replaced ? ' replaced' : ''}`;
    let el = [...track.querySelectorAll('.marker:not(.leaving)')].find((m) => m.dataset.key === key);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = key;
      el.innerHTML = '<div class="shape"></div>';
      el.className = `${cls}${i.ghost ? '' : ' entering'}`;
      el.style.setProperty('--offset', i.time - game.time);
      track.appendChild(el);
      if (!i.ghost) setTimeout(() => el.classList.remove('entering'), 30);
    } else {
      el.className = cls;
    }
    el.style.setProperty('--offset', i.time - game.time);
    el.dataset.qi = n;
    el.dataset.time = i.time;
    el.title = `t=${fmt(i.time)} ${i.label}`;
  });
  for (const el of track.querySelectorAll('.marker:not(.leaving)')) {
    if (seen.has(el.dataset.key)) continue;
    if (el.classList.contains('ghost')) { el.remove(); continue; }
    el.classList.add('leaving');
    delete el.dataset.qi;
    el.style.setProperty('--offset', Math.max(0, Number(el.dataset.time) - game.time));
    setTimeout(() => el.remove(), 600);
  }
}

function renderTop() {
  $('clock').textContent = `t = ${fmt(game.time)}`;
  $('range').innerHTML = RANGES.map((r, i) => `<span class="${i === game.distance ? 'on' : ''}">${r}</span>`).join('');
}

function renderLog() {
  const rows = game.log.slice().reverse().map((e) => {
    const theme = e.who != null ? `theme-${game.fighters[e.who].theme}` : '';
    return `<li class="${e.cls} ${theme}"><span class="qt">t=${fmt(e.time)}</span><span>${e.text}</span></li>`;
  }).join('');
  $('log').innerHTML = `<div class="section-label">Log</div><ul class="loglist">${rows}</ul>`;
}

// Hovering a choice previews its effects as ghosts on the bars and the queue.
function currentGhost() {
  if (!ui.hover || !game.prompt) return null;
  if (ui.hover.react) return game.projectReaction(ui.hover.react, ui.block);
  if (game.prompt.kind !== 'turn') return null;
  const k = ui.hover.key;
  return game.project(game.current(), k, ui.amount[k] || 0, ui.target[k] || '');
}

function renderGhost() {
  const ghost = currentGhost();
  game.fighters.forEach((f) => renderFighter(f, ghost));
  renderQueue(ghost);
}

function render() {
  ui.hover = null;
  renderTop();
  renderField(game);
  renderPrompt();
  renderGhost();
  renderLog();
  syncClaude(game);
  saveFight();
  storeFight();
}

// ---------- keeping the fight across reloads ----------
// The current fight is saved after every update and restored on load, so a reload picks up
// new code without restarting the fight.
const FIGHT_KEY = 'currentFight';

function storeFight() {
  try { localStorage.setItem(FIGHT_KEY, JSON.stringify(game.serialize())); } catch { /* storage unavailable */ }
}

function resumeOrStart() {
  try {
    const saved = JSON.parse(localStorage.getItem(FIGHT_KEY) || 'null');
    const all = allFighters();
    if (saved && saved.fighters && saved.fighters.every((f) => all.some((d) => d.id === f.id))) {
      game = Game.restore(saved, all);
      ui.picks = game.fighters.map((f) => f.id);
      game.addLog('Page reloaded: the fight continues with the current rules.', 'system');
      resetView();
      return;
    }
  } catch (err) {
    console.warn('Could not restore the saved fight; starting a new one.', err);
  }
  start();
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act && !act.disabled) {
    const key = act.dataset.act;
    game.act(key, ui.amount[key] || 0, ui.target[key] || '');
    render();
    return;
  }
  const react = e.target.closest('[data-react]');
  if (react && !react.disabled) {
    game.react(react.dataset.react, ui.block);
    ui.block = 0;
    render();
    return;
  }
  const draw = e.target.closest('[data-draw]');
  if (draw) {
    const i = Number(draw.dataset.draw);
    game.setDrawOffer(i, !game.drawOffers[i]);
    render();
    return;
  }
  if (e.target.closest('[data-restart]') || e.target.id === 'restart') start();
  if (e.target.id === 'open-builder') openBuilder({ onChange: renderPicker });
});

document.addEventListener('change', (e) => {
  const pick = e.target.closest('#pick0, #pick1');
  if (pick) {
    ui.picks[pick.id === 'pick0' ? 0 : 1] = pick.value;
    savePicks();
    start();
    return;
  }
  const key = e.target.dataset.target;
  if (key != null) {
    ui.target[key] = e.target.value;
    const pv = game.preview(game.current(), key, ui.amount[key] || 0, ui.target[key]);
    document.querySelector(`[data-preview="${key}"]`).innerHTML = previewHtml(pv);
    renderGhost();
  }
});

document.addEventListener('input', (e) => {
  const key = e.target.dataset.amount;
  if (key) {
    ui.amount[key] = Number(e.target.value);
    document.querySelector(`[data-amount-val="${key}"]`).textContent = e.target.value;
    const pv = game.preview(game.current(), key, ui.amount[key], ui.target[key] || '');
    document.querySelector(`[data-preview="${key}"]`).innerHTML = previewHtml(pv);
    renderGhost();
    return;
  }
  if (e.target.hasAttribute('data-block')) {
    ui.block = Number(e.target.value);
    document.querySelector('[data-block-val]').textContent = e.target.value;
    document.querySelector('[data-block-dr]').textContent = `−${fmt(1.5 * ui.block)} damage each`;
    for (const c of REACTIONS) {
      const el = document.querySelector(`[data-react-preview="${c}"]`);
      if (el) el.innerHTML = reactPreview(c);
    }
    renderGhost();
  }
});

// Hovering a queue event on the track or in the list highlights it in both places.
function highlightQueue(n) {
  document.querySelectorAll('#queue .hl').forEach((el) => el.classList.remove('hl'));
  if (n == null) return;
  const row = document.querySelector(`#queue li[data-qi="${n}"]`);
  document.querySelectorAll(`#queue [data-qi="${n}"]`).forEach((el) => el.classList.add('hl'));
  if (row) {
    const list = row.parentElement;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop - list.clientHeight / 2;
    }
  }
}
document.addEventListener('mouseover', (e) => {
  const q = e.target.closest('#queue [data-qi]');
  highlightQueue(q ? q.dataset.qi : null);
});

// Keep expanded stance details open across re-renders.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.stance) return;
  if (d.open) ui.openStances.add(d.dataset.stance);
  else ui.openStances.delete(d.dataset.stance);
}, true);

document.addEventListener('mouseover', (e) => {
  const card = e.target.closest('[data-card], [data-react-card]');
  const next = !card || card.classList.contains('disabled') ? null
    : card.dataset.card ? { key: card.dataset.card } : { react: card.dataset.reactCard };
  if (JSON.stringify(next) !== JSON.stringify(ui.hover)) {
    ui.hover = next;
    renderGhost();
  }
});

document.addEventListener('mouseleave', () => {
  if (ui.hover) { ui.hover = null; renderGhost(); }
});

initClaude(() => game, render);
resumeOrStart();
