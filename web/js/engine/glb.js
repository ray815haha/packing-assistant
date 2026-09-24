// Minimal glTF 2.0 binary (.glb) loader for custom product models.
//
// Supports: triangle meshes, node hierarchies (matrix or TRS), indexed and
// non-indexed geometry, missing normals (computed), baseColorFactor and
// baseColorTexture (PNG/JPEG embedded in the .glb).
// Not supported: Draco/meshopt compression, skinning, morph targets. Export
// from Blender with File > Export > glTF 2.0, format "glTF Binary (.glb)" and
// compression off.

import { mat4 } from './math.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export async function loadGlb(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${url} is not a .glb file`);
  let offset = 12, json = null, bin = null;
  while (offset < buf.byteLength) {
    const len = dv.getUint32(offset, true), type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len)));
    else if (type === 0x004e4942) bin = buf.slice(start, start + len);
    offset = start + len;
  }
  if (!json) throw new Error('glb has no JSON chunk');
  const used = [...(json.extensionsRequired || [])];
  if (used.length) throw new Error(`glb needs unsupported extensions: ${used.join(', ')}`);

  const readAccessor = (index) => {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const n = COMPONENTS[acc.type];
    const T = TYPED[acc.componentType];
    const stride = view.byteStride || n * T.BYTES_PER_ELEMENT;
    const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const tight = stride === n * T.BYTES_PER_ELEMENT && (base % T.BYTES_PER_ELEMENT) === 0;
    if (tight && !acc.normalized) {
      // fast path: read the typed array straight out of the buffer
      return Float32Array.from(new T(bin, base, acc.count * n));
    }
    const out = new Float32Array(acc.count * n);
    const src = new DataView(bin);
    const get = {
      5120: (o) => src.getInt8(o), 5121: (o) => src.getUint8(o), 5122: (o) => src.getInt16(o, true),
      5123: (o) => src.getUint16(o, true), 5125: (o) => src.getUint32(o, true), 5126: (o) => src.getFloat32(o, true),
    }[acc.componentType];
    const norm = acc.normalized ? NORM[acc.componentType] : 0;
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < n; k++) {
        let v = get(base + i * stride + k * T.BYTES_PER_ELEMENT);
        if (norm) v = Math.max(v / norm, -1);
        out[i * n + k] = v;
      }
    }
    return out;
  };

  const images = await Promise.all((json.images || []).map(async (img) => {
    try {
      if (img.bufferView === undefined) return null;
      const v = json.bufferViews[img.bufferView];
      const blob = new Blob([new Uint8Array(bin, v.byteOffset || 0, v.byteLength)], { type: img.mimeType });
      return await createImageBitmap(blob);
    } catch (e) {
      console.warn('Could not decode a texture in', url, e);
      return null;
    }
  }));

  const nodeMatrix = (node) => {
    if (node.matrix) return new Float32Array(node.matrix);
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    const r = new Float32Array([
      1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
      2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
      2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
      0, 0, 0, 1,
    ]);
    return mat4.multiply(mat4.translation(tx, ty, tz), mat4.multiply(r, mat4.scaling(sx, sy, sz)));
  };

  const parts = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const world = mat4.multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (prim.attributes.POSITION === undefined) continue;
        const pos = readAccessor(prim.attributes.POSITION);
        const count = pos.length / 3;
        let idx = prim.indices !== undefined ? readAccessor(prim.indices) : Float32Array.from({ length: count }, (_, i) => i);
        let nrm = prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL) : computeNormals(pos, idx);
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(prim.attributes.TEXCOORD_0) : null;
        // bake the node transform into the vertices
        const nm = mat4.normalMatrix(world);
        const p2 = new Float32Array(pos.length), n2 = new Float32Array(pos.length);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
          const q = mat4.transformPoint(world, x, y, z);
          p2.set(q, i * 3);
          const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
          const nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          n2.set([nx / l, ny / l, nz / l], i * 3);
        }
        const mat = prim.material !== undefined ? json.materials[prim.material] : {};
        const pbr = mat.pbrMetallicRoughness || {};
        const factor = pbr.baseColorFactor || [0.8, 0.8, 0.8, 1];
        const texIndex = pbr.baseColorTexture ? json.textures[pbr.baseColorTexture.index].source : undefined;
        const rough = pbr.roughnessFactor ?? 0.6;
        parts.push({
          positions: p2, normals: n2, uvs: uv,
          indices: count > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx),
          baseColor: [...factor.slice(0, 3), Math.max(0.05, 1 - rough)],
          image: texIndex !== undefined ? images[texIndex] : null,
        });
      }
    }
    for (const c of node.children || []) visit(c, world);
  };
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
  for (const ni of scene.nodes) visit(ni, mat4.identity());
  if (!parts.length) throw new Error(`${url} contains no triangle meshes`);
  return parts;
}

function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * Fit loaded parts into an L x W x H box centred on the origin (Z up).
 * glTF is Y-up, so the model is first turned to Z-up; if its footprint is
 * turned the other way round from the item's, it is spun 90 degrees.
 */
export function fitParts(parts, L, W, H) {
  const toZup = (p) => [p[0], -p[2], p[1]];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const converted = parts.map((part) => {
    const P = new Float32Array(part.positions.length), N = new Float32Array(part.normals.length);
    for (let i = 0; i < P.length; i += 3) {
      const p = toZup([part.positions[i], part.positions[i + 1], part.positions[i + 2]]);
      const n = toZup([part.normals[i], part.normals[i + 1], part.normals[i + 2]]);
      P.set(p, i); N.set(n, i);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
    return { ...part, positions: P, normals: N };
  });
  let size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const swap = (size[0] >= size[1]) !== (L >= W);
  if (swap) size = [size[1], size[0], size[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const s = [L / (size[0] || 1), W / (size[1] || 1), H / (size[2] || 1)];
  for (const part of converted) {
    const P = part.positions, N = part.normals;
    for (let i = 0; i < P.length; i += 3) {
      let x = P[i] - center[0], y = P[i + 1] - center[1];
      const z = P[i + 2] - center[2];
      let nx = N[i], ny = N[i + 1];
      if (swap) { [x, y] = [-y, x]; [nx, ny] = [-ny, nx]; }
      P[i] = x * s[0]; P[i + 1] = y * s[1]; P[i + 2] = z * s[2];
      // non-uniform scale: normals scale by the inverse
      const a = nx / s[0], b = ny / s[1], c = N[i + 2] / s[2], l = Math.hypot(a, b, c) || 1;
      N[i] = a / l; N[i + 1] = b / l; N[i + 2] = c / l;
    }
  }
  return converted;
}
