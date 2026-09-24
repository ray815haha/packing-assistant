// Procedural product models.
//
// Every builder draws one product centred on the origin, filling a box of
// L (x) x W (y) x H (z) centimetres: exactly the size the optimiser packs.
// Z is up; for folded clothes the collar / waistband end is at +x, and for
// shoes the toes point to +x.
//
// To use a real 3D model for an item instead, drop "<item id>.glb" into
// web/models/ (see glb.js); these builders are the fallback.

import { MeshBuilder } from './engine/geometry.js';
import { hexToRgb, shade, mix } from './engine/math.js';

const WHITE = [0.96, 0.96, 0.95];
const OFFWHITE = [0.93, 0.91, 0.86];
const BLACK = [0.07, 0.07, 0.08];
const METAL = [0.78, 0.79, 0.82];
const GOLD = [0.85, 0.68, 0.32];
const COPPER = [0.78, 0.5, 0.28];
const RUBBER = [0.16, 0.16, 0.17];

function palette(hex) {
  const base = hexToRgb(hex || '#8899aa');
  const lum = 0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2];
  return {
    base,
    dark: shade(base, 0.72),
    darker: shade(base, 0.5),
    light: mix(base, [1, 1, 1], 0.35),
    contrast: lum > 0.6 ? shade(base, 0.45) : mix(base, [1, 1, 1], 0.6),
    lum,
  };
}

// --------------------------------------------------------------------------- //
// Shared pieces
// --------------------------------------------------------------------------- //

/** Folded garment body: two stacked soft layers so the fold shows on the sides. */
function foldedBody(b, L, W, H, c, { layers = 2, soft = 0.45, inset = 0.06 } = {}) {
  const lh = H / layers;
  for (let i = 0; i < layers; i++) {
    const k = 1 - inset * i;
    b.push().color(i % 2 ? c.base : shade(c.base, 0.94), 0.05)
      .translate(-L * (1 - k) * 0.3 * (i ? 1 : 0), 0, -H / 2 + lh * (i + 0.5))
      .softBox(L * k, W * (1 - inset * 0.5 * i), lh * 1.02, soft, 0.16).pop();
  }
  return H / 2; // top z
}

function line(b, x, y, z, lx, ly, color, t = 0.08, shine = 0.05) {
  b.push().color(color, shine).translate(x, y, z).box(lx, ly, t).pop();
}

function stitchFrame(b, x, y, z, lx, ly, color, w = 0.18) {
  b.push().color(color, 0.05).translate(x, y, z).frame(lx, ly, w, 0.06).pop();
}

function button(b, x, y, z, r, color) {
  b.push().color(color, 0.5).translate(x, y, z).cylinder(r, 0.12, { seg: 14 }).pop();
}

function zipperLine(b, x, y, z, len, alongX = true, color = BLACK) {
  b.push().color(color, 0.3).translate(x, y, z);
  if (!alongX) b.rotateZ(90);
  b.box(len, 0.7, 0.14);
  b.color(METAL, 0.9).translate(0, 0, 0.06).box(len, 0.16, 0.08);
  b.pop();
}

function zipperPull(b, x, y, z) {
  b.push().color(METAL, 0.9).translate(x, y, z).box(1.0, 0.7, 0.3)
    .translate(-1.2, 0, 0).softBox(1.8, 0.8, 0.25, 0.3).pop();
}

/** Lying cylinder-ish roll along x (rolled clothes, towels). */
function rollBody(b, L, W, H, color, shine = 0.05, flat = 0.3) {
  b.push().color(color, shine).rotateY(90).superellipsoid(H, W, L, flat, 1, 36, 18).pop();
}

function rollEnd(b, L, W, H, color) {
  const r = Math.min(W, H) / 2;
  for (const k of [0.75, 0.5, 0.25]) {
    b.push().color(color, 0.05).translate(L / 2 - 0.05, 0, 0).rotateY(90)
      .torus(r * k, [0.12, 0.12], { seg: 30, tubeSeg: 6 }).pop();
  }
}

// --------------------------------------------------------------------------- //
// Clothing
// --------------------------------------------------------------------------- //
function tshirt(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c);
  const R = W * 0.2;
  // ribbed collar (half ring) and the neck opening
  b.push().color(c.dark, 0.05).translate(L / 2 - R * 0.9, 0, top - 0.2)
    .torus(R, [0.3, 0.55], { start: Math.PI / 2, arc: Math.PI, seg: 24, tubeSeg: 10 }).pop();
  b.push().color(c.darker, 0.02).translate(L / 2 - R * 0.95, 0, top - 0.25).scale(0.55, 1, 1)
    .cylinder(R * 0.85, 0.1, { seg: 24, arc: Math.PI, caps: true }).pop();
  // sleeve folds and hem
  for (const s of [-1, 1]) line(b, -L * 0.05, s * W * 0.3, top - 0.03, L * 0.72, 0.25, c.dark);
  line(b, -L / 2 + 1.2, 0, top - 0.03, 0.3, W * 0.85, c.dark);
}

function polo(b, L, W, H, c) {
  tshirt(b, L, W, H, c);
  const top = H / 2;
  // collar flaps + placket + buttons
  for (const s of [-1, 1]) {
    b.push().color(c.light, 0.05).translate(L / 2 - W * 0.22, s * W * 0.1, top + 0.05).rotateZ(s * 35)
      .softBox(W * 0.24, W * 0.12, 0.35, 0.4, 0.2).pop();
  }
  line(b, L / 2 - W * 0.42, 0, top + 0.02, W * 0.22, 1.2, c.dark, 0.12);
  for (const k of [0.34, 0.46]) button(b, L / 2 - W * k, 0, top + 0.1, 0.35, WHITE);
}

function dressShirt(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { layers: 3 });
  // collar
  b.push().color(shade(c.base, 1.04), 0.08).translate(L / 2 - W * 0.12, 0, top - 0.3)
    .torus(W * 0.14, [0.45, 0.6], { start: Math.PI / 2, arc: Math.PI, seg: 24 }).pop();
  for (const s of [-1, 1]) {
    b.push().color(shade(c.base, 1.02), 0.08).translate(L / 2 - W * 0.22, s * W * 0.09, top - 0.1).rotateZ(s * 30)
      .softBox(W * 0.22, W * 0.11, 0.3, 0.3, 0.2).pop();
  }
  // placket with buttons
  line(b, -L * 0.1, 0, top - 0.02, L * 0.62, 1.6, shade(c.base, 0.9), 0.1);
  for (let i = 0; i < 5; i++) button(b, L * 0.18 - i * L * 0.12, 0, top + 0.06, 0.4, OFFWHITE);
  // pocket
  stitchFrame(b, L * 0.1, W * 0.22, top, 5, 4.5, shade(c.base, 0.85));
}

function sweater(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.6 });
  // knit ribs across the body
  for (let x = -L / 2 + 4; x < L / 2 - 5; x += 1.4) {
    b.push().color(shade(c.base, 1.06), 0.02).translate(x, 0, top - 0.2).rotateX(90)
      .cylinder(0.2, W * 0.78, { seg: 6, caps: true }).pop();
  }
  // ribbed collar and hem band
  b.push().color(c.dark, 0.03).translate(L / 2 - W * 0.2, 0, top - 0.3)
    .torus(W * 0.18, [0.4, 0.8], { start: Math.PI / 2, arc: Math.PI, seg: 24 }).pop();
  line(b, -L / 2 + 3, 0, top - 0.05, 2.2, W * 0.8, c.dark, 0.15);
}

