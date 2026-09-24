"""Smart Packing Assistant: web app.

    python app.py            # starts the app and opens it in your browser
    python app.py --port 9000 --no-browser

Uses only the Python standard library. The page is served from ./web, and the
packing runs in Python via two JSON endpoints:

    GET    /api/catalog      item library, suitcase presets, trip profiles
    POST   /api/pack         {suitcase, items, custom_items, options} -> layout
    GET    /api/trips        saved trips (data/trips.json)
    POST   /api/trips        save a trip {name, suitcase, qty, priority, custom, shell}
    DELETE /api/trips/<id>   delete a saved trip
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
import traceback
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from packing_assistant import PackerConfig, pack
from packing_assistant.catalog import (
    build_trip, custom_models, delete_trip, enrich_layout, load_catalog, load_trips, save_trip,
)
from packing_assistant.visualizer import layout_dict

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MAX_BODY = 1_000_000
MAX_TIME_LIMIT = 30.0

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def pack_request(request: dict) -> dict:
    catalog = load_catalog()
    suitcase, items = build_trip(catalog, request)
    opts = request.get("options", {})
    config = PackerConfig(
        min_support=min(1.0, max(0.3, float(opts.get("min_support", 0.7)))),
        time_limit_s=min(MAX_TIME_LIMIT, max(0.5, float(opts.get("time_limit", 6)))),
        restarts=int(opts.get("restarts", 400)),
        seed=opts.get("seed", 42),
        allow_squeeze=bool(opts.get("allow_squeeze", True)),
    )
    started = time.perf_counter()
    result = pack(suitcase, items, config)
    layout = layout_dict(result)
    layout["elapsed_s"] = round(time.perf_counter() - started, 2)
    return enrich_layout(layout, catalog, request)


class Handler(BaseHTTPRequestHandler):
    server_version = "SmartPacking/0.2"

    def log_message(self, fmt, *args):  # quieter console
        if self.path.startswith("/api/"):
            sys.stderr.write("  %s %s\n" % (self.command, self.path))

    # -- helpers --------------------------------------------------------------
    def _json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel: str):
        rel = rel.lstrip("/") or "index.html"
        target = (WEB / rel).resolve()
        if WEB not in target.parents and target != WEB:
            return self.send_error(HTTPStatus.FORBIDDEN)
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -- routes ---------------------------------------------------------------
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/catalog":
            catalog = load_catalog()
            catalog["custom_models"] = custom_models()
            catalog["server"] = True
            return self._json(catalog)
        if path == "/api/trips":
            return self._json(load_trips())
        if path.startswith("/api/"):
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        return self._static(path)

    def do_DELETE(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/trips/"):
            ok = delete_trip(path.rsplit("/", 1)[-1])
            return self._json({"deleted": ok}, HTTPStatus.OK if ok else HTTPStatus.NOT_FOUND)
        return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/pack", "/api/trips"):
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                return self._json({"error": "request too large"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            request = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/trips":
                return self._json(save_trip(request))
            return self._json(pack_request(request))
        except (ValueError, KeyError, TypeError) as e:
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except Exception as e:  # pragma: no cover - unexpected
            traceback.print_exc()
            return self._json({"error": f"internal error: {e}"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def already_running(port: int) -> bool:
    """True if a Smart Packing Assistant server already answers on this port."""
    import urllib.request

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/catalog", timeout=1.5) as r:
            return bool(json.loads(r.read()).get("server"))
    except Exception:
        return False


def open_app(url: str, window: bool) -> None:
    """Open the app: in its own window (Edge/Chrome app mode) if asked and
    available, otherwise in the default browser."""
    if window:
        import shutil
        import subprocess

        candidates = [
            shutil.which("msedge"), shutil.which("chrome"), shutil.which("google-chrome"),
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
        for exe in candidates:
            if exe and Path(exe).is_file():
                try:
                    subprocess.Popen([exe, f"--app={url}", "--window-size=1440,900"])
                    return
                except OSError:
                    continue
    webbrowser.open(url)


def serve(port: int, open_browser: bool, window: bool = False) -> None:
    # One copy is enough: if the app is already running, just open it again.
    # (Keeping the same port also keeps the installed app and its offline copy.)
    if already_running(port):
        url = f"http://127.0.0.1:{port}/"
        print(f"Smart Packing Assistant is already running at {url}")
        if open_browser:
            open_app(url, window)
        return
    server = None
    for p in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f"No free port between {port} and {port + 19}.")
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Smart Packing Assistant running at {url}")
    print("Close this window (or press Ctrl+C) to stop it.")
    if open_browser:
        threading.Timer(0.6, lambda: open_app(url, window)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the Smart Packing Assistant web app.")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    ap.add_argument("--window", action="store_true", help="open in its own app window (Edge or Chrome)")
    args = ap.parse_args()
    serve(args.port, not args.no_browser, args.window)


if __name__ == "__main__":
    main()
