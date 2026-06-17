// Network layer for URL checking. Dependency-injected so it can be unit-tested
// without a browser: pass `fetchImpl`, `now`, `signalRegistry`, and `isStopRequested`.
//
// Options shared across these functions:
//   redirect        - fetch redirect mode (default "follow")
//   credentials     - "include" or "omit" (default "omit")
//   timeoutMs       - abort the request after this many ms (default 10000)
//   fetchImpl       - fetch implementation (default global fetch)
//   signalRegistry  - optional Set the active AbortController is added to / removed from
//   isStopRequested - optional () => boolean; when true, an abort is reported as "Run stopped"
//   now             - optional () => number timestamp source (default performance.now)

import { resolveUrl, normalizeUrl, estimateRedirectCount } from "./url.js";

const MAX_REDIRECT_HOPS = 10;

export async function fetchWithTimeout(url, options = {}) {
  const {
    redirect = "follow",
    credentials = "omit",
    timeoutMs = 10000,
    fetchImpl = fetch,
    signalRegistry,
    isStopRequested
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signalRegistry?.add(controller);

  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect,
      credentials: credentials === "include" ? "include" : "omit",
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (isStopRequested?.() && error?.name === "AbortError") {
      throw new Error("Run stopped");
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signalRegistry?.delete(controller);
  }
}

export async function fetchTrace(url, options = {}) {
  let currentUrl = url;
  let firstRedirect = null;

  for (let redirectCount = 0; redirectCount < MAX_REDIRECT_HOPS; redirectCount += 1) {
    const response = await fetchWithTimeout(currentUrl, { ...options, redirect: "manual" });
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      if (!firstRedirect) {
        firstRedirect = {
          status: response.status,
          statusText: response.statusText,
          ok: false
        };
      }

      currentUrl = resolveUrl(location, currentUrl);
      continue;
    }

    if (response.type === "opaqueredirect" || response.status === 0) {
      const followed = await fetchWithTimeout(url, { ...options, redirect: "follow" });
      return {
        finalUrl: followed.url || url,
        status: followed.status,
        statusText: followed.statusText,
        redirectCount: estimateRedirectCount(url, followed.url || url),
        ok: followed.ok
      };
    }

    return {
      finalUrl: response.url || currentUrl,
      status: firstRedirect?.status || response.status,
      statusText: firstRedirect?.statusText || response.statusText,
      redirectCount,
      ok: firstRedirect ? false : response.ok
    };
  }

  return {
    finalUrl: currentUrl,
    status: firstRedirect?.status || "",
    statusText: "Too many redirects",
    redirectCount: MAX_REDIRECT_HOPS,
    ok: false
  };
}

export async function checkUrlStatus(url, options = {}) {
  const now = options.now || (() => performance.now());

  try {
    const normalizedUrl = normalizeUrl(url);
    const startedAt = now();
    const response = await fetchTrace(normalizedUrl, options);
    return {
      finalUrl: response.finalUrl || normalizedUrl,
      statusCode: response.status,
      redirectCount: response.redirectCount,
      responseTimeMs: Math.round(now() - startedAt),
      result: response.ok ? "" : response.statusText || "HTTP request did not succeed"
    };
  } catch (error) {
    return {
      finalUrl: "",
      statusCode: "",
      redirectCount: "",
      responseTimeMs: "",
      result: error.message || String(error)
    };
  }
}
