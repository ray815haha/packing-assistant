# Smart Packing Assistant

Pick what you're bringing, and the app works out a compact, physically stable
way to pack your suitcase. It then animates every product turning and
dropping into place, step by step.

- **89 real-world items** in 7 categories (clothing, shoes, toiletries,
  electronics, accessories, documents, travel gear), each with realistic
  packed dimensions and weight
- **6 trip presets** (weekend, business, beach week, city break, two-week
  holiday, packing cubes) and **4 suitcase sizes**, or type in your own
- **Your own items**: name, size, weight, what it looks like, fragile/upright
- **3D animation with detailed product models**, not boxes: 40 models built
  in Blender (folded T-shirts with ribbed collars, denim jeans with rivets,
  sneakers with laces and mesh uppers, laptops, cameras, toiletry bags…)
  with fabric, leather and metal textures, recoloured to match each item.
  Every item in the trip presets has one; the rest use simpler built-in
  shapes
- **Metrics**: space used, items packed, weight vs. limit, free litres
- **Step list** in plain English ("Place Sneakers lying flat in the
  front-left of the case, on top of Jeans"). Click a step or an item in 3D to
  jump to it
- **Squashable clothes**: when things don't fit, soft items (folded clothes,
  rolls, towels, packing cubes) get pressed thinner, by half their allowance
  first and then fully. The step says how thick to press each one
- **Need it first** (★ next to any item): packed last so it sits on top,
  unless that would leave something out. Passport, documents, wallet,
  earbuds, power bank, medicine and sleep mask are starred by default
- **Weight balance**: heavy things go at the wheel end and against the back
  panel, so the case stands and rolls without tipping (and close to your back
  in a soft bag). Each bag is rated *well balanced*, *OK* or *poorly
  balanced* (top-heavy or lopsided), and an orange dot in the 3D view shows
  its centre of gravity moving as items drop in
- **Several bags** (up to 3, e.g. a checked suitcase plus a backpack): one
  item list is split across them and every bag is packed, side by side in 3D.
  Each bag says where it travels (checked, carry-on or under the seat), and
  the split follows airline sense:
  - **power banks** (spare lithium batteries) only go in bags you take on
    board, since they aren't allowed in the hold. With no such bag you get a
    "carry this on board" warning
  - **valuables** (laptop, tablet, camera, passport, documents, medicine,
    jewellery, wallet...) and ★ items go in the bag under your seat first
  - **everything else** fills the checked bag first, and spills over into the
    others only when it has to
  - **pick a bag** for any item (the menu under it) to override all of this

  The animation follows each bag as it's packed, the steps are grouped by
  bag, and a card per bag shows how full and how heavy it is (click it to
  look at that bag)
- **Saved trips**: name and reuse a selection (e.g. "Tokyo in March"),
  stored in `data/trips.json`
- **Share**: a link (or a trip code in the online version) that loads your
  suitcase and item list for someone else
- **Printable checklist** with a picture of the packed case and tick boxes
- **English and 繁體中文**: switch under Settings (the gear icon, top right). The whole
  app switches, including item names, trip presets and packing steps. To add a
  language, see `web/js/i18n.js`

Everything runs locally with only the Python standard library. No installs,
no internet needed.

## Run the app (Windows)

**Easiest:** double-click **`Start Packing Assistant.bat`**. The app opens in
its own window. A small console window stays open behind it; close that to
stop the app. If Python isn't installed, the launcher opens the download page.

Double-click **`Create Desktop Shortcut.bat`** once to put a *Smart Packing
Assistant* icon on your desktop and in the Start menu.

**Install it as an app:** with the app open in Chrome or Edge, click
**Install app** (top right, or the install icon in the address bar). It then
gets its own Start-menu entry and window, and **it works even when the
Python server isn't running**, because packing switches to the built-in
browser engine.

From a terminal:

```powershell
cd C:\Claude\smart-packing-assistant
python app.py            # opens in your browser
python app.py --window   # opens in its own app window
```

Running it a second time just opens the app again rather than starting a
second copy.

How to use it:

1. Choose a suitcase, or edit the inside dimensions to match yours. To
   bring more than one bag, press **+ Add a bag** and set where each one
   travels (checked, carry-on or under the seat).
2. Pick a trip preset, or add items with **+ / −** (use search and the
   category filters). Star (★) anything you'll need first. Add anything
   missing under **+ Add your own item**.
3. Press **Pack my suitcase**. It takes 1–8 seconds depending on how many
   items you picked.
4. Watch the animation. **Space** plays and pauses, **← / →** step through.
   Drag to rotate, scroll to zoom, right-drag to pan. The buttons on the
   top right switch see-through walls, the centre-of-gravity dot, top view
   and reset view.
