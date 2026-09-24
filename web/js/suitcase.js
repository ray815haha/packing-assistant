// Procedural open hard-shell suitcase. Inner packing space is L x W x H with
// its front-left-bottom inner corner at the origin (same frame as the optimiser).

import { MeshBuilder } from './engine/geometry.js';
import { hexToRgb, shade, mix } from './engine/math.js';

const T = 1.6; // shell thickness (cm)

export function buildSuitcase(renderer, L, W, H, shellHex = '#2f4858') {
  const shell = hexToRgb(shellHex);
  const lining = mix(shell, [0.85, 0.83, 0.8], 0.75);
  const out = { walls: [], solid: [] };

  // floor (solid) -------------------------------------------------------------
  const floor = new MeshBuilder();
  floor.push().color(shade(shell, 0.9), 0.35).translate(L / 2, W / 2, -T / 2).softBox(L + 2 * T, W + 2 * T, T, 0.25, 0.1).pop();
  floor.push().color(lining, 0.02).translate(L / 2, W / 2, 0.03).box(L, W, 0.05).pop();
  // spinner wheels on the left end (the case is lying on its back)
  for (const y of [3.5, W - 3.5]) {
    floor.push().color([0.12, 0.12, 0.13], 0.3).translate(-T - 2.2, y, -T + 2.2).rotateX(90).cylinder(2.2, 2.0, { seg: 20 }).pop();
    floor.push().color([0.3, 0.3, 0.32], 0.6).translate(-T - 1.2, y, -T + 3.4).box(2.4, 3, 1.2).pop();
  }
  out.solid.push(renderer.createMesh(floor.build()));

  // walls (can turn see-through) -------------------------------------------------
  const wall = (x, y, sx, sy, isFront) => {
    const b = new MeshBuilder();
    b.color(shell, 0.45).translate(x, y, H / 2).softBox(sx, sy, H, 0.12, 0.15);
    // horizontal ribs on the outside
    // two moulded ribs along the outside of each long wall
    if (sx > sy) {
      for (const k of [0.3, 0.7]) {
        b.push().color(shade(shell, 0.85), 0.5).translate(0, isFront ? -T / 2 : T / 2, H * (k - 0.5)).box(sx * 0.96, 0.3, 0.8).pop();
      }
    }
    const m = renderer.createMesh(b.build());
    out.walls.push(m);
  };
  wall(L / 2, -T / 2, L + 2 * T, T, true);        // front (y = 0)
  wall(L / 2, W + T / 2, L + 2 * T, T, false);    // back
  wall(-T / 2, W / 2, T, W, false);               // left
  wall(L + T / 2, W / 2, T, W, false);            // right

  // rim with zip and ribs, always solid so the outline stays readable
  const rim = new MeshBuilder();
  rim.color(shade(shell, 0.55), 0.4);
  rim.push().translate(L / 2, -T / 2, H - 0.2).box(L + 2 * T, T, 0.4).pop();
  rim.push().translate(L / 2, W + T / 2, H - 0.2).box(L + 2 * T, T, 0.4).pop();
  rim.push().translate(-T / 2, W / 2, H - 0.2).box(T, W + 2 * T, 0.4).pop();
  rim.push().translate(L + T / 2, W / 2, H - 0.2).box(T, W + 2 * T, 0.4).pop();
  // zip running along the rim
  rim.color([0.12, 0.12, 0.13], 0.5);
  rim.push().translate(L / 2, -T / 2, H + 0.05).box(L + 2 * T, 0.5, 0.12).pop();
  rim.push().translate(L + T / 2, W / 2, H + 0.05).box(0.5, W + 2 * T, 0.12).pop();
  rim.push().translate(-T / 2, W / 2, H + 0.05).box(0.5, W + 2 * T, 0.12).pop();
  // carry handle on the front wall
  rim.color([0.1, 0.1, 0.11], 0.35).push().translate(L / 2, -T - 0.9, H * 0.55).rotateX(90).scale(1, 0.5, 1)
    .torus(7, [0.9, 0.9], { start: 0, arc: Math.PI, seg: 20, tubeSeg: 8 }).pop();
  // telescopic handle housing on the left end
  rim.color([0.25, 0.26, 0.28], 0.8).push().translate(-T - 0.6, W / 2, H / 2).box(1.2, Math.min(W * 0.6, 22), H * 0.9).pop();
  out.solid.push(renderer.createMesh(rim.build()));

  // open lid lying behind the case, hinged along the back edge ------------------
  const lid = new MeshBuilder();
  const lidDepth = Math.max(4, H * 0.35);
  lid.translate(L / 2, W + T + lidDepth / 2 + 0.3, -T / 2);
  // lid lies flat on the floor behind the case, inside facing up
  lid.push().color(shade(shell, 0.95), 0.45).translate(0, (W + 2 * T) / 2 - lidDepth / 2, 0)
    .softBox(L + 2 * T, W + 2 * T, T, 0.25, 0.1).pop();
  lid.push().color(shell, 0.45).translate(0, (W + 2 * T) / 2 - lidDepth / 2, lidDepth / 2)
    .frame(L + 2 * T, W + 2 * T, T, lidDepth).pop();
  lid.push().color(lining, 0.02).translate(0, (W + 2 * T) / 2 - lidDepth / 2, T / 2 + 0.03).box(L, W, 0.05).pop();
  // mesh divider panel with a zip
  lid.push().color(mix(lining, [0.2, 0.2, 0.22], 0.5), 0.05).translate(0, (W + 2 * T) / 2 - lidDepth / 2, T / 2 + 0.15)
    .box(L * 0.92, W * 0.86, 0.1).pop();
  lid.push().color([0.1, 0.1, 0.11], 0.3).translate(0, (W + 2 * T) / 2 - lidDepth / 2 + W * 0.3, T / 2 + 0.3)
    .box(L * 0.85, 0.7, 0.15).pop();
  for (const s of [-1, 1]) {
    lid.push().color([0.2, 0.2, 0.22], 0.2).translate(s * L * 0.3, (W + 2 * T) / 2 - lidDepth / 2 - W * 0.15, T / 2 + 0.35)
      .box(2.5, W * 0.5, 0.2).pop();
  }
  const lidMesh = renderer.createMesh(lid.build());
  out.solid.push(lidMesh);

  // soft ground shadow -------------------------------------------------------------
  out.shadow = shadowBlob(renderer, L / 2, W / 2 + (W + lidDepth) * 0.25, Math.max(L, W) * 1.25, (W + lidDepth) * 1.35 + W * 0.3);
  out.floorZ = -T;
  out.shadow.matrix[14] = out.floorZ + 0.05;
  return out;
}

