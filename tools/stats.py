#!/usr/bin/env python3
"""Report the size of each collection in viewer/content/.

    python tools/stats.py [--content DIR]
"""

from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent
IMAGE_EXT = (".png", ".webp", ".jpg", ".jpeg")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--content", type=Path, default=VIEWER / "content")
    args = ap.parse_args(argv)
    if not args.content.is_dir():
        print(f"no content at {args.content}")
        return 1

    grand = grand_n = 0
    print(f"{'collection':28} {'scenes':>7} {'images':>7} {'MB':>9}  biggest file")
    for cdir in sorted(d for d in args.content.iterdir() if d.is_dir()):
        total = n = 0
        biggest = (0, "")
        scenes = [d for d in cdir.iterdir() if d.is_dir()]
        for f in cdir.rglob("*"):
            if f.is_file() and f.suffix.lower() in IMAGE_EXT:
                sz = f.stat().st_size
                total += sz; n += 1
                if sz > biggest[0]:
                    biggest = (sz, f.relative_to(cdir).as_posix())
        grand += total; grand_n += n
        print(f"{cdir.name:28} {len(scenes):7} {n:7} {total/1e6:9.2f}  "
              f"{biggest[1]} ({biggest[0]/1e6:.2f} MB)")
    print(f"{'TOTAL':28} {'':7} {grand_n:7} {grand/1e6:9.2f}")
    if grand / 1e6 > 50:
        print("note: over 50 MB; consider tools/export_public.py --max-mb "
              "or fewer collections for a web page")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
