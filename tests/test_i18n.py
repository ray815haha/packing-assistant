"""Every language must translate every string, item, category, suitcase and trip
preset (needs Node.js; skipped otherwise)."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js not installed")
class TranslationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, str(ROOT / "tests" / "i18n_check.mjs")],
                             capture_output=True, text=True, timeout=60, check=True)
        cls.report = json.loads(out.stdout)

    def test_traditional_chinese_is_offered(self):
        self.assertIn("zh-Hant", self.report["langs"])

    def test_no_missing_translations(self):
        for lang, missing in self.report["missing"].items():
            self.assertEqual(missing, [], lang)

    def test_page_uses_only_known_keys(self):
        self.assertEqual(self.report["unknownKeys"], [])


if __name__ == "__main__":
    unittest.main()
