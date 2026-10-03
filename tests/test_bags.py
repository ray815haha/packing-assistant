"""Tests for packing several bags at once (pack_bags / MultiBagPacker)."""

import itertools
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from packing_assistant import Item, PackerConfig, Suitcase, pack, pack_bags  # noqa: E402
from packing_assistant.geometry import EPS  # noqa: E402
from packing_assistant.optimizer import bag_preferences  # noqa: E402
from packing_assistant.visualizer import bags_layout_dict  # noqa: E402

FAST = PackerConfig(restarts=50, seed=1, time_limit_s=5)

CHECKED = Suitcase("Check-in", 60, 40, 25, max_weight=23, kind="checked", id="hold")
CABIN = Suitcase("Carry-on", 50, 35, 20, max_weight=10, kind="cabin", id="cabin")
PERSONAL = Suitcase("Backpack", 40, 30, 15, max_weight=7, kind="personal", id="seat")


def brick(i, s=10.0, **kw):
    return Item(f"b{i}", f"Brick {i}", s, s, s, weight=kw.pop("weight", 0.5), **kw)


class BagTests(unittest.TestCase):
    def assert_valid(self, result):
        for bag, r in zip(result.bags, result.results):
            for p in r.placements:
                self.assertTrue(p.box.fits_within(bag.dims), f"{p.item.name} sticks out of {bag.name}")
            for a, b in itertools.combinations(r.placements, 2):
                self.assertFalse(a.box.overlaps(b.box), f"{a.item.name} overlaps {b.item.name} in {bag.name}")
            for p in r.placements:
                if p.z > EPS:
                    under = [q for q in r.placements if abs(q.box.hi(2) - p.z) < EPS]
                    area = sum(p.box.xy_overlap_area(q.box) for q in under)
                    self.assertGreaterEqual(area, FAST.min_support * p.box.footprint - EPS, p.item.name)
            if bag.max_weight is not None:
                self.assertLessEqual(r.packed_weight, bag.max_weight + EPS, bag.name)
        ids = [p.item.id for p in result.placements] + [u.item.id for u in result.unpacked]
        self.assertEqual(len(ids), len(set(ids)), "an item was packed twice")

    def bag_of(self, result, item_id):
        for bag, r in zip(result.bags, result.results):
            if any(p.item.id == item_id for p in r.placements):
                return bag.id
        return None

    def test_overflow_spills_into_the_next_bag(self):
        small = Suitcase("A", 20, 20, 20, id="a")
        other = Suitcase("B", 20, 20, 20, id="b")
        r = pack_bags([small, other], [brick(i) for i in range(12)], FAST)
        self.assertFalse(r.unpacked)
        self.assertEqual([len(x.placements) for x in r.results], [8, 4])
        self.assert_valid(r)

    def test_lithium_battery_goes_in_a_cabin_bag(self):
        bank = Item("power_bank", "Power bank", 15, 7.5, 2.2, weight=0.35, cabin="required")
        r = pack_bags([CHECKED, CABIN], [bank, *[brick(i) for i in range(5)]], FAST)
        self.assertEqual(self.bag_of(r, "power_bank"), "cabin")
        # everything else fills the hold first, keeping the carry-on light
        self.assertEqual({self.bag_of(r, f"b{i}") for i in range(5)}, {"hold"})
        self.assert_valid(r)

    def test_lithium_battery_left_out_when_cabin_bags_are_full(self):
        bank = Item("power_bank", "Power bank", 15, 7.5, 2.2, cabin="required")
        tiny_cabin = Suitcase("Pouch", 10, 10, 10, kind="personal", id="pouch")
        r = pack_bags([CHECKED, tiny_cabin], [bank], FAST)
        self.assertEqual(r.unpacked[0].reason, "must travel in the cabin, but no cabin bag has room")

    def test_valuables_and_need_it_first_items_stay_with_you(self):
        laptop = Item("laptop", "Laptop", 30, 21, 1.6, weight=1.3, fragile=True, cabin="preferred")
        passport = Item("passport", "Passport", 12.5, 9, 0.8, weight=0.05, priority=True)
        items = [laptop, passport, *[brick(i) for i in range(4)]]
        r = pack_bags([CHECKED, CABIN, PERSONAL], items, FAST)
        self.assertEqual(self.bag_of(r, "laptop"), "seat")
        self.assertEqual(self.bag_of(r, "passport"), "seat")
        self.assertFalse(r.buried_priority())
        self.assert_valid(r)

    def test_user_choice_of_bag_wins(self):
        laptop = Item("laptop", "Laptop", 30, 21, 1.6, cabin="preferred", bag="hold")
        sock = Item("sock", "Sock", 12, 7, 6, bag="seat")
        r = pack_bags([CHECKED, PERSONAL], [laptop, sock], FAST)
        self.assertEqual(self.bag_of(r, "laptop"), "hold")
        self.assertEqual(self.bag_of(r, "sock"), "seat")
        # a bag id that no longer exists falls back to the automatic choice
        lost = Item("lost", "Lost", 5, 5, 5, bag="gone")
        self.assertEqual(bag_preferences(lost, [CHECKED, PERSONAL])[0], [0, 1])

    def test_weight_limits_are_per_bag(self):
        heavy = [brick(i, weight=6) for i in range(5)]  # 30 kg in all
        light_bag = Suitcase("Light", 40, 40, 40, max_weight=12, id="l")
        other = Suitcase("Other", 40, 40, 40, max_weight=12, id="o")
        r = pack_bags([light_bag, other], heavy, FAST)
        self.assertEqual(len(r.placements), 4)
        self.assertEqual(r.unpacked[0].reason, "would exceed the weight limit")
        self.assert_valid(r)

    def test_too_big_for_every_bag(self):
        r = pack_bags([CABIN, PERSONAL], [Item("ski", "Skis", 160, 20, 10)], FAST)
        self.assertEqual(r.unpacked[0].reason, "larger than every bag in every orientation")

    def test_one_bag_matches_the_single_suitcase_packer(self):
        items = [Item(f"i{k}", f"Item {k}", 10 + k % 7, 8 + k % 5, 3 + k % 4, weight=0.3) for k in range(25)]
        case = Suitcase("Case", 55, 35, 23, max_weight=10, kind="cabin", id="only")
        single = pack(case, items, FAST)
        multi = pack_bags([case], items, FAST)
        as_tuple = lambda placements: [(p.item.id, p.x, p.y, p.z, p.perm) for p in placements]
        self.assertEqual(as_tuple(single.placements), as_tuple(multi.placements))

    def test_layout_numbers_steps_across_bags(self):
        bank = Item("power_bank", "Power bank", 15, 7.5, 2.2, cabin="required")
        r = pack_bags([CHECKED, PERSONAL], [bank, *[brick(i) for i in range(3)]], FAST)
        layout = bags_layout_dict(r)
        self.assertEqual([s["step"] for s in layout["steps"]], [1, 2, 3, 4])
        self.assertEqual([s["bag"] for s in layout["steps"]], [0, 0, 0, 1])
        self.assertEqual(layout["steps"][3]["bag_step"], 1)
        self.assertIn("of the Backpack", layout["steps"][3]["instruction"])
        self.assertEqual(layout["metrics"]["items_packed"], 4)
        self.assertEqual(layout["metrics"]["weight_limit_kg"], 30)
        self.assertEqual(layout["bags"][1]["kind"], "personal")

    def test_no_cabin_bag_flags_the_battery(self):
        bank = Item("power_bank", "Power bank", 15, 7.5, 2.2, cabin="required")
        layout = bags_layout_dict(pack_bags([CHECKED], [bank], FAST))
        self.assertTrue(layout["steps"][0]["cabin_warning"])
        self.assertIn("carry it on board", layout["steps"][0]["instruction"])

    def test_command_line_packs_a_two_bag_trip(self):
        import contextlib
        import io
        import json
        import tempfile

        import main

        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            code = main.main(["--input", str(ROOT / "data" / "two_bag_trip.json"), "--output", tmp,
                              "--time-limit", "3", "--no-preview"])
            layout = json.loads((Path(tmp) / "layout.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 0)
        self.assertEqual([b["id"] for b in layout["bags"]], ["hold", "seat"])
        bag_of = {st["id"]: layout["bags"][st["bag"]]["id"] for st in layout["steps"]}
        for item in ("power_bank", "laptop", "camera", "passport", "book"):
            self.assertEqual(bag_of[item], "seat", item)

    def test_saved_trips_keep_their_bags(self):
        import tempfile

        from packing_assistant.catalog import load_trips, save_trip

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trips.json"
            save_trip({"name": "Two bags", "qty": {"tshirt": 2}, "assign": {"tshirt": "b2"}, "bags": [
                {"uid": "b1", "presetId": "large", "kind": "checked", "shell": "#2f4858",
                 "dims": {"length": 75, "width": 50, "height": 30, "max_weight": 23}},
                {"uid": "b2", "presetId": "underseat", "kind": "under the bed", "dims": {"length": "x"}},
                "not a bag",
            ]}, path)
            trip = load_trips(path)[0]
        self.assertEqual([b["uid"] for b in trip["bags"]], ["b1", "b2"])
        self.assertEqual(trip["bags"][1]["kind"], "checked")  # unknown kinds fall back
        self.assertEqual(trip["bags"][1]["dims"], {})  # bad sizes are dropped (the app uses the preset)
        self.assertEqual(trip["assign"], {"tshirt": "b2"})

    def test_bad_bags_are_rejected(self):
        with self.assertRaises(ValueError):
            pack_bags([], [brick(0)], FAST)
        with self.assertRaises(ValueError):
            pack_bags([Suitcase("A", 10, 10, 10, id="x"), Suitcase("B", 10, 10, 10, id="x")], [brick(0)], FAST)
        with self.assertRaises(ValueError):
            Suitcase("A", 10, 10, 10, kind="roof box")


if __name__ == "__main__":
    unittest.main()
