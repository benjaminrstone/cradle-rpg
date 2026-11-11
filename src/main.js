import { Game, fmt, pct } from './engine.js';
import { TRAITS } from './data.js';
import { allFighters } from './builds.js';
import { openBuilder } from './builder.js';
import { parsePoint, dist as A_dist } from './arena.js';
import { reachText } from './rules.js';
import { renderField, showFx } from './field.js';
import { initClaude, claudeToAct, waitingPanel, syncClaude, claudeSide, syncFetch } from './claude.js';

let game;
const ui = {
  amount: {}, target: {}, selected: null, desc: new Set(), walk: 'keep',
  dodge: false, block: 0, hover: null, tabs: [null, null],
  picks: loadPicks(), queueAll: loadQueueMode(),
  logSeen: 0, broken: new Set(),
};
const $ = (id) => document.getElementById(id);
const EPS = 1e-9;

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
  ui.logSeen = game.log.length;
  ui.amount = {};
  ui.target = {};
  ui.selected = null;
  ui.walk = 'keep';
  ui.dodge = false;
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

// ---------- text helpers ----------
// One time convention outside the timeline header and the log: "in N" ticks from now.
function relTimes(text) {
  return String(text)
    .replace(/\(t=(\d+(?:\.\d+)?)\)/g, (_, t) => `(in ${fmt(Math.max(0, Number(t) - game.time))})`)
    .replace(/\b(?:at )?t=(\d+(?:\.\d+)?)/g, (_, t) => `in ${fmt(Math.max(0, Number(t) - game.time))}`);
}
const inTicks = (t) => (t - game.time < 0.05 ? 'now' : `in ${fmt(t - game.time)}`);
const shortPath = (name) => name.replace(/^Path of (the )?/, '');

// ---------- fighters ----------
const clampPct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));

// A tick sits where the bar would be after one hit just big enough to break wind-ups (solid) or stances (dotted).
function bar(label, cls, value, max, delta = 0, ticks = []) {
  const now = Math.max(0, value);
  const after = Math.max(0, value + delta);
  const changed = Math.abs(delta) > 0.05;
  const text = changed ? `${fmt(now)} → <b class="after">${fmt(after)}</b>` : `${fmt(now)} / ${fmt(max)}`;
  const tickHtml = ticks.filter((t) => t.at > 0).map((t) =>
    `<div class="thr${t.stance ? ' st' : ''}" style="left:${clampPct(t.at, max)}%" title="${t.title}"></div>`).join('');
  return `<div class="bar ${cls}${changed ? ' previewing' : ''}"><span class="bl">${label}</span>
    <div class="track"><div class="fill" style="width:${clampPct(changed ? after : now, max)}%"></div>
      ${changed ? `<div class="ghost" style="left:${clampPct(after, max)}%;width:${clampPct(now, max) - clampPct(after, max)}%"></div>` : ''}
      ${tickHtml}</div>
    <span class="bv">${text}</span></div>`;
}

const progress = (w) => Math.min(1, Math.max(0, (game.time - w.start) / Math.max(0.01, w.end - w.start)));

function windupVerb(w) {
  const ev = game.events.find((e) => e.id === w.eventId);
  const k = ev ? ev.action.kind : '';
  return k === 'stance' ? 'up' : k === 'forged' || k === 'ring' || k === 'piece' ? 'forms' : 'lands';
}

function fighterChips(f) {
  const chips = [];
  for (const s of game.activeStances(f)) {
    const b = game.buildUp(f, s);
    const bits = [];
    if (b) bits.push(`·${b}`);
    chips.push(`<span class="chip stance" title="${s.name}: ${s.desc || ''}"><span class="ic">◆</span>${s.name}${b ? ` <span class="muted">build-up ${b}</span>` : ''}`
      + `<span class="r"><span class="up">−${fmt(game.upkeepRate(f, s))}</span>/tick</span></span>`);
  }
  for (const c of f.constructs) {
    const ic = c.kind === 'star' ? '★' : c.kind === 'barrier' ? '⬡' : '◌';
    const where = c.kind === 'star' ? 'overhead' : `${fmt(c.hp)} HP`;
    chips.push(`<span class="chip" title="${c.name}: ${fmt(c.hp)} / ${fmt(c.maxHp)} HP"><span class="ic">${ic}</span>${c.name}<span class="r">${where}</span></span>`);
  }
  for (const w of f.windups) {
    const detail = game.describeWindup(w);
    const verb = windupVerb(w);
    chips.push(`<span class="chip windup" data-ev="${w.eventId}" title="${w.label}${detail ? `\n${detail}` : ''}"><span class="ic">${verb === 'lands' ? '▼' : verb === 'up' ? '◆' : '☆'}</span>`
      + `${w.label}${w.madra && !w.label.includes(`(${w.madra})`) ? ` · ${w.madra}` : ''}${w.boost ? ` <span class="muted">+${fmt(w.boost)}</span>` : ''}`
      + `<span class="r">${verb} ${inTicks(w.end)}</span><span class="prog" style="width:${progress(w) * 100}%"></span>`
      + `${detail ? `<span class="chip-detail">${detail}</span>` : ''}</span>`);
  }
  if (f.flight) {
    chips.push(`<span class="chip windup move"><span class="ic">⤴</span>Flying<span class="r">lands ${inTicks(f.flight.end)}</span>`
      + `<span class="prog" style="width:${progress(f.flight) * 100}%"></span></span>`);
  } else if (f.walk) {
    const arr = f.walk.to ? game.arrival(f, 20) : null;
    chips.push(`<span class="chip windup move" title="Walking pace now: ${game.paceText(game.paceAt(f, game.time))}"><span class="ic">➜</span>Walking ${game.walkText(f)}`
      + `<span class="r">${arr != null ? `arrives ${inTicks(arr)}` : `${game.paceText(game.paceAt(f, game.time))} pace`}</span></span>`);
  }
  if (f.pending) {
    chips.push(`<span class="chip windup"><span class="ic">${STRIKE_ICON}</span>Closing in to strike<span class="r">gives up ${inTicks(f.pending.giveUp)}</span></span>`);
  }
  return chips.length ? chips.join('') : '<span class="empty">Nothing up or winding up</span>';
}

