// Renders small product pictures for the item list, using the same 3D models.

import { Renderer, OrbitCamera } from './engine/renderer.js';
import { buildProductGeometry } from './models.js';

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

function render(item) {
  const r = ensureRenderer();
  const mesh = r.createMesh(buildProductGeometry(item.model || 'box', item.length, item.width, item.height, item.color));
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
      const { item, img } = queue.shift();
      const key = thumbKey(item);
      if (!cache.has(key)) {
        try { cache.set(key, render(item)); } catch (e) { cache.set(key, ''); console.warn(e); }
      }
      if (cache.get(key)) img.src = cache.get(key);
    }
    if (queue.length) requestAnimationFrame(tick);
    else busy = false;
  };
  requestAnimationFrame(tick);
}

const thumbKey = (item) => `${item.model}|${item.length}|${item.width}|${item.height}|${item.color}`;

// Only draw thumbnails once they scroll into view (the list has ~90 rows).
const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      const job = e.target._thumbJob;
      if (job) { queue.unshift(job); pump(); }
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
  queue.push({ item, img });
  pump();
}
