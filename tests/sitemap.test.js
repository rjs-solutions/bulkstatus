import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLlmsUrls, parseSitemapXml } from "../extension/src/app/lib/sitemap.js";

// extractLlmsUrls is DOM-free (pure regex), so it can be tested directly.
test("extractLlmsUrls pulls markdown links and bare URLs, resolving relatives", () => {
  const text = [
    "# Docs",
    "- [Home](/index.html)",
    "- [API](https://api.example.com/v1)",
    "See https://example.com/raw, and https://example.com/end.",
    "Ignore mailto:[email protected] and #anchor"
  ].join("\n");

  const urls = extractLlmsUrls(text, "https://example.com/");
  assert.ok(urls.includes("https://example.com/index.html"));
  assert.ok(urls.includes("https://api.example.com/v1"));
  assert.ok(urls.includes("https://example.com/raw"));
  // trailing punctuation trimmed from bare URL
  assert.ok(urls.includes("https://example.com/end"));
  assert.ok(!urls.some((u) => u.startsWith("mailto")));
});

// parseSitemapXml accepts an injected parser, so we can feed a minimal fake
// document and verify the loc-extraction + URL-resolution logic without a real DOM.
function fakeLoc(text) {
  return { localName: "loc", textContent: text };
}
function fakeEntry(locText) {
  return { children: [fakeLoc(locText)] };
}
function fakeParser({ urls = [], sitemaps = [], error = false } = {}) {
  return {
    parseFromString() {
      return {
        querySelector: (sel) => (sel === "parsererror" && error ? {} : null),
        getElementsByTagName: (tag) =>
          tag === "url" ? urls.map(fakeEntry) : tag === "sitemap" ? sitemaps.map(fakeEntry) : [],
        getElementsByTagNameNS: () => []
      };
    }
  };
}

test("parseSitemapXml extracts and resolves <loc> values", () => {
  const parser = fakeParser({
    urls: ["https://example.com/a", "/b"],
    sitemaps: ["https://example.com/sitemap2.xml"]
  });
  const result = parseSitemapXml("<xml/>", "https://example.com/", parser);
  assert.deepEqual(result.urls, ["https://example.com/a", "https://example.com/b"]);
  assert.deepEqual(result.sitemaps, ["https://example.com/sitemap2.xml"]);
});

test("parseSitemapXml throws when the document reports a parser error", () => {
  const parser = fakeParser({ error: true });
  assert.throws(() => parseSitemapXml("<bad", "https://example.com/", parser), /could not be parsed/);
});
