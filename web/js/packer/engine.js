// JavaScript port of the Python packing engine (packing_assistant/optimizer.py,
// models.py, visualizer.py, catalog.py). Used when the app runs without the
// Python server, e.g. as a hosted web page. Keep the two in step: the Python
// test-suite and tests/test_js_engine.py check both.
//
// Coordinates: x = length (left to right), y = width (front to back),
// z = height (up). Centimetres and kilograms. Origin = front-left-bottom.

const EPS = 1e-6;

// --------------------------------------------------------------------------- //
// Items
// --------------------------------------------------------------------------- //
export function makeItem(e) {
  const it = {
    id: String(e.id), name: String(e.name ?? e.id),
    length: +e.length, width: +e.width, height: +e.height,
    weight: +(e.weight || 0), category: e.category || 'general',
    fragile: !!e.fragile, upright: !!e.upright,
    squeeze: +(e.squeeze || 0), priority: !!e.priority,
    natural: e.natural || null,
  };
  for (const k of ['length', 'width', 'height']) {
    if (!(it[k] > 0)) throw new Error(`Item '${it.id}' ${k} must be positive`);
  }
  if (it.weight < 0) throw new Error(`Item '${it.id}' weight cannot be negative`);
  if (!(it.squeeze >= 0 && it.squeeze < 0.9)) throw new Error(`Item '${it.id}' squeeze must be between 0 and 0.9`);
  return it;
}

const dims = (it) => [it.length, it.width, it.height];
const volume = (it) => it.length * it.width * it.height;
const naturalDims = (it) => it.natural || dims(it);
const naturalVolume = (it) => { const d = naturalDims(it); return d[0] * d[1] * d[2]; };
const squeezedFraction = (it) => (it.natural ? 1 - Math.min(...dims(it)) / Math.min(...it.natural) : 0);

function squeezed(it, level) {
  if (it.squeeze <= 0 || level <= 0) return it;
  const nat = naturalDims(it);
  const k = 1 - it.squeeze * Math.min(1, level);
  const d = [...nat];
  const i = d.indexOf(Math.min(...d));
  d[i] = Math.round(d[i] * k * 1000) / 1000;
  return { ...it, length: d[0], width: d[1], height: d[2], natural: nat };
}

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
function orientations(it) {
  const seen = new Set();
  const out = [];
  const d = dims(it);
  for (const p of PERMS) {
    if (it.upright && p[2] !== 2) continue;
    const size = [d[p[0]], d[p[1]], d[p[2]]];
    const key = size.join('|');
    if (!seen.has(key)) { seen.add(key); out.push([p, size]); }
  }
  return out;
}

export function itemsFromList(entries) {
  const items = [];
  const ids = new Set();
  entries.forEach((e, n) => {
    const base = String(e.id || `item${n + 1}`);
    const qty = parseInt(e.quantity ?? 1, 10);
    for (let k = 1; k <= qty; k++) {
      const id = qty === 1 ? base : `${base}#${k}`;
      const name = qty === 1 ? (e.name ?? base) : `${e.name ?? base} #${k}`;
      if (ids.has(id)) throw new Error(`Duplicate item id '${id}'`);
      ids.add(id);
      items.push(makeItem({ ...e, id, name }));
    }
  });
  return items;
}

// --------------------------------------------------------------------------- //
// Results
// --------------------------------------------------------------------------- //
const boxOf = (p) => [p.x, p.y, p.z, p.x + p.size[0], p.y + p.size[1], p.z + p.size[2]];
const xyOverlap = (a, b) => {
  const dx = Math.min(a[3], b[3]) - Math.max(a[0], b[0]);
  const dy = Math.min(a[4], b[4]) - Math.max(a[1], b[1]);
  return dx > EPS && dy > EPS ? dx * dy : 0;
};

function buriedPriority(placements) {
  const out = [];
  for (const p of placements) {
    if (!p.item.priority) continue;
    const a = boxOf(p);
    if (placements.some((q) => q !== p && q.z >= a[5] - 1e-6 && xyOverlap(a, boxOf(q)) > 0)) out.push(p);
  }
  return out;
}

