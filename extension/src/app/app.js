import { cleanText, escapeHtml, cssEscape, countWords, clampNumber } from "./lib/text.js";
import {
  normalizeUrl,
  resolveUrl,
  comparableUrl,
  hostnameFor,
  estimateRedirectCount,
  collapseResponsiveImageUrl,
  firstSrcsetCandidate,
  cleanMarkdownHref,
  trimUrlTail,
  resolveLoadedUrl
} from "./lib/url.js";
import { parseSitemapXml, xmlElements, childLocText, extractLlmsUrls } from "./lib/sitemap.js";
import * as net from "./lib/network.js";
import { statusFamily, isNon200HttpStatus } from "./lib/status.js";
import { formatEstimatedDuration, formatDuration, formatDurationLong } from "./lib/duration.js";

const MAX_INPUT_URL_LIMIT = 100000;
const MAX_DISCOVERED_ASSET_LIMIT = 50000;
const MAX_RENDER_WAIT_MS = 120000;
const LEGACY_DEFAULT_INPUT_URL_LIMIT = 2000;
const PREVIEW_LIMIT = 100;
const RESULTS_PAGE_SIZE_OPTIONS = [100, 250, 500];
const SETTINGS_VERSION = 11;
const MIN_FETCH_SPINNER_MS = 520;
const RENDERED_TAB_RETRY_ATTEMPTS = 3;
const RENDERED_TAB_RETRY_BASE_MS = 750;
const AUTH_PAUSE_THRESHOLD = 2;
const AUTH_STATUS_CODES = new Set([401, 403]);
const RENDER_STABILITY_POLL_MS = 1000;
const RENDER_STABILITY_MIN_WAIT_MS = 3000;
const RENDER_STABILITY_TEXT_TOLERANCE = 50;
const CHROME_WEB_STORE_LISTING_URL = "https://chromewebstore.google.com/detail/bulkstatus-bulk-url-check/ngoefpeflkbebdpemiiebbjlkhmmkmeh";
// Public repository under the project org. Derives the changelog, issues, and privacy links.
const GITHUB_REPO_URL = "https://github.com/rjs-solutions/bulkstatus";
const CHANGELOG_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/blob/main/CHANGELOG.md` : "";
const GITHUB_ISSUES_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/issues` : "";
const PRIVACY_URL = GITHUB_REPO_URL ? `${GITHUB_REPO_URL}/blob/main/PRIVACY.md` : "";
const LAST_SEEN_VERSION_KEY = "bulkstatus-last-version";
const DEFAULT_SETTINGS = {
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

const ALWAYS_VISIBLE_COLUMNS = new Set(["state", "expander", "type", "open", "inputUrl", "finalUrl", "status", "redirects"]);
let renderedPermissionError = "";
let hostPermissionError = "";

const state = {
  rows: [],
  running: false,
  paused: false,
  stopRequested: false,
  pauseResolvers: [],
  activeFetchControllers: new Set(),
  activeRenderedTabIds: new Set(),
  renderWindowId: null,
  renderWindowKeeperTabId: null,
  authFailureHosts: new Map(),
  authPauseHosts: new Set(),
  pauseReason: "",
  runStartedAt: 0,
  completedWork: 0,
  totalWork: 0,
  currentPhase: "",
  runStage: "idle",
  resultsFullscreen: false,
  progress: {
    pages: { done: 0, total: 0 },
    links: { done: 0, total: 0, enabled: true, discovered: false },
    images: { done: 0, total: 0, enabled: true, discovered: false }
  },
  runDiagnostics: [],
  panelCollapsed: {
    urls: false,
    summary: false,
    results: false,
    diagnostics: true
  },
  summaryShown: false,
  lastRunDurationMs: 0,
  activePreset: "",
  settingsBeforePreset: null,
  inputMode: localStorage.getItem("bulkstatus-input-mode") || "list",
  inputTextByMode: {
    list: "",
    sitemap: "",
    llms: ""
  },
  sourceUrlByMode: {
    sitemap: "",
    llms: ""
  },
  sourceStatusByMode: {
    sitemap: "",
    llms: ""
  },
  inputCountNoteByMode: {
    list: "",
    sitemap: "",
    llms: ""
  },
  loadingInputSource: false,
  hideImages: false,
  hideLinks: false,
  hideSkipped: false,
  only404: false,
  filtersOpen: false,
  filters: {
    search: "",
    families: [],
    statuses: [],
    types: [],
    areas: [],
    issuesOnly: false,
    redirectsOnly: false,
    errorsOnly: false,
    skippedOnly: false,
    missingTitle: false,
    missingDescription: false,
    missingH1: false,
    missingCanonical: false,
    canonicalizedPages: false,
    noindexPages: false,
    missingImageAlt: false
  },
  showAll: false,
  resultsPage: 1,
  resultsPageSize: PREVIEW_LIMIT,
  resetResultsScroll: false,
  sortColumn: "",
  sortDirection: "asc",
  settings: { ...DEFAULT_SETTINGS }
};

const elements = {
  autoRetryErrorsInput: document.querySelector("#autoRetryErrorsInput"),
  keepAwakeInput: document.querySelector("#keepAwakeInput"),
  checkImagesInput: document.querySelector("#checkImagesInput"),
  checkLinksInput: document.querySelector("#checkLinksInput"),
  collapseResponsiveImagesInput: document.querySelector("#collapseResponsiveImagesInput"),
  clearButton: document.querySelector("#clearButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  closeRenderedTabsInput: document.querySelector("#closeRenderedTabsInput"),
  columnToggles: [...document.querySelectorAll("[data-column-toggle]")],
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  copyResultsButton: document.querySelector("#copyResultsButton"),
  copyDiagnosticsButton: document.querySelector("#copyDiagnosticsButton"),
  copySummaryButton: document.querySelector("#copySummaryButton"),
  copyUrlsButton: document.querySelector("#copyUrlsButton"),
  dedupeLinksInput: document.querySelector("#dedupeLinksInput"),
  diagnosticsBody: document.querySelector("#diagnosticsBody"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  diagnosticsPanel: document.querySelector("#diagnosticsPanel"),
  diagnosticsSummary: document.querySelector("#diagnosticsSummary"),
  downloadDiagnosticsButton: document.querySelector("#downloadDiagnosticsButton"),
  extractionModeInput: document.querySelector("#extractionModeInput"),
  exportButton: document.querySelector("#exportButton"),
  exportSummaryButton: document.querySelector("#exportSummaryButton"),
  filterButton: document.querySelector("#filterButton"),
  filterPanel: document.querySelector("#filterPanel"),
  filterSearchInput: document.querySelector("#filterSearchInput"),
  fileInput: document.querySelector("#fileInput"),
  hideImagesToggle: document.querySelector("#hideImagesToggle"),
  hideLinksToggle: document.querySelector("#hideLinksToggle"),
  hideSkippedToggle: document.querySelector("#hideSkippedToggle"),
  ignoreFooterInput: document.querySelector("#ignoreFooterInput"),
  ignoreNavInput: document.querySelector("#ignoreNavInput"),
  checkExternalLinksInput: document.querySelector("#checkExternalLinksInput"),
  inputLimitCopy: document.querySelector("#inputLimitCopy"),
  inputModeButtons: [...document.querySelectorAll("[data-input-mode]")],
  linkConcurrencyInput: document.querySelector("#linkConcurrencyInput"),
  linkDelayHelp: document.querySelector("#linkDelayHelp"),
  linkDelayInput: document.querySelector("#linkDelayInput"),
  linkDelayLabel: document.querySelector("#linkDelayLabel"),
  loadSourceButton: document.querySelector("#loadSourceButton"),
  maxDiscoveredAssetsInput: document.querySelector("#maxDiscoveredAssetsInput"),
  maxInputUrlsInput: document.querySelector("#maxInputUrlsInput"),
  linksChip: document.querySelector("#linksChip"),
  imagesChip: document.querySelector("#imagesChip"),
  openSettingsInlineButton: document.querySelector("#openSettingsInlineButton"),
  openStoreListingButton: document.querySelector("#openStoreListingButton"),
  openInactiveInput: document.querySelector("#openInactiveInput"),
  only404Button: document.querySelector("#only404Button"),
  pageConcurrencyInput: document.querySelector("#pageConcurrencyInput"),
  pauseRunButton: document.querySelector("#pauseRunButton"),
  pausedSettingsNotice: document.querySelector("#pausedSettingsNotice"),
  presetButtons: [...document.querySelectorAll("[data-preset]")],
  progressControls: document.querySelector("#progressControls"),
  progressWrap: document.querySelector("#progressWrap"),
  progressStep: document.querySelector("#progressStep"),
  progressMainBars: document.querySelector("#progressBars"),
  pagesRow: document.querySelector("#pagesRow"),
  pagesFill: document.querySelector("#pagesFill"),
  pagesCount: document.querySelector("#pagesCount"),
  linksRow: document.querySelector("#linksRow"),
  linksFill: document.querySelector("#linksFill"),
  linksCount: document.querySelector("#linksCount"),
  imagesRow: document.querySelector("#imagesRow"),
  imagesFill: document.querySelector("#imagesFill"),
  imagesCount: document.querySelector("#imagesCount"),
  genericRow: document.querySelector("#genericRow"),
  genericLabel: document.querySelector("#genericLabel"),
  genericFill: document.querySelector("#genericFill"),
  genericCount: document.querySelector("#genericCount"),
  progressBig: document.querySelector("#progressBig"),
  progressBigLabel: document.querySelector("#progressBigLabel"),
  progressEta: document.querySelector("#progressEta"),
  progressQueued: document.querySelector("#progressQueued"),
  resultsBand: document.querySelector("#resultsBand"),
  resultsFullscreenButton: document.querySelector("#resultsFullscreenButton"),
  footerVersionButton: document.querySelector("#footerVersionButton"),
  footerGithubButton: document.querySelector("#footerGithubButton"),
  footerIssueButton: document.querySelector("#footerIssueButton"),
  footerPrivacyButton: document.querySelector("#footerPrivacyButton"),
  footerBackToTop: document.querySelector("#footerBackToTop"),
  floatingBackToTop: document.querySelector("#floatingBackToTop"),
  panelToggles: [...document.querySelectorAll("[data-panel-toggle]")],
  resultsBody: document.querySelector("#resultsBody"),
  resultsPanelBody: document.querySelector("#resultsPanelBody"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  resultsDensityInput: document.querySelector("#resultsDensityInput"),
  renderedConcurrencyInput: document.querySelector("#renderedConcurrencyInput"),
  renderWaitHelp: document.querySelector("#renderWaitHelp"),
  renderWaitInput: document.querySelector("#renderWaitInput"),
  renderWaitLabel: document.querySelector("#renderWaitLabel"),
  retryErrorsButton: document.querySelector("#retryErrorsButton"),
  runButton: document.querySelector("#runButton"),
  saveDefaultsButton: document.querySelector("#saveDefaultsButton"),
  settingsBand: document.querySelector("#settingsBand"),
  settingsButton: document.querySelector("#settingsButton"),
  shareStoreListingButton: document.querySelector("#shareStoreListingButton"),
  appToast: document.querySelector("#appToast"),
  paginationControls: [...document.querySelectorAll("[data-pagination-controls]")],
  paginationLabels: [...document.querySelectorAll("[data-page-label]")],
  paginationPageSizeSelects: [...document.querySelectorAll("[data-page-size-select]")],
  paginationPreviousButtons: [...document.querySelectorAll("[data-page-action='previous']")],
  paginationNextButtons: [...document.querySelectorAll("[data-page-action='next']")],
  paginationShowAllButtons: [...document.querySelectorAll("[data-page-action='show-all']")],
  summaryLine: document.querySelector("#summaryLine"),
  summaryBreakdowns: document.querySelector("#summaryBreakdowns"),
  summaryMetrics: document.querySelector("#summaryMetrics"),
  summaryPanel: document.querySelector("#summaryPanel"),
  summaryPanelBody: document.querySelector("#summaryPanelBody"),
  summaryPanelLine: document.querySelector("#summaryPanelLine"),
  tableShell: document.querySelector("#tableShell"),
  stopRunButton: document.querySelector("#stopRunButton"),
  sourceInputHelp: document.querySelector("#sourceInputHelp"),
  sourceInputPanel: document.querySelector("#sourceInputPanel"),
  sourceStatus: document.querySelector("#sourceStatus"),
  sourceUrlInput: document.querySelector("#sourceUrlInput"),
  themeDarkButton: document.querySelector("#themeDarkButton"),
  themeLightButton: document.querySelector("#themeLightButton"),
  themePreferenceInput: document.querySelector("#themePreferenceInput"),
  timeDisplayUnitInput: document.querySelector("#timeDisplayUnitInput"),
  timeoutHelp: document.querySelector("#timeoutHelp"),
  timeoutInput: document.querySelector("#timeoutInput"),
  timeoutLabel: document.querySelector("#timeoutLabel"),
  useDedicatedRenderWindowInput: document.querySelector("#useDedicatedRenderWindowInput"),
  useBrowserSessionInput: document.querySelector("#useBrowserSessionInput"),
  urlCountStatus: document.querySelector("#urlCountStatus"),
  urlInput: document.querySelector("#urlInput"),
  uploadFileButton: document.querySelector("#uploadFileButton"),
  urlsPanelBody: document.querySelector("#urlsPanelBody"),
  versionLabel: document.querySelector("#versionLabel"),
  updateBanner: document.querySelector("#updateBanner"),
  updateBannerText: document.querySelector("#updateBannerText"),
  updateBannerLink: document.querySelector("#updateBannerLink"),
  updateBannerDismiss: document.querySelector("#updateBannerDismiss"),
  exportConfigButton: document.querySelector("#exportConfigButton"),
  importConfigButton: document.querySelector("#importConfigButton"),
  configFileInput: document.querySelector("#configFileInput"),
  settingsTabButtons: [...document.querySelectorAll(".settings-tab")],
  settingsTabPanels: [...document.querySelectorAll("section[data-settings-tab]")],
  copyAiSummaryButton: document.querySelector("#copyAiSummaryButton"),
  openGithubButton: document.querySelector("#openGithubButton"),
  reportIssueButton: document.querySelector("#reportIssueButton"),
  rateExtensionButton: document.querySelector("#rateExtensionButton")
};

const SUMMARY_PLACEHOLDER_METRICS = [
  { label: "Items", detail: "All results" },
  { label: "Pages", detail: "Page URLs in crawl" },
  { label: "Links", detail: "Discovered links" },
  { label: "Images", detail: "Discovered images" },
  { label: "Status issues", detail: "Non-200 status or errors" },
  { label: "404s", detail: "Not found items" },
  { label: "Redirects", detail: "Items with redirects" },
  { label: "Skipped", detail: "Not checked by filters or stop" }
];
const SUMMARY_PLACEHOLDER_BREAKDOWNS = [
  { title: "Asset type", items: [{ label: "Pages", tone: "page" }, { label: "Links", tone: "link" }, { label: "Images", tone: "image" }] },
  { title: "Status", items: [{ label: "2xx", tone: "success" }, { label: "3xx", tone: "warning" }, { label: "4xx", tone: "danger" }, { label: "5xx", tone: "danger" }, { label: "Errors", tone: "danger" }, { label: "Skipped", tone: "muted" }] },
  { title: "Page issues", items: [{ label: "Missing title", tone: "page" }, { label: "Missing description", tone: "page" }, { label: "Missing H1", tone: "page" }, { label: "Missing canonical", tone: "page" }, { label: "Canonicalized", tone: "page" }, { label: "Noindex", tone: "page" }] },
  { title: "Asset issues", items: [{ label: "Non-200 links", tone: "link" }, { label: "Non-200 images", tone: "image" }, { label: "Missing image alt", tone: "image" }, { label: "Skipped assets", tone: "muted" }] }
];

init();

function scrollAppToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBackToTopVisibility() {
  if (!elements.floatingBackToTop) {
    return;
  }
  const scrolled = (window.scrollY || document.documentElement.scrollTop || 0) > 480;
  elements.floatingBackToTop.hidden = !scrolled || state.resultsFullscreen;
}

function bindFooter() {
  const openIf = (url) => () => { if (url) { openExternalUrl(url); } };
  elements.footerVersionButton.addEventListener("click", openIf(CHANGELOG_URL || GITHUB_REPO_URL));
  elements.footerGithubButton.addEventListener("click", openIf(GITHUB_REPO_URL));
  elements.footerIssueButton.addEventListener("click", openIf(GITHUB_ISSUES_URL));
  elements.footerPrivacyButton.addEventListener("click", openIf(PRIVACY_URL));
  elements.footerBackToTop.addEventListener("click", scrollAppToTop);
  elements.floatingBackToTop.addEventListener("click", scrollAppToTop);
  window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
  updateBackToTopVisibility();
}

function setResultsFullscreen(on) {
  state.resultsFullscreen = Boolean(on);
  document.body.classList.toggle("results-maximized", state.resultsFullscreen);
  elements.resultsBand.classList.toggle("is-maximized", state.resultsFullscreen);
  updateBackToTopVisibility();
  const button = elements.resultsFullscreenButton;
  if (button) {
    const label = state.resultsFullscreen ? "Exit full screen" : "Expand results to full screen";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function init() {
  applyTheme(localStorage.getItem("bulkstatus-theme") || defaultTheme());
  updateVersionLabel();

  loadSettings();
  applyColumnVisibility();
  bindSettings();
  elements.runButton.addEventListener("click", runChecks);
  elements.clearButton.addEventListener("click", clearAll);
  elements.urlInput.addEventListener("input", () => {
    state.inputTextByMode[state.inputMode] = elements.urlInput.value;
    state.inputCountNoteByMode[state.inputMode] = "";
    updateInputUrlCount();
    setControls();
  });
  elements.copyUrlsButton.addEventListener("click", copyUrls);
  elements.copySummaryButton.addEventListener("click", copySummary);
  elements.copyResultsButton.addEventListener("click", copyResults);
  elements.copyDiagnosticsButton.addEventListener("click", copyDiagnostics);
  elements.downloadDiagnosticsButton.addEventListener("click", downloadDiagnostics);
  bindPanelToggles();
  elements.filterButton.addEventListener("click", toggleFilterPanel);
  elements.clearFiltersButton.addEventListener("click", clearResultFilters);
  elements.filterSearchInput.addEventListener("input", () => {
    state.filters.search = elements.filterSearchInput.value;
    resetResultsPagination();
    renderResults();
  });
  elements.filterPanel.addEventListener("change", handleFilterChange);
  elements.linksChip.addEventListener("click", () => toggleBooleanSettingFromChip("checkLinks"));
  elements.imagesChip.addEventListener("click", () => toggleBooleanSettingFromChip("checkImages"));
  elements.openSettingsInlineButton.addEventListener("click", openSettings);
  elements.openStoreListingButton.addEventListener("click", openStoreListing);
  elements.shareStoreListingButton.addEventListener("click", shareStoreListing);
  elements.exportButton.addEventListener("click", exportCsv);
  elements.exportSummaryButton.addEventListener("click", exportSummaryCsv);
  elements.fileInput.addEventListener("change", handleFileUpload);
  elements.sourceUrlInput.addEventListener("click", () => {
    if (state.inputMode === "list" && !elements.fileInput.disabled) {
      elements.fileInput.click();
    }
  });
  elements.inputModeButtons.forEach((button) => {
    button.addEventListener("click", () => setInputMode(button.dataset.inputMode));
  });
  elements.loadSourceButton.addEventListener("click", loadInputSource);
  elements.pauseRunButton.addEventListener("click", toggleRunPause);
  elements.retryErrorsButton.addEventListener("click", retryErrorResults);
  elements.stopRunButton.addEventListener("click", stopRun);
  elements.resultsFullscreenButton.addEventListener("click", () => setResultsFullscreen(!state.resultsFullscreen));
  bindFooter();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.resultsFullscreen) {
      setResultsFullscreen(false);
    }
  });
  elements.sourceUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadInputSource();
    }
  });
  elements.only404Button.addEventListener("click", () => {
    state.only404 = !state.only404;
    resetResultsPagination();
    renderResults();
  });
  elements.hideSkippedToggle.addEventListener("change", () => {
    state.hideSkipped = elements.hideSkippedToggle.checked;
    resetResultsPagination();
    renderResults();
  });
  elements.hideLinksToggle.addEventListener("change", () => {
    state.hideLinks = elements.hideLinksToggle.checked;
    resetResultsPagination();
    renderResults();
  });
  elements.hideImagesToggle.addEventListener("change", () => {
    state.hideImages = elements.hideImagesToggle.checked;
    resetResultsPagination();
    renderResults();
  });
  elements.settingsButton.addEventListener("click", toggleSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.resetSettingsButton.addEventListener("click", resetSettings);
  elements.saveDefaultsButton.addEventListener("click", saveCurrentSettingsAsDefault);
  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });
  bindPaginationControls();
  elements.themeLightButton.addEventListener("click", () => setTheme("light"));
  elements.themeDarkButton.addEventListener("click", () => setTheme("dark"));
  elements.themePreferenceInput.addEventListener("change", () => setTheme(elements.themePreferenceInput.value));
  bindSortableHeaders();
  bindUpdateNotice();
  bindConfigTransfer();
  bindVersionLink();
  bindSettingsTabs();
  bindAppLinks();
  elements.copyAiSummaryButton.addEventListener("click", copyAiSummaryPrompt);
  renderPanelStates();
  renderInputMode();
  renderDiagnostics();
  renderSummaryPanel();
  renderResults();
  renderProgress();
  maybeShowUpdateBanner();
}

function bindPaginationControls() {
  elements.paginationPreviousButtons.forEach((button) => {
    button.addEventListener("click", () => changeResultsPage(-1));
  });
  elements.paginationNextButtons.forEach((button) => {
    button.addEventListener("click", () => changeResultsPage(1));
  });
  elements.paginationShowAllButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.showAll = !state.showAll;
      if (!state.showAll) {
        state.resultsPage = 1;
      }
      state.resetResultsScroll = true;
      renderResults();
    });
  });
  elements.paginationPageSizeSelects.forEach((select) => {
    select.addEventListener("change", () => {
      state.resultsPageSize = clampPageSize(select.value);
      state.resultsPage = 1;
      state.showAll = false;
      state.resetResultsScroll = true;
      renderResults();
    });
  });
}

function clampPageSize(value) {
  const number = Number(value);
  return RESULTS_PAGE_SIZE_OPTIONS.includes(number) ? number : PREVIEW_LIMIT;
}

function changeResultsPage(delta) {
  if (state.showAll) {
    return;
  }

  const pagination = currentPagination();
  state.resultsPage = Math.min(
    pagination.totalPages,
    Math.max(1, pagination.currentPage + delta)
  );
  state.resetResultsScroll = true;
  renderResults();
}

function resetResultsPagination(options = {}) {
  state.resultsPage = 1;
  state.resetResultsScroll = true;
  if (options.collapseShowAll) {
    state.showAll = false;
  }
}

function maybeResetResultsScroll() {
  if (!state.resetResultsScroll) {
    return;
  }

  state.resetResultsScroll = false;
  if (elements.tableShell) {
    elements.tableShell.scrollTop = 0;
  }
}

function bindPanelToggles() {
  elements.panelToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panelToggle;
      state.panelCollapsed[panel] = !state.panelCollapsed[panel];
      renderPanelStates();
    });
  });
}