function fighterTab(f, tab) {
  const o = game.opponent(f);
  if (tab === 'stats') {
    const s = f.stats;
    const spd = game.speed(f);
    const cell = (k, v) => `<div class="s"><span>${k}</span><span>${v}</span></div>`;
    const weapon = f.weapon ? `${f.weapon.name}${f.weapon.damage ? ` (+${f.weapon.damage})` : ''}${f.weapon.blade ? ', blade' : ''}` : 'none';
    return `<div class="statgrid">
        <span class="g">Body</span><span class="g">Spirit</span><span class="g">Mind</span>
        ${cell('Health', s.health)}${cell('Pool', s.pool)}${cell('Precision', s.precision)}
        ${cell('Tough', s.toughness)}${cell('Cap', s.cap)}${cell('Control', s.control)}
        ${cell('Speed', Math.abs(spd - s.speed) > 0.01 ? `${s.speed} <span class="acc">→ ${fmt(spd)}</span>` : s.speed)}${cell('Spirit', s.spirit)}${cell('Percep.', s.perception)}
      </div>
      <div class="kv">
        <span>Breaks wind-ups</span><span>${fmt(game.threshold(f))} in one hit (spiritual counts double)</span>
        <span>Breaks stances</span><span>${fmt(game.stanceThreshold(f))} in one hit</span>
        <span>Defense vs ${o.name}</span><span>${game.defense(o, f, false)} · ${game.defense(o, f, true)} dodging</span>
        <span>Weapon</span><span>${weapon}</span>
      </div>`;
  }
  if (tab === 'path') {
    const path = game.path(f);
    const traits = f.traits.map((t) => `<div><b>${TRAITS[t].name}</b> <span class="muted">${TRAITS[t].desc}</span></div>`).join('');
    return `<div><b>${path.name}</b></div><div class="muted">${path.summary}</div>${traits ? `<div class="tab-traits">${traits}</div>` : ''}`;
  }
  // Seen: one entry per technique (uses of one card count once), with its full text.
  const groups = new Map();
  for (const t of game.techList(f)) {
    const k = t.card || t.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const seenIds = new Set(f.seen || []);
  const shown = [...groups.values()].filter((list) => list.some((t) => seenIds.has(t.id)));
  const hidden = groups.size - shown.length;
  const rows = shown.map((list) => {
    const t = list[0];
    const name = t.cardTitle || t.name;
    const uses = list.length > 1 ? ` <span class="muted">(${list.filter((x) => seenIds.has(x.id)).map((x) => x.label || x.name).join(', ')})</span>` : '';
    return `<div class="seen"><div><b>${name}</b>${uses} <span class="muted">${t.cardType || t.type || ''}</span></div><div class="muted">${t.cardDesc || t.desc || ''}</div></div>`;
  }).join('');
  return `${rows || '<div class="empty">Nothing used yet</div>'}${hidden ? `<div class="empty">${hidden} more technique${hidden > 1 ? 's' : ''} not seen yet</div>` : ''}`;
}

function renderFighter(f, ghost = null) {
  const d = ghost ? ghost.deltas[f.index] : {};
  const note = ghost ? ghost.notes[f.index] : '';
  const el = $(`f${f.index}`);
  const p = game.prompt;
  const acting = p && p.fighter === f.index && p.kind !== 'over';
  el.className = `panel fp theme-${f.theme}${acting ? ' active' : ''}`;
  const path = game.path(f);
  const o = game.opponent(f);

  // A tie goes to whoever is listed first.
  let turn;
  if (p && p.kind === 'turn' && p.fighter === f.index) turn = '<span class="turn now">Next turn <b>now</b></span>';
  else if (f.nextTurn - game.time < 0.05) turn = `<span class="turn now">Next turn <b>now</b>${p && p.fighter === o.index ? `, after ${o.name}` : ''}</span>`;
  else turn = `<span class="turn">Next turn in <b>${fmt(f.nextTurn - game.time)}</b></span>`;

  const thr = game.threshold(f);
  const st = game.stanceThreshold(f);
  const healthTicks = [
    { at: f.health - thr, title: `One hit of ${fmt(thr)} breaks ${f.name}'s wind-ups` },
    { at: f.health - st, stance: true, title: `One hit of ${fmt(st)} breaks ${f.name}'s stances` },
  ];
  // Spiritual damage counts double against the thresholds.
  const spiritTicks = [
    { at: f.spirit - thr / 2, title: `A spiritual hit of ${fmt(thr / 2)} breaks ${f.name}'s wind-ups` },
    { at: f.spirit - st / 2, stance: true, title: `A spiritual hit of ${fmt(st / 2)} breaks ${f.name}'s stances` },
  ];
  const extras = [f.traits.length ? f.traits.map((t) => TRAITS[t].name.replace(/ \(.*\)$/, '')).join(', ') : '', f.weapon && f.weapon.damage ? f.weapon.name : '']
    .filter(Boolean).join(' · ');
  const tab = ui.tabs[f.index];
  const tabBtn = (k, label) => `<button class="ghost${tab === k ? ' on' : ''}" data-tab="${f.index}:${k}">${label}</button>`;
  const seenCount = new Set((f.seen || []).map((id) => { const t = game.tech(f, id); return t ? t.card || t.id : id; })).size;

  el.innerHTML = `
    <div class="fp-head"><span class="name">${f.name}</span>${turn}</div>
    <div class="info"><div class="sub">${f.stage} · ${path.name}${extras ? ` · ${extras}` : ''}</div>
      ${note ? `<div class="ghost-note">${note}</div>`
    : `<div class="thr-key" title="One hit this big breaks ${f.name}'s wind-ups (solid tick on the bars) or stances (dotted). Spiritual hits count double."><span><i></i>wind-ups ${fmt(thr)}</span><span><i class="st"></i>stances ${fmt(st)}</span></div>`}</div>
    ${bar('Health', 'health', f.health, f.stats.health, d.health, healthTicks)}
    ${bar('Spirit', 'spirit', f.spirit, f.stats.spirit, d.spirit, spiritTicks)}
    ${bar('Madra', 'madra', f.madra, f.stats.pool, d.madra)}
    <div class="chips">${fighterChips(f)}</div>
    <div class="fp-foot">${tabBtn('stats', 'Stats')}${tabBtn('path', 'Path')}${tabBtn('seen', `Seen${seenCount ? ` ${seenCount}` : ''}`)}${drawControl(f)}</div>
    ${tab ? `<div class="fp-tab">${fighterTab(f, tab)}</div>` : ''}`;
}

function drawControl(f) {
  if (game.result) return '';
  const offering = game.drawOffers[f.index];
  if (claudeSide() === f.index) {
    return offering ? '<span class="draw-offer on">Claude is offering a draw</span>' : '';
  }
  return `<button class="ghost draw-offer${offering ? ' on' : ''}" data-draw="${f.index}">${offering ? 'Withdraw draw offer' : 'Offer draw'}</button>`;
}

// ---------- action menu ----------
const KIND_ICON = { stance: '◆', forge: '★', command: '★', construct: '⬡', ring: '◌', launch: '⤴', disrupt: '⊘', pulse: '◎' };
const STRIKE_ICON = '⚔\uFE0E';
function iconFor(f, o) {
  if (o.key === 'strike') return STRIKE_ICON;
  if (o.key === 'wait') return '◷';
  if (o.group === 'drop') return '◇';
  const t = game.tech(f, o.key);
  if (!t) return '•';
  if (KIND_ICON[t.kind]) return KIND_ICON[t.kind];
  if (t.area) return '◎';
  if (t.dtype === 'physical') return STRIKE_ICON;
  return '↯';
}

function amountFor(o) {
  if (!o.slider) return 0;
  const s = o.slider;
  if (ui.amount[o.key] == null) ui.amount[o.key] = s.initial;
  ui.amount[o.key] = Math.min(Math.max(ui.amount[o.key], s.min), s.max);
  return ui.amount[o.key];
}

function targetFor(o) {
  if (o.targets && !o.targets.some((t) => t.id === ui.target[o.key])) ui.target[o.key] = '';
  return ui.target[o.key] || '';
}

const walkChoice = () => ui.walk || 'keep';

const VERB = { attack: 'lands', stance: 'up', construct: 'forms', move: 'arrives' };

function gistFor(f, o) {
  const amount = amountFor(o);
  const target = targetFor(o);
  const pv = game.preview(f, o.key, amount, target, walkChoice());
  if (o.group === 'drop') return { text: `raise again after ${fmt(game.reraiseDelay(f))}`, cost: 'free', pv };
  if (o.point && !target && !pv.enabled) {
    return { text: o.point.line ? 'pick its direction on the field' : o.point.area ? 'pick its centre on the field' : 'pick where to land on the field', cost: '', pv, pick: true };
  }
  if (!pv.enabled) return { text: pv.reason, cost: '', pv, warn: true };
  const pj = game.project(f, o.key, amount, target, walkChoice());
  const bits = [];
  if (pj) {
    const opp = game.opponent(f);
    const resolves = pj.queue.filter((q) => q.kind !== 'turn').sort((a, b) => a.time - b.time);
    const turnAt = (pj.queue.find((q) => q.kind === 'turn') || {}).time;
    const first = resolves[0];
    if (first) bits.push(`${VERB[first.type] || 'lands'} ${inTicks(first.time)}`);
    if (turnAt != null && (!first || Math.abs(turnAt - first.time) > 0.05)) bits.push(`next turn ${inTicks(turnAt)}`);
    const dd = pj.deltas[opp.index];
    const dmg = [];
    if (dd.health) dmg.push(`${fmt(-dd.health)} dmg`);
    if (dd.spirit) dmg.push(`${fmt(-dd.spirit)} spirit`);
    const note = pj.notes[opp.index] || '';
    const chance = (note.match(/\d+%/) || [])[0];
    if (dmg.length) bits.push(`${dmg.join(' + ')}${chance ? ` · ${chance}` : /no roll/.test(note) ? ' · no roll' : ''}`);
    else if (note) bits.push(note);
    else if (pj.notes[f.index]) bits.push(pj.notes[f.index]);
    if (o.key === 'wait') {
      const arr = game.plan(f, 'wait', amount, '', walkChoice()).arrival;
      bits.splice(0, bits.length, `${fmt(amount)} ticks${arr != null ? ` · you arrive ${inTicks(arr)}` : ''}`);
    }
  }
  const madra = pj && pj.deltas[f.index].madra ? fmt(-pj.deltas[f.index].madra) : '';
  return { text: bits.join(' · '), cost: madra, pv, warn: !!pv.warning, warning: pv.warning };
}

function optionInputs(f, o) {
  let html = '';
  if (o.slider) {
    const s = o.slider;
    const amount = amountFor(o);
    html += `<label class="slider">${s.label} <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${amount}" data-amount="${o.key}"><b data-amount-val="${o.key}">${amount}</b></label>
      <div data-marks="${o.key}">${marksHtml(turnMarks(f, o), amount, `data-mark="${o.key}"`)}</div>`;
  }
  if (o.targets) {
    const cur = targetFor(o);
    html += `<label class="slider">Target <select data-target="${o.key}">${o.targets.map((t) =>
      `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
  }
  if (o.point) html += pointPicker(f, o);
  return html;
}

// ---------- slider marks ----------
// The values on a slider worth stopping at, worked out from the engine: [{ at, label }].
function turnMarks(f, o) {
  const s = o.slider;
  const opp = game.opponent(f);
  const walk = walkChoice();
  const theirs = opp.windups.filter((w) => !game.isPlainStrike(w));
  const marks = [];
  if (o.key === 'wait') {
    const arr = game.plan(f, 'wait', s.min, '', walk).arrival;
    const add = (t, label) => { const at = Math.ceil((t - game.time) * 10 - 1e-6) / 10; if (at >= s.min && at <= s.max) marks.push({ at, label }); };
    if (arr != null) add(arr, 'you arrive');
    for (const w of f.windups) add(w.end, `your ${w.label} ${windupVerb(w)}`);
    for (const w of opp.windups) add(w.end, `${opp.name}'s ${w.label} ${windupVerb(w)}`);
    if (opp.nextTurn > game.time + EPS) add(opp.nextTurn, `${opp.name}'s next turn`);
    return marks;
  }
  const t = game.tech(f, o.key);
  if (!t || t.kind !== 'attack' || t.zone || targetFor(o)) return marks;
  const target = ui.target[o.key] || '';
  const lands = (m) => { const p = game.plan(f, o.key, m, target, walk); const q = p.enabled && p.queue.find((x) => x.time != null); return q ? q.time : Infinity; };
  if (theirs.length) {
    // The wind-up only grows with madra, so the most that still lands first is found by halving.
    const first = theirs.reduce((a, b) => (a.end <= b.end ? a : b));
    let lo = s.min;
    let hi = s.max;
    if (lands(lo) < first.end - EPS) {
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (lands(mid) < first.end - EPS) lo = mid; else hi = mid - 1; }
      if (lo < s.max) marks.push({ at: lo, label: `lands before ${first.label}` });
    }
  }
  const find = (test) => { for (let m = s.min; m <= s.max; m += s.step) if (test(m)) return m; return null; };
  const results = (m) => { const prof = game.attackProfile(f, o.key, m); return game.hitResults(f, opp, prof, game.hitsAgainst(f, opp, prof)); };
  const mark = (at, label) => { if (at != null) marks.push({ at, label }); };
  if (theirs.length) mark(find((m) => results(m).some((r) => r.interrupts)), 'breaks their wind-ups');
  if (game.activeStances(opp).length) mark(find((m) => results(m).some((r) => r.breaksStances)), 'breaks their stances');
  mark(find((m) => { const r = results(m); return r.reduce((sum, x) => sum + x.dmg, 0) >= opp[r[0].track] - EPS; }), 'takes them out');
  return marks.sort((a, b) => a.at - b.at);
}

