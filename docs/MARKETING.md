# BulkStatus — Marketing Copy & Asset Guide

Copy bank for the Chrome Web Store listing, promo tiles, and the planned GitHub repo.
Pair this with `STORE_LISTING_v2_proposed.md` (the formal listing fields).

## Positioning

**One line:** Bulk URL health checks, built for web teams — without leaving Chrome.

**Who it's for:** web, SEO, content, and digital-marketing teams who manage lots of pages
and need to verify status codes, catch broken links and images, confirm redirects, and
audit on-page metadata across many URLs at once.

**Why it's different:** runs entirely in the browser (no backend, no account, no data
leaves your machine), reads JavaScript-rendered pages when needed, and works from the
sources teams actually have — pasted lists, XML sitemaps, and llms.txt.

## Taglines (pick per placement)

- Bulk URL health checks, built for web teams
- Check links, redirects, status, and SEO metadata — in bulk
- Audit hundreds of URLs from Chrome, then export the proof
- Broken links and bad redirects, found before your users find them
- From sitemap to CSV in one pass

## Promo tile copy (already applied to the regenerated tiles)

**Marquee (1400×560)**
- Wordmark: BulkStatus
- Headline: Bulk URL health checks, built for web teams
- Subhead: Run focused crawls, review summary metrics, sort/filter results, and export CSV findings directly from Chrome.

**Small (440×280)**
- BulkStatus — Bulk URL Checker
- Check links, redirects, status & SEO metadata in bulk — export to CSV.

## Short blurbs (for outreach, posts, README intro)

**Tweet/short (≤200 chars):**
BulkStatus is a Chrome extension for bulk URL checks — status codes, redirects, broken
links/images, and SEO metadata across hundreds of pages. Runs locally, exports to CSV. From
a pasted list, sitemap, or llms.txt.

**One paragraph:**
BulkStatus turns a list of URLs into an audit. Paste them, upload a TXT/CSV, or point it at
an XML sitemap or llms.txt file, then run a check to see HTTP status, final redirected URL,
response time, and on-page metadata for every page — plus optional checks on the links and
images each page contains. Sort and filter the results, then export to CSV. Everything runs
in your browser; nothing is sent to a server.

## Feature highlights (benefit-first)

- **Bulk by default** — hundreds of URLs in one pass, from a list, sitemap, or llms.txt.
- **Find what's broken** — non-200s, 404s, 403s, redirects, and missing image alt text.
- **See the redirect truth** — final URL after redirects, with best-effort hop counts.
- **Audit on-page SEO** — title, meta description, H1, canonical, meta robots, word count.
- **Render when needed** — JavaScript mode reads client-rendered links and images.
- **Stay in control** — pause/resume/stop long crawls; tune concurrency, timeouts, limits.
- **Export the proof** — CSV export plus copy for summary and results.
- **Private by design** — no backend, no analytics, no data leaves the browser.

## Screenshot captions (1280×800, in recommended order)

1. **Review every result in a sortable table** — Filter, sort, page through results, and export CSV for reporting or follow-up.
2. **Know the health of every URL at a glance** — Summary metrics break down statuses, redirects, issues, and skipped rows.
3. **Start from the sources you already have** — Paste URLs, upload TXT/CSV, or load an XML sitemap or llms.txt.
4. **Tune the crawl to the site** — Configure checks, speed, timeouts, rendering mode, and visible columns.
5. **Comfortable in dark mode** — The full results view, styled for low-light work.

## Suggested store keywords / tags

bulk url checker, broken link checker, redirect checker, http status, seo audit, sitemap
crawler, llms.txt, meta tags, canonical, link checker, image checker, csv export

## Asset status (this session)

- **Icon:** updated to the v2c2 line-item design (16/32/48/128).
- **Promo tiles:** regenerated with the new icon — `dist/store-listing/promo-tiles/`.
- **Marketing screenshots:** header icon updated to the new design in all five
  `dist/store-listing/screenshots-marketing/*-1280x800.png`.

> Note on screenshots: the framing and branding are current, but the **app UI shown inside
> each frame was captured from build 0.1.32**. Before final submission, recapture fresh
> screenshots from 0.1.36 (the Summary metric labels changed in 0.1.35). Capture steps:
> load the unpacked extension, open BulkStatus, run a small sample crawl, capture the
> Results, Summary, Inputs, Settings, and dark-mode views at a 1280×800 (or 2560×1600 @2x)
> window, then drop the raw captures into `dist/store-listing/raw-captures-0.1.36/` and
> re-run the marketing framing. I can also drive this capture live via the in-browser tools
> if you load the extension and ask.
