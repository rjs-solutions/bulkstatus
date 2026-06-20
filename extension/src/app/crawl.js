// Crawl engine: run orchestration, concurrency, pause/stop, page status checks
// (static + rendered), HTML metadata + asset extraction, and link/area
// classification. Drives the results UI; never imported by it.

import {
  AUTH_PAUSE_THRESHOLD,
  AUTH_STATUS_CODES,
  MAX_RENDER_WAIT_MS,
  RENDER_STABILITY_POLL_MS,
  RENDER_STABILITY_MIN_WAIT_MS,
  RENDER_STABILITY_TEXT_TOLERANCE,
  RENDERED_TAB_RETRY_ATTEMPTS,
  RENDERED_TAB_RETRY_BASE_MS,
  DEFAULT_SETTINGS
} from "./constants.js";
import { cleanText, cssEscape, countWords, clampNumber } from "./lib/text.js";
import { formatDurationLong } from "./lib/duration.js";
import {
  normalizeUrl,
  resolveUrl,
  hostnameFor,
  estimateRedirectCount,
  collapseResponsiveImageUrl,
  firstSrcsetCandidate
} from "./lib/url.js";
import * as net from "./lib/network.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import { formatMaybeNumber, formatRenderWaitDuration, onOff } from "./format.js";
import { isErrorRow, isPendingResult } from "./predicates.js";
import { delay, setStatus } from "./ui-utils.js";
import {
  currentPageConcurrency,
  currentPageConcurrencyMax,
  currentAssetConcurrency,
  refreshCurrentPhaseConcurrency,
  extractionModeLabel,
  inputModeLabel
} from "./run-config.js";
import {
  ensureHostPermission,
  ensureRenderedPermission,
  renderedPermissionError,
  hostPermissionError
} from "./permissions.js";
import { parseUrls, saveCurrentInputModeText } from "./input-parse.js";
import { saveSettingsFromInputs } from "./settings.js";
import {
  renderResults,
  scheduleResultsRender,
  setControls,
  updateProgress,
  renderProgress,
  renderDiagnostics,
  addRunDiagnostic,
  addEnvironmentDiagnostic,
  addPageDiagnostic,
  setRunPhase,
  summarizeAssetResults,
  retryableErrorEntries,
  clearResultFilters,
  resetResultsPagination
} from "./results-ui.js";