function setKeepAwake(on) {
  try {
    if (typeof chrome !== "undefined" && chrome.power) {
      if (on) {
        chrome.power.requestKeepAwake("system");
      } else {
        chrome.power.releaseKeepAwake();
      }
    }
  } catch (error) {
    // Power API unavailable; ignore.
  }
}

function renderPanelStates() {
  const panels = {
    urls: { body: elements.urlsPanelBody, label: "Inputs" },
    summary: { body: elements.summaryPanelBody, label: "Summary" },
    results: { body: elements.resultsPanelBody, label: "Results" },
    diagnostics: { body: elements.diagnosticsBody, label: "Diagnostics" }
  };

  elements.panelToggles.forEach((button) => {
    const panel = button.dataset.panelToggle;
    const config = panels[panel];
    if (!config) {
      return;
    }

    const collapsed = Boolean(state.panelCollapsed[panel]);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${config.label}`);
    button.title = `${collapsed ? "Expand" : "Collapse"} ${config.label}`;
    if (config.body) {
      config.body.hidden = collapsed;
    }
  });
}

function setInputMode(mode) {
  const nextMode = normalizeInputMode(mode);
  if (nextMode === state.inputMode) {
    return;
  }

  saveCurrentInputModeText();
  state.inputMode = nextMode;
  localStorage.setItem("bulkstatus-input-mode", nextMode);
  renderInputMode();
}

function normalizeInputMode(mode) {
  return ["list", "sitemap", "llms"].includes(mode) ? mode : "list";
}

function saveCurrentInputModeText() {
  state.inputTextByMode[state.inputMode] = elements.urlInput.value;
  if (state.inputMode !== "list") {
    state.sourceUrlByMode[state.inputMode] = elements.sourceUrlInput.value;
  }
}

function renderInputMode() {
  state.inputMode = normalizeInputMode(state.inputMode);
  const sourceMode = state.inputMode !== "list";
  const labels = {
    list: {
      label: "URL list",
      help: urlListHelpText(),
      placeholder: `Click to upload a .txt or .csv (no header row needed, one URL per line. Row limit of ${formatNumber(state.settings.maxInputUrls)} lines, adjustable in Settings).`,
      textarea: "https://example.com\nexample.com/pricing\nhttps://example.com/blog"
    },
    sitemap: {
      label: "XML sitemap URL",
      help: "",
      placeholder: "https://example.com/sitemap.xml",
      textarea: "Fetched XML sitemap URLs will appear here after you click Fetch URLs."
    },
    llms: {
      label: "llms.txt URL",
      help: "",
      placeholder: "https://example.com/llms.txt",
      textarea: "Fetched llms.txt URLs will appear here after you click Fetch URLs."
    }
  };

  elements.inputModeButtons.forEach((button) => {
    const active = button.dataset.inputMode === state.inputMode;
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("tabindex", active ? "0" : "-1");
  });

  elements.sourceInputPanel.hidden = false;
  elements.urlsPanelBody.classList.toggle("is-list-mode", !sourceMode);
  elements.urlsPanelBody.classList.toggle("is-source-mode", sourceMode);
  elements.sourceInputPanel.classList.toggle("is-list-mode", !sourceMode);
  elements.uploadFileButton.hidden = sourceMode;
  elements.loadSourceButton.hidden = !sourceMode;
  elements.urlInput.readOnly = sourceMode;
  elements.urlInput.value = state.inputTextByMode[state.inputMode] || "";

  const config = labels[state.inputMode];
  elements.sourceInputHelp.textContent = inputModeHelpText(state.inputMode);
  elements.sourceUrlInput.placeholder = config.placeholder;
  elements.sourceUrlInput.readOnly = !sourceMode;
  elements.sourceUrlInput.classList.toggle("is-upload-trigger", !sourceMode);
  elements.urlInput.placeholder = config.textarea;

  if (sourceMode) {
    elements.sourceUrlInput.value = state.sourceUrlByMode[state.inputMode] || "";
  } else {
    elements.sourceUrlInput.value = "";
  }

  updateInputUrlCount();
  setControls();
}

function appManifest() {
  try {
    return chrome.runtime.getManifest();
  } catch (_error) {
    return { name: "BulkStatus - Bulk URL Checker", version: "dev", manifest_version: 3 };
  }
}

function updateVersionLabel() {
  const manifest = appManifest();
  elements.versionLabel.textContent = `Version ${manifest.version || "dev"}`;
  elements.versionLabel.title = `${manifest.name || "BulkStatus"} ${manifest.version || "dev"}`;
  if (elements.footerVersionButton) {
    elements.footerVersionButton.textContent = `BulkStatus v${manifest.version || "dev"}`;
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("bulkstatus-settings") || "{}");
    state.settings = Object.keys(saved).length
      ? normalizeSettings(migrateSettings(saved))
      : getDefaultSettings();
  } catch (_error) {
    state.settings = getDefaultSettings();
  }

  elements.checkLinksInput.checked = state.settings.checkLinks;
  elements.checkImagesInput.checked = state.settings.checkImages;
  elements.collapseResponsiveImagesInput.checked = state.settings.collapseResponsiveImages;
  elements.dedupeLinksInput.checked = state.settings.dedupeLinks;
  elements.autoRetryErrorsInput.checked = state.settings.autoRetryErrors;
  elements.keepAwakeInput.checked = state.settings.keepAwake;
  elements.ignoreNavInput.checked = !state.settings.ignoreNav;
  elements.ignoreFooterInput.checked = !state.settings.ignoreFooter;
  elements.checkExternalLinksInput.checked = state.settings.checkExternalLinks;
  elements.extractionModeInput.checked = state.settings.extractionMode === "rendered";
  elements.renderedConcurrencyInput.value = formatNumber(state.settings.renderedConcurrency);
  elements.renderWaitInput.value = formatRenderWaitInputValue(state.settings.renderWaitMs);
  elements.openInactiveInput.checked = state.settings.openInactive;
  elements.useDedicatedRenderWindowInput.checked = state.settings.useDedicatedRenderWindow;
  elements.useBrowserSessionInput.checked = state.settings.useBrowserSessionForRenderedChecks;
  elements.closeRenderedTabsInput.checked = state.settings.closeRenderedTabs;
  elements.timeDisplayUnitInput.value = state.settings.timeDisplayUnit;
  elements.resultsDensityInput.checked = state.settings.resultsDensity === "dense";
  elements.columnToggles.forEach((input) => {
    input.checked = state.settings.visibleColumns[input.dataset.columnToggle] !== false;
  });
  applyResultsDensity();
  formatNumericInputs();
  updateExtractionModeUi();
  updateModeHint();
  updateInputLimitCopy();
}

function migrateSettings(saved) {
  const settings = saved || {};
  const version = Number(settings.settingsVersion || 0);
  const migrated = {
    ...DEFAULT_SETTINGS,
    ...settings,
    settingsVersion: SETTINGS_VERSION,
    ignoreNav: settings.ignoreNav ?? DEFAULT_SETTINGS.ignoreNav,
    ignoreFooter: settings.ignoreFooter ?? DEFAULT_SETTINGS.ignoreFooter
  };

  const savedLimit = clampNumber(settings.maxInputUrls, 1, MAX_INPUT_URL_LIMIT, LEGACY_DEFAULT_INPUT_URL_LIMIT);
  if (version < 3 && savedLimit === LEGACY_DEFAULT_INPUT_URL_LIMIT) {
    migrated.maxInputUrls = DEFAULT_SETTINGS.maxInputUrls;
  }
  if (version < 4 && settings.extractionMode === "static" && settings.checkImages === false && settings.checkLinks === false) {
    migrated.extractionMode = DEFAULT_SETTINGS.extractionMode;
    migrated.checkImages = DEFAULT_SETTINGS.checkImages;
    migrated.checkLinks = DEFAULT_SETTINGS.checkLinks;
  }
  if (version < 6) {
    migrated.useDedicatedRenderWindow = DEFAULT_SETTINGS.useDedicatedRenderWindow;
    migrated.useBrowserSessionForRenderedChecks = DEFAULT_SETTINGS.useBrowserSessionForRenderedChecks;
  }
  if (version < 9 && clampNumber(settings.renderWaitMs, 0, MAX_RENDER_WAIT_MS, 3000) === 3000) {
    migrated.renderWaitMs = DEFAULT_SETTINGS.renderWaitMs;
  }

  return migrated;
}

function bindSettings() {
  [
    elements.checkLinksInput,
    elements.checkImagesInput,
    elements.collapseResponsiveImagesInput,
    elements.dedupeLinksInput,
    elements.autoRetryErrorsInput,
    elements.keepAwakeInput,
    elements.ignoreNavInput,
    elements.checkExternalLinksInput,
    elements.ignoreFooterInput,
    elements.extractionModeInput,
    elements.pageConcurrencyInput,
    elements.renderedConcurrencyInput,
    elements.renderWaitInput,
    elements.openInactiveInput,
    elements.useDedicatedRenderWindowInput,
    elements.useBrowserSessionInput,
    elements.closeRenderedTabsInput,
    elements.linkConcurrencyInput,
    elements.timeoutInput,
    elements.linkDelayInput,
    elements.maxInputUrlsInput,
    elements.maxDiscoveredAssetsInput,
    elements.resultsDensityInput
  ].forEach((input) => input.addEventListener("change", saveSettingsFromInputs));
  elements.timeDisplayUnitInput.addEventListener("change", () => {
    saveSettingsFromInputs({
      renderWaitMsOverride: state.settings.renderWaitMs,
      timeoutMsOverride: state.settings.timeoutMs,
      linkDelayMsOverride: state.settings.linkDelayMs
    });
  });
  elements.extractionModeInput.addEventListener("change", updateExtractionModeUi);
  elements.columnToggles.forEach((input) => input.addEventListener("change", saveSettingsFromInputs));
}

function saveSettingsFromInputs(options = {}) {
  const visibleColumns = {};
  elements.columnToggles.forEach((input) => {
    visibleColumns[input.dataset.columnToggle] = input.checked;
  });
  const timeDisplayUnit = elements.timeDisplayUnitInput.value;
  const renderWaitMs = options.renderWaitMsOverride ?? parseTimeSettingInput(elements.renderWaitInput.value, timeDisplayUnit, DEFAULT_SETTINGS.renderWaitMs);
  const timeoutMs = options.timeoutMsOverride ?? parseTimeSettingInput(elements.timeoutInput.value, timeDisplayUnit, DEFAULT_SETTINGS.timeoutMs);
  const linkDelayMs = options.linkDelayMsOverride ?? parseTimeSettingInput(elements.linkDelayInput.value, timeDisplayUnit, DEFAULT_SETTINGS.linkDelayMs);
  state.settings = normalizeSettings({
    checkLinks: elements.checkLinksInput.checked,
    checkImages: elements.checkImagesInput.checked,
    collapseResponsiveImages: elements.collapseResponsiveImagesInput.checked,
    dedupeLinks: elements.dedupeLinksInput.checked,
    autoRetryErrors: elements.autoRetryErrorsInput.checked,
    keepAwake: elements.keepAwakeInput.checked,
    ignoreNav: !elements.ignoreNavInput.checked,
    ignoreFooter: !elements.ignoreFooterInput.checked,
    checkExternalLinks: elements.checkExternalLinksInput.checked,
    extractionMode: elements.extractionModeInput.checked ? "rendered" : "static",
    pageConcurrency: elements.pageConcurrencyInput.value,
    renderedConcurrency: elements.renderedConcurrencyInput.value,
    renderWaitMs,
    openInactive: elements.openInactiveInput.checked,
    useDedicatedRenderWindow: elements.useDedicatedRenderWindowInput.checked,
    useBrowserSessionForRenderedChecks: elements.useBrowserSessionInput.checked,
    closeRenderedTabs: elements.closeRenderedTabsInput.checked,
    linkConcurrency: elements.linkConcurrencyInput.value,
    timeoutMs,
    timeDisplayUnit,
    resultsDensity: elements.resultsDensityInput.checked ? "dense" : "comfortable",
    linkDelayMs,
    maxInputUrls: elements.maxInputUrlsInput.value,
    maxDiscoveredAssets: elements.maxDiscoveredAssetsInput.value,
    visibleColumns,
    settingsVersion: SETTINGS_VERSION
  });
  localStorage.setItem("bulkstatus-settings", JSON.stringify(state.settings));
  state.activePreset = "";
  state.settingsBeforePreset = null;
  updatePresetButtons();
  formatNumericInputs();
  applyResultsDensity();
  applyColumnVisibility();
  updateExtractionModeUi();
  updateModeHint();
  updateInputLimitCopy();
  refreshCurrentPhaseConcurrency();
  if (state.running) {
    updateProgress(state.completedWork, state.totalWork);
  }
  setControls();
  renderResults();
  renderDiagnostics();
}

function normalizeSettings(settings) {
  return {
    checkLinks: Boolean(settings.checkLinks),
    checkImages: Boolean(settings.checkImages),
    collapseResponsiveImages: settings.collapseResponsiveImages !== false,
    dedupeLinks: Boolean(settings.dedupeLinks),
    autoRetryErrors: settings.autoRetryErrors !== false,
    keepAwake: settings.keepAwake !== false,
    ignoreNav: Boolean(settings.ignoreNav),
    ignoreFooter: Boolean(settings.ignoreFooter),
    checkExternalLinks: settings.checkExternalLinks !== false,
    diagnosticMode: true,
    extractionMode: settings.extractionMode === "rendered" ? "rendered" : "static",
    pageConcurrency: clampNumber(settings.pageConcurrency, 1, 12, DEFAULT_SETTINGS.pageConcurrency),
    renderedConcurrency: clampNumber(settings.renderedConcurrency, 1, 3, DEFAULT_SETTINGS.renderedConcurrency),
    renderWaitMs: clampNumber(settings.renderWaitMs, 0, MAX_RENDER_WAIT_MS, DEFAULT_SETTINGS.renderWaitMs),
    openInactive: settings.openInactive !== false,
    useDedicatedRenderWindow: settings.useDedicatedRenderWindow === true,
    useBrowserSessionForRenderedChecks: settings.useBrowserSessionForRenderedChecks !== false,
    closeRenderedTabs: settings.closeRenderedTabs !== false,
    linkConcurrency: clampNumber(settings.linkConcurrency, 1, 16, DEFAULT_SETTINGS.linkConcurrency),
    timeoutMs: clampNumber(settings.timeoutMs, 1000, 300000, DEFAULT_SETTINGS.timeoutMs),
    timeDisplayUnit: settings.timeDisplayUnit === "milliseconds" ? "milliseconds" : "seconds",
    resultsDensity: ["comfortable", "dense"].includes(settings.resultsDensity) ? settings.resultsDensity : DEFAULT_SETTINGS.resultsDensity,
    linkDelayMs: clampNumber(settings.linkDelayMs, 0, 10000, DEFAULT_SETTINGS.linkDelayMs),
    maxInputUrls: clampNumber(settings.maxInputUrls, 1, MAX_INPUT_URL_LIMIT, DEFAULT_SETTINGS.maxInputUrls),
    maxDiscoveredAssets: clampNumber(settings.maxDiscoveredAssets, 1, MAX_DISCOVERED_ASSET_LIMIT, DEFAULT_SETTINGS.maxDiscoveredAssets),
    visibleColumns: {
      ...DEFAULT_SETTINGS.visibleColumns,
      ...(settings.visibleColumns || {})
    },
    settingsVersion: SETTINGS_VERSION
  };
}

function getDefaultSettings() {
  try {
    const savedDefault = JSON.parse(localStorage.getItem("bulkstatus-default-settings") || "{}");
    return Object.keys(savedDefault).length
      ? normalizeSettings(migrateSettings(savedDefault))
      : normalizeSettings(DEFAULT_SETTINGS);
  } catch (_error) {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function formatNumericInputs() {
  elements.pageConcurrencyInput.value = formatNumber(state.settings.pageConcurrency);
  elements.renderedConcurrencyInput.value = formatNumber(state.settings.renderedConcurrency);
  elements.renderWaitInput.value = formatRenderWaitInputValue(state.settings.renderWaitMs);
  elements.linkConcurrencyInput.value = formatNumber(state.settings.linkConcurrency);
  elements.timeoutInput.value = formatTimeSettingInputValue(state.settings.timeoutMs);
  elements.linkDelayInput.value = formatTimeSettingInputValue(state.settings.linkDelayMs);
  elements.maxInputUrlsInput.value = formatNumber(state.settings.maxInputUrls);
  elements.maxDiscoveredAssetsInput.value = formatNumber(state.settings.maxDiscoveredAssets);
  updateRenderWaitCopy();
}

function parseTimeSettingInput(value, unit, fallback) {
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.round(unit === "milliseconds" ? number : number * 1000);
}

function formatRenderWaitInputValue(milliseconds) {
  return formatTimeSettingInputValue(milliseconds);
}

function formatTimeSettingInputValue(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) {
    return "";
  }

  if (state.settings.timeDisplayUnit === "milliseconds") {
    return formatNumber(value);
  }

  const seconds = value / 1000;
  return seconds.toLocaleString("en-US", {
    maximumFractionDigits: seconds < 10 ? 2 : 1
  });
}

function updateRenderWaitCopy() {
  const milliseconds = state.settings.timeDisplayUnit === "milliseconds";
  elements.renderWaitLabel.textContent = milliseconds ? "Render wait max ms" : "Render wait max sec";
  elements.renderWaitHelp.textContent = milliseconds
    ? `Maximum milliseconds after page load while waiting for rendered DOM stability. Supports up to ${formatNumber(MAX_RENDER_WAIT_MS)} ms.`
    : `Maximum seconds after page load while waiting for rendered DOM stability. Supports up to ${formatNumber(MAX_RENDER_WAIT_MS / 1000)} seconds.`;
  elements.timeoutLabel.textContent = milliseconds ? "Timeout ms" : "Timeout sec";
  elements.timeoutHelp.textContent = milliseconds
    ? "Applies to page, link, and image requests. Supports 1,000-300,000 ms."
    : "Applies to page, link, and image requests. Supports 1-300 seconds.";
  elements.linkDelayLabel.textContent = milliseconds ? "Delay per asset ms" : "Delay per asset sec";
  elements.linkDelayHelp.textContent = milliseconds
    ? "Pause before checking each discovered link/image. Supports up to 10,000 ms."
    : "Pause before checking each discovered link/image. Supports up to 10 seconds.";
}

function updateInputLimitCopy() {
  elements.sourceInputHelp.textContent = inputModeHelpText(state.inputMode);
}

function urlListHelpText() {
  return "Add URLs by uploading a TXT/CSV file, or type them in the box below.";
}

function inputModeHelpText(mode) {
  const limit = formatNumber(state.settings.maxInputUrls);

  if (mode === "sitemap") {
    return `Fetches the sitemap, follows sitemap indexes, and extracts page URLs. Current input URL limit: ${limit}. Adjust in Settings.`;
  }

  if (mode === "llms") {
    return `Fetches llms.txt and extracts Markdown links and bare URLs. Current input URL limit: ${limit}. Adjust in Settings.`;
  }

  return urlListHelpText();
}

function updateExtractionModeUi() {
  const rendered = elements.extractionModeInput.checked;
  document.querySelectorAll(".rendered-setting").forEach((element) => {
    element.hidden = !rendered;
  });
  elements.pageConcurrencyInput.closest(".number-field").hidden = rendered;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function updateModeHint() {
  elements.linksChip.setAttribute("aria-pressed", String(state.settings.checkLinks));
  elements.imagesChip.setAttribute("aria-pressed", String(state.settings.checkImages));
}

function extractionModeLabel() {
  return state.settings.extractionMode === "rendered"
    ? "JavaScript rendering"
    : "HTML fetch with JavaScript disabled";
}

function inputModeLabel() {
  if (state.inputMode === "sitemap") {
    return "XML sitemap";
  }

  if (state.inputMode === "llms") {
    return "llms.txt";
  }

  return "URL list";
}

function currentInputSourceUrl() {
  return state.inputMode === "list"
    ? ""
    : state.sourceUrlByMode[state.inputMode] || elements.sourceUrlInput.value;
}

function toggleModeFromChip() {
  if (state.running) {
    return;
  }

  elements.extractionModeInput.value = state.settings.extractionMode === "rendered" ? "static" : "rendered";
  saveSettingsFromInputs();
}

function toggleBooleanSettingFromChip(key) {
  if (state.running) {
    return;
  }

  const inputByKey = {
    checkLinks: elements.checkLinksInput,
    checkImages: elements.checkImagesInput,
    ignoreNav: elements.ignoreNavInput,
    ignoreFooter: elements.ignoreFooterInput
  };
  const input = inputByKey[key];
  if (!input) {
    return;
  }

  input.checked = !input.checked;
  saveSettingsFromInputs();
}

function onOff(value) {
  return value ? "on" : "off";
}

function isColumnVisible(column) {
  return ALWAYS_VISIBLE_COLUMNS.has(column) || state.settings.visibleColumns[column] !== false;
}

function applyColumnVisibility() {
  document.querySelectorAll("[data-column]").forEach((element) => {
    const column = element.dataset.column;
    element.hidden = !isColumnVisible(column);
  });
}

function applyResultsDensity() {
  document.documentElement.dataset.resultsDensity = state.settings.resultsDensity || DEFAULT_SETTINGS.resultsDensity;
}

function bindSortableHeaders() {
  document.querySelectorAll("th[data-sort-column]").forEach((header) => {
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.title = "Sort results";
    header.addEventListener("click", () => toggleSort(header.dataset.sortColumn));
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSort(header.dataset.sortColumn);
      }
    });
  });
  updateSortHeaders();
}

function toggleSort(column) {
  if (!column) {
    return;
  }

  if (state.sortColumn === column) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortColumn = column;
    state.sortDirection = "asc";
  }

  resetResultsPagination();
  renderResults();
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort-column]").forEach((header) => {
    const active = header.dataset.sortColumn === state.sortColumn;
    header.dataset.sortDirection = active ? state.sortDirection : "";
    header.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
}

function currentPageConcurrency() {
  return state.settings.extractionMode === "rendered"
    ? state.settings.renderedConcurrency
    : state.settings.pageConcurrency;
}

function currentPageConcurrencyMax() {
  return state.settings.extractionMode === "rendered" ? 3 : 12;
}

function currentAssetConcurrency() {
  return state.settings.linkConcurrency;
}

function refreshCurrentPhaseConcurrency() {
  if (!state.running || !state.currentPhase) {
    return;
  }

  if (/asset/i.test(state.currentPhase)) {
    state.currentPhase = state.currentPhase.replace(/with concurrency [\d,]+/i, `with concurrency ${formatMaybeNumber(currentAssetConcurrency())}`);
    return;
  }

  if (/page/i.test(state.currentPhase)) {
    state.currentPhase = state.currentPhase.replace(/with concurrency [\d,]+/i, `with concurrency ${formatMaybeNumber(currentPageConcurrency())}`);
  }
}

async function runChecks() {
  saveSettingsFromInputs();
  saveCurrentInputModeText();
  const parsedInput = parseUrls(elements.urlInput.value, state.settings.maxInputUrls);
  const urls = parsedInput.urls;

  if (!urls.length) {
    setStatus(state.inputMode === "list" ? "Paste at least one URL to run a check." : "Fetch URLs before running a check.");
    return;
  }

  if (parsedInput.truncatedCount > 0) {
    window.alert(`You entered ${formatMaybeNumber(parsedInput.uniqueCount)} unique URLs. BulkStatus will check the first ${formatMaybeNumber(parsedInput.limit)} based on your current input URL limit.`);
  }

  const hostAccessAllowed = await ensureHostPermission();
  if (!hostAccessAllowed) {
    const detail = hostPermissionError ? `\n\n${hostPermissionError}` : "";
    window.alert(`BulkStatus needs site access to fetch the URLs you asked it to check. The run was not started.${detail}`);
    return;
  }

  if (state.settings.extractionMode === "rendered") {
    const allowed = await ensureRenderedPermission();
    if (!allowed) {
      const detail = renderedPermissionError ? `\n\n${renderedPermissionError}` : "";
      window.alert(`Rendered JavaScript mode needs scripting permission to collect the rendered DOM. The run was not started.${detail}`);
      return;
    }
  }

  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.pauseResolvers = [];
  state.activeFetchControllers.clear();
  state.activeRenderedTabIds.clear();
  state.authFailureHosts.clear();
  state.authPauseHosts.clear();
  state.pauseReason = "";
  state.runStartedAt = performance.now();
  state.completedWork = 0;
  state.totalWork = urls.length;
  state.currentPhase = "Preparing run";
  state.runStage = "";
  state.progress = {
    pages: { done: 0, total: urls.length },
    links: { done: 0, total: 0, enabled: state.settings.checkLinks, discovered: false },
    images: { done: 0, total: 0, enabled: state.settings.checkImages, discovered: false }
  };
  state.lastRunDurationMs = 0;
  state.runDiagnostics = [];
  state.summaryShown = false;
  state.panelCollapsed.summary = false;
  state.panelCollapsed.diagnostics = false;
  state.only404 = false;
  clearResultFilters(false);
  resetResultsPagination({ collapseShowAll: true });
  addEnvironmentDiagnostic();
  addRunDiagnostic("Run started", `${urls.length} page URL${urls.length === 1 ? "" : "s"}; input ${inputModeLabel()}; mode ${extractionModeLabel()}; links ${onOff(state.settings.checkLinks)}; images ${onOff(state.settings.checkImages)}; responsive image collapse ${onOff(state.settings.collapseResponsiveImages)}; browser session ${onOff(state.settings.useBrowserSessionForRenderedChecks)}; dedicated render window ${onOff(state.settings.useDedicatedRenderWindow)}; auto retry errors ${onOff(state.settings.autoRetryErrors)}; keep awake ${onOff(state.settings.keepAwake)}; time display ${state.settings.timeDisplayUnit}; results density ${state.settings.resultsDensity}`);
  if (parsedInput.truncatedCount > 0) {
    addRunDiagnostic("Input URL limit", `${formatMaybeNumber(parsedInput.truncatedCount)} input URL${parsedInput.truncatedCount === 1 ? "" : "s"} were not checked because the current input URL limit is ${formatMaybeNumber(parsedInput.limit)}.`);
  }
  state.rows = urls.map((url, index) => ({ ...pendingPageRow(url), groupId: pageGroupId(index) }));
  setControls();
  renderDiagnostics();
  updateProgress(state.completedWork, state.totalWork);
  renderResults();

  setKeepAwake(state.settings.keepAwake);
  let completedNormally = false;
  let runError = "";
  try {
    const assetJobs = [];
    const pageConcurrency = currentPageConcurrency();
    state.runStage = "pages";
    setRunPhase(`Checking pages with concurrency ${pageConcurrency}`);
    await runWithConcurrency(urls, currentPageConcurrency, async (url, index) => {
      markPageRowChecking(index);
      const result = await checkPage(url);
      const previousRow = state.rows[index];
      result.row.groupId = pageGroupId(index);
      result.row.expanded = Boolean(previousRow?.expanded);
      state.rows[index] = result.row;
      assetJobs.push(...result.assetJobs.map((job) => ({ ...job, groupId: result.row.groupId })));
      state.completedWork += 1;
      state.progress.pages.done += 1;
      updateProgress(state.completedWork, state.totalWork);
      scheduleResultsRender();
      maybePauseForAuthWall(result.row);
    }, { maxLimit: currentPageConcurrencyMax() });

    if (state.stopRequested && assetJobs.length) {
      addUnprocessedAssetRows(assetJobs, "Not checked: run stopped before asset check");
    }

    if (!state.stopRequested) {
      addRunDiagnostic("Page phase complete", `${assetJobs.length} discovered asset candidate${assetJobs.length === 1 ? "" : "s"} collected.`);
    }

    if (!state.stopRequested && assetJobs.length) {
      await runAssetChecks(assetJobs);
    }

    completedNormally = !state.stopRequested;
  } catch (error) {
    runError = error.message || String(error);
    addRunDiagnostic("Run error", runError);
  } finally {
    await finishRun(completedNormally, runError);
    setKeepAwake(false);
  }

  if (completedNormally && !runError && state.settings.autoRetryErrors) {
    await retryErrorResults({ automatic: true });
  }
}

async function retryErrorResults(options = {}) {
  if (state.running) {
    return;
  }

  const automatic = options.automatic === true;
  saveSettingsFromInputs();
  const retryEntries = retryableErrorEntries();
  if (!retryEntries.length) {
    return;
  }

  const hostAccessAllowed = await ensureHostPermission();
  if (!hostAccessAllowed) {
    const detail = hostPermissionError ? `\n\n${hostPermissionError}` : "";
    window.alert(`BulkStatus needs site access to retry error rows. The retry was not started.${detail}`);
    return;
  }

  if (state.settings.extractionMode === "rendered") {
    const allowed = await ensureRenderedPermission();
    if (!allowed) {
      const detail = renderedPermissionError ? `\n\n${renderedPermissionError}` : "";
      window.alert(`Rendered JavaScript mode needs scripting permission to retry page errors. The retry was not started.${detail}`);
      return;
    }
  }

  const pageEntries = retryEntries.filter(({ row }) => row.rowType === "Page");
  const assetEntries = retryEntries.filter(({ row }) => row.rowType !== "Page");
  const attempted = retryEntries.length;
  let recovered = 0;
  let runError = "";
  const discoveredAssetJobs = [];

  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.pauseResolvers = [];
  state.activeFetchControllers.clear();
  state.activeRenderedTabIds.clear();
  state.authFailureHosts.clear();
  state.authPauseHosts.clear();
  state.pauseReason = "";
  state.runStartedAt = performance.now();
  state.completedWork = 0;
  state.totalWork = attempted;
  state.currentPhase = "Retrying error rows";
  state.runStage = "retry";
  setControls();
  updateProgress(state.completedWork, state.totalWork);
  addRunDiagnostic(automatic ? "Auto retry errors started" : "Retry errors started", `${formatMaybeNumber(attempted)} error row${attempted === 1 ? "" : "s"} queued for retry.`);
  renderDiagnostics();

  try {
    if (pageEntries.length) {
      const pageConcurrency = currentPageConcurrency();
      setRunPhase(`Retrying ${formatMaybeNumber(pageEntries.length)} page error${pageEntries.length === 1 ? "" : "s"} with concurrency ${pageConcurrency}`);
      await runWithConcurrency(pageEntries, currentPageConcurrency, async (entry) => {
        const previousRow = state.rows[entry.index] || entry.row;
        const groupId = previousRow.groupId || pageGroupId(entry.index);
        markPageRowChecking(entry.index);
        const result = await checkPage(previousRow.inputUrl);
        if (state.stopRequested && result.row.result === "Run stopped") {
          return;
        }

        result.row.groupId = groupId;
        result.row.expanded = Boolean(previousRow.expanded);
        state.rows[entry.index] = result.row;
        if (!isErrorRow(result.row)) {
          recovered += 1;
        }
        discoveredAssetJobs.push(...result.assetJobs.map((job) => ({ ...job, groupId })));
        state.completedWork += 1;
        updateProgress(state.completedWork, state.totalWork);
        scheduleResultsRender();
        maybePauseForAuthWall(result.row);
      }, { maxLimit: currentPageConcurrencyMax() });
    }

    if (assetEntries.length && !state.stopRequested) {
      setRunPhase(`Retrying ${formatMaybeNumber(assetEntries.length)} asset error${assetEntries.length === 1 ? "" : "s"} with concurrency ${currentAssetConcurrency()}`);
      await runWithConcurrency(assetEntries, currentAssetConcurrency, async (entry) => {
        await delay(state.settings.linkDelayMs);
        if (state.stopRequested) {
          return;
        }

        const job = assetJobFromRow(entry.row);
        const result = await checkUrlStatus(job.href, statusRequestOptions());
        if (state.stopRequested && result.result === "Run stopped") {
          return;
        }

        const nextRow = assetRow(job, result, "");
        // Asset retries only replace rows in place (no inserts/removals happen
        // before this point), so the carried index stays valid — like the page phase.
        state.rows[entry.index] = nextRow;
        if (!isErrorRow(nextRow)) {
          recovered += 1;
        }
        state.completedWork += 1;
        updateProgress(state.completedWork, state.totalWork);
        scheduleResultsRender();
      }, { maxLimit: 16 });
    }

    if (discoveredAssetJobs.length && !state.stopRequested) {
      addRunDiagnostic("Retry discovered assets", `${formatMaybeNumber(discoveredAssetJobs.length)} discovered asset candidate${discoveredAssetJobs.length === 1 ? "" : "s"} collected from recovered page retries.`);
      await runAssetChecks(discoveredAssetJobs);
    }
  } catch (error) {
    runError = error.message || String(error);
    addRunDiagnostic(automatic ? "Auto retry errors run error" : "Retry errors run error", runError);
  } finally {
    await finishRetryErrors(attempted, recovered, runError, automatic);
  }
}

async function finishRetryErrors(attempted, recovered, runError = "", automatic = false) {
  const stopped = state.stopRequested || Boolean(runError);
  state.running = false;
  state.paused = false;
  resolvePauseWaiters();
  await closeDedicatedRenderWindow();
  state.lastRunDurationMs = state.runStartedAt ? performance.now() - state.runStartedAt : 0;

  if (stopped) {
    state.currentPhase = runError ? "Retry stopped after error" : "Retry stopped";
    addRunDiagnostic(
      runError
        ? (automatic ? "Auto retry errors stopped after error" : "Retry errors stopped after error")
        : (automatic ? "Auto retry errors stopped" : "Retry errors stopped"),
      `${formatMaybeNumber(state.completedWork)} of ${formatMaybeNumber(state.totalWork)} retry checks completed. ${runError || "Partial results retained."}`
    );
  } else {
    const remaining = retryableErrorEntries().length;
    state.currentPhase = "Complete";
    addRunDiagnostic(
      automatic ? "Auto retry errors complete" : "Retry errors complete",
      `${formatMaybeNumber(attempted)} error row${attempted === 1 ? "" : "s"} retried; ${formatMaybeNumber(recovered)} recovered; ${formatMaybeNumber(remaining)} error row${remaining === 1 ? "" : "s"} remain.`
    );
  }

  setStatus(stopped ? "Crawl stopped" : "Crawl complete");
  state.stopRequested = false;
  state.runStartedAt = 0;
  state.pauseReason = "";
  state.completedWork = 0;
  state.totalWork = 0;
  state.activeFetchControllers.clear();
  state.activeRenderedTabIds.clear();
  setControls();
  renderResults();
  renderDiagnostics();
  state.runStage = "idle";
  renderProgress();
}

function retryableErrorEntries() {
  return state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isRetryableErrorRow(row));
}

function isRetryableErrorRow(row) {
  return ["Page", "Link", "Image"].includes(row.rowType) && isErrorRow(row);
}

function assetJobFromRow(row) {
  return {
    kind: row.rowType,
    href: row.inputUrl,
    rawHref: row.inputUrl,
    sourcePage: row.sourcePage,
    linkLocation: row.linkLocation,
    label: row.linkText,
    missingAlt: Boolean(row.missingAlt),
    groupId: row.groupId
  };
}

async function runAssetChecks(assetJobs) {
  const skippedRows = [];
  const checkableJobs = [];

  assetJobs.forEach((job) => {
    const skippedReason = getSkippedReason(job);
    if (skippedReason) {
      skippedRows.push(assetRow(job, null, skippedReason));
      return;
    }

    checkableJobs.push(job);
  });
  const totalCheckableJobs = checkableJobs.length;
  const assetLimit = state.settings.maxDiscoveredAssets;
  const cappedCheckableJobs = checkableJobs.slice(0, assetLimit);
  const limitedAssetCount = Math.max(0, totalCheckableJobs - cappedCheckableJobs.length);

  if (skippedRows.length) {
    state.rows.push(...skippedRows);
    addRunDiagnostic("Assets skipped", `${skippedRows.length} skipped by nav/footer filters. Check nav links ${onOff(!state.settings.ignoreNav)}; check footer links ${onOff(!state.settings.ignoreFooter)}.`);
    renderResults();
  }

  if (limitedAssetCount) {
    addRunDiagnostic("Discovered asset limit", `${formatMaybeNumber(limitedAssetCount)} discovered asset${limitedAssetCount === 1 ? "" : "s"} were not checked because the current discovered asset limit is ${formatMaybeNumber(assetLimit)}.`);
  }

  const totalAssets = cappedCheckableJobs.length;
  const assetGroups = groupAssetJobs(cappedCheckableJobs);
  const duplicateAssetCount = Math.max(0, totalAssets - assetGroups.length);
  let completedLinks = 0;
  state.progress.links.total = cappedCheckableJobs.filter((job) => job.kind === "Link").length;
  state.progress.links.discovered = true;
  state.progress.images.total = cappedCheckableJobs.filter((job) => job.kind === "Image").length;
  state.progress.images.discovered = true;
  state.runStage = "assets";
  state.totalWork += totalAssets;
  updateProgress(state.completedWork, state.totalWork);
  setRunPhase(`Checking ${formatMaybeNumber(totalAssets)} discovered assets with concurrency ${currentAssetConcurrency()}`);
  addRunDiagnostic(
    "Asset phase started",
    `${formatMaybeNumber(totalAssets)} asset row${totalAssets === 1 ? "" : "s"} to check; ${formatMaybeNumber(assetGroups.length)} unique check${assetGroups.length === 1 ? "" : "s"}; ${formatMaybeNumber(state.settings.linkDelayMs)} ms delay per unique asset; duplicate reuse ${onOff(state.settings.dedupeLinks)}.`
  );
  if (duplicateAssetCount) {
    addRunDiagnostic("Duplicate assets reused", `${formatMaybeNumber(duplicateAssetCount)} duplicate asset occurrence${duplicateAssetCount === 1 ? "" : "s"} will reuse a URL + area status result and remain visible on each source page.`);
  }

  const checkedGroupKeys = new Set();
  await runWithConcurrency(assetGroups, currentAssetConcurrency, async (group) => {
    await delay(state.settings.linkDelayMs);
    if (state.stopRequested) {
      return;
    }

    const result = await checkUrlStatus(group.primary.href, statusRequestOptions());
    state.rows.push(...group.jobs.map((job) => assetRow(job, result, "")));
    checkedGroupKeys.add(group.key);
    completedLinks += group.jobs.length;
    state.completedWork += group.jobs.length;
    if (group.primary.kind === "Image") {
      state.progress.images.done += group.jobs.length;
    } else {
      state.progress.links.done += group.jobs.length;
    }
    updateProgress(state.completedWork, state.totalWork);
    scheduleResultsRender();
  }, { maxLimit: 16 });

  if (state.stopRequested) {
    const uncheckedJobs = assetGroups
      .filter((group) => !checkedGroupKeys.has(group.key))
      .flatMap((group) => group.jobs);
    addUnprocessedAssetRows(uncheckedJobs, "Not checked: run stopped before asset check");
    return;
  }

  addRunDiagnostic("Asset phase complete", `${totalAssets} discovered assets checked.`);
  addRunDiagnostic("Asset summary", summarizeAssetResults());
}

function addUnprocessedAssetRows(assetJobs, fallbackReason) {
  if (!assetJobs.length) {
    return;
  }

  const rows = assetJobs.map((job) => assetRow(job, null, getSkippedReason(job) || fallbackReason));
  state.rows.push(...rows);

  const navFooterSkipped = rows.filter((row) => /ignored (?:nav|footer)/i.test(row.result || "")).length;
  const stoppedBeforeCheck = rows.length - navFooterSkipped;

  if (navFooterSkipped) {
    addRunDiagnostic("Assets skipped", `${navFooterSkipped} skipped by nav/footer filters. Check nav links ${onOff(!state.settings.ignoreNav)}; check footer links ${onOff(!state.settings.ignoreFooter)}.`);
  }

  if (stoppedBeforeCheck) {
    addRunDiagnostic("Assets retained without checks", `${stoppedBeforeCheck} discovered asset${stoppedBeforeCheck === 1 ? "" : "s"} kept as not checked because the run stopped before status checks completed.`);
  }

  renderResults();
}

function groupAssetJobs(jobs) {
  if (!state.settings.dedupeLinks) {
    return jobs.map((job, index) => ({
      key: `${assetCacheKey(job)}::${job.sourcePage || ""}::${index}`,
      primary: job,
      jobs: [job]
    }));
  }

  const groups = new Map();
  jobs.forEach((job) => {
    const key = assetCacheKey(job);
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
      return;
    }

    groups.set(key, {
      key,
      primary: job,
      jobs: [job]
    });
  });
  return [...groups.values()];
}

function assetCacheKey(job) {
  return `${job.kind}::${job.href}::${job.linkLocation}`;
}

async function finishRun(completedNormally, runError = "") {
  const stopped = state.stopRequested || !completedNormally;
  state.running = false;
  state.paused = false;
  resolvePauseWaiters();
  await closeDedicatedRenderWindow();
  state.lastRunDurationMs = state.runStartedAt ? performance.now() - state.runStartedAt : 0;

  if (stopped) {
    markQueuedRowsStopped();
    state.currentPhase = runError ? "Stopped after error" : "Stopped";
    addRunDiagnostic(runError ? "Run stopped after error" : "Run stopped", `${formatMaybeNumber(state.completedWork)} of ${formatMaybeNumber(state.totalWork)} checks completed. ${formatMaybeNumber(state.rows.length)} partial result item${state.rows.length === 1 ? "" : "s"} retained.${runError ? ` ${runError}` : ""}`);
  } else {
    state.currentPhase = "Complete";
    addRunDiagnostic("Run complete", `${state.rows.length} result item${state.rows.length === 1 ? "" : "s"} in ${formatDurationLong(state.lastRunDurationMs)}.`);
  }

  setStatus(stopped ? "Crawl stopped" : "Crawl complete");
  state.stopRequested = false;
  state.runStartedAt = 0;
  state.pauseReason = "";
  state.completedWork = 0;
  state.totalWork = 0;
  state.activeFetchControllers.clear();
  state.activeRenderedTabIds.clear();
  setControls();
  renderResults();
  renderDiagnostics();
  state.runStage = "idle";
  renderProgress();
}

function markQueuedRowsStopped() {
  state.rows = state.rows.map((row) => {
    if (!isPendingResult(row.result)) {
      return row;
    }

    return {
      ...row,
      result: "Not checked: run stopped"
    };
  });
}

function markPageRowChecking(index) {
  const row = state.rows[index];
  if (!row || row.rowType !== "Page") {
    return;
  }

  state.rows[index] = {
    ...row,
    result: "Checking"
  };
  scheduleResultsRender();
}

async function loadInputSource() {
  if (state.inputMode === "list" || state.loadingInputSource) {
    return;
  }

  saveSettingsFromInputs();
  const mode = state.inputMode;
  const sourceName = mode === "sitemap" ? "XML sitemap" : "llms.txt";
  let sourceUrl = "";

  try {
    sourceUrl = normalizeUrl(elements.sourceUrlInput.value);
  } catch (_error) {
    setSourceStatus(`Enter a valid ${sourceName} URL.`);
    return;
  }

  const hostAccessAllowed = await ensureHostPermission();
  if (!hostAccessAllowed) {
    const detail = hostPermissionError ? ` ${hostPermissionError}` : "";
    setSourceStatus(`Site access permission is needed to fetch this source.${detail}`);
    return;
  }

  state.loadingInputSource = true;
  const loadingStartedAt = performance.now();
  setSourceStatus("");
  setControls();

  try {
    const loaded = mode === "sitemap"
      ? await loadSitemapInputUrls(sourceUrl)
      : await loadLlmsInputUrls(sourceUrl);
    const parsed = parseUrls(loaded.urls.join("\n"), state.settings.maxInputUrls);
    const urls = parsed.urls;

    if (!urls.length) {
      throw new Error(`No URLs found in ${sourceName}.`);
    }

    elements.sourceUrlInput.value = sourceUrl;
    elements.urlInput.value = urls.join("\n");
    state.sourceUrlByMode[mode] = sourceUrl;
    state.inputTextByMode[mode] = elements.urlInput.value;
    state.inputCountNoteByMode[mode] = loaded.note || "";

    setSourceStatus("");
    updateInputUrlCount();
  } catch (error) {
    setSourceStatus(error.message || String(error));
  } finally {
    const remainingSpinnerMs = MIN_FETCH_SPINNER_MS - (performance.now() - loadingStartedAt);
    if (remainingSpinnerMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remainingSpinnerMs));
    }
    state.loadingInputSource = false;
    setControls();
  }
}

async function loadSitemapInputUrls(sourceUrl) {
  const maxSitemapFiles = 50;
  const maxUrlsToCollect = state.settings.maxInputUrls + 1;
  const queue = [sourceUrl];
  const visited = new Set();
  const urls = [];
  let processed = 0;

  while (queue.length && processed < maxSitemapFiles && urls.length < maxUrlsToCollect) {
    const currentUrl = queue.shift();
    const key = comparableUrl(currentUrl);
    if (visited.has(key)) {
      continue;
    }

    visited.add(key);
    processed += 1;
    const { text, finalUrl } = await fetchInputSourceText(currentUrl, "XML sitemap");
    const parsed = parseSitemapXml(text, finalUrl || currentUrl);
    parsed.urls.forEach((url) => {
      if (urls.length < maxUrlsToCollect) {
        urls.push(url);
      }
    });
    parsed.sitemaps.forEach((url) => {
      if (!visited.has(comparableUrl(url)) && queue.length < maxSitemapFiles) {
        queue.push(url);
      }
    });
  }

  const notes = [];
  if (queue.length) {
    notes.push(`Sitemap file limit of ${formatMaybeNumber(maxSitemapFiles)} reached.`);
  }
  if (urls.length >= maxUrlsToCollect) {
    notes.push("More URLs may exist.");
  }

  return {
    urls,
    note: notes.join(" ")
  };
}

async function loadLlmsInputUrls(sourceUrl) {
  const { text, finalUrl } = await fetchInputSourceText(sourceUrl, "llms.txt");
  return {
    urls: extractLlmsUrls(text, finalUrl || sourceUrl),
    note: ""
  };
}

async function fetchInputSourceText(sourceUrl, sourceName) {
  const response = await fetchWithTimeout(sourceUrl, "follow");
  if (!response.ok) {
    throw new Error(`Could not fetch ${sourceName}. HTTP ${response.status}.`);
  }

  return {
    text: await response.text(),
    finalUrl: response.url || sourceUrl
  };
}

let lastSourceStatusMessage = "";

function setSourceStatus(message) {
  const text = String(message || "").trim();
  // Only surface a toast when the status actually changes, so repeated calls
  // with the same message (or input-mode switches) don't re-pop the same toast.
  if (text && text !== lastSourceStatusMessage) {
    showToast(text);
  }
  lastSourceStatusMessage = text;
}

function updateInputUrlCount() {
  if (!elements.urlCountStatus) {
    return;
  }

  const parsed = parseUrls(elements.urlInput.value, state.settings.maxInputUrls);
  const count = parsed.urls.length;
  const notes = [];
  const extraNote = state.inputCountNoteByMode[state.inputMode];

  if (parsed.duplicateCount) {
    notes.push(`${formatMaybeNumber(parsed.duplicateCount)} duplicate URL${parsed.duplicateCount === 1 ? "" : "s"} ignored.`);
  }
  if (parsed.truncatedCount) {
    notes.push(`Input URL limit ${formatMaybeNumber(parsed.limit)} applied; ${formatMaybeNumber(parsed.truncatedCount)} URL${parsed.truncatedCount === 1 ? "" : "s"} excluded.`);
  }
  if (extraNote) {
    notes.push(extraNote);
  }

  elements.urlCountStatus.textContent = `${formatMaybeNumber(count)} URL${count === 1 ? "" : "s"} found`;
  elements.urlCountStatus.title = notes.join(" ");
  elements.urlCountStatus.classList.toggle("is-empty", count === 0);
}

function parseUrls(value, limit) {
  const seen = new Set();
  const rawUrls = String(value || "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const urls = rawUrls.filter((url) => {
    const key = url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const safeLimit = clampNumber(limit, 1, MAX_INPUT_URL_LIMIT, DEFAULT_SETTINGS.maxInputUrls);

  return {
    urls: urls.slice(0, safeLimit),
    uniqueCount: urls.length,
    duplicateCount: rawUrls.length - urls.length,
    limit: safeLimit,
    truncatedCount: Math.max(0, urls.length - safeLimit)
  };
}

async function runWithConcurrency(items, limit, worker, options = {}) {
  let nextIndex = 0;
  let activeWorkers = 0;
  const getLimit = typeof limit === "function" ? limit : () => limit;
  const maxLimit = clampNumber(
    options.maxLimit ?? getLimit(),
    1,
    items.length || 1,
    getLimit()
  );

  const runners = Array.from({ length: Math.min(maxLimit, items.length) }, async () => {
    while (nextIndex < items.length) {
      await waitWhilePaused();
      if (state.stopRequested) {
        break;
      }

      while (!state.stopRequested && nextIndex < items.length && activeWorkers >= clampNumber(getLimit(), 1, maxLimit, 1)) {
        await delay(100);
        await waitWhilePaused();
      }

      if (state.stopRequested || nextIndex >= items.length) {
        break;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      activeWorkers += 1;
      try {
        await worker(items[currentIndex], currentIndex);
      } finally {
        activeWorkers -= 1;
      }
    }
  });

  await Promise.all(runners);
}

function waitWhilePaused() {
  if (!state.paused || state.stopRequested) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    state.pauseResolvers.push(resolve);
  }).then(waitWhilePaused);
}

function resolvePauseWaiters() {
  const resolvers = state.pauseResolvers.splice(0);
  resolvers.forEach((resolve) => resolve());
}

async function checkPage(url) {
  try {
    if (state.settings.extractionMode === "rendered") {
      return await checkRenderedPage(url);
    }

    return await checkStaticPage(url);
  } catch (error) {
    return {
      row: {
        ...pendingPageRow(url),
        result: error.message || String(error)
      },
      assetJobs: []
    };
  }
}

function maybePauseForAuthWall(row) {
  if (
    !state.running ||
    state.stopRequested ||
    state.settings.extractionMode !== "rendered" ||
    !state.settings.useBrowserSessionForRenderedChecks ||
    row.rowType !== "Page" ||
    !AUTH_STATUS_CODES.has(Number(row.statusCode))
  ) {
    return;
  }

  const host = hostnameFor(row.finalUrl || row.inputUrl);
  if (!host) {
    return;
  }

  const count = (state.authFailureHosts.get(host) || 0) + 1;
  state.authFailureHosts.set(host, count);

  addRunDiagnostic(
    "Login-required response",
    `${host} returned HTTP ${row.statusCode} for ${row.inputUrl}. ${count >= AUTH_PAUSE_THRESHOLD ? "Pausing queued work for this domain." : "BulkStatus will pause if this repeats for the same domain."}`
  );

  if (count < AUTH_PAUSE_THRESHOLD || state.authPauseHosts.has(host)) {
    return;
  }

  state.authPauseHosts.add(host);
  state.paused = true;
  state.pauseReason = `Login may be required for ${host}. Sign in through Chrome, then resume.`;
  addRunDiagnostic(
    "Login wall pause",
    `BulkStatus received ${formatMaybeNumber(count)} page-level auth response${count === 1 ? "" : "s"} from ${host}. Sign in through Chrome, then click Resume to continue queued pages.`
  );
  updateProgress(state.completedWork, state.totalWork);
  setControls();
  renderResults();
  renderDiagnostics();
}

async function checkStaticPage(url, resultNote = "") {
  const normalizedUrl = normalizeUrl(url);
  const startedAt = performance.now();
  if (state.settings.diagnosticMode) {
    addRunDiagnostic("Static page request", normalizedUrl);
  }
  const response = await fetchWithTimeout(normalizedUrl);
  if (state.stopRequested) {
    throw new Error("Run stopped");
  }

  const responseTimeMs = Math.round(performance.now() - startedAt);
  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || normalizedUrl;
  const html = contentType.toLowerCase().includes("text/html")
    ? await response.text()
    : "";
  const metadata = html ? parseHtmlMetadata(html, finalUrl) : emptyMetadata();
  const assetJobs = html
    ? extractAssets(html, finalUrl, url)
    : [];
  addPageDiagnostic("Static page complete", url, responseTimeMs, response.status, assetJobs);

  return {
    row: {
      rowType: "Page",
      inputUrl: url,
      sourcePage: "",
      linkLocation: "",
      linkText: "",
      finalUrl,
      statusCode: response.status,
      redirectCount: estimateRedirectCount(normalizedUrl, finalUrl),
      responseTimeMs,
      ...metadata,
      result: resultNote || (response.ok ? "" : response.statusText || "HTTP request did not succeed")
    },
    assetJobs
  };
}

async function checkRenderedPage(url) {
  const normalizedUrl = normalizeUrl(url);
  const startedAt = performance.now();
  let tab;

  try {
    if (!chrome.scripting?.executeScript) {
      throw new Error("Rendered mode needs scripting permission. Reload the extension if you just granted it.");
    }

    if (state.settings.diagnosticMode) {
      addRunDiagnostic("Rendered status request", normalizedUrl);
    }
    const statusStartedAt = performance.now();
    const statusCheck = await checkUrlStatus(normalizedUrl, statusRequestOptions());
    if (state.stopRequested) {
      throw new Error("Run stopped");
    }

    const statusMs = Math.round(performance.now() - statusStartedAt);
    tab = await createRenderedTab(statusCheck.finalUrl || normalizedUrl);
    if (tab.id) {
      state.activeRenderedTabIds.add(tab.id);
    }
    if (state.settings.diagnosticMode) {
      addRunDiagnostic("Rendered tab opened", `${statusCheck.finalUrl || normalizedUrl}; status check ${formatMaybeNumber(statusMs)} ms.`);
    }

    const loadStartedAt = performance.now();
    await waitForTabLoad(tab.id, state.settings.timeoutMs);
    const loadMs = Math.round(performance.now() - loadStartedAt);
    if (state.settings.diagnosticMode) {
      addRunDiagnostic("Rendered tab loaded", `${url}; load event ${formatMaybeNumber(loadMs)} ms; max wait ${formatRenderWaitDuration(state.settings.renderWaitMs)}.`);
    }
    const renderWait = await waitForRenderedDomStability(tab.id, state.settings.renderWaitMs);
    if (state.stopRequested) {
      throw new Error("Run stopped");
    }
    if (state.settings.diagnosticMode) {
      addRunDiagnostic("Rendered DOM ready", `${url}; ${renderWait.reason}; waited ${formatRenderWaitDuration(renderWait.waitedMs)} of max ${formatRenderWaitDuration(state.settings.renderWaitMs)}; ${formatMaybeNumber(renderWait.snapshots)} stability check${renderWait.snapshots === 1 ? "" : "s"}.`);
    }

    const collectStartedAt = performance.now();
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectRenderedDocument
    });
    const collectMs = Math.round(performance.now() - collectStartedAt);
    const rendered = injection?.result || {};
    const html = rendered.html || "";
    const finalUrl = rendered.finalUrl || statusCheck.finalUrl || normalizedUrl;
    const metadata = html ? parseHtmlMetadata(html, finalUrl) : emptyMetadata();
    const assetJobs = html ? extractAssets(html, finalUrl, url) : [];
    const responseTimeMs = Math.round(performance.now() - startedAt);
    addPageDiagnostic("Rendered page complete", url, responseTimeMs, statusCheck.statusCode, assetJobs, `DOM collect ${formatMaybeNumber(collectMs)} ms.`);

    return {
      row: {
        rowType: "Page",
        inputUrl: url,
        sourcePage: "",
        linkLocation: "",
        linkText: "",
        finalUrl,
        statusCode: statusCheck.statusCode,
        redirectCount: statusCheck.redirectCount,
        responseTimeMs,
        ...metadata,
        result: statusCheck.result || ""
      },
      assetJobs
    };
  } catch (error) {
    return {
      row: {
        ...pendingPageRow(url),
        finalUrl: tab?.url || "",
        responseTimeMs: Math.round(performance.now() - startedAt),
        result: error.message || String(error)
      },
      assetJobs: []
    };
  } finally {
    if (tab?.id) {
      state.activeRenderedTabIds.delete(tab.id);
    }
    if (tab?.id && state.settings.closeRenderedTabs) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (_error) {
        // The tab may already be closed by the user.
      }
    }
  }
}

async function createRenderedTab(url) {
  let lastError;

  for (let attempt = 1; attempt <= RENDERED_TAB_RETRY_ATTEMPTS; attempt += 1) {
    try {
      if (state.settings.useDedicatedRenderWindow) {
        const windowId = await ensureDedicatedRenderWindow();
        return await chrome.tabs.create({
          windowId,
          active: true,
          url
        });
      }

      return await chrome.tabs.create({
        active: !state.settings.openInactive,
        url
      });
    } catch (error) {
      lastError = error;
      if (!isTransientTabOperationError(error) || state.stopRequested) {
        throw error;
      }
      if (attempt >= RENDERED_TAB_RETRY_ATTEMPTS) {
        throw new Error(`Chrome could not open a render tab after ${RENDERED_TAB_RETRY_ATTEMPTS} attempts. ${error.message || String(error)}`);
      }

      const waitMs = RENDERED_TAB_RETRY_BASE_MS * attempt;
      addRunDiagnostic(
        "Rendered tab retry",
        `Chrome could not open a render tab on attempt ${attempt} of ${RENDERED_TAB_RETRY_ATTEMPTS}: ${error.message || String(error)} Retrying in ${formatMaybeNumber(waitMs)} ms.`
      );
      await delay(waitMs);
    }
  }

  throw lastError || new Error("Chrome could not open a render tab.");
}

async function ensureDedicatedRenderWindow() {
  if (!chrome.windows?.create) {
    throw new Error("Dedicated render window is unavailable in this Chrome context.");
  }

  if (state.renderWindowId) {
    try {
      const existingWindow = await chrome.windows.get(state.renderWindowId);
      if (existingWindow?.id) {
        return existingWindow.id;
      }
    } catch (_error) {
      state.renderWindowId = null;
      state.renderWindowKeeperTabId = null;
    }
  }

  const renderWindow = await chrome.windows.create({
    url: "about:blank",
    focused: !state.settings.openInactive,
    type: "normal"
  });

  if (!renderWindow?.id) {
    throw new Error("Chrome did not return a render window ID.");
  }

  state.renderWindowId = renderWindow.id;
  state.renderWindowKeeperTabId = renderWindow.tabs?.[0]?.id || null;
  addRunDiagnostic("Dedicated render window opened", "Rendered crawl tabs will run in a separate Chrome window.");
  return renderWindow.id;
}

async function closeDedicatedRenderWindow() {
  if (!state.renderWindowId || !state.settings.useDedicatedRenderWindow || !state.settings.closeRenderedTabs) {
    return;
  }

  const windowId = state.renderWindowId;
  state.renderWindowId = null;
  state.renderWindowKeeperTabId = null;

  if (!chrome.windows?.remove) {
    return;
  }

  try {
    await chrome.windows.remove(windowId);
  } catch (_error) {
    // The render window may already be closed by Chrome or the user.
  }
}

function isTransientTabOperationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("tabs cannot be edited right now")
    || message.includes("user may be dragging a tab")
    || message.includes("tab strip")
    || message.includes("cannot edit tabs");
}

async function ensureRenderedPermission() {
  renderedPermissionError = "";

  if (chrome.scripting?.executeScript) {
    return true;
  }

  if (!chrome.permissions?.request) {
    renderedPermissionError = "Chrome permissions API is unavailable. Reload the unpacked extension, then try Rendered JavaScript again.";
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({ permissions: ["scripting"] });
    if (alreadyGranted) {
      return true;
    }
  } catch (_error) {
    // Continue to request; contains can fail in stale extension instances.
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: ["scripting"] }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        renderedPermissionError = `${error.message} Reload the unpacked extension if this permission was just added to the manifest.`;
        resolve(false);
        return;
      }

      if (!granted) {
        renderedPermissionError = "Permission was not granted.";
      }
      resolve(Boolean(granted));
    });
  });
}

async function ensureHostPermission() {
  hostPermissionError = "";
  const origins = ["http://*/*", "https://*/*"];

  if (!chrome.permissions?.contains || !chrome.permissions?.request) {
    hostPermissionError = "Chrome permissions API is unavailable. Reload the unpacked extension, then try again.";
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({ origins });
    if (alreadyGranted) {
      return true;
    }
  } catch (_error) {
    // Continue to request access; contains can fail in stale extension instances.
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        hostPermissionError = `${error.message} Reload the unpacked extension if this permission was just added to the manifest.`;
        resolve(false);
        return;
      }

      if (!granted) {
        hostPermissionError = "Site access permission was not granted.";
      }
      resolve(Boolean(granted));
    });
  });
}

function collectRenderedDocument() {
  return {
    finalUrl: window.location.href,
    html: document.documentElement ? document.documentElement.outerHTML : ""
  };
}

function collectRenderedStabilitySnapshot() {
  const bodyText = document.body?.textContent || "";
  return {
    finalUrl: window.location.href,
    readyState: document.readyState,
    titleLength: (document.title || "").length,
    textLength: bodyText.replace(/\s+/g, " ").trim().length,
    linkCount: document.querySelectorAll("a[href], area[href], [data-link-url]").length,
    imageCount: document.querySelectorAll("img[src], img[srcset], source[srcset], [data-src], [data-lazy-src], [data-bg], [style*='background-image']").length
  };
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Rendered page timed out"));
    }, timeoutMs);
    const stopTimer = window.setInterval(() => {
      if (state.stopRequested) {
        cleanup();
        reject(new Error("Run stopped"));
      }
    }, 150);

    function cleanup() {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(stopTimer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removedListener);
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    }

    function removedListener(removedTabId) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(state.stopRequested ? "Run stopped" : "Rendered tab was closed"));
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

async function waitForRenderedDomStability(tabId, maxWaitMs) {
  const maxWait = clampNumber(maxWaitMs, 0, MAX_RENDER_WAIT_MS, DEFAULT_SETTINGS.renderWaitMs);
  const startedAt = performance.now();
  let previousSnapshot = null;
  let stablePairs = 0;
  let snapshots = 0;

  if (maxWait <= 0) {
    return {
      waitedMs: 0,
      snapshots,
      reason: "max wait disabled"
    };
  }

  while (!state.stopRequested) {
    const elapsed = performance.now() - startedAt;
    const remaining = maxWait - elapsed;
    if (remaining <= 0) {
      break;
    }

    await delay(Math.min(RENDER_STABILITY_POLL_MS, remaining));
    if (state.stopRequested) {
      throw new Error("Run stopped");
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectRenderedStabilitySnapshot
    });
    const snapshot = injection?.result || {};
    snapshots += 1;

    if (isRenderedSnapshotStable(previousSnapshot, snapshot)) {
      stablePairs += 1;
    } else {
      stablePairs = 0;
    }
    previousSnapshot = snapshot;

    const waitedMs = Math.round(performance.now() - startedAt);
    if (stablePairs >= 1 && waitedMs >= Math.min(RENDER_STABILITY_MIN_WAIT_MS, maxWait)) {
      return {
        waitedMs,
        snapshots,
        reason: "rendered DOM looked stable"
      };
    }
  }

  if (state.stopRequested) {
    throw new Error("Run stopped");
  }

  return {
    waitedMs: Math.round(performance.now() - startedAt),
    snapshots,
    reason: "max wait reached"
  };
}

function isRenderedSnapshotStable(previous, next) {
  if (!previous || !next || next.readyState !== "complete") {
    return false;
  }

  return previous.readyState === next.readyState &&
    previous.finalUrl === next.finalUrl &&
    previous.titleLength === next.titleLength &&
    previous.linkCount === next.linkCount &&
    previous.imageCount === next.imageCount &&
    Math.abs(Number(previous.textLength || 0) - Number(next.textLength || 0)) <= RENDER_STABILITY_TEXT_TOLERANCE;
}

function statusRequestOptions() {
  return {
    credentials: state.settings.extractionMode === "rendered" && state.settings.useBrowserSessionForRenderedChecks
      ? "include"
      : "omit"
  };
}

// Builds the dependency bundle that binds the pure lib/network.js layer to live run state
// (timeout, active-controller registry, and stop flag).
function networkRunOptions(extra = {}) {
  return {
    timeoutMs: state.settings.timeoutMs,
    signalRegistry: state.activeFetchControllers,
    isStopRequested: () => state.stopRequested,
    ...extra
  };
}

async function checkUrlStatus(url, options = {}) {
  return net.checkUrlStatus(url, networkRunOptions({ credentials: options.credentials }));
}

async function fetchWithTimeout(url, redirect = "follow", options = {}) {
  return net.fetchWithTimeout(url, networkRunOptions({ redirect, credentials: options.credentials }));
}

function parseHtmlMetadata(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const bodyText = doc.body ? doc.body.innerText || doc.body.textContent || "" : "";

  return {
    title: cleanText(doc.querySelector("title")?.textContent),
    metaDescription: getMetaContent(doc, "description"),
    h1: cleanText(doc.querySelector("h1")?.textContent),
    metaRobots: getMetaContent(doc, "robots"),
    canonical: resolveUrl(doc.querySelector('link[rel~="canonical" i]')?.getAttribute("href"), baseUrl),
    wordCount: countWords(bodyText)
  };
}

function extractAssets(html, baseUrl, sourceInputUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [
    ...(state.settings.checkLinks ? extractLinks(doc, baseUrl, sourceInputUrl) : []),
    ...(state.settings.checkImages ? extractImages(doc, baseUrl, sourceInputUrl) : [])
  ];
}

function extractLinks(doc, baseUrl, sourceInputUrl) {
  const elementsWithLinks = [...doc.querySelectorAll("a[href], area[href], [data-link-url]")];

  return elementsWithLinks
    .map((element) => {
      const rawHref = element.getAttribute("href") || element.getAttribute("data-link-url") || "";
      const href = resolveUrl(rawHref, baseUrl);
      const linkLocation = classifyLinkLocation(element);
      return {
        kind: "Link",
        href,
        rawHref,
        sourcePage: baseUrl,
        sourceInputUrl,
        linkLocation,
        label: getLinkText(element),
        rel: cleanText(element.getAttribute("rel")),
        target: cleanText(element.getAttribute("target"))
      };
    })
    .filter((link) => isCheckableHref(link.href));
}

function extractImages(doc, baseUrl, sourceInputUrl) {
  const imageElements = [...doc.querySelectorAll("img[src], source[srcset], img[srcset], [data-src], [data-image-src]")];
  const seen = new Set();

  return imageElements
    .map((element) => {
      const rawHref = getImageCandidate(element);
      const href = resolveUrl(rawHref, baseUrl);
      const linkLocation = classifyLinkLocation(element);
      return {
        kind: "Image",
        href,
        rawHref,
        sourcePage: baseUrl,
        sourceInputUrl,
        linkLocation,
        label: getImageLabel(element),
        missingAlt: isMissingImageAltElement(element)
      };
    })
    .filter((image) => isCheckableHref(image.href))
    .filter((image) => {
      const imageKey = state.settings.collapseResponsiveImages
        ? collapseResponsiveImageUrl(image.href)
        : image.href;
      const key = `${imageKey}::${image.linkLocation}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function getImageCandidate(element) {
  const direct = element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("data-image-src");
  if (direct) {
    return direct;
  }

  return firstSrcsetCandidate(element.getAttribute("srcset"));
}

function classifyLinkLocation(element) {
  const nodes = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    nodes.push(current);
    current = current.parentElement;
  }

  const landmarkLocation = classifyByLandmark(nodes);
  if (landmarkLocation) {
    return landmarkLocation;
  }

  const haystack = nodes.map(nodeClassificationText).join(" ").toLowerCase();

  if (matchesAny(haystack, [
    /\bbreadcrumbs?\b/,
    /\bcrumbs?\b/,
    /\bcmp-breadcrumb\b/,
    /\baria-label\s*breadcrumb\b/
  ])) {
    return "Breadcrumb";
  }

  if (matchesAny(haystack, [
    /\bfooter\b/,
    /\bfooter(?:-|_|\s)?nav(?:igation)?\b/,
    /\bfooter(?:-|_|\s)?menu\b/,
    /\bfooter(?:-|_|\s)?links?\b/,
    /\bsite-footer\b/,
    /\bglobal-footer\b/,
    /\bfooter navigation\b/,
    /\bfooterlink\b/,
    /\blegal(?:-|_|\s)?terms\b/,
    /\blegal(?:-|_|\s)?links?\b/,
    /\bprivacy(?:-|_|\s)?links?\b/,
    /\bpolicy(?:-|_|\s)?links?\b/,
    /\bsocial(?:-|_|\s)?links?\b/,
    /\bsocial(?:-|_|\s)?icon\b/,
    /\bsocial(?:-|_|\s)?nav(?:igation)?\b/,
    /\bfooter-(?:bottom|top)\b/,
    /\b(?:upper|lower)(?:-|_|\s)?footer\b/,
    /\bcopyright(?:-|_|\s)?child(?:-|_|\s)?disclaimer\b/,
    /\bcopyright\b/,
    /\bsite(?:-|_|\s)?info\b/,
    /\butility(?:-|_|\s)?link\b/,
    /\bcontentinfo\b/
  ])) {
    return "Footer";
  }

  if (matchesAny(haystack, [
    /\bnav\b/,
    /\bnavigation\b/,
    /\bnavbar\b/,
    /\bnav(?:-|_|\s)?bar\b/,
    /\bnav(?:-|_|\s)?menu\b/,
    /\bnav(?:-|_|\s)?item\b/,
    /\bnav(?:-|_)?link\b/,
    /\bmain(?:-|_|\s)?nav\b/,
    /\bmain(?:-|_|\s)?menu\b/,
    /\bprimary(?:-|_|\s)?nav(?:igation)?\b/,
    /\bprimary(?:-|_|\s)?menu\b/,
    /\bsecondary(?:-|_|\s)?nav(?:igation)?\b/,
    /\bsecondary(?:-|_|\s)?menu\b/,
    /\bsite(?:-|_|\s)?nav\b/,
    /\bsite(?:-|_|\s)?menu\b/,
    /\bglobal(?:-|_|\s)?nav\b/,
    /\bglobal(?:-|_|\s)?menu\b/,
    /\bheader(?:-|_|\s)?nav\b/,
    /\bheader(?:-|_|\s)?menu\b/,
    /\btop(?:-|_|\s)?nav\b/,
    /\btop(?:-|_|\s)?menu\b/,
    /\bmobile(?:-|_|\s)?nav\b/,
    /\bmobile(?:-|_|\s)?menu\b/,
    /\bdesktop(?:-|_|\s)?nav\b/,
    /\bdesktop(?:-|_|\s)?menu\b/,
    /\bmega(?:-|_|\s)?menu\b/,
    /\bmenu(?:-|_|\s)?item\b/,
    /\bmenu(?:-|_|\s)?link\b/,
    /\bmenu(?:-|_|\s)?content(?:-|_|\s)?container\b/,
    /\boffcanvas(?:-|_|\s)?menu\b/,
    /\bdrawer(?:-|_|\s)?menu\b/,
    /\bsite(?:-|_|\s)?header\b/,
    /\bglobal(?:-|_|\s)?header\b/,
    /\bmasthead\b/
  ])) {
    return "Nav";
  }

  if (matchesAny(haystack, [
    /\baside\b/,
    /\bsidebar\b/,
    /\brail\b/,
    /\bcomplementary\b/,
    /\bside(?:-|_|\s)?nav\b/
  ])) {
    return "Sidebar";
  }

  return "Page content";
}

function classifyByLandmark(nodes) {
  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    const role = cleanText(node.getAttribute("role")).toLowerCase();
    const label = cleanText(node.getAttribute("aria-label")).toLowerCase();

    if (tag === "footer" || role === "contentinfo") {
      return "Footer";
    }

    if (tag === "nav" || role === "navigation") {
      return label.includes("breadcrumb") ? "Breadcrumb" : "Nav";
    }

    if (tag === "header" || role === "banner") {
      return "Nav";
    }

    if (tag === "aside" || role === "complementary") {
      return "Sidebar";
    }
  }

  return "";
}

function nodeClassificationText(node) {
  return [
    node.tagName,
    node.id,
    node.className,
    node.getAttribute("role"),
    node.getAttribute("aria-label"),
    node.getAttribute("data-testid"),
    node.getAttribute("data-test-id"),
    node.getAttribute("data-component"),
    node.getAttribute("data-module"),
    node.getAttribute("data-link-type"),
    node.getAttribute("data-analytics-link-type"),
    node.getAttribute("data-analytics-link-name"),
    node.getAttribute("data-analytics-tracking-event"),
    node.getAttribute("data-analytics-json"),
    node.getAttribute("data-analytics-event")
  ].join(" ");
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function getLinkText(element) {
  const text = cleanText(element.textContent);
  if (text) {
    return text;
  }

  const imageAlt = cleanText(element.querySelector("img[alt]")?.getAttribute("alt"));
  return imageAlt || cleanText(element.getAttribute("aria-label")) || cleanText(element.getAttribute("title"));
}

function getImageLabel(element) {
  return getImageAltText(element) ||
    cleanText(element.getAttribute("aria-label")) ||
    cleanText(element.getAttribute("title")) ||
    cleanText(element.getAttribute("class")) ||
    cleanText(element.tagName);
}

function getImageAltText(element) {
  if (element.tagName.toLowerCase() === "source") {
    return cleanText(element.closest("picture")?.querySelector("img")?.getAttribute("alt"));
  }

  return cleanText(element.getAttribute("alt"));
}

function isMissingImageAltElement(element) {
  return !getImageAltText(element);
}

function getSkippedReason(job) {
  if (state.settings.ignoreNav && isNavLikeLocation(job.linkLocation)) {
    return "Not checked: ignored nav";
  }

  if (state.settings.ignoreFooter && job.linkLocation === "Footer") {
    return "Not checked: ignored footer";
  }

  if (!state.settings.checkExternalLinks && job.kind === "Link" && isExternalLink(job)) {
    return "Not checked: external link";
  }

  return "";
}

function isExternalLink(job) {
  const norm = (value) => hostnameFor(value).replace(/^www\./, "");
  const src = norm(job.sourcePage);
  const dest = norm(job.href);
  return Boolean(src && dest && src !== dest);
}

function isNavLikeLocation(location) {
  return location === "Nav" || location === "Breadcrumb";
}

function isCheckableHref(href) {
  if (!href) {
    return false;
  }

  return /^https?:\/\//i.test(href);
}

function emptyMetadata() {
  return {
    title: "",
    metaDescription: "",
    h1: "",
    metaRobots: "",
    canonical: "",
    wordCount: ""
  };
}

function getMetaContent(doc, name) {
  return cleanText(doc.querySelector(`meta[name="${cssEscape(name)}" i]`)?.getAttribute("content"));
}

function pendingPageRow(url) {
  return {
    rowType: "Page",
    groupId: "",
    expanded: false,
    inputUrl: url,
    sourcePage: "",
    linkLocation: "",
    linkText: "",
    finalUrl: "",
    statusCode: "",
    redirectCount: "",
    responseTimeMs: "",
    title: "",
    metaDescription: "",
    h1: "",
    metaRobots: "",
    canonical: "",
    wordCount: "",
    missingAlt: false,
    result: state.running ? "Queued" : ""
  };
}

function assetRow(job, result, skippedReason) {
  const resultNote = skippedReason || assetResultNote(job, result);
  return {
    rowType: job.kind,
    groupId: job.groupId,
    inputUrl: job.href,
    sourcePage: job.sourcePage,
    linkLocation: job.linkLocation,
    linkText: job.label,
    finalUrl: result?.finalUrl || "",
    statusCode: result?.statusCode || "",
    redirectCount: result?.redirectCount ?? "",
    responseTimeMs: result?.responseTimeMs || "",
    title: "",
    metaDescription: "",
    h1: "",
    metaRobots: "",
    canonical: "",
    wordCount: "",
    missingAlt: Boolean(job.missingAlt),
    result: resultNote
  };
}

function assetResultNote(job, result) {
  if (!result) {
    return "";
  }

  if (job.kind === "Image" && Number(result.statusCode) === 403 && isLikelyProtectedImageCdn(job.href)) {
    return "Forbidden. Direct image check may be blocked by CDN/referrer protection.";
  }

  return result.result || "";
}

function isLikelyProtectedImageCdn(value) {
  try {
    const url = new URL(value);
    return /scene7|akamai|cloudfront|cloudinary|fastly|adobedtm|assets\.adobedtm/i.test(url.hostname) ||
      /\/is\/image\//i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function renderResultsPlaceholderRows(count) {
  const headerCells = [...document.querySelectorAll("table thead th")];
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const tr = document.createElement("tr");
    tr.className = "results-placeholder-row";
    tr.setAttribute("aria-hidden", "true");
    headerCells.forEach((th) => {
      const td = document.createElement("td");
      td.dataset.column = th.dataset.column || "";
      if (th.hidden) {
        td.hidden = true;
      }
      if (th.dataset.column !== "expander" && th.dataset.column !== "open") {
        const bar = document.createElement("span");
        bar.className = "skeleton-bar";
        td.append(bar);
      }
      tr.append(td);
    });
    rows.push(tr);
  }
  return rows;
}

let scheduledRenderHandle = 0;

// During an active run, results render once per item. Coalesce those calls behind
// a single animation frame so a burst of completed items produces at most one
// render per frame. Direct renderResults() calls (completion/stop/pause and user
// actions) supersede any pending frame via cancelScheduledRender().
function scheduleResultsRender() {
  if (scheduledRenderHandle) {
    return;
  }

  scheduledRenderHandle = requestAnimationFrame(() => {
    scheduledRenderHandle = 0;
    renderResults();
  });
}

function cancelScheduledRender() {
  if (scheduledRenderHandle) {
    cancelAnimationFrame(scheduledRenderHandle);
    scheduledRenderHandle = 0;
  }
}

// Single pass over state.rows that tallies every count the filter panel and the
// summary need, replacing ~30 separate full-array .filter() passes per render.
// Reuses the existing row predicates so the totals stay identical.
function computeRowCounts() {
  const counts = {
    total: state.rows.length,
    family2xx: 0, family3xx: 0, family4xx: 0, family5xx: 0,
    typePage: 0, typeLink: 0, typeImage: 0,
    areaContent: 0, areaNav: 0, areaBreadcrumb: 0, areaFooter: 0, areaSidebar: 0, areaUnknown: 0,
    issues: 0, redirects: 0, errors: 0, skipped: 0,
    missingTitle: 0, missingDescription: 0, missingH1: 0, missingCanonical: 0,
    canonicalizedPages: 0, noindexPages: 0, missingImageAlt: 0,
    checked: 0, notFound: 0,
    non200Links: 0, non200Images: 0, assetSkipped: 0
  };

  for (const row of state.rows) {
    const family = statusFamily(row.statusCode);
    if (family === "2xx") counts.family2xx += 1;
    else if (family === "3xx") counts.family3xx += 1;
    else if (family === "4xx") counts.family4xx += 1;
    else if (family === "5xx") counts.family5xx += 1;

    const isPage = row.rowType === "Page";
    if (isPage) counts.typePage += 1;
    else if (row.rowType === "Link") counts.typeLink += 1;
    else if (row.rowType === "Image") counts.typeImage += 1;

    const area = normalizedArea(row.linkLocation);
    if (area === "content") counts.areaContent += 1;
    else if (area === "nav") counts.areaNav += 1;
    else if (area === "breadcrumb") counts.areaBreadcrumb += 1;
    else if (area === "footer") counts.areaFooter += 1;
    else if (area === "sidebar") counts.areaSidebar += 1;
    else if (area === "unknown" && !isPage) counts.areaUnknown += 1;

    const error = isErrorRow(row);
    if (error || isNon200HttpStatus(row.statusCode)) counts.issues += 1;
    if (error) counts.errors += 1;
    if (Number(row.redirectCount || 0) > 0) counts.redirects += 1;
    const skipped = isSkippedRow(row);
    if (skipped) counts.skipped += 1;
    if (isCheckedRow(row)) counts.checked += 1;
    if (Number(row.statusCode) === 404) counts.notFound += 1;

    if (isMissingTitleRow(row)) counts.missingTitle += 1;
    if (isMissingDescriptionRow(row)) counts.missingDescription += 1;
    if (isMissingH1Row(row)) counts.missingH1 += 1;
    if (isMissingCanonicalRow(row)) counts.missingCanonical += 1;
    if (isCanonicalizedPageRow(row)) counts.canonicalizedPages += 1;
    if (isNoindexPageRow(row)) counts.noindexPages += 1;
    if (isMissingImageAltRow(row)) counts.missingImageAlt += 1;

    if (!isPage && skipped) counts.assetSkipped += 1;
    if (row.rowType === "Link" && isNon200Status(row.statusCode, row.redirectCount)) counts.non200Links += 1;
    if (row.rowType === "Image" && isNon200Status(row.statusCode, row.redirectCount)) counts.non200Images += 1;
  }

  return counts;
}

// Child (non-page) row count per page group, built once per render so expandCell
// doesn't scan all of state.rows for every visible page row.
function childCountByGroup() {
  const counts = new Map();
  for (const row of state.rows) {
    if (row.rowType !== "Page") {
      counts.set(row.groupId, (counts.get(row.groupId) || 0) + 1);
    }
  }
  return counts;
}

function renderResults() {
  cancelScheduledRender();
  applyColumnVisibility();
  updateSortHeaders();
  const counts = computeRowCounts();
  renderFilterPanel(counts);
  if (!state.rows.length) {
    elements.resultsBody.replaceChildren(...renderResultsPlaceholderRows(6));
    renderPaginationControls(currentPagination());
    updateSummary(counts);
    return;
  }

  const pagination = currentPagination();
  const childCounts = childCountByGroup();
  const rows = visibleRows(pagination);
  elements.resultsBody.replaceChildren(...rows.map((row) => renderRow(row, childCounts)));
  maybeResetResultsScroll();
  renderPaginationControls(pagination);
  updateSummary(counts);
}

function toggleFilterPanel() {
  state.filtersOpen = !state.filtersOpen;
  renderFilterPanel();
}

function renderFilterPanel(counts = computeRowCounts()) {
  elements.filterPanel.hidden = !state.filtersOpen;
  elements.filterButton.setAttribute("aria-expanded", String(state.filtersOpen));
  elements.filterButton.setAttribute("aria-pressed", String(hasActiveResultFilters()));
  elements.filterSearchInput.value = state.filters.search;

  elements.filterPanel.querySelectorAll("[data-filter-family]").forEach((input) => {
    input.checked = state.filters.families.includes(input.dataset.filterFamily);
  });
  elements.filterPanel.querySelectorAll("[data-filter-type]").forEach((input) => {
    input.checked = state.filters.types.includes(input.dataset.filterType);
  });
  elements.filterPanel.querySelectorAll("[data-filter-area]").forEach((input) => {
    input.checked = state.filters.areas.includes(input.dataset.filterArea);
  });
  elements.filterPanel.querySelectorAll("[data-filter-flag]").forEach((input) => {
    input.checked = Boolean(state.filters[input.dataset.filterFlag]);
  });

  updateFilterCounts(counts);
}

function updateFilterCounts(rowCounts = computeRowCounts()) {
  const counts = {
    "family-2xx": rowCounts.family2xx,
    "family-3xx": rowCounts.family3xx,
    "family-4xx": rowCounts.family4xx,
    "family-5xx": rowCounts.family5xx,
    "type-Page": rowCounts.typePage,
    "type-Link": rowCounts.typeLink,
    "type-Image": rowCounts.typeImage,
    "area-content": rowCounts.areaContent,
    "area-nav": rowCounts.areaNav,
    "area-breadcrumb": rowCounts.areaBreadcrumb,
    "area-footer": rowCounts.areaFooter,
    "area-sidebar": rowCounts.areaSidebar,
    "area-unknown": rowCounts.areaUnknown,
    "flag-issuesOnly": rowCounts.issues,
    "flag-redirectsOnly": rowCounts.redirects,
    "flag-errorsOnly": rowCounts.errors,
    "flag-skippedOnly": rowCounts.skipped,
    "flag-missingTitle": rowCounts.missingTitle,
    "flag-missingDescription": rowCounts.missingDescription,
    "flag-missingH1": rowCounts.missingH1,
    "flag-missingCanonical": rowCounts.missingCanonical,
    "flag-canonicalizedPages": rowCounts.canonicalizedPages,
    "flag-noindexPages": rowCounts.noindexPages,
    "flag-missingImageAlt": rowCounts.missingImageAlt
  };

  elements.filterPanel.querySelectorAll("[data-count-for]").forEach((countElement) => {
    const key = countElement.dataset.countFor;
    const count = counts[key] || 0;
    const label = countElement.closest("label");
    const input = label?.querySelector("input");
    countElement.textContent = `(${formatMaybeNumber(count)})`;
    label?.classList.toggle("is-empty", count === 0);
    if (input && count === 0 && !input.checked) {
      input.disabled = true;
    } else if (input) {
      input.disabled = false;
    }
  });
}

function handleFilterChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.dataset.filterFamily) {
    toggleArrayFilter("families", input.dataset.filterFamily, input.checked);
  } else if (input.dataset.filterType) {
    toggleArrayFilter("types", input.dataset.filterType, input.checked);
  } else if (input.dataset.filterArea) {
    toggleArrayFilter("areas", input.dataset.filterArea, input.checked);
  } else if (input.dataset.filterFlag) {
    state.filters[input.dataset.filterFlag] = input.checked;
  }

  resetResultsPagination();
  renderResults();
}

