"""Builds the browser-only version of the app.

    python tools/build_hosted.py              -> dist/site/  (a static website)
    python tools/build_hosted.py --artifact   -> dist/hosted/ (single-page form used
                                                 for the Claude-published version)

dist/site/ can be uploaded to any static host: GitHub Pages (see
tools/github-pages.yml), Netlify (drag the folder onto
app.netlify.com/drop), Cloudflare Pages, etc. It runs entirely in the
visitor's browser with the JavaScript packing engine, works offline once
opened, and can be installed as an app from Chrome or Edge.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def build_site(out: Path | None = None) -> Path:
    out = out or ROOT / "dist" / "site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB, out, ignore=shutil.ignore_patterns("__pycache__", "*.glb.tmp"))
    (out / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: serve files as-is
    # Pages that 404 (e.g. a mistyped path) land on the app instead of an error.
    shutil.copy2(out / "index.html", out / "404.html")
    return out


def build_artifact() -> Path:
    out = ROOT / "dist" / "hosted"
    if out.exists():
        shutil.rmtree(out)
    (out / "data").mkdir(parents=True)
    shutil.copytree(WEB / "js", out / "js")
    shutil.copy2(WEB / "data" / "catalog.json", out / "data" / "catalog.json")
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "css" / "app.css").read_text(encoding="utf-8")
    title = re.search(r"<title>.*?</title>", html, re.S).group(0)
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1).strip()
    # The publisher adds its own <html>/<head>, so this is title + styles + body.
    page = f"<meta charset=\"utf-8\">\n{title}\n<style>\n{css}\n</style>\n{body}\n"
    (out / "index.html").write_text(page, encoding="utf-8")
    return out


def main() -> None:
    out = build_artifact() if "--artifact" in sys.argv else build_site()
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    print(f"Built {out} ({len(files)} files)")


if __name__ == "__main__":
    main()