function centerOfGravity(placements) {
  const total = placements.reduce((s, p) => s + p.item.weight, 0);
  if (total <= 0) return null;
  return [0, 1, 2].map((a) => placements.reduce((s, p) => s + (boxOf(p)[a] + p.size[a] / 2) * p.item.weight, 0) / total);
}

function score(r) {
  const cog = centerOfGravity(r.placements);
  const cogH = cog ? cog[2] / r.suitcase.height : 0;
  const fill = Math.max(0, ...r.placements.map((p) => p.z + p.size[2]));
  const nat = r.placements.reduce((s, p) => s + naturalVolume(p.item), 0);
  const sq = r.placements.reduce((s, p) => s + naturalVolume(p.item) - volume(p.item), 0);
  return [round(nat, 6), r.placements.length, -buriedPriority(r.placements).length, -round(sq, 3), -round(cogH, 6), -fill];
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function metrics(r) {
  const s = r.suitcase;
  const sv = s.length * s.width * s.height;
  const used = r.placements.reduce((a, p) => a + volume(p.item), 0);
  const fill = Math.max(0, ...r.placements.map((p) => p.z + p.size[2]));
  const region = s.length * s.width * fill;
  const cog = centerOfGravity(r.placements);
  const weight = r.placements.reduce((a, p) => a + p.item.weight, 0);
  return {
    suitcase_volume_cm3: round(sv, 1),
    packed_volume_cm3: round(used, 1),
    unused_volume_cm3: round(sv - used, 1),
    volume_efficiency_pct: round((100 * used) / sv, 2),
    unused_volume_pct: round(100 * (1 - used / sv), 2),
    fill_height_cm: round(fill, 1),
    compactness_pct: region ? round((100 * used) / region, 2) : 0,
    items_packed: r.placements.length,
    items_total: r.placements.length + r.unpacked.length,
    items_unpacked: r.unpacked.map((u) => u.item.name),
    packed_weight_kg: round(weight, 2),
    weight_limit_kg: s.max_weight ?? null,
    center_of_gravity_cm: cog ? cog.map((c) => round(c, 1)) : null,
    squeezed_items: r.placements.filter((p) => squeezedFraction(p.item) > 0.001).length,
    priority_items: r.placements.filter((p) => p.item.priority).length,
    priority_buried: buriedPriority(r.placements).length,
    strategy: r.strategy,
    attempts: r.attempts || 1,
  };
}

// --------------------------------------------------------------------------- //
// Single greedy pass (extreme points)
// --------------------------------------------------------------------------- //
export const RULES = ['max-contact', 'bottom-up', 'back-to-front'];

function greedyPack(suitcase, items, cfg, rule, strategy) {
  const L = suitcase.length, W = suitcase.width, H = suitcase.height;
  const D = [L, W, H];
  const sortedD = [...D].sort((a, b) => a - b);
  const placements = [];
  const boxes = [];
  const unpacked = [];
  let points = [[0, 0, 0]];
  let weight = 0;
  const limit = suitcase.max_weight;

  for (const item of items) {
    if (limit != null && weight + item.weight > limit + EPS) {
      unpacked.push({ item, reason: 'would exceed the weight limit' });
      continue;
    }
    const orients = orientations(item);
    if (!orients.some(([, s]) => [...s].sort((a, b) => a - b).every((v, i) => v <= sortedD[i] + EPS))) {
      unpacked.push({ item, reason: 'larger than the suitcase in every orientation' });
      continue;
    }
    let bestKey = null, best = null;
    for (const pt of points) {
      const [px, py, pz] = pt;
      for (const [perm, [sx, sy, sz]] of orients) {
        const x1 = px + sx, y1 = py + sy, z1 = pz + sz;
        if (x1 > L + EPS || y1 > W + EPS || z1 > H + EPS) continue;
        let hit = false;
        for (const b of boxes) {
          if (px < b[3] - EPS && b[0] < x1 - EPS && py < b[4] - EPS && b[1] < y1 - EPS && pz < b[5] - EPS && b[2] < z1 - EPS) { hit = true; break; }
        }
        if (hit) continue;
        const c = [px, py, pz, x1, y1, z1];
        const sup = support(c, boxes, placements, cfg);
        if (sup === null) continue;
        const key = rank(c, boxes, D, rule);
        if (bestKey === null || cmp(key, bestKey) < 0) { bestKey = key; best = { pt, perm, size: [sx, sy, sz], sup }; }
      }
    }
    if (!best) {
      unpacked.push({ item, reason: 'no free space with enough support' });
      continue;
    }
    const p = { item, x: best.pt[0], y: best.pt[1], z: best.pt[2], perm: best.perm, size: best.size, step: placements.length + 1, supported_by: best.sup };
    placements.push(p);
    const box = boxOf(p);
    boxes.push(box);
    weight += item.weight;
    points = updatePoints(points, box, boxes, D);
  }
  return { suitcase, placements, unpacked, strategy, attempts: 1 };
}

function support(c, boxes, placements, cfg) {
  const z = c[2];
  if (z <= EPS) return [];
  let area = 0;
  const ids = [];
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (Math.abs(o[5] - z) > EPS) continue;
    const dx = Math.min(c[3], o[3]) - Math.max(c[0], o[0]);
    const dy = Math.min(c[4], o[4]) - Math.max(c[1], o[1]);
    if (dx <= EPS || dy <= EPS) continue;
    if (cfg.respect_fragile && placements[i].item.fragile) return null;
    area += dx * dy;
    ids.push(placements[i].item.id);
  }
  if (area + EPS < cfg.min_support * (c[3] - c[0]) * (c[4] - c[1])) return null;
  return ids;
}

