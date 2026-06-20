// Single source of truth for shared mutable application state. Import `state`
// from here everywhere; never duplicate or re-create it.

import { DEFAULT_SETTINGS, PREVIEW_LIMIT } from "./constants.js";

export const state = {
  rows: [],
  running: false,
  paused: false,
  stopRequested: false,
  pauseResolvers: [],
  activeFetchControllers: new Set(),
  activeRenderedTabIds: new Set(),
  renderWindowId: null,
  renderWindowKeeperTabId: null,
  authFailureHosts: new Map(),
  authPauseHosts: new Set(),
  pauseReason: "",
  runStartedAt: 0,
  completedWork: 0,
  totalWork: 0,
  currentPhase: "",
  runStage: "idle",
  resultsFullscreen: false,
  progress: {
    pages: { done: 0, total: 0 },
    links: { done: 0, total: 0, enabled: true, discovered: false },
    images: { done: 0, total: 0, enabled: true, discovered: false }
  },
  runDiagnostics: [],
  panelCollapsed: {
    urls: false,
    summary: false,
    results: false,
    diagnostics: true
  },
  summaryShown: false,
  lastRunDurationMs: 0,
  activePreset: "",
  settingsBeforePreset: null,
  inputMode: localStorage.getItem("bulkstatus-input-mode") || "list",
  inputTextByMode: {
    list: "",
    sitemap: "",
    llms: ""
  },
  sourceUrlByMode: {
    sitemap: "",
    llms: ""
  },
  sourceStatusByMode: {
    sitemap: "",
    llms: ""
  },
  inputCountNoteByMode: {
    list: "",
    sitemap: "",
    llms: ""
  },
  loadingInputSource: false,
  hideImages: false,
  hideLinks: false,
  hideSkipped: false,
  only404: false,
  filtersOpen: false,
  filters: {
    search: "",
    families: [],
    statuses: [],
    types: [],
    areas: [],
    issuesOnly: false,
    redirectsOnly: false,
    errorsOnly: false,
    skippedOnly: false,
    missingTitle: false,
    missingDescription: false,
    missingH1: false,
    missingCanonical: false,
    canonicalizedPages: false,
    noindexPages: false,
    missingImageAlt: false
  },
  showAll: false,
  resultsPage: 1,
  resultsPageSize: PREVIEW_LIMIT,
  resetResultsScroll: false,
  sortColumn: "",
  sortDirection: "asc",
  settings: { ...DEFAULT_SETTINGS }
};
