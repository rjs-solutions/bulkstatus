// Settings: load/migrate/normalize, persistence, the settings panel + tabs,
// presets, config import/export, and theme. Imports the results UI to re-render
// after a settings change; never imported by it.

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  MAX_INPUT_URL_LIMIT,
  MAX_DISCOVERED_ASSET_LIMIT,
  MAX_RENDER_WAIT_MS,
  LEGACY_DEFAULT_INPUT_URL_LIMIT
} from "./constants.js";
import { clampNumber } from "./lib/text.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import { formatNumber } from "./format.js";
import { refreshCurrentPhaseConcurrency } from "./run-config.js";
import { updateInputLimitCopy } from "./input-parse.js";
import { currentAppVersion } from "./environment.js";
import { flashButton } from "./ui-utils.js";
import {
  renderResults,
  renderDiagnostics,
  applyResultsDensity,
  applyColumnVisibility,
  setControls,
  updateProgress
} from "./results-ui.js";

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("bulkstatus-settings") || "{}");
    state.settings = Object.keys(saved).length
      ? normalizeSettings(migrateSettings(saved))
      : getDefaultSettings();
  } catch (_error) {
    state.settings = getDefaultSettings();
  }

  elements.checkLinksInput.checked = state.settings.checkLinks;
  elements.checkImagesInput.checked = state.settings.checkImages;
  elements.collapseResponsiveImagesInput.checked = state.settings.collapseResponsiveImages;
  elements.dedupeLinksInput.checked = state.settings.dedupeLinks;
  elements.autoRetryErrorsInput.checked = state.settings.autoRetryErrors;
  elements.keepAwakeInput.checked = state.settings.keepAwake;
  elements.ignoreNavInput.checked = !state.settings.ignoreNav;
  elements.ignoreFooterInput.checked = !state.settings.ignoreFooter;
  elements.checkExternalLinksInput.checked = state.settings.checkExternalLinks;
  elements.extractionModeInput.checked = state.settings.extractionMode === "rendered";
  elements.renderedConcurrencyInput.value = formatNumber(state.settings.renderedConcurrency);
  elements.renderWaitInput.value = formatRenderWaitInputValue(state.settings.renderWaitMs);
  elements.openInactiveInput.checked = state.settings.openInactive;
  elements.useDedicatedRenderWindowInput.checked = state.settings.useDedicatedRenderWindow;
  elements.useBrowserSessionInput.checked = state.settings.useBrowserSessionForRenderedChecks;
  elements.closeRenderedTabsInput.checked = state.settings.closeRenderedTabs;
  elements.timeDisplayUnitInput.value = state.settings.timeDisplayUnit;
  elements.resultsDensityInput.checked = state.settings.resultsDensity === "dense";
  elements.columnToggles.forEach((input) => {
    input.checked = state.settings.visibleColumns[input.dataset.columnToggle] !== false;
  });
  applyResultsDensity();
  formatNumericInputs();
  updateExtractionModeUi();
  updateModeHint();
  updateInputLimitCopy();
}

export function migrateSettings(saved) {
  const settings = saved || {};
  const version = Number(settings.settingsVersion || 0);
  const migrated = {
    ...DEFAULT_SETTINGS,
    ...settings,
    settingsVersion: SETTINGS_VERSION,
    ignoreNav: settings.ignoreNav ?? DEFAULT_SETTINGS.ignoreNav,
    ignoreFooter: settings.ignoreFooter ?? DEFAULT_SETTINGS.ignoreFooter
  };

  const savedLimit = clampNumber(settings.maxInputUrls, 1, MAX_INPUT_URL_LIMIT, LEGACY_DEFAULT_INPUT_URL_LIMIT);
  if (version < 3 && savedLimit === LEGACY_DEFAULT_INPUT_URL_LIMIT) {
    migrated.maxInputUrls = DEFAULT_SETTINGS.maxInputUrls;
  }
  if (version < 4 && settings.extractionMode === "static" && settings.checkImages === false && settings.checkLinks === false) {
    migrated.extractionMode = DEFAULT_SETTINGS.extractionMode;
    migrated.checkImages = DEFAULT_SETTINGS.checkImages;
    migrated.checkLinks = DEFAULT_SETTINGS.checkLinks;
  }
  if (version < 6) {
    migrated.useDedicatedRenderWindow = DEFAULT_SETTINGS.useDedicatedRenderWindow;
    migrated.useBrowserSessionForRenderedChecks = DEFAULT_SETTINGS.useBrowserSessionForRenderedChecks;
  }
  if (version < 9 && clampNumber(settings.renderWaitMs, 0, MAX_RENDER_WAIT_MS, 3000) === 3000) {
    migrated.renderWaitMs = DEFAULT_SETTINGS.renderWaitMs;
  }

  return migrated;
}

