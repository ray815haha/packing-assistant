"""Generates data/catalog.json (kept as code so it's easy to edit in bulk)."""
import json
from pathlib import Path

# id, name, category, model, L, W, H (cm, as it sits when packed: H is the
# thickness when lying flat), weight kg, colour, flags
C = "clothing"; S = "shoes"; T = "toiletries"; E = "electronics"; A = "accessories"; D = "documents"; G = "travel gear"
ITEMS = [
    # --- clothing -----------------------------------------------------------
    ("tshirt",        "T-shirt (folded)",            C, "tshirt",     28, 20, 3,   0.18, "#2f6fb0", {}),
    ("tshirt_white",  "White T-shirt (folded)",      C, "tshirt",     28, 20, 3,   0.18, "#f1efe9", {}),
    ("polo",          "Polo shirt (folded)",         C, "polo",       28, 21, 3.5, 0.25, "#1f7a5c", {}),
    ("dress_shirt",   "Dress shirt (folded)",        C, "dress_shirt",30, 23, 4,   0.25, "#cfe0f3", {}),
    ("tank_top",      "Tank top (folded)",           C, "tshirt",     24, 16, 2,   0.10, "#e0715a", {}),
    ("sweater",       "Knit sweater (folded)",       C, "sweater",    32, 26, 7,   0.55, "#9b6b4a", {}),
    ("hoodie",        "Hoodie (folded)",             C, "hoodie",     33, 27, 8,   0.65, "#6b6f78", {}),
    ("light_jacket",  "Light jacket (folded)",       C, "jacket",     35, 28, 7,   0.60, "#2c3e50", {}),
    ("puffer_jacket", "Packable puffer (in pouch)",  C, "puffer",     25, 18, 12,  0.35, "#d64541", {}),
    ("blazer",        "Blazer (folded)",             C, "blazer",     40, 30, 6,   0.80, "#34383f", {}),
    ("jeans",         "Jeans (folded)",              C, "jeans",      32, 26, 5,   0.70, "#3b5b87", {}),
    ("chinos",        "Chinos (folded)",             C, "jeans",      32, 25, 4,   0.50, "#c2a878", {}),
    ("dress_pants",   "Dress trousers (folded)",     C, "jeans",      34, 26, 3.5, 0.45, "#2d2f36", {}),
    ("shorts",        "Shorts (folded)",             C, "shorts",     25, 20, 3.5, 0.25, "#6e8b3d", {}),
    ("leggings",      "Leggings (rolled)",           C, "roll",       24, 9, 9,    0.20, "#222428", {}),
    ("dress",         "Summer dress (folded)",       C, "dress",      32, 24, 4,   0.30, "#e8a0b4", {}),
    ("skirt",         "Skirt (folded)",              C, "shorts",     28, 22, 3,   0.25, "#7d4e8c", {}),
    ("pajamas",       "Pyjamas set (folded)",        C, "dress_shirt",30, 24, 5,   0.40, "#a7c4d9", {}),
    ("underwear",     "Underwear (rolled)",          C, "roll",       14, 6, 6,    0.06, "#40444c", {"quantity_hint": 5}),
    ("socks",         "Socks (pair, rolled)",        C, "socks",      12, 7, 6,    0.06, "#d8d2c4", {"quantity_hint": 5}),
    ("swimsuit",      "Swimsuit",                    C, "swimsuit",   20, 15, 2.5, 0.12, "#2bb3c0", {}),
    ("swim_shorts",   "Swim shorts (folded)",        C, "shorts",     24, 19, 3,   0.20, "#f39c34", {}),
    ("scarf",         "Scarf (rolled)",              C, "roll",       28, 9, 9,    0.20, "#b33b3b", {}),
    ("baseball_cap",  "Baseball cap",                C, "cap",        27, 19, 12,  0.10, "#1d3557", {"upright": True}),
    ("sun_hat",       "Packable sun hat (folded)",   C, "sun_hat",    30, 30, 8,   0.15, "#e9d8a6", {}),
    ("gym_outfit",    "Gym outfit (rolled bundle)",  C, "roll",       26, 11, 11,  0.35, "#4ba3c7", {}),
    # --- shoes --------------------------------------------------------------
    ("sneakers",      "Sneakers (pair)",             S, "sneakers",   31, 22, 12,  0.85, "#f4f4f4", {}),
    ("running_shoes", "Running shoes (pair)",        S, "sneakers",   30, 21, 11,  0.55, "#ff6b35", {}),
    ("dress_shoes",   "Leather shoes (pair)",        S, "dress_shoes",30, 20, 11,  1.00, "#4a2c1d", {}),
    ("ankle_boots",   "Ankle boots (pair)",          S, "boots",      29, 20, 17,  1.30, "#6b4226", {}),
    ("sandals",       "Sandals (pair)",              S, "sandals",    27, 20, 5,   0.50, "#8b5a2b", {}),
    ("flip_flops",    "Flip-flops (pair)",           S, "flip_flops", 27, 21, 3,   0.25, "#2d9cdb", {}),
    ("slippers",      "Hotel slippers (pair)",       S, "slippers",   27, 20, 4,   0.20, "#dfe6e9", {}),
    # --- toiletries ---------------------------------------------------------
    ("toiletry_bag",  "Toiletry bag",                T, "pouch",      24, 14, 11,  0.90, "#2e4057", {}),
    ("makeup_bag",    "Makeup bag",                  T, "pouch",      20, 11, 9,   0.50, "#e3a6b3", {}),
    ("shampoo",       "Shampoo (travel size)",       T, "bottle",     6, 3.5, 13,  0.12, "#5fb49c", {"upright": True}),
    ("conditioner",   "Conditioner (travel size)",   T, "bottle",     6, 3.5, 13,  0.12, "#f0c75e", {"upright": True}),
    ("body_lotion",   "Body lotion (pump)",          T, "pump_bottle",6, 6, 17,    0.25, "#f6e7d8", {"upright": True}),
    ("sunscreen",     "Sunscreen tube",              T, "tube",       16, 5, 3.5,  0.12, "#ffb400", {}),
    ("toothpaste",    "Toothpaste",                  T, "tube",       15, 4, 3,    0.08, "#e8f1f8", {}),
    ("toothbrush",    "Toothbrush in case",          T, "capsule",    21, 3.5, 3,  0.04, "#7ec8e3", {}),
    ("deodorant",     "Deodorant spray",             T, "spray_can",  5, 5, 15,    0.15, "#34495e", {"upright": True}),
    ("perfume",       "Perfume",                     T, "perfume",    7, 4, 11,    0.20, "#f7d794", {"upright": True, "fragile": True}),
    ("face_cream",    "Face cream jar",              T, "jar",        7, 7, 5,     0.10, "#ffffff", {}),
    ("razor",         "Razor",                       T, "razor",      15, 4.5, 3,  0.06, "#2c3e50", {}),
    ("hair_dryer",    "Travel hair dryer",           T, "hair_dryer", 22, 16, 8,   0.55, "#3d3d3d", {}),
    ("straightener",  "Hair straightener",           T, "straightener",28, 5, 4,   0.35, "#1b1b1b", {}),
    ("first_aid",     "First-aid kit",               T, "first_aid",  18, 12, 6,   0.30, "#d63031", {}),
    ("medicine",      "Medicine box",                T, "medicine",   11, 7, 4,    0.08, "#ffffff", {}),
    # --- electronics --------------------------------------------------------
    ("laptop_13",     "Laptop 13\"",                 E, "laptop",     30.5, 21.5, 1.6, 1.25, "#b8bcc2", {"fragile": True}),
    ("laptop_15",     "Laptop 15\"",                 E, "laptop",     35.7, 24.5, 1.8, 1.85, "#4a4d52", {"fragile": True}),
    ("tablet",        "Tablet",                      E, "tablet",     25, 17.5, 0.8, 0.50, "#2b2b2b", {"fragile": True}),
    ("ereader",       "E-reader",                    E, "ereader",    17.5, 12.5, 0.9, 0.20, "#3a3a3a", {}),
    ("headphones",    "Over-ear headphones (case)",  E, "headphone_case", 21, 18, 8, 0.45, "#1e1e24", {}),
    ("earbuds",       "Wireless earbuds",            E, "earbuds",    6, 5, 3,     0.05, "#fafafa", {}),
    ("power_bank",    "Power bank",                  E, "power_bank", 15, 7.5, 2.2, 0.35, "#222831", {}),
    ("charger",       "Laptop charger",              E, "charger",    10, 7, 3,    0.30, "#f5f5f5", {}),
    ("cable_pouch",   "Cable pouch",                 E, "pouch",      20, 12, 5,   0.30, "#556270", {}),
    ("camera",        "Mirrorless camera",           E, "camera",     13, 10, 9,   0.65, "#1c1c1c", {"fragile": True}),
    ("camera_lens",   "Spare lens",                  E, "lens",       7, 7, 9,     0.40, "#1c1c1c", {"fragile": True, "upright": True}),
    ("adapter",       "Travel adapter",              E, "adapter",    7, 5.5, 5,   0.15, "#ecf0f1", {}),
    ("game_console",  "Handheld game console",       E, "console",    24, 10.5, 2.5, 0.40, "#2f2f2f", {"fragile": True}),
    # --- accessories --------------------------------------------------------
    ("sunglasses",    "Sunglasses (hard case)",      A, "glasses_case", 16, 7, 5,  0.10, "#3d2b1f", {"fragile": True}),
    ("glasses",       "Reading glasses (case)",      A, "glasses_case", 16, 6.5, 4.5, 0.08, "#16a085", {"fragile": True}),
    ("watch_box",     "Watch box",                   A, "watch_box",  10, 10, 7,   0.25, "#2d3436", {"fragile": True}),
    ("jewelry",       "Jewellery pouch",             A, "drawstring", 12, 10, 5,   0.10, "#8e44ad", {}),
    ("wallet",        "Travel wallet",               A, "wallet",     19, 10, 2,   0.15, "#6d4c41", {}),
    ("belt",          "Belt (coiled)",               A, "belt",       12, 12, 4,   0.20, "#3e2723", {}),
    ("umbrella",      "Compact umbrella",            A, "umbrella",   28, 6, 6,    0.30, "#2c3e50", {}),
    ("neck_pillow",   "Travel neck pillow",          A, "neck_pillow",30, 28, 12,  0.30, "#95a5a6", {}),
    ("water_bottle",  "Water bottle",                A, "flask",      7.5, 7.5, 24, 0.35, "#00a8a8", {}),
    ("tumbler",       "Coffee tumbler",              A, "tumbler",    9, 9, 18,    0.30, "#e17055", {"upright": True}),
    ("eye_mask",      "Sleep mask & earplugs",       A, "pouch",      20, 9, 3,    0.05, "#2d3436", {}),
    # --- documents ----------------------------------------------------------
    ("passport",      "Passport",                    D, "passport",   12.5, 9, 0.8, 0.05, "#7b1e2b", {}),
    ("documents",     "Travel documents folder",     D, "folder",     33, 24, 1.5, 0.30, "#3867d6", {}),
    ("book",          "Paperback book",              D, "book",       20, 13, 3,   0.30, "#e1b12c", {}),
    ("hardcover",     "Hardcover book",              D, "book",       24, 16, 4,   0.70, "#273c75", {}),
    ("notebook",      "Notebook",                    D, "notebook",   21, 14.5, 1.8, 0.25, "#2f3640", {}),
    # --- travel gear --------------------------------------------------------
    ("cube_s",        "Packing cube S (filled)",     G, "packing_cube", 25, 18, 9,  0.80, "#6c5ce7", {}),
    ("cube_m",        "Packing cube M (filled)",     G, "packing_cube", 33, 25, 10, 1.30, "#00b894", {}),
    ("cube_l",        "Packing cube L (filled)",     G, "packing_cube", 42, 30, 10, 1.90, "#0984e3", {}),
    ("compression_cube","Compression cube (filled)", G, "packing_cube", 33, 25, 6,  1.20, "#fd9644", {}),
    ("laundry_bag",   "Laundry bag (folded)",        G, "laundry_bag",20, 15, 2,   0.08, "#dcdde1", {}),
    ("towel",         "Microfibre towel (rolled)",   G, "towel_roll", 25, 10, 10,  0.25, "#48dbfb", {}),
    ("beach_towel",   "Beach towel (rolled)",        G, "towel_roll", 35, 14, 14,  0.60, "#ff9f43", {}),
    ("snacks",        "Snack box",                   G, "snack_box",  18, 12, 6,   0.40, "#f8c291", {}),
    ("gift",          "Gift box",                    G, "gift",       20, 15, 10,  0.50, "#c0392b", {"fragile": True}),
    ("tripod",        "Travel tripod",               G, "tripod",     40, 8, 8,    1.10, "#2d3436", {}),
    ("yoga_mat",      "Travel yoga mat (rolled)",    G, "towel_roll", 61, 11, 11,  1.00, "#8854d0", {}),
]

