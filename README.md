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

## Dataset images are excluded

The noisy inputs and the ground-truth references come from
[SIDD](https://abdokamel.github.io/sidd/), which permits research use but
restricts redistribution. **They are not in this repository.** Only model
outputs are published here.

Two consequences: the "input" and "reference" panels show *not available*,
and the difference-from-reference view cannot be used. The PSNR values are
still shown, because they were computed against the real references before
the export.

With your own copy of SIDD you can regenerate the missing images locally
and they will appear with no code change.

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
