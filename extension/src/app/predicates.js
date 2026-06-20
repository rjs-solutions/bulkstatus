// Pure row-classification helpers. Each takes a row (or value) and returns a
// boolean/derived value; none read shared state, so they stay easy to reason about.

import { cleanText } from "./lib/text.js";
import { comparableUrl } from "./lib/url.js";
import { isNon200HttpStatus } from "./lib/status.js";

export function is404Row(row) {
  return Number(row.statusCode) === 404;
}

export function normalizedArea(value) {
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

export function isErrorRow(row) {
  return Boolean(row.result && !isPendingResult(row.result) && row.result !== "Run stopped" && !row.result.startsWith("Not checked") && !row.statusCode);
}

export function isIssueRow(row) {
  return isErrorRow(row) || isNon200HttpStatus(row.statusCode);
}

export function isCheckedRow(row) {
  return Boolean(row.statusCode) || isErrorRow(row);
}

export function hasEvaluatedPageMetadata(row) {
  return row.rowType === "Page" && Boolean(row.statusCode) && !isPendingResult(row.result) && !isSkippedRow(row);
}

export function isMissingTitleRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.title);
}

export function isMissingDescriptionRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.metaDescription);
}

export function isMissingH1Row(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.h1);
}

export function isMissingCanonicalRow(row) {
  return hasEvaluatedPageMetadata(row) && !cleanText(row.canonical);
}

export function isCanonicalizedPageRow(row) {
  return row.rowType === "Page" &&
    Boolean(cleanText(row.canonical)) &&
    Boolean(cleanText(row.finalUrl)) &&
    comparableUrl(row.canonical) !== comparableUrl(row.finalUrl);
}

export function isNoindexPageRow(row) {
  return row.rowType === "Page" && /\bnoindex\b/i.test(row.metaRobots || "");
}

export function isMissingImageAltRow(row) {
  return row.rowType === "Image" && row.missingAlt === true;
}

export function rowSearchText(row) {
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

export function isNon200Status(statusCode, redirectCount = 0) {
  const code = Number(statusCode);
  return Boolean((code && code !== 200) || Number(redirectCount) > 0);
}

export function isSkippedRow(row) {
  return Boolean(row.result && row.result.startsWith("Not checked"));
}

export function isPendingResult(result) {
  return result === "Queued" || result === "Checking";
}

export function isRetryableErrorRow(row) {
  return ["Page", "Link", "Image"].includes(row.rowType) && isErrorRow(row);
}