export function bindSettings() {
  [
    elements.checkLinksInput,
    elements.checkImagesInput,
    elements.collapseResponsiveImagesInput,
    elements.dedupeLinksInput,
    elements.autoRetryErrorsInput,
    elements.keepAwakeInput,
    elements.ignoreNavInput,
    elements.checkExternalLinksInput,
    elements.ignoreFooterInput,
    elements.extractionModeInput,
    elements.pageConcurrencyInput,
    elements.renderedConcurrencyInput,
    elements.renderWaitInput,
    elements.openInactiveInput,
    elements.useDedicatedRenderWindowInput,
    elements.useBrowserSessionInput,
    elements.closeRenderedTabsInput,
    elements.linkConcurrencyInput,
    elements.timeoutInput,
    elements.linkDelayInput,
    elements.maxInputUrlsInput,
    elements.maxDiscoveredAssetsInput,
    elements.resultsDensityInput
  ].forEach((input) => input.addEventListener("change", saveSettingsFromInputs));
  elements.timeDisplayUnitInput.addEventListener("change", () => {
    saveSettingsFromInputs({
      renderWaitMsOverride: state.settings.renderWaitMs,
      timeoutMsOverride: state.settings.timeoutMs,
      linkDelayMsOverride: state.settings.linkDelayMs
    });
  });
  elements.extractionModeInput.addEventListener("change", updateExtractionModeUi);
  elements.columnToggles.forEach((input) => input.addEventListener("change", saveSettingsFromInputs));
}

export function saveSettingsFromInputs(options = {}) {
  const visibleColumns = {};
  elements.columnToggles.forEach((input) => {
    visibleColumns[input.dataset.columnToggle] = input.checked;
  });
  const timeDisplayUnit = elements.timeDisplayUnitInput.value;
  const renderWaitMs = options.renderWaitMsOverride ?? parseTimeSettingInput(elements.renderWaitInput.value, timeDisplayUnit, DEFAULT_SETTINGS.renderWaitMs);
  const timeoutMs = options.timeoutMsOverride ?? parseTimeSettingInput(elements.timeoutInput.value, timeDisplayUnit, DEFAULT_SETTINGS.timeoutMs);
  const linkDelayMs = options.linkDelayMsOverride ?? parseTimeSettingInput(elements.linkDelayInput.value, timeDisplayUnit, DEFAULT_SETTINGS.linkDelayMs);
  state.settings = normalizeSettings({
    checkLinks: elements.checkLinksInput.checked,
    checkImages: elements.checkImagesInput.checked,
    collapseResponsiveImages: elements.collapseResponsiveImagesInput.checked,
    dedupeLinks: elements.dedupeLinksInput.checked,
    autoRetryErrors: elements.autoRetryErrorsInput.checked,
    keepAwake: elements.keepAwakeInput.checked,
    ignoreNav: !elements.ignoreNavInput.checked,
    ignoreFooter: !elements.ignoreFooterInput.checked,
    checkExternalLinks: elements.checkExternalLinksInput.checked,
    extractionMode: elements.extractionModeInput.checked ? "rendered" : "static",
    pageConcurrency: elements.pageConcurrencyInput.value,
    renderedConcurrency: elements.renderedConcurrencyInput.value,
    renderWaitMs,
    openInactive: elements.openInactiveInput.checked,
    useDedicatedRenderWindow: elements.useDedicatedRenderWindowInput.checked,
    useBrowserSessionForRenderedChecks: elements.useBrowserSessionInput.checked,
    closeRenderedTabs: elements.closeRenderedTabsInput.checked,
    linkConcurrency: elements.linkConcurrencyInput.value,
    timeoutMs,
    timeDisplayUnit,
    resultsDensity: elements.resultsDensityInput.checked ? "dense" : "comfortable",
    linkDelayMs,
    maxInputUrls: elements.maxInputUrlsInput.value,
    maxDiscoveredAssets: elements.maxDiscoveredAssetsInput.value,
    visibleColumns,
    settingsVersion: SETTINGS_VERSION
  });
  localStorage.setItem("bulkstatus-settings", JSON.stringify(state.settings));
  state.activePreset = "";
  state.settingsBeforePreset = null;
  updatePresetButtons();
  formatNumericInputs();
  applyResultsDensity();
  applyColumnVisibility();
  updateExtractionModeUi();
  updateModeHint();
  updateInputLimitCopy();
  refreshCurrentPhaseConcurrency();
  if (state.running) {
    updateProgress(state.completedWork, state.totalWork);
  }
  setControls();
  renderResults();
  renderDiagnostics();
}

