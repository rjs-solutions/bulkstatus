# Chrome Web Store Listing

## Current Package Version

1.0.0

## Title

BulkStatus - Bulk URL Checker & Crawler

## Short Description

Crawl & bulk-check URLs for status codes, broken links, redirects, images & SEO metadata — from a sitemap, llms.txt, or list.

## Description

Check large batches of URLs in seconds, right inside Chrome. BulkStatus is for web, SEO, and content teams who need to verify status codes, catch broken links and images, confirm redirects, and audit on-page metadata across many pages at once.

Give it URLs three ways: paste a list or upload a TXT/CSV, point it at an XML sitemap or sitemap index, or load an llms.txt file. Review the list, run the check, then read the Summary metrics and a sortable, filterable Results table. Export everything to CSV for reporting.

For every URL, BulkStatus reports HTTP status, the final URL after redirects, redirect count, response time, page title, meta description, H1, canonical URL, meta robots, and word count, plus any fetch or audit errors.

Turn on optional link and image checks to crawl the links and images each page contains and surface non-200 URLs, 404s, 403s, redirects, and missing image alt text. Nav and footer items are classified so you can include or skip them. When a page needs a real browser to render its links and images, switch on JavaScript rendering, including pages behind your existing Chrome login.

Care how AI reads your site? If you publish an llms.txt or want your pages surfaced in AI search and answer engines, BulkStatus confirms those pages return clean status codes, resolve their redirects, and carry the title, description, and canonical tags that search and AI systems depend on — the groundwork behind SEO, answer-engine optimization (AEO), and generative-engine optimization (GEO).

You stay in control of the crawl: pause, resume, or stop at any time with partial results kept, and tune concurrency, timeouts, and URL/asset limits. Speed and timing edits apply live to the remaining checks.

Everything runs locally in your browser. No backend, no analytics, no account, and nothing leaves Chrome unless you copy or export it.

Common uses: bulk URL status checks, broken-link audits, redirect mapping, post-migration QA, sitemap and llms.txt validation, technical SEO crawls, and pre-launch checks for search and AI visibility.

Key features:

- Bulk URL checks from a pasted list or TXT/CSV upload
- Crawl URLs from an XML sitemap, sitemap index, or llms.txt source
- HTTP status, final URL, redirects, response time, and full page metadata
- Optional link and image crawling, with missing-alt detection
- Fast HTML mode or thorough JavaScript rendering mode
- Browser-session support for JavaScript-rendered checks behind login
- Optional dedicated render window for JavaScript-rendered crawls
- Configurable input URL limits, discovered-asset limits, concurrency, timeouts, and nav/footer handling
- Pause, resume, and stop long-running crawls, with partial results retained
- Paginated, sortable Results table with filters for status, type, area, issues, redirects, skipped rows, and 404s
- Summary metrics with copy/export options
- CSV export, copy results/summary, and downloadable diagnostics for troubleshooting
- Private by design: local-only, no backend, no analytics, no account

BulkStatus only runs when the user intentionally provides or fetches URLs and clicks Run Check. It does not monitor browsing activity, run automatically on websites, use remote code, or send results to an external backend.

## GitHub Repository

Repository description (the "About" blurb on GitHub):

> Bulk URL checker and crawler for Chrome — check status codes, broken links, redirects, images, and SEO metadata from a list, XML sitemap, or llms.txt. Runs locally, no backend.

Topics (add under the repo "About" → topics; these carry keywords without stuffing prose):

`chrome-extension`, `bulk-url-checker`, `url-checker`, `broken-link-checker`, `link-checker`, `web-crawler`, `http-status`, `status-code`, `redirect-checker`, `sitemap`, `llms-txt`, `seo`, `technical-seo`, `seo-audit`, `aeo`, `geo`, `ai-search`, `ai-visibility`, `image-checker`, `manifest-v3`

## Category

Productivity

## Language

English

## Suggested Release Notes

(Use the per-version notes from CHANGELOG.md at publish time.)

## Screenshots (recommended order)

Lead with the payoff, end with configurability. Use the 1280x800 marketing variants.

1. Results table — sortable/filterable rows with statuses, redirects, and issues (the payoff)
2. Summary metrics after a crawl — the at-a-glance health view
3. Inputs & quick configuration — URL list / XML sitemap / llms.txt sources
4. Settings — configurable checks, speed, extraction mode, and columns
5. Dark mode — same results view, showing polish and accessibility

## Single Purpose

BulkStatus has one purpose: to check a user-provided set of URLs — pasted, uploaded as a TXT/CSV, or fetched from an XML sitemap or llms.txt source — and report each URL's HTTP status, redirects, response time, on-page metadata, and (optionally) the status of the links and images it contains, in a sortable, filterable, exportable table.

## Privacy Summary

BulkStatus runs checks locally in the browser after the user intentionally provides or fetches URLs and clicks Run Check.

BulkStatus does not sell or transfer user data. It does not use remote code or an external backend. Results and diagnostics stay in the user's browser unless the user copies or exports them.

BulkStatus stores user preferences in browser local storage. It does not request the Chrome `storage` permission.

For JavaScript-rendered checks, BulkStatus can use the user's existing Chrome browser session to check pages behind login. It does not read, display, export, or store cookies and does not request the Chrome `cookies` permission.

Optional site access is requested at runtime so BulkStatus can fetch user-provided URLs, fetched sitemap/llms.txt sources, and optionally discovered links/images to report HTTP status, redirects, metadata, and response timing. BulkStatus does not monitor browsing activity or run automatically on websites.

## Permission Justification Drafts

### Power Permission (required)

BulkStatus requests the `power` permission to optionally keep the device awake during a crawl (Settings -> "Keep device awake"). A large bulk check can outlast the system sleep timer; this keeps a long run from being interrupted when the machine would otherwise sleep. It is engaged only while a check is running and released as soon as the run finishes or is stopped, and it changes no other power or system settings.

### Optional Host Permissions

Optional site access is requested only after the user intentionally fetches an input source or starts a check. BulkStatus uses this access to fetch user-provided URLs, XML sitemap or llms.txt sources, and optionally discovered links/images to report HTTP status, redirects, metadata, response timing, and errors. It does not monitor browsing activity or run automatically on websites.

### Optional Scripting Permission

Optional scripting permission is used only for JavaScript rendering mode. When enabled by the user, BulkStatus opens a page in Chrome and collects the rendered DOM so it can find links/images and metadata that are not present in static HTML.

### Remote Code

No, BulkStatus does not use remote code.

## Store Assets

Primary extension icons are in:

- `extension/assets/icons/icon-16.png`
- `extension/assets/icons/icon-32.png`
- `extension/assets/icons/icon-48.png`
- `extension/assets/icons/icon-128.png`

Use `extension/assets/icons/icon-128.png` for the 128 x 128 store icon unless a separate promotional tile is created later.