function hoodie(b, L, W, H, c) {
  const bodyH = H * 0.7;
  b.push().translate(0, 0, -H / 2 + bodyH / 2);
  foldedBody(b, L, W, bodyH, c, { soft: 0.55 });
  b.pop();
  const top = -H / 2 + bodyH;
  // hood lying on top at the collar end
  b.push().color(shade(c.base, 0.95), 0.04).translate(L / 2 - L * 0.2, 0, top - 0.4)
    .dome(L * 0.34, W * 0.7, H - bodyH + 0.4, { e: 0.55 }).pop();
  b.push().color(c.darker, 0.02).translate(L / 2 - L * 0.2, 0, top + (H - bodyH) * 0.55)
    .scale(1, 1.4, 1).cylinder(L * 0.08, 0.2, { seg: 20 }).pop();
  // drawstrings
  for (const s of [-1, 1]) {
    const y = s * W * 0.12;
    b.push().color(WHITE, 0.1).tube([[L * 0.2, y, top + 0.3], [L * 0.02, y * 1.2, top + 0.3], [-L * 0.1, y * 1.1, top + 0.3]], 0.28, 8).pop();
    b.push().color(METAL, 0.8).translate(-L * 0.12, y * 1.1, top + 0.3).rotateY(90).cylinder(0.35, 1.2, { seg: 10 }).pop();
  }
  // kangaroo pocket
  stitchFrame(b, -L * 0.22, 0, top + 0.02, L * 0.26, W * 0.55, c.dark, 0.3);
}

function jacket(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.5 });
  zipperLine(b, -L * 0.02, 0, top - 0.05, L * 0.9);
  // standing collar
  b.push().color(c.dark, 0.1).translate(L / 2 - 1.2, 0, top - 0.6).softBox(2.2, W * 0.5, 1.4, 0.4, 0.3).pop();
  zipperPull(b, L / 2 - 3.2, 0, top + 0.12);
  for (const s of [-1, 1]) {
    b.push().color(c.dark, 0.05).translate(-L * 0.15, s * W * 0.27, top - 0.02).rotateZ(s * 12).box(L * 0.22, 0.35, 0.12).pop();
  }
}

function puffer(b, L, W, H, c) {
  // packable jacket stuffed in its own pouch, quilted baffles
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L / n) * (i + 0.5);
    b.push().color(i % 2 ? c.base : shade(c.base, 0.93), 0.35).translate(x, 0, 0)
      .softBox(L / n + 1.2, W, H, 0.6, 0.35).pop();
  }
  // drawstring toggle
  b.push().color(BLACK, 0.2).translate(L / 2 - 0.8, 0, H * 0.2).softBox(1.2, 1.4, 1.8, 0.4).pop();
  b.push().color(c.contrast, 0.1).translate(0, -W / 2 + 0.05, 0).box(4, 0.1, 2).pop();
}

function blazer(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.35, layers: 3 });
  // lapels forming a V
  for (const s of [-1, 1]) {
    b.push().color(shade(c.base, 0.85), 0.2).translate(L * 0.22, s * W * 0.12, top + 0.05).rotateZ(s * 20)
      .box(L * 0.45, W * 0.12, 0.2).pop();
  }
  // lining visible in the V
  b.push().color([0.55, 0.12, 0.18], 0.4).translate(L * 0.3, 0, top - 0.03).rotateZ(90).scale(0.8, 1, 1)
    .cylinder(W * 0.1, 0.1, { seg: 3 }).pop();
  for (const k of [-0.05, -0.2]) button(b, L * k, 0, top + 0.08, 0.7, BLACK);
  // pocket flaps
  for (const s of [-1, 1]) line(b, -L * 0.28, s * W * 0.28, top, L * 0.2, 1.4, c.dark, 0.18);
}

function jeans(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.4 });
  const stitch = c.lum < 0.5 ? [0.85, 0.62, 0.3] : shade(c.base, 0.7);
  // waistband with belt loops at the +x end
  line(b, L / 2 - 3.2, 0, top - 0.02, 3.2, W * 0.86, c.dark, 0.14);
  for (const y of [-0.36, -0.12, 0.12, 0.36]) line(b, L / 2 - 3.2, y * W, top + 0.08, 3.4, 0.8, c.dark, 0.14);
  button(b, L / 2 - 3.2, 0, top + 0.16, 0.6, COPPER);
  // back pockets with stitching, and a centre seam
  for (const s of [-1, 1]) {
    stitchFrame(b, L * 0.08, s * W * 0.22, top, L * 0.3, W * 0.3, stitch);
    b.push().color(COPPER, 0.8).translate(L * 0.22, s * W * 0.35, top + 0.08).sphere(0.3, 8).pop();
  }
  line(b, -L * 0.05, 0, top, L * 0.8, 0.18, stitch);
}

function shorts(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.4 });
  line(b, L / 2 - 2.8, 0, top - 0.02, 2.8, W * 0.86, c.dark, 0.14);
  // drawcord
  for (const s of [-1, 1]) {
    b.push().color(WHITE, 0.1).tube([[L / 2 - 1.6, s * 0.6, top + 0.15], [L / 2 - 4, s * 1.8, top + 0.15], [L / 2 - 6, s * 1.5, top + 0.15]], 0.22, 6).pop();
  }
  for (const s of [-1, 1]) stitchFrame(b, -L * 0.05, s * W * 0.22, top, L * 0.3, W * 0.28, c.dark);
}

function dress(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.5 });
  line(b, L * 0.1, 0, top, 1.0, W * 0.9, c.dark, 0.12);
  // polka dots
  for (let x = -L / 2 + 3; x < L / 2 - 2; x += 3.5) {
    for (let y = -W / 2 + 3; y < W / 2 - 2; y += 3.5) {
      const off = (Math.round((x + L) / 3.5) % 2) * 1.75;
      if (y + off > W / 2 - 2) continue;
      b.push().color(WHITE, 0.05).translate(x, y + off, top - 0.02).cylinder(0.6, 0.1, { seg: 12 }).pop();
    }
  }
  // straps
  for (const s of [-1, 1]) line(b, L / 2 - 2.5, s * W * 0.18, top + 0.05, 4.5, 0.9, c.dark, 0.12);
}

function swimsuit(b, L, W, H, c) {
  const top = foldedBody(b, L, W, H, c, { soft: 0.6 });
  for (const k of [-0.2, 0.05, 0.3]) line(b, k * L, 0, top, 1.1, W * 0.9, c.contrast, 0.1);
}

function roll(b, L, W, H, c) {
  rollBody(b, L, W, H, c.base, 0.05, 0.28);
  rollEnd(b, L, W, H, c.dark);
  // a contrasting band (waistband / cuff)
  b.push().color(c.contrast, 0.05).translate(-L * 0.3, 0, 0).rotateY(90).scale(H / 2 * 1.005, W / 2 * 1.005, 1)
    .cylinder(1, Math.min(2, L * 0.12), { seg: 28, caps: false }).pop();
}

function socks(b, L, W, H, c) {
  const n = 1;
  for (let i = 0; i <= n; i++) {
    const x = -L / 4 + i * L / 2;
    b.push().color(i ? c.base : shade(c.base, 0.95), 0.02).translate(x, 0, 0)
      .softBox(L / 2 * 1.02, W, H, 0.8, 0.8).pop();
  }
  // cuff ribbing
  b.push().color(c.contrast, 0.02).translate(L / 2 - 1.5, 0, 0).rotateY(90).scale(H / 2 * 0.92, W / 2 * 0.92, 1)
    .cylinder(1, 1.4, { seg: 24 }).pop();
  for (const k of [0.33, 0.66]) {
    b.push().color(c.contrast, 0.02).translate(-L / 4, 0, 0).rotateY(90).scale(H / 2 * (1.0 - 0.08 * k), W / 2 * 1.0, 1)
      .translate(0, 0, (k - 0.5) * 2).cylinder(1, 0.4, { seg: 24, caps: false }).pop();
  }
}

