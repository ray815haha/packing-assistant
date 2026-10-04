// App controller: item picker, suitcase settings, saved trips, packing request,
// player UI, sharing and printing.

import { PackingScene } from './scene.js';
import { thumbInto } from './thumbs.js';
import { MODEL_BUILDERS } from './models.js';
import { connect } from './api.js';
import { loadSyncConfig, Cloud } from './cloud.js';
import { Sync } from './sync.js';
import { initAccount } from './account.js';
import { $, el } from './dom.js';
import {
  LANGS, lang, setLang, onLangChange, t, catalogName, packedName, applyStatic, reasonText, describeStep,
} from './i18n.js';

const svg =(html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const fmt = (n, d = 1) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>';

const SHELL_COLORS = ['#2f4858', '#1f2937', '#9b2226', '#0f766e', '#c2a878', '#5b6cff'];
// colours given to new bags, most distinct first, so bags are easy to tell apart
const BAG_COLORS = ['#2f4858', '#0f766e', '#9b2226', '#5b6cff', '#c2a878', '#1f2937'];
const STORE_KEY = 'spa-state-v1';
const KINDS = ['checked', 'cabin', 'personal']; // in the hold, overhead locker, under the seat
const MAX_BAGS = 3;

const state = {
  catalog: null,
  bags: [],               // [{ uid, presetId, dims: { length, width, height, max_weight }, shell, kind }]
  activeBag: 0,           // the bag being edited in step 1
  qty: {},                // catalog id -> quantity
  priority: {},           // catalog id -> true/false (overrides the catalog default)
  assign: {},             // catalog id -> bag uid the user put it in (absent: the packer chooses)
  custom: [],             // user-defined items
  allowSqueeze: true,
  category: 'all',
  query: '',
  profile: null,
  layout: null,
  packedBags: null,       // copy of the bags the current layout was packed into
  trips: [],
};

/** The bag being edited in step 1. */
const bag = () => state.bags[state.activeBag];

let scene;
let backend;
let cloud = null; // accounts & sync (cloud.js), when web/sync.json is filled in
let sync = null;
let account = null;

// --------------------------------------------------------------------------- //
async function init() {
  try {
    scene = new PackingScene($('scene'));
  } catch (err) {
    $('emptyState').innerHTML = `<h3>${t('err.no3dTitle')}</h3><p>${escapeHtml(err.message)} ${t('err.no3dBody')}</p>`;
  }
  window.spa = { state, get scene() { return scene; }, get backend() { return backend; }, get sync() { return sync; } };
  backend = await connect();
  state.catalog = backend.catalog;
  state.catalogIds = new Set(state.catalog.items.map((i) => i.id));
  $('printBtn').hidden = backend.mode !== 'server';
  $('printBtn').previousElementSibling.hidden = backend.mode !== 'server';
  applyStatic();
  renderChrome();
  renderLanguageOptions();
  restore();
  const shared = readShareLink();
  renderBagEditor();
  renderProfiles();
  renderCategories();
  renderItems();
  renderCustomModelOptions();
  $('squeezeToggle').checked = state.allowSqueeze;
  applySuitcase(false);
  updateSummary();
  bindControls();
  await refreshTrips();
  if (shared) toast(t('toast.sharedLoaded'));
  await startSync();
}

/** Accounts & sync: only when web/sync.json names a Supabase project. */
async function startSync() {
  const config = await loadSyncConfig();
  if (!config) return;
  cloud = new Cloud(config);
  sync = new Sync(cloud, backend, { onTripsChanged: refreshTrips, onStatus: () => renderTrips() });
  account = initAccount({ cloud, sync, toast });
  await account.handleRedirect(); // back from an emailed link?
  sync.start();
}

// -- persistence (per-browser convenience only) ------------------------------ //
function snapshot() {
  const first = state.bags[0];
  return {
    bags: state.bags.map(({ uid, presetId, dims, shell, kind }) => ({ uid, presetId, dims, shell, kind })),
    // the first bag again, as older copies of the app (one suitcase) expect it
    suitcaseId: first.presetId, dims: first.dims, shell: first.shell,
    qty: state.qty, priority: state.priority, assign: state.assign, custom: state.custom, allowSqueeze: state.allowSqueeze,
  };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch { /* storage unavailable: fine */ }
}
function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  if (saved) applySnapshot(saved);
  if (!state.bags.length) state.bags = [makeBag('carry_on')];
}
function applySnapshot(s) {
  const ids = new Set(state.catalog.items.map((i) => i.id));
  // older snapshots have one suitcase: suitcaseId, dims, shell
  const bags = (Array.isArray(s.bags) && s.bags.length ? s.bags : [{ presetId: s.suitcaseId, dims: s.dims, shell: s.shell }])
    .slice(0, MAX_BAGS).map(cleanBag).filter(Boolean);
  const seen = new Set();
  for (const b of bags) { if (seen.has(b.uid)) b.uid = newUid(); seen.add(b.uid); }
  state.bags = bags.length ? bags : [makeBag('carry_on')];
  state.activeBag = 0;
  state.qty = Object.fromEntries(Object.entries(s.qty || {}).filter(([k, v]) => ids.has(k) && +v > 0).map(([k, v]) => [k, Math.min(20, Math.round(+v))]));
  state.priority = Object.fromEntries(Object.entries(s.priority || {}).filter(([k]) => ids.has(k)).map(([k, v]) => [k, !!v]));
  state.assign = Object.fromEntries(Object.entries(s.assign || {}).filter(([k, v]) => ids.has(k) && seen.has(v)));
  state.custom = Array.isArray(s.custom) ? s.custom.filter(validCustom).slice(0, 50) : [];
  for (const c of state.custom) if (c.bag && !seen.has(c.bag)) delete c.bag;
  if (typeof s.allowSqueeze === 'boolean') state.allowSqueeze = s.allowSqueeze;
}
function validCustom(c) {
  return c && typeof c.name === 'string' && [c.length, c.width, c.height].every((v) => Number.isFinite(+v) && +v > 0 && +v <= 200);
}

