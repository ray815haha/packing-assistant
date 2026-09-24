"""Blender script: builds an animated, step-by-step view of a packing layout.

Run it one of these ways (Blender 3.6 or newer):

  1. Command line (from the project folder):
       blender --python blender/animate_packing.py -- output/layout.json
  2. Inside Blender: open this file in the Text Editor and press Run Script.
     It looks for ../output/layout.json next to this script; if Blender can't
     tell where the script lives, set LAYOUT_PATH below.

What you get: a suitcase frame, one rounded box per item in its category
colour, and an animation where each item appears above the case, turns into
its packed orientation and drops into place, in packing order. A timeline
marker labels every step.
"""

import json
import math
import os
import sys
from pathlib import Path

import bpy

LAYOUT_PATH = ""  # optional: absolute path to layout.json
CM = 0.01  # the optimiser works in centimetres, Blender in metres
FRAMES_PER_STEP = 24
HOVER_HEIGHT_CM = 25  # how high above the case each item starts
COLLECTION_NAME = "SmartPacking"
PREFIX = "SPA_"


# --------------------------------------------------------------------------- #
# Locate the layout file
# --------------------------------------------------------------------------- #
def find_layout() -> Path:
    candidates = []
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        if args:
            candidates.append(Path(args[0]))
    if LAYOUT_PATH:
        candidates.append(Path(LAYOUT_PATH))
    if os.environ.get("SPA_LAYOUT"):
        candidates.append(Path(os.environ["SPA_LAYOUT"]))

    script_dirs = []
    try:
        script_dirs.append(Path(__file__).resolve().parent)
    except NameError:
        pass
    for text in bpy.data.texts:
        if text.filepath:
            script_dirs.append(Path(bpy.path.abspath(text.filepath)).resolve().parent)
    for d in script_dirs:
        candidates.append(d.parent / "output" / "layout.json")
    if bpy.data.filepath:
        candidates.append(Path(bpy.data.filepath).parent / "output" / "layout.json")

    for c in candidates:
        if c.is_file():
            return c
    raise FileNotFoundError(
        "Could not find layout.json. Run `python main.py` first, then pass the path after "
        "'--' on the command line or set LAYOUT_PATH at the top of this script. Tried:\n  "
        + "\n  ".join(str(c) for c in candidates)
    )


# --------------------------------------------------------------------------- #
# Scene helpers
# --------------------------------------------------------------------------- #
def reset_collection() -> bpy.types.Collection:
    coll = bpy.data.collections.get(COLLECTION_NAME)
    if coll:
        for obj in list(coll.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Camera) and data.users == 0:
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Light) and data.users == 0:
                bpy.data.lights.remove(data)
    else:
        coll = bpy.data.collections.new(COLLECTION_NAME)
        bpy.context.scene.collection.children.link(coll)
    for mat in list(bpy.data.materials):
        if mat.name.startswith(PREFIX) and mat.users == 0:
            bpy.data.materials.remove(mat)
    scene = bpy.context.scene
    for m in list(scene.timeline_markers):
        if m.name[:3].rstrip(".").isdigit():
            scene.timeline_markers.remove(m)
    return coll