function marksHtml(marks, current, attr) {
  if (!marks.length) return '';
  return `<div class="marks">${marks.map((m) =>
    `<button class="mark${Math.abs(m.at - current) < 1e-6 ? ' on' : ''}" ${attr} data-at="${m.at}"><b>${fmt(m.at)}</b> ${m.label}</button>`).join('')}</div>`;
}

const HOLDS = [5, 10, 15, 20];
function walkBar(f, note = '') {
  const w = walkChoice();
  const them = game.opponent(f).name;
  const order = game.walkOrder(f, w);
  const shown = w === 'keep' ? (f.walk ? `walking ${game.walkText(f)}` : 'standing')
    : order.error ? order.error : order.walk ? `walk ${game.walkText(f, order.walk)}` : 'stop';
  const btn = (v, label, title = '') => `<button class="ghost${w === v ? ' on' : ''}" data-walk="${v}" title="${title}">${label}</button>`;
  return `<div class="walk-bar"><span class="label">Walk</span><b>${shown}</b>${note ? ` <span class="muted">${note}</span>` : ''}
    <span class="walk-btns">${btn('keep', 'As you are')}${btn('toward', 'Close in', `Follow ${them} into Close range`)}
      <span class="hold">hold at ${HOLDS.map((d) => btn(`hold:${d}`, d, `Keep ${d} m from ${them}, wherever they go`)).join('')} m</span>
      ${f.walk || w !== 'keep' ? btn('stop', 'Stop') : ''}</span>
    <span class="muted">or click the field</span></div>`;
}

// Launch: where to land. Areas set at a point: where the centre goes.
function pointPicker(f, o) {
  const cur = ui.target[o.key] || '';
  const p = parsePoint(cur);
  const them = game.opponent(f).name;
  if (o.point.area) {
    const at = p ? `(${fmt(p.x)}, ${fmt(p.y)})` : cur === 'them' ? them : 'click the field, or';
    return `<div class="point-pick">${o.point.line ? 'Toward' : 'At'} <b>${at}</b> <button class="ghost${cur === 'them' ? ' on' : ''}" data-point="${o.key}" data-way="them">${o.point.line ? 'At' : 'On'} ${them}</button></div>`;
  }
  const shown = p ? `(${fmt(p.x)}, ${fmt(p.y)})` : cur === 'toward' ? `toward ${them}` : cur === 'away' ? `away from ${them}` : 'click the field, or';
  const way = (w, label) => `<button class="ghost${cur === w ? ' on' : ''}" data-point="${o.key}" data-way="${w}">${label}</button>`;
  return `<div class="point-pick">To <b>${shown}</b> ${way('toward', `Toward ${them}`)}${way('away', 'Away')}</div>`;
}

function previewHtml(pv) {
  return pv.lines.filter(Boolean).map((l) => `<div>${relTimes(l)}</div>`).join('')
    + (pv.enabled ? '' : `<div class="reason">${relTimes(pv.reason)}</div>`)
    + (pv.enabled && pv.warning ? `<div class="reason">${relTimes(pv.warning)}</div>` : '');
}

function optionDesc(f, o) {
  if (o.group === 'drop') return (game.tech(f, o.key.slice(5)) || {}).desc || '';
  return [o.cardDesc, o.desc].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' ');
}