export function normalizeSettings(settings) {
  return {
    checkLinks: Boolean(settings.checkLinks),
    checkImages: Boolean(settings.checkImages),
    collapseResponsiveImages: settings.collapseResponsiveImages !== false,
    dedupeLinks: Boolean(settings.dedupeLinks),
    autoRetryErrors: settings.autoRetryErrors !== false,
    keepAwake: settings.keepAwake !== false,
    ignoreNav: Boolean(settings.ignoreNav),
    ignoreFooter: Boolean(settings.ignoreFooter),
    checkExternalLinks: settings.checkExternalLinks !== false,
    diagnosticMode: true,
    extractionMode: settings.extractionMode === "rendered" ? "rendered" : "static",
    pageConcurrency: clampNumber(settings.pageConcurrency, 1, 12, DEFAULT_SETTINGS.pageConcurrency),
    renderedConcurrency: clampNumber(settings.renderedConcurrency, 1, 3, DEFAULT_SETTINGS.renderedConcurrency),
    renderWaitMs: clampNumber(settings.renderWaitMs, 0, MAX_RENDER_WAIT_MS, DEFAULT_SETTINGS.renderWaitMs),
    openInactive: settings.openInactive !== false,
    useDedicatedRenderWindow: settings.useDedicatedRenderWindow === true,
    useBrowserSessionForRenderedChecks: settings.useBrowserSessionForRenderedChecks !== false,
    closeRenderedTabs: settings.closeRenderedTabs !== false,
    linkConcurrency: clampNumber(settings.linkConcurrency, 1, 16, DEFAULT_SETTINGS.linkConcurrency),
    timeoutMs: clampNumber(settings.timeoutMs, 1000, 300000, DEFAULT_SETTINGS.timeoutMs),
    timeDisplayUnit: settings.timeDisplayUnit === "milliseconds" ? "milliseconds" : "seconds",
    resultsDensity: ["comfortable", "dense"].includes(settings.resultsDensity) ? settings.resultsDensity : DEFAULT_SETTINGS.resultsDensity,
    linkDelayMs: clampNumber(settings.linkDelayMs, 0, 10000, DEFAULT_SETTINGS.linkDelayMs),
    maxInputUrls: clampNumber(settings.maxInputUrls, 1, MAX_INPUT_URL_LIMIT, DEFAULT_SETTINGS.maxInputUrls),
    maxDiscoveredAssets: clampNumber(settings.maxDiscoveredAssets, 1, MAX_DISCOVERED_ASSET_LIMIT, DEFAULT_SETTINGS.maxDiscoveredAssets),
    visibleColumns: {
      ...DEFAULT_SETTINGS.visibleColumns,
      ...(settings.visibleColumns || {})
    },
    settingsVersion: SETTINGS_VERSION
  };
}

