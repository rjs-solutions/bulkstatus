import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFamily, isNon200HttpStatus } from "../extension/src/app/lib/status.js";
import {
  formatEstimatedDuration,
  formatDuration,
  formatDurationLong
} from "../extension/src/app/lib/duration.js";

test("statusFamily buckets by hundreds", () => {
  assert.equal(statusFamily(200), "2xx");
  assert.equal(statusFamily(301), "3xx");
  assert.equal(statusFamily(404), "4xx");
  assert.equal(statusFamily(503), "5xx");
  assert.equal(statusFamily(0), "");
  assert.equal(statusFamily(""), "");
});

test("isNon200HttpStatus is true only for real non-200 codes", () => {
  assert.equal(isNon200HttpStatus(200), false);
  assert.equal(isNon200HttpStatus(301), true);
  assert.equal(isNon200HttpStatus(0), false);
  assert.equal(isNon200HttpStatus(""), false);
});

test("formatEstimatedDuration uses friendly units", () => {
  assert.equal(formatEstimatedDuration(45000), "45 sec");
  assert.equal(formatEstimatedDuration(750000), "12 min 30 sec");
  assert.equal(formatEstimatedDuration(600000), "10 min");
  assert.equal(formatEstimatedDuration(81000000), "about 22 hr 30 min");
  assert.match(formatEstimatedDuration(200000000), /^about 2 days/);
});

test("formatDuration returns clock style", () => {
  assert.equal(formatDuration(90000), "1:30");
  assert.equal(formatDuration(5000), "0:05");
});

test("formatDurationLong returns spelled units", () => {
  assert.equal(formatDurationLong(90000), "1 min 30 sec");
  assert.equal(formatDurationLong(5000), "5 sec");
});