function menuRow(f, o) {
  const g = gistFor(f, o);
  const sel = ui.selected === o.key;
  const name = o.card && o.cardTitle ? `${o.cardTitle} <span class="sub">${o.label}</span>`
    : o.group === 'drop' ? o.label
    : `${o.label}${o.type && /stance/i.test(o.type) ? ' <span class="sub">stance</span>' : ''}`;
  const dis = !g.pv.enabled && !g.pick;
  const head = `<div class="mrow${sel ? ' sel' : ''}${dis ? ' dis' : ''}${g.warn ? ' warn' : ''}" data-select="${o.key}">
      <span class="ic">${iconFor(f, o)}</span><span class="nm">${name}</span>
      <span class="gist${g.warn ? ' w' : ''}">${g.warning ? `⚠ ${relTimes(g.warning.split(':')[0])}` : relTimes(g.text)}</span>
      <span class="cost">${g.cost}</span></div>`;
  if (!sel) return `<div class="mitem" data-card="${o.key}">${head}</div>`;
  const desc = optionDesc(f, o);
  const label = o.group === 'drop' ? 'Drop' : o.key === 'wait' ? 'Wait' : `Use ${o.label}`;
  return `<div class="mitem open" data-card="${o.key}">${head}
    <div class="detail">
      ${optionInputs(f, o)}
      <div class="card-preview" data-preview="${o.key}">${previewHtml(g.pv)}</div>
      ${ui.desc.has(o.key) && desc ? `<div class="desc">${desc}</div>` : ''}
      <div class="detail-actions"><button class="primary" data-act="${o.key}" ${g.pv.enabled ? '' : 'disabled'}>${label}</button>
        ${desc ? `<button class="ghost${ui.desc.has(o.key) ? ' on' : ''}" data-desc="${o.key}">ⓘ Description</button>` : ''}</div>
    </div></div>`;
}

function renderTurn(f) {
  const opts = game.turnOptions(f);
  if (ui.selected && !opts.some((o) => o.key === ui.selected)) ui.selected = null;
  const group = (g, label) => {
    const list = opts.filter((o) => o.group === g);
    return list.length ? `<div class="mgroup"><span class="label">${label}</span>${list.map((o) => menuRow(f, o)).join('')}</div>` : '';
  };
  return `
    <div class="phead theme-${f.theme}"><span class="prompt-title">${f.name}'s turn</span><span class="muted">Hover to preview on the board · click to open</span></div>
    ${walkBar(f)}
    <div class="menu">
      ${group('path', shortPath(game.path(f).name))}
      ${group('drop', 'Stances up')}
      ${group('basic', 'Basic')}
    </div>`;
}