export function getDefaultSettings() {
  try {
    const savedDefault = JSON.parse(localStorage.getItem("bulkstatus-default-settings") || "{}");
    return Object.keys(savedDefault).length
      ? normalizeSettings(migrateSettings(savedDefault))
      : normalizeSettings(DEFAULT_SETTINGS);
  } catch (_error) {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function formatNumericInputs() {
  elements.pageConcurrencyInput.value = formatNumber(state.settings.pageConcurrency);
  elements.renderedConcurrencyInput.value = formatNumber(state.settings.renderedConcurrency);
  elements.renderWaitInput.value = formatRenderWaitInputValue(state.settings.renderWaitMs);
  elements.linkConcurrencyInput.value = formatNumber(state.settings.linkConcurrency);
  elements.timeoutInput.value = formatTimeSettingInputValue(state.settings.timeoutMs);
  elements.linkDelayInput.value = formatTimeSettingInputValue(state.settings.linkDelayMs);
  elements.maxInputUrlsInput.value = formatNumber(state.settings.maxInputUrls);
  elements.maxDiscoveredAssetsInput.value = formatNumber(state.settings.maxDiscoveredAssets);
  updateRenderWaitCopy();
}

export function parseTimeSettingInput(value, unit, fallback) {
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.round(unit === "milliseconds" ? number : number * 1000);
}

export function formatRenderWaitInputValue(milliseconds) {
  return formatTimeSettingInputValue(milliseconds);
}

export function formatTimeSettingInputValue(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) {
    return "";
  }

  if (state.settings.timeDisplayUnit === "milliseconds") {
    return formatNumber(value);
  }

  const seconds = value / 1000;
  return seconds.toLocaleString("en-US", {
    maximumFractionDigits: seconds < 10 ? 2 : 1
  });
}

export function updateRenderWaitCopy() {
  const milliseconds = state.settings.timeDisplayUnit === "milliseconds";
  elements.renderWaitLabel.textContent = milliseconds ? "Render wait max ms" : "Render wait max sec";
  elements.renderWaitHelp.textContent = milliseconds
    ? `Maximum milliseconds after page load while waiting for rendered DOM stability. Supports up to ${formatNumber(MAX_RENDER_WAIT_MS)} ms.`
    : `Maximum seconds after page load while waiting for rendered DOM stability. Supports up to ${formatNumber(MAX_RENDER_WAIT_MS / 1000)} seconds.`;
  elements.timeoutLabel.textContent = milliseconds ? "Timeout ms" : "Timeout sec";
  elements.timeoutHelp.textContent = milliseconds
    ? "Applies to page, link, and image requests. Supports 1,000-300,000 ms."
    : "Applies to page, link, and image requests. Supports 1-300 seconds.";
  elements.linkDelayLabel.textContent = milliseconds ? "Delay per asset ms" : "Delay per asset sec";
  elements.linkDelayHelp.textContent = milliseconds
    ? "Pause before checking each discovered link/image. Supports up to 10,000 ms."
    : "Pause before checking each discovered link/image. Supports up to 10 seconds.";
}

export function updateExtractionModeUi() {
  const rendered = elements.extractionModeInput.checked;
  document.querySelectorAll(".rendered-setting").forEach((element) => {
    element.hidden = !rendered;
  });
  elements.pageConcurrencyInput.closest(".number-field").hidden = rendered;
}

export function updateModeHint() {
  elements.linksChip.setAttribute("aria-pressed", String(state.settings.checkLinks));
  elements.imagesChip.setAttribute("aria-pressed", String(state.settings.checkImages));
}

export function toggleModeFromChip() {
  if (state.running) {
    return;
  }

  elements.extractionModeInput.value = state.settings.extractionMode === "rendered" ? "static" : "rendered";
  saveSettingsFromInputs();
}

export function toggleBooleanSettingFromChip(key) {
  if (state.running) {
    return;
  }

  const inputByKey = {
    checkLinks: elements.checkLinksInput,
    checkImages: elements.checkImagesInput,
    ignoreNav: elements.ignoreNavInput,
    ignoreFooter: elements.ignoreFooterInput
  };
  const input = inputByKey[key];
  if (!input) {
    return;
  }

  input.checked = !input.checked;
  saveSettingsFromInputs();
}

export function bindConfigTransfer() {
  if (elements.exportConfigButton) {
    elements.exportConfigButton.addEventListener("click", exportConfig);
  }
  if (elements.importConfigButton && elements.configFileInput) {
    elements.importConfigButton.addEventListener("click", () => elements.configFileInput.click());
    elements.configFileInput.addEventListener("change", handleConfigImport);
  }
}

export function exportConfig() {
  saveSettingsFromInputs();
  const payload = {
    bulkstatusConfig: true,
    version: currentAppVersion(),
    exportedAt: new Date().toISOString(),
    settings: state.settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulkstatus-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  flashButton(elements.exportConfigButton, "Exported");
}

export function handleConfigImport(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const incoming = parsed && parsed.settings ? parsed.settings : parsed;
      if (!incoming || typeof incoming !== "object") {
        throw new Error("Not a BulkStatus configuration file.");
      }
      state.settings = normalizeSettings({ ...getDefaultSettings(), ...incoming });
      localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
      loadSettings();
      updatePresetButtons();
      applyColumnVisibility();
      renderResults();
      flashButton(elements.importConfigButton, "Imported");
    } catch (_error) {
      flashButton(elements.importConfigButton, "Invalid file");
    }
  };
  reader.readAsText(file);
}