const presetOf = (id) => state.catalog.suitcases.find((x) => x.id === id) || null;
function presetDims(id) {
  const s = presetOf(id) || state.catalog.suitcases[1];
  return { length: s.length, width: s.width, height: s.height, max_weight: s.max_weight };
}
const newUid = () => `b${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;

/** A new bag from a size preset, in a colour no other bag uses yet. */
function makeBag(presetId, i = state.bags.length) {
  const used = new Set(state.bags.map((b) => b.shell));
  const preset = presetOf(presetId);
  return {
    uid: newUid(), presetId, dims: presetDims(presetId),
    shell: BAG_COLORS.find((c) => !used.has(c)) || BAG_COLORS[i % BAG_COLORS.length],
    kind: (preset && preset.kind) || 'checked',
  };
}

function cleanBag(b, i) {
  if (!b || typeof b !== 'object') return null;
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const presetId = typeof b.presetId === 'string' ? b.presetId : 'carry_on';
  const d = b.dims;
  const dims = d && num(d.length) && num(d.width) && num(d.height)
    ? { length: +d.length, width: +d.width, height: +d.height, max_weight: num(d.max_weight) }
    : presetDims(presetId);
  const preset = presetOf(presetId);
  return {
    uid: typeof b.uid === 'string' && /^[\w-]{1,20}$/.test(b.uid) ? b.uid : newUid(),
    presetId, dims,
    shell: SHELL_COLORS.includes(b.shell) ? b.shell : BAG_COLORS[i % BAG_COLORS.length],
    kind: KINDS.includes(b.kind) ? b.kind : (preset && preset.kind) || 'checked',
  };
}

/** The size preset a bag matches exactly, if any. */
function presetMatch(b) {
  const d = b.dims;
  return state.catalog.suitcases.find((s) => s.length === d.length && s.width === d.width && s.height === d.height) || null;
}

/** Display name of bag i (of `count`) in the current language. */
function bagTitle(b, i, count = state.bags.length) {
  const preset = presetMatch(b);
  if (preset) return catalogName('suitcases', preset.id, preset.name);
  return count > 1 ? t('bag.n', { n: i + 1 }) : t('suitcase.custom');
}

/** Name sent to the packing engine (English; the steps are re-worded in the UI). */
function engineBagName(b, i) {
  const preset = presetMatch(b);
  if (preset) return preset.name;
  return state.bags.length > 1 ? `Bag ${i + 1}` : 'Custom suitcase';
}

/** How the 3D view draws each bag. */
const bagLooks = (bags) => bags.map((b) => {
  const preset = presetMatch(b);
  return {
    L: b.dims.length, W: b.dims.width, H: b.dims.height, color: b.shell,
    style: preset ? preset.style : (b.kind === 'personal' ? 'soft' : 'hard'),
  };
});

/** Same bags, sizes and kinds (colours may differ): an existing layout still holds. */
const sameBags = (a, b) => !!a && a.length === b.length && a.every((x, i) => x.uid === b[i].uid && x.kind === b[i].kind
  && ['length', 'width', 'height', 'max_weight'].every((k) => (x.dims[k] || null) === (b[i].dims[k] || null)));

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
    toast(t('toast.shareBad'));
    return false;
  }
}
/** Links carry the trip after "#t=". Hosted pages can't read that part of the
 * address, so there people share the bare code and paste it into "Open shared". */
function shareText() {
  const code = encodeShare();
  return backend.mode === 'server' ? `${location.origin}${location.pathname}#t=${code}` : `SPA1:${code}`;
}

// -- bags -------------------------------------------------------------------- //
function renderBagEditor() {
  renderBagTabs();
  renderSuitcases();
  renderKinds();
  renderSwatches();
}

function renderBagTabs() {
  const box = $('bagTabs');
  box.innerHTML = '';
  state.bags.forEach((b, i) => {
    const name = bagTitle(b, i);
    const active = i === state.activeBag;
    box.append(el('span', { class: `bag-tab${active ? ' active' : ''}` },
      el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(active), class: 'bag-tab-btn',
        onclick: () => { state.activeBag = i; renderBagEditor(); },
      }, el('span', { class: 'dot', style: `background:${b.shell}`, 'aria-hidden': 'true' }), name),
      state.bags.length > 1
        ? el('button', { type: 'button', class: 'x', 'aria-label': t('bag.remove', { name }), title: t('bag.remove', { name }), onclick: () => removeBag(i) }, '×')
        : null));
  });
  if (state.bags.length < MAX_BAGS) {
    box.append(el('button', { type: 'button', class: 'bag-add', title: t('bag.addTitle'), onclick: addBag }, t('bag.add')));
  }
  $('kindHint').hidden = state.bags.length < 2;
}

