// Claude as a player. When a side is handed to Claude, the app saves the board to the dev
// server after every change (.duel/state.json), and applies Claude's moves from /api/move
// whenever that side has a decision to make.
import { fmt } from './engine.js';
import { RANGES } from './rules.js';

const state = { side: loadSide(), lastMoveId: null, takeOver: null, error: '', poll: null, post: null };
let getGame = () => null;
let rerender = () => {};

function loadSide() {
  try {
    const v = localStorage.getItem('claudeSide');
    return v === null || v === '' ? null : Number(v);
  } catch {
    return null;
  }
}

function saveSide(v) {
  try { localStorage.setItem('claudeSide', v == null ? '' : String(v)); } catch { /* storage unavailable */ }
}

const decisionKey = (game) => `${game.id}:${game.decision}`;

export const claudeSide = () => state.side;

export function initClaude(gameGetter, render) {
  getGame = gameGetter;
  rerender = render;
  const select = document.getElementById('claude-side');
  select.addEventListener('change', () => {
    state.side = select.value === '' ? null : Number(select.value);
    state.error = '';
    saveSide(state.side);
    rerender();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-takeover]')) {
      state.takeOver = decisionKey(getGame());
      rerender();
    }
  });
}

export function claudeToAct(game) {
  const p = game.prompt;
  return state.side != null && p && p.kind !== 'over' && p.fighter === state.side
    && state.takeOver !== decisionKey(game);
}

export function waitingPanel(game) {
  const f = game.fighters[state.side];
  const p = game.prompt;
  let incoming = '';
  if (p.kind === 'reaction') {
    const a = p.attack;
    const att = game.fighters[a.attacker];
    incoming = `<div class="incoming theme-${att.theme}"><b>${att.name}'s ${a.profile.name}</b> is landing on ${f.name}${a.hits > 1 ? ` (${a.hits} hits)` : ''}.</div>`;
  }
  return `
    <div class="prompt-title theme-${f.theme}">Claude is playing ${f.name} <span class="muted">t=${fmt(game.time)}</span></div>
    ${incoming}
    <p class="waiting"><span class="dot"></span>Waiting for Claude's ${p.kind === 'reaction' ? 'reaction' : 'move'}…</p>
    ${state.error ? `<p class="reason">${state.error}</p>` : ''}
    <button data-takeover class="ghost">Play this one myself</button>`;
}

// Call after every render.
export function syncClaude(game) {
  const select = document.getElementById('claude-side');
  const names = game.fighters.map((f) => f.name).join('|');
  if (select.dataset.names !== names) {
    select.innerHTML = `<option value="">nobody</option>`
      + game.fighters.map((f) => `<option value="${f.index}">${f.name}</option>`).join('');
    select.dataset.names = names;
  }
  select.value = state.side == null ? '' : String(state.side);

  if (state.side == null) {
    stopPolling();
    return;
  }
  clearTimeout(state.post);
  state.post = setTimeout(() => postState(getGame()), 100);
  if (claudeToAct(game)) startPolling();
  else stopPolling();
}

function startPolling() {
  if (!state.poll) state.poll = setInterval(pollMove, 1000);
}

function stopPolling() {
  clearInterval(state.poll);
  state.poll = null;
}

// The hosted site protects the sync with a key. The app asks for it the first time the server
// refuses, remembers it in this browser, and sends it with every sync call.
function syncHeaders(extra = {}) {
  let key = '';
  try { key = localStorage.getItem('syncKey') || ''; } catch { /* storage unavailable */ }
  return key ? { ...extra, 'X-Sync-Key': key } : extra;
}

let keyAsked = false;
export async function syncFetch(url, opts = {}, { ask = true } = {}) {
  const send = () => fetch(url, { ...opts, headers: syncHeaders(opts.headers) });
  const r = await send();
  if (r.status !== 401 || !ask || keyAsked) return r;
  keyAsked = true;
  const key = window.prompt('This server protects the Claude sync with a key. Enter it to let Claude play:');
  if (!key) return r;
  try { localStorage.setItem('syncKey', key.trim()); } catch { /* storage unavailable */ }
  keyAsked = false;
  return send();
}

async function postState(game) {
  try {
    await syncFetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot(game)),
    });
  } catch { /* server not reachable; try again on the next change */ }
}

async function pollMove() {
  const game = getGame();
  if (!claudeToAct(game)) { stopPolling(); return; }
  let move;
  try {
    const r = await syncFetch('/api/move');
    if (r.status !== 200) return;
    move = await r.json();
  } catch {
    return;
  }
  if (move.gameId !== game.id || move.decision !== game.decision || move.id === state.lastMoveId) return;
  state.lastMoveId = move.id;
  const before = decisionKey(game);
  let onlyDraw = true;
  for (const a of move.actions || []) {
    if (a.key === 'offerDraw' || a.key === 'withdrawDraw') {
      game.setDrawOffer(state.side, a.key === 'offerDraw');
      continue;
    }
    onlyDraw = false;
    if (game.prompt.kind === 'reaction') game.react(a.key, a.amount || 0);
    else if (game.prompt.kind === 'turn') game.act(a.key, a.amount || 0, a.target || '');
  }
  const stuck = !onlyDraw && !game.result && decisionKey(game) === before;
  state.error = stuck
    ? `Claude's move (${(move.actions || []).map((a) => a.key + (a.amount ? ' ' + a.amount : '')).join(', ')}) wasn't valid. Waiting for another.`
    : '';
  rerender();
}

