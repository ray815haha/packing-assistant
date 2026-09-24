"""Tests for the packing engine. Run with either:
    python -m unittest discover tests
    python -m pytest            (if pytest is installed)
"""

import itertools
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from packing_assistant import Item, PackerConfig, Suitcase, load_trip, pack  # noqa: E402
from packing_assistant.geometry import EPS  # noqa: E402
from packing_assistant.visualizer import layout_dict, rotation_euler_deg  # noqa: E402

FAST = PackerConfig(restarts=50, seed=1, time_limit_s=5)


def cube(i, s=10.0, **kw):
    return Item(f"c{i}", f"Cube {i}", s, s, s, **kw)


class PackingTests(unittest.TestCase):
    def assert_valid(self, result, min_support=FAST.min_support):
        dims = result.suitcase.dims
        for p in result.placements:
            self.assertTrue(p.box.fits_within(dims), f"{p.item.name} sticks out of the case")
        for a, b in itertools.combinations(result.placements, 2):
            self.assertFalse(a.box.overlaps(b.box), f"{a.item.name} overlaps {b.item.name}")
        for p in result.placements:
            if p.z > EPS:
                under = [q for q in result.placements if abs(q.box.hi(2) - p.z) < EPS]
                area = sum(p.box.xy_overlap_area(q.box) for q in under)
                self.assertGreaterEqual(area, min_support * p.box.footprint - EPS,
                                        f"{p.item.name} is not supported")

    def test_perfect_fit_eight_cubes(self):
        r = pack(Suitcase("box", 20, 20, 20), [cube(i) for i in range(8)], FAST)
        self.assertEqual(len(r.placements), 8)
        self.assertEqual(r.metrics()["volume_efficiency_pct"], 100.0)
        self.assert_valid(r)

    def test_item_is_rotated_to_fit(self):
        r = pack(Suitcase("tall", 10, 10, 30), [Item("rod", "Rod", 30, 10, 10)], FAST)
        self.assertEqual(r.placements[0].size, (10, 10, 30))

    def test_upright_item_cannot_be_laid_down(self):
        r = pack(Suitcase("flat", 30, 10, 10), [Item("flask", "Flask", 8, 8, 22, upright=True)], FAST)
        self.assertFalse(r.placements)
        self.assertEqual(len(r.unpacked), 1)

    def test_oversized_item_is_reported(self):
        r = pack(Suitcase("small", 10, 10, 10), [Item("big", "Big", 11, 5, 5)], FAST)
        self.assertTrue(r.unpacked[0].reason.startswith("larger than"))

    def test_weight_limit(self):
        items = [Item(f"b{i}", f"Brick {i}", 5, 5, 5, weight=3) for i in range(4)]
        r = pack(Suitcase("case", 50, 50, 50, max_weight=7), items, FAST)
        self.assertEqual(len(r.placements), 2)
        self.assertLessEqual(r.packed_weight, 7)

    def test_nothing_rests_on_fragile_items(self):
        items = [Item("glass", "Glass", 10, 10, 10, fragile=True), cube(1)]
        r = pack(Suitcase("column", 10, 10, 20), items, FAST)
        # Both fit, but only with the glass on top.
        self.assertEqual(len(r.placements), 2)
        glass = next(p for p in r.placements if p.item.id == "glass")
        self.assertEqual(glass.z, 10)
        # A single greedy pass in the wrong order must refuse to stack on it.
        from packing_assistant.optimizer import ExtremePointPacker

        single = ExtremePointPacker(Suitcase("column", 10, 10, 20)).pack(items)
        self.assertEqual(len(single.placements), 1)

    def test_no_floating_items(self):
        # A wide slab must not balance on a small block.
        items = [Item("block", "Block", 5, 5, 5), Item("slab", "Slab", 20, 20, 2)]
        r = pack(Suitcase("case", 20, 20, 10), items, FAST)
        self.assert_valid(r)
        slab = next(p for p in r.placements if p.item.id == "slab")
        self.assertEqual(slab.z, 0)

    def test_quantity_expands_items(self):
        from packing_assistant.data_io import items_from_list

        items = items_from_list([{"id": "sock", "length": 5, "width": 5, "height": 5, "quantity": 3}])
        self.assertEqual([i.id for i in items], ["sock#1", "sock#2", "sock#3"])

    def test_sample_trip_packs_completely(self):
        suitcase, items = load_trip(ROOT / "data" / "sample_trip.json")
        r = pack(suitcase, items, PackerConfig())
        self.assert_valid(r)
        self.assertFalse(r.unpacked)
        self.assertEqual(len(layout_dict(r)["steps"]), len(items))

    def test_overpacked_trip_reports_leftovers(self):
        suitcase, items = load_trip(ROOT / "data" / "overpacked_trip.json")
        r = pack(suitcase, items, PackerConfig(restarts=50, seed=1, time_limit_s=5, allow_squeeze=False))
        self.assert_valid(r)
        self.assertTrue(r.unpacked)

    def test_squeezing_soft_items_makes_room(self):
        # Three 10 cm thick soft cubes in a 25 cm tall case: only fit if squeezed.
        items = [Item(f"s{i}", f"Soft {i}", 20, 20, 10, squeeze=0.3) for i in range(3)]
        case = Suitcase("case", 20, 20, 25)
        stiff = pack(case, items, PackerConfig(restarts=20, time_limit_s=3, allow_squeeze=False))
        soft = pack(case, items, PackerConfig(restarts=20, time_limit_s=3))
        self.assertEqual(len(stiff.placements), 2)
        self.assertEqual(len(soft.placements), 3)
        self.assert_valid(soft)
        self.assertTrue(all(p.item.height < 10 for p in soft.placements))
        self.assertEqual(soft.metrics()["squeezed_items"], 3)

    def test_squeezed_copy_keeps_natural_size(self):
        shirt = Item("t", "T-shirt", 28, 20, 4, squeeze=0.25)
        flat = shirt.squeezed(1.0)
        self.assertEqual(flat.dims, (28, 20, 3.0))
        self.assertEqual(flat.natural_dims, (28, 20, 4))
        self.assertAlmostEqual(flat.squeezed_fraction, 0.25)
        self.assertIs(Item("b", "Box", 5, 5, 5).squeezed(1.0).natural, None)

    def test_need_it_first_items_stay_on_top(self):
        items = [Item(f"b{i}", f"Book {i}", 20, 20, 5) for i in range(3)]
        items.insert(1, Item("pass", "Passport", 20, 20, 1, priority=True))
        r = pack(Suitcase("case", 20, 20, 20), items, FAST)
        passport = next(p for p in r.placements if p.item.id == "pass")
        self.assertEqual(passport.z, 15)  # last in, on top of the stack
        self.assertEqual(r.metrics()["priority_buried"], 0)

    def test_rotation_euler_matches_every_orientation(self):
        """Rotating a (3, 5, 7) box by the exported Euler angles (Blender XYZ order)
        must give exactly the placed extents."""
        import math

        def rot(axis, deg):
            c, s = round(math.cos(math.radians(deg))), round(math.sin(math.radians(deg)))
            return [[[1, 0, 0], [0, c, -s], [0, s, c]],
                    [[c, 0, s], [0, 1, 0], [-s, 0, c]],
                    [[c, -s, 0], [s, c, 0], [0, 0, 1]]][axis]

        def mul(a, b):
            return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

        dims = (3, 5, 7)
        for perm in itertools.permutations(range(3)):
            rx, ry, rz = rotation_euler_deg(perm)
            m = mul(rot(2, rz), mul(rot(1, ry), rot(0, rx)))
            extents = tuple(sum(abs(m[i][j]) * dims[j] for j in range(3)) for i in range(3))
            self.assertEqual(extents, tuple(dims[k] for k in perm), perm)


if __name__ == "__main__":
    unittest.main()
