// The 3D packing view: suitcase, product meshes and the step-by-step animation.

import { Renderer, OrbitCamera, Mesh } from './engine/renderer.js';
import { mat4, clamp, easeInOut } from './engine/math.js';
import { loadGlb, fitParts } from './engine/glb.js';
import { buildProductGeometry } from './models.js';
import { buildSuitcase } from './suitcase.js';

const DEG = Math.PI / 180;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class PackingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.camera = new OrbitCamera();
    this.suitcase = null;
    this.items = [];          // [{ step, mesh, target, euler, size }]
    this.t = 0;               // timeline position in steps
    this.playing = false;
    this.speed = 0.8;         // steps per second
    this.xray = true;
    this.highlight = -1;
    this.onStep = () => {};
    this.onTime = () => {};
    this.dirty = true;
    this._lastStep = -1;
    this._glbCache = new Map();
    this.camera.attach(canvas, () => { this.dirty = true; });
    new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // -- suitcase -------------------------------------------------------------
  setSuitcase(L, W, H, color) {
    const key = `${L}|${W}|${H}|${color}`;
    if (this.suitcase && this.suitcase.key === key) return;
    if (this.suitcase) for (const m of this._suitcaseMeshes()) this.renderer.disposeMesh(m);
    this.suitcase = { key, L, W, H, ...buildSuitcase(this.renderer, L, W, H, color) };
    this._applyXray();
    this.frame();
    this.dirty = true;
  }

  _suitcaseMeshes() {
    const s = this.suitcase;
    return s ? [...s.solid, ...s.walls, s.shadow] : [];
  }

  frame(animate = true) {
    if (!this.suitcase) return;
    const { L, W, H } = this.suitcase;
    // frame the open case plus the lid lying behind it, whatever the viewport shape
    const aspect = Math.max(0.5, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const span = Math.max(L * 1.15, W * 1.9) / Math.min(1, aspect / 1.25);
    const goal = { target: [L / 2, W * 0.78, 0], distance: span * 1.75, azimuth: -60, elevation: 50 };
    if (animate) this.camera.animateTo(goal);
    else Object.assign(this.camera, { ...goal, target: [...goal.target] });
    this.dirty = true;
  }

  topView() {
    if (!this.suitcase) return;
    const { L, W } = this.suitcase;
    this.camera.animateTo({ target: [L / 2, W / 2, 0], distance: Math.max(L, W) * 2.1, azimuth: -90, elevation: 89 });
  }

  setXray(on) {
    this.xray = on;
    this._applyXray();
    this.dirty = true;
  }

  _applyXray() {
    if (!this.suitcase) return;
    for (const w of this.suitcase.walls) w.alpha = this.xray ? 0.16 : 1;
  }

  // -- items ----------------------------------------------------------------
  async setLayout(layout) {
    for (const it of this.items) this.renderer.disposeMesh(it.mesh);
    this.items = [];
    const s = layout.suitcase;
    this.setSuitcase(s.length, s.width, s.height, this.suitcaseColor || '#2f4858');
    const built = await Promise.all(layout.steps.map((st) => this._buildItemMesh(st)));
    this.items = layout.steps.map((st, i) => {
      const [x, y, z] = st.position;
      const [sx, sy, sz] = st.size;
      return {
        step: st,
        mesh: built[i],
        target: [x + sx / 2, y + sy / 2, z + sz / 2],
        euler: st.rotation_euler_deg.map((a) => a * DEG),
        size: st.size,
        box: [x, y, z, x + sx, y + sy, z + sz],
      };
    });
    this.highlight = -1;
    this.seek(0);
    this.dirty = true;
  }

  async _buildItemMesh(st) {
    const [L, W, H] = st.original_size;
    if (st.model_url) {
      try {
        let parts = this._glbCache.get(st.model_url);
        if (!parts) {
          parts = loadGlb(st.model_url);
          this._glbCache.set(st.model_url, parts);
        }
        const fitted = fitParts(await parts, L, W, H);
        const parent = new Mesh(null);
        parent.children = fitted.map((p) => {
          const m = this.renderer.createMesh(p);
          if (p.image) { m.texture = this.renderer.createTexture(p.image); m.shine = p.baseColor[3]; }
          return m;
        });
        return parent;
      } catch (err) {
        console.warn(`Custom model for ${st.name} failed, using the built-in one:`, err);
      }
    }
    return this.renderer.createMesh(buildProductGeometry(st.model, L, W, H, st.hex_color));
  }

  get stepCount() { return this.items.length; }

  // -- timeline -------------------------------------------------------------
  play() {
    if (this.t >= this.stepCount) this.t = 0;
    this.playing = true;
    this.dirty = true;
  }
  pause() { this.playing = false; }
  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    this.t = clamp(t, 0, this.stepCount);
    this._updateItems();
    this.dirty = true;
  }

  /** Jump to the end of step n (1-based), e.g. from the step list. */
  showStep(n) {
    this.pause();
    this.highlight = n - 1;
    this.seek(n);
  }

  next() { this.showStep(Math.min(this.stepCount, Math.floor(this.t + 1e-6) + 1)); }
  prev() { this.showStep(Math.max(0, Math.ceil(this.t - 1e-6) - 1)); }

  _updateItems() {
    const hoverZ = (this.suitcase ? this.suitcase.H : 20) + 14;
    const active = Math.floor(this.t - 1e-9);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const p = clamp(this.t - i, 0, 1);
      const m = it.mesh;
      if (p <= 0) { m.visible = false; continue; }
      m.visible = true;
      const [tx, ty, tz] = it.target;
      const hz = hoverZ + it.size[2] / 2;
      let rot = 1, z = tz, alpha = 1, scale = 1;
      if (p < 1) {
        const a = clamp(p / 0.22, 0, 1);
        const r = clamp((p - 0.22) / 0.38, 0, 1);
        const d = clamp((p - 0.6) / 0.4, 0, 1);
        alpha = a;
        scale = 0.85 + 0.15 * easeOutCubic(a);
        rot = easeInOut(r);
        z = hz + (tz - hz) * easeOutCubic(d);
      }
      const [ex, ey, ez] = it.euler;
      m.matrix = mat4.multiply(
        mat4.translation(tx, ty, z),
        mat4.multiply(mat4.eulerXYZ(ex * rot, ey * rot, ez * rot), mat4.scaling(scale, scale, scale)),
      );
      m.alpha = alpha;
      const lit = (p < 1 && i === active) || i === this.highlight;
      m.tint = lit ? [0.07, 0.06, 0.02] : [0, 0, 0];
    }
    const stepNow = Math.min(this.stepCount, Math.ceil(this.t - 1e-6));
    if (stepNow !== this._lastStep) {
      this._lastStep = stepNow;
      this.onStep(stepNow);
    }
    this.onTime(this.t);
  }

  /** Draw immediately (e.g. before taking a snapshot of the canvas). */
  renderNow() {
    this._updateItems();
    const meshes = [...this._suitcaseMeshes(), ...this.items.map((i) => i.mesh)];
    this.renderer.render(meshes, this.camera);
    this.dirty = false;
  }

  // -- picking --------------------------------------------------------------
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const cam = this.camera, eye = cam.eye;
    const f = norm(sub(cam.target, eye));
    const r = norm(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    const th = Math.tan((cam.fov * DEG) / 2), aspect = rect.width / rect.height;
    const dir = norm(add(f, add(scale3(r, nx * th * aspect), scale3(u, ny * th))));
    let best = -1, bestT = Infinity;
    this.items.forEach((it, i) => {
      if (!it.mesh.visible || this.t - i < 1) return;
      const hit = rayBox(eye, dir, it.box);
      if (hit !== null && hit < bestT) { bestT = hit; best = i; }
    });
    return best;
  }

  // -- loop -----------------------------------------------------------------
  _loop(now) {
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.stepCount) { this.t = this.stepCount; this.playing = false; }
      this._updateItems();
      this.dirty = true;
    }
    if (this.camera.update(dt)) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      const meshes = [...this._suitcaseMeshes(), ...this.items.map((i) => i.mesh)];
      this.renderer.render(meshes, this.camera);
    }
    requestAnimationFrame((t) => this._loop(t));
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return null;
      continue;
    }
    let t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmax < 0 ? null : Math.max(tmin, 0);
}
