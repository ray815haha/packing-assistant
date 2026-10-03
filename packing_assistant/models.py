"""Domain models: suitcases, items and the placements the optimizer produces.

Coordinate convention (used everywhere in the project):
    x -> length (left to right, as you look into the open suitcase)
    y -> width  (front to back)
    z -> height (bottom to top)
Units are centimetres and kilograms. The origin is the front-left-bottom
inner corner of the suitcase.

The open case lies on its back: z = 0 is the back panel (where the trolley
handle runs), and the wheels are at the left end (x = 0). Stood up, the left
end is the bottom.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from itertools import permutations
from typing import Optional

from .geometry import Box

Dims = tuple[float, float, float]
Perm = tuple[int, int, int]

BAG_KINDS = ("checked", "cabin", "personal")


@dataclass(frozen=True)
class Suitcase:
    name: str
    length: float
    width: float
    height: float
    max_weight: Optional[float] = None  # kg; None = no limit
    # Only used when packing several bags at once (see optimizer.MultiBagPacker):
    kind: str = "checked"  # "checked" (hold), "cabin" (overhead locker) or "personal" (under the seat)
    id: str = ""
    wheels: Optional[bool] = None  # None: wheeled unless it's a personal (under-seat) bag

    def __post_init__(self) -> None:
        for label, v in (("length", self.length), ("width", self.width), ("height", self.height)):
            if v <= 0:
                raise ValueError(f"Suitcase {label} must be positive, got {v}")
        if self.kind not in BAG_KINDS:
            raise ValueError(f"Bag kind must be one of {BAG_KINDS}, got '{self.kind}'")

    @property
    def in_cabin(self) -> bool:
        return self.kind != "checked"

    @property
    def has_wheels(self) -> bool:
        return self.wheels if self.wheels is not None else self.kind != "personal"

    @property
    def dims(self) -> Dims:
        return (self.length, self.width, self.height)

    @property
    def volume(self) -> float:
        return self.length * self.width * self.height


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    length: float
    width: float
    height: float
    weight: float = 0.0
    category: str = "general"
    fragile: bool = False  # nothing may rest on top of it
    upright: bool = False  # may only turn around the vertical axis (e.g. a flask)
    squeeze: float = 0.0  # soft items: how much the thickness can be squashed (0.3 = by up to 30%)
    priority: bool = False  # "need it first": keep it on top, easy to reach
    natural: Optional[Dims] = None  # original size, set when the item has been squeezed
    # Several bags only:
    bag: Optional[str] = None  # id of the bag the user put it in (None = let the packer choose)
    cabin: str = ""  # "required" (e.g. lithium batteries), "preferred" (valuables) or ""

    def __post_init__(self) -> None:
        for label, v in (("length", self.length), ("width", self.width), ("height", self.height)):
            if v <= 0:
                raise ValueError(f"Item '{self.id}' {label} must be positive, got {v}")
        if self.weight < 0:
            raise ValueError(f"Item '{self.id}' weight cannot be negative")
        if not 0 <= self.squeeze < 0.9:
            raise ValueError(f"Item '{self.id}' squeeze must be between 0 and 0.9")
        if self.cabin not in ("", "required", "preferred"):
            raise ValueError(f"Item '{self.id}' cabin must be 'required', 'preferred' or empty")

    @property
    def dims(self) -> Dims:
        return (self.length, self.width, self.height)

    @property
    def volume(self) -> float:
        return self.length * self.width * self.height

    @property
    def natural_dims(self) -> Dims:
        return self.natural or self.dims

    @property
    def natural_volume(self) -> float:
        a, b, c = self.natural_dims
        return a * b * c

    @property
    def squeezed_fraction(self) -> float:
        """How much thinner than its natural size this item is packed (0 = not squeezed)."""
        if not self.natural:
            return 0.0
        return 1 - min(self.dims) / min(self.natural)

    def squeezed(self, level: float) -> "Item":
        """A copy with its thinnest side squashed by ``level`` x its allowed squeeze."""
        if self.squeeze <= 0 or level <= 0:
            return self
        natural = self.natural_dims
        k = 1 - self.squeeze * min(1.0, level)
        dims = list(natural)
        i = dims.index(min(dims))
        dims[i] = round(dims[i] * k, 3)
        return replace(self, length=dims[0], width=dims[1], height=dims[2], natural=natural)

    def orientations(self) -> list[Perm]:
        """Distinct axis permutations this item may be placed in.

        A permutation ``p`` means the placed extent along world axis ``i`` is
        ``dims[p[i]]``. A box has at most 6 axis-aligned orientations; identical
        side lengths collapse duplicates (a cube has just one).
        """
        seen: set[Dims] = set()
        result: list[Perm] = []
        for p in permutations(range(3)):
            if self.upright and p[2] != 2:
                continue
            size = tuple(self.dims[i] for i in p)
            if size not in seen:
                seen.add(size)
                result.append(p)  # type: ignore[arg-type]
        return result

    def size_in(self, perm: Perm) -> Dims:
        return (self.dims[perm[0]], self.dims[perm[1]], self.dims[perm[2]])


@dataclass
class Placement:
    item: Item
    x: float
    y: float
    z: float
    perm: Perm
    step: int = 0
    supported_by: list[str] = field(default_factory=list)  # item ids; empty = floor

    @property
    def size(self) -> Dims:
        return self.item.size_in(self.perm)

    @property
    def box(self) -> Box:
        return Box((self.x, self.y, self.z), self.size)

    @property
    def rotated(self) -> bool:
        return self.perm != (0, 1, 2)


@dataclass
class UnpackedItem:
    item: Item
    reason: str