function rank(c, boxes, D, rule) {
  const x = round(c[0], 6), y = round(c[1], 6), z = round(c[2], 6);
  const f0 = -(c[3] - c[0]) * (c[4] - c[1]), f1 = c[5] - c[2];
  if (rule === 'bottom-up') return [z, y, x, f0, f1];
  if (rule === 'back-to-front') return [y, z, x, f0, f1];
  return [-round(contact(c, boxes, D), 6), z, y, x, f0, f1];
}

function contact(c, boxes, D) {
  let total = 0;
  for (let a = 0; a < 3; a++) {
    const [b, d] = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
    const face = (c[b + 3] - c[b]) * (c[d + 3] - c[d]);
    if (c[a] <= EPS) total += face;
    if (c[a + 3] >= D[a] - EPS) total += face;
    for (const o of boxes) {
      if (Math.abs(c[a] - o[a + 3]) <= EPS || Math.abs(c[a + 3] - o[a]) <= EPS) {
        const db = Math.min(c[b + 3], o[b + 3]) - Math.max(c[b], o[b]);
        const dd = Math.min(c[d + 3], o[d + 3]) - Math.max(c[d], o[d]);
        if (db > EPS && dd > EPS) total += db * dd;
      }
    }
  }
  return total;
}

function updatePoints(points, nb, boxes, D) {
  const cand = [...points];
  for (let axis = 0; axis < 3; axis++) {
    const corner = [nb[0], nb[1], nb[2]];
    corner[axis] = nb[axis + 3];
    cand.push(corner);
    for (let proj = 0; proj < 3; proj++) if (proj !== axis) cand.push(project(corner, proj, boxes));
  }
  const out = [];
  const seen = new Set();
  for (const p of cand) {
    if (p[0] >= D[0] - EPS || p[1] >= D[1] - EPS || p[2] >= D[2] - EPS) continue;
    if (boxes.some((b) => b[0] - EPS <= p[0] && p[0] < b[3] - EPS && b[1] - EPS <= p[1] && p[1] < b[4] - EPS && b[2] - EPS <= p[2] && p[2] < b[5] - EPS)) continue;
    const key = p.map((v) => round(v, 6)).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out;
}

function project(pt, axis, boxes) {
  const others = [0, 1, 2].filter((a) => a !== axis);
  let stop = 0;
  for (const b of boxes) {
    const face = b[axis + 3];
    if (face <= pt[axis] + EPS && face > stop && others.every((o) => b[o] - EPS <= pt[o] && pt[o] < b[o + 3] - EPS)) stop = face;
  }
  const m = [...pt];
  m[axis] = stop;
  return m;
}

// --------------------------------------------------------------------------- //
// Search
// --------------------------------------------------------------------------- //
const STRATEGIES = {
  'largest volume first': (i) => [-volume(i), -Math.max(...dims(i))],
  'largest footprint first': (i) => { const s = [...dims(i)].sort((a, b) => a - b); return [-s[2] * s[1], -volume(i)]; },
  'longest side first': (i) => [-Math.max(...dims(i)), -volume(i)],
  'heaviest first': (i) => [-i.weight, -volume(i)],
  'sturdy first, fragile last': (i) => [i.fragile ? 1 : 0, -volume(i)],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_CONFIG = {
  min_support: 0.7, restarts: 400, seed: 42, time_limit_s: 6, respect_fragile: true,
  patience: 60, rules: RULES, allow_squeeze: true,
};

const priorityLast = (order) => (order.some((i) => i.priority) ? [...order.filter((i) => !i.priority), ...order.filter((i) => i.priority)] : order);

function mutate(order, rnd) {
  const out = [...order];
  const n = out.length;
  if (n < 2) return out;
  const times = rnd() < 2 / 3 ? 1 : 2;
  for (let t = 0; t < times; t++) {
    const i = Math.floor(rnd() * n);
    let j = Math.floor(rnd() * (n - 1));
    if (j >= i) j++;
    if (rnd() < 0.5) [out[i], out[j]] = [out[j], out[i]];
    else out.splice(j, 0, out.splice(i, 1)[0]);
  }
  return out;
}

const isPerfect = (r) => !r.unpacked.length && r.placements.reduce((a, p) => a + volume(p.item), 0) >= r.suitcase.length * r.suitcase.width * r.suitcase.height - EPS;

function search(suitcase, items, cfg, rnd, deadline, onProgress) {
  let best = null, bestOrder = items, bestRule = cfg.rules[0], bestScore = null, bestForce = true;
  let attempts = 0, stale = 0;
  const hasPriority = items.some((i) => i.priority);
  // force = put need-it-first items in last; without it they compete like any
  // other item (useful when a big one wouldn't fit last). Mirrors optimizer.py.
  const consider = (order, name, rule, force = true) => {
    if (force) order = priorityLast(order);
    attempts++;
    const r = greedyPack(suitcase, order, cfg, rule, `${name}, ${rule}`);
    const sc = score(r);
    if (best && cmp(sc, bestScore) < 0) { stale++; return; }
    const improved = !best || cmp(sc, bestScore) > 0;
    stale = improved ? 0 : stale + 1;
    if (!improved) r.strategy = best.strategy;
    best = r; bestScore = sc; bestOrder = order; bestRule = rule; bestForce = force;
  };
  for (const force of hasPriority ? [true, false] : [true]) {
    for (const [name, key] of Object.entries(STRATEGIES)) {
      const order = [...items].sort((a, b) => cmp(key(a), key(b)));
      for (const rule of cfg.rules) consider(order, name, rule, force);
    }
  }
  for (let i = 0; ; i++) {
    if ((deadline && performance.now() > deadline) || isPerfect(best)) break;
    // `restarts` is the normal budget; while items are still left over and
    // there is time on the clock, keep looking (up to 10x as long).
    if (i >= cfg.restarts && (!deadline || !best.unpacked.length || i >= cfg.restarts * 10)) break;
    if (!best.unpacked.length && stale >= cfg.patience) break;
    if (onProgress && i % 20 === 0) onProgress(attempts);
    const force = !hasPriority || rnd() < 0.85 ? bestForce : !bestForce;
    if (i % 5 === 4) {
      const order = [...items];
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      consider(order, 'random order', cfg.rules[Math.floor(rnd() * cfg.rules.length)], force);
    } else {
      const origin = best.strategy.split(', ')[0].replace(/ \+ local search$/, '');
      const rule = rnd() < 0.8 ? bestRule : cfg.rules[Math.floor(rnd() * cfg.rules.length)];
      consider(mutate(bestOrder, rnd), `${origin} + local search`, rule, force);
    }
  }
  best.attempts = attempts;
  best.score = bestScore;
  return best;
}

export function optimize(suitcase, items, config = {}, onProgress) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rnd = mulberry32(cfg.seed ?? 42);
  const start = performance.now();
  const limitMs = cfg.time_limit_s == null ? null : cfg.time_limit_s * 1000;
  const deadline = limitMs == null ? null : start + limitMs;
  const canSqueeze = cfg.allow_squeeze && items.some((i) => i.squeeze > 0);
  const firstDeadline = deadline == null || !canSqueeze ? deadline : start + limitMs * 0.5;
  let best = search(suitcase, items, cfg, rnd, firstDeadline, onProgress);
  let attempts = best.attempts;
  if (best.unpacked.length && canSqueeze) {
    const levels = [0.5, 1];
    for (let n = 0; n < levels.length; n++) {
      const now = performance.now();
      const dl = deadline == null ? null : now + (deadline - now) / (levels.length - n);
      const r = search(suitcase, items.map((i) => squeezed(i, levels[n])), cfg, rnd, dl, onProgress);
      attempts += r.attempts;
      if (cmp(r.score, best.score) > 0) {
        r.strategy += `, soft items squeezed ${levels[n] < 1 ? 'half' : 'fully'}`;
        best = r;
      }
      if (!best.unpacked.length) break;
    }
  }
  best.attempts = attempts;
  return best;
}

// --------------------------------------------------------------------------- //
// Layout description (mirrors visualizer.py)
// --------------------------------------------------------------------------- //
const CATEGORY_COLORS = {
  clothing: [0.24, 0.44, 0.54], shoes: [0.72, 0.53, 0.38], toiletries: [0.35, 0.6, 0.45],
  electronics: [0.3, 0.3, 0.34], accessories: [0.48, 0.42, 0.63], documents: [0.85, 0.7, 0.4], general: [0.82, 0.41, 0.36],
};

function orientationLabel(p) {
  const h = p.size[2];
  const s = [...dims(p.item)].sort((a, b) => a - b);
  if (s[0] === s[2]) return 'any way up';
  if (h === s[0]) return 'lying flat';
  if (h === s[2]) return 'standing on end';
  return 'on its side';
}

function regionLabel(p, s) {
  const cx = p.x + p.size[0] / 2, cy = p.y + p.size[1] / 2;
  const third = (v, total, names) => names[Math.min(2, Math.floor((3 * v) / total))];
  const depth = third(cy, s.width, ['front', 'middle', 'back']);
  const side = third(cx, s.length, ['left', 'centre', 'right']);
  return depth === 'middle' && side === 'centre' ? 'centre' : `${depth}-${side}`;
}

function rotationEulerDeg(perm) {
  const rot = (axis, deg) => {
    const c = Math.round(Math.cos((deg * Math.PI) / 180)), s = Math.round(Math.sin((deg * Math.PI) / 180));
    return [[[1, 0, 0], [0, c, -s], [0, s, c]], [[c, 0, s], [0, 1, 0], [-s, 0, c]], [[c, -s, 0], [s, c, 0], [0, 0, 1]]][axis];
  };
  const mul = (a, b) => a.map((row, i) => [0, 1, 2].map((j) => row.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
  let best = null;
  for (const rx of [0, 90, 180, 270]) for (const ry of [0, 90, 180, 270]) for (const rz of [0, 90, 180, 270]) {
    const m = mul(rot(2, rz), mul(rot(1, ry), rot(0, rx)));
    if ([0, 1, 2].every((i) => Math.abs(m[i][perm[i]]) === 1)) {
      const cost = [rx, ry, rz].reduce((s, a) => s + Math.min(a, 360 - a), 0);
      const cand = [cost, rx, ry, rz];
      if (!best || cmp(cand, best) < 0) best = cand;
    }
  }
  return best.slice(1);
}

const g = (v) => String(+v.toFixed(3));

export function layoutDict(r) {
  const s = r.suitcase;
  const names = Object.fromEntries(r.placements.map((p) => [p.item.id, p.item.name]));
  const buried = new Set(buriedPriority(r.placements));
  const steps = r.placements.map((p) => {
    const sup = p.supported_by.length ? `on top of ${p.supported_by.map((i) => names[i]).join(', ')}` : 'on the bottom of the case';
    let instruction = `Place ${p.item.name} ${orientationLabel(p)} in the ${regionLabel(p, s)} of the case, ${sup}.`;
    const sq = squeezedFraction(p.item);
    if (sq > 0.001) instruction += ` Press it down to about ${g(Math.min(...dims(p.item)))} cm thick.`;
    if (p.item.priority && !buried.has(p)) instruction += " It's on top, so you can grab it without unpacking.";
    else if (p.item.priority) instruction += ' (Marked need-it-first, but it had to go lower down to fit everything.)';
    return {
      step: p.step, id: p.item.id, name: p.item.name, category: p.item.category,
      weight_kg: p.item.weight, fragile: p.item.fragile,
      original_size: dims(p.item), natural_size: naturalDims(p.item),
      squeezed_pct: Math.round(100 * sq), priority: p.item.priority,
      priority_on_top: p.item.priority && !buried.has(p),
      position: [round(p.x, 3), round(p.y, 3), round(p.z, 3)],
      size: p.size.map((v) => round(v, 3)),
      orientation: orientationLabel(p),
      rotated: p.perm.join() !== '0,1,2',
      rotation_euler_deg: rotationEulerDeg(p.perm),
      supported_by: p.supported_by,
      color: CATEGORY_COLORS[p.item.category] || [0.55, 0.35, 0.5],
      instruction,
    };
  });
  return {
    units: { length: 'cm', weight: 'kg' },
    axes: { x: 'length (left->right)', y: 'width (front->back)', z: 'height (up)' },
    suitcase: { name: s.name, length: s.length, width: s.width, height: s.height, max_weight: s.max_weight ?? null },
    metrics: metrics(r),
    steps,
    unpacked: r.unpacked.map((u) => ({ id: u.item.id, name: u.item.name, size: dims(u.item), reason: u.reason })),
  };
}

// --------------------------------------------------------------------------- //
// API-compatible entry point (mirrors app.pack_request)
// --------------------------------------------------------------------------- //
export function packRequest(catalog, request, onProgress) {
  const sc = request.suitcase || {};
  const suitcase = {
    name: sc.name || 'Suitcase', length: +sc.length, width: +sc.width, height: +sc.height,
    max_weight: sc.max_weight ? +sc.max_weight : null,
  };
  for (const k of ['length', 'width', 'height']) if (!(suitcase[k] > 0)) throw new Error(`Suitcase ${k} must be positive`);
  const byId = Object.fromEntries(catalog.items.map((e) => [e.id, e]));
  const entries = [];
  for (const sel of request.items || []) {
    const entry = byId[sel.id];
    if (!entry) throw new Error(`Unknown catalog item '${sel.id}'`);
    const qty = parseInt(sel.quantity ?? 1, 10);
    if (qty > 0) entries.push({ ...entry, quantity: qty, ...(sel.priority != null ? { priority: !!sel.priority } : {}) });
  }
  (request.custom_items || []).forEach((c, i) => {
    let id = String(c.id || `custom${i + 1}`);
    if (byId[id]) id = `custom_${id}`;
    entries.push({ ...c, id, category: c.category || 'general' });
  });
  const items = itemsFromList(entries);
  if (items.length > 200) throw new Error(`Too many items (${items.length}); the limit is 200.`);
  const o = request.options || {};
  const cfg = {
    min_support: Math.min(1, Math.max(0.3, +(o.min_support ?? 0.7))),
    time_limit_s: Math.min(30, Math.max(0.5, +(o.time_limit ?? 6))),
    restarts: parseInt(o.restarts ?? 400, 10),
    seed: o.seed ?? 42,
    allow_squeeze: o.allow_squeeze ?? true,
  };
  const t0 = performance.now();
  const layout = layoutDict(optimize(suitcase, items, cfg, onProgress));
  layout.elapsed_s = round((performance.now() - t0) / 1000, 2);

  // enrich with model info, like catalog.enrich_layout
  const all = { ...byId };
  for (const c of request.custom_items || []) if (!all[c.id]) all[c.id] = c;
  const models = catalog.custom_models || {};
  const info = (id) => {
    const base = id.split('#')[0];
    const e = all[base] || all[base.replace(/^custom_/, '')] || {};
    return { catalog_id: base, model: e.model || 'box', hex_color: e.color || '#8899aa', model_url: models[base] || e.model_file || null };
  };
  for (const st of layout.steps) Object.assign(st, info(st.id));
  for (const u of layout.unpacked) Object.assign(u, info(u.id));
  return layout;
}
