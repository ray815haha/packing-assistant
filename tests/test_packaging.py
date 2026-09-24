"""Checks the launcher, installable-app and website packaging files."""

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT))


class PackagingTests(unittest.TestCase):
    def test_offline_cache_lists_real_files(self):
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        listed = re.findall(r"^  '([^']+)',$", sw, re.M)
        self.assertIn("js/main.js", listed)
        for f in listed:
            if f != "./":
                self.assertTrue((WEB / f).is_file(), f"sw.js caches missing file {f}")
        # every script the app needs must be cached, or it won't open offline
        for js in (WEB / "js").rglob("*.js"):
            self.assertIn(js.relative_to(WEB).as_posix(), listed)

    def test_manifest_icons_exist(self):
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        sizes = {i["sizes"] for i in manifest["icons"]}
        self.assertTrue({"192x192", "512x512"} <= sizes)
        for icon in manifest["icons"]:
            self.assertTrue((WEB / icon["src"]).is_file(), icon["src"])
        self.assertTrue((WEB / "icons" / "app.ico").is_file())

    def test_page_links_manifest(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertIn('rel="manifest"', html)
        self.assertIn('id="installBtn"', html)

    def test_windows_launchers_use_crlf(self):
        for name in ("Start Packing Assistant.bat", "Create Desktop Shortcut.bat", "Publish to GitHub.bat"):
            data = (ROOT / name).read_bytes()
            self.assertIn(b"\r\n", data, name)
            self.assertNotIn(b"\n", data.replace(b"\r\n", b""), f"{name} has bare LF line endings")
        self.assertIn(b"app.py --window", (ROOT / "Start Packing Assistant.bat").read_bytes())

    def test_pages_workflow_builds_the_site(self):
        wf = (ROOT / "tools" / "github-pages.yml").read_text(encoding="utf-8")
        self.assertIn("python tools/build_hosted.py", wf)
        self.assertIn("path: dist/site", wf)
        self.assertIn("tools\\github-pages.yml", (ROOT / "Publish to GitHub.bat").read_text(encoding="utf-8"))

    def test_site_build(self):
        import tools.build_hosted as build  # noqa: E402

        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            out = build.build_site(Path(tmp) / "site")
            self._check_site(out)

    def _check_site(self, out):
        for f in ("index.html", "404.html", ".nojekyll", "sw.js", "manifest.webmanifest", "data/catalog.json"):
            self.assertTrue((out / f).is_file(), f)


if __name__ == "__main__":
    unittest.main()
