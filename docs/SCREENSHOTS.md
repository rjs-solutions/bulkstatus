# Screenshot Capture Playbook

A repeatable process so every capture pass looks consistent — for the Chrome Web Store
listing and for the GitHub usage guide. Capture **raw** screenshots, then let the framing
script add branding and copy.

## Principles

- **Same inputs every time.** Always crawl the canonical URL set in `scripts/sample-urls.txt`
  (cross-industry public organizations, deep pages — not homepages). Don't improvise the
  list; edit that file if the set needs to change, so history is tracked.
- **Same window every time.** Capture at a fixed size so framing lines up.
- **Capture raw, frame later.** Raw screenshots go in `dist/store-listing/raw-captures-<version>/`;
  `scripts/create-store-marketing-assets.ps1` produces the framed store assets from them.
- **Re-shoot per release** when the UI changes (e.g., the 0.1.35 Summary label changes).

## Capture environment

- Chrome with the unpacked extension loaded (`chrome://extensions` → Load unpacked → `extension/`).
- Open BulkStatus (toolbar icon or `Alt+B`).
- Window/content size: **1280×800** at 100% zoom, or **2560×1600** on a 2× display and
  downscale to 1280×800 (sharper text). Keep it consistent across all shots in a pass.
- Theme: capture shots 01–04 in light mode and shot 05 in dark mode (Settings → Theme).
- Settings for the demo crawl: extraction mode **HTML fetch** (fast, no tab pop-ups, gives
  clean tables), links + images on, defaults otherwise. Use HTML fetch even though rendered
  mode is the differentiator — it produces the same table view without opening tabs.

## Store capture set (5 raw shots)

Crawl `scripts/sample-urls.txt`, then capture these views and save with these exact names
into `dist/store-listing/raw-captures-<version>/` (e.g. `raw-captures-0.1.36/`):

| File                 | View to capture                                                        |
|----------------------|------------------------------------------------------------------------|
| `01-inputs-raw.png`  | Inputs panel with the URL list pasted and quick-config chips visible   |
| `02-summary-raw.png` | Summary panel after the crawl (metrics + status breakdown)             |
| `03-results-raw.png` | Results table with a few rows, filters/pagination/export buttons shown |
| `04-settings-raw.png`| Settings panel (checks, speed, extraction mode, columns)               |
| `05-dark-mode-raw.png`| Results (or Summary) view in dark mode                                |

> The framing script crops the Results raw (`CropY`) to focus on the table; keep the table
> near the top of that capture.

## Frame the store assets (Windows)

```powershell
# Reads raw-captures-<manifest version> and writes framed assets + promo tiles.
.\scripts\create-store-marketing-assets.ps1            # auto-detects version from manifest
# or pin a version / custom raw folder:
.\scripts\create-store-marketing-assets.ps1 -Version 0.1.36
```

This regenerates, using the current `extension\assets\icons\icon-128.png`:

- `dist\store-listing\screenshots-marketing\*-1280x800.png` (branded, with headline + chips)
- `dist\store-listing\screenshots\*-1280x800.png` (plain 1280×800)
- `dist\store-listing\promo-tiles\marquee-promo-tile-1400x560.png` and `small-promo-tile-440x280.png`

Caption/headline copy lives in the script's `$screenshots` array and mirrors
`docs/MARKETING.md`. Update copy in one place, then re-run.

## Manual capture, step by step (no extra tools needed)

This uses Chrome's built-in DevTools device mode to capture exact, pixel-perfect sizes.

1. **Load + prepare:** at `chrome://extensions`, Load unpacked → `extension/`. Open
   BulkStatus. In Settings, set extraction mode to **HTML fetch**; keep links + images on.
2. **Seed data:** paste the contents of `scripts/sample-urls.txt` into the URL list and
   click **Run check**. Wait for the crawl to finish so the tables are populated.
3. **Lock the viewport to a standard size:** open DevTools (`F12`) → toggle the device
   toolbar (`Ctrl+Shift+M` / `Cmd+Shift+M`) → set **Responsive** to **1280 × 800**. Set the
   device pixel ratio to **2** (the "DPR" box; add it via the device-toolbar ⋮ menu →
   "Add device pixel ratio" if hidden) for crisp 2× output (2560 × 1600).
4. **Capture each view:** scroll so the relevant panel fills the viewport, then open the
   command menu (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **"Capture screenshot"** (captures
   exactly the 1280 × 800 viewport — at DPR 2 it saves a 2560 × 1600 PNG). Repeat for the
   five views, switching the app to each panel (and toggling dark mode for shot 05).
5. **Name + save** into `dist/store-listing/raw-captures-<version>/` using the file names in
   the table above (`01-inputs-raw.png` … `05-dark-mode-raw.png`).

The framing script accepts either 1280 × 800 or 2560 × 1600 raws and scales them, so no
manual resize is needed. If you ever want to downscale a 2× capture to exactly 1280 × 800:

```bash
# macOS:  sips -z 800 1280 in.png --out out.png
# ImageMagick (any OS):  magick in.png -resize 1280x800 out.png
```

> Want full automation instead? A Playwright script can load the unpacked extension, paste
> the URL set, run the crawl, and screenshot each panel on a schedule. It needs setup and
> testing on your machine (Chrome extension loading + runtime host-permission grant), so the
> manual method above is the reliable default. Ask if you want the Playwright script drafted.

## GitHub guide screenshots (more instructive)

The GitHub guide can be more verbose than the store. Capture these (light mode, 1280×800)
into `docs/guide-images/` and annotate with callouts/arrows where noted:

1. `guide-01-input-modes.png` — the three input tabs (URL list / XML Sitemap / llms.txt); annotate each tab.
2. `guide-02-paste-and-config.png` — URLs pasted with quick-config chips; callout the chips.
3. `guide-03-running.png` — a crawl in progress: progress bar, ETA, pause/stop controls.
4. `guide-04-summary.png` — Summary metrics; annotate status groups, redirects, issues, skipped.
5. `guide-05-results-filters.png` — Results with the filter panel open; callout filters + search.
6. `guide-06-results-row-detail.png` — an expanded page row showing discovered links/images.
7. `guide-07-settings-rendering.png` — Settings with JavaScript rendering mode highlighted.
8. `guide-08-export.png` — the Copy/Export buttons; callout CSV export.
9. `guide-09-diagnostics.png` — Diagnostics panel (enable it in Settings first).
10. `guide-10-dark-mode.png` — dark mode results view.

Annotation style for the guide: 2–3px accent-blue (`#2563eb`) arrows/rounded-rect callouts
with short labels. Keep originals un-annotated too, so they can be re-annotated later.

## Naming + storage summary

- Canonical inputs: `scripts/sample-urls.txt`
- Store raws: `dist/store-listing/raw-captures-<version>/01..05-*-raw.png`
- Framed store assets: produced by the script into `dist/store-listing/...`
- Guide images: `docs/guide-images/guide-NN-*.png`
