// Pure URL helpers. Depend only on the WHATWG URL API and text helpers.

import { cleanText } from "./text.js";

export function normalizeUrl(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error("URL is empty");
  }

  try {
    return new URL(trimmed).href;
  } catch (_error) {
    return new URL(`https://${trimmed}`).href;
  }
}

export function resolveUrl(value, baseUrl) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return "";
  }

  try {
    return new URL(cleaned, baseUrl).href;
  } catch (_error) {
    return cleaned;
  }
}

export function comparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.href.toLowerCase();
  } catch (_error) {
    return cleanText(value).toLowerCase();
  }
}

export function hostnameFor(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

export function estimateRedirectCount(inputUrl, finalUrl) {
  if (!inputUrl || !finalUrl) {
    return "";
  }

  try {
    return new URL(inputUrl).href === new URL(finalUrl).href ? 0 : 1;
  } catch (_error) {
    return inputUrl === finalUrl ? 0 : 1;
  }
}

const RESPONSIVE_IMAGE_PARAMS = [
  "ar", "dpr", "fmt", "format", "hei", "height", "qlt",
  "quality", "resmode", "scale", "size", "wid", "width"
];

export function collapseResponsiveImageUrl(value) {
  try {
    const url = new URL(value);
    RESPONSIVE_IMAGE_PARAMS.forEach((param) => url.searchParams.delete(param));
    return url.href;
  } catch (_error) {
    return value;
  }
}

export function firstSrcsetCandidate(srcset) {
  return String(srcset || "")
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .find(Boolean) || "";
}

export function cleanMarkdownHref(value) {
  return String(value || "").trim().replace(/^<|>$/g, "");
}

export function trimUrlTail(value) {
  return String(value || "").replace(/[.,;:!?]+$/g, "");
}

export function resolveLoadedUrl(value, baseUrl) {
  const trimmed = cleanMarkdownHref(value);
  if (!trimmed || /^#/.test(trimmed) || /^(mailto|tel|javascript):/i.test(trimmed)) {
    return "";
  }

  try {
    const url = new URL(trimmed, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}
