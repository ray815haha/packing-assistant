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

    def test_custom_items_keep_their_model(self):
        self.assertIn("gift", self.report["custom_and_priority_override"]["models"])


if __name__ == "__main__":
    unittest.main()
