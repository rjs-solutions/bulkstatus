// Pure text + number helpers. No DOM or extension-state dependencies.

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function cssEscape(value) {
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
    return globalThis.CSS.escape(value);
  }

  return String(value).replace(/"/g, '\\"');
}

export function countWords(value) {
  const matches = cleanText(value).match(/\b[\p{L}\p{N}'-]+\b/gu);
  return matches ? matches.length : 0;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}
