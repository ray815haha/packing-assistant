// MeshBuilder: accumulates coloured triangles from simple primitives into one
// vertex buffer. Every product model is built from these pieces.
//
// Conventions: Z is up. A builder has a transform stack (translate / rotate /
// scale) and a current colour. Colours are [r, g, b] in 0..1 plus a "shine"
// value (0 = matte fabric, 1 = glossy plastic/metal) stored in the alpha slot.

import { mat4, hexToRgb } from './math.js';

const TAU = Math.PI * 2;
const spow = (v, e) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v) * Math.pow(Math.abs(v), e));

export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
    this.matrix = mat4.identity();
    this.stack = [];
    this._nm = null;
    this.rgba = [0.8, 0.8, 0.8, 0.2];
  }

  // -- state ---------------------------------------------------------------
  color(c, shine = 0.15) {
    const rgb = typeof c === 'string' ? hexToRgb(c) : c;
    this.rgba = [rgb[0], rgb[1], rgb[2], shine];
    return this;
  }
  push() { this.stack.push([this.matrix, this.rgba]); return this; }
  pop() { [this.matrix, this.rgba] = this.stack.pop(); this._nm = null; return this; }
  apply(m) { this.matrix = mat4.multiply(this.matrix, m); this._nm = null; return this; }
  translate(x, y, z) { return this.apply(mat4.translation(x, y, z)); }
  scale(x, y = x, z = x) { return this.apply(mat4.scaling(x, y, z)); }
  rotateX(deg) { return this.apply(mat4.rotationX((deg * Math.PI) / 180)); }
  rotateY(deg) { return this.apply(mat4.rotationY((deg * Math.PI) / 180)); }
  rotateZ(deg) { return this.apply(mat4.rotationZ((deg * Math.PI) / 180)); }

  get normalMatrix() {
    if (!this._nm) this._nm = mat4.normalMatrix(this.matrix);
    return this._nm;
  }

  _vertex(p, n) {
    const m = this.matrix, q = this.normalMatrix;
    this.positions.push(
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    );
    let nx = q[0] * n[0] + q[3] * n[1] + q[6] * n[2];
    let ny = q[1] * n[0] + q[4] * n[1] + q[7] * n[2];
    let nz = q[2] * n[0] + q[5] * n[1] + q[8] * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    this.normals.push(nx / l, ny / l, nz / l);
    this.colors.push(...this.rgba);
    return this.positions.length / 3 - 1;
  }

  /** Generic parametric surface. fn(u, v) returns [point, normal] with u, v in 0..1. */
  surface(fn, nu, nv, flip = false) {
    const base = this.positions.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const [p, n] = fn(i / nu, j / nv);
        this._vertex(p, flip ? [-n[0], -n[1], -n[2]] : n);
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
        if (flip) this.indices.push(a, c, b, b, c, d);
        else this.indices.push(a, b, c, b, d, c);
      }
    }
    return this;
  }

  // -- primitives ----------------------------------------------------------
  /**
   * Superellipsoid centred on the origin with half-extents (a, b, c).
   * e1 shapes the vertical profile, e2 the horizontal cross-section:
   * 1 = round, ~0.1 = boxy. It fills its bounding box exactly, which makes it
   * ideal for soft goods (folded clothes, pouches) and rounded hard goods.
   */
  superellipsoid(sx, sy, sz, e1 = 0.3, e2 = 0.3, nu = 40, nv = 20) {
    const a = sx / 2, b = sy / 2, c = sz / 2;
    const f = (x, y, z) =>
      Math.pow(Math.pow(Math.abs(x / a), 2 / e2) + Math.pow(Math.abs(y / b), 2 / e2), e2 / e1) +
      Math.pow(Math.abs(z / c), 2 / e1);
    return this.surface((u, v) => {
      const th = u * TAU - Math.PI, ph = v * Math.PI - Math.PI / 2;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const p = [a * spow(cp, e1) * spow(Math.cos(th), e2), b * spow(cp, e1) * spow(Math.sin(th), e2), c * spow(sp, e1)];
      // normal = gradient of the implicit function (numerically)
      const h = 1e-3 * Math.min(a, b, c);
      let n = [
        f(p[0] + h, p[1], p[2]) - f(p[0] - h, p[1], p[2]),
        f(p[0], p[1] + h, p[2]) - f(p[0], p[1] - h, p[2]),
        f(p[0], p[1], p[2] + h) - f(p[0], p[1], p[2] - h),
      ];
      if (!isFinite(n[0] + n[1] + n[2]) || Math.hypot(...n) < 1e-9) n = [p[0] / a, p[1] / b, p[2] / c];
      if (Math.abs(sp) > 0.9999) n = [0, 0, Math.sign(sp)];
      return [p, n];
    }, nu, nv);
  }

  /** Soft rounded box, the workhorse for most products. roundness 0..1. */
  softBox(sx, sy, sz, roundness = 0.3, sideRoundness = roundness) {
    const e1 = Math.max(0.06, Math.min(1, roundness));
    const e2 = Math.max(0.06, Math.min(1, sideRoundness));
    return this.superellipsoid(sx, sy, sz, e1, e2);
  }

  /** Sharp axis-aligned box (flat shaded). */
  box(sx, sy, sz) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const faces = [
      [[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, -y, z], [x, y, z]]],
      [[-1, 0, 0], [[-x, y, -z], [-x, -y, -z], [-x, y, z], [-x, -y, z]]],
      [[0, 1, 0], [[x, y, -z], [-x, y, -z], [x, y, z], [-x, y, z]]],
      [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [-x, -y, z], [x, -y, z]]],
      [[0, 0, 1], [[-x, -y, z], [x, -y, z], [-x, y, z], [x, y, z]]],
      [[0, 0, -1], [[-x, y, -z], [x, y, -z], [-x, -y, -z], [x, -y, -z]]],
    ];
    for (const [n, q] of faces) {
      const i0 = this._vertex(q[0], n), i1 = this._vertex(q[1], n), i2 = this._vertex(q[2], n), i3 = this._vertex(q[3], n);
      this.indices.push(i0, i1, i2, i1, i3, i2);
    }
    return this;
  }

  /** Cylinder / cone along Z, centred on the origin. */
  cylinder(r, h, { rTop = r, seg = 32, caps = true, arc = TAU } = {}) {
    const slope = (r - rTop) / h;
    this.surface((u, v) => {
      const t = u * arc, rr = r + (rTop - r) * v;
      const n = [Math.cos(t), Math.sin(t), slope];
      return [[rr * Math.cos(t), rr * Math.sin(t), -h / 2 + v * h], n];
    }, seg, 1);
    if (caps) {
      this.disc(rTop, h / 2, 1, seg, arc);
      this.disc(r, -h / 2, -1, seg, arc);
    }
    return this;
  }

  disc(r, z, dir = 1, seg = 32, arc = TAU) {
    const c = this._vertex([0, 0, z], [0, 0, dir]);
    const first = this.positions.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * arc;
      this._vertex([r * Math.cos(t), r * Math.sin(t), z], [0, 0, dir]);
    }
    for (let i = 0; i < seg; i++) {
      if (dir > 0) this.indices.push(c, first + i, first + i + 1);
      else this.indices.push(c, first + i + 1, first + i);
    }
    return this;
  }

  ellipsoid(sx, sy, sz, seg = 28) {
    return this.superellipsoid(sx, sy, sz, 1, 1, seg, Math.max(8, seg / 2));
  }

  sphere(r, seg = 20) {
    return this.ellipsoid(2 * r, 2 * r, 2 * r, seg);
  }

  /** Torus in the XY plane. `arc` in radians; `tube` may be [rz, rr] for an elliptic tube. */
  torus(R, tube, { arc = TAU, seg = 40, tubeSeg = 14, start = 0 } = {}) {
    const [tz, tr] = Array.isArray(tube) ? tube : [tube, tube];
    return this.surface((u, v) => {
      const t = start + u * arc, p = v * TAU;
      const cx = Math.cos(t), sy = Math.sin(t);
      const rr = R + tr * Math.cos(p);
      return [[rr * cx, rr * sy, tz * Math.sin(p)], [Math.cos(p) * cx / tr, Math.cos(p) * sy / tr, Math.sin(p) / tz]];
    }, seg, tubeSeg);
  }

  /** Tube of radius r following a polyline of [x, y, z] points. */
  tube(points, r, seg = 10) {
    const n = points.length;
    const frames = points.map((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(...t) || 1; t = t.map((x) => x / l);
      let up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let nx = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
      const ln = Math.hypot(...nx) || 1; nx = nx.map((x) => x / ln);
      const bx = [t[1] * nx[2] - t[2] * nx[1], t[2] * nx[0] - t[0] * nx[2], t[0] * nx[1] - t[1] * nx[0]];
      return [nx, bx];
    });
    return this.surface((u, v) => {
      const i = Math.round(v * (n - 1)), p = points[i], [nx, bx] = frames[i];
      const a = u * TAU, c = Math.cos(a), s = Math.sin(a);
      const d = [nx[0] * c + bx[0] * s, nx[1] * c + bx[1] * s, nx[2] * c + bx[2] * s];
      return [[p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r], d];
    }, seg, n - 1);
  }

  /** Upper half of an ellipsoid: base (z = 0) has size sx x sy, apex at z = sz. */
  dome(sx, sy, sz, { seg = 32, base = true, e = 1 } = {}) {
    const a = sx / 2, b = sy / 2;
    this.surface((u, v) => {
      const th = u * TAU, ph = v * (Math.PI / 2);
      const cp = spow(Math.cos(ph), e), sp = spow(Math.sin(ph), e);
      const p = [a * cp * Math.cos(th), b * cp * Math.sin(th), sz * sp];
      const n = [Math.cos(ph) * Math.cos(th) / a, Math.cos(ph) * Math.sin(th) / b, Math.sin(ph) / sz];
      return [p, n];
    }, seg, Math.max(6, seg / 3));
    if (base) {
      this.push().scale(1, b / a, 1).disc(a, 0, -1, seg).pop();
    }
    return this;
  }

  /** Flat panel lying on the XY plane (facing +Z), useful for labels and seams. */
  plate(sx, sy, thickness = 0.05) {
    return this.box(sx, sy, thickness);
  }

  /** Rectangular outline (e.g. stitching) on the XY plane. */
  frame(sx, sy, width = 0.2, thickness = 0.05) {
    this.push().translate(0, sy / 2 - width / 2, 0).box(sx, width, thickness).pop();
    this.push().translate(0, -sy / 2 + width / 2, 0).box(sx, width, thickness).pop();
    this.push().translate(sx / 2 - width / 2, 0, 0).box(width, sy - 2 * width, thickness).pop();
    this.push().translate(-sx / 2 + width / 2, 0, 0).box(width, sy - 2 * width, thickness).pop();
    return this;
  }

  build() {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: this.positions.length / 3 > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
    };
  }
}
