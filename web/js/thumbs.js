// Renders small product pictures for the item list, using the same 3D models
// as the packing view (the detailed .glb one if the item has a model_url).

import { Renderer, OrbitCamera } from './engine/renderer.js';
import { buildProductGeometry } from './models.js';
import { loadGlbCached, fitParts, tintParts, meshFromParts } from './engine/glb.js';

let renderer = null;
const cache = new Map();
const queue = [];
let busy = false;

function ensureRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:128px;height:128px';
  document.body.appendChild(canvas);
  renderer = new Renderer(canvas);
  renderer.resize = () => {};
  renderer.clearColor = [0.965, 0.969, 0.973];
  return renderer;
}

function render(item, parts) {
  const r = ensureRenderer();
  const mesh = parts
    ? meshFromParts(r, fitParts(tintParts(parts, item.color), item.length, item.width, item.height))
    : r.createMesh(buildProductGeometry(item.model || 'box', item.length, item.width, item.height, item.color));
  const size = Math.max(item.length, item.width, item.height * 1.2);
  const cam = new OrbitCamera({ target: [0, 0, 0], distance: size * 2.35, azimuth: -60, elevation: 38, fov: 30 });
  r.render([mesh], cam);
  const url = r.canvas.toDataURL('image/png');
  r.disposeMesh(mesh);
  return url;
}

function pump() {
  if (busy) return;
  busy = true;
  const tick = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const { item, img, parts } = queue.shift();
      const key = thumbKey(item);
      if (!cache.has(key)) {
        try { cache.set(key, render(item, parts)); } catch (e) { cache.set(key, ''); console.warn(e); }
      }
      if (cache.get(key)) img.src = cache.get(key);
    }
    if (queue.length) requestAnimationFrame(tick);
    else busy = false;
  };
  requestAnimationFrame(tick);
}

const thumbKey = (item) => `${item.model}|${item.model_url || ''}|${item.length}|${item.width}|${item.height}|${item.color}`;

/** Queue a picture, once its .glb model (if it has one) has loaded. */
function enqueue(job, first = false) {
  const go = (parts) => {
    if (first) queue.unshift({ ...job, parts }); else queue.push({ ...job, parts });
    pump();
  };
  if (!job.item.model_url) { go(null); return; }
  loadGlbCached(job.item.model_url).then(go, () => go(null)); // no model: the simple shape
}

// Only draw thumbnails once they scroll into view (the list has ~90 rows).
const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      const job = e.target._thumbJob;
      if (job) enqueue(job, true);
    }
  }, { rootMargin: '200px' })
  : null;

/** Fill <img> with a picture of the item (asynchronously, a few per frame). */
export function thumbInto(img, item, { lazy = true } = {}) {
  const key = thumbKey(item);
  if (cache.get(key)) { img.src = cache.get(key); return; }
  if (lazy && observer) {
    img._thumbJob = { item, img };
    observer.observe(img);
    return;
  }
  enqueue({ item, img });
}
