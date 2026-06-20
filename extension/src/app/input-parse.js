// Parsing and counting of the raw URL input, plus the input-mode help copy.
// Low-level: depends only on constants, lib, format, shared state, and DOM.

import { MAX_INPUT_URL_LIMIT, DEFAULT_SETTINGS } from "./constants.js";
import { clampNumber } from "./lib/text.js";
import { formatNumber, formatMaybeNumber } from "./format.js";
import { state } from "./state.js";
import { elements } from "./dom.js";

export function normalizeInputMode(mode) {
  return ["list", "sitemap", "llms"].includes(mode) ? mode : "list";
}

export function updateInputLimitCopy() {
  elements.sourceInputHelp.textContent = inputModeHelpText(state.inputMode);
}

export function urlListHelpText() {
  return "Add URLs by uploading a TXT/CSV file, or type them in the box below.";
}

export function inputModeHelpText(mode) {
  const limit = formatNumber(state.settings.maxInputUrls);

  if (mode === "sitemap") {
    return `Fetches the sitemap, follows sitemap indexes, and extracts page URLs. Current input URL limit: ${limit}. Adjust in Settings.`;
  }

  if (mode === "llms") {
    return `Fetches llms.txt and extracts Markdown links and bare URLs. Current input URL limit: ${limit}. Adjust in Settings.`;
  }

  return urlListHelpText();
}

export function currentInputSourceUrl() {
  return state.inputMode === "list"
    ? ""
    : state.sourceUrlByMode[state.inputMode] || elements.sourceUrlInput.value;
}

export function saveCurrentInputModeText() {
  state.inputTextByMode[state.inputMode] = elements.urlInput.value;
  if (state.inputMode !== "list") {
    state.sourceUrlByMode[state.inputMode] = elements.sourceUrlInput.value;
  }
}

export function updateInputUrlCount() {
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

export function parseUrls(value, limit) {
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