function toggleArrayFilter(key, value, force) {
  const values = new Set(state.filters[key]);
  const shouldAdd = force === undefined ? !values.has(value) : force;
  if (shouldAdd) {
    values.add(value);
  } else {
    values.delete(value);
  }
  state.filters[key] = [...values];
}

function clearResultFilters(render = true) {
  state.only404 = false;
  state.filters = {
    search: "",
    families: [],
    statuses: [],
    types: [],
    areas: [],
    issuesOnly: false,
    redirectsOnly: false,
    errorsOnly: false,
    skippedOnly: false,
    missingTitle: false,
    missingDescription: false,
    missingH1: false,
    missingCanonical: false,
    canonicalizedPages: false,
    noindexPages: false,
    missingImageAlt: false
  };
  elements.filterSearchInput.value = "";
  resetResultsPagination({ collapseShowAll: true });
  if (render) {
    renderResults();
  }
}

function visibleRows(pagination = currentPagination()) {
  const visiblePageRows = pagination.visiblePageRows;
  const rows = [];

  visiblePageRows.forEach((pageRow) => {
    rows.push(pageRow);
    if (hasActiveResultFilters()) {
      rows.push(...sortRows(matchingChildRows(pageRow.groupId)));
      return;
    }

    if (pageRow.expanded) {
      rows.push(...sortRows(state.rows.filter((row) => {
        if (row.rowType === "Page" || row.groupId !== pageRow.groupId) {
          return false;
        }

        return shouldShowChildRow(row);
      })));
    }
  });

  return rows;
}

