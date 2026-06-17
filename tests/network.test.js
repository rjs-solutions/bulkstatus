import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout, fetchTrace, checkUrlStatus } from "../extension/src/app/lib/network.js";

function res({ status = 200, statusText = "OK", location = null, url = "https://x.com/", ok, type = "basic" } = {}) {
  return {
    status,
    statusText,
    url,
    type,
    ok: ok ?? (status >= 200 && status < 300),
    headers: { get: (h) => (h.toLowerCase() === "location" ? location : null) }
  };
}

// A fetch double that serves responses from a queue (one per call).
function queuedFetch(responses) {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)];
}

const now = (() => {
  let t = 0;
  return () => (t += 5);
})();

test("checkUrlStatus reports a direct 200", async () => {
  const result = await checkUrlStatus("example.com", {
    fetchImpl: queuedFetch([res({ status: 200, url: "https://example.com/" })]),
    timeoutMs: 1000,
    now
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.finalUrl, "https://example.com/");
  assert.equal(result.redirectCount, 0);
  assert.equal(result.result, "");
  assert.equal(typeof result.responseTimeMs, "number");
});

test("fetchTrace follows a 301 and reports the first redirect status", async () => {
  const trace = await fetchTrace("https://x.com/old", {
    fetchImpl: queuedFetch([
      res({ status: 301, statusText: "Moved Permanently", location: "https://x.com/new" }),
      res({ status: 200, url: "https://x.com/new" })
    ]),
    timeoutMs: 1000
  });
  assert.equal(trace.status, 301);
  assert.equal(trace.ok, false);
  assert.equal(trace.redirectCount, 1);
  assert.equal(trace.finalUrl, "https://x.com/new");
});

test("fetchTrace handles opaque redirects by re-fetching with follow", async () => {
  const fetchImpl = async (_url, init) =>
    init.redirect === "manual"
      ? res({ type: "opaqueredirect", status: 0 })
      : res({ status: 200, url: "https://x.com/final" });
  const trace = await fetchTrace("https://x.com/start", { fetchImpl, timeoutMs: 1000 });
  assert.equal(trace.status, 200);
  assert.equal(trace.finalUrl, "https://x.com/final");
  assert.equal(trace.ok, true);
  assert.equal(trace.redirectCount, 1); // input != final
});

test("fetchTrace gives up after too many redirects", async () => {
  let n = 0;
  const fetchImpl = async () => res({ status: 301, location: `https://x.com/${n++}` });
  const trace = await fetchTrace("https://x.com/loop", { fetchImpl, timeoutMs: 1000 });
  assert.equal(trace.statusText, "Too many redirects");
  assert.equal(trace.redirectCount, 10);
  assert.equal(trace.ok, false);
});

test("fetchWithTimeout maps an abort to 'Run stopped' when stop was requested", async () => {
  const fetchImpl = async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  await assert.rejects(
    () => fetchWithTimeout("https://x.com", { fetchImpl, timeoutMs: 1000, isStopRequested: () => true }),
    /Run stopped/
  );
});

test("fetchWithTimeout registers and clears its controller in the signal registry", async () => {
  const registry = new Set();
  await fetchWithTimeout("https://x.com", {
    fetchImpl: async () => res({ status: 200 }),
    timeoutMs: 1000,
    signalRegistry: registry
  });
  assert.equal(registry.size, 0);
});

test("checkUrlStatus returns an error shape when fetch throws", async () => {
  const result = await checkUrlStatus("https://x.com", {
    fetchImpl: async () => {
      throw new Error("network down");
    },
    timeoutMs: 1000,
    now
  });
  assert.equal(result.statusCode, "");
  assert.equal(result.result, "network down");
});
