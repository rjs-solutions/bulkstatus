import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, escapeHtml, countWords, clampNumber } from "../extension/src/app/lib/text.js";

test("cleanText collapses whitespace and trims", () => {
  assert.equal(cleanText("  a\n  b\t c "), "a b c");
  assert.equal(cleanText(null), "");
});

test("escapeHtml escapes all five entities", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("countWords counts unicode word tokens", () => {
  assert.equal(countWords("hello world"), 2);
  assert.equal(countWords("  spaced   out  text "), 3);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("café déjà-vu"), 2);
});

test("clampNumber clamps, rounds, and falls back", () => {
  assert.equal(clampNumber("1,500", 1, 1000, 10), 1000);
  assert.equal(clampNumber("0", 1, 1000, 10), 1);
  assert.equal(clampNumber("42.6", 1, 1000, 10), 43);
  assert.equal(clampNumber("abc", 1, 1000, 10), 10);
});