// ---------- reaction ----------
// Everything the reaction panel shows, worked out from the engine's reaction API. Rendering reads
// only this model, so a change to the defense rules changes the model, not the markup.
function reactionModel() {
  const p = game.prompt;
  const a = p.attack;
  const att = game.fighters[a.attacker];
  const def = game.fighters[p.fighter];
  const prof = a.profile;
  const ro = game.reactionOptions();
  const kind = prof.effect === 'pulse' ? 'pulse' : ro.construct ? 'construct' : prof.effect === 'disrupt' ? 'disrupt' : 'attack';
  const canDodge = kind !== 'pulse' && kind !== 'construct' && ro.dodge.available;
  const canBlock = kind !== 'disrupt' && ro.block.maxBase >= 1;
  const choiceOf = (dodge, m) => (dodge && canDodge ? (m > 0 ? 'dodgeBlock' : 'dodge') : m > 0 ? 'block' : 'take');
  const outcome = (dodge, m) => { const c = choiceOf(dodge, m); return { choice: c, block: m, dodge: dodge && canDodge, ...game.reactionOutcome(c, m, walkChoice()) }; };
  const nothing = (o) => (kind === 'pulse' ? !o.pulse.targets.length : kind === 'disrupt' ? false : o.total === 0);

  // The smallest block that stops it all (or the most you can channel, if nothing does).
  let zero = null;
  if (canBlock) {
    for (let m = 1; m <= ro.block.maxBase; m++) if (nothing(outcome(false, m))) { zero = m; break; }
  }
  const blockAt = zero ?? (canBlock ? ro.block.maxBase : 0);

  const block = Math.min(Math.max(0, Math.round(ui.block)), canBlock ? ro.block.maxBase : 0);
  const current = outcome(ui.dodge, block);

  const dmgOf = (o) => (kind === 'pulse' ? (o.pulse.targets.length ? `breaks ${o.pulse.targets.length}` : 'breaks nothing')
    : kind === 'disrupt' ? `${pct(o.chance)} to hit`
    : `${o.perHitText || (o.hits > 1 ? `${o.hits} × ${o.perHit}` : o.total)} ${o.track === 'spirit' ? 'spirit ' : ''}damage`);
  const rollOf = (o) => (prof.area || kind === 'pulse' || kind === 'disrupt' ? '' : o.chances && o.chances.length > 1 ? `${o.chances.map(pct).join(' / ')} · ` : `${pct(o.chance)} · `);
  const costOf = (o) => [o.madraCost ? `${fmt(o.madraCost)} madra` : '', o.delay ? `+${fmt(o.delay)} ticks` : ''].filter(Boolean).join(', ') || 'free';

  const fatalOf = (o) => kind === 'attack' && o.total > 0 && (o.track === 'spirit' ? def.spirit : def.health) - o.total <= 0;
  // Block amounts worth stopping at, with the dodge as it's set.
  const marks = [];
  if (canBlock) {
    const base = outcome(ui.dodge, 0);
    const least = (test) => { for (let m = 1; m <= ro.block.maxBase; m++) if (test(outcome(ui.dodge, m))) return m; return null; };
    const mark = (at, text) => { if (at != null && !marks.some((x) => x.at === at)) marks.push({ at, label: text }); };
    if (kind === 'attack' && !base.escapes) {
      if (fatalOf(base)) mark(least((o) => !fatalOf(o)), 'you stay up');
      if (base.breaksStances) mark(least((o) => !o.breaksStances), 'keeps your stances');
      if (base.interrupts && def.windups.some((w) => !game.isPlainStrike(w))) mark(least((o) => !o.interrupts), 'keeps your wind-ups');
    }
    if (!base.escapes) mark(least(nothing), kind === 'pulse' ? 'nothing breaks' : 'stops it all');
    marks.sort((a, b) => a.at - b.at);
  }
  const tiles = [{ name: 'Take it', o: outcome(false, 0) }];
  if (canDodge) tiles.push({ name: 'Dodge', o: outcome(true, 0) });
  if (canBlock) tiles.push({ name: `${kind === 'construct' ? 'Reinforce' : 'Block'} ${blockAt}`, o: outcome(false, blockAt), note: zero == null ? 'most you can' : '' });

  const facts = [];
  if (kind === 'pulse') facts.push(`<b>${prof.madra}</b> madra pulse`, `cancels what cost <b>${fmt(prof.madra / 2)}</b> or less`);
  else if (kind === 'disrupt') facts.push('breaks your wind-ups and stances if it hits');
  else {
    const raw = prof.hitDamages ? prof.hitDamages.map(fmt).join(' + ') : fmt(prof.damage);
    facts.push(`<b>${raw}</b> ${prof.dtype === 'spiritual' ? 'spiritual' : prof.dtype === 'physical' ? 'physical' : 'technique'} damage`);
    if (a.hits > 1) facts.push(`<b>${a.hits}</b> hits`);
  }
  if (ro.construct) facts.push(`at your ${ro.construct.name} (${fmt(ro.construct.hp)} HP)`);
  if (prof.sharpness) facts.push(`sharpness <b>${prof.sharpness}</b>`);
  if (prof.toHit) facts.push(`<b>+${prof.toHit}</b> to hit`);
  if (prof.area) facts.push('area · <b>no roll</b>');
  if (prof.madra && kind === 'attack') facts.push(`${prof.madra} madra in it`);

  const st = ro.dodge.sidestep;
  const dodgeText = !canDodge ? '' : st
    ? `Sidestep ${fmt(st.metres)} m out from its centre: ${st.escapes ? '<b>gets you out</b>' : `still inside (you'd need ${fmt(st.needs)} m)`}`
    : `+${ro.dodge.bonus} Defense on ${a.hits > 1 ? 'every hit' : 'the hit'}`;
  const blockText = !canBlock ? '' : kind === 'pulse' ? `−${ro.block.soakPerMadra} strength per madra · up to ${ro.block.maxBase}`
    : `soaks ${ro.block.soakPerMadra} per madra${a.hits > 1 ? ', shared by the hits' : ''} · up to ${ro.block.maxBase}`;

  const o = current;
  const lines = [];
  let big;
  const defWindups = def.windups.filter((w) => !game.isPlainStrike(w));
  if (kind === 'pulse') {
    big = String(o.pulse.targets.length);
    lines.push(`Strength ${fmt(o.pulse.strength)}: cancels anything that cost ${fmt(o.pulse.strength / 2)} or less`);
    lines.push(o.pulse.targets.length ? `<span class="bad">Breaks ${o.pulse.targets.map((x) => `${x.name} (${fmt(x.cost)})`).join(', ')}</span>` : '<span class="ok">Nothing of yours breaks</span>');
  } else if (kind === 'disrupt') {
    big = pct(o.chance);
    lines.push('to hit');
    lines.push(`<span class="bad">If it hits: breaks your wind-ups and stances</span>${o.chances && o.chances.length ? '' : ''}`);
  } else if (kind === 'construct') {
    big = String(o.total);
    lines.push(`damage to ${ro.construct.name} · ${fmt(ro.construct.hp)} → ${fmt(Math.max(0, ro.construct.hp - o.total))} HP${prof.area ? '' : ` · if it hits (${pct(o.chance)})`}`);
  } else {
    const track = o.track === 'spirit' ? 'Spirit' : 'Health';
    const cur = o.track === 'spirit' ? def.spirit : def.health;
    big = o.perHitText || String(o.total);
    lines.push(`${o.track === 'spirit' ? 'spirit ' : ''}damage · ${track} ${fmt(cur)} → ${fmt(Math.max(0, cur - o.total))}${prof.area ? '' : ` · if ${o.hits > 1 ? 'all hit' : 'it hits'} (${o.chances && o.chances.length > 1 ? o.chances.map(pct).join(' / ') : pct(o.chance)})`}`);
    if (o.escapes) lines.push('<span class="ok">The sidestep takes you out of it</span>');
    const soaks = [o.absorbed ? `barrier soaks ${fmt(o.absorbed)}` : '', o.blocked ? `block soaks ${fmt(o.blocked)}` : ''].filter(Boolean);
    if (soaks.length) lines.push(soaks.join(' · ').replace(/^./, (c) => c.toUpperCase()));
    // A hit that empties health or spirit ends the fight: say so first, and skip the threshold news.
    const fatal = o.total > 0 && cur - o.total <= 0;
    if (fatal) lines.push(`<span class="bad"><b>Takes you out:</b> ${track.toLowerCase()} to 0${prof.area ? '' : ` if ${o.hits > 1 ? 'all hit' : 'it hits'}`}</span>`);
    else if (o.breaksStances) lines.push('<span class="bad">Breaks your stances and wind-ups</span>');
    else if (o.interrupts && defWindups.length) lines.push(`<span class="bad">Over your threshold (${fmt(game.threshold(def))}): breaks your wind-ups</span>`);
    else if (defWindups.length) lines.push(`<span class="ok">Under your threshold (${fmt(game.threshold(def))}): ${defWindups.map((w) => w.label).join(', ')} still lands</span>`);
  }
  if (o.courseText) lines.push(`Changes course: ${o.courseText === 'stop' ? 'stops walking' : `walks ${o.courseText}`}`);
  else if (o.courseError) lines.push(`<span class="bad">${o.courseError}</span>`);
  const after = def.nextTurn + (o.delay || 0);
  lines.push(o.madraCost || o.delay
    ? `Costs ${[o.madraCost ? `${fmt(o.madraCost)} madra` : '', o.delay ? `next turn ${inTicks(after)} instead of ${inTicks(def.nextTurn)}` : ''].filter(Boolean).join(' · ')}`
    : 'No cost');

  const label = { take: kind === 'pulse' ? 'Let it come' : 'Take it', dodge: 'Dodge', block: `${kind === 'construct' ? 'Reinforce' : kind === 'pulse' ? 'Brace' : 'Block'} ${block}`, dodgeBlock: `Dodge and block ${block}` }[o.choice];

  // Path reactions (the Mantle's redirect): their own row with a cost and what they do.
  const extra = [];
  if (ro.redirect && ro.redirect.shown) {
    extra.push({
      choice: 'redirect', name: 'Redirect', cost: `${ro.redirect.cost} madra`, available: ro.redirect.available,
      text: `Catch it in the Mantle and throw it back at ${att.name}: it lands on them in 1 · no damage to you${ro.redirect.available ? '' : ' · <span class="reason">not enough madra</span>'}`,
    });
  }

  const subtitle = defWindups.length
    ? `${defWindups.map((w) => `Your ${w.label} ${windupVerb(w)} ${inTicks(w.end)}`).join(' · ')}`
    : `threshold ${fmt(game.threshold(def))} · stances ${fmt(game.stanceThreshold(def))}`;

  return {
    att, def, prof, kind, facts, subtitle, canDodge, canBlock, dodgeText, blockText, maxBlock: ro.block.maxBase, marks,
    tiles: tiles.map((t) => ({ ...t, cost: costOf(t.o), result: `${rollOf(t.o)}${dmgOf(t.o)}${fatalOf(t.o) ? ' · <span class="bad">takes you out</span>' : ''}` })),
    current: { ...o, big, lines, label }, extra,
  };
}

function renderReaction(m) {
  const tile = (t) => {
    const on = t.o.choice === m.current.choice && t.o.block === m.current.block;
    return `<button class="rtile${on ? ' on' : ''}" data-rset="${t.o.dodge ? 1 : 0}:${t.o.block}">
      <span class="rt-head"><b>${t.name}</b><span class="muted">${t.cost}</span></span>
      <span class="rt-res">${t.result}${t.note ? ` <span class="muted">(${t.note})</span>` : ''}</span></button>`;
  };
  return `
    <div class="phead theme-${m.def.theme}"><span class="prompt-title">${m.def.name} reacts</span><span class="muted">${m.subtitle}</span></div>
    <div class="incoming theme-${m.att.theme}">
      <div class="what"><b>${m.att.name}'s ${m.prof.name}</b> is landing</div>
      <div class="facts">${m.facts.map((x) => `<span class="fact">${x}</span>`).join('')}</div>
    </div>
    <div class="rtiles">${m.tiles.map(tile).join('')}</div>
    ${m.canDodge || m.canBlock ? `<div class="rx">
      ${m.canDodge ? `<div class="ctrl${ui.dodge ? ' on' : ''}" data-dodge-toggle><div class="ch"><span class="toggle"></span>Dodge</div><div class="x">${m.dodgeText}</div></div>` : ''}
      ${m.canBlock ? `<div class="ctrl${m.current.block > 0 ? ' on' : ''}"><div class="ch">${m.kind === 'construct' ? 'Reinforce' : 'Block'}<span class="r">${m.blockText}</span></div>
        <label class="slider">Madra <input type="range" min="0" max="${m.maxBlock}" value="${m.current.block}" data-block><b data-block-val>${m.current.block}</b></label>
        <div data-block-marks>${marksHtml(m.marks, m.current.block, 'data-block-mark')}</div></div>` : ''}
    </div>` : ''}
    ${walkBar(m.def, `changing it costs +${fmt(game.courseDelay(m.def))} ticks`)}
    <div class="outcome" data-react-card="${m.current.choice}">
      <span class="big">${m.current.big}</span>
      <div class="lines">${m.current.lines.map((l) => `<span>${l}</span>`).join('')}</div>
      <button class="primary" data-react="${m.current.choice}">${m.current.label}</button>
    </div>
    ${m.extra.map((x) => `<div class="alt" data-react-card="${x.choice}">
      <span class="nm">${x.name}</span><span>${x.text}</span>
      <button data-react="${x.choice}" ${x.available ? '' : 'disabled'}>${x.name} · ${x.cost}</button></div>`).join('')}`;
}

function renderOpportunity(f) {
  const op = game.opportunityOptions();
  const s = op.strike;
  return `
    <div class="phead theme-${f.theme}"><span class="prompt-title">${f.name}: ${op.mover} is leaving</span><span class="muted">walking out of Close range</span></div>
    <div class="outcome" data-react-card="strike">
      <span class="big">${s.damageText}</span>
      <div class="lines"><span>damage if it hits (${pct(s.chance)}) · lands now${s.interrupts ? ' · <span class="bad">breaks their wind-ups</span>' : ''}</span><span>Costs: your next turn ${fmt(s.delay)} later</span></div>
      <button class="primary" data-opp="strike">Strike as they go</button>
    </div>
    <div class="alt"><span class="nm">Let them go</span><span>No cost</span><button data-opp="let">Let them go</button></div>`;
}

// An area that would catch you has just started: stay on course, or walk out of it.
function renderCourse(f) {
  const p = game.prompt;
  const after = game.fighters[p.after];
  const w = walkChoice();
  const pv = game.coursePreview(w);
  const threat = after.windups.find((x) => x.eventId === p.threat);
  const what = threat ? `<b>${after.name}'s ${threat.label}</b> ${windupVerb(threat)} ${inTicks(threat.end)}, and would catch you where you're headed` : `${after.name} has just acted`;
  return `
    <div class="phead theme-${f.theme}"><span class="prompt-title">${f.name}: walk out of it?</span></div>
    <div class="incoming theme-${after.theme}"><div class="what">${what}</div>
      ${threat ? `<div class="facts"><span class="fact">${relTimes(game.describeWindup(threat))}</span></div>` : ''}</div>
    ${walkBar(f, `changing it costs +${fmt(game.courseDelay(f))} ticks`)}
    <div class="card-preview">${previewHtml(pv)}</div>
    <div class="detail-actions"><button class="primary" data-course="keep">Stay as you are</button>
      <button data-course="change" ${w !== 'keep' && pv.enabled ? '' : 'disabled'}>Change course${pv.delay ? ` · +${fmt(pv.delay)} ticks` : ''}</button></div>`;
}

// ---------- prompt ----------
function renderPrompt() {
  const el = $('prompt');
  const p = game.prompt;
  el.className = 'panel prompt';
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
  el.classList.add(`theme-${f.theme}`);
  if (p.kind === 'turn') el.innerHTML = renderTurn(f);
  else if (p.kind === 'reaction') el.innerHTML = renderReaction(reactionModel());
  else if (p.kind === 'opportunity') el.innerHTML = renderOpportunity(f);
  else if (p.kind === 'course') el.innerHTML = renderCourse(f);
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

// ---------- timeline ----------
// One lane per fighter. Elements persist between updates (matched by key), so when time moves
// on they slide left instead of redrawing.
function loadQueueMode() {
  try { return localStorage.getItem('queueMode') === 'all'; } catch { return false; }
}

const SHAPE = { attack: '▼', move: '➜', stance: '◆', construct: '★', buildup: '▲' };

function timelineItems(ghost) {
  const whole = ui.queueAll;
  const items = [];
  const replaced = ghost ? (ghost.replacesTurn ?? ghost.shiftTurn) : null;
  for (const f of game.fighters) {
    for (const w of f.windups) {
      items.push({ key: `w:${w.eventId}`, who: f.index, kind: 'bar', start: w.start, end: w.end, label: `${w.label}${w.madra && !w.label.includes(`(${w.madra})`) ? ` · ${w.madra}` : ''}`, ev: w.eventId });
    }
    if (f.flight) items.push({ key: `fl:${f.index}:${f.flight.start}`, who: f.index, kind: 'bar', move: true, start: f.flight.start, end: f.flight.end, label: 'flying' });
  }
  for (const i of game.upcoming()) {
    const ev = i.key.startsWith('ev:') ? Number(i.key.slice(3)) : null;
    if (i.kind === 'turn') {
      const acting = game.prompt && game.prompt.kind === 'turn' && game.prompt.fighter === i.who;
      items.push({ key: i.key, who: i.who, kind: 'turn', time: i.time, label: i.label, tag: acting ? 'acts now' : `next turn ${inTicks(i.time)}`, replaced: replaced === i.who });
    } else {
      items.push({ key: i.key, who: i.who, kind: 'mark', type: i.type, time: i.time, label: i.label, detail: i.detail, ev });
    }
  }
  if (ghost) {
    for (const [n, q] of ghost.queue.entries()) {
      if (q.kind === 'turn') items.push({ key: `g:${n}`, who: q.who, kind: 'turn', ghost: true, time: q.time, label: q.label, tag: `next turn ${inTicks(q.time)}` });
      else {
        items.push({ key: `gb:${n}`, who: q.who, kind: 'bar', ghost: true, start: game.time, end: q.time, label: q.label.replace(/^[^:]+: /, '') });
        items.push({ key: `gm:${n}`, who: q.who, kind: 'mark', ghost: true, type: q.type, time: q.time, label: q.label });
      }
    }
  }
  if (whole) {
    for (const h of game.history || []) {
      items.push({ key: `h:${h.key}:${h.time}`, who: h.who, kind: h.kind === 'turn' ? 'turn' : 'mark', type: h.type, time: h.time, label: h.label, past: true });
    }
  }
  return items;
}

function renderQueue(ghost = null) {
  const q = $('queue');
  const whole = ui.queueAll;
  const items = timelineItems(ghost);
  const origin = whole ? 0 : game.time;
  const times = items.flatMap((i) => (i.kind === 'bar' ? [i.end] : [i.time]));
  // Leave room past the last item for its "next turn in N" tag.
  const horizon = Math.max(6, ...times.map((t) => Math.ceil((t - origin) * 1.15 + 0.5)));
  const at = (t) => `${Math.max(0, Math.min(100, ((t - origin) / horizon) * 100))}%`;

  if (!q.querySelector('.tl-body')) {
    q.innerHTML = `<div class="tl-head"><span class="label">Initiative</span><span class="clock"></span><span class="topbar-gap"></span>
        <span class="q-toggle"><button class="ghost" data-qmode="ahead">Ahead</button><button class="ghost" data-qmode="all">Whole fight</button></span></div>
      <div class="tl-body">${game.fighters.map((f) => `<div class="lane-name" data-lane-name="${f.index}"></div><div class="lane" data-lane="${f.index}"><div class="nowline"></div></div>`).join('')}
        <div class="axis"></div></div>`;
  }
  q.querySelector('.clock').textContent = `t = ${fmt(game.time)}`;
  q.querySelectorAll('[data-qmode]').forEach((b) => b.classList.toggle('on', (b.dataset.qmode === 'all') === whole));
  for (const f of game.fighters) {
    const name = q.querySelector(`[data-lane-name="${f.index}"]`);
    name.className = `lane-name theme-${f.theme}`;
    name.textContent = f.name;
    const lane = q.querySelector(`[data-lane="${f.index}"]`);
    lane.className = `lane theme-${f.theme}`;
    lane.querySelector('.nowline').style.left = at(game.time);
    // Bars that overlap in time (several stars forming at once) share the lane in sub-rows.
    const mine = items.filter((i) => i.who === f.index);
    const rowEnds = [];
    for (const i of mine.filter((x) => x.kind === 'bar').sort((a, b) => a.start - b.start)) {
      let r = rowEnds.findIndex((end) => end <= i.start + EPS);
      if (r < 0) { r = rowEnds.length; rowEnds.push(0); }
      rowEnds[r] = i.end;
      i.row = r;
    }
    syncLane(lane, mine, at, Math.max(1, rowEnds.length));
    const upkeep = game.activeStances(f).reduce((s, d) => s + game.upkeepRate(f, d), 0);
    let up = lane.querySelector('.upk');
    if (upkeep > 0) {
      if (!up) { up = document.createElement('div'); up.className = 'upk'; lane.appendChild(up); }
      up.style.left = at(game.time);
      up.title = `Upkeep ${fmt(upkeep)} madra per tick`;
    } else if (up) up.remove();
  }
  const axis = q.querySelector('.axis');
  const step = horizon > 24 ? 5 : horizon > 12 ? 2 : 1;
  const ticks = [];
  for (let k = 0; k <= horizon; k += step) ticks.push(`<span style="left:${(k / horizon) * 100}%">${whole ? k : k === 0 ? 'now' : `+${k}`}</span>`);
  axis.innerHTML = ticks.join('');
}

function syncLane(lane, items, at, rows = 1) {
  const existing = new Map([...lane.querySelectorAll(':scope > .tli')].map((el) => [el.dataset.key, el]));
  for (const i of items) {
    let el = existing.get(i.key);
    const cls = `tli ${i.kind}${i.type ? ` t-${i.type}` : ''}${i.ghost ? ' ghost' : ''}${i.past ? ' past' : ''}${i.replaced ? ' replaced' : ''}${i.move ? ' move' : ''}`;
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = i.key;
      if (!i.ghost) el.classList.add('entering');
      lane.appendChild(el);
      if (!i.ghost) setTimeout(() => el.classList.remove('entering'), 30);
    }
    existing.delete(i.key);
    const entering = el.classList.contains('entering');
    el.className = cls + (entering ? ' entering' : '');
    if (i.ev != null) el.dataset.ev = i.ev; else delete el.dataset.ev;
    el.title = `${i.kind === 'bar' ? `${fmt(i.start)}–${fmt(i.end)}` : `t=${fmt(i.time)}`} ${i.label}${i.detail ? `\n${i.detail}` : ''}`;
    if (i.kind === 'bar') {
      const s = Math.max(i.start, ui.queueAll ? 0 : game.time);
      el.style.left = at(s);
      el.style.width = `calc(${at(i.end)} - ${at(s)})`;
      // Up to three rows of bars keep their labels; more than that squeeze in without.
      const h = rows > 3 ? 39 / rows : 13;
      el.style.top = `${14 + (i.row || 0) * h}px`;
      el.style.height = `${h - 1}px`;
      el.style.lineHeight = `${h - 3}px`;
      el.textContent = rows > 3 ? '' : i.label;
    } else if (i.kind === 'turn') {
      el.style.left = at(i.time);
      el.innerHTML = i.past || i.replaced ? '' : `<span class="tag">${i.tag}</span>`;
    } else {
      el.style.left = at(i.time);
      el.textContent = SHAPE[i.type] || '•';
    }
  }
  for (const el of existing.values()) {
    if (el.classList.contains('ghost')) { el.remove(); continue; }
    if (el.classList.contains('bar') && ui.broken.has(el.dataset.ev)) {
      el.classList.add('broken');
      setTimeout(() => el.remove(), 1100);
      continue;
    }
    el.classList.add('leaving');
    el.style.left = at(game.time);
    setTimeout(() => el.remove(), 500);
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qmode]');
  if (!b) return;
  ui.queueAll = b.dataset.qmode === 'all';
  try { localStorage.setItem('queueMode', ui.queueAll ? 'all' : 'ahead'); } catch { /* storage unavailable */ }
  renderGhost();
});

