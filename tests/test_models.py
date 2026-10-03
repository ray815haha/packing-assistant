"""Checks the built-in 3D product models (web/models/types, made by
blender/make_models.py) and how the app picks a model for each item."""

import json
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from packing_assistant.catalog import enrich_layout, load_catalog  # noqa: E402

TYPES = ROOT / "web" / "models" / "types"
MAX_KB = 600  # each model is downloaded when an item of that type is packed


def read_glb(path: Path) -> dict:
    data = path.read_bytes()
    magic, version, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, f"{path.name} is not a .glb file"
    assert version == 2 and length == len(data), f"{path.name}: bad header"
    n, kind = struct.unpack("<II", data[12:20])
    assert kind == 0x4E4F534A, f"{path.name}: first chunk is not JSON"
    return json.loads(data[20:20 + n])


class ModelFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_catalog_lists_every_model_file(self):
        files = self.catalog["model_files"]
        on_disk = {p.stem for p in TYPES.glob("*.glb")}
        self.assertEqual(set(files), on_disk, "run: python tools/make_catalog.py")
        models = {i["model"] for i in self.catalog["items"]}
        for model, url in files.items():
            self.assertIn(model, models)
            self.assertEqual(url, f"models/types/{model}.glb")

    def test_every_preset_item_has_a_detailed_model(self):
        files = self.catalog["model_files"]
        by_id = {i["id"]: i for i in self.catalog["items"]}
        for p in self.catalog["profiles"]:
            for item_id in p["items"]:
                self.assertIn(by_id[item_id]["model"], files, f"{p['id']}: {item_id}")

    def test_files_load_in_the_app(self):
        for path in sorted(TYPES.glob("*.glb")):
            with self.subTest(model=path.stem):
                self.assertLess(path.stat().st_size, MAX_KB * 1024, "too big to download per item")
                gltf = read_glb(path)
                # the app's loader supports no extensions, and no compression
                self.assertFalse(gltf.get("extensionsRequired"))
                self.assertTrue(gltf["meshes"])
                for img in gltf.get("images", []):
                    self.assertIn(img["mimeType"], ("image/jpeg", "image/png"))
                    self.assertIn("bufferView", img, "textures must be embedded")
                # something in every model takes the item's colour
                names = [m.get("name", "") for m in gltf.get("materials", [])]
                self.assertTrue(any(n.startswith("tint") for n in names), names)


class ModelChoiceTests(unittest.TestCase):
    def test_own_model_then_type_model_then_none(self):
        catalog = {
            "items": [{"id": "sneakers", "model": "sneakers"}, {"id": "gift", "model": "gift"}],
            "model_files": {"sneakers": "models/types/sneakers.glb"},
        }
        layout = {"steps": [{"id": "sneakers"}, {"id": "gift"}], "unpacked": [{"id": "sneakers#2"}]}
        out = enrich_layout(json.loads(json.dumps(layout)), catalog, {}, models={})
        self.assertEqual(out["steps"][0]["model_url"], "models/types/sneakers.glb")
        self.assertIsNone(out["steps"][1]["model_url"])  # the app draws its simple shape
        self.assertEqual(out["unpacked"][0]["model_url"], "models/types/sneakers.glb")
        # a user's own web/models/<item id>.glb wins
        out = enrich_layout(json.loads(json.dumps(layout)), catalog, {}, models={"sneakers": "models/sneakers.glb"})
        self.assertEqual(out["steps"][0]["model_url"], "models/sneakers.glb")

    def test_custom_items_use_the_model_they_look_like(self):
        catalog = {"items": [], "model_files": {"sneakers": "models/types/sneakers.glb"}}
        request = {"custom_items": [{"id": "mine", "name": "Boots", "model": "sneakers"}]}
        out = enrich_layout({"steps": [{"id": "mine"}], "unpacked": []}, catalog, request, models={})
        self.assertEqual(out["steps"][0]["model_url"], "models/types/sneakers.glb")


if __name__ == "__main__":
    unittest.main()
