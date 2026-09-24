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
- **3D animation with modelled products**, not boxes: folded T-shirts with
  collars, jeans with pockets, sneakers with laces, laptops, bottles, cameras…
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
- **Saved trips**: name and reuse a selection (e.g. "Tokyo in March"),
  stored in `data/trips.json`
- **Share**: a link (or a trip code in the online version) that loads your
  suitcase and item list for someone else
- **Printable checklist** with a picture of the packed case and tick boxes

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

1. Choose a suitcase, or edit the inside dimensions to match yours.
2. Pick a trip preset, or add items with **+ / −** (use search and the
   category filters). Star (★) anything you'll need first. Add anything
   missing under **+ Add your own item**.
3. Press **Pack my suitcase**. It takes 1–8 seconds depending on how many
   items you picked.
4. Watch the animation. **Space** plays and pauses, **← / →** step through.
   Drag to rotate, scroll to zoom, right-drag to pan. The buttons on the
   top right switch see-through walls, top view and reset view.
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

## Use your own 3D models

Any catalog item can use a real 3D model instead of the built-in one:

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
python -m unittest discover tests                # 36 tests (JS engine tests need Node.js)
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
  sample_trip.json, overpacked_trip.json
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
  models/                    drop custom .glb files here
  dev/gallery.html           preview of every model
blender/animate_packing.py   Blender animation from layout.json
tests/                       engine, catalog and server tests
```

## Adding catalog items

Edit the `ITEMS` list in `tools/make_catalog.py`. Each entry has an id,
name, category, model type, packed length × width × height (cm), weight
(kg), colour and flags. Then run `python tools/make_catalog.py`. Model types
are the keys of `MODEL_BUILDERS` in `web/js/models.js`.

## Roadmap

1. **Real product models.** Export your own shoes, shirt and so on from
   Blender as .glb files into `web/models/`.
2. **Weight balance.** Keep heavy items near the wheels and the hinge side.
3. **Multiple bags.** Split one list across a suitcase and a backpack.
4. **Accounts and sync.** Saved trips available on every device (needs a
   hosted backend).
5. **Exact solver.** Add an exact solver (for example CP-SAT) for small
   lists, to measure how close the heuristic gets to the best possible.