// ---------- log ----------
function renderLog() {
  const rows = game.log.slice().reverse().map((e) => {
    const theme = e.who != null ? `theme-${game.fighters[e.who].theme}` : '';
    return `<li class="${e.cls} ${theme}"><span class="qt">t=${fmt(e.time)}</span><span>${e.text}</span></li>`;
  }).join('');
  $('log').innerHTML = `<span class="label">Log</span><ul class="loglist">${rows}</ul>`;
}

// ---------- ghosts ----------
// Hovering a choice previews its effects as ghosts on the bars, the field and the timeline.
// With nothing hovered, the selected menu row (or the reaction being built) is previewed.
function currentGhost() {
  const p = game.prompt;
  if (ui.hoverEv != null && !(ui.hover && (ui.hover.key || ui.hover.react))) return game.projectEvent(ui.hoverEv);
  if (!p || claudeToAct(game)) return null;
  // The mouse on the field previews walking there (or, for an open aimed row, aiming there).
  const walkHover = ui.fieldHover && !ui.fieldHover.key && !(ui.hover && ui.hover.key) ? ui.fieldHover.value : null;
  const walk = walkHover || walkChoice();
  if (p.kind === 'reaction') {
    const hovered = ui.hover && ui.hover.react;
    if (hovered === 'redirect') return game.projectReaction('redirect', 0, walk);
    const m = reactionModel();
    return game.projectReaction(m.current.choice, m.current.block, walk);
  }
  if (p.kind === 'course') return game.projectCourse(walk);
  if (p.kind !== 'turn') return null;
  const f = game.current();
  if (ui.fieldHover && ui.fieldHover.key && !(ui.hover && ui.hover.key)) {
    const k = ui.fieldHover.key;
    return game.project(f, k, ui.amount[k] || 0, ui.fieldHover.value, walkChoice());
  }
  // With no row open, a walk order is previewed as a wait.
  const k = (ui.hover && ui.hover.key) || ui.selected || (walk !== 'keep' ? 'wait' : null);
  if (!k) return null;
  return game.project(f, k, ui.amount[k] || 0, ui.target[k] || '', walk);
}

