# Development

BulkStatus ships as a plain Manifest V3 extension with no build step. The files under
`extension/` are loaded directly by Chrome. Tooling at the repo root (tests, lint) is for
development only and is **not** included in the Web Store package.

## Project structure

```
extension/
  manifest.json
  src/
    background.js          # 3-line action launcher (opens the app tab)
    app/
      index.html           # loaded as <script type="module">
      app.js               # main app: state, DOM rendering, crawl orchestration
      styles.css
      lib/                 # pure, dependency-free, unit-tested modules
        text.js            # cleanText, escapeHtml, cssEscape, countWords, clampNumber
        url.js             # normalize/resolve/compare URLs, responsive-image collapse
        sitemap.js         # XML sitemap + llms.txt parsing
        status.js          # HTTP status classification
        duration.js        # duration formatting
tests/                     # node:test unit tests for lib/ (no deps required)
package.json               # dev scripts only
eslint.config.js           # ESLint flat config
```

## Running tests and lint

Tests use Node's built-in test runner — no `npm install` required:

```bash
npm test          # node --test
```

Linting requires dev dependencies (ESLint + globals). If your environment can reach npm:

```bash
npm install
npm run lint
```

## Why `lib/`

`app.js` was a single ~5,200-line file mixing state, networking, parsing, and DOM
rendering. The pure functions (no DOM, no shared `state`) have been extracted into `lib/`
so they can be unit-tested and reused without spinning up a browser. `app.js` imports them;
behavior is unchanged.

## After refactoring: smoke-test in Chrome

The module split is verified by `node --check` (no syntax/duplicate-binding errors) and the
`lib/` unit tests, but DOM/runtime behavior must be confirmed in Chrome:

1. `chrome://extensions` → reload the unpacked extension.
2. Open BulkStatus, run a small check in both HTML-fetch and rendered modes.
3. Confirm sitemap/llms.txt loading, filtering/sorting, and CSV export still work.

## Suggested next refactor phases

Phase 1 (done): extract pure helpers to `lib/` + tests + lint.

Phase 2 (proposed): extract the network layer — `fetchWithTimeout`, `fetchTrace`,
`checkUrlStatus`, and the redirect logic — into `lib/network.js`. These are nearly pure
(they take a `fetch`-like dependency) and are the highest-value code to cover with tests.

Phase 3 (proposed): separate rendering/state. Move the `state` object and DOM render
functions into their own modules (`state.js`, `render/*.js`). This is the largest and
riskiest step; do it incrementally with a Chrome smoke-test after each move.
