# Changelog

All notable BulkStatus changes should be recorded here before packaging a new Chrome Web Store upload.

## 1.0.0 - 2026-06-20

The 1.0 milestone — renamed and repositioned for discovery, a refreshed progress and results UI, and performance and structural work under the hood.

- Renamed to "BulkStatus - Bulk URL Checker & Crawler" and refreshed the store and README copy to cover crawling, SEO, and AI/search visibility (including llms.txt), without changing what the extension does.
- Redesigned the in-progress view: pages, links, and images each get their own compact, color-coded bar (matching the Summary), with one status line for checked/queued/estimated time and clear "Step 1 of 2 / Step 2 of 2" phases.
- Added an idle preview of the progress area before a crawl, so it is clear where status, counts, and time remaining will appear.
- Color-coded the Results "Type" labels (page, link, image) to match the Summary legend.
- Added a full-screen Results view (expand icon in the Results header; Esc or the icon to exit) for reviewing large result sets.
- Added a slim footer with version (links to the changelog), GitHub, issue reporting, and privacy, plus a "back to top" control (a footer link and a floating button that appears after scrolling).
- Matched the URL input box's resize handle and scrollbar styling to the Results table for a consistent feel.
- Fixed the URL-list "click to upload" field so clicking it opens the file picker (previously only the Upload button worked).
- Opening Settings now scrolls the panel into view when triggered from lower on the page.
- Improved performance on large crawls: result updates are now batched per animation frame and row/summary counts are computed in a single pass, instead of rescanning every row on each checked item.
- Added an explicit Manifest V3 content security policy as a hardening measure.
- Reorganized the app's code into focused ES modules; no change to features or behavior.
- Fixed a duplicate status toast that could re-appear when switching input sources, and a small inefficiency in the error-retry pass.

## 0.1.36 - 2026-06-16

- Replaced the extension icon with a bold "line item status" design (green check over red x on a two-page stack) that reflects bulk pass/fail checking and stays legible at 16 px. Regenerated icon assets at 16, 32, 48, and 128 px and updated the source SVG.
- Refactored the app's pure helpers (URL, text, sitemap/llms parsing, status, and duration logic) into ES modules under `src/app/lib/` and loaded `app.js` as a module; runtime behavior is unchanged.
- Added a dependency-free unit test suite (`npm test`) covering the extracted helpers, plus an ESLint flat config (`npm run lint`).
- Added an in-app "What's new" notice: after an update, a small dismissible banner appears in the app (no new tab, no new permissions), auto-dismisses once settings are adjusted, and links to the GitHub changelog.
- Made the Settings version label a link to the project's GitHub repository.
- Added Export/Import of crawl configuration as a JSON file, so teams can share a consistent setup.
- Reorganized Settings into tabs (Extraction & Speed, Checks & Filtering, Results Columns, App) so it is no longer one long wall of options.
- Added an "About & help" group in the App tab with links to the GitHub repository, issue reporting, and the store rating page.
- Added a "Copy AI summary" button to the Summary panel that copies a framed analyst prompt plus the crawl summary, ready to paste into an AI assistant.
- Moved Diagnostics out of the main window into its own Settings tab (data is still always collected); it no longer takes space in the standard crawl view.
- URL list input now ignores blank lines and `#` comment lines, so annotated or commented URL lists can be pasted directly.
- Summary metric cards are now clear toggles: the default "All results" card no longer shows as selected when nothing is filtered, and clicking an active filter card again clears it (back to all results).
- Clicking a summary card no longer auto-expands the filter panel over the table; it keeps the filtered results in view and scrolls them into focus, so table changes are obvious.
- Browser tab title now reflects crawl state (Crawling… %, Crawl paused, Crawl complete, Crawl stopped) instead of a "X of Y checks complete" count, and resets cleanly when a run or auto-retry finishes. In-app progress wording changed from "checks" to "items checked" to match the Summary.

## 0.1.35 - 2026-06-15

- Renamed the Summary Pages metric detail to "Page URLs in crawl" so queued or stopped page rows are not implied to be fully checked.
- Changed Summary and Results header counts to report checked rows separately from skipped or stopped rows.
- Renamed the top Summary issue metric to "Status issues" and stopped counting redirect-only rows as status issues.
- Kept redirects as their own Summary metric/filter so expected redirects do not inflate status issue totals.
- Retained discovered links/images from completed pages as not-checked rows when a crawl is stopped before asset checks complete.
- Added nav/footer filter state to asset-skip diagnostics so skipped asset counts explain whether nav/footer checking was enabled.