function filteredSortedPageRows() {
  return sortRows(state.rows.filter((row) => row.rowType === "Page").filter((pageRow) => {
    if (!hasActiveResultFilters()) {
      return true;
    }

    return rowMatchesResultFilters(pageRow) || matchingChildRows(pageRow.groupId).length;
  }));
}

function currentPagination() {
  const pageRows = filteredSortedPageRows();
  const pageSize = clampPageSize(state.resultsPageSize);
  const totalPages = Math.max(1, Math.ceil(pageRows.length / pageSize));
  state.resultsPageSize = pageSize;
  state.resultsPage = Math.min(totalPages, Math.max(1, Number(state.resultsPage) || 1));

  if (state.showAll) {
    return {
      visiblePageRows: pageRows,
      totalPageRows: pageRows.length,
      totalPages,
      currentPage: state.resultsPage,
      pageSize,
      startPageNumber: pageRows.length ? 1 : 0,
      endPageNumber: pageRows.length
    };
  }

  const startIndex = (state.resultsPage - 1) * pageSize;
  const endIndex = Math.min(pageRows.length, startIndex + pageSize);

  return {
    visiblePageRows: pageRows.slice(startIndex, endIndex),
    totalPageRows: pageRows.length,
    totalPages,
    currentPage: state.resultsPage,
    pageSize,
    startPageNumber: pageRows.length ? startIndex + 1 : 0,
    endPageNumber: endIndex
  };
}

