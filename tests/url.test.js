import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUrl,
  resolveUrl,
  comparableUrl,
  hostnameFor,
  estimateRedirectCount,
  collapseResponsiveImageUrl,
  firstSrcsetCandidate,
  cleanMarkdownHref,
  trimUrlTail,
  resolveLoadedUrl
} from "../extension/src/app/lib/url.js";

test("normalizeUrl adds https:// when scheme is missing", () => {
  assert.equal(normalizeUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
});

test("normalizeUrl throws on empty input", () => {
  assert.throws(() => normalizeUrl("   "), /URL is empty/);
});

test("resolveUrl resolves relative against base, falls back to cleaned value", () => {
  assert.equal(resolveUrl("/a", "https://x.com/b/c"), "https://x.com/a");
  assert.equal(resolveUrl("not a url", ""), "not a url");
  assert.equal(resolveUrl("", "https://x.com"), "");
});

test("comparableUrl strips hash and trailing slash, lowercases", () => {
  assert.equal(comparableUrl("https://X.com/Path/#frag"), "https://x.com/path");
  assert.equal(comparableUrl("https://x.com/"), "https://x.com/");
});

test("hostnameFor extracts lowercase host or empty", () => {
  assert.equal(hostnameFor("https://WWW.Example.com/x"), "www.example.com");
  assert.equal(hostnameFor("garbage"), "");
});

test("estimateRedirectCount returns 0 when identical, 1 when changed", () => {
  assert.equal(estimateRedirectCount("https://x.com/", "https://x.com/"), 0);
  assert.equal(estimateRedirectCount("https://x.com/", "https://x.com/new"), 1);
  assert.equal(estimateRedirectCount("", "https://x.com"), "");
});

test("collapseResponsiveImageUrl removes known sizing params only", () => {
  assert.equal(
    collapseResponsiveImageUrl("https://img.com/a.jpg?wid=200&hei=100&id=7"),
    "https://img.com/a.jpg?id=7"
  );
  assert.equal(collapseResponsiveImageUrl("not-a-url"), "not-a-url");
});

test("firstSrcsetCandidate returns the first URL token", () => {
  assert.equal(firstSrcsetCandidate("a.jpg 1x, b.jpg 2x"), "a.jpg");
  assert.equal(firstSrcsetCandidate(""), "");
});

test("cleanMarkdownHref strips angle brackets", () => {
  assert.equal(cleanMarkdownHref("<https://x.com>"), "https://x.com");
});

test("trimUrlTail removes trailing punctuation", () => {
  assert.equal(trimUrlTail("https://x.com/a."), "https://x.com/a");
  assert.equal(trimUrlTail("https://x.com/a),"), "https://x.com/a)");
});

test("resolveLoadedUrl rejects non-http(s) and fragments", () => {
  assert.equal(resolveLoadedUrl("mailto:a@b.com", "https://x.com"), "");
  assert.equal(resolveLoadedUrl("#section", "https://x.com"), "");
  assert.equal(resolveLoadedUrl("/page", "https://x.com"), "https://x.com/page");
  assert.equal(resolveLoadedUrl("javascript:void(0)", "https://x.com"), "");
});