## 0.1.34 - 2026-06-15

- Allowed paused crawls to keep Settings visible while locking crawl-definition controls that would change the meaning of the run.
- Enabled live-safe speed and timing edits while paused, including page/rendered concurrency, asset concurrency, timeout, render wait, and delay per asset.
- Updated crawl queues so remaining page and asset checks use revised concurrency after the crawl is resumed.
- Kept display preferences and Results table column controls editable during crawls.

## 0.1.33 - 2026-06-12

- Changed crawl estimated time remaining from large `minutes:seconds` values to friendly units such as `45 sec`, `12 min 30 sec`, or `about 22 hr 30 min`.

## 0.1.32 - 2026-06-09

- Nudged the icon foreground checklist group northwest to reduce top-left whitespace and better balance the foreground sheet.
- Regenerated Chrome extension icon PNG assets.

## 0.1.31 - 2026-06-09

- Refined the icon foreground layout by moving status symbols left, spreading them vertically, and widening the result bars while preserving right-side padding.
- Regenerated Chrome extension icon PNG assets.

## 0.1.30 - 2026-06-09

- Removed company-specific prototype language from the project README so public source sharing stays neutral.
- Broadened nav/footer classification with common navbar, menu, footer-nav, legal, social, and site-info patterns while avoiding overly broad banner matching.
- Refined the extension icon spacing with same-size stacked sheets, stronger right/bottom layer visibility, and larger status rows.
- Regenerated Chrome extension icon PNG assets.

## 0.1.29 - 2026-06-09

- Made Time display apply consistently to shared static HTML and JavaScript settings, including Timeout and Delay per asset.
- Preserved existing millisecond-backed timeout and asset-delay values when switching between seconds and milliseconds so values are converted instead of reinterpreted.

## 0.1.28 - 2026-06-09

- Added a preview-only upward-cascade icon concept with tighter underlying sheet proportions for comparison against the current packaged icon.
- Reordered App preferences to prioritize Theme, Time display, Results density, and Diagnostics panel.
- Expanded Diagnostics panel preferences to Expanded, Collapsed, and Hidden; Hidden removes the Diagnostics container while diagnostics continue to be collected for later copy/export.

## 0.1.27 - 2026-06-09

- Replaced the extension icon with the selected larger-front cascaded-tab design for clearer Chrome toolbar and Web Store presentation.
- Updated the icon source SVG and regenerated Chrome extension icon assets at 16, 32, 48, and 128 px.

## 0.1.26 - 2026-06-09

- Changed the Summary 3xx status color to amber/orange so redirects are visually distinct from green 2xx success statuses.
- Added dedicated category colors for Pages, Links, and Images so asset type and issue dots do not reuse HTTP status colors.
- Updated Page issues and Asset issues dots to indicate the affected category instead of implying severity with traffic-light colors.

## 0.1.25 - 2026-06-09

- Added an App preferences Results density setting with Comfortable, Compact, and Dense table display options.
- Added an App preferences Diagnostics panel setting to start Diagnostics hidden or shown while still collecting diagnostics.
- Included Results density and Diagnostics panel defaults in run diagnostics, diagnostics JSON, and Summary export details.

## 0.1.24 - 2026-06-09

- Changed Render wait from a fixed post-load delay into a maximum wait for JavaScript-rendered pages.
- Added rendered DOM stability checks so pages can move on sooner when URL, title, link count, image count, and text length appear stable.
- Updated render-wait settings copy and diagnostics to clarify when BulkStatus exits early versus reaches the configured maximum wait.

## 0.1.23 - 2026-06-09

- Flattened the App preferences controls so Time display and Theme use the standard settings-row surface instead of appearing as nested cards.
- Tightened the App preferences two-column spacing for better contrast in dark mode.

## 0.1.22 - 2026-06-09

- Moved the seconds/milliseconds Time display control out of Configure results table and into a new App preferences settings card.
- Added a Theme preference to the App preferences card that stays synced with the top-right theme toggle.
- Fixed the Time display dropdown being visually covered by neighboring settings in the Configure results table card.

## 0.1.21 - 2026-06-09

- Changed the default JavaScript render wait from 3 seconds to 30 seconds while keeping the maximum allowed render wait at 120 seconds.
- Updated rendered presets to use a 30-second render wait by default for slower or authenticated pages.
- Added a settings migration so users still on the old untouched 3-second render wait move to the new 30-second default.

## 0.1.20 - 2026-06-09