function shadowBlob(renderer, cx, cy, sx, sy) {
  const b = new MeshBuilder();
  const rings = 14, seg = 48;
  const pos = [], nrm = [], col = [], idx = [];
  pos.push(cx, cy, 0); nrm.push(0, 0, 1); col.push(0.3, 0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    const a = 0.3 * Math.pow(1 - t, 1.6);
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      pos.push(cx + Math.cos(th) * sx / 2 * t, cy + Math.sin(th) * sy / 2 * t, 0);
      nrm.push(0, 0, 1);
      col.push(a, 0, 0, 0);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + ((i + 1) % seg));
  for (let r = 1; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = 1 + (r - 1) * seg + i, bb = 1 + (r - 1) * seg + ((i + 1) % seg);
      const c = a + seg, d = bb + seg;
      idx.push(a, c, bb, bb, c, d);
    }
  }
  void b;
  const m = renderer.createMesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint16Array(idx) });
  m.mode = 1;
  m.depthWrite = false;
  return m;
}

export function buildGround(renderer, cx, cy, z) {
  const b = new MeshBuilder();
  b.color([0.9, 0.91, 0.92], 0.0).translate(cx, cy, z - 0.5).cylinder(900, 1, { seg: 64 });
  const m = renderer.createMesh(b.build());
  m.mode = 2;
  return m;
}
