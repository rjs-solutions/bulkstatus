# BulkStatus Privacy Policy

_Last updated: June 16, 2026_

BulkStatus ("the extension") is a Chrome extension that checks groups of URLs for HTTP
status, redirects, page metadata, links, and images. This policy explains what the
extension does and does not do with data.

## Summary

BulkStatus does **not** collect, store, sell, or transmit your personal information. All
processing happens locally in your browser. There is no external backend and no analytics.

## What the extension accesses

BulkStatus only acts when you intentionally provide or fetch URLs and click **Run Check**.
To perform a check, it makes network requests to:

- the URLs you paste, upload, or load from an XML sitemap or llms.txt source, and
- (optionally, if you enable them) the links and images discovered on those pages.

For each request it reads standard HTTP responses — status code, final URL, redirect
information, response timing, and page HTML — so it can report status, metadata (title,
meta description, H1, canonical, meta robots, word count), and link/image results.

If you enable **JavaScript rendering mode**, BulkStatus opens the page in a Chrome tab and
reads the rendered DOM to find links, images, and metadata that are not present in static
HTML. With your existing Chrome session, this can include pages behind your login.

## Permissions

BulkStatus requests no permissions at install. It requests these only at runtime, after you
act:

- **Host access (`http://*/*`, `https://*/*`)** — requested when you fetch an input source
  or start a check, so the extension can request the URLs you supplied. It does not monitor
  your browsing and does not run automatically on websites.
- **Scripting** — requested only when you enable JavaScript rendering mode, to read a
  page's rendered DOM.

BulkStatus does not request the `storage`, `cookies`, `tabs` (at install), `history`,
`bookmarks`, or `identity` permissions.

## Data storage and sharing

- **Results and diagnostics** stay in your browser. They are never sent anywhere. They
  leave your device only if you choose to copy or export them (for example, to CSV).
- **Preferences** (your settings) are saved in your browser's local storage on your device.
- BulkStatus does **not** read, display, export, or store cookies.
- BulkStatus does **not** use remote code.
- BulkStatus does **not** sell or transfer user data to third parties.

## Your responsibility

Use BulkStatus only on URLs and websites you are authorized to test.

## Changes to this policy

If this policy changes, the updated version will be posted at the same location with a new
"Last updated" date.

## Contact

Questions about this policy can be directed to the developer through the Chrome Web Store
listing's support contact.
