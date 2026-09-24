// App controller: item picker, suitcase settings, saved trips, packing request,
// player UI, sharing and printing.

import { PackingScene } from './scene.js';
import { thumbInto } from './thumbs.js';
import { MODEL_BUILDERS } from './models.js';
import { connect } from './api.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const svg = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const fmt = (n, d = 1) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>';

const SHELL_COLORS = ['#2f4858', '#1f2937', '#9b2226', '#0f766e', '#c2a878', '#5b6cff'];
const STORE_KEY = 'spa-state-v1';

const state = {
  catalog: null,
  suitcaseId: 'carry_on',
  dims: null,             // { length, width, height, max_weight }
  shell: SHELL_COLORS[0],
  qty: {},                // catalog id -> quantity
  priority: {},           // catalog id -> true/false (overrides the catalog default)
  custom: [],             // user-defined items
  allowSqueeze: true,
  category: 'all',
  query: '',
  profile: null,
  layout: null,
  trips: [],
};

let scene;
let backend;

// --------------------------------------------------------------------------- //
async function init() {
  try {
    scene = new PackingScene($('scene'));
  } catch (err) {
    $('emptyState').innerHTML = `<h3>3D view unavailable</h3><p>${escapeHtml(err.message)} Try a recent Chrome, Edge or Firefox.</p>`;
  }
  window.spa = { state, get scene() { return scene; }, get backend() { return backend; } };
  backend = await connect();
  state.catalog = backend.catalog;
  $('modeBadge').textContent = backend.mode === 'server' ? 'Running on your computer' : 'Running in your browser';
  $('printBtn').hidden = backend.mode !== 'server';
  $('printBtn').previousElementSibling.hidden = backend.mode !== 'server';
  $('modeBadge').title = backend.mode === 'server'
    ? 'Packing runs in Python; saved trips are stored in data/trips.json'
    : 'Packing runs in this browser; saved trips are stored in this browser only';
  restore();
  const shared = readShareLink();
  renderSuitcases();
  renderSwatches();
  renderProfiles();
  renderCategories();
  renderItems();
  renderCustomModelOptions();
  $('squeezeToggle').checked = state.allowSqueeze;
  applySuitcase(false);
  updateSummary();
  bindControls();
  await refreshTrips();
  if (shared) toast('Loaded a shared packing list. Press "Pack my suitcase" to see it.');
}

// -- persistence (per-browser convenience only) ------------------------------ //
function snapshot() {
  return {
    suitcaseId: state.suitcaseId, dims: state.dims, shell: state.shell, qty: state.qty,
    priority: state.priority, custom: state.custom, allowSqueeze: state.allowSqueeze,
  };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch { /* storage unavailable: fine */ }
}
function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  if (saved) applySnapshot(saved);
  if (!state.dims) state.dims = presetDims(state.suitcaseId);
}
function applySnapshot(s) {
  const ids = new Set(state.catalog.items.map((i) => i.id));
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const dims = s.dims && num(s.dims.length) && num(s.dims.width) && num(s.dims.height)
    ? { length: +s.dims.length, width: +s.dims.width, height: +s.dims.height, max_weight: num(s.dims.max_weight) }
    : null;
  state.suitcaseId = typeof s.suitcaseId === 'string' ? s.suitcaseId : state.suitcaseId;
  state.dims = dims || presetDims(state.suitcaseId);
  state.shell = SHELL_COLORS.includes(s.shell) ? s.shell : state.shell;
  state.qty = Object.fromEntries(Object.entries(s.qty || {}).filter(([k, v]) => ids.has(k) && +v > 0).map(([k, v]) => [k, Math.min(20, Math.round(+v))]));
  state.priority = Object.fromEntries(Object.entries(s.priority || {}).filter(([k]) => ids.has(k)).map(([k, v]) => [k, !!v]));
  state.custom = Array.isArray(s.custom) ? s.custom.filter(validCustom).slice(0, 50) : [];
  if (typeof s.allowSqueeze === 'boolean') state.allowSqueeze = s.allowSqueeze;
}
function validCustom(c) {
  return c && typeof c.name === 'string' && [c.length, c.width, c.height].every((v) => Number.isFinite(+v) && +v > 0 && +v <= 200);
}