function renderPaginationControls(pagination = currentPagination()) {
  const hasPages = pagination.totalPageRows > 0;
  const needsPagination = pagination.totalPageRows > pagination.pageSize || state.showAll;
  const activeRun = isActivelyRunning();
  const label = hasPages
    ? `Page rows ${formatMaybeNumber(pagination.startPageNumber)}-${formatMaybeNumber(pagination.endPageNumber)} of ${formatMaybeNumber(pagination.totalPageRows)}`
    : "No pages to show";

  elements.paginationControls.forEach((control) => {
    control.hidden = !hasPages || !needsPagination;
  });
  elements.paginationLabels.forEach((element) => {
    element.textContent = label;
  });
  elements.paginationPageSizeSelects.forEach((select) => {
    select.value = String(pagination.pageSize);
    select.disabled = activeRun || state.showAll || !hasPages;
  });
  elements.paginationPreviousButtons.forEach((button) => {
    button.disabled = activeRun || state.showAll || pagination.currentPage <= 1;
  });
  elements.paginationNextButtons.forEach((button) => {
    button.disabled = activeRun || state.showAll || pagination.currentPage >= pagination.totalPages;
  });
  elements.paginationShowAllButtons.forEach((button) => {
    button.hidden = pagination.totalPageRows <= pagination.pageSize && !state.showAll;
    button.disabled = activeRun || !hasPages;
    button.textContent = state.showAll ? "Collapse" : "Show all";
    button.setAttribute("aria-pressed", String(state.showAll));
  });
}

function exportRows() {
  if (!hasActiveResultFilters()) {
    return state.rows;
  }

  const rows = [];
  sortRows(state.rows.filter((row) => row.rowType === "Page")).forEach((pageRow) => {
    const children = sortRows(matchingChildRows(pageRow.groupId));
    if (rowMatchesResultFilters(pageRow) || children.length) {
      rows.push(pageRow, ...children);
    }
  });
  return rows;
}

function matchingChildRows(groupId) {
  return state.rows.filter((row) => (
    row.rowType !== "Page" &&
    row.groupId === groupId &&
    shouldShowChildRow(row) &&
    rowMatchesResultFilters(row)
  ));
}

function is404Row(row) {
  return Number(row.statusCode) === 404;
}

function shouldShowChildRow(row) {
  if (state.hideSkipped && isSkippedRow(row)) {
    return false;
  }

  if (state.hideLinks && row.rowType === "Link") {
    return false;
  }

  if (state.hideImages && row.rowType === "Image") {
    return false;
  }

  return true;
}

function hasActiveResultFilters() {
  return Boolean(
    state.only404 ||
    state.filters.search ||
    state.filters.families.length ||
    state.filters.statuses.length ||
    state.filters.types.length ||
    state.filters.areas.length ||
    state.filters.issuesOnly ||
    state.filters.redirectsOnly ||
    state.filters.errorsOnly ||
    state.filters.skippedOnly ||
    state.filters.missingTitle ||
    state.filters.missingDescription ||
    state.filters.missingH1 ||
    state.filters.missingCanonical ||
    state.filters.canonicalizedPages ||
    state.filters.noindexPages ||
    state.filters.missingImageAlt
  );
}

function rowMatchesResultFilters(row) {
  if (state.only404 && !is404Row(row)) {
    return false;
  }

  if (state.filters.types.length && !state.filters.types.includes(row.rowType)) {
    return false;
  }

  if (state.filters.areas.length && !state.filters.areas.includes(normalizedArea(row.linkLocation))) {
    return false;
  }

  if (state.filters.statuses.length && !state.filters.statuses.includes(String(row.statusCode || ""))) {
    return false;
  }

  if (state.filters.families.length && !state.filters.families.includes(statusFamily(row.statusCode))) {
    return false;
  }

  if (state.filters.issuesOnly && !isIssueRow(row)) {
    return false;
  }

  if (state.filters.redirectsOnly && Number(row.redirectCount || 0) <= 0) {
    return false;
  }

  if (state.filters.errorsOnly && !isErrorRow(row)) {
    return false;
  }

  if (state.filters.skippedOnly && !isSkippedRow(row)) {
    return false;
  }

  if (state.filters.missingTitle && !isMissingTitleRow(row)) {
    return false;
  }

  if (state.filters.missingDescription && !isMissingDescriptionRow(row)) {
    return false;
  }

  if (state.filters.missingH1 && !isMissingH1Row(row)) {
    return false;
  }

  if (state.filters.missingCanonical && !isMissingCanonicalRow(row)) {
    return false;
  }

  if (state.filters.canonicalizedPages && !isCanonicalizedPageRow(row)) {
    return false;
  }

  if (state.filters.noindexPages && !isNoindexPageRow(row)) {
    return false;
  }

  if (state.filters.missingImageAlt && !isMissingImageAltRow(row)) {
    return false;
  }

  const search = state.filters.search.trim().toLowerCase();
  if (search && !rowSearchText(row).includes(search)) {
    return false;
  }

  return true;
}