function renderSuitcases() {
  const box = $('suitcases');
  box.innerHTML = '';
  const b = bag();
  const maxL = Math.max(...state.catalog.suitcases.map((s) => s.length));
  for (const s of state.catalog.suitcases) {
    const k = s.length / maxL;
    box.append(el('button', {
      class: `suitcase-opt ${s.style || 'hard'}`, type: 'button', role: 'radio', 'aria-checked': String(b.presetId === s.id),
      onclick: () => {
        b.presetId = s.id; b.dims = presetDims(s.id); b.kind = s.kind || b.kind;
        state.profile = null;
        renderBagEditor(); renderProfilesPressed(); applySuitcase();
      },
    },
    el('span', { class: 'glyph', style: `width:${Math.round(18 + 16 * k)}px;height:${Math.round(20 + 14 * k)}px` }),
    el('b', {}, catalogName('suitcases', s.id, s.name)), el('small', {}, `${s.length}×${s.width}×${s.height}`)));
  }
  $('dimL').value = b.dims.length;
  $('dimW').value = b.dims.width;
  $('dimH').value = b.dims.height;
  $('dimKg').value = b.dims.max_weight ?? '';
}

function renderKinds() {
  const box = $('bagKind');
  box.innerHTML = '';
  for (const k of KINDS) {
    box.append(el('button', {
      type: 'button', role: 'radio', class: 'kind-opt', 'aria-checked': String(bag().kind === k), title: t(`kind.${k}Title`),
      onclick: () => { bag().kind = k; renderKinds(); applySuitcase(); },
    }, t(`kind.${k}`)));
  }
}

function renderSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  for (const c of SHELL_COLORS) {
    box.append(el('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(bag().shell === c), title: t('s1.colour'),
      style: `background:${c}`, onclick: () => { bag().shell = c; renderSwatches(); renderBagTabs(); renderItems(); applySuitcase(); },
    }));
  }
}

function addBag() {
  if (state.bags.length >= MAX_BAGS) { toast(t('toast.bagLimit', { n: MAX_BAGS })); return; }
  // the next bag people usually bring: something to carry on board, then a bigger case
  const used = new Set(state.bags.map((b) => b.presetId));
  const next = ['underseat', 'carry_on', 'medium', 'large'].find((id) => !used.has(id) && presetOf(id)) || 'underseat';
  state.bags.push(makeBag(next));
  state.activeBag = state.bags.length - 1;
  state.profile = null;
  bagsChanged();
}

function removeBag(i) {
  const [gone] = state.bags.splice(i, 1);
  for (const [k, v] of Object.entries(state.assign)) if (v === gone.uid) delete state.assign[k];
  for (const c of state.custom) if (c.bag === gone.uid) delete c.bag;
  state.activeBag = Math.min(state.activeBag, state.bags.length - 1);
  state.profile = null;
  bagsChanged();
}

function bagsChanged() {
  renderBagEditor(); renderProfilesPressed(); renderItems();
  applySuitcase();
}

function applySuitcase(clearLayout = true) {
  save();
  updateSummary();
  if (!scene) return;
  if (clearLayout && state.layout && !sameBags(state.packedBags, state.bags)) resetResult();
  if (state.layout) {
    // same bags, maybe new colours: keep the packed items where they are
    state.packedBags.forEach((p, i) => { p.shell = state.bags[i].shell; });
    scene.setBags(bagLooks(state.packedBags));
  } else {
    scene.setBags(bagLooks(state.bags));
  }
}

// -- trips: presets and saved ------------------------------------------------ //
function renderProfiles() {
  const box = $('profiles');
  box.innerHTML = '';
  for (const p of state.catalog.profiles) {
    const n = Object.values(p.items).reduce((a, b) => a + b, 0);
    box.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.profile === p.id), title: t('trips.count', { n }),
      onclick: () => {
        state.profile = p.id;
        state.qty = { ...p.items };
        state.priority = {};
        state.assign = {};
        // the preset's bags, keeping the colours already picked
        const shells = state.bags.map((b) => b.shell);
        state.bags = [];
        for (const [i, id] of (p.bags || [p.suitcase]).entries()) {
          const b = makeBag(id);
          if (shells[i]) b.shell = shells[i];
          state.bags.push(b);
        }
        state.activeBag = 0;
        refreshAll();
      },
    }, catalogName('profiles', p.id, p.name)));
  }
}

async function refreshTrips() {
  try { state.trips = await backend.listTrips(); } catch { state.trips = []; }
  // newest first (trips synced from other devices arrive in any order)
  state.trips.sort((a, b) => (Number(b.saved_at) || 0) - (Number(a.saved_at) || 0));
  renderTrips();
}

function renderTrips() {
  const box = $('myTrips');
  box.innerHTML = '';
  for (const trip of state.trips) {
    const n = Object.values(trip.qty || {}).reduce((a, b) => a + b, 0) + (trip.custom || []).length;
    box.append(el('span', { class: 'chip trip-chip', title: t('trips.count', { n }) },
      el('button', { type: 'button', class: 'link', style: 'color:inherit', onclick: () => loadTrip(trip) }, trip.name),
      el('button', { type: 'button', class: 'x', 'aria-label': t('trips.delete', { name: trip.name }), onclick: () => removeTrip(trip) }, '×')));
  }
  $('tripsHint').textContent = cloud && cloud.user ? t('trips.hintSynced')
    : state.trips.length ? '' : t(backend.mode === 'server' ? 'trips.hintServer' : 'trips.hintBrowser');
}

function loadTrip(trip) {
  applySnapshot({ ...trip, dims: trip.suitcase, suitcaseId: trip.suitcaseId || 'custom' });
  for (const b of state.bags) matchPreset(b);
  state.profile = null;
  refreshAll();
  toast(t('toast.loaded', { name: trip.name }));
}

async function removeTrip(trip) {
  try {
    await backend.deleteTrip(trip.id);
    toast(t('toast.deleted', { name: trip.name }));
  } catch (err) { toast(t('toast.deleteFail', { msg: err.message })); }
  await refreshTrips();
  if (sync) sync.schedule();
}

