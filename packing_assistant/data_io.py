"""Loading trip definitions (suitcase + item list) from JSON.

Trip file format::

    {
      "suitcase": {"name": "Carry-on", "length": 55, "width": 35, "height": 23,
                   "max_weight": 10},
      "items": [
        {"id": "tshirt_cube", "name": "T-shirt cube", "length": 33, "width": 25,
         "height": 10, "weight": 1.2, "category": "clothing", "quantity": 1,
         "fragile": false, "upright": false}
      ]
    }

``quantity`` expands one entry into several items (ids get ``#1``, ``#2``, ...).
Later, item libraries and trip profiles can produce this same structure.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Item, Suitcase


def suitcase_from_dict(d: dict[str, Any]) -> Suitcase:
    return Suitcase(
        name=d.get("name", "Suitcase"),
        length=float(d["length"]),
        width=float(d["width"]),
        height=float(d["height"]),
        max_weight=float(d["max_weight"]) if d.get("max_weight") is not None else None,
    )


def items_from_list(entries: list[dict[str, Any]]) -> list[Item]:
    items: list[Item] = []
    ids: set[str] = set()
    for n, e in enumerate(entries, start=1):
        base_id = str(e.get("id") or f"item{n}")
        qty = int(e.get("quantity", 1))
        if qty < 1:
            continue
        for k in range(1, qty + 1):
            item_id = base_id if qty == 1 else f"{base_id}#{k}"
            name = e.get("name", base_id) if qty == 1 else f"{e.get('name', base_id)} #{k}"
            if item_id in ids:
                raise ValueError(f"Duplicate item id '{item_id}'")
            ids.add(item_id)
            items.append(
                Item(
                    id=item_id,
                    name=name,
                    length=float(e["length"]),
                    width=float(e["width"]),
                    height=float(e["height"]),
                    weight=float(e.get("weight", 0.0)),
                    category=e.get("category", "general"),
                    fragile=bool(e.get("fragile", False)),
                    upright=bool(e.get("upright", False)),
                    squeeze=float(e.get("squeeze", 0.0)),
                    priority=bool(e.get("priority", False)),
                )
            )
    return items


def load_trip(path: str | Path) -> tuple[Suitcase, list[Item]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return suitcase_from_dict(data["suitcase"]), items_from_list(data["items"])
