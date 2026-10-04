"""Item library ("catalog"), suitcase presets and trip profiles.

The catalog lives in data/catalog.json. Each entry describes a product as it
sits when packed (a folded T-shirt, a rolled pair of socks...), with the name
of the 3D model the web app draws for it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .data_io import bags_from_list, items_from_list, suitcase_from_dict
from .models import Item, Suitcase

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "data" / "catalog.json"
CUSTOM_MODELS_DIR = ROOT / "web" / "models"

MAX_ITEMS = 200  # keeps a single request from tying the server up for minutes


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def custom_models(directory: Path = CUSTOM_MODELS_DIR) -> dict[str, str]:
    """Map item id -> URL of a user-supplied .glb model (web/models/<id>.glb)."""
    if not directory.is_dir():
        return {}
    return {p.stem: f"models/{p.name}" for p in sorted(directory.glob("*.glb"))}


def build_trip(catalog: dict[str, Any], request: dict[str, Any]) -> tuple[Suitcase, list[Item]]:
    """Turn an API request into a suitcase and a flat list of items.

    request = {
      "suitcase": {"name", "length", "width", "height", "max_weight"},
      "items": [{"id": "<catalog id>", "quantity": 2}, ...],
      "custom_items": [{"id", "name", "length", "width", "height", "weight", ...}]
    }
    """
    return suitcase_from_dict(request["suitcase"]), _trip_items(catalog, request)


def build_bag_trip(catalog: dict[str, Any], request: dict[str, Any]) -> tuple[list[Suitcase], list[Item]]:
    """Like build_trip, for a request with several bags:

    request = {
      "bags": [{"id", "name", "kind", "length", "width", "height", "max_weight"}, ...],
      "items": [{"id": "<catalog id>", "quantity": 2, "bag": "<bag id>"}, ...],  # bag optional
      "custom_items": [{..., "bag": "<bag id>"}]
    }
    """
    return bags_from_list(request["bags"]), _trip_items(catalog, request)


def _trip_items(catalog: dict[str, Any], request: dict[str, Any]) -> list[Item]:
    by_id = {e["id"]: e for e in catalog["items"]}
    entries: list[dict[str, Any]] = []
    for sel in request.get("items", []):
        entry = by_id.get(sel.get("id"))
        if entry is None:
            raise ValueError(f"Unknown catalog item '{sel.get('id')}'")
        qty = int(sel.get("quantity", 1))
        if qty > 0:
            e = {**entry, "quantity": qty}
            if sel.get("priority") is not None:  # user override of "need it first"
                e["priority"] = bool(sel["priority"])
            if sel.get("bag"):  # the user put it in a particular bag
                e["bag"] = sel["bag"]
            entries.append(e)
    for i, custom in enumerate(request.get("custom_items", [])):
        cid = str(custom.get("id") or f"custom{i + 1}")
        if cid in by_id:
            cid = f"custom_{cid}"
        entries.append({**custom, "id": cid, "category": custom.get("category", "general")})
    items = items_from_list(entries)
    if len(items) > MAX_ITEMS:
        raise ValueError(f"Too many items ({len(items)}); the limit is {MAX_ITEMS}.")
    return items


def enrich_layout(layout: dict[str, Any], catalog: dict[str, Any], request: dict[str, Any],
                  models: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Attach model / colour info to every step so the browser can draw real products.

    The 3D model is, in order: the user's own web/models/<item id>.glb, the
    entry's "model_file", the detailed model for its type (catalog
    "model_files", made by blender/make_models.py), or none (the browser then
    draws its simple built-in shape)."""
    by_id = {e["id"]: e for e in catalog["items"]}
    type_files = catalog.get("model_files", {})
    for c in request.get("custom_items", []):
        by_id.setdefault(str(c.get("id")), c)
    models = models if models is not None else custom_models()

    def info(item_id: str) -> dict[str, Any]:
        base = item_id.split("#")[0]
        entry = by_id.get(base) or by_id.get(base.removeprefix("custom_")) or {}
        return {
            "catalog_id": base,
            "model": entry.get("model", "box"),
            "hex_color": entry.get("color", "#8899aa"),
            "model_url": models.get(base) or entry.get("model_file") or type_files.get(entry.get("model", "box")),
            "icon_model": entry.get("model", "box"),
        }

    for step in layout["steps"]:
        step.update(info(step["id"]))
    for u in layout["unpacked"]:
        u.update(info(u["id"]))
    return layout


