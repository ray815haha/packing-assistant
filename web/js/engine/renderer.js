// Small WebGL2 renderer: lit, vertex-coloured (or textured) meshes, a soft
// ground shadow, transparency, and an orbit camera. Z is up.

import { mat4 } from './math.js';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec2 aUv;
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
out vec3 vNormal; out vec4 vColor; out vec3 vWorld; out vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMat * aNormal;
  vColor = aColor;
  vUv = aUv;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal; in vec4 vColor; in vec3 vWorld; in vec2 vUv;
uniform vec3 uEye;
uniform float uAlpha;
uniform vec3 uTint;
uniform int uMode;          // 0 lit, 1 shadow blob, 2 unlit
uniform bool uHasTex;
uniform sampler2D uTex;
uniform float uShine;       // used when a texture provides the colour
out vec4 outColor;
void main() {
  if (uMode == 1) { outColor = vec4(0.0, 0.0, 0.0, vColor.r * uAlpha); return; }
  vec3 base = vColor.rgb;
  float shine = vColor.a;
  if (uHasTex) { vec4 t = texture(uTex, vUv); base *= pow(t.rgb, vec3(2.2)); shine = uShine; }
  else { base = pow(base, vec3(2.2)); }
  if (uMode == 2) { outColor = vec4(pow(base, vec3(1.0/2.2)), uAlpha); return; }
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  vec3 L1 = normalize(vec3(0.45, -0.65, 0.9));
  vec3 L2 = normalize(vec3(-0.7, 0.5, 0.35));
  vec3 sky = vec3(0.92, 0.95, 1.0), ground = vec3(0.42, 0.38, 0.34);
  vec3 amb = mix(ground, sky, n.z * 0.5 + 0.5) * 0.42;
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  vec3 col = base * (amb + d1 * vec3(1.0, 0.96, 0.9) * 0.85 + d2 * vec3(0.75, 0.82, 1.0) * 0.25);
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(n, H), 0.0), mix(12.0, 90.0, shine)) * shine * 0.9;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.12;
  col += vec3(spec) + rim * sky;
  col += uTint;
  col = col / (col + vec3(0.9)) * 1.9;           // gentle tone mapping
  outColor = vec4(pow(col, vec3(1.0/2.2)), uAlpha);
}`;

export class Mesh {
  constructor(gpu, matrix = mat4.identity()) {
    this.gpu = gpu;           // { vao, count, type }
    this.matrix = matrix;
    this.visible = true;
    this.alpha = 1;
    this.tint = [0, 0, 0];
    this.mode = 0;
    this.texture = null;
    this.shine = 0.2;
    this.depthWrite = true;
    this.children = null;     // optional list of sub-meshes (GLB models)
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.program = this._program(VS, FS);
    this.u = {};
    for (const name of ['uModel', 'uViewProj', 'uNormalMat', 'uEye', 'uAlpha', 'uTint', 'uMode', 'uHasTex', 'uTex', 'uShine']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    this.clearColor = [0.93, 0.94, 0.95];
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  _program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /** Upload geometry ({positions, normals, colors?, uvs?, indices}) and return a Mesh. */
  createMesh(geom, matrix) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (loc, data, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    const buffers = [buf(0, geom.positions, 3), buf(1, geom.normals, 3)];
    if (geom.colors) buffers.push(buf(2, geom.colors, 4));
    if (geom.uvs) buffers.push(buf(3, geom.uvs, 2));
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    buffers.push(ib);
    const type = geom.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const mesh = new Mesh({ vao, count: geom.indices.length, type, buffers, hasColors: !!geom.colors, hasUvs: !!geom.uvs, baseColor: geom.baseColor }, matrix);
    return mesh;
  }

  createTexture(image) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }

  disposeMesh(mesh) {
    const gl = this.gl;
    const all = mesh.children ? mesh.children : [mesh];
    for (const m of all) {
      if (!m.gpu) continue;
      gl.deleteVertexArray(m.gpu.vao);
      for (const b of m.gpu.buffers || []) gl.deleteBuffer(b);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(meshes, camera) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.clearColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const aspect = this.canvas.width / this.canvas.height;
    const { viewProj, eye } = camera.matrices(aspect);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform3fv(this.u.uEye, eye);
    gl.uniform1i(this.u.uTex, 0);

    const flat = [];
    const collect = (m, parent) => {
      if (!m.visible) return;
      const world = parent ? mat4.multiply(parent.world, m.matrix) : m.matrix;
      const alpha = (parent ? parent.alpha : 1) * m.alpha;
      const tint = parent && !m.tint.some((x) => x) ? parent.tint : m.tint;
      if (m.gpu) flat.push({ m, world, alpha, tint });
      if (m.children) for (const c of m.children) collect(c, { world, alpha, tint });
    };
    for (const m of meshes) collect(m, null);

    const opaque = flat.filter((d) => d.alpha >= 0.999 && d.m.mode !== 1);
    const blended = flat.filter((d) => d.alpha < 0.999 || d.m.mode === 1);
    blended.sort((a, b) => dist2(b.world, eye) - dist2(a.world, eye));

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const d of opaque) this._draw(d);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const d of blended) {
      gl.depthMask(d.m.depthWrite && d.m.mode !== 1);
      this._draw(d);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _draw({ m, world, alpha, tint }) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uModel, false, world);
    gl.uniformMatrix3fv(this.u.uNormalMat, false, mat4.normalMatrix(world));
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.uniform3fv(this.u.uTint, tint);
    gl.uniform1i(this.u.uMode, m.mode);
    gl.uniform1i(this.u.uHasTex, m.texture ? 1 : 0);
    gl.uniform1f(this.u.uShine, m.shine);
    if (m.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.texture);
    }
    gl.bindVertexArray(m.gpu.vao);
    if (!m.gpu.hasColors) gl.vertexAttrib4f(2, ...(m.gpu.baseColor || [0.8, 0.8, 0.8, 0.2]));
    if (!m.gpu.hasUvs) gl.vertexAttrib2f(3, 0, 0);
    gl.drawElements(gl.TRIANGLES, m.gpu.count, m.gpu.type, 0);
    gl.bindVertexArray(null);
  }
}

function dist2(world, eye) {
  const dx = world[12] - eye[0], dy = world[13] - eye[1], dz = world[14] - eye[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Orbit camera around a target point, Z up. Distances in scene units (cm). */
export class OrbitCamera {
  constructor({ target = [0, 0, 0], distance = 150, azimuth = -55, elevation = 38, fov = 38 } = {}) {
    this.target = [...target];
    this.distance = distance;
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.fov = fov;
    this.goal = null;
  }

  get eye() {
    const az = (this.azimuth * Math.PI) / 180, el = (this.elevation * Math.PI) / 180;
    return [
      this.target[0] + this.distance * Math.cos(el) * Math.cos(az),
      this.target[1] + this.distance * Math.cos(el) * Math.sin(az),
      this.target[2] + this.distance * Math.sin(el),
    ];
  }

  matrices(aspect) {
    const eye = this.eye;
    const view = mat4.lookAt(eye, this.target, [0, 0, 1]);
    const proj = mat4.perspective((this.fov * Math.PI) / 180, aspect, 1, 5000);
    return { viewProj: mat4.multiply(proj, view), eye };
  }

  /** Smoothly move towards a new framing. */
  animateTo(goal) { this.goal = goal; }

  update(dt) {
    if (!this.goal) return false;
    const k = 1 - Math.pow(0.001, dt);
    let moving = false;
    for (const key of ['distance', 'azimuth', 'elevation']) {
      if (this.goal[key] === undefined) continue;
      const d = this.goal[key] - this[key];
      if (Math.abs(d) > 0.01) moving = true;
      this[key] += d * k;
    }
    if (this.goal.target) {
      for (let i = 0; i < 3; i++) {
        const d = this.goal.target[i] - this.target[i];
        if (Math.abs(d) > 0.01) moving = true;
        this.target[i] += d * k;
      }
    }
    if (!moving) this.goal = null;
    return true;
  }

  attach(el, onChange) {
    let mode = null, lx = 0, ly = 0;
    const pointers = new Map();
    let pinch = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      mode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      lx = e.clientX; ly = e.clientY;
      this.goal = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.distance = Math.max(30, Math.min(800, this.distance * (pinch / d)));
        pinch = d;
        onChange();
        return;
      }
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 'orbit') {
        this.azimuth -= dx * 0.4;
        this.elevation = Math.max(5, Math.min(89, this.elevation + dy * 0.3));
      } else if (mode === 'pan') {
        const az = (this.azimuth * Math.PI) / 180;
        const s = this.distance * 0.0016;
        this.target[0] += (Math.sin(az) * dx - Math.cos(az) * dy * 0) * s;
        this.target[1] += (-Math.cos(az) * dx) * s;
        this.target[2] += dy * s;
      }
      onChange();
    });
    const end = (e) => { pointers.delete(e.pointerId); pinch = 0; mode = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.goal = null;
      this.distance = Math.max(30, Math.min(800, this.distance * Math.exp(e.deltaY * 0.001)));
      onChange();
    }, { passive: false });
  }
}