function cap(b, L, W, H, c) {
  const brimT = 0.5;
  const crownL = L * 0.72;
  const cx = -L / 2 + crownL / 2;
  b.push().color(c.base, 0.1).translate(cx, 0, -H / 2 + brimT).dome(crownL, W, H - brimT - 0.4).pop();
  // seams over the crown
  for (const a of [0, 60, -60]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      const ang = (a * Math.PI) / 180;
      const r = Math.cos(t - Math.PI / 2);
      pts.push([cx + (crownL / 2) * Math.cos(t) * Math.cos(ang) * 1.01, (W / 2) * Math.cos(t) * Math.sin(ang) * 1.01,
        -H / 2 + brimT + (H - brimT - 0.4) * Math.sin(t) * 1.01]);
      void r;
    }
    b.push().color(c.dark, 0.1).tube(pts, 0.12, 5).pop();
  }
  b.push().color(c.dark, 0.2).translate(cx, 0, H / 2 - 0.35).sphere(0.55, 10).pop();
  // brim sticking out to +x
  b.push().color(c.dark, 0.1).translate(L / 2 - L * 0.28, 0, -H / 2 + brimT / 2)
    .superellipsoid(L * 0.56, W * 0.92, brimT, 0.3, 0.9).pop();
  b.push().color(c.contrast, 0.05).translate(cx - crownL * 0.05, 0, -H / 2 + brimT + 0.4).scale(0.1, 1, 1).box(1, W * 0.4, 0.6).pop();
}

function sunHat(b, L, W, H, c) {
  const brimT = 0.6;
  b.push().color(c.base, 0.05).translate(0, 0, -H / 2 + brimT / 2).superellipsoid(L, W, brimT, 0.4, 1, 48, 10).pop();
  // woven rings on the brim
  for (const k of [0.62, 0.8]) {
    b.push().color(shade(c.base, 0.92), 0.03).translate(0, 0, -H / 2 + brimT).scale(1, W / L, 1)
      .torus((L / 2) * k, [0.1, 0.25], { seg: 48, tubeSeg: 5 }).pop();
  }
  const crownD = Math.min(L, W) * 0.52;
  b.push().color(shade(c.base, 1.02), 0.05).translate(0, 0, -H / 2 + brimT).dome(crownD, crownD, H - brimT, { e: 0.6 }).pop();
  b.push().color([0.2, 0.2, 0.22], 0.15).translate(0, 0, -H / 2 + brimT + 1.0)
    .cylinder(crownD / 2 * 1.01, 1.6, { seg: 40, caps: false }).pop();
}

// --------------------------------------------------------------------------- //
// Shoes (built one at a time, drawn as a pair)
// --------------------------------------------------------------------------- //
function shoe(b, L, W, H, c, style) {
  const z0 = -H / 2;
  if (style === 'sneaker') {
    const soleH = H * 0.25;
    b.push().color(WHITE, 0.2).translate(0, 0, z0 + soleH / 2).softBox(L, W, soleH, 0.35, 0.55).pop();
    b.push().color(RUBBER, 0.1).translate(0, 0, z0 + 0.25).softBox(L * 0.98, W * 0.96, 0.5, 0.3, 0.55).pop();
    // heel section (tall) and toe box (low)
    b.push().color(c.base, 0.25).translate(-L * 0.2, 0, z0 + soleH * 0.8 + (H * 0.72) / 2).softBox(L * 0.58, W * 0.9, H * 0.72, 0.55, 0.6).pop();
    b.push().color(c.base, 0.25).translate(L * 0.2, 0, z0 + soleH * 0.8 + (H * 0.42) / 2).softBox(L * 0.62, W * 0.86, H * 0.42, 0.7, 0.7).pop();
    // toe cap and heel counter in an accent colour
    b.push().color(c.light, 0.2).translate(L * 0.4, 0, z0 + soleH + H * 0.08).softBox(L * 0.22, W * 0.8, H * 0.2, 0.6, 0.8).pop();
    b.push().color(c.contrast, 0.3).translate(-L * 0.4, 0, z0 + soleH + H * 0.25).softBox(L * 0.2, W * 0.92, H * 0.45, 0.5, 0.7).pop();
    // collar opening
    b.push().color(BLACK, 0.05).translate(-L * 0.28, 0, H / 2 - 0.35).softBox(L * 0.3, W * 0.56, 0.6, 0.4, 0.8).pop();
    // tongue with laces, sloping down towards the toes
    b.push().translate(L * 0.02, 0, z0 + soleH + H * 0.5).rotateY(-22);
    b.color(c.dark, 0.1).softBox(L * 0.36, W * 0.46, 1.2, 0.4, 0.4);
    for (let i = 0; i < 5; i++) b.push().color(WHITE, 0.1).translate(L * 0.13 - i * L * 0.065, 0, 0.62).box(0.45, W * 0.48, 0.25).pop();
    b.pop();
    return;
  }
  if (style === 'dress') {
    b.push().color([0.13, 0.08, 0.05], 0.3).translate(0, 0, z0 + 0.5).softBox(L, W, 1.0, 0.3, 0.5).pop();
    b.push().color([0.13, 0.08, 0.05], 0.3).translate(-L * 0.38, 0, z0 + 1.2).softBox(L * 0.22, W * 0.8, 2.4, 0.2, 0.4).pop();
    b.push().color(c.base, 0.85).translate(-L * 0.08, 0, z0 + 1 + H * 0.6 / 2).softBox(L * 0.8, W * 0.92, H * 0.6, 0.6, 0.55).pop();
    b.push().color(c.base, 0.85).translate(L * 0.28, 0, z0 + 1 + H * 0.38 / 2).softBox(L * 0.44, W * 0.8, H * 0.38, 0.7, 0.9).pop();
    b.push().color(BLACK, 0.05).translate(-L * 0.22, 0, z0 + 1 + H * 0.6 - 0.2).softBox(L * 0.34, W * 0.6, 0.5, 0.4, 0.8).pop();
    for (let i = 0; i < 3; i++) b.push().color(BLACK, 0.2).translate(L * 0.02 - i * 1.2, 0, z0 + 1 + H * 0.5 + i * 0.4).box(0.3, W * 0.4, 0.25).pop();
    return;
  }
  if (style === 'boot') {
    b.push().color(RUBBER, 0.1).translate(0, 0, z0 + 0.8).softBox(L, W, 1.6, 0.3, 0.5).pop();
    b.push().color(c.base, 0.3).translate(L * 0.18, 0, z0 + 1.4 + H * 0.3 / 2).softBox(L * 0.64, W * 0.9, H * 0.3, 0.65, 0.7).pop();
    b.push().color(c.base, 0.3).translate(-L * 0.2, 0, z0 + 1.4 + (H - 1.6) / 2).softBox(L * 0.56, W * 0.94, H - 1.6, 0.35, 0.55).pop();
    b.push().color(BLACK, 0.05).translate(-L * 0.2, 0, H / 2 - 0.3).softBox(L * 0.42, W * 0.7, 0.6, 0.4, 0.8).pop();
    b.push().color(c.dark, 0.3).translate(-L * 0.2, 0, H / 2 - 1.2).softBox(L * 0.57, W * 0.95, 1.6, 0.4, 0.55).pop();
    for (const s of [-1, 1]) b.push().color(c.darker, 0.1).translate(-L * 0.2, s * W * 0.465, H * 0.1).box(L * 0.18, 0.12, H * 0.3).pop();
    return;
  }
  if (style === 'sandal') {
    b.push().color(c.dark, 0.1).translate(0, 0, z0 + 0.9).softBox(L, W, 1.8, 0.3, 0.6).pop();
    b.push().color(OFFWHITE, 0.05).translate(0, 0, z0 + 1.85).softBox(L * 0.95, W * 0.9, 0.2, 0.3, 0.6).pop();
    for (const k of [0.25, -0.05]) {
      b.push().color(c.base, 0.3).translate(L * k, 0, z0 + 1.9).rotateX(90).scale(1, (H - 1.9) / (W * 0.45), 1)
        .torus(W * 0.45, [0.9, 0.25], { start: 0, arc: Math.PI, seg: 20, tubeSeg: 6 }).pop();
    }
    b.push().color(c.base, 0.3).translate(-L * 0.32, 0, z0 + 1.9).rotateX(90).scale(1, (H - 1.9) * 0.8 / (W * 0.45), 1)
      .torus(W * 0.45, [0.6, 0.2], { start: 0, arc: Math.PI, seg: 20, tubeSeg: 6 }).pop();
    b.push().color(METAL, 0.9).translate(-L * 0.32, W * 0.46, z0 + 2.4).box(0.8, 0.2, 0.8).pop();
    return;
  }
  if (style === 'flipflop') {
    b.push().color(c.base, 0.15).translate(0, 0, z0 + 0.7).softBox(L, W, 1.4, 0.3, 0.7).pop();
    b.push().color(c.light, 0.05).translate(0, 0, z0 + 1.42).softBox(L * 0.94, W * 0.88, 0.05, 0.3, 0.7).pop();
    const post = [L * 0.3, 0, z0 + 1.4];
    for (const s of [-1, 1]) {
      b.push().color(WHITE, 0.2).tube([post, [L * 0.18, s * W * 0.2, H / 2 - 0.2], [-L * 0.02, s * W * 0.42, z0 + 1.4]], 0.3, 6).pop();
    }
    return;
  }
  // slipper
  b.push().color(OFFWHITE, 0.02).translate(0, 0, z0 + 0.8).softBox(L, W, 1.6, 0.5, 0.65).pop();
  b.push().color(c.base, 0.02).translate(L * 0.12, 0, z0 + 1.4).dome(L * 0.6, W * 0.95, H - 1.4, { e: 0.9 }).pop();
}

