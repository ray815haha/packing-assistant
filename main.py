"""Smart Packing Assistant: command-line entry point.

Examples
--------
    python main.py                                  # pack data/sample_trip.json
    python main.py --input data/my_trip.json
    python main.py --restarts 200 --seed 7          # search harder / differently
    python main.py --min-support 0.6 --no-preview

Outputs go to ./output/: layout.json (for Blender), placement_log.txt and,
if matplotlib is installed, preview.png.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from packing_assistant import PackerConfig, load_trip, pack
from packing_assistant.visualizer import (
    export_layout_json,
    format_metrics,
    format_text_log,
    render_preview_png,
)

ROOT = Path(__file__).resolve().parent


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Find a compact, stable way to pack a suitcase.")
    p.add_argument("--input", "-i", type=Path, default=ROOT / "data" / "sample_trip.json",
                   help="trip JSON file (suitcase + items)")
    p.add_argument("--output", "-o", type=Path, default=ROOT / "output",
                   help="folder for layout.json, placement_log.txt and preview.png")
    p.add_argument("--restarts", type=int, default=300, help="local-search iterations after the fixed strategies")
    p.add_argument("--seed", type=int, default=42, help="random seed (use -1 for a random one)")
    p.add_argument("--time-limit", type=float, default=10.0, help="search time limit in seconds")
    p.add_argument("--min-support", type=float, default=0.7,
                   help="share of an item's base that must rest on something (0-1)")
    p.add_argument("--no-preview", action="store_true", help="skip the matplotlib PNG preview")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        suitcase, items = load_trip(args.input)
    except (OSError, KeyError, ValueError) as e:
        print(f"Could not read trip file {args.input}: {e}", file=sys.stderr)
        return 2

    config = PackerConfig(
        min_support=args.min_support,
        restarts=args.restarts,
        seed=None if args.seed == -1 else args.seed,
        time_limit_s=args.time_limit,
    )
    result = pack(suitcase, items, config)

    print(format_metrics(result))
    print()
    log = format_text_log(result)
    print(log)

    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    layout_path = export_layout_json(result, out / "layout.json")
    (out / "placement_log.txt").write_text(format_metrics(result) + "\n\n" + log + "\n", encoding="utf-8")
    print()
    print(f"Saved {layout_path}")
    print(f"Saved {out / 'placement_log.txt'}")
    if not args.no_preview:
        png = render_preview_png(result, out / "preview.png")
        print(f"Saved {png}" if png else "Preview skipped (pip install matplotlib to enable it)")
    return 0 if not result.unpacked else 1


if __name__ == "__main__":
    sys.exit(main())
