# Manual Test / Smoke-Test Checklist

Run this before publishing each release. It is ordered so the highest-risk items (does the
app even load after code changes?) come first. For 0.1.36 the risky changes are the **ES
module refactor** (how `app.js` loads), the **network-layer extraction**, the **new icon**,
and the **what's-new banner / About section**.

## 0. Before loading (on your machine)

- [ ] `npm test` → all tests pass (currently 30).
- [ ] `extension/manifest.json` version is correct (0.1.36).
- [ ] (optional) `npm run lint` is clean.

## 1. Load unpacked and confirm it boots

- [ ] `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
- [ ] The card shows **no "Errors"** button. If it does, open it and read the error.
- [ ] The toolbar icon shows the **new icon** (green check over red x). Check the card's
      128px icon too.
- [ ] Open BulkStatus (toolbar icon or `Alt+B`). **Open DevTools (F12) → Console.**
- [ ] **Console is clean — no red errors.** This is the key check for the module refactor:
      a bad `import` path would throw on load and leave the page blank. The full UI should
      render (header, inputs, settings).

## 2. What's-new banner + About (new this release)

Fresh installs are intentionally silent, so simulate an update:

- [ ] Open the app once (this records the current version), then in the Console run:
      `localStorage.setItem('bulkstatus-last-version','0.1.35')` and reload the app page.
- [ ] A dismissible **"Updated to 0.1.36"** banner appears under the header.
- [ ] Clicking **"What's new"** opens Settings and scrolls to the **About** block; the
      banner goes away.
- [ ] Reload → banner does **not** reappear (it was marked seen).
- [ ] Re-trigger (set the key to `0.1.35`, reload), then **change any setting** → the banner
      **auto-dismisses**.
- [ ] In Settings, the **About** block shows version 0.1.36 and the highlight bullets. The
      "View full changelog" link is hidden (expected until `GITHUB_REPO_URL` is set).

## 3. Core crawl — HTML fetch mode (covers the network refactor)

- [ ] Paste the contents of `scripts/sample-urls.txt`; set extraction mode to **HTML fetch**.
- [ ] **Run check.** Rows populate with status, final URL, redirect count, response time,
      and metadata (title/description/H1/canonical/robots/word count).
- [ ] At least one URL that redirects shows a 3xx status and a redirect count ≥ 1.
- [ ] Links/images are discovered and listed (expand a page row) when those checks are on.
- [ ] Trigger a timeout/error case (e.g., a bad URL) → it reports an error row, not a crash.

## 4. Core crawl — rendered mode

- [ ] Switch to **JavaScript rendering** mode; run a few URLs.
- [ ] Grant the host / scripting permission prompts when they appear.
- [ ] Tabs open and close as configured; rendered results populate.
- [ ] (If testing login-walled pages) the auth-wall pause behaves as expected.

## 5. Controls and outputs

- [ ] **Pause / Resume** mid-crawl works; queued work continues after resume.
- [ ] **Stop** mid-crawl works; partial results remain; rows show "Run stopped"/skipped.
- [ ] Filters, column sort, search, and pagination behave.
- [ ] **Copy Summary**, **Copy Results**, **Export CSV**, **Export Summary** — open a CSV
      and confirm the data looks right.
- [ ] **Diagnostics** panel populates (enable it in Settings) and downloads.

## 6. Inputs, settings, theme

- [ ] **XML Sitemap** input: enter a sitemap URL, Fetch URLs → page URLs load into the box.
- [ ] **llms.txt** input: enter an llms.txt URL, Fetch URLs → links load.
- [ ] Change settings → **Save as default** → reload the app → settings persist.
- [ ] **Reset defaults** restores defaults.
- [ ] Toggle **light / dark** theme; UI (including the banner and About) looks right in both.

## 7. Permissions sanity

- [ ] On the extensions card, confirm **no permissions requested at install**.
- [ ] Host permission is requested only on first fetch/crawl; scripting only for rendered mode.

## Expected console noise from crawled sites (not bugs)

In **rendered mode**, BulkStatus opens the target pages in real Chrome tabs, so those pages'
own console output gets associated with the extension and appears under
`chrome://extensions` → BulkStatus → **Errors**. This is expected and is **not** a defect in
BulkStatus. Two common kinds:

- **CSP "script blocked" errors** — the crawled site's own Content-Security-Policy blocking
  its own scripts (e.g., a Salesforce Lightning site loading scripts from a different host
  than the page origin). This happens on those sites in any browser.
- **"Preloaded but not used"** — benign performance hints emitted by the crawled pages.

How to tell it's not your bug: every such message points at a **third-party URL** (the site
you crawled), never at `chrome-extension://…` or BulkStatus's own files. If you ever see an
error referencing `app.js`, `src/app/lib/*.js`, or the service worker, that one *is* worth
investigating.

What to do: it's safe to click **Clear all**. The messages won't affect Chrome Web Store
review (review inspects the package, not runtime output from crawled sites). **HTML-fetch
mode does not open tabs and won't generate them** — use it when you want a clean console
(e.g., while capturing screenshots).

## 8. After it passes

- [ ] Capture fresh 0.1.36 screenshots if publishing (see `docs/SCREENSHOTS.md`).
- [ ] Re-package: `.\scripts\package-extension.ps1` → `dist\bulkstatus-0.1.36.zip`.
- [ ] Then proceed to GitHub, then the Chrome Web Store update (`docs/PUBLISHING.md`).

> If anything in sections 1–5 fails, fix before publishing — those exercise the code paths
> that changed this release.