function shoePair(style) {
  return (b, L, W, H, c) => {
    const w = W / 2;
    for (const s of [-1, 1]) {
      b.push().translate(0, s * w / 2, 0);
      if (s > 0) b.scale(1, -1, 1); // mirror the left shoe
      shoe(b, L, w * 0.97, H, c, style);
      b.pop();
    }
  };
}

// --------------------------------------------------------------------------- //
// Toiletries
// --------------------------------------------------------------------------- //
function pouch(b, L, W, H, c) {
  const bodyL = L - 1.4;
  b.push().color(c.base, 0.15).translate(0.7, 0, 0).softBox(bodyL, W, H, 0.42, 0.32).pop();
  zipperLine(b, 0.7, 0, H / 2 - 0.1, bodyL * 0.86);
  zipperPull(b, bodyL / 2 - 1, 0, H / 2 + 0.05);
  // carry loop on the end
  b.push().color(c.dark, 0.1).translate(-L / 2 + 1.2, 0, H * 0.1).rotateX(90)
    .torus(Math.min(H * 0.25, 2.5), [0.35, 0.35], { start: Math.PI / 2, arc: Math.PI, seg: 16, tubeSeg: 6 }).pop();
  // brand patch
  b.push().color(c.contrast, 0.1).translate(bodyL * 0.1, -W / 2 + 0.05, 0).box(bodyL * 0.2, 0.12, H * 0.25).pop();
}

function bottle(b, L, W, H, c) {
  const capH = H * 0.16;
  const bodyH = H - capH;
  b.push().color(c.base, 0.55).translate(0, 0, -H / 2 + bodyH / 2).softBox(L, W, bodyH, 0.22, 0.55).pop();
  b.push().color(WHITE, 0.3).translate(0, -W / 2 + 0.02, -H / 2 + bodyH * 0.45).softBox(L * 0.72, 0.15, bodyH * 0.5, 0.2, 0.2).pop();
  b.push().color(c.dark, 0.3).translate(0, -W / 2 - 0.02, -H / 2 + bodyH * 0.55).box(L * 0.45, 0.1, 0.4).pop();
  b.push().color(shade(c.base, 0.55), 0.6).translate(0, 0, H / 2 - capH / 2).softBox(L * 0.62, W * 0.9, capH, 0.25, 0.7).pop();
}

function pumpBottle(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  const bodyH = H * 0.68;
  b.push().color(c.base, 0.6).translate(0, 0, -H / 2 + bodyH / 2).cylinder(r, bodyH, { seg: 32 }).pop();
  b.push().color(c.base, 0.6).translate(0, 0, -H / 2 + bodyH + 0.8).cylinder(r * 0.4, 1.6, { rTop: r * 0.3, seg: 24 }).pop();
  b.push().color(WHITE, 0.3).translate(0, 0, -H / 2 + bodyH * 0.5).cylinder(r * 1.005, bodyH * 0.4, { seg: 32, caps: false }).pop();
  b.push().color([0.2, 0.2, 0.2], 0.6).translate(0, 0, -H / 2 + bodyH + 2.2).cylinder(r * 0.35, 1.8, { seg: 20 }).pop();
  const headZ = H / 2 - 1.1;
  b.push().color([0.2, 0.2, 0.2], 0.6).translate(0, 0, headZ - 1.0).cylinder(0.35, 2.2, { seg: 10 }).pop();
  b.push().color([0.2, 0.2, 0.2], 0.6).translate(-r * 0.2, 0, headZ + 0.2).softBox(r * 1.6, r * 0.8, 1.6, 0.3, 0.5).pop();
}

function tube(b, L, W, H, c) {
  const capL = L * 0.12;
  const bodyL = L - capL;
  const x0 = -L / 2 + capL;
  b.push().color(c.base, 0.45).surface((u, v) => {
    const s = u, t = v * Math.PI * 2;
    const ry = (W / 2) * (0.62 + 0.38 * s);
    const rz = (H / 2) * Math.max(0.05, 1 - Math.pow(s, 1.6) * 0.95);
    const x = x0 + s * bodyL;
    return [[x, ry * Math.cos(t), rz * Math.sin(t)], [0, Math.cos(t) / ry, Math.sin(t) / rz]];
  }, 20, 20).pop();
  b.push().color(shade(c.base, 0.9), 0.3).translate(L / 2 - 0.5, 0, 0).box(1.0, W, 0.35).pop();
  b.push().color(WHITE, 0.3).translate(-L / 2 + capL / 2 + 0.05, 0, 0).rotateY(90).cylinder(H * 0.36, capL, { seg: 20 }).pop();
  b.push().color(c.contrast, 0.3).translate(x0 + bodyL * 0.35, 0, H / 2 * 0.86).box(bodyL * 0.4, W * 0.5, 0.1).pop();
}

function capsule(b, L, W, H, c) {
  b.push().color(c.base, 0.6).rotateY(90).superellipsoid(H, W, L, 0.7, 1, 28, 16).pop();
  b.push().color(WHITE, 0.4).translate(L * 0.18, 0, 0).rotateY(90).scale(H / 2 * 1.01, W / 2 * 1.01, 1)
    .cylinder(1, 0.5, { seg: 24, caps: false }).pop();
}

function sprayCan(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  const capH = H * 0.2;
  b.push().color(c.base, 0.75).translate(0, 0, -H / 2 + (H - capH) / 2).cylinder(r, H - capH, { seg: 32 }).pop();
  b.push().color(WHITE, 0.4).translate(0, 0, -H / 2 + (H - capH) * 0.45).cylinder(r * 1.004, (H - capH) * 0.35, { seg: 32, caps: false }).pop();
  b.push().color(METAL, 0.9).translate(0, 0, H / 2 - capH).cylinder(r * 0.98, 0.6, { rTop: r * 0.7, seg: 32 }).pop();
  b.push().color(c.light, 0.6).translate(0, 0, H / 2 - capH / 2 + 0.2).cylinder(r * 0.92, capH - 0.4, { seg: 32 }).pop();
}

function perfume(b, L, W, H, c) {
  const capH = H * 0.28;
  const bodyH = H - capH - 0.6;
  b.push().color(mix(c.base, WHITE, 0.2), 0.95).translate(0, 0, -H / 2 + bodyH / 2).softBox(L, W, bodyH, 0.12, 0.2).pop();
  b.push().color(c.dark, 0.9).translate(0, 0, -H / 2 + bodyH * 0.4).softBox(L * 0.8, W * 0.75, bodyH * 0.7, 0.12, 0.2).pop();
  b.push().color(GOLD, 0.95).translate(0, 0, -H / 2 + bodyH + 0.3).cylinder(Math.min(L, W) * 0.22, 0.6, { seg: 20 }).pop();
  b.push().color(BLACK, 0.8).translate(0, 0, H / 2 - capH / 2).softBox(L * 0.55, W * 0.75, capH, 0.1, 0.15).pop();
}

