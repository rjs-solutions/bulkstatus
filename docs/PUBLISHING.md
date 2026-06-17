# Publishing BulkStatus to the Chrome Web Store

This guide covers shipping an update (currently **0.1.36**) to the existing listing.

## 1. Pre-publish checklist

- [ ] **Smoke-test in Chrome** (required after the module refactor): load the unpacked
      `extension/` folder at `chrome://extensions`, then run a small check in both
      HTML-fetch and rendered modes. Confirm sitemap/llms.txt loading, filtering/sorting,
      CSV export, and the new icon all look right. See `DEVELOPMENT.md`.
- [ ] `npm test` passes (currently 30 tests).
- [ ] Version bumped in `extension/manifest.json` (done: 0.1.36) and noted in `CHANGELOG.md`.
- [ ] New icon renders correctly at 16/32/48/128.

## 2. Build the package

On Windows, from the `bulk-status` folder:

```powershell
.\scripts\package-extension.ps1
```

This produces `dist\bulkstatus-0.1.36.zip` with `manifest.json` at the ZIP root. A
pre-built `dist/bulkstatus-0.1.36.zip` is already included from this session; re-run the
script if you change any files under `extension/`.

> The ZIP must contain the **contents** of `extension/` (manifest at root), not the
> `extension/` folder itself. The script verifies this automatically.

## 3. Upload in the Developer Dashboard

1. Go to the Chrome Web Store Developer Dashboard and open the BulkStatus item.
2. **Package** tab → upload `dist/bulkstatus-0.1.36.zip`. Wait for the manifest to validate.
3. **Store listing** tab → apply the refreshed copy from `docs/STORE_LISTING_v2_proposed.md`
   (short description, description, screenshot order). Upload updated screenshots/tiles if
   you regenerate them.
4. **Privacy practices** tab → confirm the single purpose, permission justifications
   (carried in `docs/STORE_LISTING.md`), and data-use disclosures. Provide a privacy
   policy URL if prompted (see §5).
5. Save the draft, then **Submit for review**. Review typically takes a few hours to a few
   days; the update goes live automatically on approval.

## 4. Permissions review (current state — looks good)

BulkStatus requests **no permissions at install**. Everything is optional and requested at
runtime only when the user acts:

- `optional_permissions: ["scripting"]` — requested only when the user enables JavaScript
  rendering mode, to read a page's rendered DOM.
- `optional_host_permissions: ["http://*/*", "https://*/*"]` — requested only when the user
  fetches an input source or starts a check, to request the URLs they supplied.

There are no `content_scripts`, no broad install-time host access, and no `storage`,
`cookies`, or `tabs`-at-install permissions. This is the least-privilege setup Chrome
reviewers prefer and should make review smoother. No change recommended.

> Tip: in the dashboard's permission-justification fields, paste the drafts already written
> in `docs/STORE_LISTING.md` under "Permission Justification Drafts."

## 5. Language and localization

- The store listing **Language** field is **English** (set in `docs/STORE_LISTING.md`).
- The extension ships a single language: all UI strings are inline English and there is no
  `_locales/` directory or `default_locale` in the manifest, which is correct for a
  single-language extension. No action needed now.
- If you localize later: add `_locales/<lang>/messages.json`, set `"default_locale"` in the
  manifest, and replace user-facing strings with `chrome.i18n.getMessage(...)`. The store
  listing can also be translated per-language in the dashboard.

## 6. Privacy policy

Chrome requires a privacy policy URL for items that handle user data or request sensitive
permissions. BulkStatus keeps all data in the browser and does not transmit results to a
backend, but because it requests host access and (optionally) reads page content, a short
hosted privacy policy is the safe call. The substance already exists in the
`docs/STORE_LISTING.md` "Privacy Summary" — it just needs to live at a public URL (e.g., a
GitHub Pages page or a section of the planned GitHub repo). Ask and this can be drafted as a
standalone `PRIVACY.md` ready to host.
```