# --------------------------------------------------------------------------- #
# Saved trips (stored next to the catalog so they survive browser changes)
# --------------------------------------------------------------------------- #
TRIPS_PATH = ROOT / "data" / "trips.json"
MAX_TRIPS = 100


def load_trips(path: Optional[Path] = None) -> list[dict[str, Any]]:
    path = path or TRIPS_PATH
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save_trip(trip: dict[str, Any], path: Optional[Path] = None) -> dict[str, Any]:
    """Create or replace a saved trip (matched by id, or by name when no id)."""
    path = path or TRIPS_PATH
    import time
    import uuid

    name = str(trip.get("name", "")).strip()[:60]
    if not name:
        raise ValueError("A saved trip needs a name.")
    clean = {
        "id": str(trip.get("id") or uuid.uuid4().hex[:10])[:40],
        "name": name,
        "saved_at": _saved_at(trip.get("saved_at")),
        "suitcase": trip.get("suitcase") or {},
        "suitcaseId": str(trip.get("suitcaseId", ""))[:30],
        "shell": str(trip.get("shell", ""))[:9],
        "qty": {str(k): int(v) for k, v in (trip.get("qty") or {}).items() if int(v) > 0},
        "priority": {str(k): bool(v) for k, v in (trip.get("priority") or {}).items()},
        "custom": list(trip.get("custom") or [])[:50],
        "bags": _clean_bags(trip.get("bags")),
        "assign": {str(k): str(v)[:20] for k, v in (trip["assign"] if isinstance(trip.get("assign"), dict) else {}).items()},
    }
    trips = [t for t in load_trips(path) if t.get("id") != clean["id"] and t.get("name") != name]
    trips.insert(0, clean)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(trips[:MAX_TRIPS], indent=1), encoding="utf-8")
    tmp.replace(path)
    return clean


def _saved_at(given: Any) -> int:
    """A trip's saved_at: kept when it comes with one (a trip synced from
    another device, see web/js/sync.js), otherwise now. Seconds."""
    import time

    now = int(time.time())
    try:
        t = int(float(given))
    except (TypeError, ValueError):
        return now
    return t if 0 < t <= now + 86400 else now


def _clean_bags(bags: Any) -> list[dict[str, Any]]:
    """The bag list of a saved trip (as the web app sends it), with sane values."""
    out = []
    for b in (bags if isinstance(bags, list) else [])[:4]:
        if not isinstance(b, dict):
            continue
        dims = b.get("dims") if isinstance(b.get("dims"), dict) else {}
        out.append({
            "uid": str(b.get("uid", ""))[:20],
            "presetId": str(b.get("presetId", ""))[:30],
            "kind": b.get("kind") if b.get("kind") in ("checked", "cabin", "personal") else "checked",
            "shell": str(b.get("shell", ""))[:9],
            "dims": {k: float(dims[k]) for k in ("length", "width", "height", "max_weight")
                     if isinstance(dims.get(k), (int, float)) and dims[k] > 0},
        })
    return out


def delete_trip(trip_id: str, path: Optional[Path] = None) -> bool:
    path = path or TRIPS_PATH
    trips = load_trips(path)
    kept = [t for t in trips if t.get("id") != trip_id]
    if len(kept) == len(trips):
        return False
    path.write_text(json.dumps(kept, indent=1), encoding="utf-8")
    return True
