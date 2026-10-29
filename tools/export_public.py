#!/usr/bin/env python3
"""Copy the viewer package to a folder ready to publish.

    python tools/export_public.py --out /tmp/site
    python tools/export_public.py --out /tmp/site --collections demo \
        --exclude-input-reference --max-mb 200 --git-init

Never touches the source repo. --git-init makes one local commit inside
the output folder and never adds a remote or pushes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent
IMAGE_EXT = (".png", ".webp", ".jpg", ".jpeg")

LICENSE_PLACEHOLDER = """\
Replace this file with the licence for the code and, separately, the terms
under which the images may be redistributed.

The viewer code in this folder may be used freely. The IMAGES are not
covered by that: they come from whatever dataset you exported, and many
image datasets forbid redistribution. Check the dataset licence before
making this page public.
"""

README_TEMPLATE = """\
# {title}

A static image-comparison viewer. No build step and no server code: it is
plain HTML, CSS and JavaScript plus generated data under `data/`.

## Look at it locally

    python -m http.server 8000
    # then open http://localhost:8000/

Opening `index.html` directly from the file system also works, except that
the browser blocks pixel access on `file://`, so the difference view and
Save PNG need the local server above.

## Publish it with GitHub Pages

1. Create a repository and copy everything in this folder into it.
2. Commit and push to `main`.
3. Settings -> Pages -> Build and deployment -> Source: **Deploy from a
   branch**, branch `main`, folder `/ (root)`. Save.
4. The page appears at `https://<user>.github.io/<repo>/` after a minute.

`.nojekyll` is already present, which Pages needs so that files and folders
beginning with `_` are served.

## Add more images

Drop them into `content/<collection>/<scene>/<method>/<variant>.png`, then
run `python tools/scan.py` and refresh. See the viewer README for the full
convention.

## Licence

See LICENSE. **Check the dataset licence before publishing input or
reference images.**
"""


def directory_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--collections", nargs="*", default=None,
                    help="only these collection folders (default: all)")
    ap.add_argument("--exclude-input-reference", action="store_true",
                    help="omit _input and _reference images, for dataset "
                         "licence reasons")
    ap.add_argument("--max-mb", type=float, default=None)
    ap.add_argument("--git-init", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)

    out: Path = args.out
    if out.exists() and any(out.iterdir()) and not args.force:
        print(f"{out} is not empty; pass --force to write into it anyway",
              file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)

    for name in ("index.html", "app.js", "style.css", ".nojekyll"):
        src = VIEWER / name
        if src.exists():
            shutil.copy2(src, out / name)
    shutil.copytree(VIEWER / "tools", out / "tools", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__"))
    if (VIEWER / "deploy").is_dir():
        shutil.copytree(VIEWER / "deploy", out / "deploy", dirs_exist_ok=True)
    (out / ".nojekyll").touch()

    src_content = VIEWER / "content"
    dst_content = out / "content"
    dst_content.mkdir(exist_ok=True)
    if (src_content / "project.json").exists():
        shutil.copy2(src_content / "project.json", dst_content / "project.json")

    dropped = 0
    wanted = args.collections
    for cdir in sorted(d for d in src_content.iterdir() if d.is_dir()):
        if wanted and cdir.name not in wanted:
            continue
        for f in cdir.rglob("*"):
            if f.is_dir():
                continue
            if (args.exclude_input_reference
                    and f.suffix.lower() in IMAGE_EXT
                    and f.stem in ("_input", "_reference")):
                dropped += 1
                continue
            rel = f.relative_to(src_content)
            target = dst_content / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)

    title = "Image comparison viewer"
    pj = dst_content / "project.json"
    if pj.exists():
        try:
            title = json.loads(pj.read_text()).get("title", title)
        except json.JSONDecodeError:
            pass
    (out / "README.md").write_text(README_TEMPLATE.format(title=title))
    (out / "LICENSE").write_text(LICENSE_PLACEHOLDER)

    # Re-scan inside the copy, so data/ matches what was actually exported.
    rc = subprocess.call([sys.executable, str(out / "tools" / "scan.py"),
                          "--content", str(dst_content),
                          "--data", str(out / "data")])
    if rc != 0:
        print("the exported copy does not validate; see the scan output above",
              file=sys.stderr)
        return rc

    mb = directory_size(out) / 1e6
    print(f"\nexported to {out}  ({mb:.1f} MB)")
    if dropped:
        print(f"  omitted {dropped} _input/_reference image(s); the "
              f"difference view and the input/reference panels will be "
              f"unavailable for those scenes")
    if args.max_mb and mb > args.max_mb:
        print(f"  WARNING: {mb:.1f} MB exceeds --max-mb {args.max_mb}",
              file=sys.stderr)
        return 1

    if args.git_init:
        if (out / ".git").exists():
            print("  .git already exists; left alone")
        else:
            subprocess.call(["git", "init", "-q"], cwd=out)
            subprocess.call(["git", "add", "-A"], cwd=out)
            subprocess.call(["git", "commit", "-q", "-m",
                             "Static image comparison viewer"], cwd=out)
            print("  made one local commit inside the export; nothing pushed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
