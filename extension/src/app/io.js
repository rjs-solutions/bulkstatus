// I/O: input-source loading (sitemap / llms.txt / file upload), CSV + clipboard
// export, the diagnostics payload, the update banner, and external links.

import {
  CHROME_WEB_STORE_LISTING_URL,
  GITHUB_REPO_URL,
  CHANGELOG_URL,
  GITHUB_ISSUES_URL,
  LAST_SEEN_VERSION_KEY,
  MIN_FETCH_SPINNER_MS
} from "./constants.js";
import { normalizeUrl, comparableUrl } from "./lib/url.js";
import { parseSitemapXml, extractLlmsUrls } from "./lib/sitemap.js";
import { formatDuration } from "./lib/duration.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import {
  formatNumber,
  formatMaybeNumber,
  formatResponseTimeForExport,
  csvCell
} from "./format.js";
import { is404Row, isIssueRow } from "./predicates.js";
import { showToast, flashButton, flashIconButton, openExternalUrl } from "./ui-utils.js";
import { ensureHostPermission, hostPermissionError } from "./permissions.js";
import {
  parseUrls,
  updateInputUrlCount,
  currentInputSourceUrl,
  normalizeInputMode,
  urlListHelpText,
  inputModeHelpText,
  saveCurrentInputModeText
} from "./input-parse.js";
import { extractionModeLabel, inputModeLabel } from "./run-config.js";
import { appManifest, currentAppVersion, diagnosticsEnvironment } from "./environment.js";
import { fetchWithTimeout } from "./crawl.js";
import { cloneSettings, saveSettingsFromInputs } from "./settings.js";
import {
  exportRows,
  summaryStats,
  setControls,
  countNon200Children,
  isColumnVisible,
  rowState
} from "./results-ui.js";

export let lastSourceStatusMessage = "";

export function setInputMode(mode) {
  const nextMode = normalizeInputMode(mode);
  if (nextMode === state.inputMode) {
    return;
  }

  saveCurrentInputModeText();
  state.inputMode = nextMode;
  localStorage.setItem("bulkstatus-input-mode", nextMode);
  renderInputMode();
}

export function renderInputMode() {
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

export async function loadInputSource() {
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

export async function loadSitemapInputUrls(sourceUrl) {
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

export async function loadLlmsInputUrls(sourceUrl) {
  const { text, finalUrl } = await fetchInputSourceText(sourceUrl, "llms.txt");
  return {
    urls: extractLlmsUrls(text, finalUrl || sourceUrl),
    note: ""
  };
}

export async function fetchInputSourceText(sourceUrl, sourceName) {
  const response = await fetchWithTimeout(sourceUrl, "follow");
  if (!response.ok) {
    throw new Error(`Could not fetch ${sourceName}. HTTP ${response.status}.`);
  }

  return {
    text: await response.text(),
    finalUrl: response.url || sourceUrl
  };
}

export function setSourceStatus(message) {
  const text = String(message || "").trim();
  // Only surface a toast when the status actually changes, so repeated calls
  // with the same message (or input-mode switches) don't re-pop the same toast.
  if (text && text !== lastSourceStatusMessage) {
    showToast(text);
  }
  lastSourceStatusMessage = text;
}

export async function handleFileUpload(event) {
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

export function exportCsv() {
  const csv = resultsCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportSummaryCsv() {
  const csv = summaryCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copyUrls() {
  await navigator.clipboard.writeText(elements.urlInput.value.trim());
  flashButton(elements.copyUrlsButton, "Copied");
}

export function openStoreListing() {
  if (globalThis.chrome?.tabs?.create) {
    globalThis.chrome.tabs.create({ url: CHROME_WEB_STORE_LISTING_URL });
    return;
  }

  window.open(CHROME_WEB_STORE_LISTING_URL, "_blank", "noopener");
}

export async function shareStoreListing() {
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

export function maybeShowUpdateBanner() {
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

export function markUpdateSeen() {
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

export function bindUpdateNotice() {
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

export function bindVersionLink() {
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

export function bindAppLinks() {
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

export async function copyAiSummaryPrompt() {
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

export async function copySummary() {
  await navigator.clipboard.writeText(summaryCsv());
  flashButton(elements.copySummaryButton, "Copied");
}

export async function copyResults() {
  await navigator.clipboard.writeText(resultsCsv());
  flashButton(elements.copyResultsButton, "Copied");
}

export async function copyDiagnostics() {
  await navigator.clipboard.writeText(diagnosticsText());
  flashButton(elements.copyDiagnosticsButton, "Copied");
}

export function downloadDiagnostics() {
  const blob = new Blob([JSON.stringify(diagnosticsPayload(), null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function diagnosticsText() {
  return state.runDiagnostics.map((event) => (
    `[+${formatDuration(event.elapsedMs)}] ${event.label}: ${event.detail}`
  )).join("\n");
}

export function diagnosticsPayload() {
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

export function resultsCsv() {
  const columns = exportColumns();
  const headers = columns.map((column) => column.header);
  const rows = exportRows().map((row) => columns.map((column) => column.value(row)));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function summaryCsv() {
  const rows = summaryCsvRows();
  return [["Section", "Metric", "Value", "Notes"], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

export function summaryCsvRows() {
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

export function exportColumns() {
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