function normalizedArea(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("breadcrumb")) {
    return "breadcrumb";
  }
  if (text.includes("nav")) {
    return "nav";
  }
  if (text.includes("footer")) {
    return "footer";
  }
  if (text.includes("sidebar")) {
    return "sidebar";
  }
  if (text.includes("content") || text.includes("body") || text.includes("page")) {
    return "content";
  }
  return "unknown";
}

function isErrorRow(row) {
  return Boolean(row.result && !isPendingResult(row.result) && row.result !== "Run stopped" && !row.result.startsWith("Not checked") && !row.statusCode);
}

function isIssueRow(row) {
  return isErrorRow(row) || isNon200HttpStatus(row.statusCode);
}

function isCheckedRow(row) {
  return Boolean(row.statusCode) || isErrorRow(row);
}

function hasEvaluatedPageMetadata(row) {
  return row.rowType === "Page" && Boolean(row.statusCode) && !isPendingResult(row.result) && !isSkippedRow(row);
}

function isMissingTitleRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.title);
}

function isMissingDescriptionRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.metaDescription);
}

function isMissingH1Row(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.h1);
}

function isMissingCanonicalRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.canonical);
}

function isCanonicalizedPageRow(row) {
  return row.rowType === "Page" &&
    Boolean(cleanText(row.canonical)) &&
    Boolean(cleanText(row.finalUrl)) &&
    comparableUrl(row.canonical) !== comparableUrl(row.finalUrl);
}

function isNoindexPageRow(row) {
  return row.rowType === "Page" && /\bnoindex\b/i.test(row.metaRobots || "");
}

function isMissingImageAltRow(row) {
  return row.rowType === "Image" && row.missingAlt === true;
}

function rowSearchText(row) {
  return [
    row.rowType,
    row.inputUrl,
    row.sourcePage,
    row.linkLocation,
    row.linkText,
    row.finalUrl,
    row.statusCode,
    row.title,
    row.metaDescription,
    row.h1,
    row.metaRobots,
    row.canonical,
    row.result
  ].join(" ").toLowerCase();
}

function sortRows(rows) {
  if (!state.sortColumn) {
    return [...rows];
  }

  return [...rows].sort((a, b) => compareRows(a, b, state.sortColumn, state.sortDirection));
}