function jar(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  b.push().color(c.base, 0.7).translate(0, 0, -H / 2 + H * 0.35).cylinder(r * 0.96, H * 0.7, { seg: 36 }).pop();
  b.push().color([0.72, 0.6, 0.5], 0.85).translate(0, 0, H / 2 - H * 0.16).cylinder(r, H * 0.32, { seg: 36 }).pop();
  b.push().color(GOLD, 0.9).translate(0, 0, H / 2 - 0.02).cylinder(r * 0.6, 0.05, { seg: 30 }).pop();
}

function razor(b, L, W, H, c) {
  b.push().color(c.base, 0.6).translate(-L * 0.12, 0, -H * 0.2).softBox(L * 0.76, W * 0.5, H * 0.5, 0.4, 0.5).pop();
  b.push().color(RUBBER, 0.2).translate(-L * 0.2, 0, -H * 0.02).softBox(L * 0.3, W * 0.4, H * 0.2, 0.4, 0.5).pop();
  b.push().color([0.9, 0.9, 0.92], 0.6).translate(L / 2 - L * 0.12, 0, 0).softBox(L * 0.22, W, H, 0.3, 0.3).pop();
  for (const k of [-0.2, 0, 0.2]) b.push().color(METAL, 0.95).translate(L / 2 - L * 0.12 + k * 2.2, 0, H / 2 - 0.05).box(0.18, W * 0.85, 0.1).pop();
}

function hairDryer(b, L, W, H, c) {
  const r = H / 2 * 0.95;
  const by = W / 2 - r;
  b.push().color(c.base, 0.55).translate(-L * 0.06, by, 0).rotateY(90).cylinder(r, L * 0.62, { seg: 32 }).pop();
  b.push().color(BLACK, 0.2).translate(-L * 0.06 - L * 0.31 - 0.1, by, 0).rotateY(90).cylinder(r * 0.8, 0.3, { seg: 24 }).pop();
  b.push().color(c.dark, 0.5).translate(L / 2 - L * 0.12, by, 0).rotateY(90).cylinder(r * 0.8, L * 0.24, { rTop: r * 0.5, seg: 28 }).pop();
  // folding handle
  b.push().color(c.base, 0.55).translate(-L * 0.12, by - (W - r) / 2 - r * 0.2, 0).softBox(4.2, W - r * 1.2, H * 0.8, 0.4, 0.4).pop();
  b.push().color(METAL, 0.8).translate(-L * 0.12, by - r * 0.8, H * 0.3).rotateY(90).cylinder(0.6, 4.4, { seg: 12 }).pop();
  b.push().color(RUBBER, 0.1).tube([[-L * 0.12, -W / 2 + 0.4, 0], [-L * 0.3, -W / 2 + 0.6, 0], [-L / 2 + 0.5, -W / 2 + 1.5, 0]], 0.4, 6).pop();
}

function straightener(b, L, W, H, c) {
  for (const s of [-1, 1]) {
    b.push().color(c.base, 0.5).translate(0, 0, s * H / 4).softBox(L, W, H / 2 - 0.2, 0.35, 0.4).pop();
  }
  b.push().color([0.7, 0.6, 0.55], 0.9).translate(L / 2 - L * 0.22, 0, 0).box(L * 0.38, W * 0.8, 0.25).pop();
  b.push().color(c.dark, 0.4).translate(-L / 2 + 1, 0, 0).rotateX(90).cylinder(H / 2 * 0.95, W * 0.95, { seg: 20 }).pop();
  b.push().color(GOLD, 0.8).translate(-L * 0.1, -W / 2 + 0.02, H / 4).box(1.2, 0.08, 0.6).pop();
}

function firstAid(b, L, W, H, c) {
  b.push().color(c.base, 0.35).softBox(L, W, H, 0.22, 0.2).pop();
  b.push().color(shade(c.base, 0.6), 0.4).softBox(L * 1.005, W * 1.005, 0.6, 0.2, 0.2).pop();
  const s = Math.min(L, W) * 0.42;
  b.push().color(WHITE, 0.2).translate(0, 0, H / 2 - 0.02).box(s, s * 0.32, 0.12).box(s * 0.32, s, 0.12).pop();
  zipperPull(b, L / 2 - 0.4, 0, 0.3);
}

function medicine(b, L, W, H, c) {
  b.push().color(WHITE, 0.25).softBox(L, W, H, 0.08, 0.08).pop();
  b.push().color([0.2, 0.5, 0.85], 0.3).translate(-L * 0.3, 0, H / 2 - 0.01).box(L * 0.2, W * 1.0, 0.06).pop();
  for (let i = 0; i < 3; i++) b.push().color([0.3, 0.3, 0.35], 0.1).translate(L * 0.12, W * (0.25 - i * 0.18), H / 2 - 0.01).box(L * 0.5, 0.35, 0.06).pop();
}

// --------------------------------------------------------------------------- //
// Electronics
// --------------------------------------------------------------------------- //
function laptop(b, L, W, H, c) {
  const half = H / 2;
  b.push().color(shade(c.base, 0.95), 0.7).translate(0, 0, -half / 2).softBox(L, W, half, 0.1, 0.07).pop();
  b.push().color(c.base, 0.7).translate(0, 0, half / 2 + 0.02).softBox(L, W, half - 0.04, 0.1, 0.07).pop();
  b.push().color(BLACK, 0.2).softBox(L * 0.995, W * 0.995, 0.12, 0.2, 0.07).pop();
  b.push().color(shade(c.base, 1.15), 1).translate(0, 0, H / 2 - 0.01).cylinder(1.3, 0.05, { seg: 28 }).pop();
  b.push().color(BLACK, 0.2).translate(0, -W / 2 + 0.05, -0.05).box(3, 0.12, 0.2).pop();
  for (const k of [0.2, 0.28]) b.push().color(BLACK, 0.2).translate(-L / 2 + 0.02, -W * (0.5 - k), -half / 2).box(0.1, 1.0, 0.35).pop();
}

function tablet(b, L, W, H, c) {
  b.push().color(c.base, 0.6).softBox(L, W, H, 0.12, 0.1).pop();
  b.push().color(BLACK, 1).translate(0, 0, H / 2 - 0.02).box(L * 0.93, W * 0.9, 0.06).pop();
  b.push().color([0.12, 0.14, 0.2], 1).translate(0, 0, H / 2 + 0.02).box(L * 0.86, W * 0.82, 0.02).pop();
  b.push().color([0.2, 0.2, 0.25], 0.9).translate(L * 0.465 - 0.1, 0, H / 2 + 0.02).cylinder(0.2, 0.04, { seg: 10 }).pop();
}

function ereader(b, L, W, H, c) {
  b.push().color(c.base, 0.3).softBox(L, W, H, 0.15, 0.12).pop();
  b.push().color([0.82, 0.82, 0.78], 0.05).translate(-L * 0.06, 0, H / 2 - 0.01).box(L * 0.74, W * 0.84, 0.05).pop();
  for (let i = 0; i < 6; i++) b.push().color([0.5, 0.5, 0.48], 0.02).translate(-L * 0.06, W * (0.3 - i * 0.11), H / 2 + 0.03).box(L * 0.6, 0.18, 0.02).pop();
}

function headphoneCase(b, L, W, H, c) {
  b.push().color(c.base, 0.35).superellipsoid(L, W, H, 0.5, 0.75).pop();
  b.push().color(BLACK, 0.3).superellipsoid(L * 1.005, W * 1.005, 0.7, 0.5, 0.75).pop();
  b.push().color(METAL, 0.9).translate(L / 2 - 0.3, 0, 0).box(0.6, 1.6, 0.5).pop();
  b.push().color(c.light, 0.5).translate(0, 0, H / 2 - 0.05).cylinder(1.4, 0.1, { seg: 24 }).pop();
  b.push().color(c.dark, 0.2).translate(-L / 2 + 0.6, 0, H * 0.1).rotateX(90)
    .torus(1.6, [0.3, 0.3], { start: Math.PI / 2, arc: Math.PI, seg: 12, tubeSeg: 6 }).pop();
}