SUITCASES = [
    {"id": "underseat", "name": "Under-seat bag", "length": 40, "width": 30, "height": 20, "max_weight": 7},
    {"id": "carry_on", "name": "Carry-on", "length": 55, "width": 35, "height": 23, "max_weight": 10},
    {"id": "medium", "name": "Medium check-in", "length": 65, "width": 44, "height": 27, "max_weight": 23},
    {"id": "large", "name": "Large check-in", "length": 75, "width": 50, "height": 30, "max_weight": 23},
]

PROFILES = [
    {"id": "weekend", "name": "Weekend getaway", "suitcase": "carry_on", "items": {
        "tshirt": 2, "jeans": 1, "hoodie": 1, "underwear": 3, "socks": 2,
        "pajamas": 1, "sneakers": 1, "toiletry_bag": 1, "power_bank": 1, "charger": 1,
        "sunglasses": 1, "passport": 1}},
    {"id": "business", "name": "Business trip (3 days)", "suitcase": "carry_on", "items": {
        "dress_shirt": 2, "dress_pants": 1, "blazer": 1, "underwear": 3, "socks": 3, "dress_shoes": 1,
        "laptop_13": 1, "charger": 1, "toiletry_bag": 1, "documents": 1, "belt": 1}},
    {"id": "beach", "name": "Beach week", "suitcase": "medium", "items": {
        "tshirt": 3, "tank_top": 3, "polo": 1, "shorts": 3, "swim_shorts": 1, "swimsuit": 2, "dress": 2,
        "underwear": 7, "socks": 3, "sandals": 1, "flip_flops": 1, "sun_hat": 1, "sunscreen": 2,
        "toiletry_bag": 1, "beach_towel": 1, "sunglasses": 1, "book": 2, "water_bottle": 1,
        "earbuds": 1, "power_bank": 1, "snacks": 1}},
    {"id": "city", "name": "City break (5 days)", "suitcase": "medium", "items": {
        "tshirt": 2, "tshirt_white": 1, "sweater": 1, "light_jacket": 1, "jeans": 1, "chinos": 1,
        "underwear": 5, "socks": 5, "sneakers": 1, "toiletry_bag": 1, "camera": 1, "power_bank": 1,
        "charger": 1, "umbrella": 1, "passport": 1, "baseball_cap": 1}},
    {"id": "two_weeks", "name": "Two-week holiday", "suitcase": "large", "items": {
        "tshirt": 3, "tshirt_white": 2, "polo": 1, "dress_shirt": 1, "sweater": 1, "hoodie": 1,
        "light_jacket": 1, "jeans": 1, "chinos": 1, "shorts": 2, "swim_shorts": 1, "underwear": 8,
        "socks": 6, "pajamas": 1, "sneakers": 1, "sandals": 1, "toiletry_bag": 1, "makeup_bag": 1,
        "hair_dryer": 1, "laptop_13": 1, "charger": 1, "cable_pouch": 1, "camera": 1, "book": 2,
        "sunglasses": 1, "first_aid": 1, "documents": 1, "laundry_bag": 1}},
    {"id": "cubes", "name": "Packing-cube system", "suitcase": "carry_on", "items": {
        "cube_m": 2, "cube_s": 1, "sneakers": 1, "toiletry_bag": 1, "laptop_13": 1,
        "charger": 1, "water_bottle": 1, "passport": 1}},
]