// The field reports what the mouse is on; preview it on the bars and the timeline (not the
// field itself, which draws its own hover).
function onFieldHover(value) {
  // With a targeted attack open, a spot away from any target is a walk there.
  const walking = ui.fieldReach && parsePoint(value || '');
  ui.fieldHover = value == null ? null : { key: walking ? null : ui.fieldKey, value };
  const ghost = currentGhost();
  game.fighters.forEach((f) => renderFighter(f, ghost));
  renderQueue(ghost);
}

function fieldOpts(ghost) {
  const p = game.prompt;
  const human = !!p && ['turn', 'reaction', 'course'].includes(p.kind) && !claudeToAct(game);
  const plan = ghost && ghost.path ? ghost.path : null;
  // What the field does depends on the open row (hovered, or else selected):
  //   Launch: hovering shows the flight and a click picks where it lands;
  //   an area set at a point, or a line: hovering shows its shape and a click aims it;
  //   a targeted attack: its reach, with targets marked in or out; a click on a target picks it;
  //   anything else (and any other click): hovering shows a walk there, and a click picks it.
  const out = { picking: null, plan, onPick: pickPoint, onTarget: pickTarget, onHover: onFieldHover, area: ghost && ghost.area ? ghost.area : null, aiming: null, reach: null, flight: null };
  ui.fieldKey = null;
  ui.fieldReach = false;
  if (!human) return out;
  if (p.kind !== 'turn') return { ...out, picking: p.fighter };
  const f = game.current();
  const key = (ui.hover && ui.hover.key) || ui.selected;
  const opt = key ? game.turnOptions(f).find((o) => o.key === key) : null;
  if (!opt) return { ...out, picking: p.fighter };
  if (opt.point && opt.point.area) { ui.fieldKey = key; return { ...out, picking: p.fighter, aiming: { key, amount: ui.amount[key] || 0 } }; }
  if (opt.point) {
    const t = game.tech(f, key);
    ui.fieldKey = key;
    return { ...out, picking: p.fighter, flight: t && t.kind === 'launch' ? { reach: game.launchReach(t), flight: true, travel: t.travel } : null };
  }
  const reach = reachFor(f, opt);
  if (reach) { ui.fieldKey = key; ui.fieldReach = true; }
  return reach ? { ...out, picking: p.fighter, reach } : { ...out, picking: p.fighter };
}

function reachFor(f, opt) {
  const t = opt.key === 'strike' ? null : game.tech(f, opt.key);
  const single = opt.key === 'strike' || (t && ((t.kind === 'attack' && !t.area) || t.kind === 'disrupt' || t.kind === 'pulse'));
  if (!single) return null;
  const prof = opt.key === 'strike' ? game.attackProfile(f, 'strike') : t.kind === 'attack' ? game.attackProfile(f, opt.key, ui.amount[opt.key] || 1) : t;
  const spec = game.specOf(prof);
  const o = game.opponent(f);
  const chosen = ui.target[opt.key] || '';
  const mine = game.pos(f);
  const targets = [{ id: '', label: o.name, at: game.pos(o), ok: game.reaches(prof, mine, game.pos(o)), chance: t && t.kind === 'pulse' ? null : game.hitChance(f, o, prof) }];
  if (opt.targets) {
    for (const c of o.constructs) {
      if (!opt.targets.some((x) => x.id === c.id)) continue;
      const cp = game.constructPos(o, c);
      targets.push({ id: c.id, label: `${o.name}'s ${c.name}`, at: { x: cp.x, y: cp.y - (cp.z ? 1.2 : 0) }, ok: true, chance: game.constructHitChance(f, prof, c) });
    }
  }
  for (const x of targets) {
    x.chosen = x.id === chosen;
    if (!x.ok) x.why = `out of reach (${fmt(A_dist(mine, x.at))} m; it reaches ${reachText(spec)})`;
  }
  return { key: opt.key, spec, targets };
}