export function setKeepAwake(on) {
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

export async function runChecks() {
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

export async function retryErrorResults(options = {}) {
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

export async function finishRetryErrors(attempted, recovered, runError = "", automatic = false) {
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

export function assetJobFromRow(row) {
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

export async function runAssetChecks(assetJobs) {
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

export function addUnprocessedAssetRows(assetJobs, fallbackReason) {
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

export function groupAssetJobs(jobs) {
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

export function assetCacheKey(job) {
  return `${job.kind}::${job.href}::${job.linkLocation}`;
}

export async function finishRun(completedNormally, runError = "") {
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

export function markQueuedRowsStopped() {
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

export function markPageRowChecking(index) {
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

export async function runWithConcurrency(items, limit, worker, options = {}) {
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

export function waitWhilePaused() {
  if (!state.paused || state.stopRequested) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    state.pauseResolvers.push(resolve);
  }).then(waitWhilePaused);
}

export function resolvePauseWaiters() {
  const resolvers = state.pauseResolvers.splice(0);
  resolvers.forEach((resolve) => resolve());
}

export async function checkPage(url) {
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

export function maybePauseForAuthWall(row) {
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

export async function checkStaticPage(url, resultNote = "") {
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

export async function checkRenderedPage(url) {
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

export async function createRenderedTab(url) {
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

export async function ensureDedicatedRenderWindow() {
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

export async function closeDedicatedRenderWindow() {
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

export function isTransientTabOperationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("tabs cannot be edited right now")
    || message.includes("user may be dragging a tab")
    || message.includes("tab strip")
    || message.includes("cannot edit tabs");
}

export function collectRenderedDocument() {
  return {
    finalUrl: window.location.href,
    html: document.documentElement ? document.documentElement.outerHTML : ""
  };
}

export function collectRenderedStabilitySnapshot() {
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

export function waitForTabLoad(tabId, timeoutMs) {
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

export async function waitForRenderedDomStability(tabId, maxWaitMs) {
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

export function isRenderedSnapshotStable(previous, next) {
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

export function statusRequestOptions() {
  return {
    credentials: state.settings.extractionMode === "rendered" && state.settings.useBrowserSessionForRenderedChecks
      ? "include"
      : "omit"
  };
}

export function networkRunOptions(extra = {}) {
  return {
    timeoutMs: state.settings.timeoutMs,
    signalRegistry: state.activeFetchControllers,
    isStopRequested: () => state.stopRequested,
    ...extra
  };
}

export async function checkUrlStatus(url, options = {}) {
  return net.checkUrlStatus(url, networkRunOptions({ credentials: options.credentials }));
}

export async function fetchWithTimeout(url, redirect = "follow", options = {}) {
  return net.fetchWithTimeout(url, networkRunOptions({ redirect, credentials: options.credentials }));
}

export function parseHtmlMetadata(html, baseUrl) {
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

export function extractAssets(html, baseUrl, sourceInputUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [
    ...(state.settings.checkLinks ? extractLinks(doc, baseUrl, sourceInputUrl) : []),
    ...(state.settings.checkImages ? extractImages(doc, baseUrl, sourceInputUrl) : [])
  ];
}

export function extractLinks(doc, baseUrl, sourceInputUrl) {
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

export function extractImages(doc, baseUrl, sourceInputUrl) {
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

export function getImageCandidate(element) {
  const direct = element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("data-image-src");
  if (direct) {
    return direct;
  }

  return firstSrcsetCandidate(element.getAttribute("srcset"));
}

export function classifyLinkLocation(element) {
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

export function classifyByLandmark(nodes) {
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

export function nodeClassificationText(node) {
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

export function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

export function getLinkText(element) {
  const text = cleanText(element.textContent);
  if (text) {
    return text;
  }

  const imageAlt = cleanText(element.querySelector("img[alt]")?.getAttribute("alt"));
  return imageAlt || cleanText(element.getAttribute("aria-label")) || cleanText(element.getAttribute("title"));
}

export function getImageLabel(element) {
  return getImageAltText(element) ||
    cleanText(element.getAttribute("aria-label")) ||
    cleanText(element.getAttribute("title")) ||
    cleanText(element.getAttribute("class")) ||
    cleanText(element.tagName);
}

export function getImageAltText(element) {
  if (element.tagName.toLowerCase() === "source") {
    return cleanText(element.closest("picture")?.querySelector("img")?.getAttribute("alt"));
  }

  return cleanText(element.getAttribute("alt"));
}

export function isMissingImageAltElement(element) {
  return !getImageAltText(element);
}

export function getSkippedReason(job) {
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

export function isExternalLink(job) {
  const norm = (value) => hostnameFor(value).replace(/^www\./, "");
  const src = norm(job.sourcePage);
  const dest = norm(job.href);
  return Boolean(src && dest && src !== dest);
}

export function isNavLikeLocation(location) {
  return location === "Nav" || location === "Breadcrumb";
}

export function isCheckableHref(href) {
  if (!href) {
    return false;
  }

  return /^https?:\/\//i.test(href);
}

export function emptyMetadata() {
  return {
    title: "",
    metaDescription: "",
    h1: "",
    metaRobots: "",
    canonical: "",
    wordCount: ""
  };
}

export function getMetaContent(doc, name) {
  return cleanText(doc.querySelector(`meta[name="${cssEscape(name)}" i]`)?.getAttribute("content"));
}

export function pendingPageRow(url) {
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

export function assetRow(job, result, skippedReason) {
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

export function assetResultNote(job, result) {
  if (!result) {
    return "";
  }

  if (job.kind === "Image" && Number(result.statusCode) === 403 && isLikelyProtectedImageCdn(job.href)) {
    return "Forbidden. Direct image check may be blocked by CDN/referrer protection.";
  }

  return result.result || "";
}

export function isLikelyProtectedImageCdn(value) {
  try {
    const url = new URL(value);
    return /scene7|akamai|cloudfront|cloudinary|fastly|adobedtm|assets\.adobedtm/i.test(url.hostname) ||
      /\/is\/image\//i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

export function toggleRunPause() {
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

export function stopRun() {
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

export function abortActiveFetches() {
  state.activeFetchControllers.forEach((controller) => {
    try {
      controller.abort();
    } catch (_error) {
      // Ignore abort races.
    }
  });
}

export function closeActiveRenderedTabs() {
  state.activeRenderedTabIds.forEach((tabId) => {
    try {
      chrome.tabs.remove(tabId);
    } catch (_error) {
      // The tab may already be closed.
    }
  });
  state.activeRenderedTabIds.clear();
}

export function pageGroupId(index) {
  return `page-${index}`;
}
