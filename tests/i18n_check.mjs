// Prints a JSON report of missing translations (used by tests/test_i18n.py).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _tables, LANGS } from '../web/js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'data', 'catalog.json'), 'utf8'));
const html = readFileSync(join(root, 'web', 'index.html'), 'utf8');
const main = readFileSync(join(root, 'web', 'js', 'main.js'), 'utf8');
const { STRINGS, CATALOG, STEP_TEXT } = _tables;
const en = Object.keys(STRINGS.en);
const report = { langs: LANGS.map((l) => l.code), missing: {}, unknownKeys: [] };

// keys used in the page and the code must exist in English
const used = new Set([
  ...[...html.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"/g)].map((m) => m[1]),
  ...[...main.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]),
  ...[...main.matchAll(/t\(`looks\.\$\{k\}`\)/g)].length ? [] : [],
]);
for (const k of used) if (!STRINGS.en[k]) report.unknownKeys.push(k);

for (const { code } of LANGS) {
  const miss = [];
  for (const k of en) if (!STRINGS[code] || !STRINGS[code][k]) miss.push(`string:${k}`);
  if (!STEP_TEXT[code]) miss.push('step-text');
  if (code !== 'en') {
    const c = CATALOG[code] || {};
    for (const it of catalog.items) if (!c.items || !c.items[it.id]) miss.push(`item:${it.id}`);
    for (const x of catalog.categories) if (!c.categories || !c.categories[x.id]) miss.push(`category:${x.id}`);
    for (const x of catalog.suitcases) if (!c.suitcases || !c.suitcases[x.id]) miss.push(`suitcase:${x.id}`);
    for (const x of catalog.profiles) if (!c.profiles || !c.profiles[x.id]) miss.push(`profile:${x.id}`);
  }
  // placeholders like {n} must survive translation
  for (const k of en) {
    const want = (STRINGS.en[k].match(/\{\w+\}/g) || []).sort().join();
    const got = ((STRINGS[code] && STRINGS[code][k]) || '').match(/\{\w+\}/g) || [];
    if (STRINGS[code] && STRINGS[code][k] && got.sort().join() !== want) miss.push(`placeholders:${k}`);
  }
  report.missing[code] = miss;
}
console.log(JSON.stringify(report));