async function saveCurrentTrip(name) {
  const s = snapshot();
  try {
    const saved = await backend.saveTrip({
      name, suitcase: s.dims, suitcaseId: s.suitcaseId, shell: s.shell, qty: s.qty, priority: s.priority, custom: s.custom,
      bags: s.bags, assign: s.assign,
    });
    toast(t('toast.saved', { name: saved.name }));
  } catch (err) { toast(t('toast.saveFail', { msg: err.message })); }
  await refreshTrips();
  if (sync) sync.schedule();
}

function refreshAll() {
  save();
  renderProfiles(); renderBagEditor(); renderCategories(); renderItems();
  $('squeezeToggle').checked = state.allowSqueeze;
  applySuitcase();
  updateSummary();
}

// -- categories & item list -------------------------------------------------- //
function renderCategories() {
  const box = $('categories');
  box.innerHTML = '';
  const cats = [{ id: 'all', name: t('cat.all') }, { id: 'selected', name: t('cat.selected') },
    ...state.catalog.categories.map((c) => ({ ...c, name: catalogName('categories', c.id, c.name) }))];
  for (const c of cats) {
    const count = c.id === 'selected' ? Object.keys(state.qty).length + state.custom.length : null;
    box.append(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.category === c.id), 'data-cat': c.id,
      onclick: () => { state.category = c.id; renderCategories(); renderItems(); },
    }, c.name, count !== null ? el('span', { class: 'count' }, String(count)) : null));
  }
}

function renderItems() {
  const list = $('itemList');
  list.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const match = (it) => !q || `${it.name} ${itemLabel(it)} ${it.category} ${catalogName('categories', it.category, '')} ${it.model}`.toLowerCase().includes(q);
  const catName = Object.fromEntries(state.catalog.categories.map((c) => [c.id, catalogName('categories', c.id, c.name)]));
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
    list.append(el('div', { class: 'cat-title' }, t('list.yours')));
    for (const c of customs) { list.append(itemRow(c, true)); shown++; }
  }
  if (!shown) list.append(el('p', { class: 'hint' }, q ? t('list.noMatch', { q: state.query }) : t('list.none')));
}

/** The 3D model file for an item (as the packing engine picks it), or null. */
function modelUrl(it) {
  const own = (state.catalog.custom_models || {})[it.id];
  return own || it.model_file || (state.catalog.model_files || {})[it.model] || null;
}

/** Display name of a catalogue or custom item in the current language. */
const itemLabel = (it) => (state.catalogIds && state.catalogIds.has(it.id) ? catalogName('items', it.id, it.name) : it.name);

const isPriority = (it, isCustom) => (isCustom ? !!it.priority : (state.priority[it.id] ?? !!it.priority));

