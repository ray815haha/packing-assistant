"""Tests for the catalog layer and the web app's packing endpoint (no browser needed)."""

import json
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app  # noqa: E402
from packing_assistant.catalog import build_trip, enrich_layout, load_catalog  # noqa: E402

KNOWN_MODELS = {
    "tshirt", "polo", "dress_shirt", "sweater", "hoodie", "jacket", "puffer", "blazer", "jeans", "shorts",
    "dress", "swimsuit", "roll", "socks", "cap", "sun_hat", "sneakers", "dress_shoes", "boots", "sandals",
    "flip_flops", "slippers", "pouch", "bottle", "pump_bottle", "tube", "capsule", "spray_can", "perfume",
    "jar", "razor", "hair_dryer", "straightener", "first_aid", "medicine", "laptop", "tablet", "ereader",
    "headphone_case", "earbuds", "power_bank", "charger", "camera", "lens", "adapter", "console",
    "glasses_case", "watch_box", "drawstring", "wallet", "belt", "umbrella", "neck_pillow", "flask",
    "tumbler", "passport", "folder", "book", "notebook", "packing_cube", "laundry_bag", "towel_roll",
    "snack_box", "gift", "tripod", "box",
}


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_catalog_is_consistent(self):
        items = self.catalog["items"]
        self.assertGreaterEqual(len(items), 80)
        ids = [i["id"] for i in items]
        self.assertEqual(len(ids), len(set(ids)))
        cats = {c["id"] for c in self.catalog["categories"]}
        for it in items:
            self.assertIn(it["category"], cats, it["id"])
            self.assertIn(it["model"], KNOWN_MODELS, it["id"])
            for k in ("length", "width", "height"):
                self.assertGreater(it[k], 0, it["id"])

    def test_models_match_the_web_builders(self):
        js = (ROOT / "web" / "js" / "models.js").read_text(encoding="utf-8")
        exported = js[js.index("export const MODEL_BUILDERS"):]
        for model in {i["model"] for i in self.catalog["items"]}:
            self.assertRegex(exported, rf"\b{model}\b", model)

    def test_profiles_reference_real_items_and_suitcases(self):
        ids = {i["id"] for i in self.catalog["items"]}
        cases = {s["id"] for s in self.catalog["suitcases"]}
        for p in self.catalog["profiles"]:
            self.assertIn(p["suitcase"], cases)
            for k in p["items"]:
                self.assertIn(k, ids, (p["id"], k))

    def test_build_trip_and_enrich(self):
        req = {
            "suitcase": {"name": "Carry-on", "length": 55, "width": 35, "height": 23, "max_weight": 10},
            "items": [{"id": "sneakers", "quantity": 1}, {"id": "tshirt", "quantity": 2}],
            "custom_items": [{"id": "game", "name": "Board game", "length": 30, "width": 30, "height": 7,
                              "weight": 1, "model": "gift", "color": "#123456"}],
        }
        suitcase, items = build_trip(self.catalog, req)
        self.assertEqual(len(items), 4)
        layout = app.pack_request({**req, "options": {"time_limit": 2}})
        models = {s["id"]: s["model"] for s in layout["steps"]}
        self.assertEqual(models["sneakers"], "sneakers")
        self.assertEqual(models["tshirt#1"], "tshirt")
        self.assertEqual(models["game"], "gift")
        self.assertIn("hex_color", layout["steps"][0])
        _ = enrich_layout  # imported for API completeness

    def test_web_copy_of_catalog_is_in_sync(self):
        web = json.loads((ROOT / "web" / "data" / "catalog.json").read_text(encoding="utf-8"))
        self.assertEqual(web, self.catalog, "run: python tools/make_catalog.py")

    def test_priority_override_and_squeeze_option(self):
        req = {
            "suitcase": {"length": 40, "width": 30, "height": 20},
            "items": [{"id": "book", "quantity": 2, "priority": True}, {"id": "passport", "quantity": 1, "priority": False}],
            "options": {"time_limit": 1, "allow_squeeze": False},
        }
        layout = app.pack_request(req)
        prio = {s["id"]: s["priority"] for s in layout["steps"]}
        self.assertTrue(prio["book#1"])
        self.assertFalse(prio["passport"])
        self.assertEqual(layout["metrics"]["squeezed_items"], 0)

    def test_unknown_item_is_rejected(self):
        with self.assertRaises(ValueError):
            build_trip(self.catalog, {"suitcase": {"length": 10, "width": 10, "height": 10}, "items": [{"id": "nope"}]})

    def test_every_profile_fits_its_suitcase(self):
        for p in self.catalog["profiles"]:
            s = next(x for x in self.catalog["suitcases"] if x["id"] == p["suitcase"])
            req = {"suitcase": s, "items": [{"id": k, "quantity": v} for k, v in p["items"].items()],
                   "options": {"time_limit": 6}}
            layout = app.pack_request(req)
            self.assertFalse(layout["unpacked"], f"{p['id']}: {[u['name'] for u in layout['unpacked']]}")


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import tempfile
        from packing_assistant import catalog as catalog_module
        cls._tmp = tempfile.TemporaryDirectory()
        cls._old_trips = catalog_module.TRIPS_PATH
        catalog_module.TRIPS_PATH = Path(cls._tmp.name) / "trips.json"
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        from packing_assistant import catalog as catalog_module
        cls.server.shutdown()
        cls.server.server_close()
        catalog_module.TRIPS_PATH = cls._old_trips
        cls._tmp.cleanup()

    def send(self, method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_saved_trips_round_trip(self):
        saved = self.send("POST", "/api/trips", {"name": "Tokyo in March", "suitcase": {"length": 55, "width": 35, "height": 23},
                                                   "qty": {"tshirt": 3, "jeans": 0}, "priority": {"passport": True}})
        self.assertEqual(saved["qty"], {"tshirt": 3})
        trips = self.send("GET", "/api/trips")
        self.assertEqual([t["name"] for t in trips], ["Tokyo in March"])
        # saving under the same name replaces it
        self.send("POST", "/api/trips", {"name": "Tokyo in March", "qty": {"tshirt": 4}})
        trips = self.send("GET", "/api/trips")
        self.assertEqual(len(trips), 1)
        self.assertEqual(trips[0]["qty"], {"tshirt": 4})
        self.assertTrue(self.send("DELETE", f"/api/trips/{trips[0]['id']}")["deleted"])
        self.assertEqual(self.send("GET", "/api/trips"), [])
        with self.assertRaises(urllib.error.HTTPError):
            self.send("POST", "/api/trips", {"name": "  "})

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.headers.get("Content-Type"), r.read()

    def test_serves_page_and_scripts(self):
        status, ctype, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Smart Packing Assistant", body)
        status, ctype, _ = self.get("/js/main.js")
        self.assertIn("javascript", ctype)

    def test_catalog_endpoint(self):
        _, _, body = self.get("/api/catalog")
        data = json.loads(body)
        self.assertIn("custom_models", data)
        self.assertGreaterEqual(len(data["items"]), 80)

    def test_pack_endpoint_and_errors(self):
        body = json.dumps({"suitcase": {"length": 40, "width": 30, "height": 20},
                           "items": [{"id": "book", "quantity": 2}], "options": {"time_limit": 1}}).encode()
        req = urllib.request.Request(self.base + "/api/pack", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
        self.assertEqual(data["metrics"]["items_packed"], 2)
        bad = urllib.request.Request(self.base + "/api/pack", data=b'{"items": []}')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(bad)
        self.assertEqual(ctx.exception.code, 400)

    def test_no_path_traversal(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.base + "/%2e%2e/app.py")
        self.assertIn(ctx.exception.code, (403, 404))


if __name__ == "__main__":
    unittest.main()
