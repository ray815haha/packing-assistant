"""Blender script: builds the detailed product models the app shows in 3D.

    blender --background --factory-startup --python blender/make_models.py
    blender ... --python blender/make_models.py -- sneakers jeans    # just these

Writes one glTF binary per model type to web/models/types/<type>.glb (the
"model" names in data/catalog.json), then run `python tools/make_catalog.py`
so the app knows they exist. Items without a file here keep the simpler
built-in shapes from web/js/models.js.

Conventions (the same as the built-in shapes):
  - modelled in centimetres, as the item sits when packed: length along X,
    width along Y, height (thickness) along Z; the app stretches each model
    to the exact size of the item that uses it
  - collars, toes and zip pulls point to +X; a camera lens points to -Y
  - materials whose name starts with "tint" take the item's colour in the
    app (their texture, if any, is a light-grey detail map); all other
    materials keep the colour they have here
  - colours are given as sRGB and stored unchanged (the app's renderer
    treats glTF colours as sRGB)

Textures are generated with numpy (no image files), so the script is
self-contained and gives the same result every time.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "models" / "types"
TEX = 256  # texture size (pixels)


# =========================================================================== #
# Textures (tileable, grey levels around 0.8-1.0 so they shade the colour)
# =========================================================================== #
_U, _V = np.meshgrid(np.arange(TEX) / TEX, np.arange(TEX) / TEX)


def noise(sigma, seed=0):
    """Smooth tileable noise in 0..1 (sigma = feature size in pixels)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(TEX)
    fx, fy = np.meshgrid(f, f)
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((TEX, TEX))) * g))
    return (n - n.min()) / (np.ptp(n) or 1)


def tex_jersey():  # fine knit of a T-shirt
    return 0.9 + 0.05 * np.cos(2 * math.pi * 32 * _U) * np.cos(2 * math.pi * 16 * _V) + 0.05 * noise(1.2, 1)


def tex_rib(level=0.84):  # ribbed collar / cuff, a little darker than the body
    return level + 0.1 * np.abs(np.cos(math.pi * 12 * _U)) + 0.03 * noise(1, 2)


def tex_knit():  # chunky sweater knit (rows of Vs)
    v = np.abs(((_U * 10) % 1) - 0.5) * 2
    rows = ((_V * 20 + v * 0.8) % 1)
    return 0.72 + 0.22 * np.sin(math.pi * rows) + 0.05 * noise(2, 3)


def tex_denim():  # twill: diagonal lines with lighter weft specks
    twill = ((_U * 48 + _V * 48) % 1) < 0.55
    return 0.72 + 0.12 * twill + 0.14 * noise(0.8, 4) ** 2 + 0.06 * noise(12, 5)


def tex_weave(fine=40, level=0.84):  # nylon / canvas
    return level + 0.06 * (np.sin(2 * math.pi * fine * _U) * np.sin(2 * math.pi * fine * _V)) + 0.06 * noise(1, 6)


def tex_mesh():  # sneaker mesh: little holes
    d = np.hypot(((_U * 24) % 1) - 0.5, ((_V * 24) % 1) - 0.5)
    return np.where(d < 0.28, 0.62, 0.96) + 0.03 * noise(1, 7)


def tex_terry():  # towel loops
    return 0.78 + 0.22 * noise(1.1, 8) ** 0.7


def tex_leather():
    cells = noise(3, 9)
    return 0.8 + 0.18 * np.clip(np.abs(cells - 0.5) * 3, 0, 1) + 0.04 * noise(0.8, 10)


def tex_brushed():  # brushed aluminium
    streak = noise(0.6, 11)
    streak = np.repeat(streak.mean(axis=1, keepdims=True), TEX, axis=1)
    return 0.9 + 0.08 * streak + 0.03 * noise(0.7, 12)


def tex_pages():  # page edges: fine lines
    return 0.86 + 0.12 * (np.sin(2 * math.pi * 90 * _V) > 0) + 0.02 * noise(1, 13)


def tex_cork():
    return 0.7 + 0.3 * noise(0.9, 14) ** 1.5


def tex_paper():
    return 0.94 + 0.05 * noise(1, 15)


# =========================================================================== #
# Materials
# =========================================================================== #
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


_materials = {}


def material(name, color="#cccccc", rough=0.6, metal=0.0, tex=None, tint=False):
    """A material; `tex` is a grey array (multiplied by `color`). Reused by name."""
    key = ("tint_" if tint else "") + name
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(key)
    if not m.use_nodes:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgb = (1.0, 1.0, 1.0) if tint else hex_rgb(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex is not None:
        img = bpy.data.images.new(key, TEX, TEX)
        px = np.ones((TEX, TEX, 4), np.float32)
        g = np.clip(tex, 0, 1)
        for k in range(3):
            px[..., k] = g * rgb[k]
        img.pixels.foreach_set(px.ravel())
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    _materials[key] = m
    return m


def common():
    """Materials several models share."""
    return {
        "metal": material("metal", "#c9ccd1", 0.25, 1.0),
        "brass": material("brass", "#c9a24a", 0.3, 1.0),
        "zip": material("zip", "#1f2023", 0.45),
        "black": material("black", "#16171a", 0.5),
        "rubber": material("rubber", "#202124", 0.85),
        "white": material("white_plastic", "#f2f2ef", 0.4),
        "glass": material("glass", "#141a2e", 0.05),
        "thread": material("thread", "#d9a441", 0.7),
    }


# =========================================================================== #
# Geometry helpers (all sizes in cm)
# =========================================================================== #
def _box_uv(bm, tile):
    """Box-project UVs: each face takes the two axes it faces least along."""
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co[a] / tile, loop.vert.co[b] / tile)


def _link(name, bm, mat, tile, smooth=True):
    _box_uv(bm, tile)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def _place(bm, loc=(0, 0, 0), rot=(0, 0, 0)):
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") \
        @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def finish(ob, bevel=0.0, bseg=3, sub=0, wrinkle=0.0, wrinkle_size=4.0, angle=None):
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = bseg
        if angle is not None:
            b.limit_method = "ANGLE"
            b.angle_limit = math.radians(angle)
    if sub:
        s = ob.modifiers.new("sub", "SUBSURF")
        s.levels = s.render_levels = sub
    if wrinkle:
        t = bpy.data.textures.new(f"{ob.name}_w", "CLOUDS")
        t.noise_scale = wrinkle_size
        d = ob.modifiers.new("wrinkle", "DISPLACE")
        d.texture = t
        d.texture_coords = "LOCAL"
        d.strength = wrinkle
    return ob


def box(name, size, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), cuts=0, shape=None, tile=4.0, **fin):
    """Box of `size` centred on `loc`; `shape(v)` may move each vertex first."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    if shape:
        for v in bm.verts:
            shape(v)
    _place(bm, loc, rot)
    return finish(_link(name, bm, mat, tile), **fin)


def cyl(name, r, depth, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), seg=32, r2=None, tile=4.0, smooth=True, **fin):
    """Cylinder (or cone) along Z centred on `loc`, then rotated."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    _place(bm, loc, rot)
    ob = _link(name, bm, mat, tile, smooth)
    if smooth:  # keep the caps' edges crisp
        ob.data.set_sharp_from_angle(angle=math.radians(40)) if hasattr(ob.data, "set_sharp_from_angle") else None
    return finish(ob, **fin)


def ball(name, size, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), seg=24, tile=4.0, **fin):
    """Ellipsoid with diameters `size`."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=0.5)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    _place(bm, loc, rot)
    return finish(_link(name, bm, mat, tile), **fin)


def tube(name, pts, r, mat=None, seg=8, tile=1.0, flat=1.0, caps=True, **fin):
    """A round (or flattened: `flat` < 1 squashes it along Z) tube through `pts`."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        x = t.cross(up).normalized()
        y = t.cross(x).normalized()
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            off = x * math.cos(a) * r + y * math.sin(a) * r
            off.z *= flat
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return finish(_link(name, bm, mat, tile), **fin)


def ring(name, R, r, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), arc=360.0, start=0.0, scale=(1, 1, 1),
         seg=32, tube_seg=8, flat=1.0, tile=1.0, **fin):
    """Torus (or part of one) in the XY plane, through tube()."""
    n = max(3, int(seg * arc / 360))
    closed = arc >= 360
    pts = []
    for k in range(n + (0 if closed else 1)):
        a = math.radians(start + arc * k / n)
        pts.append(Matrix.Translation(Vector(loc)) @ _rot(rot) @ Vector((R * math.cos(a) * scale[0],
                                                                            R * math.sin(a) * scale[1], 0)))
    if closed:
        pts.append(pts[0])
    return tube(name, pts, r, mat, seg=tube_seg, flat=flat, caps=not closed, tile=tile, **fin)