CATEGORIES = [
    {"id": C, "name": "Clothing", "icon": "shirt"},
    {"id": S, "name": "Shoes", "icon": "shoe"},
    {"id": T, "name": "Toiletries", "icon": "drop"},
    {"id": E, "name": "Electronics", "icon": "bolt"},
    {"id": A, "name": "Accessories", "icon": "glasses"},
    {"id": D, "name": "Documents & books", "icon": "book"},
    {"id": G, "name": "Travel gear", "icon": "cube"},
]

# How much each kind of soft item can be squashed (share of its thickness).
SQUEEZE = {
    "tshirt": 0.35, "polo": 0.35, "dress_shirt": 0.3, "sweater": 0.4, "hoodie": 0.4, "jacket": 0.4,
    "puffer": 0.5, "blazer": 0.2, "jeans": 0.3, "shorts": 0.35, "dress": 0.4, "swimsuit": 0.4,
    "roll": 0.3, "socks": 0.3, "sun_hat": 0.3, "towel_roll": 0.3, "laundry_bag": 0.5,
    "neck_pillow": 0.4, "drawstring": 0.3, "slippers": 0.3,
}
SQUEEZE_BY_ID = {"cube_s": 0.2, "cube_m": 0.2, "cube_l": 0.2, "compression_cube": 0.35, "eye_mask": 0.3}
# Things you usually want to grab without unpacking.
NEED_FIRST = {"passport", "documents", "wallet", "earbuds", "eye_mask", "medicine", "power_bank"}

