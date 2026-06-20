// Derived run configuration: effective concurrency for the current extraction
// mode, and human-readable labels. Shared by the crawl engine and settings.

import { state } from "./state.js";
import { formatMaybeNumber } from "./format.js";

export function extractionModeLabel() {
  return state.settings.extractionMode === "rendered"
    ? "JavaScript rendering"
    : "HTML fetch with JavaScript disabled";
}

export function inputModeLabel() {
  if (state.inputMode === "sitemap") {
    return "XML sitemap";
  }
  if (state.inputMode === "llms") {
    return "llms.txt";
  }
  return "URL list";
}

export function currentPageConcurrency() {
  return state.settings.extractionMode === "rendered"
    ? state.settings.renderedConcurrency
    : state.settings.pageConcurrency;
}

export function currentPageConcurrencyMax() {
  return state.settings.extractionMode === "rendered" ? 3 : 12;
}

export function currentAssetConcurrency() {
  return state.settings.linkConcurrency;
}

export function refreshCurrentPhaseConcurrency() {
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