- Added a Results table state column so queued, checking, complete, skipped, and error rows are clear during long or stopped crawls.
- Updated page-row processing so active rendered checks show as `Checking` instead of looking like unevaluated issues.
- Increased the rendered page wait limit from 15 seconds to 120 seconds for slower sites.
- Made the render wait setting display in seconds or milliseconds based on the selected response-time unit while continuing to store milliseconds internally.

## 0.1.19 - 2026-06-09

- Added a configurable response-time display unit with seconds as the default and milliseconds still available in Settings.
- Updated Results CSV/copy output so the response-time header reflects the selected unit.
- Added an `Automatically retry errors` setting, enabled by default, to retry rows that ended with Error and no HTTP status once after a successful run.
- Made duplicate asset reuse explicit: repeated URL + area occurrences are checked once, then the same status is applied to every page where that asset appears.
- Updated duplicate asset setting copy and diagnostics so users can tell when duplicate statuses are being reused across source pages.

## 0.1.18 - 2026-06-09

- Added topbar actions to open the Chrome Web Store listing and copy the listing link for sharing.
- Added copied-state feedback for the share action without changing the compact icon-only header layout.

## 0.1.17 - 2026-06-09

- Changed the compact status fallback from `Err` to `Error` so failed checks are clearer in the Results table.
- Added a `Retry Errors` Results action that appears when rows have an error with no HTTP status.
- Retried page errors now replace the original row when they recover and can add/check newly discovered assets from recovered pages.
- Added retry diagnostics summarizing how many error rows were retried, recovered, or still remain.

## 0.1.16 - 2026-06-09

- Reordered Settings presets to emphasize the common rendered workflows: Full rendered scan, Link audit, Image audit, then Fast URL-only.
- Updated Link audit and Image audit presets to use JavaScript rendering with the browser session by default so discovered links/images match rendered-page behavior.
- Updated preset descriptions to clarify which presets use JavaScript rendering versus static HTML.

## 0.1.15 - 2026-06-09

- Changed the dedicated render window default to off so JavaScript-rendered crawls do not open a separate Chrome window unless enabled in Settings.
- Added a rendered-mode browser session setting, default on, so page, link, and image status checks can use Chrome login cookies for authenticated pages.
- Added login-wall pause behavior for repeated page-level `401` or `403` responses from the same host, allowing users to sign in through Chrome and resume queued work.
- Added browser-session and authentication pause details to diagnostics and Summary export details.

## 0.1.14 - 2026-06-08

- Fixed Summary and filter issue counts so queued pages are not counted as missing title, meta description, H1, or canonical before they have been evaluated.
- Missing page metadata now counts only after a page has returned an HTTP status and BulkStatus has had a chance to collect metadata.

## 0.1.13 - 2026-06-08

- Added a dedicated render window option for JavaScript rendering so crawl tabs stay separate from the user's main Chrome window.
- Kept dedicated-window rendered tabs active inside the separate window while leaving the window inactive by default, reducing focus disruption while preserving realistic rendering.
- Added retry handling for transient Chrome tab-operation errors such as "Tabs cannot be edited right now" before marking a rendered page as an error.
- Added dedicated render window state to run diagnostics, diagnostics JSON, and Summary export details.

## 0.1.12 - 2026-06-04

- Bumped the Chrome Web Store package version to `0.1.12` for resubmission.
- Updated the manifest description to focus on asset status, redirects, metadata, links, images, and broader URL checks.
- Refined the Inputs & Quick Configuration header, source tabs, and fetched URL helper copy.
- Moved the input URL count beside the Copy URLs button so pasted, uploaded, XML sitemap, and llms.txt inputs share the same count display.
- Updated Inputs and Results helper copy to work across pasted, uploaded, XML sitemap, and llms.txt workflows.
- Changed URL list helper copy to say "Include one URL per line" so bulk pasting is clearer.
- Replaced the transient Fetch URLs loading text with a spinning Fetch URLs icon to keep the source input layout stable.
- Made the Fetch URLs spinner complete a quick visible rotation even when the source fetch finishes immediately.
- Added XML sitemap and llms.txt input sources with fetched URLs reviewed before running a check.
- Changed quick configuration controls to compact checklist-style toggles.
- Tightened the quick configuration layout, aligned the Configure further gear, stabilized input tab heights, and changed the tab label to XML sitemap.
- Raised the default input URL limit from 2,000 to 10,000.
- Changed default quick settings to JavaScript rendering, links, and images enabled while leaving nav/footer link checks off by default.
- Added pause/resume and stop controls to long-running crawls, with partial results available while paused or after stopping.
- Added Summary and Diagnostics containers with copy/export options.
- Changed Summary wording from row-based language to checked items/pages/links/