function compareRows(a, b, column, direction) {
  const left = sortValue(a, column);
  const right = sortValue(b, column);
  const multiplier = direction === "desc" ? -1 : 1;

  if (left.kind === "number" || right.kind === "number") {
    return ((left.number || 0) - (right.number || 0)) * multiplier;
  }

  return left.text.localeCompare(right.text, undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

function sortValue(row, column) {
  const values = {
    area: row.linkLocation,
    canonical: row.canonical,
    description: row.metaDescription,
    finalUrl: row.finalUrl,
    h1: row.h1,
    imageIssues: row.rowType === "Page" ? countNon200Children(row.groupId, "Image") : "",
    inputUrl: row.inputUrl,
    linkIssues: row.rowType === "Page" ? countNon200Children(row.groupId, "Link") : "",
    redirects: row.redirectCount,
    result: row.result || successPlaceholder(row),
    robots: row.metaRobots,
    sourcePage: row.sourcePage,
    state: rowState(row).label,
    status: row.statusCode || getStatusFallback(row.result),
    textAlt: row.linkText,
    time: row.responseTimeMs,
    title: row.title,
    type: row.rowType,
    words: row.wordCount
  };
  const value = values[column];
  const number = Number(value);

  if (value !== "" && value !== null && value !== undefined && Number.isFinite(number)) {
    return { kind: "number", number, text: "" };
  }

  return { kind: "text", number: 0, text: String(value || "") };
}

function renderRow(row, childCounts) {
  const tr = document.createElement("tr");
  tr.className = row.rowType === "Page" ? "page-row" : "asset-row";
  const values = [
    stateCell(row),
    expandCell(row, childCounts),
    textCell("type", row.rowType, `type-tag type-${String(row.rowType || "").toLowerCase()}`),
    openCell(row),
    textCell("inputUrl", row.inputUrl),
    textCell("sourcePage", row.sourcePage),
    textCell("area", row.linkLocation),
    textCell("textAlt", row.linkText),
    textCell("finalUrl", row.finalUrl),
    textCell("status", row.statusCode || getStatusFallback(row.result), getStatusClass(row.statusCode, row.result)),
    textCell("redirects", row.redirectCount),
    textCell("time", formatResponseTime(row.responseTimeMs)),
    textCell("linkIssues", issueCountCellValue(row, "Link")),
    textCell("imageIssues", issueCountCellValue(row, "Image")),
    textCell("title", row.title),
    textCell("description", row.metaDescription),
    textCell("h1", row.h1),
    textCell("robots", row.metaRobots),
    textCell("canonical", row.canonical),
    textCell("words", formatMaybeNumber(row.wordCount)),
    textCell("result", row.result || successPlaceholder(row))
  ];

  tr.append(...values);
  return tr;
}

function stateCell(row) {
  const td = document.createElement("td");
  td.dataset.column = "state";
  if (!isColumnVisible("state")) {
    td.hidden = true;
  }

  const stateInfo = rowState(row);
  const span = document.createElement("span");
  span.className = `row-state ${stateInfo.className}`;
  span.title = stateInfo.title;
  span.setAttribute("aria-label", stateInfo.title);
  span.innerHTML = stateInfo.icon;
  const label = document.createElement("span");
  label.textContent = stateInfo.label;
  span.append(label);
  td.append(span);
  return td;
}

function rowState(row) {
  if (row.result === "Queued") {
    return {
      label: "Queued",
      className: "state-pending",
      title: "Queued and waiting to be checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
    };
  }

  if (row.result === "Checking") {
    return {
      label: "Checking",
      className: "state-checking",
      title: "Currently being checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
    };
  }

  if (row.result === "Run stopped" || isSkippedRow(row)) {
    return {
      label: "Skipped",
      className: "state-skipped",
      title: row.result || "Skipped or not checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'
    };
  }

  if (isErrorRow(row)) {
    return {
      label: "Error",
      className: "state-error",
      title: row.result || "Check ended with an error",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>'
    };
  }

  if (row.statusCode) {
    return {
      label: "Complete",
      className: "state-complete",
      title: "Check complete",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
    };
  }

  return {
    label: "Pending",
    className: "state-pending",
    title: "Pending check",
    icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
}

function openCell(row) {
  const td = document.createElement("td");
  td.dataset.column = "open";
  const url = row.finalUrl || row.inputUrl;
  if (!url) {
    return td;
  }

  const button = document.createElement("button");
  button.className = "open-button";
  button.type = "button";
  button.title = "Open in new tab";
  button.setAttribute("aria-label", `Open ${url} in a new tab`);
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
  button.addEventListener("click", () => {
    chrome.tabs.create({ url });
  });
  td.append(button);
  return td;
}

function expandCell(row, childCounts) {
  const td = document.createElement("td");
  td.dataset.column = "expander";
  if (row.rowType !== "Page") {
    return td;
  }

  const childCount = childCounts
    ? (childCounts.get(row.groupId) || 0)
    : state.rows.filter((child) => child.rowType !== "Page" && child.groupId === row.groupId).length;
  if (!childCount) {
    return td;
  }

  const button = document.createElement("button");
  button.className = "expand-button";
  button.type = "button";
  button.innerHTML = row.expanded
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
  button.title = row.expanded ? "Collapse page assets" : `Show ${childCount} page assets`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    row.expanded = !row.expanded;
    renderResults();
  });
  td.append(button);
  return td;
}

function textCell(column, value, className = "") {
  const td = document.createElement("td");
  td.dataset.column = column;
  if (!isColumnVisible(column)) {
    td.hidden = true;
  }
  const span = document.createElement("span");
  span.className = `cell-clip ${className}`.trim();
  span.textContent = value === 0 ? "0" : String(value || "");
  span.title = span.textContent;
  td.append(span);
  return td;
}

function getStatusFallback(result) {
  if (!result || isPendingResult(result)) {
    return "";
  }

  return result.startsWith("Not checked") || result === "Run stopped" ? "Skip" : "Error";
}

function getStatusClass(value, result) {
  const code = Number(value);

  if (result && (result.startsWith("Not checked") || result === "Run stopped")) {
    return "status-skipped";
  }

  if (result && !isPendingResult(result) && !code) {
    return "status-error";
  }

  if (!code || code < 200) {
    return value ? "status-error" : "";
  }

  if (code >= 200 && code < 300) {
    return "status-ok";
  }

  if (code >= 300 && code < 400) {
    return "status-warn";
  }

  return "status-error";
}

function issueCountCellValue(row, kind) {
  if (row.rowType !== "Page") {
    return pageOnlyPlaceholder(row);
  }

  return formatMaybeNumber(countNon200Children(row.groupId, kind));
}

function countNon200Children(groupId, kind) {
  return state.rows.filter((row) => (
    row.groupId === groupId &&
    row.rowType === kind &&
    isNon200Status(row.statusCode, row.redirectCount)
  )).length;
}

function isNon200Status(statusCode, redirectCount = 0) {
  const code = Number(statusCode);
  return Boolean((code && code !== 200) || Number(redirectCount) > 0);
}

function updateProgress(completed, total) {
  renderProgress();
  updateRunControlButtons();
}

function etaText(completed, total) {
  if (!total || !completed || !state.runStartedAt) {
    return "calculating\u2026";
  }

  const elapsedMs = performance.now() - state.runStartedAt;
  const remainingMs = Math.max(0, (elapsedMs / completed) * (total - completed));
  return `~${formatEstimatedDuration(remainingMs)} left`;
}

function assetStageLabel() {
  const links = state.settings.checkLinks;
  const images = state.settings.checkImages;
  if (links && images) {
    return "Checking links & images";
  }
  if (links) {
    return "Checking links";
  }
  if (images) {
    return "Checking images";
  }
  return "Checking assets";
}

function setProgressBar(rowEl, fillEl, countEl, data) {
  rowEl.hidden = false;
  rowEl.classList.remove("is-off", "is-pending");
  if (!data.enabled) {
    rowEl.classList.add("is-off");
    fillEl.style.width = "0%";
    countEl.innerHTML = '<span class="off-pill">Off</span>';
    return;
  }
  if (!data.discovered) {
    rowEl.classList.add("is-pending");
    fillEl.style.width = "0%";
    countEl.textContent = "Pending";
    return;
  }
  if (!data.total) {
    fillEl.style.width = "100%";
    countEl.textContent = "None found";
    return;
  }
  const pct = Math.round((data.done / data.total) * 100);
  fillEl.style.width = `${pct}%`;
  countEl.textContent = `${formatMaybeNumber(data.done)} / ${formatMaybeNumber(data.total)}`;
}

function renderProgressSide(done, total, label, etaCompleted, etaTotal) {
  elements.progressBig.textContent = `${formatMaybeNumber(done)} / ${formatMaybeNumber(total)}`;
  elements.progressBigLabel.textContent = label;
  if (state.stopRequested) {
    elements.progressEta.textContent = "Stopping\u2026";
  } else if (state.paused) {
    elements.progressEta.textContent = "Paused";
  } else {
    elements.progressEta.textContent = etaText(etaCompleted, etaTotal);
  }
  elements.progressQueued.textContent = `${formatMaybeNumber(Math.max(0, total - done))} queued`;
}

function setRunStatusLine() {
  const percent = state.totalWork ? Math.round((state.completedWork / state.totalWork) * 100) : 0;
  if (state.stopRequested) {
    setStatus("Stopping crawl");
  } else if (state.paused) {
    setStatus("Crawl paused");
  } else {
    setStatus(state.totalWork ? `Crawling\u2026 ${percent}%` : "");
  }
}

function clearIdleBar(rowEl, fillEl, countEl) {
  rowEl.hidden = false;
  rowEl.classList.remove("is-off", "is-pending");
  fillEl.style.width = "0%";
  countEl.textContent = "\u2014";
}

function renderProgress() {
  const p = state.progress;
  const stage = state.runStage;

  if (!stage || stage === "idle") {
    elements.progressWrap.classList.add("is-idle");
    elements.genericRow.hidden = true;
    elements.progressMainBars.classList.remove("is-generic");
    elements.progressStep.innerHTML = '<span class="step-pill">Ready</span> Run a check to track progress';
    elements.progressBig.textContent = "\u2014";
    elements.progressBigLabel.textContent = "pages";
    elements.progressQueued.textContent = "\u2014 queued";
    elements.progressEta.textContent = "\u2014 left";
    clearIdleBar(elements.pagesRow, elements.pagesFill, elements.pagesCount);
    clearIdleBar(elements.linksRow, elements.linksFill, elements.linksCount);
    clearIdleBar(elements.imagesRow, elements.imagesFill, elements.imagesCount);
    return;
  }
  elements.progressWrap.classList.remove("is-idle");

  const generic = stage === "retry";

  elements.pagesRow.hidden = generic;
  elements.linksRow.hidden = generic;
  elements.imagesRow.hidden = generic;
  elements.genericRow.hidden = !generic;
  elements.progressMainBars.classList.toggle("is-generic", generic);

  const hasAssetPhase = state.settings.checkLinks || state.settings.checkImages;
  let stepHtml;
  if (state.stopRequested) {
    stepHtml = "Stopping\u2026";
  } else if (state.paused) {
    stepHtml = state.pauseReason ? `Paused \u2014 ${escapeHtml(state.pauseReason)}` : "Paused";
  } else if (generic) {
    stepHtml = "Retrying error rows";
  } else if (stage === "assets") {
    const label = assetStageLabel();
    stepHtml = hasAssetPhase ? `<span class="step-pill">Step 2 of 2</span> ${label}` : label;
  } else if (stage === "pages") {
    stepHtml = hasAssetPhase ? '<span class="step-pill">Step 1 of 2</span> Checking pages' : "Checking pages";
  } else {
    stepHtml = "Preparing\u2026";
  }
  elements.progressStep.innerHTML = stepHtml;

  if (generic) {
    const pct = state.totalWork ? Math.round((state.completedWork / state.totalWork) * 100) : 0;
    elements.genericFill.style.width = `${pct}%`;
    elements.genericCount.textContent = `${formatMaybeNumber(state.completedWork)} / ${formatMaybeNumber(state.totalWork)}`;
    renderProgressSide(state.completedWork, state.totalWork, "retried", state.completedWork, state.totalWork);
    setRunStatusLine();
    return;
  }

  setProgressBar(elements.pagesRow, elements.pagesFill, elements.pagesCount, {
    enabled: true,
    discovered: true,
    done: p.pages.done,
    total: p.pages.total
  });
  setProgressBar(elements.linksRow, elements.linksFill, elements.linksCount, p.links);
  setProgressBar(elements.imagesRow, elements.imagesFill, elements.imagesCount, p.images);

  if (stage === "assets") {
    const done = p.links.done + p.images.done;
    const total = p.links.total + p.images.total;
    const unit = state.settings.checkLinks && state.settings.checkImages
      ? "assets"
      : (state.settings.checkLinks ? "links" : "images");
    renderProgressSide(done, total, unit, state.completedWork, state.totalWork);
  } else {
    renderProgressSide(p.pages.done, p.pages.total, "pages", state.completedWork, state.totalWork);
  }

  setRunStatusLine();
}

function setRunPhase(phase) {
  state.currentPhase = phase;
  addRunDiagnostic("Phase", phase);
  updateProgress(state.completedWork, state.totalWork);
}

function addPageDiagnostic(label, url, elapsedMs, statusCode, assetJobs, detail = "") {
  if (!state.settings.diagnosticMode) {
    return;
  }

  const links = assetJobs.filter((job) => job.kind === "Link").length;
  const images = assetJobs.filter((job) => job.kind === "Image").length;
  const status = statusCode ? `status ${statusCode}` : "no status";
  const extra = detail ? ` ${detail}` : "";
  addRunDiagnostic(label, `${url}; ${status}; ${formatMaybeNumber(elapsedMs)} ms; discovered ${links} links and ${images} images.${extra}`);
}

function addEnvironmentDiagnostic() {
  const manifest = appManifest();
  const environment = diagnosticsEnvironment();
  addRunDiagnostic(
    "Environment",
    `BulkStatus ${manifest.version || "dev"}; Chrome ${environment.chromeVersion || "unknown"}; ${environment.operatingSystem || environment.platform || "unknown OS"}; ${environment.timezone || "unknown timezone"}; ${environment.hardwareConcurrency || "unknown"} logical processors.`
  );
}

function addRunDiagnostic(label, detail) {
  const elapsedMs = state.runStartedAt ? performance.now() - state.runStartedAt : 0;
  state.runDiagnostics.push({
    label,
    detail,
    elapsedMs
  });
  state.runDiagnostics = state.runDiagnostics.slice(-80);
  renderDiagnostics();
}

function renderDiagnostics() {
  if (!state.runDiagnostics.length) {
    elements.diagnosticsSummary.textContent = "Run a check to populate diagnostics.";
    elements.copyDiagnosticsButton.disabled = true;
    elements.downloadDiagnosticsButton.disabled = true;
    const item = document.createElement("li");
    item.textContent = "Run a check to populate diagnostics. Enable Detailed diagnostics in Settings for more timing and discovery detail.";
    elements.diagnosticsList.replaceChildren(item);
    renderPanelStates();
    return;
  }

  const duration = state.running && state.runStartedAt
    ? performance.now() - state.runStartedAt
    : state.lastRunDurationMs;
  elements.diagnosticsSummary.textContent = `${state.runDiagnostics.length} events. Elapsed ${formatDurationLong(duration)}.`;
  elements.copyDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.downloadDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.diagnosticsList.replaceChildren(...state.runDiagnostics.map((event) => {
    const item = document.createElement("li");
    item.textContent = `[+${formatDuration(event.elapsedMs)}] ${event.label}: ${event.detail}`;
    return item;
  }));
  renderPanelStates();
}

function summarizeAssetResults() {
  const assets = state.rows.filter((row) => row.rowType === "Link" || row.rowType === "Image");
  const links = assets.filter((row) => row.rowType === "Link");
  const images = assets.filter((row) => row.rowType === "Image");
  const non200 = assets.filter((row) => isNon200Status(row.statusCode, row.redirectCount));
  const forbiddenByDomain = topDomainCounts(assets.filter((row) => Number(row.statusCode) === 403));
  const slowByDomain = topSlowDomains(assets);
  const parts = [
    `${links.length} links`,
    `${images.length} images`,
    `${non200.length} non-200/redirected assets`
  ];

  if (forbiddenByDomain) {
    parts.push(`403 domains: ${forbiddenByDomain}`);
  }

  if (slowByDomain) {
    parts.push(`slow domains: ${slowByDomain}`);
  }

  return parts.join("; ");
}


function renderSummaryPlaceholderMetric(metric) {
  const button = document.createElement("button");
  button.className = "summary-metric is-placeholder";
  button.type = "button";
  button.disabled = true;
  button.innerHTML = `<strong>\u2014</strong><span>${escapeHtml(metric.label)}</span><small>${escapeHtml(metric.detail)}</small>`;
  return button;
}

function renderSummaryPlaceholderBreakdown(title, items) {
  const section = document.createElement("section");
  section.className = "summary-breakdown is-placeholder";
  const header = document.createElement("div");
  header.className = "summary-breakdown-header";
  header.innerHTML = `<span>${escapeHtml(title)}</span><span class="summary-breakdown-total">\u2014</span>`;
  section.append(header);
  const legend = document.createElement("div");
  legend.className = "summary-legend";
  items.forEach((item) => {
    const row = document.createElement("span");
    row.className = "summary-legend-button is-placeholder";
    const dot = document.createElement("span");
    dot.className = "summary-dot";
    dot.dataset.tone = item.tone || "muted";
    const label = document.createElement("span");
    label.textContent = item.label;
    const count = document.createElement("span");
    count.className = "summary-count";
    count.textContent = "\u2014";
    row.append(dot, label, count);
    legend.append(row);
  });
  section.append(legend);
  return section;
}

function renderSummaryPanel(counts = computeRowCounts()) {
  const hasRows = state.rows.length > 0;
  elements.summaryPanel.hidden = false;
  if (!hasRows) {
    state.summaryShown = false;
    elements.summaryPanelLine.textContent = "Run a check to populate these metrics.";
    elements.summaryMetrics.replaceChildren(...SUMMARY_PLACEHOLDER_METRICS.map(renderSummaryPlaceholderMetric));
    elements.summaryBreakdowns.replaceChildren(...SUMMARY_PLACEHOLDER_BREAKDOWNS.map((b) => renderSummaryPlaceholderBreakdown(b.title, b.items)));
    renderPanelStates();
    return;
  }

  if (!state.summaryShown) {
    state.summaryShown = true;
    state.panelCollapsed.summary = false;
  }

  const stats = summaryStats(counts);
  elements.summaryPanelLine.textContent = summaryStatusText(stats);

  const metrics = [
    { label: "Items", value: stats.total, detail: "All results", action: { kind: "all" } },
    { label: "Pages", value: stats.pages, detail: "Page URLs in crawl", action: { kind: "type", value: "Page" } },
    { label: "Links", value: stats.links, detail: "Discovered links", action: { kind: "type", value: "Link" } },
    { label: "Images", value: stats.images, detail: "Discovered images", action: { kind: "type", value: "Image" } },
    { label: "Status issues", value: stats.statusIssues, detail: "Non-200 status or errors", action: { kind: "flag", value: "issuesOnly" } },
    { label: "404s", value: stats.notFound, detail: "Not found items", action: { kind: "only404" } },
    { label: "Redirects", value: stats.redirects, detail: "Items with redirects", action: { kind: "flag", value: "redirectsOnly" } },
    { label: "Skipped", value: stats.skipped, detail: "Not checked by filters or stop", action: { kind: "flag", value: "skippedOnly" } }
  ];

  elements.summaryMetrics.replaceChildren(...metrics.map((metric) => renderSummaryMetric(metric)));
  elements.summaryBreakdowns.replaceChildren(
    renderSummaryBreakdown("Asset type", stats.total, [
      { label: "Pages", count: stats.pages, tone: "page", action: { kind: "type", value: "Page" } },
      { label: "Links", count: stats.links, tone: "link", action: { kind: "type", value: "Link" } },
      { label: "Images", count: stats.images, tone: "image", action: { kind: "type", value: "Image" } }
    ]),
    renderSummaryBreakdown("Status", stats.total, [
      { label: "2xx", count: stats.families["2xx"], tone: "success", action: { kind: "family", value: "2xx" } },
      { label: "3xx", count: stats.families["3xx"], tone: "warning", action: { kind: "family", value: "3xx" } },
      { label: "4xx", count: stats.families["4xx"], tone: "danger", action: { kind: "family", value: "4xx" } },
      { label: "5xx", count: stats.families["5xx"], tone: "danger", action: { kind: "family", value: "5xx" } },
      { label: "Errors", count: stats.errors, tone: "danger", action: { kind: "flag", value: "errorsOnly" } },
      { label: "Skipped", count: stats.skipped, tone: "muted", action: { kind: "flag", value: "skippedOnly" } }
    ]),
    renderSummaryBreakdown("Page issues", stats.pageIssueTotal, [
      { label: "Missing title", count: stats.pageIssues.missingTitle, tone: "page", action: { kind: "flag", value: "missingTitle" } },
      { label: "Missing description", count: stats.pageIssues.missingDescription, tone: "page", action: { kind: "flag", value: "missingDescription" } },
      { label: "Missing H1", count: stats.pageIssues.missingH1, tone: "page", action: { kind: "flag", value: "missingH1" } },
      { label: "Missing canonical", count: stats.pageIssues.missingCanonical, tone: "page", action: { kind: "flag", value: "missingCanonical" } },
      { label: "Canonicalized", count: stats.pageIssues.canonicalizedPages, tone: "page", action: { kind: "flag", value: "canonicalizedPages" } },
      { label: "Noindex", count: stats.pageIssues.noindexPages, tone: "page", action: { kind: "flag", value: "noindexPages" } }
    ], false),
    renderSummaryBreakdown("Asset issues", stats.assetIssueTotal, [
      { label: "Non-200 links", count: stats.non200Links, tone: "link", action: { kind: "typeIssue", type: "Link" } },
      { label: "Non-200 images", count: stats.non200Images, tone: "image", action: { kind: "typeIssue", type: "Image" } },
      { label: "Missing image alt", count: stats.pageIssues.missingImageAlt, tone: "image", action: { kind: "flag", value: "missingImageAlt" } },
      { label: "Skipped assets", count: stats.assetSkipped, tone: "muted", action: { kind: "flag", value: "skippedOnly" } }
    ], false)
  );

  renderPanelStates();
}

function summaryStats(counts = computeRowCounts()) {
  const pageIssues = {
    missingTitle: counts.missingTitle,
    missingDescription: counts.missingDescription,
    missingH1: counts.missingH1,
    missingCanonical: counts.missingCanonical,
    canonicalizedPages: counts.canonicalizedPages,
    noindexPages: counts.noindexPages,
    missingImageAlt: counts.missingImageAlt
  };
  const families = {
    "2xx": counts.family2xx,
    "3xx": counts.family3xx,
    "4xx": counts.family4xx,
    "5xx": counts.family5xx
  };

  return {
    total: counts.total,
    checked: counts.checked,
    complete: counts.checked,
    pages: counts.typePage,
    links: counts.typeLink,
    images: counts.typeImage,
    issueRows: counts.issues,
    statusIssues: counts.issues,
    notFound: counts.notFound,
    redirects: counts.redirects,
    skipped: counts.skipped,
    assetSkipped: counts.assetSkipped,
    errors: counts.errors,
    non200Links: counts.non200Links,
    non200Images: counts.non200Images,
    families,
    pageIssueTotal: pageIssues.missingTitle + pageIssues.missingDescription + pageIssues.missingH1 + pageIssues.missingCanonical + pageIssues.canonicalizedPages + pageIssues.noindexPages,
    assetIssueTotal: counts.non200Links + counts.non200Images + pageIssues.missingImageAlt + counts.assetSkipped,
    pageIssues
  };
}

function summaryStatusText(stats) {
  const statePrefix = state.running
    ? (state.paused ? "Paused" : "Crawling")
    : (state.currentPhase.startsWith("Stopped") ? "Stopped" : "Complete");
  const scopeParts = [
    stats.pages ? `${formatMaybeNumber(stats.pages)} page${stats.pages === 1 ? "" : "s"}` : "",
    stats.links ? `${formatMaybeNumber(stats.links)} link${stats.links === 1 ? "" : "s"}` : "",
    stats.images ? `${formatMaybeNumber(stats.images)} image${stats.images === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  const scope = scopeParts.length ? scopeParts.join(", ") : `${formatMaybeNumber(stats.total)} item${stats.total === 1 ? "" : "s"}`;
  const issueSuffix = state.running ? "found so far" : "found";

  return `${statePrefix}: ${scope}. ${formatMaybeNumber(stats.checked)}/${formatMaybeNumber(stats.total)} items checked. ${formatMaybeNumber(stats.statusIssues)} status issue${stats.statusIssues === 1 ? "" : "s"} ${issueSuffix}.`;
}

function renderSummaryMetric(metric) {
  const button = document.createElement("button");
  const disabledForRun = isActivelyRunning();
  const disabledForEmpty = !metric.value && metric.action.kind !== "all";
  button.className = "summary-metric";
  button.classList.toggle("is-running-disabled", disabledForRun);
  button.classList.toggle("is-empty", disabledForEmpty);
  button.type = "button";
  button.disabled = disabledForRun || disabledForEmpty;
  button.setAttribute("aria-pressed", String(summaryActionActive(metric.action)));
  button.title = disabledForRun ? "Summary filters unlock when the crawl is paused, stopped, or complete." : (button.disabled ? metric.detail : `Filter results: ${metric.label}`);
  button.innerHTML = `<strong>${formatMaybeNumber(metric.value)}</strong><span>${escapeHtml(metric.label)}</span><small>${escapeHtml(metric.detail)}</small>`;
  button.addEventListener("click", () => applySummaryFilter(metric.action));
  return button;
}

function renderSummaryBreakdown(title, total, items, showBar = true) {
  const section = document.createElement("section");
  section.className = "summary-breakdown";

  const header = document.createElement("div");
  header.className = "summary-breakdown-header";
  header.innerHTML = `<span>${escapeHtml(title)}</span><span class="summary-breakdown-total">${formatMaybeNumber(total)}</span>`;
  section.append(header);

  if (showBar) {
    const bar = document.createElement("div");
    bar.className = "summary-bar";
    const visibleItems = items.filter((item) => item.count > 0);
    if (visibleItems.length) {
      bar.append(...visibleItems.map((item) => renderSummaryBarSegment(item, total)));
    }
    section.append(bar);
  }

  const legend = document.createElement("div");
  legend.className = "summary-legend";
  legend.append(...items.map((item) => renderSummaryLegendButton(item)));
  section.append(legend);

  return section;
}

function renderSummaryBarSegment(item, total) {
  const button = document.createElement("button");
  button.className = "summary-bar-segment";
  button.type = "button";
  button.dataset.tone = item.tone || "muted";
  button.style.flexBasis = `${Math.max(2, (item.count / Math.max(total, 1)) * 100)}%`;
  button.title = `${item.label}: ${formatMaybeNumber(item.count)}`;
  button.disabled = isActivelyRunning() || !item.action;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => applySummaryFilter(item.action));
  return button;
}

function renderSummaryLegendButton(item) {
  const button = document.createElement("button");
  button.className = "summary-legend-button";
  button.type = "button";
  button.disabled = isActivelyRunning() || !item.count || !item.action;
  button.setAttribute("aria-pressed", String(summaryActionActive(item.action)));
  button.title = button.disabled ? item.label : `Filter results: ${item.label}`;

  const dot = document.createElement("span");
  dot.className = "summary-dot";
  dot.dataset.tone = item.tone || "muted";

  const label = document.createElement("span");
  label.textContent = item.label;

  const count = document.createElement("span");
  count.className = "summary-count";
  count.textContent = formatMaybeNumber(item.count);

  button.append(dot, label, count);
  button.addEventListener("click", () => applySummaryFilter(item.action));
  return button;
}

function applySummaryFilter(action) {
  if (!action || isActivelyRunning()) {
    return;
  }

  // Clicking the already-active filter card toggles it off (back to all results).
  if (action.kind !== "all" && summaryActionActive(action)) {
    clearResultFilters(false);
    state.panelCollapsed.results = false;
    renderResults();
    scrollResultsIntoView();
    return;
  }

  clearResultFilters(false);
  state.panelCollapsed.results = false;

  if (action.kind === "all") {
    renderResults();
    scrollResultsIntoView();
    return;
  }

  // Note: we intentionally do not auto-open the filter panel here. Opening it would push
  // the filtered results below the fold; the highlighted summary card and updated counts
  // already signal the active filter, and the Filter button still opens the panel to refine.
  if (action.kind === "only404") {
    state.only404 = true;
  } else if (action.kind === "type") {
    state.filters.types = [action.value];
  } else if (action.kind === "family") {
    state.filters.families = [action.value];
  } else if (action.kind === "flag") {
    state.filters[action.value] = true;
  } else if (action.kind === "typeIssue") {
    state.filters.types = [action.type];
    state.filters.issuesOnly = true;
  }

  renderResults();
  scrollResultsIntoView();
}

function scrollResultsIntoView() {
  const target = elements.resultsPanelBody?.closest("section") || elements.resultsPanelBody;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function summaryActionActive(action) {
  if (!action) {
    return false;
  }

  if (action.kind === "all") {
    // The "All results" card is a reset action, not a selectable state, so it never
    // shows as pressed. This avoids a phantom "selected" look when no filter is applied.
    return false;
  }

  if (action.kind === "only404") {
    return state.only404;
  }

  if (action.kind === "type") {
    return state.filters.types.includes(action.value);
  }

  if (action.kind === "family") {
    return state.filters.families.includes(action.value);
  }

  if (action.kind === "flag") {
    return Boolean(state.filters[action.value]);
  }

  if (action.kind === "typeIssue") {
    return state.filters.types.includes(action.type) && state.filters.issuesOnly;
  }

  return false;
}

function topDomainCounts(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const domain = getUrlHostname(row.inputUrl);
    if (domain) {
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => `${domain} ${count}`)
    .join(", ");
}

function topSlowDomains(rows) {
  const timings = new Map();
  rows.forEach((row) => {
    const ms = Number(row.responseTimeMs);
    const domain = getUrlHostname(row.inputUrl);
    if (!domain || !Number.isFinite(ms) || ms <= 0) {
      return;
    }

    const current = timings.get(domain) || { count: 0, total: 0, max: 0 };
    current.count += 1;
    current.total += ms;
    current.max = Math.max(current.max, ms);
    timings.set(domain, current);
  });

  return [...timings.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 5)
    .map(([domain, timing]) => `${domain} max ${formatMaybeNumber(timing.max)} ms avg ${formatMaybeNumber(Math.round(timing.total / timing.count))} ms`)
    .join(", ");
}

function getUrlHostname(value) {
  try {
    return new URL(value).hostname;
  } catch (_error) {
    return "";
  }
}

function updateSummary(counts = computeRowCounts()) {
  const total = counts.total;
  const checked = counts.checked;
  const issues = counts.issues;
  const notFound = counts.notFound;
  const skipped = counts.skipped;
  elements.only404Button.disabled = isActivelyRunning() || !state.rows.length || !notFound;
  elements.only404Button.setAttribute("aria-pressed", String(state.only404));
  elements.only404Button.querySelector("span").textContent = "404 Results";
  updateRetryErrorsButton();
  const activeFilters = activeFilterSummary();
  const filter = activeFilters ? ` Filters active: ${activeFilters}.` : "";

  elements.summaryLine.textContent = total
    ? `${formatMaybeNumber(checked)}/${formatMaybeNumber(total)} items checked. ${formatMaybeNumber(issues)} status issues. ${formatMaybeNumber(notFound)} 404s. ${formatMaybeNumber(skipped)} skipped.${filter}`
    : "No checks run yet.";
  renderSummaryPanel(counts);
}

function activeFilterSummary() {
  const parts = [];
  if (state.only404) {
    parts.push("404");
  }
  if (state.filters.search) {
    parts.push("search");
  }
  if (state.filters.families.length) {
    parts.push(state.filters.families.join("/"));
  }
  if (state.filters.statuses.length) {
    parts.push(state.filters.statuses.join("/"));
  }
  if (state.filters.types.length) {
    parts.push(state.filters.types.join("/"));
  }
  if (state.filters.areas.length) {
    parts.push(state.filters.areas.join("/"));
  }
  if (state.filters.issuesOnly) {
    parts.push("status issues");
  }
  if (state.filters.redirectsOnly) {
    parts.push("redirects");
  }
  if (state.filters.errorsOnly) {
    parts.push("errors");
  }
  if (state.filters.skippedOnly) {
    parts.push("skipped");
  }
  if (state.filters.missingTitle) {
    parts.push("missing title");
  }
  if (state.filters.missingDescription) {
    parts.push("missing description");
  }
  if (state.filters.missingH1) {
    parts.push("missing H1");
  }
  if (state.filters.missingCanonical) {
    parts.push("missing canonical");
  }
  if (state.filters.canonicalizedPages) {
    parts.push("canonicalized");
  }
  if (state.filters.noindexPages) {
    parts.push("noindex");
  }
  if (state.filters.missingImageAlt) {
    parts.push("missing image alt");
  }
  return parts.join(", ");
}

function isSkippedRow(row) {
  return Boolean(row.result && row.result.startsWith("Not checked"));
}

function isPendingResult(result) {
  return result === "Queued" || result === "Checking";
}

function pageOnlyPlaceholder(row) {
  return row.rowType === "Page" ? "" : "";
}

function successPlaceholder(row) {
  return row.statusCode ? "OK" : "";
}

function setStatus(value) {
  document.title = value && value !== "Ready." ? `${value} - BulkStatus - Bulk URL Checker` : "BulkStatus - Bulk URL Checker";
}

function toggleRunPause() {
  if (!state.running || state.stopRequested) {
    return;
  }

  state.paused = !state.paused;
  if (state.paused) {
    state.pauseReason = "";
    addRunDiagnostic("Run paused", `${formatMaybeNumber(state.completedWork)} of ${formatMaybeNumber(state.totalWork)} checks complete.`);
  } else {
    state.pauseReason = "";
    state.authPauseHosts.clear();
    refreshCurrentPhaseConcurrency();
    addRunDiagnostic(
      "Run resumed",
      `${formatMaybeNumber(state.completedWork)} of ${formatMaybeNumber(state.totalWork)} checks complete. Remaining checks use page concurrency ${formatMaybeNumber(currentPageConcurrency())}, asset concurrency ${formatMaybeNumber(currentAssetConcurrency())}, timeout ${formatRenderWaitDuration(state.settings.timeoutMs)}, render wait ${formatRenderWaitDuration(state.settings.renderWaitMs)}, and asset delay ${formatRenderWaitDuration(state.settings.linkDelayMs)}.`
    );
    resolvePauseWaiters();
  }

  updateProgress(state.completedWork, state.totalWork);
  setControls();
  renderResults();
  renderDiagnostics();
}

function stopRun() {
  if (!state.running || state.stopRequested) {
    return;
  }

  state.stopRequested = true;
  state.paused = false;
  state.pauseReason = "";
  resolvePauseWaiters();
  abortActiveFetches();
  closeActiveRenderedTabs();
  addRunDiagnostic("Stop requested", `${formatMaybeNumber(state.completedWork)} of ${formatMaybeNumber(state.totalWork)} checks complete. Stopping active work and keeping partial results.`);
  updateProgress(state.completedWork, state.totalWork);
  setControls();
  renderDiagnostics();
}

function abortActiveFetches() {
  state.activeFetchControllers.forEach((controller) => {
    try {
      controller.abort();
    } catch (_error) {
      // Ignore abort races.
    }
  });
}

function closeActiveRenderedTabs() {
  state.activeRenderedTabIds.forEach((tabId) => {
    try {
      chrome.tabs.remove(tabId);
    } catch (_error) {
      // The tab may already be closed.
    }
  });
  state.activeRenderedTabIds.clear();
}

function isActivelyRunning() {
  return state.running && !state.paused;
}

function setContextTitle(element, disabled, title) {
  if (!element) {
    return;
  }

  if (element.dataset.defaultTitle === undefined) {
    element.dataset.defaultTitle = element.getAttribute("title") || "";
  }

  if (disabled && title) {
    element.title = title;
    return;
  }

  const defaultTitle = element.dataset.defaultTitle;
  if (defaultTitle) {
    element.title = defaultTitle;
  } else {
    element.removeAttribute("title");
  }
}

function setSettingsControlDisabled(control, disabled, title = "") {
  if (!control) {
    return;
  }

  control.disabled = Boolean(disabled);
  setContextTitle(control, disabled, title);

  const wrapper = control.closest(".check-row, .number-field, .select-field");
  if (wrapper) {
    wrapper.classList.toggle("is-disabled", Boolean(disabled));
    setContextTitle(wrapper, disabled, title);
  }
}

function setSettingsButtonDisabled(button, disabled, title = "") {
  if (!button) {
    return;
  }

  button.disabled = Boolean(disabled);
  button.classList.toggle("is-disabled", Boolean(disabled));
  setContextTitle(button, disabled, title);
}

function applySettingsAvailability() {
  const activeRun = isActivelyRunning();
  const pausedRun = state.running && state.paused;
  const lockedTitle = "Stop the crawl to change this setting.";
  const activeTitle = "Pause the crawl to change speed and timing for remaining checks.";

  if (elements.pausedSettingsNotice) {
    elements.pausedSettingsNotice.hidden = !pausedRun;
  }
  elements.settingsBand.classList.toggle("is-paused-run", pausedRun);

  [
    elements.checkLinksInput,
    elements.checkImagesInput,
    elements.collapseResponsiveImagesInput,
    elements.dedupeLinksInput,
    elements.autoRetryErrorsInput,
    elements.keepAwakeInput,
    elements.ignoreNavInput,
    elements.checkExternalLinksInput,
    elements.ignoreFooterInput,
    elements.extractionModeInput,
    elements.openInactiveInput,
    elements.useDedicatedRenderWindowInput,
    elements.useBrowserSessionInput,
    elements.closeRenderedTabsInput,
    elements.maxInputUrlsInput,
    elements.maxDiscoveredAssetsInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, state.running, lockedTitle);
  });

  [
    elements.pageConcurrencyInput,
    elements.renderedConcurrencyInput,
    elements.renderWaitInput,
    elements.linkConcurrencyInput,
    elements.timeoutInput,
    elements.linkDelayInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, activeRun, activeRun ? activeTitle : "");
  });

  [
    elements.themePreferenceInput,
    elements.timeDisplayUnitInput,
    elements.resultsDensityInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, false);
  });

  elements.columnToggles.forEach((input) => {
    setSettingsControlDisabled(input, false);
  });

  [
    elements.hideImagesToggle,
    elements.hideLinksToggle,
    elements.hideSkippedToggle
  ].forEach((input) => {
    setSettingsControlDisabled(input, activeRun, activeRun ? "Pause the crawl to adjust result display filters." : "");
  });

  [
    elements.linksChip,
    elements.imagesChip
  ].forEach((button) => {
    setSettingsButtonDisabled(button, state.running, lockedTitle);
  });

  elements.presetButtons.forEach((button) => {
    setSettingsButtonDisabled(button, state.running, lockedTitle);
  });

  setSettingsButtonDisabled(elements.saveDefaultsButton, state.running, "Stop the crawl before saving settings as the default.");
  setSettingsButtonDisabled(elements.resetSettingsButton, state.running, "Stop the crawl before resetting settings.");
}

function setControls() {
  updateInputUrlCount();
  const sourceMode = state.inputMode !== "list";
  const activeRun = isActivelyRunning();
  const canUseRows = Boolean(state.rows.length) && (!state.running || state.paused);
  elements.runButton.disabled = state.running;
  elements.copyUrlsButton.disabled = activeRun || !elements.urlInput.value.trim();
  elements.fileInput.disabled = sourceMode || state.running || state.loadingInputSource;
  elements.uploadFileButton.classList.toggle("is-disabled", elements.fileInput.disabled);
  elements.uploadFileButton.setAttribute("aria-disabled", String(elements.fileInput.disabled));
  elements.loadSourceButton.disabled = !sourceMode || state.running || state.loadingInputSource;
  elements.loadSourceButton.classList.toggle("is-loading", state.loadingInputSource);
  elements.loadSourceButton.setAttribute("aria-busy", String(state.loadingInputSource));
  elements.loadSourceButton.title = state.loadingInputSource ? "Fetching URLs" : "Fetch URLs";
  // In list mode the field is a read-only "click to upload" trigger, so it must stay
  // enabled (disabled inputs do not fire click events); it is read-only via renderInputMode.
  elements.sourceUrlInput.disabled = state.running || state.loadingInputSource;
  elements.exportButton.disabled = !canUseRows;
  elements.exportSummaryButton.disabled = !canUseRows;
  elements.copyResultsButton.disabled = !canUseRows;
  elements.copySummaryButton.disabled = !canUseRows;
  elements.copyAiSummaryButton.disabled = !canUseRows;
  elements.filterButton.disabled = !canUseRows;
  updateRetryErrorsButton();
  elements.copyDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.downloadDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.only404Button.disabled = activeRun || !state.rows.length || !state.rows.some((row) => is404Row(row));
  elements.clearButton.disabled = state.running;
  applySettingsAvailability();
  elements.inputModeButtons.forEach((button) => {
    button.disabled = state.running || state.loadingInputSource;
  });
  renderPaginationControls();
  updateRunControlButtons();
}

function updateRunControlButtons() {
  elements.progressControls.hidden = !state.running;
  elements.pauseRunButton.disabled = !state.running || state.stopRequested;
  elements.stopRunButton.disabled = !state.running || state.stopRequested;
  elements.pauseRunButton.classList.toggle("is-paused", state.paused);
  elements.pauseRunButton.setAttribute("aria-pressed", String(state.paused));
  elements.pauseRunButton.title = state.paused ? "Resume crawl" : "Pause crawl";
  elements.pauseRunButton.setAttribute("aria-label", state.paused ? "Resume crawl" : "Pause crawl");
  elements.stopRunButton.title = state.stopRequested ? "Stopping crawl" : "Stop crawl";
  elements.stopRunButton.setAttribute("aria-label", state.stopRequested ? "Stopping crawl" : "Stop crawl");

  const pauseIcon = elements.pauseRunButton.querySelector("[data-pause-icon]");
  const playIcon = elements.pauseRunButton.querySelector("[data-play-icon]");
  if (pauseIcon && playIcon) {
    pauseIcon.hidden = state.paused;
    playIcon.hidden = !state.paused;
  }
}

function updateRetryErrorsButton() {
  const count = retryableErrorEntries().length;
  const autoRetryNote = state.settings.autoRetryErrors ? " Automatic retry is enabled for future runs." : "";
  elements.retryErrorsButton.hidden = count === 0;
  elements.retryErrorsButton.disabled = state.running || count === 0;
  elements.retryErrorsButton.title = count
    ? `Retry ${formatMaybeNumber(count)} row${count === 1 ? "" : "s"} that ended with Error.${autoRetryNote}`
    : "No error rows to retry";
  elements.retryErrorsButton.setAttribute("aria-label", count
    ? `Retry ${formatMaybeNumber(count)} error row${count === 1 ? "" : "s"}`
    : "Retry Errors");
}

function clearAll() {
  state.rows = [];
  state.runDiagnostics = [];
  state.summaryShown = false;
  state.panelCollapsed.summary = false;
  state.panelCollapsed.diagnostics = false;
  state.lastRunDurationMs = 0;
  state.currentPhase = "";
  state.hideSkipped = false;
  state.hideLinks = false;
  state.hideImages = false;
  state.only404 = false;
  state.filtersOpen = false;
  clearResultFilters(false);
  state.sortColumn = "";
  state.sortDirection = "asc";
  state.inputTextByMode = { list: "", sitemap: "", llms: "" };
  state.sourceUrlByMode = { sitemap: "", llms: "" };
  state.sourceStatusByMode = { sitemap: "", llms: "" };
  state.inputCountNoteByMode = { list: "", sitemap: "", llms: "" };
  elements.hideSkippedToggle.checked = false;
  elements.hideLinksToggle.checked = false;
  elements.hideImagesToggle.checked = false;
  state.showAll = false;
  state.resultsPage = 1;
  elements.urlInput.value = "";
  elements.sourceUrlInput.value = "";
  elements.fileInput.value = "";
  updateInputUrlCount();
  updateProgress(0, 0);
  setControls();
  renderInputMode();
  renderDiagnostics();
  renderResults();
}

async function handleFileUpload(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  const text = await file.text();
  setInputMode("list");
  elements.urlInput.value = text;
  state.inputTextByMode.list = text;
  state.inputCountNoteByMode.list = "";
  updateInputUrlCount();
  setControls();
}

function exportCsv() {
  const csv = resultsCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSummaryCsv() {
  const csv = summaryCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyUrls() {
  await navigator.clipboard.writeText(elements.urlInput.value.trim());
  flashButton(elements.copyUrlsButton, "Copied");
}

function openStoreListing() {
  if (globalThis.chrome?.tabs?.create) {
    globalThis.chrome.tabs.create({ url: CHROME_WEB_STORE_LISTING_URL });
    return;
  }

  window.open(CHROME_WEB_STORE_LISTING_URL, "_blank", "noopener");
}

async function shareStoreListing() {
  const url = CHROME_WEB_STORE_LISTING_URL;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "BulkStatus - Bulk URL Checker",
        text: "BulkStatus - a Chrome extension for bulk URL checking.",
        url
      });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      // Share sheet unavailable or failed — fall back to copying the link.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    flashIconButton(elements.shareStoreListingButton, "Copied listing link");
    showToast("Listing link copied to clipboard");
  } catch (error) {
    showToast("Couldn't share the link");
  }
}

function showToast(message) {
  const toast = elements.appToast;
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toast._hideTimer);
  toast._hideTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function openExternalUrl(url) {
  if (!url) {
    return;
  }
  if (globalThis.chrome?.tabs?.create) {
    globalThis.chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

function currentAppVersion() {
  return appManifest().version || "dev";
}

function maybeShowUpdateBanner() {
  if (!elements.updateBanner || !elements.updateBannerText) {
    return;
  }
  const current = currentAppVersion();
  let seen = null;
  try {
    seen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch (_error) {
    seen = null;
  }

  if (!seen) {
    try {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, current);
    } catch (_error) {
      // Ignore storage failures; the banner simply won't be suppressed next time.
    }
    return;
  }

  if (seen === current) {
    return;
  }

  elements.updateBannerText.textContent = `Updated to ${current}`;
  elements.updateBanner.hidden = false;
}

function markUpdateSeen() {
  if (!elements.updateBanner || elements.updateBanner.hidden) {
    return;
  }
  elements.updateBanner.hidden = true;
  try {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, currentAppVersion());
  } catch (_error) {
    // Ignore storage failures.
  }
}

function bindUpdateNotice() {
  if (elements.updateBannerDismiss) {
    elements.updateBannerDismiss.addEventListener("click", markUpdateSeen);
  }
  if (elements.updateBannerLink) {
    if (CHANGELOG_URL) {
      elements.updateBannerLink.hidden = false;
      elements.updateBannerLink.addEventListener("click", () => {
        openExternalUrl(CHANGELOG_URL);
        markUpdateSeen();
      });
    } else {
      elements.updateBannerLink.hidden = true;
    }
  }
  if (elements.settingsBand) {
    elements.settingsBand.addEventListener("change", markUpdateSeen);
  }
}

function bindVersionLink() {
  if (!elements.versionLabel || !GITHUB_REPO_URL) {
    return;
  }
  elements.versionLabel.classList.add("version-link");
  elements.versionLabel.setAttribute("role", "link");
  elements.versionLabel.setAttribute("tabindex", "0");
  elements.versionLabel.title = "View BulkStatus on GitHub";
  elements.versionLabel.addEventListener("click", () => openExternalUrl(GITHUB_REPO_URL));
  elements.versionLabel.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openExternalUrl(GITHUB_REPO_URL);
    }
  });
}

function bindConfigTransfer() {
  if (elements.exportConfigButton) {
    elements.exportConfigButton.addEventListener("click", exportConfig);
  }
  if (elements.importConfigButton && elements.configFileInput) {
    elements.importConfigButton.addEventListener("click", () => elements.configFileInput.click());
    elements.configFileInput.addEventListener("change", handleConfigImport);
  }
}

function exportConfig() {
  saveSettingsFromInputs();
  const payload = {
    bulkstatusConfig: true,
    version: currentAppVersion(),
    exportedAt: new Date().toISOString(),
    settings: state.settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  flashButton(elements.exportConfigButton, "Exported");
}

function handleConfigImport(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const incoming = parsed && parsed.settings ? parsed.settings : parsed;
      if (!incoming || typeof incoming !== "object") {
        throw new Error("Not a BulkStatus configuration file.");
      }
      state.settings = normalizeSettings({ ...getDefaultSettings(), ...incoming });
      localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
      loadSettings();
      updatePresetButtons();
      applyColumnVisibility();
      renderResults();
      flashButton(elements.importConfigButton, "Imported");
    } catch (_error) {
      flashButton(elements.importConfigButton, "Invalid file");
    }
  };
  reader.readAsText(file);
}

function setSettingsTab(name) {
  elements.settingsTabButtons.forEach((button) => {
    const active = button.dataset.settingsTab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.settingsTabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsTab !== name;
  });
}

function bindSettingsTabs() {
  elements.settingsTabButtons.forEach((button) => {
    button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
  });
}

function bindAppLinks() {
  if (elements.openGithubButton) {
    elements.openGithubButton.disabled = !GITHUB_REPO_URL;
    elements.openGithubButton.addEventListener("click", () => openExternalUrl(GITHUB_REPO_URL));
  }
  if (elements.reportIssueButton) {
    elements.reportIssueButton.disabled = !GITHUB_ISSUES_URL;
    elements.reportIssueButton.addEventListener("click", () => openExternalUrl(GITHUB_ISSUES_URL));
  }
  if (elements.rateExtensionButton) {
    elements.rateExtensionButton.addEventListener("click", () => openExternalUrl(CHROME_WEB_STORE_LISTING_URL));
  }
}

async function copyAiSummaryPrompt() {
  const prompt = [
    "You are an SEO and website-health analyst. Below is a bulk URL crawl summary from the BulkStatus Chrome extension.",
    "Review it and give a concise, prioritized list of issues and recommended fixes \u2014 status errors, broken links/images, redirects, and on-page metadata gaps. Call out anything that could affect search or AI/answer-engine discoverability.",
    "",
    "Crawl summary:",
    summaryCsv()
  ].join("\n");
  await navigator.clipboard.writeText(prompt);
  flashButton(elements.copyAiSummaryButton, "Prompt copied");
}

async function copySummary() {
  await navigator.clipboard.writeText(summaryCsv());
  flashButton(elements.copySummaryButton, "Copied");
}

async function copyResults() {
  await navigator.clipboard.writeText(resultsCsv());
  flashButton(elements.copyResultsButton, "Copied");
}

async function copyDiagnostics() {
  await navigator.clipboard.writeText(diagnosticsText());
  flashButton(elements.copyDiagnosticsButton, "Copied");
}

function downloadDiagnostics() {
  const blob = new Blob([JSON.stringify(diagnosticsPayload(), null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function diagnosticsText() {
  return state.runDiagnostics.map((event) => (
    `[+${formatDuration(event.elapsedMs)}] ${event.label}: ${event.detail}`
  )).join("\n");
}

function diagnosticsPayload() {
  const manifest = appManifest();
  return {
    app: "BulkStatus - Bulk URL Checker",
    appVersion: manifest.version || "dev",
    manifestVersion: manifest.manifest_version || 3,
    generatedAt: new Date().toISOString(),
    environment: diagnosticsEnvironment(),
    inputSource: {
      mode: state.inputMode,
      label: inputModeLabel(),
      sourceUrl: currentInputSourceUrl()
    },
    summary: {
      events: state.runDiagnostics.length,
      rows: state.rows.length,
      pages: state.rows.filter((row) => row.rowType === "Page").length,
      links: state.rows.filter((row) => row.rowType === "Link").length,
      images: state.rows.filter((row) => row.rowType === "Image").length,
      issues: state.rows.filter((row) => isIssueRow(row)).length,
      notFound: state.rows.filter((row) => is404Row(row)).length,
      durationMs: Math.round(state.lastRunDurationMs || (state.runStartedAt ? performance.now() - state.runStartedAt : 0))
    },
    settings: {
      extractionMode: state.settings.extractionMode,
      checkLinks: state.settings.checkLinks,
      checkImages: state.settings.checkImages,
      collapseResponsiveImages: state.settings.collapseResponsiveImages,
      dedupeLinks: state.settings.dedupeLinks,
      autoRetryErrors: state.settings.autoRetryErrors,
      ignoreNav: state.settings.ignoreNav,
      ignoreFooter: state.settings.ignoreFooter,
      pageConcurrency: state.settings.pageConcurrency,
      renderedConcurrency: state.settings.renderedConcurrency,
      renderWaitMs: state.settings.renderWaitMs,
      openInactive: state.settings.openInactive,
      useDedicatedRenderWindow: state.settings.useDedicatedRenderWindow,
      useBrowserSessionForRenderedChecks: state.settings.useBrowserSessionForRenderedChecks,
      closeRenderedTabs: state.settings.closeRenderedTabs,
      assetConcurrency: state.settings.linkConcurrency,
      timeoutMs: state.settings.timeoutMs,
      timeDisplayUnit: state.settings.timeDisplayUnit,
      resultsDensity: state.settings.resultsDensity,
      delayPerAssetMs: state.settings.linkDelayMs,
      maxInputUrls: state.settings.maxInputUrls,
      maxDiscoveredAssets: state.settings.maxDiscoveredAssets,
      hostAccessModel: "optional runtime request"
    },
    activeFilters: {
      only404: state.only404,
      filters: cloneSettings(state.filters),
      hideSkipped: state.hideSkipped,
      hideLinks: state.hideLinks,
      hideImages: state.hideImages,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection
    },
    events: state.runDiagnostics.map((event) => ({
      elapsedMs: Math.round(event.elapsedMs),
      elapsed: formatDuration(event.elapsedMs),
      label: event.label,
      detail: event.detail
    })),
    rows: state.rows.map((row) => ({
      type: row.rowType,
      inputUrl: row.inputUrl,
      sourcePage: row.sourcePage,
      area: row.linkLocation,
      textAlt: row.linkText,
      finalUrl: row.finalUrl,
      statusCode: row.statusCode,
      redirectCount: row.redirectCount,
      responseTimeMs: row.responseTimeMs,
      title: row.title,
      metaDescription: row.metaDescription,
      h1: row.h1,
      metaRobots: row.metaRobots,
      canonical: row.canonical,
      wordCount: row.wordCount,
      missingAlt: row.missingAlt === true,
      result: row.result
    }))
  };
}

function diagnosticsEnvironment() {
  const userAgent = navigator.userAgent;
  return {
    userAgent,
    chromeVersion: getChromeVersion(userAgent),
    operatingSystem: getOperatingSystem(userAgent, navigator.platform),
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages ? [...navigator.languages] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
    screen: {
      width: window.screen?.width || null,
      height: window.screen?.height || null,
      devicePixelRatio: window.devicePixelRatio || null
    },
    extensionId: chrome.runtime?.id || ""
  };
}

function getChromeVersion(userAgent) {
  const match = String(userAgent || "").match(/(?:Chrome|CriOS|Edg)\/([\d.]+)/);
  return match ? match[1] : "";
}

function getOperatingSystem(userAgent, platform) {
  const text = `${userAgent || ""} ${platform || ""}`.toLowerCase();
  if (text.includes("windows nt 10")) {
    return "Windows 10/11";
  }
  if (text.includes("windows")) {
    return "Windows";
  }
  if (text.includes("mac os x") || text.includes("macintel")) {
    return "macOS";
  }
  if (text.includes("linux")) {
    return "Linux";
  }
  if (text.includes("android")) {
    return "Android";
  }
  if (text.includes("iphone") || text.includes("ipad")) {
    return "iOS/iPadOS";
  }
  return platform || "";
}

function resultsCsv() {
  const columns = exportColumns();
  const headers = columns.map((column) => column.header);
  const rows = exportRows().map((row) => columns.map((column) => column.value(row)));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function summaryCsv() {
  const rows = summaryCsvRows();
  return [["Section", "Metric", "Value", "Notes"], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function summaryCsvRows() {
  const stats = summaryStats();
  const manifest = appManifest();
  const duration = Math.round(state.lastRunDurationMs || (state.runStartedAt ? performance.now() - state.runStartedAt : 0));
  const settings = state.settings;

  return [
    ["Run detail", "Generated at", new Date().toISOString(), ""],
    ["Run detail", "BulkStatus version", manifest.version || "dev", ""],
    ["Run detail", "Input source", inputModeLabel(), ""],
    ["Run detail", "Source URL", currentInputSourceUrl(), ""],
    ["Run detail", "Extraction mode", extractionModeLabel(), settings.extractionMode === "rendered" ? "JavaScript rendering" : "HTML fetch, JavaScript disabled"],
    ["Run detail", "Check links", settings.checkLinks ? "On" : "Off", ""],
    ["Run detail", "Check images", settings.checkImages ? "On" : "Off", ""],
    ["Run detail", "Check nav links", settings.ignoreNav ? "Off" : "On", ""],
    ["Run detail", "Check footer links", settings.ignoreFooter ? "Off" : "On", ""],
    ["Run detail", "Results density", settings.resultsDensity, "Results table display density"],
    ["Run detail", "Browser session for rendered checks", settings.useBrowserSessionForRenderedChecks ? "On" : "Off", "Uses Chrome login cookies for JavaScript-rendered checks"],
    ["Run detail", "Dedicated render window", settings.useDedicatedRenderWindow ? "On" : "Off", "Keeps JavaScript-rendered crawl tabs separate from the main Chrome window"],
    ["Run detail", "Input URL limit", settings.maxInputUrls, "Maximum pasted/uploaded page URLs checked in one run"],
    ["Run detail", "Discovered asset limit", settings.maxDiscoveredAssets, "Maximum discovered links/images checked after page discovery"],
    ["Run detail", "Duration ms", duration || "", ""],
    ["Overview", "Total items", stats.total, "Pages plus discovered links/images"],
    ["Overview", "Checked items", stats.checked, "Items with an HTTP status or fetch/check error"],
    ["Overview", "Pages", stats.pages, "Page URLs in crawl"],
    ["Overview", "Links", stats.links, "Discovered links"],
    ["Overview", "Images", stats.images, "Discovered images"],
    ["Overview", "Status issue items", stats.statusIssues, "Non-200 status or error items"],
    ["Overview", "404 items", stats.notFound, "Items with HTTP 404"],
    ["Overview", "Redirect items", stats.redirects, "Items with redirect count greater than 0"],
    ["Overview", "Skipped items", stats.skipped, "Items not checked because of filters or stopped crawl"],
    ["Status", "2xx", stats.families["2xx"], ""],
    ["Status", "3xx", stats.families["3xx"], ""],
    ["Status", "4xx", stats.families["4xx"], ""],
    ["Status", "5xx", stats.families["5xx"], ""],
    ["Status", "Errors", stats.errors, "Items with an error and no HTTP status"],
    ["Status", "Skipped", stats.skipped, ""],
    ["Page issues", "Missing Page Title Tag", stats.pageIssues.missingTitle, "Pages only"],
    ["Page issues", "Missing Meta Description", stats.pageIssues.missingDescription, "Pages only"],
    ["Page issues", "Missing H1 Tag", stats.pageIssues.missingH1, "Pages only"],
    ["Page issues", "Missing Canonical Tag", stats.pageIssues.missingCanonical, "Pages only"],
    ["Page issues", "Canonicalized Page", stats.pageIssues.canonicalizedPages, "Pages where canonical differs from final URL"],
    ["Page issues", "Meta Robots Noindex", stats.pageIssues.noindexPages, "Pages only"],
    ["Asset issues", "Non-200 links", stats.non200Links, "Links with non-200 status or redirects"],
    ["Asset issues", "Non-200 images", stats.non200Images, "Images with non-200 status or redirects"],
    ["Asset issues", "Missing Image Alt Text", stats.pageIssues.missingImageAlt, "Images only"],
    ["Asset issues", "Skipped assets", stats.assetSkipped, "Discovered assets skipped by filters"]
  ];
}

function exportColumns() {
  return [
    { key: "state", header: "Crawl state", value: (row) => rowState(row).label },
    { key: "type", header: "Type", value: (row) => row.rowType },
    { key: "inputUrl", header: "Input URL", value: (row) => row.inputUrl },
    { key: "sourcePage", header: "Source page", value: (row) => row.sourcePage },
    { key: "area", header: "Area", value: (row) => row.linkLocation },
    { key: "textAlt", header: "Text / alt", value: (row) => row.linkText },
    { key: "finalUrl", header: "Final URL after redirects", value: (row) => row.finalUrl },
    { key: "status", header: "HTTP status code", value: (row) => row.statusCode },
    { key: "redirects", header: "Redirect count", value: (row) => row.redirectCount },
    {
      key: "time",
      header: state.settings.timeDisplayUnit === "milliseconds" ? "Response time (ms)" : "Response time (s)",
      value: (row) => formatResponseTimeForExport(row.responseTimeMs)
    },
    { key: "linkIssues", header: "Non-200 links", value: (row) => row.rowType === "Page" ? countNon200Children(row.groupId, "Link") : "" },
    { key: "imageIssues", header: "Non-200 images", value: (row) => row.rowType === "Page" ? countNon200Children(row.groupId, "Image") : "" },
    { key: "title", header: "Page title", value: (row) => row.title },
    { key: "description", header: "Meta description", value: (row) => row.metaDescription },
    { key: "h1", header: "H1", value: (row) => row.h1 },
    { key: "robots", header: "Meta Robots", value: (row) => row.metaRobots },
    { key: "canonical", header: "Canonical", value: (row) => row.canonical },
    { key: "words", header: "Word count", value: (row) => row.wordCount },
    { key: "result", header: "Result", value: (row) => row.result }
  ].filter((column) => isColumnVisible(column.key));
}

function pageGroupId(index) {
  return `page-${index}`;
}

function formatMaybeNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : value;
}

function formatResponseTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? `${formatMaybeNumber(number)} ms`
    : `${formatSeconds(number)} s`;
}

function formatRenderWaitDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? `${formatMaybeNumber(number)} ms`
    : `${formatSeconds(number)} s`;
}

function formatResponseTimeForExport(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? number
    : formatSeconds(number);
}

function formatSeconds(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  const digits = seconds < 1 ? 2 : 1;
  return seconds.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function csvCell(value) {
  const text = value === 0 ? "0" : String(value || "");
  return `"${text.replace(/"/g, '""')}"`;
}