const r1 = (n) => Math.round(n * 10) / 10;

function snapshot(game) {
  const p = game.prompt;
  const cur = game.current();
  const fighters = game.fighters.map((f) => ({
    name: f.name,
    path: game.path(f).name,
    health: r1(f.health), maxHealth: f.stats.health,
    spirit: r1(f.spirit), maxSpirit: f.stats.spirit,
    madra: r1(f.madra), maxMadra: f.stats.pool,
    speed: r1(game.speed(f)),
    nextTurn: r1(f.nextTurn),
    threshold: r1(game.threshold(f)),
    stanceThreshold: r1(game.stanceThreshold(f)),
    weapon: f.weapon ? f.weapon.name : null,
    constructs: f.constructs.map((c) => ({ id: c.id, name: c.name, hp: r1(c.hp), stars: c.stars ?? null })),
    stats: f.stats,
    stances: game.activeStances(f).map((d) => ({ name: d.name, buildUp: game.buildUp(f, d), nextBuildUp: d.buildUp ? r1(game.nextBuildUp(f, d)) : null, upkeep: r1(game.upkeepRate(f, d)) })),
    windups: f.windups.map((w) => ({ label: w.label, madra: w.madra, lands: r1(w.end), boost: r1(w.boost || 0) })),
    moving: f.moving && { dir: f.moving.dir < 0 ? 'in' : 'away', arrives: r1(f.moving.end) },
  }));

  let options = null;
  let reaction = null;
  if (p && p.kind === 'turn') {
    options = game.turnOptions(cur).map((o) => {
      const amount = o.slider ? o.slider.initial : 0;
      const pv = game.preview(cur, o.key, amount);
      return {
        key: o.key,
        label: o.label,
        slider: o.slider ? { label: o.slider.label, min: o.slider.min, max: o.slider.max, step: o.slider.step, previewAt: amount } : null,
        targets: o.targets ? o.targets.filter((t) => t.id).map((t) => ({ id: t.id, label: t.label })) : null,
        enabled: pv.enabled,
        reason: pv.reason,
        warning: pv.warning || null,
        preview: pv.lines.filter(Boolean),
      };
    });
  }
  if (p && p.kind === 'reaction') {
    const a = p.attack;
    const ro = game.reactionOptions();
    reaction = {
      attacker: game.fighters[a.attacker].name,
      attack: { name: a.profile.name, damage: a.profile.hitDamages ? a.profile.hitDamages.map(r1).join(' + ') : r1(a.profile.damage), dtype: a.profile.dtype, pure: !!a.profile.pure, hits: a.hits, area: a.profile.area, sharpness: a.profile.sharpness, toHit: a.profile.toHit },
      take: { chance: r1(ro.take.chance), damageEach: ro.take.damageText },
      dodge: { ...ro.dodge, chance: r1(ro.dodge.chance), chances: ro.dodge.chances.map(r1), delay: r1(ro.dodge.delay) },
      block: { ...ro.block, chance: r1(ro.block.chance) },
      redirect: ro.redirect,
      effect: a.profile.effect || null,
      construct: ro.construct ? { id: ro.construct.id, name: ro.construct.name, hp: r1(ro.construct.hp) } : null,
      pulse: a.profile.effect === 'pulse'
        ? { madra: a.profile.madra, breaks: game.reactionOutcome('take').pulse.targets.map((x) => ({ name: x.name, cost: r1(x.cost) })) }
        : null,
    };
  }

  return {
    gameId: game.id,
    codeVersion: document.documentElement.dataset.codeVersion || null,
    decision: game.decision,
    claudeSide: state.side == null ? null : game.fighters[state.side].name,
    claudeToAct: claudeToAct(game),
    drawOffers: game.fighters.filter((f) => game.drawOffers[f.index]).map((f) => f.name),
    error: state.error,
    time: r1(game.time),
    range: RANGES[game.distance],
    prompt: p && { kind: p.kind, fighter: p.fighter != null ? game.fighters[p.fighter].name : null },
    result: game.result && (game.result.draw ? 'draw' : `${game.fighters[game.result.winner].name} wins`),
    fighters,
    options,
    reaction,
    queue: game.upcoming().slice(0, 8).map((i) => ({ time: r1(i.time), label: i.label })),
    log: game.log.slice(-14).map((l) => `t=${fmt(l.time)} ${l.text}`),
  };
}