function presetDims(id) {
  const s = state.catalog.suitcases.find((x) => x.id === id) || state.catalog.suitcases[1];
  return { length: s.length, width: s.width, height: s.height, max_weight: s.max_weight };
}

// -- share links ------------------------------------------------------------- //
function encodeShare() {
  const data = { v: 1, ...snapshot() };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeShare(text) {
  const t = String(text).trim();
  const m = t.match(/#t=([A-Za-z0-9_-]+)/) || t.match(/^(?:SPA1:)?([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new Error('not a trip code');
  const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.qty) throw new Error('empty trip code');
  return data;
}
function readShareLink() {
  if (!location.hash.startsWith('#t=')) return false;
  try {
    applySnapshot(decodeShare(location.hash));
    save();
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch {
    toast("That share link couldn't be read.");
    return false;
  }
}
/** Links carry the trip after "#t=". Hosted pages can't read that part of the
 * address, so there people share the bare code and paste it into "Open shared". */
function shareText() {
  const code = encodeShare();
  return backend.mode === 'server' ? `${location.origin}${location.pathname}#t=${code}` : `SPA1:${code}`;
}

// -- suitcase ---------------------------------------------------------------- //
function renderSuitcases() {
  const box = $('suitcases');
  box.innerHTML = '';
  const maxL = Math.max(...state.catalog.suitcases.map((s) => s.length));
  for (const s of state.catalog.suitcases) {
    const k = s.length / maxL;
    box.append(el('button', {
      class: 'suitcase-opt', type: 'button', role: 'radio', 'aria-checked': String(state.suitcaseId === s.id),
      onclick: () => { state.suitcaseId = s.id; state.dims = presetDims(s.id); renderSuitcases(); applySuitcase(); },
    },
    el('span', { class: 'glyph', style: `width:${Math.round(18 + 16 * k)}px;height:${Math.round(20 + 14 * k)}px` }),
    el('b', {}, s.name), el('small', {}, `${s.length}×${s.width}×${s.height}`)));
  }
  $('dimL').value = state.dims.length;
  $('dimW').value = state.dims.width;
  $('dimH').value = state.dims.height;
  $('dimKg').value = state.dims.max_weight ?? '';
}

function renderSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  for (const c of SHELL_COLORS) {
    box.append(el('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(state.shell === c), title: 'Suitcase colour',
      style: `background:${c}`, onclick: () => { state.shell = c; renderSwatches(); applySuitcase(); },
    }));
  }
}

function applySuitcase(clearLayout = true) {
  save();
  updateSummary();
  if (!scene) return;
  scene.suitcaseColor = state.shell;
  if (clearLayout && state.layout) {
    const s = state.layout.suitcase;
    if (s.length !== state.dims.length || s.width !== state.dims.width || s.height !== state.dims.height) resetResult();
  }
  scene.suitcase = null; // rebuild with the new colour/size
  scene.setSuitcase(state.dims.length, state.dims.width, state.dims.height, state.shell);
}

// -- trips: presets and saved ------------------------------------------------ //
function renderProfiles() {
  const box = $('profiles');
  box.innerHTML = '';
  for (const p of state.catalog.profiles) {
    const n = Object.values(p.items).reduce((a, b) => a + b, 0);
    box.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.profile === p.id), title: `${n} items`,
      onclick: () => {
        state.profile = p.id;
        state.qty = { ...p.items };
        state.priority = {};
        state.suitcaseId = p.suitcase;
        state.dims = presetDims(p.suitcase);
        refreshAll();
      },
    }, p.name));
  }
}

async function refreshTrips() {
  try { state.trips = await backend.listTrips(); } catch { state.trips = []; }
  renderTrips();
}