export function setSettingsTab(name) {
  elements.settingsTabButtons.forEach((button) => {
    const active = button.dataset.settingsTab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.settingsTabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsTab !== name;
  });
}

export function bindSettingsTabs() {
  elements.settingsTabButtons.forEach((button) => {
    button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
  });
}

export function toggleSettings() {
  if (elements.settingsBand.hidden) {
    openSettings();
  } else {
    closeSettings();
  }
}

export function openSettings() {
  elements.settingsBand.hidden = false;
  elements.settingsButton.setAttribute("aria-pressed", "true");
  // Settings open near the top, so bring the panel into view in case the user
  // clicked the icon while scrolled down (otherwise the click looks like a no-op).
  requestAnimationFrame(() => {
    elements.settingsBand.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function closeSettings() {
  elements.settingsBand.hidden = true;
  elements.settingsButton.setAttribute("aria-pressed", "false");
}

export function resetSettings() {
  state.settings = getDefaultSettings();
  state.activePreset = "";
  state.settingsBeforePreset = null;
  localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
  loadSettings();
  updatePresetButtons();
  applyColumnVisibility();
  renderResults();
}

export function saveCurrentSettingsAsDefault() {
  saveSettingsFromInputs();
  const savedDefault = { ...state.settings, settingsVersion: SETTINGS_VERSION };
  localStorage.setItem("bulkstatus-default-settings", JSON.stringify(savedDefault));
  flashButton(elements.saveDefaultsButton, "Saved");
}

export function applyPreset(preset) {
  if (state.activePreset === preset) {
    state.settings = normalizeSettings(state.settingsBeforePreset || getDefaultSettings());
    state.activePreset = "";
    state.settingsBeforePreset = null;
    localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
    loadSettings();
    updatePresetButtons();
    applyColumnVisibility();
    renderResults();
    return;
  }

  const presets = {
    "full-rendered": {
      checkLinks: true,
      checkImages: true,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 3,
      linkDelayMs: 300
    },
    links: {
      checkLinks: true,
      checkImages: false,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 4,
      linkDelayMs: 250
    },
    images: {
      checkLinks: false,
      checkImages: true,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "rendered",
      renderedConcurrency: 1,
      renderWaitMs: 30000,
      openInactive: true,
      useDedicatedRenderWindow: false,
      useBrowserSessionForRenderedChecks: true,
      closeRenderedTabs: true,
      linkConcurrency: 4,
      linkDelayMs: 250
    },
    fast: {
      checkLinks: false,
      checkImages: false,
      collapseResponsiveImages: true,
      ignoreNav: true,
      ignoreFooter: true,
      extractionMode: "static",
      pageConcurrency: 8,
      linkConcurrency: 4,
      linkDelayMs: 0
    }
  };
  const next = presets[preset];

  if (!next) {
    return;
  }

  if (!state.activePreset) {
    state.settingsBeforePreset = cloneSettings(state.settings);
  }
  state.settings = normalizeSettings({
    ...state.settings,
    ...next
  });
  state.activePreset = preset;
  localStorage.setItem("bulkstatus-settings", JSON.stringify({ ...state.settings, settingsVersion: SETTINGS_VERSION }));
  loadSettings();
  updatePresetButtons();
  applyColumnVisibility();
  renderResults();
}

export function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

export function updatePresetButtons() {
  elements.presetButtons.forEach((button) => {
    const active = button.dataset.preset === state.activePreset;
    button.setAttribute("aria-pressed", String(active));
  });
}

export function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  localStorage.setItem("bulkstatus-theme", next);
  applyTheme(next);
}

export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  elements.themeLightButton.hidden = next === "light";
  elements.themeLightButton.style.display = next === "light" ? "none" : "";
  elements.themeLightButton.setAttribute("aria-pressed", "false");
  elements.themeDarkButton.hidden = next === "dark";
  elements.themeDarkButton.style.display = next === "dark" ? "none" : "";
  elements.themeDarkButton.setAttribute("aria-pressed", "false");
  elements.themePreferenceInput.value = next;
}

export function defaultTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
