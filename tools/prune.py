#!/usr/bin/env python3
"""List image files that no generated scene file references.

Run tools/scan.py first: this compares the files on disk with the paths
in viewer/data/. Nothing is deleted unless --delete is given.

    python tools/prune.py            # list only
    python tools/prune.py --delete   # actually remove them
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent
IMAGE_EXT = (".png", ".webp", ".jpg", ".jpeg")


def referenced(data: Path) -> set:
    """Every content/... path mentioned in the generated scene files."""
    out = set()
    scenes = data / "scenes"
    if not scenes.is_dir():
        return out
    for js in scenes.glob("*.js"):
        text = js.read_text()
        m = re.search(r"=\s*(\{.*\});\s*$", text, re.S)
        if not m:
            continue
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        for key in ("input", "reference", "thumb"):
            if payload.get(key):
                out.add(payload[key])
        for method, variants in (payload.get("images") or {}).items():
            out.update(variants.values())
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--content", type=Path, default=VIEWER / "content")
    ap.add_argument("--data", type=Path, default=VIEWER / "data")
    ap.add_argument("--delete", action="store_true")
    args = ap.parse_args(argv)

    keep = referenced(args.data)
    if not keep:
        print("no generated scene data found; run tools/scan.py first")
        return 1

    orphans, total = [], 0
    for f in sorted(args.content.rglob("*")):
        if not (f.is_file() and f.suffix.lower() in IMAGE_EXT):
            continue
        rel = "content/" + f.relative_to(args.content).as_posix()
        if rel not in keep:
            orphans.append(f)
            total += f.stat().st_size

    if not orphans:
        print("nothing unreferenced; every image is used by a scene")
        return 0
    print(f"{len(orphans)} unreferenced image(s), {total/1e6:.2f} MB:")
    for f in orphans:
        print("  " + f.relative_to(args.content).as_posix())
    if args.delete:
        for f in orphans:
            f.unlink()
        print(f"deleted {len(orphans)} file(s); re-run tools/scan.py")
    else:
        print("re-run with --delete to remove them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