function renderTrips() {
  const box = $('myTrips');
  box.innerHTML = '';
  for (const t of state.trips) {
    const n = Object.values(t.qty || {}).reduce((a, b) => a + b, 0) + (t.custom || []).length;
    box.append(el('span', { class: 'chip trip-chip', title: `${n} items` },
      el('button', { type: 'button', class: 'link', style: 'color:inherit', onclick: () => loadTrip(t) }, t.name),
      el('button', { type: 'button', class: 'x', 'aria-label': `Delete ${t.name}`, onclick: () => removeTrip(t) }, '×')));
  }
  $('tripsHint').textContent = state.trips.length ? '' : (backend.mode === 'server'
    ? 'Save your selection to reuse it later. Trips are kept in data/trips.json.'
    : 'Save your selection to reuse it later. Trips are kept in this browser.');
}

function loadTrip(t) {
  applySnapshot({ ...t, dims: t.suitcase, suitcaseId: t.suitcaseId || 'custom' });
  matchPreset();
  state.profile = null;
  refreshAll();
  toast(`Loaded "${t.name}"`);
}

async function removeTrip(t) {
  try {
    await backend.deleteTrip(t.id);
    toast(`Deleted "${t.name}"`);
  } catch (err) { toast(`Couldn't delete: ${err.message}`); }
  refreshTrips();
}

async function saveCurrentTrip(name) {
  const s = snapshot();
  try {
    const saved = await backend.saveTrip({ name, suitcase: s.dims, suitcaseId: s.suitcaseId, shell: s.shell, qty: s.qty, priority: s.priority, custom: s.custom });
    toast(`Saved "${saved.name}"`);
  } catch (err) { toast(`Couldn't save: ${err.message}`); }
  refreshTrips();
}

function refreshAll() {
  save();
  renderProfiles(); renderSuitcases(); renderSwatches(); renderCategories(); renderItems();
  $('squeezeToggle').checked = state.allowSqueeze;
  applySuitcase();
  updateSummary();
}

// -- categories & item list -------------------------------------------------- //
function renderCategories() {
  const box = $('categories');
  box.innerHTML = '';
  const cats = [{ id: 'all', name: 'All' }, { id: 'selected', name: 'Selected' }, ...state.catalog.categories];
  for (const c of cats) {
    const count = c.id === 'selected' ? Object.keys(state.qty).length + state.custom.length : null;
    box.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.category === c.id),
      onclick: () => { state.category = c.id; renderCategories(); renderItems(); },
    }, c.name, count !== null ? el('span', { class: 'count' }, String(count)) : null));
  }
}

function renderItems() {
  const list = $('itemList');
  list.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const match = (it) => !q || `${it.name} ${it.category} ${it.model}`.toLowerCase().includes(q);
  const catName = Object.fromEntries(state.catalog.categories.map((c) => [c.id, c.name]));
  let shown = 0;
  const groups = state.category === 'all' || state.category === 'selected'
    ? state.catalog.categories.map((c) => c.id) : [state.category];

  for (const cat of groups) {
    const items = state.catalog.items.filter((it) => it.category === cat && match(it)
      && (state.category !== 'selected' || state.qty[it.id]));
    if (!items.length) continue;
    if (groups.length > 1) list.append(el('div', { class: 'cat-title' }, catName[cat]));
    for (const it of items) { list.append(itemRow(it)); shown++; }
  }
  const customs = state.custom.filter((c) => match(c) && (state.category === 'all' || state.category === 'selected' || state.category === c.category));
  if (customs.length) {
    list.append(el('div', { class: 'cat-title' }, 'Your items'));
    for (const c of customs) { list.append(itemRow(c, true)); shown++; }
  }
  if (!shown) list.append(el('p', { class: 'hint' }, q ? `Nothing matches "${state.query}". Add it as your own item below.` : 'Nothing selected yet.'));
}

const isPriority = (it, isCustom) => (isCustom ? !!it.priority : (state.priority[it.id] ?? !!it.priority));

