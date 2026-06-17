# Chrome Web Store Listing — Proposed Refresh

This is a proposed revision of `STORE_LISTING.md`. The goal is a punchier hook, more
search-relevant phrasing, and a screenshot order that leads with the payoff (results)
rather than the input screen. Privacy and permission-justification sections are carried
over largely unchanged because they are already tuned for Chrome review.

## Title

BulkStatus - Bulk URL Checker

## Short Description (132 char max)

Bulk-check hundreds of URLs for broken links, redirects, status codes, and SEO metadata — from sitemaps, llms.txt, or a pasted list.

> Rationale: leads with the concrete jobs-to-be-done ("broken links, redirects, status
> codes, SEO metadata") that people actually search for, then names the input sources.
> The current line is accurate but reads as a feature inventory rather than a benefit.

## Description

Check large batches of URLs in seconds, without leaving Chrome. BulkStatus is built for
web, SEO, and digital marketing teams who need to verify status codes, catch broken links
and images, confirm redirects, and audit on-page metadata across many pages at once.

Give it URLs three ways: paste a list (or upload a TXT/CSV), point it at an XML sitemap or
sitemap index, or load an llms.txt file. Review the list, run the check, then scan Summary
metrics and a sortable, filterable Results table. Export everything to CSV for reporting.

For each URL, BulkStatus reports HTTP status, final URL after redirects, redirect count,
response time, page title, meta description, H1, canonical URL, meta robots, and word
count — plus any fetch or audit errors.

Turn on optional link and image checks to surface non-200 URLs, 404s, 403s, redirects, and
missing image alt text, with nav/footer items classified and skippable. When a page needs a
real browser to render its links and images, switch on JavaScript rendering mode — including
support for pages behind your existing Chrome login session.

Key features:

- Bulk URL checks from a pasted list or TXT/CSV upload
- Load URLs from an XML sitemap, sitemap index, or llms.txt source
- HTTP status, final URL, redirects, response time, and full page metadata
- Optional discovered-link and image checking, with missing-alt detection
- HTML fetch mode (fast) or JavaScript rendering mode (thorough)
- Browser-session support for rendered checks behind login
- Optional dedicated render window for JavaScript-rendered crawls
- Configurable URL/asset limits, concurrency, timeouts, nav/footer handling, and columns
- Pause, resume, and stop long crawls — with partial results and live-safe speed edits
- Sortable, filterable, paginated Results plus Summary metrics
- CSV export, copy results/summary, and downloadable diagnostics

BulkStatus runs only when you intentionally provide or fetch URLs and click Run Check. It
does not monitor browsing, run automatically on websites, use remote code, or send results
to an external backend.

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

> Rationale: the previous order opened on the input screen. New users skim screenshots to
> answer "what will this give me?" — so the filled-in Results and Summary should come first.

## Privacy Summary

(Unchanged from STORE_LISTING.md — already accurate and review-ready.)

## Permission Justification Drafts

(Unchanged from STORE_LISTING.md.)

## Store Icon

Use the 128x128 store icon. Note: the toolbar icon (16/32/48) should be the simplified
single-status (or check + x) variant for small-size legibility; the richer multi-status
artwork is best reserved for the 128px store icon and promotional tiles.
