"""3D bin-packing engine.

Approach
--------
1. **Extreme-point placement** (Crainic, Perboli & Tadei, 2008). Each packed box
   creates new candidate corners ("extreme points"): the corners next to it,
   plus those corners slid back along the other axes until they hit a wall or
   another box. Every item is tried at every extreme point, in every allowed
   orientation (up to 6).
2. **Physical checks** for every candidate placement: it must fit in the
   suitcase, not overlap anything, and rest on enough support underneath
   (``min_support``, as a share of its footprint). Nothing may rest on a
   fragile item, and the weight limit is respected.
3. **Multi-start search**: the greedy pass is repeated with several item
   orderings (largest volume first, largest footprint first, heaviest first,
   ...) plus randomly perturbed variants, and the best layout is kept.
4. **Need-it-first items** (``priority``) always go in last, so they end up on
   top, and layouts that bury one under something else score lower.
5. **Squeezing**: if not everything fits, soft items (folded clothes, rolls)
   are squashed a little (``squeeze``: how much their thickness can shrink)
   and the search runs again: first by half their allowance, then fully.

The engine is pure Python, with no external dependencies.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .geometry import EPS, Box
from .models import Item, Perm, Placement, Suitcase, UnpackedItem

Point = tuple[float, float, float]


@dataclass
class PackerConfig:
    min_support: float = 0.7  # share of the footprint that must rest on something
    restarts: int = 300  # local-search / random-restart iterations after the fixed strategies
    seed: Optional[int] = 42  # None = different result every run
    time_limit_s: Optional[float] = 10.0  # stop searching after this long
    respect_fragile: bool = True
    patience: int = 60  # once everything fits, stop after this many attempts without improvement
    # Placement rules the search alternates between (see PLACEMENT_RULES).
    rules: tuple[str, ...] = ("max-contact", "bottom-up", "back-to-front")
    allow_squeeze: bool = True  # squash soft items when not everything fits


# --------------------------------------------------------------------------- #
# Results
# --------------------------------------------------------------------------- #
@dataclass
class PackingResult:
    suitcase: Suitcase
    placements: list[Placement]
    unpacked: list[UnpackedItem]
    strategy: str = ""
    attempts: int = 1

    @property
    def packed_volume(self) -> float:
        return sum(p.item.volume for p in self.placements)

    @property
    def packed_weight(self) -> float:
        return sum(p.item.weight for p in self.placements)

    def center_of_gravity(self) -> Optional[Point]:
        total = self.packed_weight
        if total <= 0:
            return None
        return tuple(  # type: ignore[return-value]
            sum(p.box.center[a] * p.item.weight for p in self.placements) / total for a in range(3)
        )

    def metrics(self) -> dict:
        s = self.suitcase
        used = self.packed_volume
        fill_height = max((p.box.hi(2) for p in self.placements), default=0.0)
        occupied_region = s.length * s.width * fill_height
        cog = self.center_of_gravity()
        n_total = len(self.placements) + len(self.unpacked)
        return {
            "suitcase_volume_cm3": round(s.volume, 1),
            "packed_volume_cm3": round(used, 1),
            "unused_volume_cm3": round(s.volume - used, 1),
            "volume_efficiency_pct": round(100 * used / s.volume, 2),
            "unused_volume_pct": round(100 * (1 - used / s.volume), 2),
            # how densely the part of the case you actually filled is packed
            "fill_height_cm": round(fill_height, 1),
            "compactness_pct": round(100 * used / occupied_region, 2) if occupied_region else 0.0,
            "items_packed": len(self.placements),
            "items_total": n_total,
            "items_unpacked": [u.item.name for u in self.unpacked],
            "packed_weight_kg": round(self.packed_weight, 2),
            "weight_limit_kg": s.max_weight,
            "center_of_gravity_cm": [round(c, 1) for c in cog] if cog else None,
            "squeezed_items": sum(1 for p in self.placements if p.item.squeezed_fraction > 0.001),
            "priority_items": sum(1 for p in self.placements if p.item.priority),
            "priority_buried": len(self.buried_priority()),
            "strategy": self.strategy,
            "attempts": self.attempts,
        }

    @property
    def packed_natural_volume(self) -> float:
        """Volume of the packed items at their natural (unsqueezed) size."""
        return sum(p.item.natural_volume for p in self.placements)

    def buried_priority(self) -> list[Placement]:
        """Need-it-first items that have something lying on top of them."""
        out = []
        for p in self.placements:
            if not p.item.priority:
                continue
            top = p.box.hi(2)
            for q in self.placements:
                if q is not p and q.box.lo(2) >= top - 1e-6 and p.box.xy_overlap_area(q.box) > 0:
                    out.append(p)
                    break
        return out

    def score(self) -> tuple:
        """Higher is better: how much stuff is packed (at natural size), then item
        count, then fewer buried need-it-first items, less squeezing, and a low
        centre of gravity."""
        cog = self.center_of_gravity()
        cog_height = cog[2] / self.suitcase.height if cog else 0.0
        fill = max((p.box.hi(2) for p in self.placements), default=0.0)
        squeezed = sum(p.item.natural_volume - p.item.volume for p in self.placements)
        return (round(self.packed_natural_volume, 6), len(self.placements), -len(self.buried_priority()),
                -round(squeezed, 3), -round(cog_height, 6), -fill)


# --------------------------------------------------------------------------- #
# Single greedy pass
# --------------------------------------------------------------------------- #
class ExtremePointPacker:
    """Packs items one at a time, in the order given, using extreme points."""

    def __init__(self, suitcase: Suitcase, config: Optional[PackerConfig] = None):
        self.suitcase = suitcase
        self.config = config or PackerConfig()

    def pack(self, items: list[Item], strategy: str = "given order",
             rule: str = "max-contact") -> PackingResult:
        if rule not in PLACEMENT_RULES:
            raise ValueError(f"Unknown placement rule '{rule}'. Choose from {list(PLACEMENT_RULES)}")
        self._rule = rule
        dims = self.suitcase.dims
        placements: list[Placement] = []
        unpacked: list[UnpackedItem] = []
        points: list[Point] = [(0.0, 0.0, 0.0)]
        weight = 0.0
        limit = self.suitcase.max_weight

        for item in items:
            if limit is not None and weight + item.weight > limit + EPS:
                unpacked.append(UnpackedItem(item, "would exceed the weight limit"))
                continue
            if not any(all(s <= d + EPS for s, d in zip(sorted(item.size_in(p)), sorted(dims)))
                       for p in item.orientations()):
                unpacked.append(UnpackedItem(item, "larger than the suitcase in every orientation"))
                continue

            best = self._best_position(item, points, placements)
            if best is None:
                unpacked.append(UnpackedItem(item, "no free space with enough support"))
                continue

            (x, y, z), perm, supporters = best
            placement = Placement(item, x, y, z, perm, step=len(placements) + 1, supported_by=supporters)
            placements.append(placement)
            weight += item.weight
            points = self._update_points(points, placement.box, placements)

        return PackingResult(self.suitcase, placements, unpacked, strategy)

    # -- candidate evaluation ------------------------------------------------ #
    # The inner loop runs hundreds of thousands of times for large lists, so it
    # works on plain tuples (x0, y0, z0, x1, y1, z1) instead of Box objects.
    def _best_position(self, item: Item, points: list[Point], placed: list[Placement]):
        L, W, H = self.suitcase.dims
        boxes = [(p.x, p.y, p.z, p.x + p.size[0], p.y + p.size[1], p.z + p.size[2]) for p in placed]
        orients = [(perm, item.size_in(perm)) for perm in item.orientations()]
        best_key = None
        best = None
        for pt in points:
            px, py, pz = pt
            for perm, (sx, sy, sz) in orients:
                x1, y1, z1 = px + sx, py + sy, pz + sz
                if x1 > L + EPS or y1 > W + EPS or z1 > H + EPS:
                    continue
                hit = False
                for b in boxes:
                    if (px < b[3] - EPS and b[0] < x1 - EPS and py < b[4] - EPS and b[1] < y1 - EPS
                            and pz < b[5] - EPS and b[2] < z1 - EPS):
                        hit = True
                        break
                if hit:
                    continue
                cand = (px, py, pz, x1, y1, z1)
                supporters = self._support(cand, boxes, placed)
                if supporters is None:
                    continue
                key = self._rank(cand, boxes)
                if best_key is None or key < best_key:
                    best_key, best = key, (pt, perm, supporters)
        return best

    def _rank(self, c: tuple, boxes: list[tuple]) -> tuple:
        """Smaller is better. Ties fall back to bottom-front-left, lying flat."""
        x, y, z = round(c[0], 6), round(c[1], 6), round(c[2], 6)
        flat = (-(c[3] - c[0]) * (c[4] - c[1]), c[5] - c[2])
        if self._rule == "bottom-up":
            return (z, y, x, *flat)
        if self._rule == "back-to-front":
            return (y, z, x, *flat)
        # max-contact: hug walls and neighbours as much as possible
        return (-round(self._contact_area(c, boxes), 6), z, y, x, *flat)

    def _contact_area(self, c: tuple, boxes: list[tuple]) -> float:
        dims = self.suitcase.dims
        total = 0.0
        for a in range(3):
            b, d = (1, 2) if a == 0 else ((0, 2) if a == 1 else (0, 1))
            face = (c[b + 3] - c[b]) * (c[d + 3] - c[d])
            if c[a] <= EPS:
                total += face
            if c[a + 3] >= dims[a] - EPS:
                total += face
            for o in boxes:
                if abs(c[a] - o[a + 3]) <= EPS or abs(c[a + 3] - o[a]) <= EPS:
                    db = min(c[b + 3], o[b + 3]) - max(c[b], o[b])
                    dd = min(c[d + 3], o[d + 3]) - max(c[d], o[d])
                    if db > EPS and dd > EPS:
                        total += db * dd
        return total

    def _support(self, c: tuple, boxes: list[tuple], placed: list[Placement]) -> Optional[list[str]]:
        """Ids of the items the box rests on ([] = floor), or None if unsupported."""
        z = c[2]
        if z <= EPS:
            return []
        area = 0.0
        supporters: list[str] = []
        for o, p in zip(boxes, placed):
            if abs(o[5] - z) > EPS:
                continue
            dx = min(c[3], o[3]) - max(c[0], o[0])
            dy = min(c[4], o[4]) - max(c[1], o[1])
            if dx <= EPS or dy <= EPS:
                continue
            if self.config.respect_fragile and p.item.fragile:
                return None
            area += dx * dy
            supporters.append(p.item.id)
        if area + EPS < self.config.min_support * (c[3] - c[0]) * (c[4] - c[1]):
            return None
        return supporters

    # -- extreme points ------------------------------------------------------ #
    def _update_points(self, points: list[Point], new: Box, placed: list[Placement]) -> list[Point]:
        boxes = [p.box for p in placed]
        dims = self.suitcase.dims
        candidates = list(points)
        for axis in range(3):
            corner = [new.lo(0), new.lo(1), new.lo(2)]
            corner[axis] = new.hi(axis)
            candidates.append(tuple(corner))  # type: ignore[arg-type]
            for proj in range(3):
                if proj != axis:
                    candidates.append(self._project(tuple(corner), proj, boxes))  # type: ignore[arg-type]

        result: list[Point] = []
        seen: set[tuple] = set()
        for pt in candidates:
            if any(pt[a] >= dims[a] - EPS for a in range(3)):
                continue
            if any(b.contains_point(pt) for b in boxes):
                continue
            key = tuple(round(c, 6) for c in pt)
            if key in seen:
                continue
            seen.add(key)
            result.append(pt)
        result.sort(key=lambda p: (p[2], p[1], p[0]))
        return result

    @staticmethod
    def _project(pt: Point, axis: int, boxes: list[Box]) -> Point:
        """Slide ``pt`` towards 0 along ``axis`` until it meets a wall or a box face."""
        others = [a for a in range(3) if a != axis]
        stop = 0.0
        for b in boxes:
            face = b.hi(axis)
            if face <= pt[axis] + EPS and face > stop and all(
                b.lo(o) - EPS <= pt[o] < b.hi(o) - EPS for o in others
            ):
                stop = face
        moved = list(pt)
        moved[axis] = stop
        return tuple(moved)  # type: ignore[return-value]


PLACEMENT_RULES = {
    "max-contact": "touch as much wall / neighbour surface as possible",
    "bottom-up": "fill layer by layer from the bottom, front-left first",
    "back-to-front": "build columns from the front wall towards the back",
}


# --------------------------------------------------------------------------- #
# Multi-start optimizer
# --------------------------------------------------------------------------- #
SortKey = Callable[[Item], tuple]

STRATEGIES: dict[str, SortKey] = {
    "largest volume first": lambda i: (-i.volume, -max(i.dims)),
    "largest footprint first": lambda i: (-sorted(i.dims)[2] * sorted(i.dims)[1], -i.volume),
    "longest side first": lambda i: (-max(i.dims), -i.volume),
    "heaviest first": lambda i: (-i.weight, -i.volume),
    # fragile items last so they end up on top
    "sturdy first, fragile last": lambda i: (i.fragile, -i.volume),
}


class PackingOptimizer:
    """Runs the greedy packer under many item orderings and keeps the best layout."""

    def __init__(self, config: Optional[PackerConfig] = None):
        self.config = config or PackerConfig()

    def optimize(self, suitcase: Suitcase, items: list[Item]) -> PackingResult:
        cfg = self.config
        packer = ExtremePointPacker(suitcase, cfg)
        rng = random.Random(cfg.seed)
        started = time.perf_counter()
        limit = cfg.time_limit_s
        deadline = None if limit is None else started + limit
        can_squeeze = cfg.allow_squeeze and any(i.squeeze > 0 for i in items)

        # First try everything at its natural size. Keep some time back for
        # squeezing in case it doesn't all fit.
        first_deadline = deadline if (deadline is None or not can_squeeze) else started + limit * 0.5
        best = self._search(packer, items, rng, first_deadline)
        attempts = best.attempts

        if best.unpacked and can_squeeze:
            levels = (0.5, 1.0)
            for n, level in enumerate(levels):
                now = time.perf_counter()
                level_deadline = None if deadline is None else now + (deadline - now) / (len(levels) - n)
                squeezed = [i.squeezed(level) for i in items]
                result = self._search(packer, squeezed, rng, level_deadline)
                attempts += result.attempts
                if result.score() > best.score():
                    result.strategy += f", soft items squeezed {'half' if level < 1 else 'fully'}"
                    best = result
                if not best.unpacked:
                    break

        best.attempts = attempts
        return best

    def _search(self, packer: "ExtremePointPacker", items: list[Item], rng: random.Random,
                deadline: Optional[float]) -> PackingResult:
        cfg = self.config
        best: Optional[PackingResult] = None
        best_order: list[Item] = list(items)
        best_rule = cfg.rules[0]
        best_force = True
        attempts = 0
        stale = 0  # attempts since the last improvement
        has_priority = any(i.priority for i in items)

        def consider(order: list[Item], name: str, rule: str, force: bool = True) -> bool:
            """Pack with this order/rule; adopt it if at least as good as the best
            (accepting ties lets the local search drift across plateaus).
            ``force`` puts need-it-first items in last; without it they compete
            like any other item (useful when a big one wouldn't fit last).
            Returns True on a strict improvement."""
            nonlocal best, best_order, best_rule, best_force, attempts, stale
            if force:
                order = _priority_last(order)
            attempts += 1
            result = packer.pack(order, f"{name}, {rule}", rule)
            if best is not None and result.score() < best.score():
                stale += 1
                return False
            improved = best is None or result.score() > best.score()
            stale = 0 if improved else stale + 1
            if not improved:
                result.strategy = best.strategy  # keep the label of where it came from
            best, best_order, best_rule, best_force = result, list(order), rule, force
            return improved

        def out_of_time() -> bool:
            return deadline is not None and time.perf_counter() > deadline

        # Phase 1: every fixed sort strategy with every placement rule (and, when
        # some items are need-it-first, also without forcing them to the end).
        base_orders = {name: sorted(items, key=key) for name, key in STRATEGIES.items()}
        for force in ((True, False) if has_priority else (True,)):
            for name, order in base_orders.items():
                for rule in cfg.rules:
                    consider(order, name, rule, force)

        # Phase 2: local search around the best layout (swap / move items in the
        # packing order), with an occasional fresh random order to escape dead ends.
        i = -1
        while True:
            i += 1
            if out_of_time() or (best is not None and _is_perfect(best)):
                break
            # `restarts` is the normal budget; while items are still left over
            # and there is time on the clock, keep looking (up to 10x as long).
            if i >= cfg.restarts and (deadline is None or not best.unpacked or i >= cfg.restarts * 10):
                break
            # Everything fits and the layout has stopped improving: good enough.
            if best is not None and not best.unpacked and stale >= cfg.patience:
                break
            force = best_force if (not has_priority or rng.random() < 0.85) else not best_force
            if i % 5 == 4:
                order = list(items)
                rng.shuffle(order)
                consider(order, "random order", rng.choice(cfg.rules), force)
            else:
                assert best is not None
                origin = best.strategy.split(", ")[0].removesuffix(" + local search")
                rule = best_rule if rng.random() < 0.8 else rng.choice(cfg.rules)
                consider(_mutate(best_order, rng), f"{origin} + local search", rule, force)

        assert best is not None
        best.attempts = attempts
        return best


def _priority_last(order: list[Item]) -> list[Item]:
    """Need-it-first items go in last (so they end up on top); order otherwise kept."""
    if not any(i.priority for i in order):
        return order
    return [i for i in order if not i.priority] + [i for i in order if i.priority]


def _is_perfect(result: PackingResult) -> bool:
    return not result.unpacked and result.packed_volume >= result.suitcase.volume - EPS


def _mutate(order: list[Item], rng: random.Random) -> list[Item]:
    """Small random change to a packing order: swap two items or move one."""
    out = list(order)
    n = len(out)
    if n < 2:
        return out
    for _ in range(rng.choice((1, 1, 2))):
        i, j = rng.sample(range(n), 2)
        if rng.random() < 0.5:
            out[i], out[j] = out[j], out[i]
        else:
            out.insert(j, out.pop(i))
    return out


def pack(suitcase: Suitcase, items: list[Item], config: Optional[PackerConfig] = None) -> PackingResult:
    """Convenience wrapper: optimise and return the best layout found."""
    return PackingOptimizer(config).optimize(suitcase, items)