function earbuds(b, L, W, H, c) {
  b.push().color(c.base, 0.9).superellipsoid(L, W, H, 0.55, 0.75).pop();
  b.push().color([0.6, 0.6, 0.62], 0.4).translate(0, 0, H * 0.18).superellipsoid(L * 1.004, W * 1.004, 0.08, 0.5, 0.75).pop();
  b.push().color([0.2, 0.9, 0.4], 0.8).translate(0, -W / 2 + 0.05, -H * 0.05).sphere(0.12, 8).pop();
}

function powerBank(b, L, W, H, c) {
  b.push().color(c.base, 0.45).softBox(L, W, H, 0.18, 0.12).pop();
  for (let i = 0; i < 4; i++) b.push().color([0.3, 0.75, 1.0], 0.8).translate(L * 0.25 + i * 0.8, -W / 2 + 0.05, 0).sphere(0.18, 8).pop();
  b.push().color(BLACK, 0.4).translate(L / 2 - 0.05, 0, 0).box(0.15, 1.1, 0.4).pop();
  b.push().color(c.light, 0.4).translate(-L * 0.1, 0, H / 2 - 0.02).box(L * 0.3, 0.5, 0.05).pop();
}

function charger(b, L, W, H, c) {
  b.push().color(c.base, 0.75).softBox(L, W, H, 0.22, 0.2).pop();
  for (const s of [-1, 1]) b.push().color([0.55, 0.55, 0.58], 0.3).translate(L * 0.3, s * 0.8, H / 2 - 0.01).box(2.4, 0.4, 0.05).pop();
  b.push().color(BLACK, 0.3).translate(-L / 2 + 0.03, 0, 0).box(0.1, 1.0, 0.35).pop();
  // wrapped cable
  b.push().color(shade(c.base, 0.92), 0.5).translate(-L * 0.15, 0, 0).scale(1, W / 2 * 1.02 / (H / 2), 1)
    .rotateY(90).cylinder(H / 2 * 1.02, 1.4, { seg: 24, caps: false }).pop();
}

function camera(b, L, W, H, c) {
  const bodyW = W * 0.5;
  const by = W / 2 - bodyW / 2;
  b.push().color(c.base, 0.4).translate(0, by, -H * 0.1).softBox(L, bodyW, H * 0.8, 0.15, 0.2).pop();
  b.push().color([0.25, 0.25, 0.26], 0.2).translate(L * 0.36, by - bodyW * 0.3, -H * 0.1).softBox(L * 0.26, bodyW * 0.7, H * 0.76, 0.3, 0.4).pop();
  b.push().color(c.base, 0.4).translate(-L * 0.05, by + bodyW * 0.1, H / 2 - H * 0.12).softBox(L * 0.3, bodyW * 0.6, H * 0.24, 0.3, 0.2).pop();
  b.push().color(METAL, 0.9).translate(L * 0.3, by, H * 0.3 + 0.1).cylinder(0.9, 0.6, { seg: 20 }).pop();
  b.push().color(METAL, 0.8).translate(-L * 0.32, by, H * 0.3 + 0.1).cylinder(1.1, 0.7, { seg: 24 }).pop();
  // lens pointing to -y
  const lensL = W - bodyW;
  const lx = -L * 0.05, lz = -H * 0.1;
  b.push().translate(lx, -W / 2 + lensL / 2, lz).rotateX(90);
  b.color(c.base, 0.4).cylinder(H * 0.3, lensL, { seg: 36 });
  for (let i = 0; i < 6; i++) b.push().color(RUBBER, 0.1).translate(0, 0, -lensL * 0.1 + i * 0.35).cylinder(H * 0.305, 0.18, { seg: 36, caps: false }).pop();
  b.push().color([0.08, 0.1, 0.18], 1).translate(0, 0, -lensL / 2 - 0.01).cylinder(H * 0.22, 0.04, { seg: 32 }).pop();
  b.pop();
  b.push().color([0.9, 0.2, 0.2], 0.6).translate(lx + H * 0.34, by - bodyW / 2 - 0.02, lz + H * 0.25).box(0.4, 0.1, 0.4).pop();
}

function lens(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  b.push().color(c.base, 0.4).cylinder(r, H, { seg: 40 }).pop();
  for (let i = 0; i < 10; i++) b.push().color(RUBBER, 0.08).translate(0, 0, H * 0.05 + i * 0.35).cylinder(r * 1.005, 0.2, { seg: 40, caps: false }).pop();
  b.push().color(METAL, 0.95).translate(0, 0, -H / 2 + 0.3).cylinder(r * 0.8, 0.6, { seg: 40 }).pop();
  b.push().color([0.08, 0.12, 0.22], 1).translate(0, 0, H / 2 + 0.005).cylinder(r * 0.8, 0.02, { seg: 36 }).pop();
  b.push().color([0.9, 0.2, 0.2], 0.5).translate(0, 0, H * 0.3).cylinder(r * 1.006, 0.12, { seg: 40, caps: false }).pop();
}

function adapter(b, L, W, H, c) {
  b.push().color(c.base, 0.6).softBox(L, W, H, 0.12, 0.12).pop();
  b.push().color([0.9, 0.35, 0.2], 0.4).translate(0, -W / 2 + 0.02, H * 0.2).box(L * 0.35, 0.1, 0.9).pop();
  for (const s of [-1, 1]) b.push().color(BLACK, 0.2).translate(s * 0.9, 0, H / 2 - 0.01).box(0.3, 1.2, 0.05).pop();
  b.push().color(BLACK, 0.2).translate(0, W * 0.25, H / 2 - 0.01).cylinder(0.4, 0.05, { seg: 12 }).pop();
}

function consoleModel(b, L, W, H, c) {
  const jw = L * 0.16;
  b.push().color(BLACK, 0.5).softBox(L - 2 * jw + 0.4, W, H, 0.15, 0.12).pop();
  b.push().color([0.06, 0.08, 0.12], 1).translate(0, 0, H / 2 - 0.02).box(L - 2 * jw - 0.8, W * 0.86, 0.05).pop();
  for (const s of [-1, 1]) {
    const col = s < 0 ? [0.0, 0.7, 0.85] : [1.0, 0.3, 0.3];
    b.push().color(col, 0.4).translate(s * (L / 2 - jw / 2), 0, 0).softBox(jw, W, H, 0.3, 0.5).pop();
    b.push().color(RUBBER, 0.3).translate(s * (L / 2 - jw / 2), s * W * 0.18, H / 2 + 0.0).cylinder(0.9, 0.7, { seg: 16 }).pop();
    for (const [dx, dy] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
      b.push().color(RUBBER, 0.4).translate(s * (L / 2 - jw / 2) + dx, -s * W * 0.2 + dy, H / 2 - 0.1).cylinder(0.3, 0.3, { seg: 10 }).pop();
    }
  }
}

// --------------------------------------------------------------------------- //
// Accessories
// --------------------------------------------------------------------------- //
function glassesCase(b, L, W, H, c) {
  b.push().color(c.base, 0.55).superellipsoid(L, W, H, 0.6, 0.4).pop();
  b.push().color(c.dark, 0.3).superellipsoid(L * 1.004, W * 1.004, 0.18, 0.6, 0.4).pop();
  b.push().color(METAL, 0.9).translate(0, W / 2 - 0.05, 0).rotateY(90).cylinder(0.25, L * 0.3, { seg: 10 }).pop();
}

function watchBox(b, L, W, H, c) {
  b.push().color(c.base, 0.5).translate(0, 0, -H * 0.15).softBox(L, W, H * 0.7, 0.1, 0.1).pop();
  b.push().color(c.dark, 0.5).translate(0, 0, H * 0.35 - 0.02).softBox(L * 1.0, W * 1.0, H * 0.3, 0.1, 0.1).pop();
  b.push().color(GOLD, 0.95).translate(0, -W / 2 - 0.0, H * 0.18).box(1.4, 0.2, 0.8).pop();
  b.push().color(GOLD, 0.95).translate(0, 0, H / 2 - 0.01).box(L * 0.4, 0.2, 0.05).pop();
}

