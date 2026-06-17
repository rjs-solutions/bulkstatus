# Chrome Web Store Listing

## Current Package Version

0.1.35

## Title

BulkStatus - Bulk URL Checker

## Short Description

Bulk URL status, redirect, metadata, link, image, sitemap, and llms.txt checks for web teams.

## Description

BulkStatus helps web teams and digital marketing teams check groups of URLs quickly from a focused Chrome extension interface.

Paste URLs, upload a TXT/CSV file, or fetch URLs from an XML sitemap, sitemap index, or llms.txt file. Review the URL list, run a check, scan Summary metrics, review paginated Results, and export findings for reporting.

BulkStatus can report HTTP status, final redirected URL, redirect count, response time, page title, meta description, H1, canonical URL, meta robots, word count, and fetch/audit errors.

Optional discovered link and image checks help identify non-200 URLs, redirects, 404s, 403s, missing image alt text, and skipped nav/footer items. JavaScript rendering can be enabled when a page needs Chrome rendering to reveal links or images that are not present in static HTML.

Key features:

- Bulk URL checks from pasted URLs or TXT/CSV upload
- URL fetching from XML sitemap, sitemap index, or llms.txt sources
- HTTP status, final URL, redirects, response time, and page metadata
- Optional discovered link and image checking
- HTML fetch mode or JavaScript rendering mode
- Browser-session support for JavaScript-rendered checks behind login
- Optional dedicated render window for JavaScript-rendered crawls
- Configurable input URL limits, discovered asset limits, speed, timeouts, nav/footer handling, and table columns
- Paused-crawl speed and timing adjustments that apply to remaining checks
- Quick configuration controls for JavaScript rendering, images, links, nav links, and footer links
- Paginated, sortable Results table with filters for status, type, area, issues, redirects, skipped rows, 404s, and search
- Summary metrics with copy/export options
- Pause, resume, and stop controls for long-running crawls, with partial results available
- CSV export, copy results, and downloadable diagnostics for troubleshooting

BulkStatus only runs when the user intentionally provides or fetches URLs and clicks Run Check. It does not monitor browsing activity, run automatically on websites, use remote code, or send results to an external backend.

## Category

Productivity

## Language

English

## Suggested Release Notes

Version 0.1.35 clarifies Summary counts, separates status issues from redirects and page metadata issues, and keeps discovered-but-unchecked links/images visible when a crawl is stopped.

## Privacy Summary

BulkStatus runs checks locally in the browser after the user intentionally provides or fetches URLs and clicks Run Check.

BulkStatus does not sell or transfer user data. It does not use remote code or an external backend. Results and diagnostics stay in the user's browser unless the user copies or exports them.

BulkStatus stores user preferences in browser local storage. It does not request the Chrome `storage` permission.

For JavaScript-rendered checks, BulkStatus can use the user's existing Chrome browser session to check pages behind login. It does not read, display, export, or store cookies and does not request the Chrome `cookies` permission.

Optional site access is requested at runtime so BulkStatus can fetch user-provided URLs, fetched sitemap/llms.txt sources, and optionally discovered links/images to report HTTP status, redirects, metadata, and response timing. BulkStatus does not monitor browsing activity or run automatically on websites.

## Permission Justification Drafts

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

Recommended screenshots:

- Inputs & Quick Configuration with URL list, XML sitemap, or llms.txt source visible
- Summary metrics after a crawl
- Results table with pagination, filters, and sortable columns
- Settings panel showing configurable checks, speed, extraction mode, and table columns
- Diagnostics panel showing version/environment details and download option
