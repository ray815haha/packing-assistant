Put your own 3D models here to replace the built-in ones.

Name each file after the catalog item id, e.g. sneakers.glb, laptop_13.glb
(ids are in data/catalog.json). Format: glTF Binary (.glb), no compression.
A file here wins over the built-in model for that item.

The built-in models are in types/, one per model type, made by
blender/make_models.py (don't edit them by hand; change the script and run
it again). Materials whose name starts with "tint" take the item's colour.
In Blender: File > Export > glTF 2.0, Format "glTF Binary (.glb)".
Model the item as it sits when packed (folded, rolled, closed...).
Reload the page after adding a file.