def box_mesh(name: str, l: float, w: float, h: float) -> bpy.types.Mesh:
    """Box of size l x w x h (metres), centred on the origin."""
    x, y, z = l / 2, w / 2, h / 2
    verts = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
             (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def material(name: str, rgb, roughness: float = 0.5) -> bpy.types.Material:
    mat = bpy.data.materials.new(PREFIX + name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = (*rgb, 1.0)  # colour in Solid viewport mode
    return mat


def add_object(coll, name, data) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    return obj


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build(layout: dict) -> None:
    scene = bpy.context.scene
    coll = reset_collection()
    s = layout["suitcase"]
    L, W, H = s["length"] * CM, s["width"] * CM, s["height"] * CM

    # Suitcase: floor panel + wireframe walls
    floor = add_object(coll, "Suitcase_Floor", box_mesh("Suitcase_Floor", L, W, 0.005))
    floor.location = (L / 2, W / 2, -0.0025)
    floor.data.materials.append(material("SuitcaseFloor", (0.12, 0.12, 0.14), 0.8))

    frame = add_object(coll, "Suitcase_Frame", box_mesh("Suitcase_Frame", L, W, H))
    frame.location = (L / 2, W / 2, H / 2)
    wire = frame.modifiers.new("Wireframe", "WIREFRAME")
    wire.thickness = 0.004
    frame.data.materials.append(material("SuitcaseFrame", (0.55, 0.55, 0.6), 0.4))

    # Items
    steps = layout["steps"]
    for st in steps:
        l, w, h = (v * CM for v in st["original_size"])
        pl, pw, ph = (v * CM for v in st["size"])
        x, y, z = (v * CM for v in st["position"])
        target = (x + pl / 2, y + pw / 2, z + ph / 2)
        start = (target[0], target[1], H + HOVER_HEIGHT_CM * CM + ph / 2)
        rot = tuple(math.radians(a) for a in st["rotation_euler_deg"])

        name = f"{st['step']:02d}_{st['name']}"
        obj = add_object(coll, name, box_mesh(name, l, w, h))
        obj.data.materials.append(material(st["id"], st["color"]))
        bevel = obj.modifiers.new("Bevel", "BEVEL")
        bevel.width = min(l, w, h) * 0.12
        bevel.segments = 3
        for poly in obj.data.polygons:
            poly.use_smooth = True
        obj["step"] = st["step"]
        obj["instruction"] = st["instruction"]

        f0 = 1 + (st["step"] - 1) * FRAMES_PER_STEP
        f_turned = f0 + int(FRAMES_PER_STEP * 0.4)
        f_landed = f0 + FRAMES_PER_STEP - 2

        # hidden until its step starts
        for f, hidden in ((1, True), (f0, False)):
            if f == 1 and f0 == 1:
                continue
            obj.hide_viewport = obj.hide_render = hidden
            obj.keyframe_insert("hide_viewport", frame=f)
            obj.keyframe_insert("hide_render", frame=f)

        obj.location, obj.rotation_euler = start, (0, 0, 0)
        obj.keyframe_insert("location", frame=f0)
        obj.keyframe_insert("rotation_euler", frame=f0)
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=f_turned)
        obj.keyframe_insert("location", frame=f_turned)
        obj.location = target
        obj.keyframe_insert("location", frame=f_landed)

        scene.timeline_markers.new(f"{st['step']}. {st['name']}", frame=f0)

    scene.frame_start = 1
    scene.frame_end = 1 + len(steps) * FRAMES_PER_STEP + 30
    scene.frame_set(scene.frame_end)

    # Camera looking at the case from the front-right, above
    cam = add_object(coll, "SPA_Camera", bpy.data.cameras.new("SPA_Camera"))
    span = max(L, W, H)
    cam.location = (L * 1.35, -span * 1.25, H + span * 1.1)
    target_empty = add_object(coll, "SPA_CameraTarget", None)
    target_empty.location = (L / 2, W / 2, H / 3)
    track = cam.constraints.new("TRACK_TO")
    track.target = target_empty
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    cam.data.lens = 40
    scene.camera = cam

    sun = add_object(coll, "SPA_Sun", bpy.data.lights.new("SPA_Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))

    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = (0.9, 0.9, 0.92)

    metrics = layout.get("metrics", {})
    print(
        f"[SmartPacking] Built {len(steps)} steps, "
        f"{metrics.get('volume_efficiency_pct', '?')}% volume efficiency. "
        f"Press Space to play the animation."
    )


def main() -> None:
    path = find_layout()
    with open(path, "r", encoding="utf-8") as f:
        layout = json.load(f)
    print(f"[SmartPacking] Loading {path}")
    build(layout)


if __name__ == "__main__":
    main()