function itemRow(it, isCustom = false) {
  const n = isCustom ? (it.quantity || 1) : (state.qty[it.id] || 0);
  const img = el('img', { class: 'thumb', alt: '' });
  thumbInto(img, it);
  const out = el('output', {}, String(n));
  const setQty = (v) => {
    v = Math.max(0, Math.min(20, v));
    if (isCustom) {
      if (v === 0) state.custom = state.custom.filter((c) => c !== it);
      else it.quantity = v;
    } else if (v === 0) delete state.qty[it.id];
    else state.qty[it.id] = v;
    state.profile = null;
    save();
    updateSummary();
    if (isCustom && v === 0) { renderItems(); renderCategories(); return; }
    out.textContent = String(v);
    minus.disabled = v === 0;
    row.classList.toggle('selected', v > 0);
    renderProfilesPressed();
  };
  const minus = el('button', { type: 'button', 'aria-label': `Remove one ${it.name}`, onclick: () => setQty(Number(out.textContent) - 1) }, '−');
  const plus = el('button', { type: 'button', 'aria-label': `Add one ${it.name}`, onclick: () => setQty(Number(out.textContent) + 1) }, '+');
  minus.disabled = n === 0;
  const pin = el('button', {
    type: 'button', class: 'pin', 'aria-pressed': String(isPriority(it, isCustom)),
    title: 'Need it first: packed last, on top, easy to grab',
    'aria-label': `Need ${it.name} first`,
    onclick: () => {
      const on = !isPriority(it, isCustom);
      if (isCustom) it.priority = on;
      else if (on === !!it.priority) delete state.priority[it.id];
      else state.priority[it.id] = on;
      pin.setAttribute('aria-pressed', String(on));
      save();
    },
  }, svg(PIN_ICON));
  const tags = [];
  if (it.fragile) tags.push(el('span', { class: 'tag' }, 'fragile'));
  if (it.upright) tags.push(el('span', { class: 'tag' }, 'upright'));
  if (it.squeeze) tags.push(el('span', { class: 'tag soft', title: `Can be squashed by up to ${Math.round(it.squeeze * 100)}%` }, 'soft'));
  const row = el('div', { class: `item-row${n > 0 ? ' selected' : ''}` },
    img,
    el('div', {}, el('div', { class: 'name' }, it.name, ...tags),
      el('div', { class: 'meta' }, `${fmt(it.length)}×${fmt(it.width)}×${fmt(it.height)} cm · ${fmt(it.weight, 2)} kg`)),
    el('div', { class: 'controls' }, pin, el('div', { class: 'stepper' }, minus, out, plus)));
  return row;
}

function renderProfilesPressed() {
  for (const b of $('profiles').children) b.setAttribute('aria-pressed', 'false');
}

function renderCustomModelOptions() {
  const looks = {
    box: 'Plain box', packing_cube: 'Packing cube', pouch: 'Zip pouch', tshirt: 'Folded top', jeans: 'Folded trousers',
    roll: 'Rolled clothing', sneakers: 'Shoes', book: 'Book', laptop: 'Laptop / tablet', bottle: 'Bottle',
    flask: 'Water bottle', gift: 'Gift box', snack_box: 'Carton', towel_roll: 'Rolled towel', camera: 'Camera',
  };
  const sel = $('customModel');
  for (const [k, v] of Object.entries(looks)) if (MODEL_BUILDERS[k]) sel.append(el('option', { value: k }, v));
}

// -- summary ----------------------------------------------------------------- //
function selectedList() {
  const byId = Object.fromEntries(state.catalog.items.map((i) => [i.id, i]));
  const rows = Object.entries(state.qty).map(([id, q]) => ({ item: byId[id], q })).filter((r) => r.item);
  for (const c of state.custom) rows.push({ item: c, q: c.quantity || 1 });
  return rows;
}