function itemRow(it, isCustom = false) {
  const n = isCustom ? (it.quantity || 1) : (state.qty[it.id] || 0);
  const label = itemLabel(it);
  const img = el('img', { class: 'thumb', alt: '' });
  thumbInto(img, { ...it, model_url: modelUrl(it) });
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
  const minus = el('button', { type: 'button', 'aria-label': t('item.remove', { name: label }), onclick: () => setQty(Number(out.textContent) - 1) }, '−');
  const plus = el('button', { type: 'button', 'aria-label': t('item.add', { name: label }), onclick: () => setQty(Number(out.textContent) + 1) }, '+');
  minus.disabled = n === 0;
  const pin = el('button', {
    type: 'button', class: 'pin', 'aria-pressed': String(isPriority(it, isCustom)),
    title: t('item.pinTitle'),
    'aria-label': t('item.pinAria', { name: label }),
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
  if (it.fragile) tags.push(el('span', { class: 'tag' }, t('tag.fragile')));
  if (it.upright) tags.push(el('span', { class: 'tag' }, t('tag.upright')));
  if (it.squeeze) tags.push(el('span', { class: 'tag soft', title: t('tag.softTitle', { n: Math.round(it.squeeze * 100) }) }, t('tag.soft')));
  if (it.cabin === 'required') tags.push(el('span', { class: 'tag cabin', title: t('tag.cabinTitle') }, t('tag.cabin')));
  const row = el('div', { class: `item-row${n > 0 ? ' selected' : ''}` },
    img,
    el('div', {}, el('div', { class: 'name' }, label, ...tags),
      el('div', { class: 'meta' }, `${fmt(it.length)}×${fmt(it.width)}×${fmt(it.height)} ${t('unit.cm')} · ${fmt(it.weight, 2)} ${t('unit.kg')}`,
        state.bags.length > 1 ? bagSelect(it, isCustom, label) : null)),
    el('div', { class: 'controls' }, pin, el('div', { class: 'stepper' }, minus, out, plus)));
  return row;
}

/** "Which bag?" for one item (shown once it's selected and there are several bags). */
function bagSelect(it, isCustom, label) {
  const current = isCustom ? it.bag : state.assign[it.id];
  const sel = el('select', {
    class: 'bag-sel', 'aria-label': t('item.bag', { name: label }), title: t('item.bag', { name: label }),
    onchange: (e) => {
      const v = e.target.value;
      if (isCustom) { if (v) it.bag = v; else delete it.bag; } else if (v) state.assign[it.id] = v; else delete state.assign[it.id];
      sel.classList.toggle('set', !!v);
      save();
    },
  }, el('option', { value: '' }, t('item.bagAuto')), state.bags.map((b, i) => el('option', { value: b.uid }, bagTitle(b, i))));
  sel.value = state.bags.some((b) => b.uid === current) ? current : '';
  sel.classList.toggle('set', !!sel.value);
  return sel;
}

function renderProfilesPressed() {
  for (const b of $('profiles').children) b.setAttribute('aria-pressed', 'false');
}

function renderCustomModelOptions() {
  const looks = ['box', 'packing_cube', 'pouch', 'tshirt', 'jeans', 'roll', 'sneakers', 'book', 'laptop', 'bottle',
    'flask', 'gift', 'snack_box', 'towel_roll', 'camera'];
  const sel = $('customModel');
  const current = sel.value;
  sel.innerHTML = '';
  for (const k of looks) if (MODEL_BUILDERS[k]) sel.append(el('option', { value: k }, t(`looks.${k}`)));
  if (current) sel.value = current;
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
  // all bags together
  const cap = state.bags.reduce((a, b) => a + b.dims.length * b.dims.width * b.dims.height, 0);
  const maxKg = state.bags.every((b) => b.dims.max_weight) ? state.bags.reduce((a, b) => a + b.dims.max_weight, 0) : null;
  const pct = cap ? (100 * vol) / cap : 0;
  $('sumCount').textContent = count === 1 ? t('sum.item') : t('sum.items', { n: count });
  $('sumWeight').textContent = !count ? '' : maxKg
    ? t('sum.weight', { kg: fmt(kg, 2), max: fmt(maxKg) }) : t('sum.weightNoMax', { kg: fmt(kg, 2) });
  $('packLabel').textContent = t(state.bags.length > 1 ? 'sum.packBags' : 'sum.pack');
  const bar = $('fillBar');
  bar.style.width = `${Math.min(100, pct)}%`;
  const overKg = maxKg && kg > maxKg;
  const cls = pct > 100 || overKg ? 'over' : pct > 80 ? 'warn' : '';
  bar.className = cls;
  const note = $('fillNote');
  note.className = `fill-note ${cls}`;
  const p = fmt(pct, 0);
  if (!count) note.textContent = t('fill.empty');
  else if (overKg) note.textContent = t('fill.overKg', { max: fmt(maxKg) });
  else if (pct > 100) note.textContent = t(state.allowSqueeze ? 'fill.overSq' : 'fill.over', { pct: p });
  else if (pct > 80) note.textContent = t(state.allowSqueeze ? 'fill.tightSq' : 'fill.tight', { pct: p });
  else note.textContent = t('fill.ok', { pct: p });
  $('packBtn').disabled = !count;
  const btn = $('categories').querySelector('[data-cat="selected"]');
  if (btn) btn.querySelector('.count').textContent = String(Object.keys(state.qty).length + state.custom.length);
}

// -- packing ----------------------------------------------------------------- //
async function doPack() {
  const rows = selectedList();
  if (!rows.length) return;
  const count = rows.reduce((a, r) => a + r.q, 0);
  const uids = new Set(state.bags.map((b) => b.uid));
  const inBag = (uid) => (uids.has(uid) ? { bag: uid } : {});
  const looks = bagLooks(state.bags);
  const body = {
    bags: state.bags.map((b, i) => ({
      id: b.uid, name: engineBagName(b, i), kind: b.kind, ...b.dims, max_weight: b.dims.max_weight || null,
      wheels: looks[i].style === 'hard',
    })),
    items: Object.entries(state.qty).map(([id, quantity]) => ({
      id, quantity, ...(id in state.priority ? { priority: state.priority[id] } : {}), ...inBag(state.assign[id]),
    })),
    custom_items: state.custom.map(({ bag: b, ...c }) => ({ ...c, ...inBag(b) })),
    options: { time_limit: count > 30 ? 8 : 5, allow_squeeze: state.allowSqueeze },
  };
  const packedBags = state.bags.map((b) => ({ ...b, dims: { ...b.dims } }));
  $('loading').hidden = false;
  $('loadingNote').textContent = t('loading.note', { n: count });
  $('packBtn').disabled = true;
  try {
    const data = await backend.pack(body, (n) => { $('loadingNote').textContent = t('loading.progress', { n: fmt(n, 0) }); });
    state.layout = data;
    state.packedBags = packedBags;
    $('loading').hidden = true;
    await showResult(data);
  } catch (err) {
    showBanner(`<b>${t('banner.failed')}</b> ${escapeHtml(err.message)}`);
  } finally {
    $('loading').hidden = true;
    $('packBtn').disabled = false;
  }
}

/** The bags of a layout (one entry for single-suitcase layouts). */
const layoutBags = (layout) => layout.bags || [layout.suitcase];
const multiBag = (layout) => layoutBags(layout).length > 1;

/** Display name of bag i of the current layout. */
function packedBagTitle(i) {
  const bags = state.packedBags || state.bags;
  return bags[i] ? bagTitle(bags[i], i, bags.length) : '';
}

async function showResult(layout) {
  $('emptyState').hidden = true;
  $('metrics').hidden = false;
  renderResultText(layout);
  $('player').hidden = false;
  $('stepsPanel').hidden = false;
  document.querySelector('.stage').classList.remove('no-steps');
  $('scrub').max = layout.steps.length;
  if (scene) {
    await scene.setLayout(layout, bagLooks(state.packedBags));
    scene.frame();
    scene.play();
    syncPlayer();
  }
}

/** Everything about a result that is text (re-run when the language changes). */
function renderResultText(layout) {
  const m = layout.metrics;
  $('mEff').textContent = `${fmt(m.volume_efficiency_pct, 1)}%`;
  $('mItems').textContent = `${m.items_packed} / ${m.items_total}`;
  $('mWeight').textContent = m.weight_limit_kg
    ? `${fmt(m.packed_weight_kg, 1)} / ${fmt(m.weight_limit_kg)} ${t('unit.kg')}` : `${fmt(m.packed_weight_kg, 1)} ${t('unit.kg')}`;
  $('mFree').textContent = `${fmt(m.unused_volume_cm3 / 1000, 1)} L`;
  renderBagCards(layout);
  const notes = $('metricNotes');
  notes.innerHTML = '';
  const bal = !multiBag(layout) && balanceText(layoutBags(layout)[0].metrics ? layoutBags(layout)[0].metrics.balance : m.balance);
  if (bal) notes.append(el('span', { class: `pill bal ${bal.rating}`, title: bal.title }, el('i', { 'aria-hidden': 'true' }), bal.label));
  if (m.squeezed_items) notes.append(el('span', { class: 'pill', title: t('m.squeezedTitle') }, t('m.squeezed', { n: m.squeezed_items })));
  if (m.priority_items) {
    notes.append(el('span', { class: 'pill' }, t('m.onTop', { a: m.priority_items - m.priority_buried, b: m.priority_items })));
  }
  notes.append(el('span', { class: 'pill', title: m.strategy }, t('m.tried', { n: fmt(m.attempts, 0), s: fmt(layout.elapsed_s ?? 0, 1) })));

  const warn = layout.steps.filter((st) => st.cabin_warning);
  if (layout.unpacked.length) {
    const n = layout.unpacked.length;
    const hint = t(state.allowSqueeze ? 'banner.hint' : 'banner.hintNoSq');
    showBanner(`<b>${n === 1 ? t('banner.didntFit1') : t('banner.didntFit', { n })}</b> ${hint}<ul>${
      layout.unpacked.slice(0, 6).map((u) => `<li>${escapeHtml(stepName(u))}: ${escapeHtml(reasonText(u.reason))}</li>`).join('')
    }${n > 6 ? `<li>${t('banner.more', { n: n - 6 })}</li>` : ''}</ul>`);
  } else if (warn.length) {
    showBanner(`<b>${escapeHtml(t('banner.cabin', { items: warn.map(stepName).join(', ') }))}</b> ${t('banner.cabinHint')}`);
  } else {
    $('unpackedBanner').hidden = true;
  }
  renderSteps(layout);
  if (scene) markStep(Math.min(scene.stepCount, Math.ceil(scene.t - 1e-6)));
}

/** One card per bag (only with several bags): how full and heavy it is. Click to look at it. */
function renderBagCards(layout) {
  const box = $('bagCards');
  box.innerHTML = '';
  if (!multiBag(layout)) return;
  layout.bags.forEach((b, i) => {
    const m = b.metrics;
    const looks = state.packedBags[i];
    const over = b.max_weight && m.packed_weight_kg > b.max_weight;
    const bal = balanceText(m.balance);
    box.append(el('button', {
      type: 'button', class: 'bag-card', title: t('m.bagFocus'), onclick: () => scene && scene.focusBag(i),
    },
    el('span', { class: 'dot', style: `background:${looks ? looks.shell : BAG_COLORS[i]}`, 'aria-hidden': 'true' }),
    el('span', { class: 'bag-card-text' },
      el('b', {}, packedBagTitle(i)),
      el('small', { class: over ? 'over' : '' }, [
        t('m.bagItems', { n: m.items_packed }),
        `${fmt(m.volume_efficiency_pct, 0)}%`,
        b.max_weight ? `${fmt(m.packed_weight_kg, 1)}/${fmt(b.max_weight)} ${t('unit.kg')}` : `${fmt(m.packed_weight_kg, 1)} ${t('unit.kg')}`,
      ].join(' · ')),
      bal ? el('small', { class: `bal ${bal.rating}`, title: bal.title }, el('i', { 'aria-hidden': 'true' }), bal.label) : null)));
  });
}

/** How a bag's weight sits, in words: { rating, label, title } (null for an empty bag). */
function balanceText(bal) {
  if (!bal) return null;
  const why = bal.light ? 'bal.light'
    : bal.issue === 'lopsided' ? 'bal.side'
      : bal.issue === 'top-heavy' ? 'bal.top'
        : bal.rating === 'good' ? (bal.wheels ? 'bal.goodWheels' : 'bal.goodSoft') : (bal.wheels ? 'bal.okWheels' : 'bal.okSoft');
  return { rating: bal.rating, label: t(`bal.${bal.rating}`), title: `${t(why)} ${t('bal.dot')}` };
}

/** Localised name of a packed / unpacked item. */
function stepName(entry) {
  return packedName(entry, state.catalogIds);
}

function describe(st) {
  const layout = state.layout;
  const names = Object.fromEntries(layout.steps.map((s) => [s.id, stepName(s)]));
  const i = st.bag || 0;
  return describeStep(st, layoutBags(layout)[i], (id) => names[id] || id, multiBag(layout) ? packedBagTitle(i) : undefined);
}

function showBanner(html) {
  const b = $('unpackedBanner');
  b.innerHTML = html;
  b.hidden = false;
}

function resetResult() {
  state.layout = null;
  state.packedBags = null;
  $('metrics').hidden = true;
  $('player').hidden = true;
  $('stepsPanel').hidden = true;
  $('unpackedBanner').hidden = true;
  $('emptyState').hidden = false;
  document.querySelector('.stage').classList.add('no-steps');
  if (scene) {
    const bags = state.bags.map((b) => ({ length: b.dims.length, width: b.dims.width, height: b.dims.height }));
    scene.setLayout({ bags, steps: [] }, bagLooks(state.bags));
  }
}

function stepThumb(st, lazy = true) {
  const img = el('img', { alt: '' });
  thumbInto(img, {
    model: st.model, model_url: st.model_url, length: st.original_size[0], width: st.original_size[1], height: st.original_size[2], color: st.hex_color,
  }, { lazy });
  return img;
}

function stepBadges(st) {
  const badges = [];
  if (st.cabin_warning) badges.push(el('span', { class: 'badge warn', title: t('tag.cabinTitle') }, t('badge.cabinWarn')));
  else if (st.cabin === 'required') badges.push(el('span', { class: 'badge cabin', title: t('tag.cabinTitle') }, t('badge.cabin')));
  if (st.squeezed_pct) badges.push(el('span', { class: 'badge soft' }, t('badge.squeezed', { n: st.squeezed_pct })));
  if (st.priority) badges.push(el('span', { class: 'badge first' }, t('badge.first')));
  if (st.fragile) badges.push(el('span', { class: 'badge fragile' }, t('badge.fragile')));
  return badges;
}

/** Steps grouped by bag: one heading per bag (only with several bags). */
function bagGroups(layout) {
  const groups = layoutBags(layout).map((b, i) => ({ i, bag: b, steps: [] }));
  for (const st of layout.steps) groups[st.bag || 0].steps.push(st);
  return groups.filter((g) => g.steps.length);
}

function bagMeta(g) {
  const kg = g.steps.reduce((a, st) => a + st.weight_kg, 0);
  return t('steps.bagMeta', { n: g.steps.length, kg: fmt(kg, 1) });
}

function renderSteps(layout) {
  const ol = $('stepList');
  ol.innerHTML = '';
  const multi = multiBag(layout);
  for (const g of bagGroups(layout)) {
    if (multi) {
      const looks = state.packedBags[g.i];
      ol.append(el('li', { class: 'bag-head', title: t('m.bagFocus'), onclick: () => scene && scene.focusBag(g.i) },
        el('span', { class: 'dot', style: `background:${looks ? looks.shell : BAG_COLORS[g.i]}`, 'aria-hidden': 'true' }),
        el('b', {}, packedBagTitle(g.i)), el('small', {}, `${t(`kind.${g.bag.kind}`)} · ${bagMeta(g)}`)));
    }
    for (const st of g.steps) {
      const badges = stepBadges(st);
      ol.append(el('li', {
        'data-step': st.step,
        onclick: () => {
          if (!scene) return;
          // looking at another bag? turn to this one
          if (multi && scene.focusedBag >= 0 && scene.focusedBag !== g.i) scene.focusBag(g.i);
          scene.showStep(st.step);
        },
      },
      el('span', { class: 'n' }, String(st.step)), stepThumb(st),
      el('div', {}, el('div', { class: 'title' }, stepName(st)), el('div', { class: 'how' }, describe(st).how),
        badges.length ? el('div', { class: 'badges' }, badges) : null)));
    }
  }
}

function markStep(n) {
  for (const li of $('stepList').querySelectorAll('li[data-step]')) {
    const s = Number(li.dataset.step);
    li.classList.toggle('done', s <= n);
    li.classList.toggle('current', s === n);
  }
  const cur = $('stepList').querySelector('li.current');
  if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('stepLabel').textContent = t('player.step', { n, total: state.layout ? state.layout.steps.length : 0 });
}

/** The steps as plain text (Copy), with a heading per bag when there are several. */
function stepsText(layout) {
  const multi = multiBag(layout);
  return bagGroups(layout).map((g) => [
    ...(multi ? [`${packedBagTitle(g.i)} (${bagMeta(g)})`] : []),
    ...g.steps.map((st) => `${st.step}. ${describe(st).full}`),
  ].join('\n')).join('\n\n');
}

// -- print checklist --------------------------------------------------------- //
function printChecklist() {
  const layout = state.layout;
  if (!layout) return;
  let hero = '';
  if (scene) {
    scene.showStep(layout.steps.length);
    scene.frame(false);
    scene.renderNow();
    try { hero = scene.canvas.toDataURL('image/png'); } catch { hero = ''; }
  }
  const m = layout.metrics;
  const bags = layoutBags(layout);
  const multi = multiBag(layout);
  const sub = bags.map((b, i) => `${packedBagTitle(i)} ${fmt(b.length)}×${fmt(b.width)}×${fmt(b.height)} ${t('unit.cm')}`).join(' + ');
  const view = $('printView');
  view.innerHTML = '';
  view.append(
    el('h1', {}, t('print.title')),
    el('p', { class: 'sub' }, `${sub} · ${new Date().toLocaleDateString(lang)}`),
    hero ? el('img', { class: 'hero', src: hero, alt: t('print.alt') }) : null,
    el('div', { class: 'facts' },
      el('div', {}, el('b', {}, `${fmt(m.volume_efficiency_pct, 1)}%`), ` ${t('print.space')}`),
      el('div', {}, el('b', {}, `${m.items_packed}/${m.items_total}`), ` ${t('print.items')}`),
      el('div', {}, el('b', {}, `${fmt(m.packed_weight_kg, 1)} ${t('unit.kg')}`), m.weight_limit_kg ? ` ${t('print.of', { max: fmt(m.weight_limit_kg) })}` : ''),
      m.squeezed_items ? el('div', {}, el('b', {}, String(m.squeezed_items)), ` ${t('print.squeezed')}`) : null,
      ...bags.map((b, i) => {
        const bal = balanceText(b.metrics ? b.metrics.balance : m.balance);
        return bal ? el('div', { title: bal.title }, el('b', {}, bal.label), multi ? ` · ${packedBagTitle(i)}` : '') : null;
      })),
  );
  const thumbs = [];
  const rows = bagGroups(layout).flatMap((g) => [
    ...(multi ? [el('tr', { class: 'bag-row' }, el('td', { colspan: '4' }, el('b', {}, packedBagTitle(g.i)), ` · ${t(`kind.${g.bag.kind}`)} · ${bagMeta(g)}`))] : []),
    ...g.steps.map((st) => {
      const img = stepThumb(st, false);
      img.className = 't';
      thumbs.push(img);
      return el('tr', {},
        el('td', {}, el('span', { class: 'box' })),
        el('td', { class: 'n' }, String(st.step)),
        el('td', {}, img),
        el('td', {}, el('b', {}, stepName(st)), el('br'), describe(st).how));
    }),
  ]);
  view.append(el('table', {}, el('tbody', {}, rows)));
  if (layout.unpacked.length) {
    view.append(el('p', { class: 'left' }, el('b', {}, `${t('print.didntFit')} `), layout.unpacked.map(stepName).join(', ')));
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

/** Point a bag at the size preset its measurements match ('custom' if none). */
function matchPreset(b) {
  const match = presetMatch(b);
  b.presetId = match ? match.id : 'custom';
}

function bindControls() {
  $('search').addEventListener('input', (e) => { state.query = e.target.value; renderItems(); });
  for (const [id, key] of [['dimL', 'length'], ['dimW', 'width'], ['dimH', 'height'], ['dimKg', 'max_weight']]) {
    $(id).addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      const b = bag();
      if (key === 'max_weight') b.dims.max_weight = v > 0 ? v : null;
      else if (v > 0) b.dims[key] = v;
      else e.target.value = b.dims[key];
      matchPreset(b);
      for (const [i, opt] of [...$('suitcases').children].entries()) {
        opt.setAttribute('aria-checked', String(state.catalog.suitcases[i].id === b.presetId));
      }
      renderBagTabs();
      applySuitcase();
    });
  }
  $('clearBtn').addEventListener('click', () => {
    state.qty = {}; state.custom = []; state.priority = {}; state.assign = {}; state.profile = null;
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
    if (!selectedList().length) { toast(t('toast.needItemsSave')); return; }
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
    if (!selectedList().length) { toast(t('toast.needItemsShare')); return; }
    $('openForm').hidden = true;
    $('sharePanel').hidden = false;
    $('shareOut').value = shareText();
    $('copyShareBtn').click();
  });
  $('copyShareBtn').addEventListener('click', async () => {
    const text = $('shareOut').value;
    try {
      await navigator.clipboard.writeText(text);
      toast(t(backend.mode === 'server' ? 'toast.copiedLink' : 'toast.copiedCode'));
    } catch {
      $('shareOut').focus();
      $('shareOut').select();
      toast(t('toast.pressCopy'));
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
      for (const b of state.bags) matchPreset(b);
      state.profile = null;
      refreshAll();
      $('openForm').hidden = true;
      $('openCode').value = '';
      toast(t('toast.opened'));
    } catch {
      toast(t('toast.badCode'));
    }
  });

  $('copyBtn').addEventListener('click', async () => {
    if (!state.layout) return;
    try { await navigator.clipboard.writeText(stepsText(state.layout)); toast(t('toast.stepsCopied')); } catch { toast(t('toast.copyFail')); }
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
  $('balanceBtn').addEventListener('click', () => {
    const on = !scene.showBalance;
    scene.setBalance(on);
    $('balanceBtn').setAttribute('aria-pressed', String(on));
  });
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
      const extra = [
        multiBag(state.layout) ? packedBagTitle(st.bag) : '',
        st.squeezed_pct ? t('badge.squeezed', { n: st.squeezed_pct }) : '', st.priority ? t('badge.first') : '',
      ].filter(Boolean).join(' · ');
      tip.textContent = `${st.step}. ${stepName(st)} · ${st.size.map((v) => fmt(v)).join('×')} ${t('unit.cm')}${extra ? ` · ${extra}` : ''}`;
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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// -- settings page & language ------------------------------------------------ //
function renderChrome() {
  if (!backend) return;
  $('modeBadge').textContent = t(backend.mode === 'server' ? 'mode.server' : 'mode.browser');
  $('modeBadge').title = t(backend.mode === 'server' ? 'mode.serverTitle' : 'mode.browserTitle');
  $('search').placeholder = t('search.ph', { n: state.catalog.items.length });
}

function renderLanguageOptions() {
  const box = $('langOptions');
  box.innerHTML = '';
  for (const l of LANGS) {
    box.append(el('button', {
      type: 'button', class: 'lang-option', role: 'radio', 'aria-checked': String(l.code === lang), lang: l.code,
      onclick: () => setLang(l.code),
    }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', {}, el('b', {}, l.label), el('small', {}, l.sample))));
  }
}

onLangChange(() => {
  applyStatic();
  renderLanguageOptions();
  if (!state.catalog) return;
  renderChrome();
  renderBagEditor(); renderProfiles(); renderCategories(); renderItems();
  renderCustomModelOptions(); renderTrips(); updateSummary();
  if (account) account.render();
  if (state.layout) renderResultText(state.layout);
  toast(t('toast.lang'));
});

$('settingsBtn').addEventListener('click', () => {
  const d = $('settingsDialog');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
});
$('settingsDialog').addEventListener('click', (e) => {
  // clicking the dimmed backdrop closes the page
  if (e.target === $('settingsDialog')) $('settingsDialog').close();
});

// -- install as an app (Chrome / Edge) and offline support ------------------- //
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('installBtn').hidden = true;
  toast(t('toast.installed'));
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
  $('emptyState').innerHTML = `<h3>${t('err.start')}</h3><p>${escapeHtml(err.message)}.</p>`;
});
