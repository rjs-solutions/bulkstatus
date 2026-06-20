// Shared constant values: limits, default settings, fixed URLs, and the static
// placeholder shapes for the summary panel. No runtime dependencies.

export const MAX_INPUT_URL_LIMIT = 100000;
export const MAX_DISCOVERED_ASSET_LIMIT = 50000;
export const MAX_RENDER_WAIT_MS = 120000;
export const LEGACY_DEFAULT_INPUT_URL_LIMIT = 2000;
export const PREVIEW_LIMIT = 100;
export const RESULTS_PAGE_SIZE_OPTIONS = [100, 250, 500];
export const SETTINGS_VERSION = 11;
export const MIN_FETCH_SPINNER_MS = 520;
export const RENDERED_TAB_RETRY_ATTEMPTS = 3;
export const RENDERED_TAB_RETRY_BASE_MS = 750;
export const AUTH_PAUSE_THRESHOLD = 2;
export const AUTH_STATUS_CODES = new Set([401, 403]);
export const RENDER_STABILITY_POLL_MS = 1000;
export const RENDER_STABILITY_MIN_WAIT_MS = 3000;
export const RENDER_STABILITY_TEXT_TOLERANCE = 50;
export const CHROME_WEB_STORE_LISTING_URL = "https://chromewebstore.google.com/detail/bulkstatus-bulk-url-check/ngoefpeflkbebdpemiiebbjlkhmmkmeh";
// Public repository under the project org. Derives the changelog, issues, and privacy links.
export const GITHUB_REPO_URL = "https://github.com/rjs-solutions/bulkstatus";
export const CHANGELOG_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/blob/main/CHANGELOG.md` : "";
export const GITHUB_ISSUES_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/issues` : "";
export const PRIVACY_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/blob/main/PRIVACY.md` : "";
export const LAST_SEEN_VERSION_KEY = "bulkstatus-last-version";
export const DEFAULT_SETTINGS = {
  checkLinks: true,
  checkImages: true,
  collapseResponsiveImages: true,
  dedupeLinks: true,
  autoRetryErrors: true,
  keepAwake: true,
  ignoreNav: false,
  ignoreFooter: false,
  checkExternalLinks: true,
  diagnosticMode: true,
  extractionMode: "rendered",
  pageConcurrency: 4,
  renderedConcurrency: 1,
  renderWaitMs: 30000,
  openInactive: true,
  useDedicatedRenderWindow: false,
  useBrowserSessionForRenderedChecks: true,
  closeRenderedTabs: true,
  linkConcurrency: 4,
  timeoutMs: 10000,
  timeDisplayUnit: "seconds",
  resultsDensity: "comfortable",
  linkDelayMs: 250,
  maxInputUrls: 10000,
  maxDiscoveredAssets: 10000,
  visibleColumns: {
    sourcePage: true,
    area: true,
    textAlt: true,
    time: true,
    linkIssues: true,
    imageIssues: true,
    title: true,
    description: true,
    h1: true,
    robots: true,
    canonical: true,
    words: true,
    result: true
  }
};

export const ALWAYS_VISIBLE_COLUMNS = new Set(["state", "expander", "type", "open", "inputUrl", "finalUrl", "status", "redirects"]);

export const SUMMARY_PLACEHOLDER_METRICS = [
  { label: "Items", detail: "All results" },
  { label: "Pages", detail: "Page URLs in crawl" },
  { label: "Links", detail: "Discovered links" },
  { label: "Images", detail: "Discovered images" },
  { label: "Status issues", detail: "Non-200 status or errors" },
  { label: "404s", detail: "Not found items" },
  { label: "Redirects", detail: "Items with redirects" },
  { label: "Skipped", detail: "Not checked by filters or stop" }
];
export const SUMMARY_PLACEHOLDER_BREAKDOWNS = [
  { title: "Asset type", items: [{ label: "Pages", tone: "page" }, { label: "Links", tone: "link" }, { label: "Images", tone: "image" }] },
  { title: "Status", items: [{ label: "2xx", tone: "success" }, { label: "3xx", tone: "warning" }, { label: "4xx", tone: "danger" }, { label: "5xx", tone: "danger" }, { label: "Errors", tone: "danger" }, { label: "Skipped", tone: "muted" }] },
  { title: "Page issues", items: [{ label: "Missing title", tone: "page" }, { label: "Missing description", tone: "page" }, { label: "Missing H1", tone: "page" }, { label: "Missing canonical", tone: "page" }, { label: "Canonicalized", tone: "page" }, { label: "Noindex", tone: "page" }] },
  { title: "Asset issues", items: [{ label: "Non-200 links", tone: "link" }, { label: "Non-200 images", tone: "image" }, { label: "Missing image alt", tone: "image" }, { label: "Skipped assets", tone: "muted" }] }
];
