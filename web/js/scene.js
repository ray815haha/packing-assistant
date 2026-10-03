// The 3D packing view: one or more open bags side by side, product meshes and
// the step-by-step animation.

import { Renderer, OrbitCamera, Mesh } from './engine/renderer.js';
import { mat4, clamp, easeInOut } from './engine/math.js';
import { MeshBuilder } from './engine/geometry.js';
import { loadGlb, fitParts } from './engine/glb.js';
import { buildProductGeometry } from './models.js';
import { buildSuitcase } from './suitcase.js';

const DEG = Math.PI / 180;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const BAG_GAP = 18; // cm between bags (room for the wheels of the next one)
const MARKER = [0.96, 0.58, 0.05]; // centre-of-gravity marker colour

/** Centre-of-gravity marker: a dot, a stem down to the floor and a ring where it lands. */
function buildMarker(renderer) {
  const mesh = (build, alpha) => {
    const b = new MeshBuilder().color(MARKER, 0.5);
    build(b);
    const m = renderer.createMesh(b.build());
    m.overlay = true;
    m.alpha = alpha;
    m.visible = false;
    return m;
  };
  return {
    dot: mesh((b) => b.sphere(1.6, 18), 1),
    stem: mesh((b) => b.translate(0, 0, 0.5).cylinder(0.28, 1, { seg: 10 }), 0.75), // base at 0, 1 tall
    ring: mesh((b) => b.torus(2.6, 0.32, { seg: 32, tubeSeg: 6 }), 0.85),
  };
}