function updateSummary() {
  const rows = selectedList();
  const count = rows.reduce((a, r) => a + r.q, 0);
  const vol = rows.reduce((a, r) => a + r.q * r.item.length * r.item.width * r.item.height, 0);
  const kg = rows.reduce((a, r) => a + r.q * r.item.weight, 0);
  const d = state.dims;
  const cap = d.length * d.width * d.height;
  const pct = cap ? (100 * vol) / cap : 0;
  $('sumCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('sumWeight').textContent = count ? `${fmt(kg, 2)} kg${d.max_weight ? ` of ${fmt(d.max_weight)} kg` : ''}` : '';
  const bar = $('fillBar');
  bar.style.width = `${Math.min(100, pct)}%`;
  const overKg = d.max_weight && kg > d.max_weight;
  const cls = pct > 100 || overKg ? 'over' : pct > 80 ? 'warn' : '';
  bar.className = cls;
  const note = $('fillNote');
  note.className = `fill-note ${cls}`;
  if (!count) note.textContent = 'Add some items to get started.';
  else if (overKg) note.textContent = `Over the ${fmt(d.max_weight)} kg limit, so some items will be left out.`;
  else if (pct > 100) note.textContent = `Items take ${fmt(pct, 0)}% of the case's volume. Not everything will fit${state.allowSqueeze ? ', even squeezed' : ''}.`;
  else if (pct > 80) note.textContent = `${fmt(pct, 0)}% of the volume: tight.${state.allowSqueeze ? ' Soft items may get squeezed.' : ' Odd shapes may not all fit.'}`;
  else note.textContent = `Items take about ${fmt(pct, 0)}% of the case's volume.`;
  $('packBtn').disabled = !count;
  const btn = [...$('categories').children].find((b) => b.textContent.startsWith('Selected'));
  if (btn) btn.querySelector('.count').textContent = String(Object.keys(state.qty).length + state.custom.length);
}

// -- packing ----------------------------------------------------------------- //
async function doPack() {
  const rows = selectedList();
  if (!rows.length) return;
  const count = rows.reduce((a, r) => a + r.q, 0);
  const body = {
    suitcase: { name: suitcaseName(), ...state.dims, max_weight: state.dims.max_weight || null },
    items: Object.entries(state.qty).map(([id, quantity]) => ({ id, quantity, ...(id in state.priority ? { priority: state.priority[id] } : {}) })),
    custom_items: state.custom.map((c) => ({ ...c })),
    options: { time_limit: count > 30 ? 8 : 5, allow_squeeze: state.allowSqueeze },
  };
  $('loading').hidden = false;
  $('loadingNote').textContent = `Trying hundreds of arrangements of ${count} items`;
  $('packBtn').disabled = true;
  try {
    const data = await backend.pack(body, (n) => { $('loadingNote').textContent = `${n} arrangements tried…`; });
    state.layout = data;
    $('loading').hidden = true;
    await showResult(data);
  } catch (err) {
    showBanner(`<b>Packing failed:</b> ${escapeHtml(err.message)}`);
  } finally {
    $('loading').hidden = true;
    $('packBtn').disabled = false;
  }
}

function suitcaseName() {
  const s = state.catalog.suitcases.find((x) => x.id === state.suitcaseId);
  const d = state.dims;
  const same = s && s.length === d.length && s.width === d.width && s.height === d.height;
  return same ? s.name : 'Custom suitcase';
}

async function showResult(layout) {
  const m = layout.metrics;
  $('emptyState').hidden = true;
  $('metrics').hidden = false;
  $('mEff').textContent = `${fmt(m.volume_efficiency_pct, 1)}%`;
  $('mItems').textContent = `${m.items_packed} / ${m.items_total}`;
  $('mWeight').textContent = m.weight_limit_kg ? `${fmt(m.packed_weight_kg, 1)} / ${fmt(m.weight_limit_kg)} kg` : `${fmt(m.packed_weight_kg, 1)} kg`;
  $('mFree').textContent = `${fmt(m.unused_volume_cm3 / 1000, 1)} L`;
  const notes = $('metricNotes');
  notes.innerHTML = '';
  if (m.squeezed_items) notes.append(el('span', { class: 'pill', title: 'Soft items pressed flatter to make everything fit' }, el('b', {}, String(m.squeezed_items)), ' soft items squeezed'));
  if (m.priority_items) {
    const onTop = m.priority_items - m.priority_buried;
    notes.append(el('span', { class: 'pill' }, el('b', {}, `${onTop}/${m.priority_items}`), ' need-it-first items on top'));
  }
  notes.append(el('span', { class: 'pill', title: m.strategy }, `${fmt(m.attempts, 0)} layouts tried in ${fmt(layout.elapsed_s ?? 0, 1)} s`));

  if (layout.unpacked.length) {
    const hint = state.allowSqueeze ? 'Try a bigger case or fewer items.' : 'Try turning on squeezing, a bigger case or fewer items.';
    showBanner(`<b>${layout.unpacked.length} item${layout.unpacked.length > 1 ? 's' : ''} didn't fit.</b> ${hint}<ul>${
      layout.unpacked.slice(0, 6).map((u) => `<li>${escapeHtml(u.name)}: ${escapeHtml(u.reason)}</li>`).join('')
    }${layout.unpacked.length > 6 ? `<li>…and ${layout.unpacked.length - 6} more</li>` : ''}</ul>`);
  } else {
    $('unpackedBanner').hidden = true;
  }

  renderSteps(layout);
  $('player').hidden = false;
  $('stepsPanel').hidden = false;
  document.querySelector('.stage').classList.remove('no-steps');
  $('scrub').max = layout.steps.length;
  if (scene) {
    scene.suitcaseColor = state.shell;
    await scene.setLayout(layout);
    scene.frame();
    scene.play();
    syncPlayer();
  }
}

function showBanner(html) {
  const b = $('unpackedBanner');
  b.innerHTML = html;
  b.hidden = false;
}

function resetResult() {
  state.layout = null;
  $('metrics').hidden = true;
  $('player').hidden = true;
  $('stepsPanel').hidden = true;
  $('unpackedBanner').hidden = true;
  $('emptyState').hidden = false;
  document.querySelector('.stage').classList.add('no-steps');
  if (scene) scene.setLayout({ suitcase: { length: state.dims.length, width: state.dims.width, height: state.dims.height }, steps: [] });
}

function stepThumb(st, lazy = true) {
  const img = el('img', { alt: '' });
  thumbInto(img, { model: st.model, length: st.original_size[0], width: st.original_size[1], height: st.original_size[2], color: st.hex_color }, { lazy });
  return img;
}

function stepText(st) {
  return capitalize(st.instruction.replace(`Place ${st.name} `, '').replace(/\.$/, ''));
}

function renderSteps(layout) {
  const ol = $('stepList');
  ol.innerHTML = '';
  for (const st of layout.steps) {
    const badges = [];
    if (st.squeezed_pct) badges.push(el('span', { class: 'badge soft' }, `squeezed ${st.squeezed_pct}%`));
    if (st.priority) badges.push(el('span', { class: 'badge first' }, 'need it first'));
    if (st.fragile) badges.push(el('span', { class: 'badge fragile' }, 'fragile'));
    ol.append(el('li', { 'data-step': st.step, onclick: () => scene && scene.showStep(st.step) },
      el('span', { class: 'n' }, String(st.step)), stepThumb(st),
      el('div', {}, el('div', { class: 'title' }, st.name), el('div', { class: 'how' }, stepText(st)),
        badges.length ? el('div', { class: 'badges' }, badges) : null)));
  }
}

function markStep(n) {
  for (const li of $('stepList').children) {
    const s = Number(li.dataset.step);
    li.classList.toggle('done', s <= n);
    li.classList.toggle('current', s === n);
  }
  const cur = $('stepList').querySelector('li.current');
  if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('stepLabel').textContent = `Step ${n} / ${state.layout ? state.layout.steps.length : 0}`;
}

// -- print checklist --------------------------------------------------------- //
function printChecklist() {
  const layout = state.layout;
  if (!layout) return;
  let hero = '';
  if (scene) {
    scene.showStep(layout.steps.length);
    scene.renderNow();
    try { hero = scene.canvas.toDataURL('image/png'); } catch { hero = ''; }
  }
  const m = layout.metrics;
  const s = layout.suitcase;
  const view = $('printView');
  view.innerHTML = '';
  view.append(
    el('h1', {}, 'Packing checklist'),
    el('p', { class: 'sub' }, `${s.name} · ${fmt(s.length)}×${fmt(s.width)}×${fmt(s.height)} cm · ${new Date().toLocaleDateString()}`),
    hero ? el('img', { class: 'hero', src: hero, alt: 'The packed suitcase' }) : null,
    el('div', { class: 'facts' },
      el('div', {}, el('b', {}, `${fmt(m.volume_efficiency_pct, 1)}%`), ' space used'),
      el('div', {}, el('b', {}, `${m.items_packed}/${m.items_total}`), ' items'),
      el('div', {}, el('b', {}, `${fmt(m.packed_weight_kg, 1)} kg`), m.weight_limit_kg ? ` of ${fmt(m.weight_limit_kg)} kg` : ''),
      m.squeezed_items ? el('div', {}, el('b', {}, String(m.squeezed_items)), ' squeezed') : null),
  );
  const thumbs = [];
  const rows = layout.steps.map((st) => {
    const img = stepThumb(st, false);
    img.className = 't';
    thumbs.push(img);
    return el('tr', {},
      el('td', {}, el('span', { class: 'box' })),
      el('td', { class: 'n' }, String(st.step)),
      el('td', {}, img),
      el('td', {}, el('b', {}, st.name), el('br'), stepText(st)));
  });
  view.append(el('table', {}, el('tbody', {}, rows)));
  if (layout.unpacked.length) {
    view.append(el('p', { class: 'left' }, el('b', {}, "Didn't fit: "), layout.unpacked.map((u) => u.name).join(', ')));
  }
  // wait (briefly) for the thumbnails to be drawn, then open the print dialog
  const started = performance.now();
  const ready = () => thumbs.every((i) => i.getAttribute('src')) || performance.now() - started > 4000;
  const go = () => (ready() ? window.print() : setTimeout(go, 100));
  setTimeout(go, 150);
}

// -- misc UI ----------------------------------------------------------------- //
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function syncPlayer() {
  $('player').classList.toggle('playing', !!(scene && scene.playing));
}

function matchPreset() {
  const d = state.dims;
  const match = state.catalog.suitcases.find((s) => s.length === d.length && s.width === d.width && s.height === d.height);
  state.suitcaseId = match ? match.id : 'custom';
}

function bindControls() {
  $('search').addEventListener('input', (e) => { state.query = e.target.value; renderItems(); });
  for (const [id, key] of [['dimL', 'length'], ['dimW', 'width'], ['dimH', 'height'], ['dimKg', 'max_weight']]) {
    $(id).addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (key === 'max_weight') state.dims.max_weight = v > 0 ? v : null;
      else if (v > 0) state.dims[key] = v;
      else e.target.value = state.dims[key];
      matchPreset();
      for (const [i, b] of [...$('suitcases').children].entries()) {
        b.setAttribute('aria-checked', String(state.catalog.suitcases[i].id === state.suitcaseId));
      }
      applySuitcase();
    });
  }
  $('clearBtn').addEventListener('click', () => {
    state.qty = {}; state.custom = []; state.priority = {}; state.profile = null;
    save(); renderProfiles(); renderItems(); renderCategories(); updateSummary();
  });
  $('squeezeToggle').addEventListener('change', (e) => { state.allowSqueeze = e.target.checked; save(); updateSummary(); });
  $('packBtn').addEventListener('click', doPack);
  $('customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name')).trim();
    if (!name) return;
    state.custom.push({
      id: `mine_${Date.now().toString(36)}`, name,
      length: +f.get('length'), width: +f.get('width'), height: +f.get('height'),
      weight: +f.get('weight') || 0, model: f.get('model') || 'box', color: '#7c8da6', category: 'general',
      fragile: f.get('fragile') === 'on', upright: f.get('upright') === 'on', quantity: 1,
    });
    e.target.reset();
    $('customBox').open = false;
    save(); renderItems(); renderCategories(); updateSummary();
  });

  // saved trips & sharing
  $('saveTripBtn').addEventListener('click', () => {
    if (!selectedList().length) { toast('Add some items first, then save the trip.'); return; }
    $('saveTripForm').hidden = false;
    $('tripName').focus();
  });
  $('cancelSaveBtn').addEventListener('click', () => { $('saveTripForm').hidden = true; });
  $('saveTripForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('tripName').value.trim();
    if (!name) return;
    $('saveTripForm').hidden = true;
    $('tripName').value = '';
    await saveCurrentTrip(name);
  });
  $('shareBtn').addEventListener('click', () => {
    if (!selectedList().length) { toast('Add some items first, then share.'); return; }
    $('openForm').hidden = true;
    $('sharePanel').hidden = false;
    $('shareOut').value = shareText();
    $('copyShareBtn').click();
  });
  $('copyShareBtn').addEventListener('click', async () => {
    const text = $('shareOut').value;
    const what = backend.mode === 'server' ? 'Link' : 'Trip code';
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied. Whoever opens it gets this suitcase and item list.`);
    } catch {
      $('shareOut').focus();
      $('shareOut').select();
      toast('Press Ctrl+C (or ⌘C) to copy.');
    }
  });
  $('openSharedBtn').addEventListener('click', () => {
    $('sharePanel').hidden = true;
    $('openForm').hidden = !$('openForm').hidden;
    if (!$('openForm').hidden) $('openCode').focus();
  });
  $('openForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      applySnapshot(decodeShare($('openCode').value));
      matchPreset();
      state.profile = null;
      refreshAll();
      $('openForm').hidden = true;
      $('openCode').value = '';
      toast('Opened the shared trip. Press "Pack my suitcase" to see it.');
    } catch {
      toast("That doesn't look like a share link or trip code.");
    }
  });

  $('copyBtn').addEventListener('click', async () => {
    if (!state.layout) return;
    const text = state.layout.steps.map((s) => `${s.step}. ${s.instruction}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Steps copied'); } catch { toast("Couldn't copy"); }
  });
  $('printBtn').addEventListener('click', printChecklist);

  if (!scene) return;
  scene.onStep = (n) => markStep(n);
  scene.onTime = (t) => { $('scrub').value = t; syncPlayer(); };
  $('playBtn').addEventListener('click', () => { scene.toggle(); syncPlayer(); });
  $('prevBtn').addEventListener('click', () => { scene.prev(); syncPlayer(); });
  $('nextBtn').addEventListener('click', () => { scene.next(); syncPlayer(); });
  $('scrub').addEventListener('input', (e) => { scene.pause(); scene.highlight = -1; scene.seek(parseFloat(e.target.value)); syncPlayer(); });
  $('speed').addEventListener('change', (e) => { scene.speed = parseFloat(e.target.value); });
  $('xrayBtn').addEventListener('click', () => {
    const on = !scene.xray;
    scene.setXray(on);
    $('xrayBtn').setAttribute('aria-pressed', String(on));
  });
  $('topBtn').addEventListener('click', () => scene.topView());
  $('resetBtn').addEventListener('click', () => scene.frame());

  const canvas = $('scene');
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const i = scene.pick(e.clientX, e.clientY);
    if (i >= 0) { scene.showStep(i + 1); syncPlayer(); }
  });
  let raf = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) { $('tooltip').hidden = true; return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = scene.pick(e.clientX, e.clientY);
      const tip = $('tooltip');
      if (i < 0) { tip.hidden = true; return; }
      const st = scene.items[i].step;
      const rect = canvas.getBoundingClientRect();
      const extra = [st.squeezed_pct ? `squeezed ${st.squeezed_pct}%` : '', st.priority ? 'need it first' : ''].filter(Boolean).join(' · ');
      tip.textContent = `${st.step}. ${st.name} · ${st.size.map((v) => fmt(v)).join('×')} cm${extra ? ` · ${extra}` : ''}`;
      tip.style.left = `${e.clientX - rect.left}px`;
      tip.style.top = `${e.clientY - rect.top}px`;
      tip.hidden = false;
    });
  });
  canvas.addEventListener('pointerleave', () => { $('tooltip').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (!state.layout || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); scene.toggle(); syncPlayer(); }
    if (e.key === 'ArrowRight') { scene.next(); syncPlayer(); }
    if (e.key === 'ArrowLeft') { scene.prev(); syncPlayer(); }
  });
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// -- install as an app (Chrome / Edge) and offline support ------------------- //
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('installBtn').hidden = true;
  toast('Installed. Open "Smart Packing Assistant" from your Start menu or desktop.');
});
$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $('installBtn').hidden = true;
});
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

init().catch((err) => {
  console.error(err);
  $('emptyState').innerHTML = `<h3>Couldn't start</h3><p>${escapeHtml(err.message)}.</p>`;
});