items = []
for (iid, name, cat, model, l, w, h, kg, color, flags) in ITEMS:
    e = {"id": iid, "name": name, "category": cat, "model": model, "length": l, "width": w,
         "height": h, "weight": kg, "color": color}
    sq = SQUEEZE_BY_ID.get(iid, SQUEEZE.get(model, 0))
    if sq:
        e["squeeze"] = sq
    if iid in NEED_FIRST:
        e["priority"] = True
    e.update({k: v for k, v in flags.items()})
    items.append(e)
ids = [i["id"] for i in items]
assert len(ids) == len(set(ids)), "duplicate ids"
for p in PROFILES:
    for k in p["items"]:
        assert k in ids, (p["id"], k)

out = {"categories": CATEGORIES, "suitcases": SUITCASES, "profiles": PROFILES, "items": items}
path = Path(__file__).resolve().parent.parent / "data" / "catalog.json"
path.write_text(json.dumps(out, indent=1), encoding="utf-8")
# Copy for the browser-only (hosted) version of the app, which has no API.
web_copy = path.parent.parent / "web" / "data" / "catalog.json"
web_copy.parent.mkdir(parents=True, exist_ok=True)
web_copy.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(f"{len(items)} items, {len(PROFILES)} profiles -> {path} (+ {web_copy.name} for the web)")