5. **Save** the trip, **Share** it, or **Print checklist**.

## Put it online (public web address)

The app also runs as a plain website, with no Python needed. The packing
engine then runs in JavaScript inside each visitor's browser. The site works
offline once opened and can be installed as an app, including on phones.

```powershell
python tools\build_hosted.py      # builds dist\site\ (the whole website)
```

**Option A: GitHub Pages (free, updates automatically).**

1. On github.com, create an **empty** repository, e.g. `packing-assistant`.
   Don't add a README.
2. Double-click **`Publish to GitHub.bat`** and paste the repository URL
   when asked. It adds the deploy workflow (from `tools\github-pages.yml`),
   commits everything and pushes. Sign in to GitHub if a login window
   appears.
3. On GitHub, go to **Settings → Pages → Source** and choose
   **GitHub Actions** (you only do this once).
4. About a minute later the app is live at
   `https://<your-username>.github.io/packing-assistant/`. To publish later
   changes, run `Publish to GitHub.bat` again. Each push runs the tests
   first.

**Option B: Netlify Drop (free, no account setup needed to try).** Run the
build above, then drag the `dist\site` folder onto
<https://app.netlify.com/drop>.

Differences from the version on your computer: saved trips stay in each
visitor's browser, and custom `.glb` models must be committed into
`web\models\`.

## 3D product models

The detailed models in `web\models\types\` (one per model type, e.g.
`sneakers.glb` for every pair of shoes) are made by a Blender script, not
by hand:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python blender\make_models.py
& "...\blender.exe" --background --factory-startup --python blender\make_models.py -- sneakers jeans   # just these
python tools\make_catalog.py   # so the app knows which types have a model
```

Each model is built at the size of a typical item and stretched to the
exact size of whichever item uses it. Materials named `tint...` take the
item's colour, so one model serves every colour. Textures are generated in
the script, so the same script always gives the same files. To add a type,
write a function in `blender/make_models.py` and add it to `MODELS`.

Open `http://127.0.0.1:8765/dev/models.html` to see every model next to the
simple shape it replaces (`?only=sneakers,jeans` for just some of them).

### Use your own 3D models

Any catalog item can use your own 3D model instead of the built-in one:

1. In Blender, select the object, then choose **File → Export → glTF 2.0**.
   Set the format to **glTF Binary (.glb)**, tick **Limit to: Selected
   Objects**, and leave compression off.
2. Name the file after the item's id and put it in `web\models\`, for
   example `web\models\sneakers.glb` or `web\models\laptop_13.glb`. Item ids
   are in `data\catalog.json`.
3. Reload the page. The model is turned Z-up, rotated to match the item's
   footprint and stretched to the item's packed size.

Tip: model items the way they sit when packed. A full-length pair of
trousers squashed into a folded-trousers slot looks wrong, so model them
folded.

Open `http://127.0.0.1:8765/dev/gallery.html` to see every product model at
once (add `?cat=shoes` to filter by category).

## Command line

The packing engine also runs without the UI:

```powershell
python main.py                                   # data\sample_trip.json
python main.py --input data\overpacked_trip.json
python main.py --restarts 1000 --time-limit 30 --min-support 0.6
python main.py --input data\two_bag_trip.json    # split across several bags
python -m unittest discover tests                # 68 tests (JS engine tests need Node.js)
```

It writes `output\layout.json`, `placement_log.txt` and (with matplotlib)
`preview.png`. `blender\animate_packing.py` turns `layout.json` into a
Blender animation (box shapes).

## How the optimiser works

The same algorithm exists twice. `packing_assistant/optimizer.py` is used
by the local app and the command line. `web/js/packer/engine.js` is used by
the online version. `tests/test_js_engine.py` checks the JavaScript engine
against the same rules as the Python one.


`packing_assistant/optimizer.py` works in three stages.

1. **Extreme-point placement.** Items go in one at a time. Each placed box
   creates candidate corners next to, behind and on top of it, each also
   slid back until it meets a wall or another box. Every item is tried at
   every corner in every allowed orientation (up to 6).
2. **Validity checks.** Each candidate must fit inside the case and not
   overlap another item. It must not sit on a fragile item or break the
   weight limit. At least 70% of its base must rest on something, so there
   are no floating layouts. Upright items (bottles) only turn around the
   vertical axis.
3. **Search.** The optimiser tries 5 item orderings with 3 placement rules
   (max-contact, bottom-up, back-to-front). It then runs a local search that
   swaps or moves items in the best order, plus occasional random restarts.
   Layouts are ranked by packed volume (at natural size), then item count,
   then need-it-first items left uncovered, then less squeezing, then a lower
   centre of gravity.
