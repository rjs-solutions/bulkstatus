// Number, duration, and CSV value formatting. Time-based formatters read the
// current time-display unit from shared state.

import { state } from "./state.js";

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

export function formatMaybeNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : value;
}

export function formatResponseTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? `${formatMaybeNumber(number)} ms`
    : `${formatSeconds(number)} s`;
}

export function formatRenderWaitDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? `${formatMaybeNumber(number)} ms`
    : `${formatSeconds(number)} s`;
}

export function formatResponseTimeForExport(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  return state.settings.timeDisplayUnit === "milliseconds"
    ? number
    : formatSeconds(number);
}

export function formatSeconds(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  const digits = seconds < 1 ? 2 : 1;
  return seconds.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function onOff(value) {
  return value ? "on" : "off";
}

export function csvCell(value) {
  const text = value === 0 ? "0" : String(value || "");
  return `"${text.replace(/"/g, '""')}"`;
}