export class PackingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.camera = new OrbitCamera();
    this.bags = [];           // [{ L, W, H, ox, walls, solid, shadow }] laid out along x
    this._bagsKey = '';
    this.follow = true;       // while playing, move the camera to the bag being packed
    this.showBalance = true;  // centre-of-gravity marker per bag
    this._focusBag = -1;
    this.items = [];          // [{ step, mesh, target, euler, size, bag }]
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

  // -- bags -----------------------------------------------------------------
  /** One bag: setSuitcase(L, W, H, colour). Several: setBags([{ L, W, H, color, style }]). */
  setSuitcase(L, W, H, color, style = 'hard') {
    this.setBags([{ L, W, H, color, style }]);
  }

  setBags(list) {
    const key = list.map((b) => `${b.L}|${b.W}|${b.H}|${b.color}|${b.style || 'hard'}`).join(';');
    if (key === this._bagsKey) return;
    this._bagsKey = key;
    for (const m of this._bagMeshes()) this.renderer.disposeMesh(m);
    let x = 0;
    this.bags = list.map((b) => {
      const built = buildSuitcase(this.renderer, b.L, b.W, b.H, b.color, b.style);
      const ox = x;
      x += b.L + BAG_GAP;
      for (const m of [...built.solid, ...built.walls, built.shadow]) m.matrix = mat4.multiply(mat4.translation(ox, 0, 0), m.matrix);
      return { L: b.L, W: b.W, H: b.H, ox, ...built, marker: buildMarker(this.renderer) };
    });
    this._applyXray();
    this.frame();
    this.dirty = true;
  }

  /** The first bag (for code that only knows about one). */
  get suitcase() { return this.bags[0] || null; }

  _bagMeshes() {
    return this.bags.flatMap((b) => [...b.solid, ...b.walls, b.shadow, b.marker.dot, b.marker.stem, b.marker.ring]);
  }

  /** Frame every bag, or just bag `only`, plus the lids lying behind them,
   * whatever the viewport shape. */
  frame(animate = true, only = -1) {
    if (!this.bags.length) return;
    const shown = only >= 0 && this.bags[only] ? [this.bags[only]] : this.bags;
    const x0 = shown[0].ox, x1 = shown[shown.length - 1].ox + shown[shown.length - 1].L;
    const L = x1 - x0, W = Math.max(...shown.map((b) => b.W));
    const aspect = Math.max(0.5, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const span = Math.max(L * 1.15, W * 1.9) / Math.min(1, aspect / 1.25);
    const goal = { target: [x0 + L / 2, W * 0.78, 0], distance: span * 1.75, azimuth: -60, elevation: 50 };
    if (animate) this.camera.animateTo(goal);
    else Object.assign(this.camera, { ...goal, target: [...goal.target] });
    this._focusBag = shown.length === 1 && this.bags.length > 1 ? this.bags.indexOf(shown[0]) : -1;
    this.dirty = true;
  }

  /** Move the camera to one bag (-1: all of them). */
  focusBag(i) { this.frame(true, i); }

  /** The bag the camera is on, or -1 when it shows them all. */
  get focusedBag() { return this._focusBag; }

  topView() {
    if (!this.bags.length) return;
    const shown = this._focusBag >= 0 ? [this.bags[this._focusBag]] : this.bags;
    const x0 = shown[0].ox, x1 = shown[shown.length - 1].ox + shown[shown.length - 1].L;
    const W = Math.max(...shown.map((b) => b.W));
    this.camera.animateTo({ target: [(x0 + x1) / 2, W / 2, 0], distance: Math.max(x1 - x0, W) * 2.1, azimuth: -90, elevation: 89 });
  }

  setXray(on) {
    this.xray = on;
    this._applyXray();
    this.dirty = true;
  }

  /** Show or hide the centre-of-gravity markers. */
  setBalance(on) {
    this.showBalance = on;
    this._updateMarkers();
    this.dirty = true;
  }

  /** Put each bag's marker at the centre of gravity of what's in it so far. */
  _updateMarkers() {
    const sums = this.bags.map(() => [0, 0, 0, 0]);
    this.items.forEach((it, i) => {
      const s = sums[it.bag];
      if (!s || this.t - i < 1 - 1e-6) return; // only items that have landed
      const w = it.step.weight_kg || 0;
      for (let a = 0; a < 3; a++) s[a] += it.target[a] * w;
      s[3] += w;
    });
    this.bags.forEach((b, i) => {
      const [sx, sy, sz, w] = sums[i];
      const { dot, stem, ring } = b.marker;
      const on = this.showBalance && w > 0;
      dot.visible = stem.visible = ring.visible = on;
      if (!on) return;
      const x = sx / w, y = sy / w, z = sz / w;
      dot.matrix = mat4.translation(x, y, z);
      stem.matrix = mat4.multiply(mat4.translation(x, y, 0), mat4.scaling(1, 1, Math.max(0.01, z)));
      ring.matrix = mat4.translation(x, y, 0.2);
    });
  }

  _applyXray() {
    for (const b of this.bags) for (const w of b.walls) w.alpha = this.xray ? 0.16 : 1;
  }

  // -- items ----------------------------------------------------------------
  /** `looks` = [{ color, style }] per bag (default: suitcaseColor, hard shell). */
  async setLayout(layout, looks = []) {
    for (const it of this.items) this.renderer.disposeMesh(it.mesh);
    this.items = [];
    const bags = layout.bags || [layout.suitcase];
    this.setBags(bags.map((b, i) => ({
      L: b.length, W: b.width, H: b.height,
      color: (looks[i] && looks[i].color) || this.suitcaseColor || '#2f4858',
      style: (looks[i] && looks[i].style) || 'hard',
    })));
    const built = await Promise.all(layout.steps.map((st) => this._buildItemMesh(st)));
    this.items = layout.steps.map((st, i) => {
      const bag = st.bag || 0;
      const [x, y, z] = [st.position[0] + this.bags[bag].ox, st.position[1], st.position[2]];
      const [sx, sy, sz] = st.size;
      return {
        step: st,
        bag,
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

  /** Index of the bag that step n (1-based) goes into. */
  bagOfStep(n) {
    const it = this.items[Math.max(1, Math.min(this.items.length, n)) - 1];
    return it ? it.bag : 0;
  }
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
    const active = Math.floor(this.t - 1e-9);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const p = clamp(this.t - i, 0, 1);
      const m = it.mesh;
      if (p <= 0) { m.visible = false; continue; }
      m.visible = true;
      const [tx, ty, tz] = it.target;
      const hz = (this.bags[it.bag] ? this.bags[it.bag].H : 20) + 14 + it.size[2] / 2;
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
    this._updateMarkers();
    this.onTime(this.t);
  }

  /** Draw immediately (e.g. before taking a snapshot of the canvas). */
  renderNow() {
    this._updateItems();
    this.camera.update(10); // finish any camera move first
    const meshes = [...this._bagMeshes(), ...this.items.map((i) => i.mesh)];
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
      const done = this.t >= this.stepCount;
      if (done) { this.t = this.stepCount; this.playing = false; }
      this._updateItems();
      if (this.follow && this.bags.length > 1) {
        // look at the bag being packed; show them all again at the end
        const want = done ? -1 : this.bagOfStep(Math.floor(this.t) + 1);
        if (want !== this._focusBag) this.frame(true, want);
      }
      this.dirty = true;
    }
    if (this.camera.update(dt)) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      const meshes = [...this._bagMeshes(), ...this.items.map((i) => i.mesh)];
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