function drawstring(b, L, W, H, c) {
  const bodyL = L * 0.8;
  b.push().color(c.base, 0.4).translate(-L / 2 + bodyL / 2, 0, 0).superellipsoid(bodyL, W, H, 0.75, 0.8).pop();
  b.push().color(c.dark, 0.4).translate(L / 2 - L * 0.14, 0, 0).rotateY(90).cylinder(H * 0.18, L * 0.18, { rTop: H * 0.3, seg: 16 }).pop();
  for (const s of [-1, 1]) {
    b.push().color(GOLD, 0.6).tube([[L * 0.32, 0, 0], [L * 0.42, s * W * 0.25, -H * 0.2], [L * 0.3, s * W * 0.4, -H * 0.4]], 0.15, 6).pop();
    b.push().color(GOLD, 0.95).translate(L * 0.3, s * W * 0.4, -H * 0.4).sphere(0.35, 8).pop();
  }
}

function wallet(b, L, W, H, c) {
  b.push().color(c.base, 0.35).softBox(L, W, H, 0.25, 0.12).pop();
  stitchFrame(b, 0, 0, H / 2 - 0.02, L * 0.94, W * 0.9, c.light, 0.08);
  b.push().color(c.dark, 0.35).translate(L * 0.25, 0, H / 2 - 0.05).softBox(L * 0.5, W * 0.95, 0.15, 0.3, 0.2).pop();
  button(b, L * 0.38, 0, H / 2 + 0.05, 0.5, METAL);
}

function belt(b, L, W, H, c) {
  const R = Math.min(L, W) / 2;
  // a leather strap coiled into rings, buckle on the outside
  for (let i = 0; i < 4; i++) {
    b.push().color(i % 2 ? c.base : shade(c.base, 0.88), 0.35)
      .torus(R - 0.4 - i * 0.85, [H / 2 * 0.95, 0.38], { seg: 44, tubeSeg: 10 }).pop();
  }
  b.push().color(METAL, 0.95).translate(R - 0.45, 0, 0).frame(0.9, 4.2, 0.4, H * 0.95).pop();
  b.push().color(METAL, 0.95).translate(R - 0.45, 0, 0).rotateZ(90).cylinder(0.15, 3.4, { seg: 8 }).pop();
}

function umbrella(b, L, W, H, c) {
  const handleL = L * 0.22;
  const r = Math.min(W, H) / 2;
  b.push().color(c.base, 0.3).surface((u, v) => {
    const t = u * Math.PI * 2;
    const s = v;
    const taper = s < 0.85 ? 1 : 1 - (s - 0.85) / 0.15 * 0.6;
    const rr = r * 0.88 * (1 + 0.1 * Math.cos(t * 8)) * taper;
    const x = -L / 2 + handleL + s * (L - handleL - 0.6);
    return [[x, rr * Math.cos(t), rr * Math.sin(t)], [0, Math.cos(t), Math.sin(t)]];
  }, 48, 12).pop();
  b.push().color(c.base, 0.3).translate(L / 2 - 0.3 - 0.6, 0, 0).rotateY(90).disc(r * 0.5, 0, 1, 20).pop();
  b.push().color(BLACK, 0.4).translate(-L / 2 + handleL / 2, 0, 0).rotateY(90).cylinder(r * 0.95, handleL, { seg: 20 }).pop();
  b.push().color(METAL, 0.9).translate(L / 2 - 0.3, 0, 0).rotateY(90).cylinder(0.3, 0.6, { seg: 10 }).pop();
  b.push().color(c.dark, 0.2).translate(L * 0.1, 0, 0).rotateY(90).cylinder(r * 1.0, 1.2, { seg: 24, caps: false }).pop();
  b.push().color(METAL, 0.9).translate(L * 0.1, 0, r * 0.98).sphere(0.35, 8).pop();
}

function neckPillow(b, L, W, H, c) {
  const tube = H / 2;
  const R = Math.min(L, W) / 2 - tube;
  b.push().color(c.base, 0.05).scale(L / Math.min(L, W), W / Math.min(L, W), 1)
    .torus(R, [tube, tube * 1.05], { start: Math.PI * 0.22, arc: Math.PI * 1.56, seg: 48, tubeSeg: 18 }).pop();
  for (const s of [-1, 1]) {
    const a = s * Math.PI * 0.22;
    b.push().color(c.base, 0.05).translate(Math.cos(a) * R * L / Math.min(L, W), Math.sin(a) * R * W / Math.min(L, W), 0)
      .sphere(tube * 1.0, 16).pop();
  }
  b.push().color(c.dark, 0.2).translate(R * 0.95, 0, 0).box(1.4, R * 0.9, 0.4).pop();
}

function flask(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  const capH = H * 0.14;
  b.push().color(c.base, 0.75).translate(0, 0, -H / 2 + (H - capH) / 2).cylinder(r, H - capH, { seg: 36 }).pop();
  b.push().color(METAL, 0.95).translate(0, 0, -H / 2 + 0.6).cylinder(r * 1.003, 1.2, { seg: 36, caps: false }).pop();
  b.push().color(BLACK, 0.4).translate(0, 0, H / 2 - capH / 2).cylinder(r * 0.8, capH, { seg: 32 }).pop();
  b.push().color(BLACK, 0.4).translate(0, 0, H / 2 - capH * 0.5).rotateX(90)
    .torus(r * 0.55, [0.35, 0.35], { start: 0, arc: Math.PI, seg: 14, tubeSeg: 6 }).pop();
}

function tumbler(b, L, W, H, c) {
  const r = Math.min(L, W) / 2;
  const lidH = H * 0.13;
  b.push().color(c.base, 0.6).translate(0, 0, -H / 2 + (H - lidH) / 2).cylinder(r * 0.8, H - lidH, { rTop: r, seg: 36 }).pop();
  b.push().color(BLACK, 0.3).translate(0, 0, H / 2 - lidH / 2).cylinder(r, lidH, { rTop: r * 0.92, seg: 36 }).pop();
  b.push().color([0.3, 0.3, 0.3], 0.3).translate(r * 0.5, 0, H / 2 - 0.01).box(1.2, 0.6, 0.05).pop();
}

// --------------------------------------------------------------------------- //
// Documents & gear
// --------------------------------------------------------------------------- //
function passport(b, L, W, H, c) {
  b.push().color(c.base, 0.3).softBox(L, W, H, 0.15, 0.1).pop();
  b.push().color(OFFWHITE, 0.05).translate(0.1, 0, 0).box(L * 0.98, W * 0.97, H * 0.7).pop();
  b.push().color(GOLD, 0.9).translate(0, 0, H / 2 + 0.005).torus(1.6, [0.02, 0.18], { seg: 28, tubeSeg: 4 }).pop();
  b.push().color(GOLD, 0.9).translate(0, 0, H / 2 + 0.005).cylinder(0.7, 0.02, { seg: 16 }).pop();
  b.push().color(GOLD, 0.9).translate(-L * 0.3, 0, H / 2 + 0.005).box(0.4, W * 0.5, 0.02).pop();
}

function folder(b, L, W, H, c) {
  b.push().color(c.base, 0.35).softBox(L, W, H, 0.15, 0.06).pop();
  b.push().color(shade(c.base, 0.85), 0.35).translate(0, W * 0.34, H / 2 - 0.05).box(L * 0.99, W * 0.3, 0.12).pop();
  for (const s of [-1, 1]) {
    b.push().color(BLACK, 0.2).translate(s * (L / 2 - 2), 0, 0).rotateZ(s * 45).scale(1, 1, 1).box(0.5, 5, H * 1.02).pop();
  }
  b.push().color(WHITE, 0.1).translate(-L * 0.15, -W * 0.15, H / 2 + 0.01).box(8, 3, 0.02).pop();
}