function flashButton(button, label) {
  const text = button.querySelector("span") || button;
  if (!text || !text.textContent) {
    return;
  }

  const previous = text.textContent;
  text.textContent = label;
  window.setTimeout(() => {
    text.textContent = previous;
  }, 1200);
}

function flashIconButton(button, label) {
  const previousTitle = button.title;
  const previousLabel = button.getAttribute("aria-label") || previousTitle;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "true");
  window.setTimeout(() => {
    button.title = previousTitle;
    button.setAttribute("aria-label", previousLabel);
    button.setAttribute("aria-pressed", "false");
  }, 1200);
}

function toggleSettings() {
  if (elements.settingsBand.hidden) {
    openSettings();
  } else {
    closeSettings();
  }
}

function openSettings() {
  elements.settingsBand.hidden = false;
  elements.settingsButton.setAttribute("aria-pressed", "true");
  // Settings open near the top, so bring the panel into view in case the user
  // clicked the icon while scrolled down (otherwise the click looks like a no-op).
  requestAnimationFrame(() => {
    elements.settingsBand.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function closeSettings() {
  elements.settingsBand.hidden = true;
  elements.settingsButton.setAttribute("aria-pressed", "false");
}

function resetSettings() {
  state.settings = getDefaultSettings();
  state.activePreset = "";
  state.settingsBeforePreset = null;
  localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
  loadSettings();
  updatePresetButtons();
  applyColumnVisibility();
  renderResults();
}

function saveCurrentSettingsAsDefault() {
  saveSettingsFromInputs();
  const savedDefault = { ...state.settings, settingsVersion: SETTINGS_VERSION };
  localStorage.setItem("bulkstatus-default-settings", JSON.stringify(savedDefault));
  flashButton(elements.saveDefaultsButton, "Saved");
}

function applyPreset(preset) {
  if (state.activePreset === preset) {
    state.settings = normalizeSettings(state.settingsBeforePreset || getDefaultSettings());
    state.activePreset = "";
    state.settingsBeforePreset = null;
    localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
    loadSettings();
    updatePresetButtons();
    applyColumnVisibility();
    renderResults();
    return;
  }

  const presets = {
    "full-rendered": {
      checkLinks: true,
      checkImages: true,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 3,
      linkDelayMs: 300
    },
    links: {
      checkLinks: true,
      checkImages: false,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 4,
      linkDelayMs: 250
    },
    images: {
      checkLinks: false,
      checkImages: true,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 4,
      linkDelayMs: 250
    },
    fast: {
      checkLinks: false,
      checkImages: false,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "static",
      pageConcurrency: 8,
      linkConcurrency: 4,
      linkDelayMs: 0
    }
  };
  const next = presets[preset];

  if (!next) {
    return;
  }

  if (!state.activePreset) {
    state.settingsBeforePreset = cloneSettings(state.settings);
  }
  state.settings = normalizeSettings({
    ...state.settings,
    ...next
  });
  state.activePreset = preset;
  localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
  loadSettings();
  updatePresetButtons();
  applyColumnVisibility();
  renderResults();
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function updatePresetButtons() {
  elements.presetButtons.forEach((button) => {
    const active = button.dataset.preset === state.activePreset;
    button.setAttribute("aria-pressed", String(active));
  });
}

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  localStorage.setItem("bulkstatus-theme", next);
  applyTheme(next);
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  elements.themeLightButton.hidden = next === "light";
  elements.themeLightButton.style.display = next === "light" ? "none" : "";
  elements.themeLightButton.setAttribute("aria-pressed", "false");
  elements.themeDarkButton.hidden = next === "dark";
  elements.themeDarkButton.style.display = next === "dark" ? "none" : "";
  elements.themeDarkButton.setAttribute("aria-pressed", "false");
  elements.themePreferenceInput.value = next;
}

function defaultTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function delay(ms) {
  const duration = Number(ms) || 0;
  if (duration <= 0 || state.stopRequested) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let remaining = duration;
    let lastTick = performance.now();

    function tick() {
      if (state.stopRequested) {
        resolve();
        return;
      }

      const now = performance.now();
      if (!state.paused) {
        remaining -= now - lastTick;
      }
      lastTick = now;

      if (remaining <= 0) {
        resolve();
        return;
      }

      window.setTimeout(tick, Math.min(remaining, 200));
    }

    tick();
  });
}
