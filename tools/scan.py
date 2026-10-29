#!/usr/bin/env python3
"""Scan viewer/content/ and generate viewer/data/*.js.

The only build step. Reads nothing but the folder convention described in
../README.md, writes nothing but viewer/data/. No project, model, dataset
or metric knowledge lives here.

    python tools/scan.py [--content DIR] [--data DIR] [--quiet]

Exit code 0 when the content validates, 1 when it does not.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image
except ImportError:                                     # pragma: no cover
    Image = None

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent

IMAGE_EXT = (".png", ".webp", ".jpg", ".jpeg")
SPECIAL = ("_input", "_reference", "_thumb")
NAME_RE = re.compile(r"^[a-z0-9._-]+$")
MAX_FILE_MB = 25
WARN_TOTAL_MB = 50

#: "p50000" / "50k" / "1M" / "20m" / "1.5k" -> a number for ordering and the
#: chart's x axis. Anything else sorts naturally by its digits and text.
NUM_RE = re.compile(r"^[a-z_-]*?(\d+(?:\.\d+)?)\s*([km])?$", re.IGNORECASE)


def variant_value(name: str) -> Optional[float]:
    m = NUM_RE.match(name)
    if not m:
        return None
    v = float(m.group(1))
    suffix = (m.group(2) or "").lower()
    return v * {"k": 1e3, "m": 1e6}.get(suffix, 1.0)


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r"(\d+)", s)]


def human_variant(name: str) -> str:
    """A short label when the name is numeric: 50000 -> 50K, 1000000 -> 1M."""
    v = variant_value(name)
    if v is None:
        return name
    if v >= 1e6 and v % 1e6 == 0:
        return f"{int(v // 1e6)}M"
    if v >= 1e3 and v % 1e3 == 0:
        return f"{int(v // 1e3)}K"
    return name


class Report:
    def __init__(self) -> None:
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def load_json(path: Path, rep: Report) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        rep.error(f"{path}: invalid JSON ({exc})")
        return {}


def check_name(path: Path, rep: Report) -> None:
    name = path.name
    if not NAME_RE.match(name):
        rep.warn(f"{path}: name has characters that break on case-sensitive "
                 f"hosting; use lowercase letters, digits, '_', '-', '.'")


def read_csv_rows(path: Path, rep: Report) -> List[dict]:
    if not path.exists():
        return []
    try:
        with path.open(newline="") as fh:
            return [r for r in csv.DictReader(fh) if any(v for v in r.values())]
    except OSError as exc:
        rep.error(f"{path}: {exc}")
        return []


def image_size(path: Path, rep: Report) -> Optional[Tuple[int, int]]:
    if Image is None:
        return None
    try:
        with Image.open(path) as im:
            return im.size
    except Exception as exc:                            # pragma: no cover
        rep.error(f"{path}: cannot read image ({exc})")
        return None


# --------------------------------------------------------------------------

def scan_scene(scene_dir: Path, content: Path, rep: Report,
               metric_name: str) -> dict:
    rel = lambda p: "content/" + p.relative_to(content).as_posix()  # noqa: E731
    cfg = load_json(scene_dir / "scene.json", rep)

    specials: Dict[str, Optional[str]] = {k: None for k in SPECIAL}
    images: Dict[str, Dict[str, str]] = {}
    sizes: Dict[str, Tuple[int, int]] = {}
    total_bytes = 0

    for item in sorted(scene_dir.iterdir()):
        if item.is_file() and item.suffix.lower() in IMAGE_EXT:
            check_name(item, rep)
            if item.stem in SPECIAL:
                specials[item.stem] = rel(item)
                # _thumb is deliberately a different size, so it is not part
                # of the "all panels must match" check.
                if item.stem != "_thumb":
                    sizes[item.stem] = image_size(item, rep) or (0, 0)
                total_bytes += item.stat().st_size
        elif item.is_dir():
            check_name(item, rep)
            method = item.name
            for img in sorted(item.iterdir()):
                if not (img.is_file() and img.suffix.lower() in IMAGE_EXT):
                    continue
                check_name(img, rep)
                images.setdefault(method, {})[img.stem] = rel(img)
                sizes[f"{method}/{img.stem}"] = image_size(img, rep) or (0, 0)
                total_bytes += img.stat().st_size
                mb = img.stat().st_size / 1e6
                if mb > MAX_FILE_MB:
                    rep.error(f"{img}: {mb:.1f} MB exceeds the {MAX_FILE_MB} MB limit")

    real = [s for s in sizes.values() if s != (0, 0)]
    if real and len({s for s in real}) > 1:
        rep.warn(f"{scene_dir}: images are not all the same size "
                 f"({sorted({f'{w}x{h}' for w, h in real})})")

    metrics: Dict[str, Dict[str, float]] = {}
    for row in read_csv_rows(scene_dir / "metrics.csv", rep):
        method = (row.get("method") or "").strip()
        variant = (row.get("variant") or "").strip()
        if not method:
            continue
        value = row.get(metric_name)
        if value is None:
            # Fall back to the first numeric column that is not method/variant.
            for k, v in row.items():
                if k not in ("method", "variant") and v not in (None, ""):
                    value = v
                    break
        try:
            val = float(value)
        except (TypeError, ValueError):
            continue
        metrics.setdefault(method, {})[variant] = val
        if method not in ("_input", "_reference") and variant:
            if variant not in images.get(method, {}):
                rep.warn(f"{scene_dir}/metrics.csv: {method}/{variant} has a "
                         f"metric but no image")

    thumb = specials["_thumb"] or specials["_input"]
    if thumb is None:
        for method in sorted(images):
            for variant in sorted(images[method]):
                thumb = images[method][variant]
                break
            if thumb:
                break

    return {
        "id": scene_dir.name,
        "input": specials["_input"],
        "reference": specials["_reference"],
        "thumb": thumb,
        "images": images,
        "metrics": metrics,
        "caption": cfg.get("caption", ""),
        "gain": cfg.get("gain"),
        "meta": cfg.get("meta", {}),
        "tags": cfg.get("tags", []),
        "size": list(real[0]) if real else None,
        "bytes": total_bytes,
    }


def scan_collection(cdir: Path, content: Path, rep: Report,
                    metric_name: str) -> Optional[dict]:
    check_name(cdir, rep)
    cfg = load_json(cdir / "collection.json", rep)
    if cfg.get("enabled") is False:
        return None

    scene_dirs = sorted((d for d in cdir.iterdir() if d.is_dir()),
                        key=lambda d: natural_key(d.name))
    scenes, methods, variants = [], set(), set()
    total_bytes = 0
    for sdir in scene_dirs:
        check_name(sdir, rep)
        scene = scan_scene(sdir, content, rep, metric_name)
        if not scene["images"] and not scene["input"]:
            rep.warn(f"{sdir}: no images, skipped")
            continue
        if scene["input"] is None:
            rep.warn(f"{sdir}: no _input image")
        if scene["reference"] is None:
            rep.warn(f"{sdir}: no _reference image "
                     f"(the difference view will be unavailable)")
        methods.update(scene["images"])
        for m in scene["images"]:
            variants.update(scene["images"][m])
        total_bytes += scene.pop("bytes")
        scenes.append(scene)

    if not scenes:
        return None

    overrides = load_json(cdir / "variants.json", rep)
    vlist = []
    for name in variants:
        o = overrides.get(name, {}) if isinstance(overrides, dict) else {}
        vlist.append({
            "id": name,
            "label": o.get("label", human_variant(name)),
            "value": o.get("value", variant_value(name)),
            "badge": o.get("badge"),
            "order": o.get("order"),
        })
    vlist.sort(key=lambda v: (
        v["order"] if v["order"] is not None else 0,
        v["value"] if v["value"] is not None else float("inf"),
        natural_key(v["id"])))

    curves = []
    for row in read_csv_rows(cdir / "curves.csv", rep):
        try:
            curves.append({"method": row["method"].strip(),
                           "variant": row["variant"].strip(),
                           "value": float(row["value"])})
        except (KeyError, TypeError, ValueError):
            rep.warn(f"{cdir}/curves.csv: skipped a row that is not "
                     f"method,variant,value")

    tags = sorted({t for s in scenes for t in s["tags"]})
    return {
        "id": cdir.name,
        "group": cfg.get("group", "Content"),
        "label": cfg.get("label", cdir.name),
        "caption": cfg.get("caption", ""),
        "order": cfg.get("order", 0),
        "methods": sorted(methods, key=natural_key),
        "variants": vlist,
        "curves": curves,
        "tags": tags,
        "scenes": scenes,
        "bytes": total_bytes,
    }


def write_js(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--content", type=Path, default=VIEWER / "content")
    ap.add_argument("--data", type=Path, default=VIEWER / "data")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    rep = Report()
    content: Path = args.content
    if not content.is_dir():
        print(f"no content directory at {content}; create it and add a "
              f"collection, or run tools/make_demo.py", file=sys.stderr)
        return 1
    if Image is None:
        rep.warn("Pillow is not installed: image sizes are not validated")

    project = load_json(content / "project.json", rep)
    metric = project.get("metric", {})
    metric_name = str(metric.get("name", "value")).lower()

    collections = []
    for cdir in sorted((d for d in content.iterdir() if d.is_dir()),
                       key=lambda d: natural_key(d.name)):
        c = scan_collection(cdir, content, rep, metric_name)
        if c:
            collections.append(c)
    collections.sort(key=lambda c: (c["order"], natural_key(c["label"])))

    # ---- write the small index, then one file per scene -------------------
    scene_files = 0
    for c in collections:
        for s in c["scenes"]:
            key = f"{c['id']}__{s['id']}"
            payload = dict(s, collection=c["id"], metricName=metric_name)
            write_js(args.data / "scenes" / f"{key}.js",
                     "window.VIEWER_SCENES=window.VIEWER_SCENES||{};\n"
                     f"window.VIEWER_SCENES[{json.dumps(key)}]="
                     f"{json.dumps(payload, separators=(',', ':'))};\n")
            scene_files += 1

    index = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "project": project,
        "collections": [{
            "id": c["id"], "group": c["group"], "label": c["label"],
            "caption": c["caption"], "methods": c["methods"],
            "variants": c["variants"], "curves": c["curves"],
            "tags": c["tags"],
            "scenes": [{"id": s["id"], "thumb": s["thumb"],
                        "tags": s["tags"]} for s in c["scenes"]],
        } for c in collections],
        "groups": sorted({c["group"] for c in collections}),
    }
    write_js(args.data / "index.js",
             "window.VIEWER_INDEX="
             + json.dumps(index, separators=(",", ":")) + ";\n")

    total_mb = sum(c["bytes"] for c in collections) / 1e6
    if total_mb > WARN_TOTAL_MB:
        rep.warn(f"content is {total_mb:.0f} MB, above the {WARN_TOTAL_MB} MB "
                 f"soft limit for a comfortable web page")

    if not args.quiet:
        n_scene = sum(len(c["scenes"]) for c in collections)
        n_img = sum(len(s["images"][m]) for c in collections
                    for s in c["scenes"] for m in s["images"])
        n_img += sum(bool(s["input"]) + bool(s["reference"])
                     for c in collections for s in c["scenes"])
        print(f"collections {len(collections)}   scenes {n_scene}   "
              f"methods {len({m for c in collections for m in c['methods']})}   "
              f"variants {len({v['id'] for c in collections for v in c['variants']})}   "
              f"images {n_img}   {total_mb:.1f} MB")
        for c in collections:
            print(f"  [{c['group']}] {c['id']}: {len(c['scenes'])} scenes, "
                  f"{len(c['methods'])} methods, {len(c['variants'])} variants")
        print(f"wrote {args.data / 'index.js'} and {scene_files} scene file(s)")
        for w in rep.warnings:
            print(f"  warning: {w}")
    for e in rep.errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    return 1 if rep.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