function pickTarget(key, id) {
  const f = game.current();
  const opt = f && game.turnOptions(f).find((o) => o.key === key);
  if (!opt) return;
  if (opt.targets) ui.target[key] = id;
  ui.selected = key;
  renderPrompt();
  renderGhost();
}

// A spot clicked on the field aims the open aimed row (Launch, an area set at a point, a line);
// otherwise it's where to walk.
function pickPoint(pt) {
  const p = game.prompt;
  if (!p) return;
  const f = game.fighters[p.fighter];
  const open = p.kind === 'turn' && ui.selected ? game.turnOptions(f).find((o) => o.key === ui.selected && o.point) : null;
  if (open) ui.target[open.key] = pt;
  else ui.walk = pt;
  renderPrompt();
  renderGhost();
}

const isPointTarget = (v) => v === 'toward' || v === 'away' || v === 'them' || !!parsePoint(v);

function renderGhost() {
  const ghost = currentGhost();
  game.fighters.forEach((f) => renderFighter(f, ghost));
  renderQueue(ghost);
  renderField(game, fieldOpts(ghost));
}

// What has happened since the last render, for the board to show: hits and misses on the
// tokens, broken wind-ups on the timeline, and a beat before the next choice.
function freshFx() {
  const fx = game.log.slice(ui.logSeen).map((l) => l.fx).filter(Boolean);
  ui.logSeen = game.log.length;
  ui.broken = new Set(fx.flatMap((x) => x.evs || []).map(String));
  return fx;
}

function render() {
  ui.hover = null;
  ui.fieldHover = null;
  ui.hoverEv = null;
  const fx = freshFx();
  renderPrompt();
  renderGhost();
  showFx(game, fx);
  if (fx.some((x) => x.kind !== 'reveal')) {
    const el = $('prompt');
    el.classList.add('beat');
    setTimeout(() => el.classList.remove('beat'), 650);
  }
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
      resetView();
      return;
    }
  } catch (err) {
    console.warn('Could not restore the saved fight; starting a new one.', err);
  }
  start();
}

// ---------- events ----------
function afterChoice() {
  // Destinations are for this turn only.
  for (const k of Object.keys(ui.target)) if (isPointTarget(ui.target[k])) delete ui.target[k];
  ui.walk = 'keep';
  ui.selected = null;
  ui.dodge = false;
  ui.block = 0;
  render();
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act && !act.disabled) {
    const key = act.dataset.act;
    game.act(key, ui.amount[key] || 0, ui.target[key] || '', walkChoice());
    afterChoice();
    return;
  }
  const mark = e.target.closest('[data-mark]');
  if (mark) {
    ui.amount[mark.dataset.mark] = Number(mark.dataset.at);
    renderPrompt();
    renderGhost();
    return;
  }
  const blockMark = e.target.closest('[data-block-mark]');
  if (blockMark) {
    ui.block = Number(blockMark.dataset.at);
    renderPrompt();
    renderGhost();
    return;
  }
  const walk = e.target.closest('[data-walk]');
  if (walk) {
    ui.walk = walk.dataset.walk;
    renderPrompt();
    renderGhost();
    return;
  }
  const course = e.target.closest('[data-course]');
  if (course && !course.disabled) {
    game.course(course.dataset.course === 'keep' ? 'keep' : walkChoice());
    afterChoice();
    return;
  }
  const point = e.target.closest('[data-point]');
  if (point) {
    ui.target[point.dataset.point] = point.dataset.way;
    renderPrompt();
    renderGhost();
    return;
  }
  const desc = e.target.closest('[data-desc]');
  if (desc) {
    const k = desc.dataset.desc;
    if (ui.desc.has(k)) ui.desc.delete(k); else ui.desc.add(k);
    renderPrompt();
    return;
  }
  const sel = e.target.closest('[data-select]');
  if (sel) {
    const k = sel.dataset.select;
    ui.selected = ui.selected === k ? null : k;
    renderPrompt();
    renderGhost();
    return;
  }
  const opp = e.target.closest('[data-opp]');
  if (opp) {
    game.opportunity(opp.dataset.opp);
    afterChoice();
    return;
  }
  const react = e.target.closest('[data-react]');
  if (react && !react.disabled) {
    game.react(react.dataset.react, ui.block, walkChoice());
    afterChoice();
    return;
  }
  const rset = e.target.closest('[data-rset]');
  if (rset) {
    const [d, m] = rset.dataset.rset.split(':').map(Number);
    ui.dodge = !!d;
    ui.block = m;
    renderPrompt();
    renderGhost();
    return;
  }
  if (e.target.closest('[data-dodge-toggle]')) {
    ui.dodge = !ui.dodge;
    renderPrompt();
    renderGhost();
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    const [i, k] = tab.dataset.tab.split(':');
    ui.tabs[i] = ui.tabs[i] === k ? null : k;
    renderGhost();
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
    renderPrompt();
    renderGhost();
  }
});

// Slider changes update the open row in place (re-rendering would drop the drag).
document.addEventListener('input', (e) => {
  const key = e.target.dataset.amount;
  if (key) {
    ui.amount[key] = Number(e.target.value);
    document.querySelector(`[data-amount-val="${key}"]`).textContent = e.target.value;
    const f = game.current();
    const o = game.turnOptions(f).find((x) => x.key === key);
    if (o) {
      const g = gistFor(f, o);
      const item = document.querySelector(`.mitem[data-card="${key}"]`);
      item.querySelector('[data-preview]').innerHTML = previewHtml(g.pv);
      item.querySelector('.gist').textContent = g.warning ? `⚠ ${relTimes(g.warning.split(':')[0])}` : relTimes(g.text);
      item.querySelector('.cost').textContent = g.cost;
      item.querySelectorAll('.mark').forEach((b) => b.classList.toggle('on', Number(b.dataset.at) === ui.amount[key]));
      const btn = item.querySelector('[data-act]');
      if (btn) btn.disabled = !g.pv.enabled;
    }
    renderGhost();
    return;
  }
  if (e.target.hasAttribute('data-block')) {
    ui.block = Number(e.target.value);
    // Rebuild the panel but keep the slider being dragged.
    const m = reactionModel();
    const panel = $('prompt');
    const slider = e.target;
    const fresh = document.createElement('div');
    fresh.innerHTML = renderReaction(m);
    panel.querySelector('.rtiles').replaceWith(fresh.querySelector('.rtiles'));
    panel.querySelector('.outcome').replaceWith(fresh.querySelector('.outcome'));
    slider.closest('.ctrl').classList.toggle('on', m.current.block > 0);
    panel.querySelector('[data-block-marks]').innerHTML = marksHtml(m.marks, m.current.block, 'data-block-mark');
    panel.querySelector('[data-block-val]').textContent = String(m.current.block);
    renderGhost();
  }
});

// Hovering a timeline item highlights the matching wind-up chip, and the other way round.
function highlight(ev) {
  document.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
  if (ev == null) return;
  document.querySelectorAll(`[data-ev="${ev}"]`).forEach((el) => el.classList.add('hl'));
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-ev]');
  highlight(t ? t.dataset.ev : null);
  // Hovering a queued action (on the timeline, or a wind-up chip) shows what it would do to
  // its target's bars if it landed now.
  const ev = t ? t.dataset.ev : null;
  if (ev !== ui.hoverEv) {
    ui.hoverEv = ev;
    const ghost = currentGhost();
    game.fighters.forEach((f) => renderFighter(f, ghost));
  }
});

document.addEventListener('mouseover', (e) => {
  const card = e.target.closest('[data-card], [data-react-card]');
  const disabled = card && card.querySelector('.mrow.dis');
  const next = !card || disabled ? null
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