function book(b, L, W, H, c) {
  const cover = 0.25;
  b.push().color(c.base, 0.3).translate(0, 0, -H / 2 + cover / 2).softBox(L, W, cover, 0.3, 0.05).pop();
  b.push().color(c.base, 0.3).translate(0, 0, H / 2 - cover / 2).softBox(L, W, cover, 0.3, 0.05).pop();
  b.push().color(c.dark, 0.3).translate(0, -W / 2 + 0.2, 0).softBox(L, 0.4, H, 0.6, 0.4).pop();
  b.push().color(OFFWHITE, 0.02).translate(0, 0.15, 0).box(L * 0.97, W * 0.96, H - 2 * cover).pop();
  b.push().color(c.contrast, 0.3).translate(L * 0.15, 0, H / 2 + 0.01).box(L * 0.35, W * 0.6, 0.03).pop();
  b.push().color(c.contrast, 0.3).translate(-L * 0.25, 0, H / 2 + 0.01).box(L * 0.08, W * 0.4, 0.03).pop();
}

function notebook(b, L, W, H, c) {
  book(b, L, W, H, c);
  b.push().color(BLACK, 0.2).translate(L * 0.36, 0, 0).box(0.5, W * 1.01, H * 1.01).pop();
  b.push().color([0.8, 0.2, 0.2], 0.2).translate(-L / 2 - 0.0, W * 0.2, -H * 0.1).box(0.2, 0.5, 0.1).pop();
}

function packingCube(b, L, W, H, c) {
  b.push().color(c.base, 0.12).softBox(L, W, H, 0.3, 0.16).pop();
  // mesh top panel with a grid
  b.push().color(shade(c.base, 0.55), 0.05).translate(0, 0, H / 2 - 0.02).box(L * 0.8, W * 0.74, 0.06).pop();
  for (let x = -L * 0.38; x <= L * 0.38; x += 1.2) line(b, x, 0, H / 2 + 0.02, 0.08, W * 0.74, c.light, 0.04);
  for (let y = -W * 0.35; y <= W * 0.35; y += 1.2) line(b, 0, y, H / 2 + 0.02, L * 0.8, 0.08, c.light, 0.04);
  // zipper around the lid and a grab handle
  b.push().color(BLACK, 0.3).translate(0, 0, H / 2 - 0.08).frame(L * 0.88, W * 0.84, 0.5, 0.12).pop();
  zipperPull(b, L * 0.4, -W * 0.42, H / 2 + 0.05);
  b.push().color(c.dark, 0.1).translate(-L / 2 + 0.3, 0, H * 0.15).box(0.6, W * 0.3, 1.2).pop();
}

function laundryBag(b, L, W, H, c) {
  foldedBody(b, L, W, H, c, { soft: 0.6 });
  b.push().color(c.dark, 0.1).tube([[L / 2 - 1, -W * 0.3, H / 2], [L * 0.1, -W * 0.1, H / 2], [-L * 0.2, W * 0.2, H / 2]], 0.2, 6).pop();
}

function towelRoll(b, L, W, H, c) {
  rollBody(b, L, W, H, c.base, 0.03, 0.2);
  rollEnd(b, L, W, H, c.dark);
  for (const k of [-0.3, 0.3]) {
    b.push().color(WHITE, 0.03).translate(k * L, 0, 0).rotateY(90).scale(H / 2 * 1.005, W / 2 * 1.005, 1)
      .cylinder(1, Math.max(1, L * 0.05), { seg: 32, caps: false }).pop();
  }
  b.push().color(c.dark, 0.1).translate(-L * 0.1, 0, 0).rotateY(90).scale(H / 2 * 1.01, W / 2 * 1.01, 1)
    .cylinder(1, 1.4, { seg: 32, caps: false }).pop();
}

function snackBox(b, L, W, H, c) {
  b.push().color(c.base, 0.3).softBox(L, W, H, 0.08, 0.08).pop();
  b.push().color([0.8, 0.25, 0.2], 0.3).translate(0, 0, H / 2 - 0.01).box(L * 1.0, W * 0.3, 0.05).pop();
  b.push().color(WHITE, 0.4).translate(L * 0.2, W * 0.2, H / 2 + 0.01).box(L * 0.3, W * 0.2, 0.03).pop();
}

function gift(b, L, W, H, c) {
  const boxH = H * 0.8;
  const z = -H / 2 + boxH / 2;
  b.push().color(c.base, 0.4).translate(0, 0, z).softBox(L, W, boxH, 0.06, 0.06).pop();
  b.push().color(GOLD, 0.6).translate(0, 0, z).box(L * 1.005, 1.2, boxH * 1.005).box(1.2, W * 1.005, boxH * 1.005).pop();
  const bowR = Math.min(H - boxH, 2.5);
  for (const s of [-1, 1]) {
    b.push().color(GOLD, 0.6).translate(s * bowR * 0.9, 0, -H / 2 + boxH).rotateX(90).rotateY(s * 15)
      .torus(bowR * 0.9, [0.25, 0.6], { start: 0, arc: Math.PI, seg: 18, tubeSeg: 6 }).pop();
  }
}

function tripod(b, L, W, H, c) {
  const r = Math.min(W, H) * 0.14;
  const legL = L * 0.8;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const y = Math.cos(a) * Math.min(W, H) * 0.22, z = Math.sin(a) * Math.min(W, H) * 0.22;
    b.push().translate(-L / 2 + legL / 2, y, z).rotateY(90);
    b.color(c.base, 0.6).cylinder(r, legL, { seg: 14 });
    for (const k of [-0.2, 0.15]) b.push().color(RUBBER, 0.2).translate(0, 0, legL * k).cylinder(r * 1.2, 1.2, { seg: 14 }).pop();
    b.pop();
  }
  b.push().color(BLACK, 0.4).translate(L / 2 - L * 0.1, 0, 0).softBox(L * 0.2, W * 0.9, H * 0.9, 0.3, 0.4).pop();
  b.push().color(METAL, 0.8).translate(L / 2 - L * 0.1, W / 2 - 0.4, 0).rotateX(90).cylinder(1.0, 0.8, { seg: 16 }).pop();
}

function plainBox(b, L, W, H, c) {
  b.push().color(c.base, 0.2).softBox(L, W, H, 0.2, 0.2).pop();
}

// --------------------------------------------------------------------------- //
export const MODEL_BUILDERS = {
  tshirt, polo, dress_shirt: dressShirt, sweater, hoodie, jacket, puffer, blazer, jeans, shorts,
  dress, swimsuit, roll, socks, cap, sun_hat: sunHat,
  sneakers: shoePair('sneaker'), dress_shoes: shoePair('dress'), boots: shoePair('boot'),
  sandals: shoePair('sandal'), flip_flops: shoePair('flipflop'), slippers: shoePair('slipper'),
  pouch, bottle, pump_bottle: pumpBottle, tube, capsule, spray_can: sprayCan, perfume, jar, razor,
  hair_dryer: hairDryer, straightener, first_aid: firstAid, medicine,
  laptop, tablet, ereader, headphone_case: headphoneCase, earbuds, power_bank: powerBank, charger,
  camera, lens, adapter, console: consoleModel,
  glasses_case: glassesCase, watch_box: watchBox, drawstring, wallet, belt, umbrella,
  neck_pillow: neckPillow, flask, tumbler,
  passport, folder, book, notebook, packing_cube: packingCube, laundry_bag: laundryBag,
  towel_roll: towelRoll, snack_box: snackBox, gift, tripod, box: plainBox,
};

const cache = new Map();

/** Geometry for an item in its catalogue orientation (L x W x H centred at 0). */
export function buildProductGeometry(model, L, W, H, color) {
  const key = `${model}|${L}|${W}|${H}|${color}`;
  if (cache.has(key)) return cache.get(key);
  const b = new MeshBuilder();
  const fn = MODEL_BUILDERS[model] || plainBox;
  try {
    fn(b, L, W, H, palette(color));
  } catch (err) {
    console.warn(`Model "${model}" failed, drawing a box instead`, err);
    const fb = new MeshBuilder();
    plainBox(fb, L, W, H, palette(color));
    return fb.build();
  }
  const g = b.build();
  cache.set(key, g);
  return g;
}
