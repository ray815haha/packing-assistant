"""Item library ("catalog"), suitcase presets and trip profiles.

The catalog lives in data/catalog.json. Each entry describes a product as it
sits when packed (a folded T-shirt, a rolled pair of socks...), with the name
of the 3D model the web app draws for it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .data_io import items_from_list, suitcase_from_dict
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
    suitcase = suitcase_from_dict(request["suitcase"])
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
            entries.append(e)
    for i, custom in enumerate(request.get("custom_items", [])):
        cid = str(custom.get("id") or f"custom{i + 1}")
        if cid in by_id:
            cid = f"custom_{cid}"
        entries.append({**custom, "id": cid, "category": custom.get("category", "general")})
    items = items_from_list(entries)
    if len(items) > MAX_ITEMS:
        raise ValueError(f"Too many items ({len(items)}); the limit is {MAX_ITEMS}.")
    return suitcase, items


def enrich_layout(layout: dict[str, Any], catalog: dict[str, Any], request: dict[str, Any],
                  models: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Attach model / colour info to every step so the browser can draw real products."""
    by_id = {e["id"]: e for e in catalog["items"]}
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
            "model_url": models.get(base) or entry.get("model_file"),
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
        "id": str(trip.get("id") or uuid.uuid4().hex[:10]),
        "name": name,
        "saved_at": int(time.time()),
        "suitcase": trip.get("suitcase") or {},
        "suitcaseId": str(trip.get("suitcaseId", ""))[:30],
        "shell": str(trip.get("shell", ""))[:9],
        "qty": {str(k): int(v) for k, v in (trip.get("qty") or {}).items() if int(v) > 0},
        "priority": {str(k): bool(v) for k, v in (trip.get("priority") or {}).items()},
        "custom": list(trip.get("custom") or [])[:50],
    }
    trips = [t for t in load_trips(path) if t.get("id") != clean["id"] and t.get("name") != name]
    trips.insert(0, clean)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(trips[:MAX_TRIPS], indent=1), encoding="utf-8")
    tmp.replace(path)
    return clean


def delete_trip(trip_id: str, path: Optional[Path] = None) -> bool:
    path = path or TRIPS_PATH
    trips = load_trips(path)
    kept = [t for t in trips if t.get("id") != trip_id]
    if len(kept) == len(trips):
        return False
    path.write_text(json.dumps(kept, indent=1), encoding="utf-8")
    return True