4. **Need it first.** These items go in last, so they end up on top. The
   search also tries layouts without that rule, so a large starred item is
   never left out just to keep it on top.
5. **Squeezing.** If not everything fits at natural size, soft items shrink
   along their thinnest side (each item has its own `squeeze` allowance, for
   example 35% for a folded T-shirt) and the search runs again.
6. **Weight balance.** The open case lies on its back with its wheels at the
   left end, so a good layout has its centre of gravity low along the length
   (near the wheels), low in depth (on the back panel) and centred across the
   width. Among layouts that are otherwise equal, the search keeps the one
   that scores best on that, length counting double. A fourth placement rule,
   "wheels-first", fills from the wheel end, and once everything fits the
   search tries moving each of the 8 heaviest items earlier in the packing
   order. Finally, a layout whose weight ended up at the handle end is
   mirrored end to end, which is just as valid, so the weight is always on
   the wheel half. Soft bags (no wheels) only count depth and sideways
   balance. Bags under 2 kg are always rated well balanced.
7. **Several bags.** The greedy pass puts each item in the first bag on its
   preference list that has room for it (`bag_preferences`: the bag you
   picked; cabin bags only for lithium batteries; under-seat first for
   valuables and ★ items; the hold first for the rest). The same search
   then optimises the whole trip at once, ranking layouts by packed volume,
   item count, need-it-first items on top, and then how many items ended up
   further down their preference list. With one bag it gives exactly the
   same result as the single-suitcase packer.

A trip file for the command line can list `"bags"` instead of
`"suitcase"`; see `data/two_bag_trip.json` and `packing_assistant/data_io.py`.
The web API takes the same: `POST /api/pack` with `{"bags": [...]}` returns
`bags` (with per-bag metrics) and one list of `steps`, each with the index of
its `bag`.

It stops at the time limit, or once everything fits and the layout has
stopped improving.

## Project layout

```
app.py                       web app server (standard library only)
main.py                      command-line packer
packing_assistant/
  models.py                  Suitcase, Item, Placement
  geometry.py                box maths
  optimizer.py               packing engine
  catalog.py                 item library, presets, API request -> items, saved trips
  visualizer.py              metrics, step instructions, layout JSON, PNG preview
  data_io.py                 trip JSON loading
data/
  catalog.json               89 items, 4 suitcases, 6 trip presets (generated)
  sample_trip.json, overpacked_trip.json, two_bag_trip.json
tools/make_catalog.py        edit items here, then run it to regenerate catalog.json
tools/build_hosted.py        builds the website into dist/site/ (--artifact: single-page form)
Start Packing Assistant.bat  double-click launcher (Windows)
Create Desktop Shortcut.bat  adds desktop + Start-menu shortcuts
Publish to GitHub.bat        one-click publish to GitHub Pages
tools/github-pages.yml       deploy workflow (tests, then publishes dist/site)
web/manifest.webmanifest, web/sw.js, web/icons/   installable app + offline support
web/
  index.html, css/app.css
  js/main.js                 UI controller
  js/scene.js                3D scene + step animation
  js/models.js               procedural product models (66 types)
  js/suitcase.js             open hard-shell suitcase
  js/thumbs.js               item thumbnails rendered from the models
  js/engine/                 small WebGL renderer, geometry builder, .glb loader
  js/packer/                 JavaScript packing engine + Web Worker (online version)
  js/api.js                  talks to the Python server, or falls back to the JS engine
  data/catalog.json          copy of the catalog for the online version
  models/types/              detailed product models (made by blender/make_models.py)
  models/                    drop your own .glb files here (named after the item id)
  dev/gallery.html           preview of every simple built-in shape
  dev/models.html            detailed models next to the shapes they replace
blender/make_models.py       builds the detailed product models (web/models/types)
blender/animate_packing.py   Blender animation from layout.json
tests/                       engine, several-bag, balance, catalog and server tests
```

## Adding catalog items

Edit the `ITEMS` list in `tools/make_catalog.py`. Each entry has an id,
name, category, model type, packed length × width × height (cm), weight
(kg), colour and flags. Then run `python tools/make_catalog.py`. Model types
are the keys of `MODEL_BUILDERS` in `web/js/models.js`.

## Roadmap

1. **Accounts and sync.** Saved trips available on every device (needs a
   hosted backend).
2. **Exact solver.** Add an exact solver (for example CP-SAT) for small
   lists, to measure how close the heuristic gets to the best possible.
