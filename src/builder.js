// Character builder screen: start from a template fighter, spend points on stats, extra
// techniques and refinements, and save the build so it can be picked to fight.
import { FIGHTERS, STAT_GROUPS, TRAITS, WEAPONS } from './data.js';
import { allPaths, getPath } from './paths.js';
import { openPathEditor } from './patheditor.js';
import {
  BUDGET, STAT_STEP, STAT_FLOOR, REFINEMENTS, REFINE_UP_LIMIT, REFINE_DOWN_LIMIT,
  newBuild, costs, statCost, refineCost, refineSteps, refinementsFor, isCore, weaponCost, traitCost,
  loadBuilds, saveBuilds, toFighter,
} from './builds.js';

const THEME = { blackFlame: 'flame', endlessSword: 'sword', hollowKing: 'pure', dawnOath: 'force' };
const fmtStep = (n) => (n > 0 ? `+${n}` : `${n}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

let draft = null;       // the build being edited
let onChange = () => {};

export function openBuilder(opts = {}) {
  onChange = opts.onChange || onChange;
  const builds = loadBuilds();
  draft = builds.length ? clone(builds[0]) : newBuild('eithan');
  document.getElementById('builder').hidden = false;
  render();
}

function close() {
  document.getElementById('builder').hidden = true;
}

function render() {
  const el = document.getElementById('builder');
  const c = costs(draft);
  const path = getPath(draft.path);
  const fighter = toFighter(draft);
  const saved = loadBuilds();

  const savedList = saved.map((b) => `
    <li class="${b.id === draft.id ? 'on' : ''}">
      <button class="linkish" data-b-load="${b.id}">${b.name}</button>
      <span class="muted small">${getPath(b.path).name.replace('Path of ', '')} · ${costs(b).total}/${BUDGET}</span>
      <button class="linkish danger" data-b-delete="${b.id}" title="Delete this build">✕</button>
    </li>`).join('') || '<li class="muted small">No saved builds yet.</li>';

  const statRows = STAT_GROUPS.map(([group, list]) => `
    <div class="b-group">${group}</div>
    ${list.map(([k, label]) => {
      const n = draft.steps[k] || 0;
      const sig = path.signatureStat === k;
      return `<div class="b-row">
        <span>${label}${sig ? ' <span class="tag">Path: first step free</span>' : ''}</span>
        <span class="b-val">${fighter.stats[k]}</span>
        <span class="b-step">
          <button data-b-stat="${k}" data-d="-1" ${n <= -STAT_FLOOR ? 'disabled' : ''}>−</button>
          <b>${fmtStep(n)}</b>
          <button data-b-stat="${k}" data-d="1">+</button>
        </span>
        <span class="b-cost ${statCost(draft, k) < 0 ? 'refund' : ''}">${n ? `${statCost(draft, k)} pt` : ''}</span>
        <span class="muted small">${STAT_STEP[k]} per step</span>
      </div>`;
    }).join('')}`).join('');

  const techRows = path.techniques.filter((t) => t.kind !== 'command').map((t) => {
    const core = isCore(t);
    const has = core || draft.learned.includes(t.id);
    const refs = refinementsFor(t);
    const r = draft.refine[t.id] || {};
    const { up, down } = refineSteps(draft, t.id);
    const refineRows = has && refs.length ? refs.map((key) => {
      const n = r[key] || 0;
      return `<div class="b-ref">
        <span>${REFINEMENTS[key].label}</span>
        <span class="b-step">
          <button data-b-ref="${t.id}:${key}" data-d="-1" ${n <= 0 && down >= REFINE_DOWN_LIMIT ? 'disabled' : ''}>−</button>
          <b>${fmtStep(n)}</b>
          <button data-b-ref="${t.id}:${key}" data-d="1" ${n >= 0 && up >= REFINE_UP_LIMIT ? 'disabled' : ''}>+</button>
        </span>
        <span class="muted small">${n > 0 ? REFINEMENTS[key].up : n < 0 ? REFINEMENTS[key].down : `${REFINEMENTS[key].up} per step`}</span>
      </div>`;
    }).join('') : '';
    const rc = has ? refineCost(draft, t.id) : 0;
    return `<div class="b-tech ${has ? '' : 'off'}">
      <label class="b-tech-head">
        <input type="checkbox" data-b-learn="${t.id}" ${has ? 'checked' : ''} ${core ? 'disabled' : ''}>
        <b>${t.name}</b> <span class="tag">${t.type}</span>
        <span class="muted small">${core ? 'core, free' : `${t.cost} pt`}</span>
        ${rc ? `<span class="b-cost ${rc < 0 ? 'refund' : ''}">refinements ${rc} pt</span>` : ''}
      </label>
      <div class="muted small b-desc">${t.cardDesc || t.desc}</div>
      ${refineRows}
    </div>`;
  }).join('');

  const weaponName = draft.weapon ? draft.weapon.name : 'unarmed';
  const gear = `
    <div class="section-label">Traits and weapon</div>
    ${Object.entries(TRAITS).map(([id, tr]) => `<label class="b-tech-head">
      <input type="checkbox" data-b-trait="${id}" ${draft.traits.includes(id) ? 'checked' : ''}>
      <b>${tr.name}</b> <span class="muted small">${traitCost(id)} pt</span></label>
      <div class="muted small b-desc">${tr.desc}</div>`).join('')}
    <label class="b-weapon">Weapon <select id="b-weapon">${WEAPONS.map((w) => `<option value="${w.name}" ${w.name === weaponName ? 'selected' : ''}>${w.name}${w.damage ? ` (+${w.damage} damage)` : ''}${w.blade ? ', blade' : ''} · ${weaponCost(w)} pt</option>`).join('')}</select></label>
    <div class="muted small b-note">Traits have fixed prices; a weapon costs 1 point per +2 damage, and being a blade is free.</div>`;

  el.innerHTML = `
    <div class="b-panel panel theme-${draft.theme}">
      <div class="b-head">
        <h2>Character builder</h2>
        <button class="ghost" data-b-close>Close</button>
      </div>
      <div class="b-body">
        <aside class="b-side">
          <div class="section-label">Saved builds</div>
          <ul class="b-list">${savedList}</ul>
          <div class="section-label">Paths</div>
          <button class="ghost b-paths" data-b-paths>Path editor…</button>
          <div class="section-label">New build from</div>
          <div class="b-new">
            <select id="b-template">${FIGHTERS.map((f) => `<option value="${f.id}" ${f.id === draft.base ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
            <button data-b-new>New</button>
          </div>
        </aside>
        <section class="b-main">
          <div class="b-top">
            <label>Name <input id="b-name" value="${draft.name.replace(/"/g, '&quot;')}"></label>
            <label>Path <select id="b-path">${Object.entries(allPaths()).map(([id, p]) => `<option value="${id}" ${id === draft.path ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
            <div class="b-budget ${c.left < 0 ? 'over' : ''}">
              <b>${c.total}</b> of ${BUDGET} points
              <span class="muted small">stats ${c.stats} · techniques ${c.techs} · refinements ${c.refine} · traits and weapon ${c.gear}</span>
              <span>${c.left < 0 ? `${-c.left} over budget` : `${c.left} left`}</span>
            </div>
          </div>
          <div class="b-cols">
            <div><div class="section-label">Stats</div>${statRows}
              <div class="muted small b-note">Each step up costs 1 point; each step down pays back 1, down to −3 per stat.</div>
              ${gear}</div>
            <div><div class="section-label">Techniques</div>${techRows}
              <div class="muted small b-note">Refinements cost 1 point per step up (at most ${REFINE_UP_LIMIT} per technique); each step down pays back 1 (at most ${REFINE_DOWN_LIMIT}).</div></div>
          </div>
          <div class="b-actions">
            <button data-b-save ${c.left < 0 ? 'disabled' : ''}>${saved.some((b) => b.id === draft.id) ? 'Save changes' : 'Save build'}</button>
            <span class="muted small">Saved builds appear in the Fighters pickers.</span>
          </div>
        </section>
      </div>
    </div>`;
}

function change(fn) {
  fn();
  render();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#builder')) return;
  const t = e.target;
  if (t.closest('[data-b-close]') || t.id === 'builder') { close(); return; }
  const stat = t.closest('[data-b-stat]');
  if (stat) {
    change(() => {
      const k = stat.dataset.bStat;
      draft.steps[k] = Math.max(-STAT_FLOOR, (draft.steps[k] || 0) + Number(stat.dataset.d));
    });
    return;
  }
  const ref = t.closest('[data-b-ref]');
  if (ref) {
    change(() => {
      const [id, key] = ref.dataset.bRef.split(':');
      const r = draft.refine[id] || (draft.refine[id] = {});
      r[key] = (r[key] || 0) + Number(ref.dataset.d);
      if (!r[key]) delete r[key];
    });
    return;
  }
  if (t.closest('[data-b-paths]')) {
    openPathEditor({ onChange: () => { onChange(); render(); } });
    return;
  }
  if (t.closest('[data-b-new]')) {
    change(() => { draft = newBuild(document.getElementById('b-template').value); });
    return;
  }
  const load = t.closest('[data-b-load]');
  if (load) {
    change(() => { draft = clone(loadBuilds().find((b) => b.id === load.dataset.bLoad)); });
    return;
  }
  const del = t.closest('[data-b-delete]');
  if (del) {
    const b = loadBuilds().find((x) => x.id === del.dataset.bDelete);
    if (b && confirm(`Delete the build "${b.name}"?`)) {
      saveBuilds(loadBuilds().filter((x) => x.id !== b.id));
      if (draft.id === b.id) draft = newBuild(b.base);
      onChange();
      render();
    }
    return;
  }
  if (t.closest('[data-b-save]')) {
    const list = loadBuilds();
    const i = list.findIndex((b) => b.id === draft.id);
    if (i >= 0) list[i] = clone(draft); else list.push(clone(draft));
    saveBuilds(list);
    onChange();
    render();
  }
});

document.addEventListener('change', (e) => {
  if (!e.target.closest('#builder')) return;
  const t = e.target;
  if (t.id === 'b-name') { draft.name = t.value.trim() || draft.name; render(); }
  if (t.id === 'b-path') {
    change(() => {
      draft.path = t.value;
      draft.theme = getPath(t.value).theme || THEME[t.value] || draft.theme;
      draft.learned = getPath(t.value).techniques.filter((x) => !isCore(x)).map((x) => x.id);
      draft.refine = {};
    });
  }
  if (t.id === 'b-weapon') {
    change(() => {
      const w = WEAPONS.find((x) => x.name === t.value);
      draft.weapon = w && w.name !== 'unarmed' ? { ...w } : null;
    });
  }
  const trait = t.closest('[data-b-trait]');
  if (trait) {
    change(() => {
      const id = trait.dataset.bTrait;
      draft.traits = trait.checked ? [...new Set([...draft.traits, id])] : draft.traits.filter((x) => x !== id);
    });
  }
  const learn = t.closest('[data-b-learn]');
  if (learn) {
    change(() => {
      const id = learn.dataset.bLearn;
      draft.learned = learn.checked ? [...new Set([...draft.learned, id])] : draft.learned.filter((x) => x !== id);
      if (!learn.checked) delete draft.refine[id];
    });
  }
});

