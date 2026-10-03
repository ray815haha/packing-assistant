"""Tests for weight balance: heavy things at the wheel end and the back panel."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from packing_assistant import Item, PackerConfig, Suitcase, pack, pack_bags  # noqa: E402
from packing_assistant.optimizer import PackingResult  # noqa: E402
from packing_assistant.models import Placement  # noqa: E402

FAST = PackerConfig(restarts=60, seed=3, time_limit_s=5)


def brick(i, weight, size=10.0):
    return Item(f"b{i}", f"Brick {i}", size, size, size, weight=weight)


def result_with(case, placements):
    return PackingResult(case, [Placement(it, x, y, z, (0, 1, 2)) for it, x, y, z in placements], [])


class BalanceTests(unittest.TestCase):
    def test_heavy_items_end_up_at_the_wheel_end(self):
        # a long case, half full: two heavy bricks and six light ones
        case = Suitcase("Case", 80, 20, 10, kind="checked")
        items = [brick(0, 5), brick(1, 5), *[brick(i, 0.2) for i in range(2, 8)]]
        r = pack(case, items, FAST)
        self.assertEqual(len(r.placements), 8)
        heavy_x = [p.x for p in r.placements if p.item.weight == 5]
        self.assertLessEqual(max(heavy_x), 20, "heavy bricks should sit at the wheel end (x = 0)")
        b = r.metrics()["balance"]
        self.assertEqual(b["rating"], "good")
        self.assertLess(b["along"], 0.3)

    def test_layout_is_turned_wheels_down(self):
        case = Suitcase("Case", 60, 20, 10)
        r = result_with(case, [(brick(0, 8), 50, 0, 0), (brick(1, 0.1), 0, 0, 0)])
        self.assertGreater(r.balance()["along"], 0.5)
        r.wheels_down()
        self.assertEqual(sorted((p.item.id, p.x) for p in r.placements), [("b0", 0), ("b1", 50)])
        self.assertLess(r.balance()["along"], 0.5)

    def test_bags_without_wheels_are_not_turned(self):
        bag = Suitcase("Backpack", 60, 20, 10, kind="personal")
        self.assertFalse(bag.has_wheels)
        r = result_with(bag, [(brick(0, 8), 50, 0, 0)])
        r.wheels_down()
        self.assertEqual(r.placements[0].x, 50)
        self.assertFalse(r.balance()["wheels"])
        # wheels can be set either way, whatever the kind
        self.assertTrue(Suitcase("Rolling backpack", 50, 30, 20, kind="personal", wheels=True).has_wheels)

    def test_ratings(self):
        case = Suitcase("Case", 60, 40, 20)
        heavy = brick(0, 6)
        top = result_with(case, [(heavy, 50, 15, 0)]).balance()
        self.assertEqual((top["rating"], top["issue"]), ("poor", "top-heavy"))
        side = result_with(case, [(heavy, 0, 0, 0), (brick(1, 6), 0, 0, 10)]).balance()
        self.assertEqual((side["rating"], side["issue"]), ("poor", "lopsided"))
        good = result_with(case, [(heavy, 0, 15, 0)]).balance()
        self.assertEqual(good["rating"], "good")
        # a bag this light is fine however it's packed
        light = result_with(case, [(brick(2, 0.5), 50, 0, 0)]).balance()
        self.assertEqual((light["rating"], light["issue"], light["light"]), ("good", None, True))
        self.assertIsNone(result_with(case, []).balance())

    def test_every_wheeled_bag_has_its_weight_on_the_wheel_half(self):
        hold = Suitcase("Hold", 65, 44, 27, kind="checked", id="hold")
        seat = Suitcase("Seat", 40, 30, 20, kind="personal", id="seat")
        items = [Item(f"i{k}", f"Item {k}", 10 + k % 9, 8 + k % 6, 3 + k % 5, weight=0.2 + (k % 7) * 0.3)
                 for k in range(30)]
        r = pack_bags([hold, seat], items, FAST)
        self.assertFalse(r.unpacked)
        self.assertLessEqual(r.results[0].balance()["along"], 0.5)

    def test_api_reports_balance_per_bag(self):
        import app

        layout = app.pack_request({
            "bags": [{"id": "a", "length": 55, "width": 35, "height": 23, "kind": "cabin"},
                     {"id": "b", "length": 40, "width": 30, "height": 20, "kind": "personal", "wheels": False}],
            "items": [{"id": "sneakers"}, {"id": "jeans", "quantity": 2}, {"id": "laptop_13"}],
            "options": {"time_limit": 2},
        })
        a, b = (bag["metrics"]["balance"] for bag in layout["bags"])
        self.assertTrue(a["wheels"])
        self.assertFalse(b["wheels"])
        self.assertIn(a["rating"], ("good", "ok", "poor"))


if __name__ == "__main__":
    unittest.main()
