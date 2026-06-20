# BulkStatus — Bulk URL Checker & Crawler

Crawl and bulk-check URLs for status codes, broken links, redirects, images, and SEO metadata — built for web teams, without leaving Chrome.

BulkStatus turns a list of URLs into an audit. Paste them, upload a TXT/CSV, or point it at
an XML sitemap or `llms.txt` file, then run a check to see HTTP status, final redirected
URL, response time, and on-page metadata for every page — plus optional checks on the links
and images each page contains. Sort and filter the results, then export to CSV. Everything
runs in your browser; nothing is sent to a server.

- **Chrome Web Store:** https://chromewebstore.google.com/detail/bulkstatus-bulk-url-check/ngoefpeflkbebdpemiiebbjlkhmmkmeh
- **Privacy policy:** [PRIVACY.md](PRIVACY.md)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Why BulkStatus

- **Bulk by default** — hundreds of URLs in one pass, from a list, sitemap, or `llms.txt`.
- **Find what's broken** — non-200s, 404s, 403s, redirects, and missing image alt text.
- **See the redirect truth** — final URL after redirects, with best-effort hop counts.
- **Audit on-page SEO** — title, meta description, H1, canonical, meta robots, word count.
- **AI & search ready** — validate the pages in your sitemap and `llms.txt` so search and AI crawlers can reach them; the groundwork behind SEO, AEO, and GEO.
- **Render when needed** — JavaScript mode reads client-rendered links and images.
- **Stay in control** — pause/resume/stop long crawls; tune concurrency, timeouts, limits.
- **Export the proof** — CSV export plus copy for summary and results.
- **Private by design** — no backend, no analytics, no account, no data leaves the browser.

## Install

**From the Chrome Web Store (recommended):** install from the listing linked above.

**From source (developer mode):**

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder (the one containing `manifest.json`).
4. Open BulkStatus from the toolbar (or press `Alt+B`).

## Usage

1. Choose an input source: **URL list**, **XML Sitemap**, or **llms.txt**.
2. Paste/upload URLs, or enter a sitemap/llms.txt URL and click **Fetch URLs**.
3. Adjust settings if needed (extraction mode, links/images, speed, limits, columns).
4. Click **Run check**.
5. Review the Summary metrics and the Results table.
6. Use **Copy**/**Export CSV** to take results with you.

**HTML fetch vs JavaScript rendering:** HTML fetch is fast and quiet. Rendered mode opens
pages in Chrome to inspect links/images created by JavaScript — use it only on pages you
are authorized to test.

## What it checks

Input URL, final URL after redirects, HTTP status, redirect count (best effort), response
time, page title, meta description, H1, meta robots, canonical, word count, and per-page
discovered links/images with nav/footer/page-area classification and missing-alt detection.

## Privacy & permissions

BulkStatus runs only when you intentionally provide or fetch URLs and click **Run check**.
It requests **no permissions at install** — host access and the optional `scripting`
permission are requested at runtime only when you act. See [PRIVACY.md](PRIVACY.md).

## Project layout

```
extension/            # the Manifest V3 extension (this folder is what ships)
  manifest.json
  src/app/            # app page: index.html, app.js, styles.css
  src/app/lib/        # pure, unit-tested modules (url, text, sitemap, status, duration, network)
docs/                 # store listing copy, marketing, screenshot playbook, publishing guide
scripts/              # icon generation, packaging, marketing-asset framing, sample URLs
tests/                # node:test unit tests for the lib/ modules
```

## Development

```bash
npm test     # run unit tests (Node's built-in runner; no install required)
npm run lint # ESLint (requires dev dependencies)
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the module layout and refactor roadmap,
and [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) for the screenshot capture process.

## License

Source-available under the **PolyForm Noncommercial License 1.0.0** — see [LICENSE.md](LICENSE.md).
You're welcome to read, learn from, and use BulkStatus for noncommercial purposes; commercial
use and redistribution of competing products are not permitted.

## Disclaimer

Use BulkStatus only on URLs and websites you are authorized to test.
