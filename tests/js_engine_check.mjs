// Runs the JavaScript engine on every trip preset plus a few edge cases and
// prints a JSON report. Used by tests/test_js_engine.py (needs Node 18+).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packRequest } from '../web/js/packer/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'data', 'catalog.json'), 'utf8'));
const EPS = 1e-6;

function bagProblems(s, steps) {
  const out = [];
  const boxes = steps.map((st) => [...st.position, ...st.position.map((v, i) => v + st.size[i])]);
  boxes.forEach((b, i) => {
    if (b[0] < -EPS || b[1] < -EPS || b[2] < -EPS || b[3] > s.length + EPS || b[4] > s.width + EPS || b[5] > s.height + EPS) out.push(`${steps[i].name} outside`);
    for (let j = 0; j < i; j++) {
      const o = boxes[j];
      if (b[0] < o[3] - EPS && o[0] < b[3] - EPS && b[1] < o[4] - EPS && o[1] < b[4] - EPS && b[2] < o[5] - EPS && o[2] < b[5] - EPS) out.push(`${steps[i].name} overlaps ${steps[j].name}`);
    }
    if (b[2] > EPS) {
      let area = 0;
      for (const o of boxes) if (Math.abs(o[5] - b[2]) < EPS) {
        const dx = Math.min(b[3], o[3]) - Math.max(b[0], o[0]), dy = Math.min(b[4], o[4]) - Math.max(b[1], o[1]);
        if (dx > EPS && dy > EPS) area += dx * dy;
      }
      if (area < 0.7 * (b[3] - b[0]) * (b[4] - b[1]) - EPS) out.push(`${steps[i].name} unsupported`);
    }
  });
  const kg = steps.reduce((a, st) => a + st.weight_kg, 0);
  if (s.max_weight && kg > s.max_weight + EPS) out.push(`${s.name} over its weight limit`);
  const sorted = (a) => [...a].sort((x, y) => x - y).join(',');
  steps.forEach((st) => { if (sorted(st.size) !== sorted(st.original_size)) out.push(`${st.name} size mismatch`); });
  return out;
}

function problems(layout) {
  if (!layout.bags) return bagProblems(layout.suitcase, layout.steps);
  const out = layout.bags.flatMap((bag, i) => bagProblems(bag, layout.steps.filter((st) => st.bag === i)));
  layout.steps.forEach((st, i) => { if (st.step !== i + 1) out.push(`step ${i + 1} is numbered ${st.step}`); });
  return out;
}

const preset = (id) => catalog.suitcases.find((s) => s.id === id);
const cases = catalog.profiles.map((p) => ({
  name: p.id,
  request: {
    bags: p.bags.map((id, i) => ({ ...preset(id), id: `bag${i}` })),
    items: Object.entries(p.items).map(([id, quantity]) => ({ id, quantity })),
    options: { time_limit: 4 },
  },
}));
cases.push({
  name: 'overpacked_carry_on',
  request: {
    suitcase: preset('carry_on'),
    items: Object.entries(catalog.profiles.find((p) => p.id === 'city').items).map(([id, quantity]) => ({ id, quantity })),
    options: { time_limit: 4 },
  },
});
cases.push({
  name: 'custom_and_priority_override',
  request: {
    suitcase: { name: 'Box', length: 40, width: 30, height: 20, max_weight: 7 },
    items: [{ id: 'book', quantity: 2, priority: true }, { id: 'sneakers', quantity: 1 }],
    custom_items: [{ id: 'game', name: 'Board game', length: 30, width: 30, height: 7, weight: 1, model: 'gift', color: '#123456' }],
    options: { time_limit: 2 },
  },
});

cases.push({
  name: 'bags_hold_and_backpack',
  request: {
    bags: [{ ...preset('large'), id: 'hold' }, { ...preset('underseat'), id: 'seat' }],
    items: [
      { id: 'power_bank' }, { id: 'laptop_13' }, { id: 'passport' }, { id: 'jeans', quantity: 2 },
      { id: 'sneakers' }, { id: 'tshirt', quantity: 4 }, { id: 'book', bag: 'seat' }, { id: 'camera', bag: 'hold' },
    ],
    options: { time_limit: 3 },
  },
});
cases.push({
  name: 'bags_no_cabin_bag',
  request: { bags: [{ ...preset('medium'), id: 'only' }], items: [{ id: 'power_bank' }, { id: 'tshirt' }], options: { time_limit: 1 } },
});

cases.push({
  name: 'balance_heavy_to_wheels',
  request: {
    bags: [{ id: 'case', name: 'Case', length: 80, width: 20, height: 10, kind: 'checked' }],
    custom_items: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      id: `b${i}`, name: `Brick ${i}`, length: 10, width: 10, height: 10, weight: i < 2 ? 5 : 0.2,
    })),
    options: { time_limit: 2 },
  },
});

const report = [];
for (const c of cases) {
  const layout = packRequest(catalog, c.request);
  const bagIds = layout.bags ? layout.bags.map((b) => b.id) : null;
  report.push({
    name: c.name,
    bags: bagIds && Object.fromEntries(layout.steps.map((st) => [st.id, bagIds[st.bag]])),
    warnings: layout.steps.filter((st) => st.cabin_warning).map((st) => st.id),
    balance: (layout.bags || []).map((b) => b.metrics.balance),
    heavyX: layout.steps.filter((st) => st.weight_kg >= 5).map((st) => st.position[0]),
    packed: layout.metrics.items_packed,
    total: layout.metrics.items_total,
    efficiency: layout.metrics.volume_efficiency_pct,
    squeezed: layout.metrics.squeezed_items,
    buried: layout.metrics.priority_buried,
    models: [...new Set(layout.steps.map((s) => s.model))],
    problems: problems(layout),
  });
}
console.log(JSON.stringify(report));
