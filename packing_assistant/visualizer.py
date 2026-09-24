"""Human-readable output: metrics summary, step-by-step placement log, JSON
layout export (consumed by the Blender script) and an optional PNG preview."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

from .models import Perm, Placement
from .optimizer import PackingResult

CATEGORY_COLORS = {
    "clothing": (0.24, 0.44, 0.54),
    "shoes": (0.72, 0.53, 0.38),
    "toiletries": (0.35, 0.60, 0.45),
    "electronics": (0.30, 0.30, 0.34),
    "accessories": (0.48, 0.42, 0.63),
    "documents": (0.85, 0.70, 0.40),
    "general": (0.82, 0.41, 0.36),
}
FALLBACK_COLORS = [(0.55, 0.35, 0.50), (0.40, 0.55, 0.70), (0.70, 0.60, 0.30)]


def color_for(category: str) -> tuple[float, float, float]:
    if category in CATEGORY_COLORS:
        return CATEGORY_COLORS[category]
    return FALLBACK_COLORS[sum(map(ord, category)) % len(FALLBACK_COLORS)]


# --------------------------------------------------------------------------- #
# Descriptions
# --------------------------------------------------------------------------- #
def _fmt(v: float) -> str:
    return f"{v:g}"


def _dims(d) -> str:
    return " x ".join(_fmt(v) for v in d)


def orientation_label(p: Placement) -> str:
    h = p.size[2]
    s = sorted(p.item.dims)
    if len(set(s)) == 1:
        return "any way up"
    if h == s[0]:
        return "lying flat"
    if h == s[2]:
        return "standing on end"
    return "on its side"


def region_label(p: Placement, suitcase) -> str:
    cx, cy, _ = p.box.center

    def third(v: float, total: float, names: tuple[str, str, str]) -> str:
        return names[min(2, int(3 * v / total))]

    depth = third(cy, suitcase.width, ("front", "middle", "back"))
    side = third(cx, suitcase.length, ("left", "centre", "right"))
    return "centre" if (depth, side) == ("middle", "centre") else f"{depth}-{side}"


def support_label(p: Placement, names: dict[str, str]) -> str:
    if not p.supported_by:
        return "on the bottom of the case"
    return "on top of " + ", ".join(names[i] for i in p.supported_by)


def rotation_euler_deg(perm: Perm) -> tuple[int, int, int]:
    """XYZ Euler angles (degrees, Blender's default order) that turn an object
    modelled as (length, width, height) along (x, y, z) into the placed
    orientation described by ``perm``."""

    def rot(axis: int, deg: int):
        c, s = round(math.cos(math.radians(deg))), round(math.sin(math.radians(deg)))
        if axis == 0:
            return [[1, 0, 0], [0, c, -s], [0, s, c]]
        if axis == 1:
            return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
        return [[c, -s, 0], [s, c, 0], [0, 0, 1]]

    def mul(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

    candidates = []
    for rx in (0, 90, 180, 270):
        for ry in (0, 90, 180, 270):
            for rz in (0, 90, 180, 270):
                m = mul(rot(2, rz), mul(rot(1, ry), rot(0, rx)))
                if all(abs(m[i][perm[i]]) == 1 for i in range(3)):
                    cost = sum(min(a, 360 - a) for a in (rx, ry, rz))
                    candidates.append((cost, (rx, ry, rz)))
    return min(candidates)[1]


# --------------------------------------------------------------------------- #
# Placement log
# --------------------------------------------------------------------------- #
def placement_steps(result: PackingResult) -> list[dict]:
    names = {p.item.id: p.item.name for p in result.placements}
    buried = {id(p) for p in result.buried_priority()}
    steps = []
    for p in result.placements:
        instruction = (
            f"Place {p.item.name} {orientation_label(p)} in the "
            f"{region_label(p, result.suitcase)} of the case, {support_label(p, names)}."
        )
        squeezed = p.item.squeezed_fraction
        if squeezed > 0.001:
            instruction += f" Press it down to about {min(p.item.dims):g} cm thick."
        if p.item.priority and id(p) not in buried:
            instruction += " It's on top, so you can grab it without unpacking."
        elif p.item.priority:
            instruction += " (Marked need-it-first, but it had to go lower down to fit everything.)"
        steps.append(
            {
                "step": p.step,
                "id": p.item.id,
                "name": p.item.name,
                "category": p.item.category,
                "weight_kg": p.item.weight,
                "fragile": p.item.fragile,
                "original_size": list(p.item.dims),  # as packed (after any squeezing)
                "natural_size": list(p.item.natural_dims),
                "squeezed_pct": round(100 * squeezed),
                "priority": p.item.priority,
                "position": [round(p.x, 3), round(p.y, 3), round(p.z, 3)],  # min corner
                "size": [round(v, 3) for v in p.size],  # placed extents along x, y, z
                "orientation": orientation_label(p),
                "rotated": p.rotated,
                "rotation_euler_deg": list(rotation_euler_deg(p.perm)),
                "supported_by": p.supported_by,
                "color": list(color_for(p.item.category)),
                "instruction": instruction,
            }
        )
    return steps


def layout_dict(result: PackingResult) -> dict:
    s = result.suitcase
    return {
        "units": {"length": "cm", "weight": "kg"},
        "axes": {"x": "length (left->right)", "y": "width (front->back)", "z": "height (up)"},
        "suitcase": {
            "name": s.name,
            "length": s.length,
            "width": s.width,
            "height": s.height,
            "max_weight": s.max_weight,
        },
        "metrics": result.metrics(),
        "steps": placement_steps(result),
        "unpacked": [
            {"id": u.item.id, "name": u.item.name, "size": list(u.item.dims), "reason": u.reason}
            for u in result.unpacked
        ],
    }


def export_layout_json(result: PackingResult, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(layout_dict(result), indent=2), encoding="utf-8")
    return path


def format_metrics(result: PackingResult) -> str:
    m = result.metrics()
    s = result.suitcase
    lines = [
        f"Suitcase: {s.name} ({_dims(s.dims)} cm, {m['suitcase_volume_cm3']:,.0f} cm3)",
        f"Items packed:        {m['items_packed']} / {m['items_total']}",
        f"Volume efficiency:   {m['volume_efficiency_pct']:.1f}%  "
        f"({m['packed_volume_cm3']:,.0f} cm3 used)",
        f"Unused volume:       {m['unused_volume_pct']:.1f}%  ({m['unused_volume_cm3']:,.0f} cm3 free)",
        f"Fill height:         {m['fill_height_cm']:g} of {s.height:g} cm "
        f"(space below that line is {m['compactness_pct']:.1f}% full)",
    ]
    if s.max_weight is not None:
        lines.append(f"Weight:              {m['packed_weight_kg']:g} / {s.max_weight:g} kg")
    else:
        lines.append(f"Weight:              {m['packed_weight_kg']:g} kg")
    if m["center_of_gravity_cm"]:
        cx, cy, cz = m["center_of_gravity_cm"]
        lines.append(f"Centre of gravity:   x={cx:g}, y={cy:g}, z={cz:g} cm")
    if m["squeezed_items"]:
        lines.append(f"Squeezed:            {m['squeezed_items']} soft item(s) pressed flatter to make room")
    if m["priority_items"]:
        lines.append(f"Need-it-first:       {m['priority_items']} item(s), {m['priority_buried']} with something on top")
    lines.append(f"Best strategy:       {m['strategy']} ({m['attempts']} layouts tried)")
    return "\n".join(lines)


def format_text_log(result: PackingResult) -> str:
    out = ["PACKING STEPS", "============="]
    for st in placement_steps(result):
        x, y, z = st["position"]
        out.append(f"{st['step']:>2}. {st['instruction']}")
        out.append(
            f"    at x={x:g}, y={y:g}, z={z:g} cm, occupying {_dims(st['size'])} cm"
            + ("  [rotated]" if st["rotated"] else "")
        )
    if result.unpacked:
        out.append("")
        out.append("DID NOT FIT")
        for u in result.unpacked:
            out.append(f" - {u.item.name} ({_dims(u.item.dims)} cm): {u.reason}")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Optional static preview (needs matplotlib)
# --------------------------------------------------------------------------- #
def render_preview_png(result: PackingResult, path: str | Path) -> Optional[Path]:
    """Save an isometric 3D preview. Returns None if matplotlib isn't installed."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    except ImportError:
        return None

    s = result.suitcase
    fig = plt.figure(figsize=(12, 7))
    ax = fig.add_subplot(111, projection="3d")

    def faces(o, d):
        x, y, z = o
        l, w, h = d
        v = [(x, y, z), (x + l, y, z), (x + l, y + w, z), (x, y + w, z),
             (x, y, z + h), (x + l, y, z + h), (x + l, y + w, z + h), (x, y + w, z + h)]
        idx = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 3, 7, 4)]
        return [[v[i] for i in f] for f in idx]

    from matplotlib.patches import Patch

    handles = []
    seen_per_category: dict[str, int] = {}
    for p in result.placements:
        k = seen_per_category.get(p.item.category, 0)
        seen_per_category[p.item.category] = k + 1
        base = color_for(p.item.category)
        shade = 1.0 + 0.18 * (k % 3)  # tell same-category items apart
        color = tuple(min(1.0, c * shade) for c in base)
        poly = Poly3DCollection(faces(p.box.origin, p.size), alpha=0.9,
                                facecolor=color, edgecolor="black", linewidth=0.5)
        ax.add_collection3d(poly)
        cx, cy, _ = p.box.center
        ax.text(cx, cy, p.box.hi(2) + 0.5, str(p.step), fontsize=9, ha="center", weight="bold")
        handles.append(Patch(facecolor=color, edgecolor="black", label=f"{p.step}. {p.item.name}"))
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.05, 1.0), fontsize=8, frameon=False)

    shell = Poly3DCollection(faces((0, 0, 0), s.dims), alpha=0.0, facecolor=(0, 0, 0, 0),
                             edgecolor="grey", linewidth=1, linestyle="--")
    ax.add_collection3d(shell)
    ax.set_xlim(0, s.length)
    ax.set_ylim(0, s.width)
    ax.set_zlim(0, s.height)
    ax.set_box_aspect(s.dims)
    ax.set_xlabel("length (cm)")
    ax.set_ylabel("width (cm)")
    ax.set_zlabel("height (cm)")
    m = result.metrics()
    ax.set_title(f"{s.name}: {m['items_packed']}/{m['items_total']} items, "
                 f"{m['volume_efficiency_pct']:.1f}% of volume used")
    ax.view_init(elev=28, azim=-60)

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    return path
