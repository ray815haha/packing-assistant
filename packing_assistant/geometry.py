"""Axis-aligned box geometry helpers used by the optimizer."""

from __future__ import annotations

from dataclasses import dataclass

EPS = 1e-6


@dataclass(frozen=True)
class Box:
    origin: tuple[float, float, float]
    size: tuple[float, float, float]

    def lo(self, axis: int) -> float:
        return self.origin[axis]

    def hi(self, axis: int) -> float:
        return self.origin[axis] + self.size[axis]

    @property
    def volume(self) -> float:
        return self.size[0] * self.size[1] * self.size[2]

    @property
    def footprint(self) -> float:
        return self.size[0] * self.size[1]

    @property
    def center(self) -> tuple[float, float, float]:
        return tuple(self.origin[a] + self.size[a] / 2 for a in range(3))  # type: ignore[return-value]

    def overlaps(self, other: "Box") -> bool:
        """True if the interiors intersect (touching faces do not count)."""
        return all(
            self.lo(a) < other.hi(a) - EPS and other.lo(a) < self.hi(a) - EPS for a in range(3)
        )

    def fits_within(self, container: tuple[float, float, float]) -> bool:
        return all(self.lo(a) >= -EPS and self.hi(a) <= container[a] + EPS for a in range(3))

    def xy_overlap_area(self, other: "Box") -> float:
        dx = min(self.hi(0), other.hi(0)) - max(self.lo(0), other.lo(0))
        dy = min(self.hi(1), other.hi(1)) - max(self.lo(1), other.lo(1))
        return dx * dy if dx > EPS and dy > EPS else 0.0

    def contains_point(self, p: tuple[float, float, float]) -> bool:
        """Point lies inside the half-open box [lo, hi) on every axis."""
        return all(self.lo(a) - EPS <= p[a] < self.hi(a) - EPS for a in range(3))
