// Path editor: make a Path from technique templates, tune each technique's numbers, set the
// Path's madra property, and save it so builds can learn it.
import { STAT_GROUPS } from './data.js';
import {
  TEMPLATES, defaultKnobs, compileTechnique, newPathDraft, loadPathDrafts, savePathDrafts, dimColor, applyCustomThemes,
} from './paths.js';

const STATS = STAT_GROUPS.flatMap(([, list]) => list);
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

let draft = null;
let onChange = () => {};
let status = '';

export function openPathEditor(opts = {}) {
  onChange = opts.onChange || onChange;
  const list = loadPathDrafts();
  draft = list.length ? clone(list[0]) : newPathDraft();
  status = '';
  let el = document.getElementById('path-editor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'path-editor';
    el.className = 'builder path-editor';
    document.body.appendChild(el);
  }
  el.hidden = false;
  render();
}

function knobInput(entry, k) {
  const v = entry.knobs[k.key] ?? k.def;
  const attr = `data-p-knob="${entry.uid}:${k.key}"`;
  if (k.type === 'bool') return `<label class="p-knob p-bool"><input type="checkbox" ${attr} ${v ? 'checked' : ''}> ${k.label}</label>`;
  if (k.type === 'select') {
    return `<label class="p-knob">${k.label} <select ${attr}>${k.options.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${lab}</option>`).join('')}</select></label>`;
  }
  return `<label class="p-knob">${k.label} <input type="number" ${attr} min="${k.min}" max="${k.max}" step="${k.step}" value="${v}"></label>`;
}

function render() {
  const el = document.getElementById('path-editor');
  const saved = loadPathDrafts();
  const list = saved.map((p) => `<li class="${p.id === draft.id ? 'on' : ''}">
      <button class="linkish" data-p-load="${p.id}">${esc(p.name)}</button>
      <button class="linkish danger" data-p-delete="${p.id}" title="Delete this Path">✕</button></li>`).join('')
    || '<li class="muted small">No custom Paths yet.</li>';

  const techs = draft.techniques.map((e) => {
    const tpl = TEMPLATES[e.template];
    const compiled = compileTechnique(draft.id, e)[0];
    return `<div class="b-tech p-tech">
      <div class="p-tech-head">
        <input class="p-name" data-p-field="${e.uid}:name" value="${esc(e.name)}">
        <span class="tag">${tpl.label}</span>
        <select data-p-field="${e.uid}:cost">
          ${[[0, 'Core (free)'], [1, 'Utility: 1 pt'], [2, 'Major: 2 pt']].map(([v, l]) => `<option value="${v}" ${Number(e.cost || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="linkish danger" data-p-remove="${e.uid}" title="Remove this technique">✕</button>
      </div>
      <div class="p-knobs">${tpl.knobs.map((k) => knobInput(e, k)).join('')}</div>
      <label class="p-knob p-flavor">Flavor <input data-p-field="${e.uid}:flavor" value="${esc(e.flavor)}" placeholder="Optional: what it looks like"></label>
      <div class="muted small b-desc">${esc(compiled.cardDesc || compiled.desc)}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="b-panel panel" style="--accent: ${draft.color || '#7fd1c7'}; --accent-dim: ${dimColor(draft.color)}">
      <div class="b-head">
        <h2>Path editor</h2>
        <button class="ghost" data-p-close>Close</button>
      </div>
      <div class="b-body">
        <aside class="b-side">
          <div class="section-label">Custom Paths</div>
          <ul class="b-list">${list}</ul>
          <button data-p-new>New Path</button>
        </aside>
        <section class="b-main">
          <div class="b-top">
            <label>Name <input data-p-path="name" value="${esc(draft.name)}"></label>
            <label>Signature stat <select data-p-path="signatureStat">${STATS.map(([v, l]) => `<option value="${v}" ${v === draft.signatureStat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <label class="p-wide">Summary <input data-p-path="summary" value="${esc(draft.summary)}" placeholder="One line shown on the fighter panel"></label>

          <div class="section-label">Madra type</div>
          <div class="p-knobs">
            <label class="p-knob">Name <input data-p-path="madraName" value="${esc(draft.madraName || '')}" placeholder="e.g. Storm madra"></label>
            <label class="p-knob">Color <input type="color" data-p-path="color" value="${draft.color || '#7fd1c7'}"></label>
            <span class="p-swatch" style="background: ${dimColor(draft.color)}; border-color: ${draft.color || '#7fd1c7'}; color: ${draft.color || '#7fd1c7'}">${esc(draft.madraName || 'New madra')}</span>
          </div>
          <div class="p-knobs">
            <label class="p-knob">Efficiency × <input type="number" data-p-path="efficiencyMult" min="0.8" max="1.5" step="0.05" value="${draft.efficiencyMult}"></label>
            <label class="p-knob">Sharpness <input type="number" data-p-path="sharpness" min="0" max="5" step="1" value="${draft.sharpness}"></label>
            <label class="p-knob p-bool"><input type="checkbox" data-p-path="pureMadra" ${draft.pureMadra ? 'checked' : ''}> Pure madra (blocks against it cost double; double damage to madra constructs)</label>
            <label class="p-knob p-bool"><input type="checkbox" data-p-path="selfBurn" ${draft.selfBurn ? 'checked' : ''}> Burns its user (1 health per 5 madra, 1 spirit per 10)</label>
          </div>
          <label class="p-wide">New effect <textarea data-p-path="element" rows="2" placeholder="Describe a madra property the options above don't cover; ask Claude to implement it.">${esc(draft.element)}</textarea></label>

          <div class="section-label">Techniques</div>
          ${techs}
          <div class="p-add">
            <select id="p-template">${Object.entries(TEMPLATES).map(([id, t]) => `<option value="${id}">${t.label}</option>`).join('')}</select>
            <button data-p-add>Add technique</button>
          </div>
          <div class="b-actions">
            <button data-p-save>${saved.some((p) => p.id === draft.id) ? 'Save changes' : 'Save Path'}</button>
            <span class="muted small">${status || 'Saved Paths appear in the builder’s Path list. Core techniques are free to every build on the Path.'}</span>
          </div>
        </section>
      </div>
    </div>`;
}

function change(fn) { fn(); render(); }
const nextUid = () => `t${1 + Math.max(0, ...draft.techniques.map((e) => Number(e.uid.slice(1)) || 0))}`;
const parse = (v) => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);

document.addEventListener('click', (e) => {
  if (!e.target.closest('#path-editor')) return;
  const t = e.target;
  if (t.closest('[data-p-close]') || t.id === 'path-editor') { document.getElementById('path-editor').hidden = true; return; }
  if (t.closest('[data-p-new]')) { change(() => { draft = newPathDraft(); status = ''; }); return; }
  const load = t.closest('[data-p-load]');
  if (load) { change(() => { draft = clone(loadPathDrafts().find((p) => p.id === load.dataset.pLoad)); status = ''; }); return; }
  const del = t.closest('[data-p-delete]');
  if (del) {
    const p = loadPathDrafts().find((x) => x.id === del.dataset.pDelete);
    if (p && confirm(`Delete the Path "${p.name}"? Builds on it will stop appearing.`)) {
      savePathDrafts(loadPathDrafts().filter((x) => x.id !== p.id));
      if (draft.id === p.id) draft = newPathDraft();
      onChange();
      render();
    }
    return;
  }
  const rm = t.closest('[data-p-remove]');
  if (rm) { change(() => { draft.techniques = draft.techniques.filter((x) => x.uid !== rm.dataset.pRemove); }); return; }
  if (t.closest('[data-p-add]')) {
    change(() => {
      const template = document.getElementById('p-template').value;
      draft.techniques.push({ uid: nextUid(), template, name: `New ${TEMPLATES[template].label.toLowerCase()}`, cost: 1, flavor: '', knobs: defaultKnobs(template) });
    });
    return;
  }
  if (t.closest('[data-p-save]')) {
    change(() => {
      if (!draft.techniques.some((x) => !x.cost)) { status = 'A Path needs at least one core (free) technique.'; return; }
      const list = loadPathDrafts();
      const i = list.findIndex((p) => p.id === draft.id);
      if (i >= 0) list[i] = clone(draft); else list.push(clone(draft));
      savePathDrafts(list);
      applyCustomThemes();
      status = 'Saved.';
      onChange();
    });
  }
});

document.addEventListener('change', (e) => {
  if (!e.target.closest('#path-editor')) return;
  const t = e.target;
  const value = t.type === 'checkbox' ? t.checked : parse(t.value);
  if (t.dataset.pPath) { change(() => { draft[t.dataset.pPath] = value; }); return; }
  if (t.dataset.pField) {
    const [uid, key] = t.dataset.pField.split(':');
    change(() => { const entry = draft.techniques.find((x) => x.uid === uid); entry[key] = key === 'cost' ? Number(value) : value; });
    return;
  }
  if (t.dataset.pKnob) {
    const [uid, key] = t.dataset.pKnob.split(':');
    change(() => { draft.techniques.find((x) => x.uid === uid).knobs[key] = value; });
  }
});
