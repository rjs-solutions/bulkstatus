// Thin entry point: imports the feature modules and wires up the UI in init().
// Shared state + DOM live in state.js / dom.js; everything else is in its module.

import { CHANGELOG_URL, GITHUB_REPO_URL, GITHUB_ISSUES_URL, PRIVACY_URL } from "./constants.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import { scrollAppToTop, updateBackToTopVisibility, setResultsFullscreen, openExternalUrl } from "./ui-utils.js";
import { updateInputUrlCount } from "./input-parse.js";
import { appManifest } from "./environment.js";
import {
  loadSettings,
  bindSettings,
  toggleBooleanSettingFromChip,
  resetSettings,
  saveCurrentSettingsAsDefault,
  applyPreset,
  bindSettingsTabs,
  toggleSettings,
  openSettings,
  closeSettings,
  bindConfigTransfer,
  setTheme,
  applyTheme,
  defaultTheme
} from "./settings.js";
import {
  renderResults,
  renderPanelStates,
  clampPageSize,
  changeResultsPage,
  resetResultsPagination,
  applyColumnVisibility,
  toggleSort,
  updateSortHeaders,
  toggleFilterPanel,
  handleFilterChange,
  clearResultFilters,
  updateProgress,
  renderProgress,
  renderDiagnostics,
  renderSummaryPanel,
  setControls
} from "./results-ui.js";
import { runChecks, retryErrorResults, toggleRunPause, stopRun } from "./crawl.js";
import {
  setInputMode,
  renderInputMode,
  loadInputSource,
  handleFileUpload,
  exportCsv,
  exportSummaryCsv,
  copyUrls,
  copySummary,
  copyResults,
  copyDiagnostics,
  copyAiSummaryPrompt,
  downloadDiagnostics,
  openStoreListing,
  shareStoreListing,
  maybeShowUpdateBanner,
  bindUpdateNotice,
  bindVersionLink,
  bindAppLinks
} from "./io.js";

init();

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

function bindPanelToggles() {
  elements.panelToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panelToggle;
      state.panelCollapsed[panel] = !state.panelCollapsed[panel];
      renderPanelStates();
    });
  });
}

function updateVersionLabel() {
  const manifest = appManifest();
  elements.versionLabel.textContent = `Version ${manifest.version || "dev"}`;
  elements.versionLabel.title = `${manifest.name || "BulkStatus"} ${manifest.version || "dev"}`;
  if (elements.footerVersionButton) {
    elements.footerVersionButton.textContent = `BulkStatus v${manifest.version || "dev"}`;
  }
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

// Builds the dependency bundle that binds the pure lib/network.js layer to live run state
// (timeout, active-controller registry, and stop flag).

// During an active run, results render once per item. Coalesce those calls behind
// a single animation frame so a burst of completed items produces at most one
// render per frame. Direct renderResults() calls (completion/stop/pause and user
// actions) supersede any pending frame via cancelScheduledRender().

// Single pass over state.rows that tallies every count the filter panel and the
// summary need, replacing ~30 separate full-array .filter() passes per render.
// Reuses the existing row predicates so the totals stay identical.

// Child (non-page) row count per page group, built once per render so expandCell
// doesn't scan all of state.rows for every visible page row.

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

