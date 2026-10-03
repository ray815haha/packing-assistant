"""Checks the JavaScript engine (web/js/packer/engine.js), used when the app runs
without the Python server. Skipped if Node.js isn't installed."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js not installed")
class JsEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, str(ROOT / "tests" / "js_engine_check.mjs")],
                             capture_output=True, text=True, timeout=120, check=True)
        cls.report = {r["name"]: r for r in json.loads(out.stdout)}

    def test_layouts_are_physically_valid(self):
        for name, r in self.report.items():
            self.assertEqual(r["problems"], [], name)

    def test_every_preset_fits(self):
        for name, r in self.report.items():
            if name.startswith("overpacked"):
                continue
            self.assertEqual(r["packed"], r["total"], name)

    def test_squeezing_and_priorities(self):
        over = self.report["overpacked_carry_on"]
        self.assertGreater(over["squeezed"], 0)
        self.assertGreaterEqual(over["packed"], 22)
        for r in self.report.values():
            self.assertEqual(r["buried"], 0)

    def test_several_bags(self):
        r = self.report["bags_hold_and_backpack"]
        self.assertEqual(r["packed"], r["total"])
        self.assertEqual(r["bags"]["power_bank"], "seat")  # lithium: cabin only
        self.assertEqual(r["bags"]["laptop_13"], "seat")  # valuables stay with you
        self.assertEqual(r["bags"]["passport"], "seat")  # need-it-first too
        self.assertEqual(r["bags"]["jeans#1"], "hold")  # the rest fills the hold first
        self.assertEqual(r["bags"]["book"], "seat")  # the user's choice wins...
        self.assertEqual(r["bags"]["camera"], "hold")  # ...both ways
        self.assertEqual(r["warnings"], [])
        self.assertEqual(self.report["bags_no_cabin_bag"]["warnings"], ["power_bank"])

    def test_weight_balance(self):
        r = self.report["balance_heavy_to_wheels"]
        self.assertLessEqual(max(r["heavyX"]), 20)  # heavy bricks at the wheel end
        self.assertEqual(r["balance"][0]["rating"], "good")
        for name, rep in self.report.items():
            for bal in rep["balance"]:
                if bal and bal["wheels"]:
                    self.assertLessEqual(bal["along"], 0.5, name)  # turned wheels-down

    def test_preset_items_get_their_detailed_model(self):
        for name in ("weekend", "business", "beach", "city", "two_weeks", "cubes"):
            urls = self.report[name]["modelUrls"]
            self.assertTrue(urls and all(u and u.startswith("models/types/") for u in urls), (name, urls))

    def test_custom_items_keep_their_model(self):
        self.assertIn("gift", self.report["custom_and_priority_override"]["models"])


if __name__ == "__main__":
    unittest.main()
