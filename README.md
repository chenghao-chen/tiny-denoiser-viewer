# tiny-denoiser viewer

A static web page for comparing image-denoising results side by side.
Pick a scene, then either compare every architecture at one parameter
budget, or follow one architecture across budgets with a chart of the
metric.

Plain HTML, CSS and vanilla JavaScript. No framework, no npm, no CDN, no
network requests, no build step beyond one Python script.

**These are work-in-progress numbers from short training runs, not final
results.** The schedules are far shorter than the original papers', each
model's layout changes with its parameter budget, and RAW and sRGB PSNR
values are not comparable with one another. Read the panels as a
qualitative comparison, not as a benchmark.

## Run it locally

```sh
python -m http.server 8000
# then open http://localhost:8000/
```

Opening `index.html` straight from the file system mostly works — you can
browse scenes, use the linked zoom and read the chart. Two things do not:

* **Save PNG**
* **Difference from reference**

Both need JavaScript to read image pixels from a `<canvas>`, and browsers
block that for `file://` URLs, where every local file counts as a foreign
origin. Serve the folder over HTTP with the command above and both work.
The page says so if you try them from `file://`.

## What is in it

| collection | group | scenes | contents |
|---|---|---|---|
| `raw_green_lr1e-3` | RAW green plane | 4 | 10 architectures × 6 parameter budgets |
| `srgb_best_lr` | sRGB | 2 | 10 architectures × 2 parameter budgets |

## Dataset images

The noisy inputs (`_input.png`) and ground-truth references
(`_reference.png`) are crops from
[SIDD](https://abdokamel.github.io/sidd/) (Abdelhamed, Lin and Brown,
CVPR 2018). They are included here so the comparison is complete and the
difference-from-reference view works.

**If you fork or reuse this repository, check the SIDD terms yourself.**
The dataset is distributed for research use and its terms govern
redistribution of the images; they are not covered by the licence on the
viewer code. Everything under a `<method>/` folder is model output from
this project and carries no such restriction.

To build a copy with the dataset images left out:

```sh
python tools/export_public.py --out ../viewer-public --exclude-input-reference
```

The viewer handles their absence gracefully — the input and reference
panels show *not available* with an explanation, the metrics are still
shown because they were computed before the export, and the
difference view disables itself.

## The folder convention

Everything the page shows comes from the folder layout. There is no
configuration beyond optional small sidecar files.

```
content/
  project.json                       site title, axis names, metric
  <collection>/                      one comparable set
    collection.json                  group, label, caption
    curves.csv                       method,variant,value  (all scenes)
    variants.json                    labels, order, badges
    <scene>/                         one image
      scene.json                     tags, caption, display gain
      metrics.csv                    method,variant,psnr
      <method>/<variant>.png         e.g. nafnet/50k.png
```

Names use lowercase letters, digits, `_`, `-` and `.` only: GitHub Pages
serves from a case-sensitive filesystem, so `NAFNet/50K.PNG` and
`nafnet/50k.png` are different files there and the same file on macOS.

## Add new results

1. Drop images in at `content/<collection>/<scene>/<method>/<variant>.png`
2. `python tools/scan.py`
3. Commit and push

`scan.py` regenerates `data/index.js` and `data/scenes/*.js` from whatever
is on disk, and warns about mismatched image sizes, bad file names and
oversized files. It is the only build step, and the generated files under
`data/` should never be hand-edited.

Other tools: `tools/stats.py` (size per collection), `tools/prune.py`
(find unreferenced images), `tools/export_public.py` (make another
publishable copy), `tools/make_demo.py` (synthetic content for testing).
They need only the standard library and Pillow.

## Publish on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**,
branch `main`, folder `/ (root)`.

`.nojekyll` is already present; Pages needs it, or it hides paths that
begin with an underscore.

## Keyboard

| key | action |
|---|---|
| ← → | previous / next scene |
| ↑ ↓ | tab 1: parameter budget · tab 2: architecture |
| 1 2 | switch tab |
| g / c | next group / next config |
| z | cycle zoom (off → 2× → 4× → 8×) |
| s | save PNG (shift+s: zoom crops) |
| Esc | unpin the zoom region |

The URL hash holds the full view state, so any view can be bookmarked or
shared.