def _rot(rot):
    return Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") \
        @ Matrix.Rotation(math.radians(rot[0]), 4, "X")


def spiral_roll(name, L, D, mat, turns=2.6, thick=0.55, tile=4.0, rot=(0, 0, 0), core=True, **fin):
    """A rolled-up piece of fabric along X (then turned by `rot`): a spiral
    sheet you can see in the end."""
    R = D / 2
    r0 = R * 0.18
    steps = int(turns * 28)
    bm = bmesh.new()
    inner, outer = [], []
    for k in range(steps + 1):
        a = 2 * math.pi * turns * k / steps
        r = r0 + (R - r0 - thick) * k / steps
        for lst, rr in ((inner, r), (outer, r + thick)):
            lst.append((rr * math.cos(a), rr * math.sin(a)))
    xs = (-L / 2, L / 2)
    grid = [[bm.verts.new((x, y, z)) for x in xs] for (y, z) in inner]
    grid_o = [[bm.verts.new((x, y, z)) for x in xs] for (y, z) in outer]
    for k in range(steps):
        a0, a1, b0, b1 = grid[k], grid[k + 1], grid_o[k], grid_o[k + 1]
        bm.faces.new((a0[0], a1[0], a1[1], a0[1]))  # inner surface
        bm.faces.new((b0[0], b0[1], b1[1], b1[0]))  # outer surface
        bm.faces.new((a0[0], b0[0], b1[0], a1[0]))  # end at -X
        bm.faces.new((a0[1], a1[1], b1[1], b0[1]))  # end at +X
    bm.faces.new((grid[0][0], grid[0][1], grid_o[0][1], grid_o[0][0]))
    bm.faces.new((grid[-1][0], grid_o[-1][0], grid_o[-1][1], grid[-1][1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    _place(bm, rot=rot)
    ob = _link(name, bm, mat, tile)
    if core:  # fill the middle so you can't see through it
        cyl(name + "_core", r0 * 1.02, L * 0.995, mat=mat, rot=(rot[0], rot[1] + 90, rot[2]), seg=12)
    return finish(ob, **fin)


def dome(name, size, loc=(0, 0, 0), mat=None, seg=28, tile=4.0, **fin):
    """The top half of an ellipsoid with diameters `size`, standing on `loc`."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=0.5)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context="VERTS")
    bmesh.ops.scale(bm, vec=Vector((size[0], size[1], size[2] * 2)), verts=bm.verts)
    _place(bm, loc)
    return finish(_link(name, bm, mat, tile), **fin)


def profile(t, points):
    """Piecewise-linear profile through (t, value) points, t in 0..1."""
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * (t - t0) / ((t1 - t0) or 1)
    return points[-1][1]


# =========================================================================== #
# Clothing
# =========================================================================== #
def folded_top(name, L, W, H, body, rib, *, collar=True, sleeves=True, tex_tile=3.0):
    """A folded top seen from above: a soft, puffy stack with the folded-over
    front layer, sleeve folds along the sides, a hem fold and a ribbed collar.
    Returns the z of the top surface."""
    base_h = H * 0.62
    # the folded fabric underneath: a few soft layers, so the folds show along
    # the edges, each slightly out of line with the one below
    n = 3
    lh = base_h / n
    for k in range(n):
        dx, dy, k_w = ((0.0, 0.0, 1.0), (0.35, -0.25, 0.985), (-0.2, 0.3, 0.97))[k]
        box(f"{name}_fold{k}", (L * k_w, W * k_w, lh * 1.25), (dx, dy, lh * (k + 0.55)), body, cuts=2,
            tile=tex_tile, bevel=lh * 0.6, bseg=2, sub=1, wrinkle=0.3, wrinkle_size=4.5 + k)
    # the front of the garment folded over on top, a little narrower
    lay_h = H * 0.42
    top = base_h + lay_h * 0.8
    box(f"{name}_layer", (L * 0.95, W * 0.86, lay_h), (L * 0.01, 0, base_h + lay_h * 0.3), body, cuts=3, tile=tex_tile,
        bevel=lay_h * 0.45, bseg=2, sub=1, wrinkle=0.25, wrinkle_size=2.2)
    if sleeves:  # the sleeves were folded back along each side: soft ridges with a diagonal end
        for s in (-1, 1):
            y = s * W * 0.33
            tube(f"{name}_sleeve{s}", [(-L * 0.42, y, top - 0.15), (-L * 0.05, y + s * 0.3, top - 0.05),
                                       (L * 0.2, y, top - 0.12), (L * 0.3, y - s * W * 0.1, top - 0.25)],
                 lay_h * 0.35, body, seg=8, flat=0.55, sub=1, tile=tex_tile)
    # a soft fold across the hem end
    tube(f"{name}_hem", [(-L * 0.4, -W * 0.38, top - 0.2), (-L * 0.41, 0, top - 0.1), (-L * 0.4, W * 0.38, top - 0.2)],
         lay_h * 0.3, rib, seg=8, flat=0.6, sub=1, tile=tex_tile)
    if collar:
        R = W * 0.21
        # the ribbed neckband, and the shadowed neck opening it frames
        ring(f"{name}_collar", R, 0.62, (L / 2 - R * 1.15, 0, top - 0.05), rib, arc=210, start=75,
             tube_seg=10, seg=40, flat=0.7, sub=1, tile=1.5)
        inside = material("inside", tex=np.full((TEX, TEX), 0.7), rough=1, tint=True)
        ball(f"{name}_neck", (R * 1.2, R * 1.45, 0.45), (L / 2 - R * 1.05, 0, top - 0.12), inside, seg=24)
    return top


def tshirt():
    L, W, H = 28, 20, 3
    body = material("jersey", tex=tex_jersey(), rough=0.9, tint=True)
    rib = material("rib", tex=tex_rib(), rough=0.9, tint=True)
    folded_top("tshirt", L, W, H, body, rib)


def polo():
    L, W, H = 28, 21, 3.5
    body = material("pique", tex=tex_weave(28, 0.86), rough=0.9, tint=True)
    rib = material("rib", tex=tex_rib(), rough=0.9, tint=True)
    top = folded_top("polo", L, W, H, body, rib, collar=False)
    m = common()
    R = W * 0.21
    # collar: two pointed flaps lying flat, and the band behind them
    ring("polo_band", R, 0.5, (L / 2 - R * 1.05, 0, top + 0.08), rib, arc=180, start=90, tube_seg=10, flat=0.7)
    for s in (-1, 1):
        box(f"polo_flap{s}", (R * 1.3, R * 0.85, 0.35), (L / 2 - R * 1.0, s * R * 0.55, top + 0.32), rib,
            rot=(0, 0, s * 28), bevel=0.3, bseg=2, sub=1)
    # placket with buttons
    box("polo_placket", (R * 1.6, 1.2, 0.25), (L / 2 - R * 2.0 - 1.4, 0, top + 0.08), rib, bevel=0.1, bseg=1)
    for k in range(2):
        cyl(f"polo_button{k}", 0.38, 0.18, (L / 2 - R * 2.0 - 0.6 - k * 1.7, 0, top + 0.28), m["white"], seg=16)


def dress_shirt():
    L, W, H = 30, 23, 4
    body = material("poplin", tex=tex_weave(60, 0.9), rough=0.7, tint=True)
    top = folded_top("dshirt", L, W, H, body, body, collar=False)
    m = common()
    R = W * 0.2
    # stand collar and pointed collar wings
    ring("dshirt_stand", R, 0.6, (L / 2 - R * 1.05, 0, top + 0.15), body, arc=200, start=80, tube_seg=10, flat=0.8)
    for s in (-1, 1):
        box(f"dshirt_wing{s}", (R * 1.5, R * 0.95, 0.3), (L / 2 - R * 1.05, s * R * 0.6, top + 0.45), body,
            rot=(0, 0, s * 32), bevel=0.25, bseg=2, sub=1)
    # placket and buttons down the front, pocket on the chest
    box("dshirt_placket", (L * 0.62, 1.5, 0.22), (-L * 0.06, 0, top + 0.06), body, bevel=0.1, bseg=1)
    for k in range(5):
        cyl(f"dshirt_button{k}", 0.4, 0.2, (L / 2 - R * 2.2 - k * 3.4, 0, top + 0.25), m["white"], seg=16)
    box("dshirt_pocket", (5.5, 5, 0.18), (L * 0.05, W * 0.22, top + 0.05), body, bevel=0.1, bseg=1)


def sweater():
    L, W, H = 32, 26, 7
    knit = material("knit", tex=tex_knit(), rough=1, tint=True)
    rib = material("rib", tex=tex_rib(0.78), rough=1, tint=True)
    top = folded_top("sweater", L, W, H, knit, rib, tex_tile=5.0)
    # cuffs at the ends of the folded sleeves
    for s in (-1, 1):
        box(f"sweater_cuff{s}", (3.2, W * 0.2, H * 0.22), (-L * 0.4, s * W * 0.37, top + 0.1), rib,
            bevel=0.5, bseg=2, sub=1)


def hoodie():
    L, W, H = 33, 27, 8
    body = material("fleece", tex=tex_jersey() * 0.96 + 0.02 * noise(3, 20), rough=1, tint=True)
    rib = material("rib", tex=tex_rib(0.8), rough=1, tint=True)
    top = folded_top("hoodie", L, W, H, body, rib, collar=False, tex_tile=4.0)
    m = common()
    # the hood, folded down flat at the collar end
    ball("hoodie_hood", (L * 0.32, W * 0.62, H * 0.42), (L * 0.3, 0, top + 0.2), body, seg=20, sub=1,
         wrinkle=0.15, wrinkle_size=3)
    shadow = material("inside", tex=np.full((TEX, TEX), 0.45), rough=1, tint=True)
    ball("hoodie_hood_in", (L * 0.2, W * 0.38, 0.5), (L * 0.3, 0, top + H * 0.2), shadow, seg=24)
    # drawstrings with aglets, and the kangaroo pocket
    for s in (-1, 1):
        tube(f"hoodie_string{s}", [(L * 0.18, s * 2.2, top + 0.5), (L * 0.02, s * 2.6, top + 0.15),
                                   (-L * 0.12, s * 2.3, top + 0.1)], 0.22, m["white"], seg=6)
        cyl(f"hoodie_aglet{s}", 0.26, 1.2, (-L * 0.14, s * 2.3, top + 0.1), m["metal"], rot=(0, 90, 0), seg=10)
    box("hoodie_pocket", (L * 0.3, W * 0.55, 0.3), (-L * 0.22, 0, top), rib, bevel=0.2, bseg=2)


def jacket():
    L, W, H = 35, 28, 7
    shell = material("shell", tex=tex_weave(50, 0.88), rough=0.55, tint=True)
    top = folded_top("jacket", L, W, H, shell, shell, collar=False, tex_tile=5.0)
    m = common()
    R = W * 0.22
    ring("jacket_collar", R, 0.9, (L / 2 - R * 1.1, 0, top + 0.2), shell, arc=200, start=80, tube_seg=10, flat=0.7)
    # the front zip down the middle, with its pull
    box("jacket_zip", (L * 0.8, 0.7, 0.2), (-L * 0.04, 0, top + 0.08), m["zip"])
    for k in range(40):
        box(f"jacket_tooth{k}", (0.32, 0.9, 0.12), (L * 0.36 - k * L * 0.8 / 40, 0, top + 0.2), m["metal"])
    box("jacket_pull", (1.8, 0.7, 0.3), (L * 0.34, 0.6, top + 0.35), m["metal"], bevel=0.12, bseg=2)
    for s in (-1, 1):  # pocket zips
        box(f"jacket_pocket{s}", (L * 0.28, 0.4, 0.15), (-L * 0.2, s * W * 0.24, top + 0.05), m["zip"], rot=(0, 0, s * 12))


def jeans():
    L, W, H = 32, 26, 5
    denim = material("denim", tex=tex_denim(), rough=0.95, tint=True)
    m = common()
    # two folded layers of leg, slightly offset, then the waistband end
    box("jeans_bottom", (L, W, H * 0.5), (0, 0, H * 0.25), denim, cuts=3, tile=3.0,
        bevel=H * 0.22, bseg=2, sub=1, wrinkle=0.15, wrinkle_size=3)
    box("jeans_top", (L * 0.96, W * 0.97, H * 0.45), (-L * 0.01, 0, H * 0.68), denim, cuts=3, tile=3.0,
        bevel=H * 0.2, bseg=2, sub=1, wrinkle=0.18, wrinkle_size=2.5)
    top = H * 0.9
    # waistband with belt loops, a button and the fly seam
    box("jeans_band", (3.2, W * 0.96, 0.55), (L / 2 - 1.8, 0, top), denim, bevel=0.25, bseg=2, sub=1)
    for y in (-0.38, -0.12, 0.12, 0.38):
        box(f"jeans_loop{y}", (2.6, 0.9, 0.25), (L / 2 - 1.8, y * W, top + 0.35), denim, bevel=0.1, bseg=1)
    cyl("jeans_button", 0.75, 0.35, (L / 2 - 1.8, W * 0.22, top + 0.4), m["brass"], seg=24)
    # back pocket outlines in orange thread, and rivets
    for s in (-1, 1):
        cx, cy = L * 0.12, s * W * 0.24
        pts = [(cx + 4.2, cy - 3.6, top), (cx - 3.0, cy - 3.0, top), (cx - 4.8, cy, top),
               (cx - 3.0, cy + 3.0, top), (cx + 4.2, cy + 3.6, top)]
        tube(f"jeans_pocket{s}", pts, 0.08, m["thread"], seg=5)
        for y in (-3.6, 3.6):
            cyl(f"jeans_rivet{s}{y}", 0.25, 0.15, (cx + 4.2, cy + y, top + 0.05), m["brass"], seg=10)


def shorts():
    L, W, H = 25, 20, 3.5
    cloth = material("twill", tex=tex_weave(36, 0.85), rough=0.9, tint=True)
    m = common()
    box("shorts_body", (L, W, H * 0.8), (0, 0, H * 0.4), cloth, cuts=3, tile=3.0,
        bevel=H * 0.35, bseg=2, sub=1, wrinkle=0.12, wrinkle_size=3)
    top = H * 0.8
    box("shorts_band", (3, W * 0.97, 0.6), (L / 2 - 1.6, 0, top), cloth, bevel=0.28, bseg=2, sub=1)
    for s in (-1, 1):  # drawstring
        tube(f"shorts_string{s}", [(L / 2 - 1.2, s * 0.6, top + 0.35), (L / 2 - 3.5, s * 1.4, top + 0.12),
                                   (L / 2 - 6.5, s * 1.1, top + 0.08)], 0.17, m["white"], seg=6)
    for s in (-1, 1):  # side pocket openings
        tube(f"shorts_pocket{s}", [(L / 2 - 3.2, s * W * 0.34, top + 0.02), (L / 2 - 9, s * W * 0.46, top - 0.1)],
             0.1, cloth, seg=5)


def roll():
    L, D = 14, 6
    knit = material("jersey", tex=tex_jersey(), rough=0.95, tint=True)
    spiral_roll("roll", L, D, knit, turns=2.8, thick=0.6, sub=1)


def towel_roll():
    L, D = 25, 10
    terry = material("terry", tex=tex_terry(), rough=1, tint=True)
    band = material("dobby", tex=tex_weave(30, 0.8), rough=0.9, tint=True)
    spiral_roll("towel", L, D, terry, turns=2.4, thick=1.3, tile=3.0, sub=1)
    for x in (-L / 2 + 1.6, L / 2 - 1.6):  # woven border bands near the ends (flush with the roll)
        cyl(f"towel_band{x}", D / 2 * 0.9, 1.2, (x, 0, 0), band, rot=(0, 90, 0), seg=40)


def socks():
    L, W, H = 12, 7, 6
    knit = material("sock_knit", tex=tex_jersey() * 0.97, rough=1, tint=True)
    rib = material("rib", tex=tex_rib(0.82), rough=1, tint=True)
    # a rolled-up pair: a soft bundle, with the cuff of one sock turned back
    # over it as a pocket (the ribbed band over the +X half, with a rolled edge)
    box("socks_bundle", (L * 0.97, W * 0.9, H * 0.9), (-L * 0.015, 0, 0), knit, cuts=2,
        bevel=min(W, H) * 0.44, bseg=3, sub=1, wrinkle=0.18, wrinkle_size=2)
    cuff_l = L * 0.42
    box("socks_cuff", (cuff_l, W, H), (L / 2 - cuff_l / 2, 0, 0), rib, cuts=1,
        bevel=min(W, H) * 0.42, bseg=3, sub=1, wrinkle=0.1, wrinkle_size=1.5)
    ring("socks_edge", 1, 0.45, (L / 2 - cuff_l, 0, 0), rib, rot=(0, 90, 0), scale=(H * 0.47, W * 0.47, 1),
         seg=32, tube_seg=8)


# =========================================================================== #
# Shoes
# =========================================================================== #
def loft(name, sections, mat, ring=20, flat_bottom=True, tile=3.0, **fin):
    """A smooth closed shape through cross-sections along X.

    sections: (x, width, height, z0, roundness) from one end to the other;
    each section is a superellipse `width` wide and `height` tall standing on
    z0 (roundness 2 = ellipse, higher = squarer). With flat_bottom the lower
    half is squashed flat, like the sole of a shoe.
    """
    bm = bmesh.new()
    rings = []
    for x, w, h, z0, n in sections:
        pts = []
        for k in range(ring):
            a = 2 * math.pi * k / ring
            c, s = math.cos(a), math.sin(a)
            y = w / 2 * math.copysign(abs(c) ** (2 / n), c)
            zz = math.copysign(abs(s) ** (2 / n), s)
            z = z0 + (h * zz if zz > 0 else (h * 0.06 * zz if flat_bottom else h * zz))
            pts.append(bm.verts.new((x, y, z)))
        rings.append(pts)
    for a, b in zip(rings, rings[1:]):
        for k in range(ring):
            bm.faces.new((a[k], b[k], b[(k + 1) % ring], a[(k + 1) % ring]))
    for pts, rev in ((rings[0], True), (rings[-1], False)):  # close the ends with a fan
        c = bm.verts.new(sum((v.co for v in pts), Vector()) / len(pts))
        for k in range(ring):
            f = (pts[k], pts[(k + 1) % ring], c)
            bm.faces.new(f[::-1] if not rev else f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return finish(_link(name, bm, mat, tile), **fin)


# Foot outline from heel (t = 0) to toe (t = 1): (t, width share, upper height share)
FOOT = [(0.0, 0.40, 0.70), (0.03, 0.62, 0.86), (0.1, 0.72, 0.92), (0.22, 0.76, 0.9), (0.38, 0.78, 0.8),
        (0.55, 0.92, 0.66), (0.7, 1.0, 0.55), (0.82, 0.98, 0.47), (0.91, 0.86, 0.38), (0.97, 0.62, 0.28),
        (1.0, 0.30, 0.18)]


def shoe(name, l, w, h, side, style):
    m = common()
    sole_h = {"sneaker": 2.6, "dress": 1.3, "boot": 2.4, "sandal": 1.8}[style]
    sole_mat, upper_mat = {
        "sneaker": (material("sole", "#f4f3ef", 0.65), material("mesh", tex=tex_mesh(), rough=0.85, tint=True)),
        "dress": (material("leather_sole", "#3a2416", 0.6), material("leather", tex=tex_leather(), rough=0.3, tint=True)),
        "boot": (material("lug_sole", "#2a2622", 0.85), material("suede", tex=tex_leather() * 0.95, rough=0.8, tint=True)),
        "sandal": (material("rubber_sole", "#2a2724", 0.85), material("strap", tex=tex_leather(), rough=0.55, tint=True)),
    }[style]
    x0 = -l / 2
    # the inside edge curves in a little (left and right shoes mirror each other)
    bend = lambda t: side * 0.07 * w * math.sin(math.pi * min(1.0, t * 1.1))  # noqa: E731
    spring = lambda t: 1.2 * max(0.0, (t - 0.78) / 0.22) ** 2  # toe lifts off the ground  # noqa: E731

    def sections(width_k, height_fn, z_fn, n):
        out = []
        for t, wk, hk in FOOT:
            out.append((x0 + t * l, max(0.3, w * wk * width_k), max(0.2, height_fn(t, hk)), z_fn(t), n))
        return out

    # sole: flared a little wider than the upper, toe spring at the front
    sole = loft(f"{name}_sole", sections(1.04, lambda t, hk: sole_h, spring, 6), sole_mat, sub=1)
    for v in sole.data.vertices:
        v.co.y += bend((v.co.x - x0) / l)
    if style == "sneaker":  # darker tread band at the bottom of the white midsole
        tread = loft(f"{name}_tread", sections(1.05, lambda t, hk: 0.6, lambda t: spring(t) - 0.02, 6), m["rubber"], ring=16)
        for v in tread.data.vertices:
            v.co.y += bend((v.co.x - x0) / l)

    if style == "sandal":
        bed = material("cork", tex=tex_cork(), color="#b98a5e", rough=0.9)
        footbed = loft(f"{name}_bed", sections(0.97, lambda t, hk: 0.6, lambda t: sole_h - 0.1 + spring(t), 5), bed, sub=1)
        for v in footbed.data.vertices:
            v.co.y += bend((v.co.x - x0) / l)
        top = sole_h + 0.5
        for k, t in enumerate((0.66, 0.4)):  # two wide straps arching over the foot
            x = x0 + t * l
            half = w * profile(t, [(p[0], p[1]) for p in FOOT]) * 0.46
            pts = [(x, -half * math.cos(a) + bend(t), top + (h - top) * 0.9 * math.sin(a)) for a in np.linspace(0, math.pi, 13)]
            tube(f"{name}_strap{k}", pts, 1.7, upper_mat, seg=10, flat=0.22, sub=1)
            box(f"{name}_buckle{k}", (1.8, 0.35, 1.3), (x, half + bend(t) + 0.1, top + (h - top) * 0.35), m["brass"],
                bevel=0.12, bseg=1)
        return

    up_h = h - sole_h
    boot = style == "boot"
    hfn = (lambda t, hk: up_h * (1.0 if t < 0.4 else profile(t, [(0.4, 1.0), (0.55, 0.6), (0.8, 0.45), (1, 0.18)]))) \
        if boot else (lambda t, hk: up_h * hk)
    upper = loft(f"{name}_upper", sections(0.96, hfn, lambda t: sole_h - 0.3 + spring(t), 2.6), upper_mat, ring=28, sub=1)
    for v in upper.data.vertices:
        v.co.y += bend((v.co.x - x0) / l)

    def top_at(t):
        return sole_h - 0.3 + spring(t) + hfn(t, profile(t, [(p[0], p[2]) for p in FOOT]))

    def width_at(t):
        return w * 0.96 * profile(t, [(p[0], p[1]) for p in FOOT])

    # opening: dark lining inside a padded collar
    open_t = 0.2 if not boot else 0.16
    ox = x0 + open_t * l
    lining = material("lining", "#2b2b2e", 0.9)
    ball(f"{name}_opening", (l * 0.26, width_at(open_t) * 0.62, 1.0), (ox + l * 0.02, bend(open_t), top_at(open_t) - 0.35),
         lining, seg=18)
    ring(f"{name}_collar", 1, 0.75, (ox + l * 0.02, bend(open_t), top_at(open_t) - 0.2), upper_mat,
         scale=(l * 0.135, width_at(open_t) * 0.33, 1), seg=36, tube_seg=8)
    # tongue, laces and eyelets
    t0, t1 = (0.34, 0.62) if not boot else (0.2, 0.55)
    n_laces = {"sneaker": 6, "dress": 4, "boot": 7}[style]
    tongue_mat = upper_mat if style != "sneaker" else material("tongue", tex=tex_weave(30, 0.9), rough=0.9, tint=True)
    tx = x0 + (t0 - 0.03) * l
    box(f"{name}_tongue", ((t1 - t0 + 0.06) * l, width_at((t0 + t1) / 2) * 0.36, 0.7),
        (tx + (t1 - t0 + 0.06) * l / 2, bend((t0 + t1) / 2), (top_at(t0) + top_at(t1)) / 2 + 0.25),
        tongue_mat, rot=(0, math.degrees(math.atan2(top_at(t0) - top_at(t1), (t1 - t0) * l)), 0),
        bevel=0.3, bseg=2, sub=1)
    lace = m["white"] if style == "sneaker" else m["black"]
    for k in range(n_laces):
        t = t0 + (t1 - t0) * k / (n_laces - 1)
        x = x0 + t * l
        half = width_at(t) * 0.2
        z = top_at(t) + 0.05
        y0 = bend(t)
        tube(f"{name}_lace{k}", [(x - 0.45, y0 - half, z - 0.1), (x, y0, z + 0.35), (x + 0.45, y0 + half, z - 0.1)],
             0.17, lace, seg=6)
        for s in (-1, 1):
            cyl(f"{name}_eyelet{k}{s}", 0.3, 0.12, (x, y0 + s * half * 1.12, z - 0.12), m["metal"], seg=8)
    if style == "sneaker":
        # heel tab, toe cap and a side stripe
        box(f"{name}_heeltab", (0.8, width_at(0.03) * 0.3, 2.4), (x0 + 0.25, bend(0.03), top_at(0.03) - 0.8),
            m["white"], bevel=0.3, bseg=2, sub=1)
        for s in (-1, 1):
            pts = []
            for t in np.linspace(0.12, 0.62, 9):
                pts.append((x0 + t * l, bend(t) + s * width_at(t) * 0.5, sole_h + 0.8 + 2.6 * math.sin(math.pi * (t - 0.12) / 0.5) ** 0.7))
            tube(f"{name}_stripe{s}", pts, 0.45, m["white"], seg=6, flat=0.5)
    if style == "dress":  # stitched welt round the sole edge
        pts = [(x0 + t * l, bend(t) + width_at(t) * 0.53, sole_h + 0.05) for t in np.linspace(0.02, 0.98, 30)]
        tube(f"{name}_welt", pts, 0.12, material("welt_thread", "#c8b48a", 0.8), seg=5)


def shoe_pair(model, l, W, h, style):
    w = W / 2 * 0.97
    for i, s in enumerate((-1, 1)):
        before = set(bpy.data.objects)
        shoe(f"{model}{i}", l, w, h, s, style)
        for ob in set(bpy.data.objects) - before:
            ob.location.y += s * W / 4


def sneakers():
    shoe_pair("sneaker", 31, 22, 12, "sneaker")


def dress_shoes():
    shoe_pair("dress", 30, 20, 11, "dress")


def boots():
    shoe_pair("boot", 29, 20, 17, "boot")


def sandals():
    shoe_pair("sandal", 27, 20, 5, "sandal")


# =========================================================================== #
# Electronics
# =========================================================================== #
def laptop():
    L, W, H = 30.5, 21.5, 1.6
    alu = material("aluminium", tex=tex_brushed(), rough=0.3, metal=0.6, tint=True)
    m = common()
    half = H / 2
    box("laptop_base", (L, W, half - 0.02), (0, 0, half / 2), alu, bevel=0.35, bseg=3, angle=60)
    box("laptop_lid", (L, W, half - 0.06), (0, 0, half + half / 2 + 0.02), alu, bevel=0.35, bseg=3, angle=60)
    box("laptop_gap", (L * 0.995, W * 0.995, 0.08), (0, 0, half), m["black"])
    cyl("laptop_logo", 1.3, 0.04, (0, 0, H + 0.01), material("logo", "#e9ebee", 0.15, 0.8), seg=36)
    box("laptop_hinge", (L * 0.7, 0.5, 0.45), (0, W / 2 - 0.15, half), m["black"], bevel=0.2, bseg=3)
    box("laptop_notch", (3.2, 0.6, 0.25), (0, -W / 2 + 0.2, half), m["black"], bevel=0.1, bseg=2)
    for x in (-L * 0.4, L * 0.4):
        for y in (-W * 0.4, W * 0.4):
            cyl(f"laptop_foot{x}{y}", 0.55, 0.12, (x, y, -0.04), m["rubber"], seg=16)
    for y in (-W * 0.2, -W * 0.28):  # ports on the left side
        box(f"laptop_port{y}", (0.2, 0.95, 0.3), (-L / 2, y, half / 2), m["black"], bevel=0.05, bseg=1)


def power_bank():
    L, W, H = 15, 7.5, 2.2
    shell = material("soft_touch", tex=tex_paper() * 0.98, rough=0.55, tint=True)
    m = common()
    box("pb_body", (L, W, H), (0, 0, H / 2), shell, bevel=min(H * 0.45, 0.9), bseg=4, sub=1)
    for k, y in enumerate((-W * 0.22, W * 0.05)):  # USB-A and USB-C ports
        box(f"pb_port{k}", (0.3, 1.25 if k == 0 else 0.85, 0.45 if k == 0 else 0.3), (L / 2 - 0.1, y, H / 2),
            m["black"], bevel=0.08 if k else 0.03, bseg=2)
    for k in range(4):  # charge LEDs
        cyl(f"pb_led{k}", 0.16, 0.06, (L * 0.3 + k * 0.5, W * 0.3, H + 0.005), material("led", "#5ad2ff", 0.1), seg=10)
    box("pb_button", (0.9, 0.08, 0.5), (L * 0.3, -W / 2 - 0.02, H / 2), m["black"], bevel=0.04, bseg=2)


def charger():
    L, W, H = 10, 7, 3
    shell = material("gloss_plastic", tex=tex_paper(), rough=0.25, tint=True)
    m = common()
    box("charger_brick", (L * 0.62, W, H), (L * 0.19, 0, H / 2), shell, bevel=0.9, bseg=4, sub=1)
    for s in (-1, 1):  # folded prongs
        box(f"charger_prong{s}", (2.4, 0.25, 0.6), (L * 0.28, s * 0.85, H - 0.08), m["metal"], bevel=0.05, bseg=1)
    box("charger_slot", (2.8, 2.2, 0.15), (L * 0.28, 0, H - 0.02), m["black"], bevel=0.1, bseg=2)
    box("charger_port", (0.2, 0.95, 0.35), (-L * 0.12, 0, H / 2), m["black"], bevel=0.06, bseg=2)
    # the cable, coiled next to the brick
    cable = material("cable", tex=tex_paper(), rough=0.5, tint=True)
    for k in range(4):
        ring(f"charger_coil{k}", 1.6 - k * 0.05, 0.22, (-L * 0.3, 0, 0.3 + k * 0.42), cable,
             scale=(1, W / 3.4, 1), seg=32, tube_seg=6)
    box("charger_plug", (1.6, 1.0, 0.7), (-L * 0.3 + 1.4, W * 0.28, H * 0.55), cable, bevel=0.2, bseg=2)


def camera():
    L, W, H = 13, 10, 9
    body = material("camera_body", tex=tex_leather() * 0.9 + 0.1, rough=0.55, tint=True)
    m = common()
    bw = W * 0.45
    by = W / 2 - bw / 2
    box("cam_body", (L, bw, H * 0.68), (0, by, H * 0.34), body, bevel=0.6, bseg=3, sub=1)
    box("cam_grip", (L * 0.24, bw * 0.4, H * 0.64), (L * 0.36, by - bw * 0.42, H * 0.33), m["rubber"],
        bevel=0.8, bseg=3, sub=1)
    box("cam_hump", (L * 0.3, bw * 0.75, H * 0.2), (-L * 0.05, by + bw * 0.05, H * 0.76), body, bevel=0.4, bseg=3, sub=1)
    cyl("cam_dial1", 0.95, 0.65, (L * 0.3, by, H * 0.71), m["metal"], seg=32)
    cyl("cam_dial2", 1.15, 0.7, (-L * 0.33, by, H * 0.71), m["metal"], seg=32)
    cyl("cam_shutter", 0.45, 0.3, (L * 0.36, by - bw * 0.3, H * 0.69), m["black"], seg=20)
    # the lens, pointing to -Y
    lens_l = W - bw
    lx, lz = -L * 0.04, H * 0.36
    cyl("cam_mount", H * 0.33, 0.4, (lx, by - bw / 2 - 0.2, lz), m["metal"], rot=(90, 0, 0), seg=40)
    cyl("cam_lens", H * 0.3, lens_l - 0.4, (lx, -W / 2 + (lens_l - 0.4) / 2, lz), m["black"], rot=(90, 0, 0), seg=40)
    for k in range(7):  # focus ring ribs
        cyl(f"cam_rib{k}", H * 0.305, 0.18, (lx, -W / 2 + 1.2 + k * 0.32, lz), m["rubber"], rot=(90, 0, 0), seg=40)
    cyl("cam_glass", H * 0.22, 0.06, (lx, -W / 2 - 0.01, lz), m["glass"], rot=(90, 0, 0), seg=36)
    ring("cam_glass_rim", H * 0.25, 0.12, (lx, -W / 2, lz), m["metal"], rot=(90, 0, 0), seg=40, tube_seg=6)


def glasses_case():
    L, W, H = 16, 7, 5
    shell = material("case_leather", tex=tex_leather(), rough=0.45, tint=True)
    m = common()
    # a hard clamshell: rounded capsule, the seam where the two halves meet
    box("gcase_shell", (L, W, H), (0, 0, H / 2), shell, cuts=2, bevel=min(W, H) * 0.47, bseg=4, sub=1)
    hl, hw, rc = L / 2 - 0.02, W / 2 - 0.02, min(W, H) * 0.47
    pts = []
    for cx, cy, a0 in ((hl - rc, hw - rc, 0), (-hl + rc, hw - rc, 90), (-hl + rc, -hw + rc, 180), (hl - rc, -hw + rc, 270)):
        for ang in np.linspace(a0, a0 + 90, 8):
            pts.append((cx + rc * math.cos(math.radians(ang)), cy + rc * math.sin(math.radians(ang)), H * 0.5))
    pts.append(pts[0])
    tube("gcase_seam", pts, 0.1, m["black"], seg=5, caps=False)
    box("gcase_hinge", (L * 0.35, 0.4, 0.4), (0, W / 2 - 0.25, H * 0.48), m["metal"], bevel=0.1, bseg=2)


# =========================================================================== #
# Bags & cubes
# =========================================================================== #
def _zip_around(name, L, W, z, inset, m, pull_at=(1, 0)):
    """A zip running round a rectangle (with rounded corners) at height z."""
    hl, hw, rc = L / 2 - inset, W / 2 - inset, min(L, W) * 0.18
    pts = []
    for cx, cy, a0 in ((hl - rc, hw - rc, 0), (-hl + rc, hw - rc, 90), (-hl + rc, -hw + rc, 180), (hl - rc, -hw + rc, 270)):
        for a in np.linspace(a0, a0 + 90, 7):
            pts.append((cx + rc * math.cos(math.radians(a)), cy + rc * math.sin(math.radians(a)), z))
    pts.append(pts[0])
    tube(f"{name}_zip", pts, 0.28, m["zip"], seg=6, flat=0.6, caps=False)
    px = pull_at[0] * (hl - 0.2)
    box(f"{name}_slider", (1.0, 1.4, 0.45), (px, pull_at[1], z + 0.2), m["metal"], bevel=0.12, bseg=2)
    box(f"{name}_pull", (2.4, 0.9, 0.18), (px + 1.5, pull_at[1], z + 0.3), m["metal"], rot=(0, -8, 0), bevel=0.08, bseg=2)


def pouch():
    L, W, H = 24, 14, 11
    nylon = material("nylon", tex=tex_weave(44, 0.86), rough=0.6, tint=True)
    m = common()
    box("pouch_body", (L - 1.6, W, H), (0.8, 0, H / 2), nylon, cuts=3, tile=4.0,
        bevel=min(W, H) * 0.42, bseg=4, sub=1, wrinkle=0.18, wrinkle_size=4)
    _zip_around("pouch", L - 1.6, W, H - 0.15, W * 0.12, m)
    # webbing carry loop on the end
    web = material("webbing", tex=tex_weave(60, 0.75), rough=0.8, tint=True)
    ring("pouch_loop", 2.2, 0.5, (-L / 2 + 1.2, 0, H * 0.55), web, rot=(90, 0, 0), arc=180, start=90,
         seg=20, tube_seg=8, flat=0.4)


def packing_cube():
    L, W, H = 25, 18, 9
    nylon = material("ripstop", tex=tex_weave(30, 0.85), rough=0.6, tint=True)
    mesh = material("cube_mesh", tex=tex_mesh() * 0.75, rough=0.9, tint=True)
    m = common()
    box("cube_body", (L, W, H), (0, 0, H / 2), nylon, cuts=3, tile=4.0, bevel=2.2, bseg=4, sub=1,
        wrinkle=0.15, wrinkle_size=5)
    box("cube_window", (L * 0.78, W * 0.7, 0.3), (0, 0, H + 0.02), mesh, bevel=1.2, bseg=3, sub=1)
    _zip_around("cube", L, W, H - 0.05, 0.9, m, pull_at=(1, -W * 0.2))
    web = material("webbing", tex=tex_weave(60, 0.75), rough=0.8, tint=True)
    box("cube_handle", (0.35, 5.5, 1.6), (-L / 2 - 0.1, 0, H * 0.62), web, bevel=0.15, bseg=2)


def flask():
    D, H = 7.5, 24
    r = D / 2
    coat = material("powder_coat", tex=tex_paper() * 0.97, rough=0.45, tint=True)
    m = common()
    cap_h = H * 0.15
    cyl("flask_body", r, H - cap_h - 0.6, (0, 0, (H - cap_h - 0.6) / 2), coat, seg=48, bevel=0.5, bseg=3)
    cyl("flask_neck", r * 0.82, 0.8, (0, 0, H - cap_h - 0.4), m["metal"], seg=48)
    cyl("flask_cap", r * 0.86, cap_h, (0, 0, H - cap_h / 2), m["black"], seg=48, bevel=0.4, bseg=3)
    ring("flask_loop", r * 0.5, 0.35, (0, 0, H - 0.1), m["black"], rot=(90, 0, 0), arc=180, start=0,
         seg=20, tube_seg=8)


# =========================================================================== #
# Documents
# =========================================================================== #
def book():
    L, W, H = 20, 13, 3
    cover = material("book_cloth", tex=tex_weave(70, 0.88), rough=0.7, tint=True)
    pages = material("pages", tex=tex_pages(), color="#f3ecd9", rough=0.9)
    for z in (0.15, H - 0.15):
        box(f"book_board{z}", (L, W, 0.3), (0.1, 0, z), cover, bevel=0.12, bseg=2)
    box("book_block", (L - 0.5, W - 0.6, H - 0.3), (0.25, 0.3, H / 2), pages, bevel=0.1, bseg=1)
    # rounded spine along the -Y edge
    cyl("book_spine", H / 2, L, (0.1, -W / 2 + 0.4, H / 2), cover, rot=(0, 90, 0), seg=24)


def passport():
    L, W, H = 12.5, 9, 0.8
    cover = material("passport_cover", tex=tex_leather(), rough=0.6, tint=True)
    pages = material("pages", tex=tex_pages(), color="#f3ecd9", rough=0.9)
    gold = material("gold_foil", "#d8b55a", 0.3, 1.0)
    box("pp_back", (L, W, 0.12), (0, 0, 0.06), cover, bevel=0.5, bseg=3, angle=80)
    box("pp_front", (L, W, 0.12), (0, 0, H - 0.06), cover, bevel=0.5, bseg=3, angle=80)
    box("pp_pages", (L - 0.3, W - 0.3, H - 0.24), (0.1, 0, H / 2), pages, bevel=0.4, bseg=2, angle=80)
    cyl("pp_spine", H / 2, L, (0, -W / 2 + 0.25, H / 2), cover, rot=(0, 90, 0), seg=16)
    # gold crest and title on the cover
    ring("pp_crest", 1.25, 0.09, (0.4, 0, H + 0.01), gold, seg=40, tube_seg=4, flat=0.4)
    cyl("pp_crest_in", 0.7, 0.04, (0.4, 0, H + 0.01), gold, seg=24)
    box("pp_title", (0.35, W * 0.5, 0.03), (L * 0.33, 0, H + 0.01), gold)
    box("pp_chip", (0.9, 1.3, 0.03), (-L * 0.36, 0, H + 0.01), gold)


def folder():
    L, W, H = 33, 24, 1.5
    plastic = material("folder_plastic", tex=tex_weave(80, 0.9), rough=0.35, tint=True)
    paper = material("paper", tex=tex_paper(), color="#fbfbf8", rough=0.95)
    elastic = material("elastic", "#1b1c1f", 0.8)
    box("folder_back", (L, W, 0.12), (0, 0, 0.06), plastic, bevel=0.5, bseg=3, angle=80)
    for k in range(3):  # documents inside, a little out of line
        box(f"folder_paper{k}", (L - 1.6 - k * 0.3, W - 1.2, 0.25), (0.3 * k - 0.4, -0.3 + 0.25 * k, 0.3 + k * 0.28),
            paper, rot=(0, 0, (k - 1) * 0.6))
    box("folder_front", (L, W, 0.12), (0, 0, H - 0.18), plastic, bevel=0.5, bseg=3, angle=80)
    # the closing flap folded over the top edge, and a label to write on
    box("folder_flap", (L * 0.99, W * 0.24, 0.12), (0, W * 0.38, H - 0.04), plastic, bevel=0.4, bseg=3, angle=80)
    box("folder_label", (L * 0.24, W * 0.1, 0.03), (-L * 0.18, -W * 0.08, H - 0.1),
        material("label", tex=tex_paper(), color="#ffffff", rough=0.9))
    for s in (-1, 1):  # elastic bands wrapped round the two front corners
        pts = [(s * (L / 2 - 2.4), -W / 2 - 0.15, H - 0.08), (s * (L / 2 + 0.15), -W / 2 + 2.4, H - 0.08)]
        tube(f"folder_band{s}", pts, 0.22, elastic, seg=6, flat=0.5)


# =========================================================================== #
# More clothing and accessories
# =========================================================================== #
def blazer():
    L, W, H = 40, 30, 6
    wool = material("wool", tex=tex_weave(70, 0.84) * 0.97 + 0.03 * noise(2, 30), rough=0.85, tint=True)
    top = folded_top("blazer", L, W, H, wool, wool, collar=False, tex_tile=5.0)
    m = common()
    # lapels opening into a V towards the collar end, two buttons, pocket flaps
    for s in (-1, 1):
        box(f"blazer_lapel{s}", (L * 0.42, W * 0.14, 0.35), (L * 0.22, s * W * 0.1, top + 0.15), wool,
            rot=(0, 0, -s * 14), bevel=0.25, bseg=2, sub=1)
    ring("blazer_collar", W * 0.17, 0.7, (L / 2 - W * 0.2, 0, top + 0.1), wool, arc=180, start=90, tube_seg=8, flat=0.6)
    for k in range(2):
        cyl(f"blazer_button{k}", 0.75, 0.3, (-L * 0.02 - k * 4.5, 0, top + 0.25), m["black"], seg=20)
    for s in (-1, 1):
        box(f"blazer_flap{s}", (L * 0.18, 0.5, 1.6), (-L * 0.22, s * W * 0.3, top + 0.08), wool,
            rot=(90, 0, 0), bevel=0.15, bseg=2)


def dress():
    L, W, H = 32, 24, 4
    cloth = material("crepe", tex=tex_jersey() * 0.95 + 0.05 * noise(4, 31), rough=0.8, tint=True)
    top = folded_top("dress", L, W, H, cloth, cloth, collar=False, sleeves=False, tex_tile=3.0)
    # scoop neckline and the waist seam
    ring("dress_neck", W * 0.22, 0.4, (L / 2 - W * 0.25, 0, top + 0.02), cloth, arc=220, start=70, tube_seg=8, flat=0.6)
    tube("dress_waist", [(-L * 0.02, -W * 0.42, top - 0.02), (-L * 0.04, 0, top + 0.08), (-L * 0.02, W * 0.42, top - 0.02)],
         0.3, cloth, seg=6, flat=0.6)
    for s in (-1, 1):  # gathered folds of the skirt
        tube(f"dress_pleat{s}", [(-L * 0.08, s * W * 0.18, top), (-L * 0.42, s * W * 0.24, top - 0.1)], 0.35, cloth, seg=6, flat=0.5)


def swimsuit():
    L, W, H = 20, 15, 2.5
    lycra = material("lycra", tex=tex_jersey() * 0.9 + 0.1, rough=0.35, tint=True)
    box("swim_body", (L, W, H * 0.8), (0, 0, H * 0.4), lycra, cuts=2, bevel=H * 0.36, bseg=3, sub=1,
        wrinkle=0.18, wrinkle_size=2.5)
    for s in (-1, 1):  # shoulder straps lying in loops on top
        ring(f"swim_strap{s}", W * 0.13, 0.32, (L * 0.22, s * W * 0.22, H * 0.85), lycra, scale=(1.6, 1, 1),
             seg=28, tube_seg=6, flat=0.5)
    ring("swim_leg", W * 0.3, 0.3, (-L * 0.2, 0, H * 0.85), lycra, arc=180, start=90, scale=(0.8, 1, 1),
         seg=24, tube_seg=6, flat=0.5)


def cap():
    L, W, H = 27, 19, 12
    twill = material("cap_twill", tex=tex_weave(40, 0.86), rough=0.85, tint=True)
    m = common()
    crown_l = L * 0.66
    cx = -L / 2 + crown_l / 2
    dome("cap_crown", (crown_l, W, H * 0.97), (cx, 0, 0), twill, seg=32, sub=1)
    # six panel seams over the crown, and the button on top
    for k in range(6):
        a = math.radians(k * 60)
        pts = [(cx + math.cos(a) * crown_l / 2 * math.sin(t) * 0.99, math.sin(a) * W / 2 * math.sin(t) * 0.99,
                H * 0.97 * math.cos(t)) for t in np.linspace(0.05, math.pi / 2 - 0.02, 8)]
        tube(f"cap_seam{k}", pts, 0.08, twill, seg=4)
    cyl("cap_button", 0.9, 0.5, (cx, 0, H * 0.97), twill, seg=16, bevel=0.2, bseg=2)
    # the brim: a rounded D sticking out at the front, curving down at the sides
    brim_l = L - crown_l * 0.55
    bm = bmesh.new()
    rows, arc = 5, 20
    grid = []
    for i in range(rows + 1):  # half-ellipse, from its straight edge (under the crown) outwards
        f = 0.15 + 0.85 * i / rows
        row = []
        for k in range(arc + 1):
            a = math.pi * (k / arc - 0.5)
            x, y = brim_l * f * math.cos(a), W * 0.43 * f * math.sin(a)
            row.append(bm.verts.new((x, y, 0.8 - 0.012 * y ** 2 - 0.004 * x ** 2)))
        grid.append(row)
    for r0, r1 in zip(grid, grid[1:]):
        for k in range(arc):
            bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.4)
    _place(bm, (cx + crown_l * 0.22, 0, 0))
    finish(_link("cap_brim", bm, twill, 4.0), sub=1)
    ring("cap_band", 1, 0.25, (cx, 0, 0.3), m["black"], scale=(crown_l / 2, W / 2, 1), seg=40, tube_seg=4)


def sun_hat():
    D, H = 30, 8
    straw = material("straw", tex=tex_weave(26, 0.78) * 0.95 + 0.05 * noise(1, 32), rough=0.95, tint=True)
    band = material("ribbon", "#3b3a36", 0.6)
    cyl("hat_brim", D / 2, 0.5, (0, 0, 0.25), straw, seg=48, bevel=0.2, bseg=2, sub=1, wrinkle=0.6, wrinkle_size=8)
    dome("hat_crown", (D * 0.52, D * 0.52, H * 0.92), (0, 0, 0.4), straw, seg=32, sub=1)
    cyl("hat_band", D * 0.262, 1.6, (0, 0, 1.3), band, seg=48)


def flip_flops():
    l, W, h = 27, 21, 3
    w = W / 2 * 0.95
    foam = material("eva_foam", tex=noise(1.5, 33) * 0.08 + 0.9, rough=0.9, tint=True)
    strap = material("flipflop_strap", "#20242a", 0.6)
    for i, side in enumerate((-1, 1)):
        y0 = side * W / 4
        x0 = -l / 2
        secs = [(x0 + t * l, w * wk * 1.0, 1.4, 0, 5) for t, wk, _ in FOOT]
        sole = loft(f"ff{i}_sole", secs, foam, sub=1)
        for v in sole.data.vertices:
            v.co.y += y0 + side * 0.06 * w * math.sin(math.pi * (v.co.x - x0) / l)
        post = (x0 + 0.78 * l, y0 - side * w * 0.12, 1.5)
        for s in (-1, 1):  # the Y strap from the toe post to each side
            pts = [post, (x0 + 0.62 * l, y0 + s * w * 0.25, h * 0.95), (x0 + 0.5 * l, y0 + s * w * 0.42, 1.3)]
            tube(f"ff{i}_strap{s}", pts, 0.55, strap, seg=8, flat=0.45)
        cyl(f"ff{i}_post", 0.45, 1.2, (post[0], post[1], 1.6), strap, seg=10)


def tube_model():
    L, W, H = 16, 5, 3.5
    plastic = material("tube_plastic", tex=tex_paper() * 0.97, rough=0.35, tint=True)
    m = common()
    cap_l = 2.0
    # round at the cap end, squeezed flat towards the crimped end
    secs = []
    for k in range(9):
        t = k / 8
        x = L / 2 - cap_l - t * (L - cap_l - 0.8)
        secs.append((x, W * (0.62 + 0.38 * t), H * (0.95 - 0.8 * t) / 2, -H * (0.95 - 0.8 * t) / 4, 2 + 6 * t))
    loft("tube_body", secs, plastic, ring=20, flat_bottom=False, sub=1)
    box("tube_crimp", (0.9, W, 0.35), (-L / 2 + 0.45, 0, 0), plastic, bevel=0.1, bseg=1)
    cyl("tube_cap", H * 0.36, cap_l, (L / 2 - cap_l / 2, 0, 0), m["white"], rot=(0, 90, 0), seg=24, bevel=0.15, bseg=2)
    box("tube_label", (L * 0.4, 0.05, H * 0.35), (0, -W * 0.36, 0), material("tube_print", "#ffffff", 0.4))


def hair_dryer():
    L, W, H = 22, 16, 8
    shell = material("dryer_plastic", tex=tex_paper() * 0.97, rough=0.4, tint=True)
    m = common()
    r = H / 2
    # barrel along X, with the folding handle tucked alongside it
    cyl("dryer_barrel", r, L * 0.62, (L * 0.12, W / 2 - r, r), shell, rot=(0, 90, 0), seg=36, bevel=0.6, bseg=3)
    cyl("dryer_nozzle", r * 0.8, L * 0.2, (L * 0.12 + L * 0.41, W / 2 - r, r), shell, rot=(0, 90, 0), seg=36, r2=r * 0.62)
    cyl("dryer_vent", r * 0.9, 0.4, (-L * 0.19, W / 2 - r, r), m["black"], rot=(0, 90, 0), seg=36)
    for k in range(4):  # vent grille rings
        ring(f"dryer_grille{k}", r * (0.2 + 0.18 * k), 0.08, (-L * 0.2 - 0.05, W / 2 - r, r), m["metal"],
             rot=(0, 90, 0), seg=28, tube_seg=4)
    box("dryer_handle", (L * 0.62, W - 2 * r - 0.3, H * 0.7), (-L * 0.02, -W / 2 + (W - 2 * r) / 2, H * 0.35), shell,
        bevel=1.4, bseg=3, sub=1)
    box("dryer_switch", (2.2, 0.25, 0.9), (L * 0.05, -W / 2 + 0.05, H * 0.4), m["black"], bevel=0.1, bseg=2)
    tube("dryer_cord", [(-L / 2 + 0.6, -W * 0.25, H * 0.3), (-L / 2 + 0.2, -W * 0.05, H * 0.2),
                        (-L / 2 + 0.6, W * 0.1, H * 0.15)], 0.3, m["black"], seg=6)


def first_aid():
    L, W, H = 18, 12, 6
    nylon = material("nylon", tex=tex_weave(44, 0.86), rough=0.6, tint=True)
    m = common()
    box("aid_body", (L, W, H), (0, 0, H / 2), nylon, cuts=2, bevel=min(W, H) * 0.38, bseg=3, sub=1,
        wrinkle=0.12, wrinkle_size=4)
    _zip_around("aid", L, W, H - 0.1, 0.8, m)
    white = material("cross_patch", "#ffffff", 0.6)
    box("aid_cross_a", (4.0, 1.3, 0.15), (0, 0, H + 0.02), white, bevel=0.05, bseg=1)
    box("aid_cross_b", (1.3, 4.0, 0.15), (0, 0, H + 0.02), white, bevel=0.05, bseg=1)


def earbuds():
    L, W, H = 6, 5, 3
    shell = material("gloss_shell", tex=tex_paper(), rough=0.15, tint=True)
    box("buds_case", (L, W, H), (0, 0, H / 2), shell, cuts=1, bevel=min(W, H) * 0.48, bseg=4, sub=1)
    ring("buds_seam", 1, 0.03, (0, 0, H * 0.68), material("seam_line", "#8a8a8a", 0.5),
         scale=(L / 2 * 0.98, W / 2 * 0.98, 1), seg=40, tube_seg=4)
    cyl("buds_led", 0.15, 0.05, (L * 0.15, -W / 2 + 0.02, H * 0.4), material("led_green", "#3ddc84", 0.2), rot=(90, 0, 0), seg=10)


def belt():
    D, H = 12, 4
    leather = material("belt_leather", tex=tex_leather(), rough=0.4, tint=True)
    m = common()
    # coiled flat: a spiral of strap standing on its edge, the buckle on the outside
    spiral_roll("belt_coil", H, D, leather, turns=3.2, thick=0.42, rot=(0, -90, 0), core=False, tile=2.0)
    bx = D / 2 - 0.2
    ring("belt_buckle", 1, 0.28, (bx, 0, H / 2), m["metal"], rot=(0, 90, 0), scale=(H * 0.62, 2.0, 1), seg=24, tube_seg=6)
    cyl("belt_prong", 0.12, H * 0.9, (bx + 0.3, 0, H / 2), m["metal"], seg=6)


def umbrella():
    L, D = 28, 6
    canopy = material("canopy", tex=tex_weave(60, 0.86), rough=0.5, tint=True)
    m = common()
    r = D / 2
    cyl("umb_sleeve", r * 0.92, L * 0.72, (-L * 0.1, 0, 0), canopy, rot=(0, 90, 0), seg=28, bevel=0.5, bseg=2,
        sub=1, wrinkle=0.25, wrinkle_size=2)
    for k in range(5):  # fabric folds along the closed canopy
        a = 2 * math.pi * k / 5
        tube(f"umb_fold{k}", [(-L * 0.44, r * 0.86 * math.cos(a), r * 0.86 * math.sin(a)),
                              (L * 0.24, r * 0.88 * math.cos(a + 0.4), r * 0.88 * math.sin(a + 0.4))], 0.2, canopy, seg=5)
    cyl("umb_handle", r * 0.85, L * 0.26, (L / 2 - L * 0.13, 0, 0), m["black"], rot=(0, 90, 0), seg=28, bevel=0.6, bseg=3)
    cyl("umb_tip", r * 0.3, 1.2, (-L / 2 + 0.6, 0, 0), m["black"], rot=(0, 90, 0), seg=16)
    box("umb_strap", (2.4, 0.3, D * 1.02), (L * 0.12, 0, 0), canopy, bevel=0.12, bseg=2)
    cyl("umb_snap", 0.5, 0.3, (L * 0.12, -D * 0.52, 0), m["metal"], rot=(90, 0, 0), seg=14)


def laundry_bag():
    L, W, H = 20, 15, 2
    cloth = material("bag_cloth", tex=tex_weave(36, 0.88), rough=0.9, tint=True)
    m = common()
    box("lbag_body", (L, W, H * 0.8), (0, 0, H * 0.4), cloth, cuts=2, bevel=H * 0.36, bseg=2, sub=1,
        wrinkle=0.2, wrinkle_size=3)
    tube("lbag_cord", [(L / 2 - 1.5, -W * 0.4, H * 0.9), (L / 2 - 0.8, 0, H * 0.95), (L / 2 - 1.5, W * 0.4, H * 0.9),
                       (L / 2 - 4, W * 0.3, H * 0.85)], 0.18, m["white"], seg=6)
    cyl("lbag_toggle", 0.55, 1.4, (L / 2 - 4.6, W * 0.3, H * 0.95), m["black"], rot=(0, 90, 0), seg=12, bevel=0.15, bseg=2)


def snack_box():
    L, W, H = 18, 12, 6
    card = material("carton", tex=tex_paper() * 0.96, rough=0.7, tint=True)
    box("snack_carton", (L, W, H), (0, 0, H / 2), card, bevel=0.15, bseg=2)
    box("snack_flap", (L * 0.98, W * 0.5, 0.06), (0, W * 0.25, H + 0.02), card, bevel=0.05, bseg=1)
    box("snack_label", (L * 0.55, 0.05, H * 0.5), (0, -W / 2 - 0.02, H * 0.5), material("label_print", "#ffffff", 0.5))
    box("snack_band", (L * 0.55, W * 0.6, 0.04), (0, -W * 0.15, H + 0.01), material("label_band", "#e94e3c", 0.5))


# =========================================================================== #
# Build & export
# =========================================================================== #
MODELS = {
    "tshirt": tshirt, "polo": polo, "dress_shirt": dress_shirt, "sweater": sweater, "hoodie": hoodie,
    "jacket": jacket, "jeans": jeans, "shorts": shorts, "roll": roll, "socks": socks, "towel_roll": towel_roll,
    "sneakers": sneakers, "dress_shoes": dress_shoes, "boots": boots, "sandals": sandals,
    "laptop": laptop, "power_bank": power_bank, "charger": charger, "camera": camera, "glasses_case": glasses_case,
    "pouch": pouch, "packing_cube": packing_cube, "flask": flask,
    "book": book, "passport": passport, "folder": folder,
    "blazer": blazer, "dress": dress, "swimsuit": swimsuit, "cap": cap, "sun_hat": sun_hat, "flip_flops": flip_flops,
    "tube": tube_model, "hair_dryer": hair_dryer, "first_aid": first_aid, "earbuds": earbuds, "belt": belt,
    "umbrella": umbrella, "laundry_bag": laundry_bag, "snack_box": snack_box,
}


def reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for block in list(coll):
            coll.remove(block)
    _materials.clear()


def export(model):
    path = OUT / f"{model}.glb"
    for ob in bpy.data.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_image_format="JPEG", export_jpeg_quality=82, export_animations=False, export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects if ob.type == "MESH"
               for p in ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons)
    return path, tris


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    wanted = argv or list(MODELS)
    unknown = [m for m in wanted if m not in MODELS]
    if unknown:
        sys.exit(f"Unknown model type(s): {', '.join(unknown)}. Known: {', '.join(MODELS)}")
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # save textures exactly as generated (Blender's default "AgX" view would wash them out)
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.look = "None"
    for model in wanted:
        reset()
        MODELS[model]()
        path, tris = export(model)
        print(f"[models] {model:13} {tris:6} triangles  {path.stat().st_size / 1024:6.0f} KB")


if __name__ == "__main__":
    main()
