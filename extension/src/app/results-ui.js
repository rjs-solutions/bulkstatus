// Results UI: the results table (rows, cells, pagination, sort, filters), the
// summary panel, progress + diagnostics rendering, and the run/result controls.
// These pieces are mutually recursive, so they live together to keep imports
// one-directional (lower-level modules in, no cycles).

import {
  RESULTS_PAGE_SIZE_OPTIONS,
  PREVIEW_LIMIT,
  ALWAYS_VISIBLE_COLUMNS,
  DEFAULT_SETTINGS,
  SUMMARY_PLACEHOLDER_METRICS,
  SUMMARY_PLACEHOLDER_BREAKDOWNS
} from "./constants.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import { escapeHtml } from "./lib/text.js";
import { statusFamily, isNon200HttpStatus } from "./lib/status.js";
import { formatDuration, formatDurationLong, formatEstimatedDuration } from "./lib/duration.js";
import {
  formatMaybeNumber,
  formatResponseTime
} from "./format.js";
import {
  is404Row,
  normalizedArea,
  isErrorRow,
  isIssueRow,
  isCheckedRow,
  isMissingTitleRow,
  isMissingDescriptionRow,
  isMissingH1Row,
  isMissingCanonicalRow,
  isCanonicalizedPageRow,
  isNoindexPageRow,
  isMissingImageAltRow,
  rowSearchText,
  isNon200Status,
  isSkippedRow,
  isPendingResult,
  isRetryableErrorRow
} from "./predicates.js";
import {
  scrollResultsIntoView,
  isActivelyRunning,
  setStatus,
  setSettingsControlDisabled,
  setSettingsButtonDisabled
} from "./ui-utils.js";
import { updateInputUrlCount } from "./input-parse.js";
import { appManifest, diagnosticsEnvironment } from "./environment.js";

export let scheduledRenderHandle = 0;

export function clampPageSize(value) {
  const number = Number(value);
  return RESULTS_PAGE_SIZE_OPTIONS.includes(number) ? number : PREVIEW_LIMIT;
}

export function changeResultsPage(delta) {
  if (state.showAll) {
    return;
  }

  const pagination = currentPagination();
  state.resultsPage = Math.min(
    pagination.totalPages,
    Math.max(1, pagination.currentPage + delta)
  );
  state.resetResultsScroll = true;
  renderResults();
}

export function resetResultsPagination(options = {}) {
  state.resultsPage = 1;
  state.resetResultsScroll = true;
  if (options.collapseShowAll) {
    state.showAll = false;
  }
}

export function maybeResetResultsScroll() {
  if (!state.resetResultsScroll) {
    return;
  }

  state.resetResultsScroll = false;
  if (elements.tableShell) {
    elements.tableShell.scrollTop = 0;
  }
}

export function renderPanelStates() {
  const panels = {
    urls: { body: elements.urlsPanelBody, label: "Inputs" },
    summary: { body: elements.summaryPanelBody, label: "Summary" },
    results: { body: elements.resultsPanelBody, label: "Results" },
    diagnostics: { body: elements.diagnosticsBody, label: "Diagnostics" }
  };

  elements.panelToggles.forEach((button) => {
    const panel = button.dataset.panelToggle;
    const config = panels[panel];
    if (!config) {
      return;
    }

    const collapsed = Boolean(state.panelCollapsed[panel]);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${config.label}`);
    button.title = `${collapsed ? "Expand" : "Collapse"} ${config.label}`;
    if (config.body) {
      config.body.hidden = collapsed;
    }
  });
}

export function isColumnVisible(column) {
  return ALWAYS_VISIBLE_COLUMNS.has(column) || state.settings.visibleColumns[column] !== false;
}

export function applyColumnVisibility() {
  document.querySelectorAll("[data-column]").forEach((element) => {
    const column = element.dataset.column;
    element.hidden = !isColumnVisible(column);
  });
}

export function applyResultsDensity() {
  document.documentElement.dataset.resultsDensity = state.settings.resultsDensity || DEFAULT_SETTINGS.resultsDensity;
}

export function toggleSort(column) {
  if (!column) {
    return;
  }

  if (state.sortColumn === column) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortColumn = column;
    state.sortDirection = "asc";
  }

  resetResultsPagination();
  renderResults();
}

export function updateSortHeaders() {
  document.querySelectorAll("th[data-sort-column]").forEach((header) => {
    const active = header.dataset.sortColumn === state.sortColumn;
    header.dataset.sortDirection = active ? state.sortDirection : "";
    header.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
}

export function retryableErrorEntries() {
  return state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isRetryableErrorRow(row));
}

export function renderResultsPlaceholderRows(count) {
  const headerCells = [...document.querySelectorAll("table thead th")];
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const tr = document.createElement("tr");
    tr.className = "results-placeholder-row";
    tr.setAttribute("aria-hidden", "true");
    headerCells.forEach((th) => {
      const td = document.createElement("td");
      td.dataset.column = th.dataset.column || "";
      if (th.hidden) {
        td.hidden = true;
      }
      if (th.dataset.column !== "expander" && th.dataset.column !== "open") {
        const bar = document.createElement("span");
        bar.className = "skeleton-bar";
        td.append(bar);
      }
      tr.append(td);
    });
    rows.push(tr);
  }
  return rows;
}

export function scheduleResultsRender() {
  if (scheduledRenderHandle) {
    return;
  }

  scheduledRenderHandle = requestAnimationFrame(() => {
    scheduledRenderHandle = 0;
    renderResults();
  });
}

export function cancelScheduledRender() {
  if (scheduledRenderHandle) {
    cancelAnimationFrame(scheduledRenderHandle);
    scheduledRenderHandle = 0;
  }
}

export function computeRowCounts() {
  const counts = {
    total: state.rows.length,
    family2xx: 0, family3xx: 0, family4xx: 0, family5xx: 0,
    typePage: 0, typeLink: 0, typeImage: 0,
    areaContent: 0, areaNav: 0, areaBreadcrumb: 0, areaFooter: 0, areaSidebar: 0, areaUnknown: 0,
    issues: 0, redirects: 0, errors: 0, skipped: 0,
    missingTitle: 0, missingDescription: 0, missingH1: 0, missingCanonical: 0,
    canonicalizedPages: 0, noindexPages: 0, missingImageAlt: 0,
    checked: 0, notFound: 0,
    non200Links: 0, non200Images: 0, assetSkipped: 0
  };

  for (const row of state.rows) {
    const family = statusFamily(row.statusCode);
    if (family === "2xx") counts.family2xx += 1;
    else if (family === "3xx") counts.family3xx += 1;
    else if (family === "4xx") counts.family4xx += 1;
    else if (family === "5xx") counts.family5xx += 1;

    const isPage = row.rowType === "Page";
    if (isPage) counts.typePage += 1;
    else if (row.rowType === "Link") counts.typeLink += 1;
    else if (row.rowType === "Image") counts.typeImage += 1;

    const area = normalizedArea(row.linkLocation);
    if (area === "content") counts.areaContent += 1;
    else if (area === "nav") counts.areaNav += 1;
    else if (area === "breadcrumb") counts.areaBreadcrumb += 1;
    else if (area === "footer") counts.areaFooter += 1;
    else if (area === "sidebar") counts.areaSidebar += 1;
    else if (area === "unknown" && !isPage) counts.areaUnknown += 1;

    const error = isErrorRow(row);
    if (error || isNon200HttpStatus(row.statusCode)) counts.issues += 1;
    if (error) counts.errors += 1;
    if (Number(row.redirectCount || 0) > 0) counts.redirects += 1;
    const skipped = isSkippedRow(row);
    if (skipped) counts.skipped += 1;
    if (isCheckedRow(row)) counts.checked += 1;
    if (Number(row.statusCode) === 404) counts.notFound += 1;

    if (isMissingTitleRow(row)) counts.missingTitle += 1;
    if (isMissingDescriptionRow(row)) counts.missingDescription += 1;
    if (isMissingH1Row(row)) counts.missingH1 += 1;
    if (isMissingCanonicalRow(row)) counts.missingCanonical += 1;
    if (isCanonicalizedPageRow(row)) counts.canonicalizedPages += 1;
    if (isNoindexPageRow(row)) counts.noindexPages += 1;
    if (isMissingImageAltRow(row)) counts.missingImageAlt += 1;

    if (!isPage && skipped) counts.assetSkipped += 1;
    if (row.rowType === "Link" && isNon200Status(row.statusCode, row.redirectCount)) counts.non200Links += 1;
    if (row.rowType === "Image" && isNon200Status(row.statusCode, row.redirectCount)) counts.non200Images += 1;
  }

  return counts;
}

export function childCountByGroup() {
  const counts = new Map();
  for (const row of state.rows) {
    if (row.rowType !== "Page") {
      counts.set(row.groupId, (counts.get(row.groupId) || 0) + 1);
    }
  }
  return counts;
}

export function renderResults() {
  cancelScheduledRender();
  applyColumnVisibility();
  updateSortHeaders();
  const counts = computeRowCounts();
  renderFilterPanel(counts);
  if (!state.rows.length) {
    elements.resultsBody.replaceChildren(...renderResultsPlaceholderRows(6));
    renderPaginationControls(currentPagination());
    updateSummary(counts);
    return;
  }

  const pagination = currentPagination();
  const childCounts = childCountByGroup();
  const rows = visibleRows(pagination);
  elements.resultsBody.replaceChildren(...rows.map((row) => renderRow(row, childCounts)));
  maybeResetResultsScroll();
  renderPaginationControls(pagination);
  updateSummary(counts);
}

export function toggleFilterPanel() {
  state.filtersOpen = !state.filtersOpen;
  renderFilterPanel();
}

export function renderFilterPanel(counts = computeRowCounts()) {
  elements.filterPanel.hidden = !state.filtersOpen;
  elements.filterButton.setAttribute("aria-expanded", String(state.filtersOpen));
  elements.filterButton.setAttribute("aria-pressed", String(hasActiveResultFilters()));
  elements.filterSearchInput.value = state.filters.search;

  elements.filterPanel.querySelectorAll("[data-filter-family]").forEach((input) => {
    input.checked = state.filters.families.includes(input.dataset.filterFamily);
  });
  elements.filterPanel.querySelectorAll("[data-filter-type]").forEach((input) => {
    input.checked = state.filters.types.includes(input.dataset.filterType);
  });
  elements.filterPanel.querySelectorAll("[data-filter-area]").forEach((input) => {
    input.checked = state.filters.areas.includes(input.dataset.filterArea);
  });
  elements.filterPanel.querySelectorAll("[data-filter-flag]").forEach((input) => {
    input.checked = Boolean(state.filters[input.dataset.filterFlag]);
  });

  updateFilterCounts(counts);
}

export function updateFilterCounts(rowCounts = computeRowCounts()) {
  const counts = {
    "family-2xx": rowCounts.family2xx,
    "family-3xx": rowCounts.family3xx,
    "family-4xx": rowCounts.family4xx,
    "family-5xx": rowCounts.family5xx,
    "type-Page": rowCounts.typePage,
    "type-Link": rowCounts.typeLink,
    "type-Image": rowCounts.typeImage,
    "area-content": rowCounts.areaContent,
    "area-nav": rowCounts.areaNav,
    "area-breadcrumb": rowCounts.areaBreadcrumb,
    "area-footer": rowCounts.areaFooter,
    "area-sidebar": rowCounts.areaSidebar,
    "area-unknown": rowCounts.areaUnknown,
    "flag-issuesOnly": rowCounts.issues,
    "flag-redirectsOnly": rowCounts.redirects,
    "flag-errorsOnly": rowCounts.errors,
    "flag-skippedOnly": rowCounts.skipped,
    "flag-missingTitle": rowCounts.missingTitle,
    "flag-missingDescription": rowCounts.missingDescription,
    "flag-missingH1": rowCounts.missingH1,
    "flag-missingCanonical": rowCounts.missingCanonical,
    "flag-canonicalizedPages": rowCounts.canonicalizedPages,
    "flag-noindexPages": rowCounts.noindexPages,
    "flag-missingImageAlt": rowCounts.missingImageAlt
  };

  elements.filterPanel.querySelectorAll("[data-count-for]").forEach((countElement) => {
    const key = countElement.dataset.countFor;
    const count = counts[key] || 0;
    const label = countElement.closest("label");
    const input = label?.querySelector("input");
    countElement.textContent = `(${formatMaybeNumber(count)})`;
    label?.classList.toggle("is-empty", count === 0);
    if (input && count === 0 && !input.checked) {
      input.disabled = true;
    } else if (input) {
      input.disabled = false;
    }
  });
}

export function handleFilterChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.dataset.filterFamily) {
    toggleArrayFilter("families", input.dataset.filterFamily, input.checked);
  } else if (input.dataset.filterType) {
    toggleArrayFilter("types", input.dataset.filterType, input.checked);
  } else if (input.dataset.filterArea) {
    toggleArrayFilter("areas", input.dataset.filterArea, input.checked);
  } else if (input.dataset.filterFlag) {
    state.filters[input.dataset.filterFlag] = input.checked;
  }

  resetResultsPagination();
  renderResults();
}

export function toggleArrayFilter(key, value, force) {
  const values = new Set(state.filters[key]);
  const shouldAdd = force === undefined ? !values.has(value) : force;
  if (shouldAdd) {
    values.add(value);
  } else {
    values.delete(value);
  }
  state.filters[key] = [...values];
}

export function clearResultFilters(render = true) {
  state.only404 = false;
  state.filters = {
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
  };
  elements.filterSearchInput.value = "";
  resetResultsPagination({ collapseShowAll: true });
  if (render) {
    renderResults();
  }
}

export function visibleRows(pagination = currentPagination()) {
  const visiblePageRows = pagination.visiblePageRows;
  const rows = [];

  visiblePageRows.forEach((pageRow) => {
    rows.push(pageRow);
    if (hasActiveResultFilters()) {
      rows.push(...sortRows(matchingChildRows(pageRow.groupId)));
      return;
    }

    if (pageRow.expanded) {
      rows.push(...sortRows(state.rows.filter((row) => {
        if (row.rowType === "Page" || row.groupId !== pageRow.groupId) {
          return false;
        }

        return shouldShowChildRow(row);
      })));
    }
  });

  return rows;
}

export function filteredSortedPageRows() {
  return sortRows(state.rows.filter((row) => row.rowType === "Page").filter((pageRow) => {
    if (!hasActiveResultFilters()) {
      return true;
    }

    return rowMatchesResultFilters(pageRow) || matchingChildRows(pageRow.groupId).length;
  }));
}

export function currentPagination() {
  const pageRows = filteredSortedPageRows();
  const pageSize = clampPageSize(state.resultsPageSize);
  const totalPages = Math.max(1, Math.ceil(pageRows.length / pageSize));
  state.resultsPageSize = pageSize;
  state.resultsPage = Math.min(totalPages, Math.max(1, Number(state.resultsPage) || 1));

  if (state.showAll) {
    return {
      visiblePageRows: pageRows,
      totalPageRows: pageRows.length,
      totalPages,
      currentPage: state.resultsPage,
      pageSize,
      startPageNumber: pageRows.length ? 1 : 0,
      endPageNumber: pageRows.length
    };
  }

  const startIndex = (state.resultsPage - 1) * pageSize;
  const endIndex = Math.min(pageRows.length, startIndex + pageSize);

  return {
    visiblePageRows: pageRows.slice(startIndex, endIndex),
    totalPageRows: pageRows.length,
    totalPages,
    currentPage: state.resultsPage,
    pageSize,
    startPageNumber: pageRows.length ? startIndex + 1 : 0,
    endPageNumber: endIndex
  };
}

export function renderPaginationControls(pagination = currentPagination()) {
  const hasPages = pagination.totalPageRows > 0;
  const needsPagination = pagination.totalPageRows > pagination.pageSize || state.showAll;
  const activeRun = isActivelyRunning();
  const label = hasPages
    ? `Page rows ${formatMaybeNumber(pagination.startPageNumber)}-${formatMaybeNumber(pagination.endPageNumber)} of ${formatMaybeNumber(pagination.totalPageRows)}`
    : "No pages to show";

  elements.paginationControls.forEach((control) => {
    control.hidden = !hasPages || !needsPagination;
  });
  elements.paginationLabels.forEach((element) => {
    element.textContent = label;
  });
  elements.paginationPageSizeSelects.forEach((select) => {
    select.value = String(pagination.pageSize);
    select.disabled = activeRun || state.showAll || !hasPages;
  });
  elements.paginationPreviousButtons.forEach((button) => {
    button.disabled = activeRun || state.showAll || pagination.currentPage <= 1;
  });
  elements.paginationNextButtons.forEach((button) => {
    button.disabled = activeRun || state.showAll || pagination.currentPage >= pagination.totalPages;
  });
  elements.paginationShowAllButtons.forEach((button) => {
    button.hidden = pagination.totalPageRows <= pagination.pageSize && !state.showAll;
    button.disabled = activeRun || !hasPages;
    button.textContent = state.showAll ? "Collapse" : "Show all";
    button.setAttribute("aria-pressed", String(state.showAll));
  });
}

export function exportRows() {
  if (!hasActiveResultFilters()) {
    return state.rows;
  }

  const rows = [];
  sortRows(state.rows.filter((row) => row.rowType === "Page")).forEach((pageRow) => {
    const children = sortRows(matchingChildRows(pageRow.groupId));
    if (rowMatchesResultFilters(pageRow) || children.length) {
      rows.push(pageRow, ...children);
    }
  });
  return rows;
}

export function matchingChildRows(groupId) {
  return state.rows.filter((row) => (
    row.rowType !== "Page" &&
    row.groupId === groupId &&
    shouldShowChildRow(row) &&
    rowMatchesResultFilters(row)
  ));
}

export function shouldShowChildRow(row) {
  if (state.hideSkipped && isSkippedRow(row)) {
    return false;
  }

  if (state.hideLinks && row.rowType === "Link") {
    return false;
  }

  if (state.hideImages && row.rowType === "Image") {
    return false;
  }

  return true;
}

export function hasActiveResultFilters() {
  return Boolean(
    state.only404 ||
    state.filters.search ||
    state.filters.families.length ||
    state.filters.statuses.length ||
    state.filters.types.length ||
    state.filters.areas.length ||
    state.filters.issuesOnly ||
    state.filters.redirectsOnly ||
    state.filters.errorsOnly ||
    state.filters.skippedOnly ||
    state.filters.missingTitle ||
    state.filters.missingDescription ||
    state.filters.missingH1 ||
    state.filters.missingCanonical ||
    state.filters.canonicalizedPages ||
    state.filters.noindexPages ||
    state.filters.missingImageAlt
  );
}

export function rowMatchesResultFilters(row) {
  if (state.only404 && !is404Row(row)) {
    return false;
  }

  if (state.filters.types.length && !state.filters.types.includes(row.rowType)) {
    return false;
  }

  if (state.filters.areas.length && !state.filters.areas.includes(normalizedArea(row.linkLocation))) {
    return false;
  }

  if (state.filters.statuses.length && !state.filters.statuses.includes(String(row.statusCode || ""))) {
    return false;
  }

  if (state.filters.families.length && !state.filters.families.includes(statusFamily(row.statusCode))) {
    return false;
  }

  if (state.filters.issuesOnly && !isIssueRow(row)) {
    return false;
  }

  if (state.filters.redirectsOnly && Number(row.redirectCount || 0) <= 0) {
    return false;
  }

  if (state.filters.errorsOnly && !isErrorRow(row)) {
    return false;
  }

  if (state.filters.skippedOnly && !isSkippedRow(row)) {
    return false;
  }

  if (state.filters.missingTitle && !isMissingTitleRow(row)) {
    return false;
  }

  if (state.filters.missingDescription && !isMissingDescriptionRow(row)) {
    return false;
  }

  if (state.filters.missingH1 && !isMissingH1Row(row)) {
    return false;
  }

  if (state.filters.missingCanonical && !isMissingCanonicalRow(row)) {
    return false;
  }

  if (state.filters.canonicalizedPages && !isCanonicalizedPageRow(row)) {
    return false;
  }

  if (state.filters.noindexPages && !isNoindexPageRow(row)) {
    return false;
  }

  if (state.filters.missingImageAlt && !isMissingImageAltRow(row)) {
    return false;
  }

  const search = state.filters.search.trim().toLowerCase();
  if (search && !rowSearchText(row).includes(search)) {
    return false;
  }

  return true;
}

export function sortRows(rows) {
  if (!state.sortColumn) {
    return [...rows];
  }

  return [...rows].sort((a, b) => compareRows(a, b, state.sortColumn, state.sortDirection));
}

export function compareRows(a, b, column, direction) {
  const left = sortValue(a, column);
  const right = sortValue(b, column);
  const multiplier = direction === "desc" ? -1 : 1;

  if (left.kind === "number" || right.kind === "number") {
    return ((left.number || 0) - (right.number || 0)) * multiplier;
  }

  return left.text.localeCompare(right.text, undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

export function sortValue(row, column) {
  const values = {
    area: row.linkLocation,
    canonical: row.canonical,
    description: row.metaDescription,
    finalUrl: row.finalUrl,
    h1: row.h1,
    imageIssues: row.rowType === "Page" ? countNon200Children(row.groupId, "Image") : "",
    inputUrl: row.inputUrl,
    linkIssues: row.rowType === "Page" ? countNon200Children(row.groupId, "Link") : "",
    redirects: row.redirectCount,
    result: row.result || successPlaceholder(row),
    robots: row.metaRobots,
    sourcePage: row.sourcePage,
    state: rowState(row).label,
    status: row.statusCode || getStatusFallback(row.result),
    textAlt: row.linkText,
    time: row.responseTimeMs,
    title: row.title,
    type: row.rowType,
    words: row.wordCount
  };
  const value = values[column];
  const number = Number(value);

  if (value !== "" && value !== null && value !== undefined && Number.isFinite(number)) {
    return { kind: "number", number, text: "" };
  }

  return { kind: "text", number: 0, text: String(value || "") };
}

export function renderRow(row, childCounts) {
  const tr = document.createElement("tr");
  tr.className = row.rowType === "Page" ? "page-row" : "asset-row";
  const values = [
    stateCell(row),
    expandCell(row, childCounts),
    textCell("type", row.rowType, `type-tag type-${String(row.rowType || "").toLowerCase()}`),
    openCell(row),
    textCell("inputUrl", row.inputUrl),
    textCell("sourcePage", row.sourcePage),
    textCell("area", row.linkLocation),
    textCell("textAlt", row.linkText),
    textCell("finalUrl", row.finalUrl),
    textCell("status", row.statusCode || getStatusFallback(row.result), getStatusClass(row.statusCode, row.result)),
    textCell("redirects", row.redirectCount),
    textCell("time", formatResponseTime(row.responseTimeMs)),
    textCell("linkIssues", issueCountCellValue(row, "Link")),
    textCell("imageIssues", issueCountCellValue(row, "Image")),
    textCell("title", row.title),
    textCell("description", row.metaDescription),
    textCell("h1", row.h1),
    textCell("robots", row.metaRobots),
    textCell("canonical", row.canonical),
    textCell("words", formatMaybeNumber(row.wordCount)),
    textCell("result", row.result || successPlaceholder(row))
  ];

  tr.append(...values);
  return tr;
}

export function stateCell(row) {
  const td = document.createElement("td");
  td.dataset.column = "state";
  if (!isColumnVisible("state")) {
    td.hidden = true;
  }

  const stateInfo = rowState(row);
  const span = document.createElement("span");
  span.className = `row-state ${stateInfo.className}`;
  span.title = stateInfo.title;
  span.setAttribute("aria-label", stateInfo.title);
  span.innerHTML = stateInfo.icon;
  const label = document.createElement("span");
  label.textContent = stateInfo.label;
  span.append(label);
  td.append(span);
  return td;
}

export function rowState(row) {
  if (row.result === "Queued") {
    return {
      label: "Queued",
      className: "state-pending",
      title: "Queued and waiting to be checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
    };
  }

  if (row.result === "Checking") {
    return {
      label: "Checking",
      className: "state-checking",
      title: "Currently being checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
    };
  }

  if (row.result === "Run stopped" || isSkippedRow(row)) {
    return {
      label: "Skipped",
      className: "state-skipped",
      title: row.result || "Skipped or not checked",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'
    };
  }

  if (isErrorRow(row)) {
    return {
      label: "Error",
      className: "state-error",
      title: row.result || "Check ended with an error",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>'
    };
  }

  if (row.statusCode) {
    return {
      label: "Complete",
      className: "state-complete",
      title: "Check complete",
      icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
    };
  }

  return {
    label: "Pending",
    className: "state-pending",
    title: "Pending check",
    icon: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
}

export function openCell(row) {
  const td = document.createElement("td");
  td.dataset.column = "open";
  const url = row.finalUrl || row.inputUrl;
  if (!url) {
    return td;
  }

  const button = document.createElement("button");
  button.className = "open-button";
  button.type = "button";
  button.title = "Open in new tab";
  button.setAttribute("aria-label", `Open ${url} in a new tab`);
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
  button.addEventListener("click", () => {
    chrome.tabs.create({ url });
  });
  td.append(button);
  return td;
}

export function expandCell(row, childCounts) {
  const td = document.createElement("td");
  td.dataset.column = "expander";
  if (row.rowType !== "Page") {
    return td;
  }

  const childCount = childCounts
    ? (childCounts.get(row.groupId) || 0)
    : state.rows.filter((child) => child.rowType !== "Page" && child.groupId === row.groupId).length;
  if (!childCount) {
    return td;
  }

  const button = document.createElement("button");
  button.className = "expand-button";
  button.type = "button";
  button.innerHTML = row.expanded
    ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
  button.title = row.expanded ? "Collapse page assets" : `Show ${childCount} page assets`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    row.expanded = !row.expanded;
    renderResults();
  });
  td.append(button);
  return td;
}

export function textCell(column, value, className = "") {
  const td = document.createElement("td");
  td.dataset.column = column;
  if (!isColumnVisible(column)) {
    td.hidden = true;
  }
  const span = document.createElement("span");
  span.className = `cell-clip ${className}`.trim();
  span.textContent = value === 0 ? "0" : String(value || "");
  span.title = span.textContent;
  td.append(span);
  return td;
}

export function getStatusFallback(result) {
  if (!result || isPendingResult(result)) {
    return "";
  }

  return result.startsWith("Not checked") || result === "Run stopped" ? "Skip" : "Error";
}

export function getStatusClass(value, result) {
  const code = Number(value);

  if (result && (result.startsWith("Not checked") || result === "Run stopped")) {
    return "status-skipped";
  }

  if (result && !isPendingResult(result) && !code) {
    return "status-error";
  }

  if (!code || code < 200) {
    return value ? "status-error" : "";
  }

  if (code >= 200 && code < 300) {
    return "status-ok";
  }

  if (code >= 300 && code < 400) {
    return "status-warn";
  }

  return "status-error";
}

export function issueCountCellValue(row, kind) {
  if (row.rowType !== "Page") {
    return pageOnlyPlaceholder(row);
  }

  return formatMaybeNumber(countNon200Children(row.groupId, kind));
}

export function countNon200Children(groupId, kind) {
  return state.rows.filter((row) => (
    row.groupId === groupId &&
    row.rowType === kind &&
    isNon200Status(row.statusCode, row.redirectCount)
  )).length;
}

export function updateProgress(completed, total) {
  renderProgress();
  updateRunControlButtons();
}

export function etaText(completed, total) {
  if (!total || !completed || !state.runStartedAt) {
    return "calculating\u2026";
  }

  const elapsedMs = performance.now() - state.runStartedAt;
  const remainingMs = Math.max(0, (elapsedMs / completed) * (total - completed));
  return `~${formatEstimatedDuration(remainingMs)} left`;
}

export function assetStageLabel() {
  const links = state.settings.checkLinks;
  const images = state.settings.checkImages;
  if (links && images) {
    return "Checking links & images";
  }
  if (links) {
    return "Checking links";
  }
  if (images) {
    return "Checking images";
  }
  return "Checking assets";
}

export function setProgressBar(rowEl, fillEl, countEl, data) {
  rowEl.hidden = false;
  rowEl.classList.remove("is-off", "is-pending");
  if (!data.enabled) {
    rowEl.classList.add("is-off");
    fillEl.style.width = "0%";
    countEl.innerHTML = '<span class="off-pill">Off</span>';
    return;
  }
  if (!data.discovered) {
    rowEl.classList.add("is-pending");
    fillEl.style.width = "0%";
    countEl.textContent = "Pending";
    return;
  }
  if (!data.total) {
    fillEl.style.width = "100%";
    countEl.textContent = "None found";
    return;
  }
  const pct = Math.round((data.done / data.total) * 100);
  fillEl.style.width = `${pct}%`;
  countEl.textContent = `${formatMaybeNumber(data.done)} / ${formatMaybeNumber(data.total)}`;
}

export function renderProgressSide(done, total, label, etaCompleted, etaTotal) {
  elements.progressBig.textContent = `${formatMaybeNumber(done)} / ${formatMaybeNumber(total)}`;
  elements.progressBigLabel.textContent = label;
  if (state.stopRequested) {
    elements.progressEta.textContent = "Stopping\u2026";
  } else if (state.paused) {
    elements.progressEta.textContent = "Paused";
  } else {
    elements.progressEta.textContent = etaText(etaCompleted, etaTotal);
  }
  elements.progressQueued.textContent = `${formatMaybeNumber(Math.max(0, total - done))} queued`;
}

export function setRunStatusLine() {
  const percent = state.totalWork ? Math.round((state.completedWork / state.totalWork) * 100) : 0;
  if (state.stopRequested) {
    setStatus("Stopping crawl");
  } else if (state.paused) {
    setStatus("Crawl paused");
  } else {
    setStatus(state.totalWork ? `Crawling\u2026 ${percent}%` : "");
  }
}

export function clearIdleBar(rowEl, fillEl, countEl) {
  rowEl.hidden = false;
  rowEl.classList.remove("is-off", "is-pending");
  fillEl.style.width = "0%";
  countEl.textContent = "\u2014";
}

export function renderProgress() {
  const p = state.progress;
  const stage = state.runStage;

  if (!stage || stage === "idle") {
    elements.progressWrap.classList.add("is-idle");
    elements.genericRow.hidden = true;
    elements.progressMainBars.classList.remove("is-generic");
    elements.progressStep.innerHTML = '<span class="step-pill">Ready</span> Run a check to track progress';
    elements.progressBig.textContent = "\u2014";
    elements.progressBigLabel.textContent = "pages";
    elements.progressQueued.textContent = "\u2014 queued";
    elements.progressEta.textContent = "\u2014 left";
    clearIdleBar(elements.pagesRow, elements.pagesFill, elements.pagesCount);
    clearIdleBar(elements.linksRow, elements.linksFill, elements.linksCount);
    clearIdleBar(elements.imagesRow, elements.imagesFill, elements.imagesCount);
    return;
  }
  elements.progressWrap.classList.remove("is-idle");

  const generic = stage === "retry";

  elements.pagesRow.hidden = generic;
  elements.linksRow.hidden = generic;
  elements.imagesRow.hidden = generic;
  elements.genericRow.hidden = !generic;
  elements.progressMainBars.classList.toggle("is-generic", generic);

  const hasAssetPhase = state.settings.checkLinks || state.settings.checkImages;
  let stepHtml;
  if (state.stopRequested) {
    stepHtml = "Stopping\u2026";
  } else if (state.paused) {
    stepHtml = state.pauseReason ? `Paused \u2014 ${escapeHtml(state.pauseReason)}` : "Paused";
  } else if (generic) {
    stepHtml = "Retrying error rows";
  } else if (stage === "assets") {
    const label = assetStageLabel();
    stepHtml = hasAssetPhase ? `<span class="step-pill">Step 2 of 2</span> ${label}` : label;
  } else if (stage === "pages") {
    stepHtml = hasAssetPhase ? '<span class="step-pill">Step 1 of 2</span> Checking pages' : "Checking pages";
  } else {
    stepHtml = "Preparing\u2026";
  }
  elements.progressStep.innerHTML = stepHtml;

  if (generic) {
    const pct = state.totalWork ? Math.round((state.completedWork / state.totalWork) * 100) : 0;
    elements.genericFill.style.width = `${pct}%`;
    elements.genericCount.textContent = `${formatMaybeNumber(state.completedWork)} / ${formatMaybeNumber(state.totalWork)}`;
    renderProgressSide(state.completedWork, state.totalWork, "retried", state.completedWork, state.totalWork);
    setRunStatusLine();
    return;
  }

  setProgressBar(elements.pagesRow, elements.pagesFill, elements.pagesCount, {
    enabled: true,
    discovered: true,
    done: p.pages.done,
    total: p.pages.total
  });
  setProgressBar(elements.linksRow, elements.linksFill, elements.linksCount, p.links);
  setProgressBar(elements.imagesRow, elements.imagesFill, elements.imagesCount, p.images);

  if (stage === "assets") {
    const done = p.links.done + p.images.done;
    const total = p.links.total + p.images.total;
    const unit = state.settings.checkLinks && state.settings.checkImages
      ? "assets"
      : (state.settings.checkLinks ? "links" : "images");
    renderProgressSide(done, total, unit, state.completedWork, state.totalWork);
  } else {
    renderProgressSide(p.pages.done, p.pages.total, "pages", state.completedWork, state.totalWork);
  }

  setRunStatusLine();
}

export function setRunPhase(phase) {
  state.currentPhase = phase;
  addRunDiagnostic("Phase", phase);
  updateProgress(state.completedWork, state.totalWork);
}

export function addPageDiagnostic(label, url, elapsedMs, statusCode, assetJobs, detail = "") {
  if (!state.settings.diagnosticMode) {
    return;
  }

  const links = assetJobs.filter((job) => job.kind === "Link").length;
  const images = assetJobs.filter((job) => job.kind === "Image").length;
  const status = statusCode ? `status ${statusCode}` : "no status";
  const extra = detail ? ` ${detail}` : "";
  addRunDiagnostic(label, `${url}; ${status}; ${formatMaybeNumber(elapsedMs)} ms; discovered ${links} links and ${images} images.${extra}`);
}

export function addEnvironmentDiagnostic() {
  const manifest = appManifest();
  const environment = diagnosticsEnvironment();
  addRunDiagnostic(
    "Environment",
    `BulkStatus ${manifest.version || "dev"}; Chrome ${environment.chromeVersion || "unknown"}; ${environment.operatingSystem || environment.platform || "unknown OS"}; ${environment.timezone || "unknown timezone"}; ${environment.hardwareConcurrency || "unknown"} logical processors.`
  );
}

export function addRunDiagnostic(label, detail) {
  const elapsedMs = state.runStartedAt ? performance.now() - state.runStartedAt : 0;
  state.runDiagnostics.push({
    label,
    detail,
    elapsedMs
  });
  state.runDiagnostics = state.runDiagnostics.slice(-80);
  renderDiagnostics();
}

export function renderDiagnostics() {
  if (!state.runDiagnostics.length) {
    elements.diagnosticsSummary.textContent = "Run a check to populate diagnostics.";
    elements.copyDiagnosticsButton.disabled = true;
    elements.downloadDiagnosticsButton.disabled = true;
    const item = document.createElement("li");
    item.textContent = "Run a check to populate diagnostics. Enable Detailed diagnostics in Settings for more timing and discovery detail.";
    elements.diagnosticsList.replaceChildren(item);
    renderPanelStates();
    return;
  }

  const duration = state.running && state.runStartedAt
    ? performance.now() - state.runStartedAt
    : state.lastRunDurationMs;
  elements.diagnosticsSummary.textContent = `${state.runDiagnostics.length} events. Elapsed ${formatDurationLong(duration)}.`;
  elements.copyDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.downloadDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.diagnosticsList.replaceChildren(...state.runDiagnostics.map((event) => {
    const item = document.createElement("li");
    item.textContent = `[+${formatDuration(event.elapsedMs)}] ${event.label}: ${event.detail}`;
    return item;
  }));
  renderPanelStates();
}

export function summarizeAssetResults() {
  const assets = state.rows.filter((row) => row.rowType === "Link" || row.rowType === "Image");
  const links = assets.filter((row) => row.rowType === "Link");
  const images = assets.filter((row) => row.rowType === "Image");
  const non200 = assets.filter((row) => isNon200Status(row.statusCode, row.redirectCount));
  const forbiddenByDomain = topDomainCounts(assets.filter((row) => Number(row.statusCode) === 403));
  const slowByDomain = topSlowDomains(assets);
  const parts = [
    `${links.length} links`,
    `${images.length} images`,
    `${non200.length} non-200/redirected assets`
  ];

  if (forbiddenByDomain) {
    parts.push(`403 domains: ${forbiddenByDomain}`);
  }

  if (slowByDomain) {
    parts.push(`slow domains: ${slowByDomain}`);
  }

  return parts.join("; ");
}

export function renderSummaryPlaceholderMetric(metric) {
  const button = document.createElement("button");
  button.className = "summary-metric is-placeholder";
  button.type = "button";
  button.disabled = true;
  button.innerHTML = `<strong>\u2014</strong><span>${escapeHtml(metric.label)}</span><small>${escapeHtml(metric.detail)}</small>`;
  return button;
}

export function renderSummaryPlaceholderBreakdown(title, items) {
  const section = document.createElement("section");
  section.className = "summary-breakdown is-placeholder";
  const header = document.createElement("div");
  header.className = "summary-breakdown-header";
  header.innerHTML = `<span>${escapeHtml(title)}</span><span class="summary-breakdown-total">\u2014</span>`;
  section.append(header);
  const legend = document.createElement("div");
  legend.className = "summary-legend";
  items.forEach((item) => {
    const row = document.createElement("span");
    row.className = "summary-legend-button is-placeholder";
    const dot = document.createElement("span");
    dot.className = "summary-dot";
    dot.dataset.tone = item.tone || "muted";
    const label = document.createElement("span");
    label.textContent = item.label;
    const count = document.createElement("span");
    count.className = "summary-count";
    count.textContent = "\u2014";
    row.append(dot, label, count);
    legend.append(row);
  });
  section.append(legend);
  return section;
}

export function renderSummaryPanel(counts = computeRowCounts()) {
  const hasRows = state.rows.length > 0;
  elements.summaryPanel.hidden = false;
  if (!hasRows) {
    state.summaryShown = false;
    elements.summaryPanelLine.textContent = "Run a check to populate these metrics.";
    elements.summaryMetrics.replaceChildren(...SUMMARY_PLACEHOLDER_METRICS.map(renderSummaryPlaceholderMetric));
    elements.summaryBreakdowns.replaceChildren(...SUMMARY_PLACEHOLDER_BREAKDOWNS.map((b) => renderSummaryPlaceholderBreakdown(b.title, b.items)));
    renderPanelStates();
    return;
  }

  if (!state.summaryShown) {
    state.summaryShown = true;
    state.panelCollapsed.summary = false;
  }

  const stats = summaryStats(counts);
  elements.summaryPanelLine.textContent = summaryStatusText(stats);

  const metrics = [
    { label: "Items", value: stats.total, detail: "All results", action: { kind: "all" } },
    { label: "Pages", value: stats.pages, detail: "Page URLs in crawl", action: { kind: "type", value: "Page" } },
    { label: "Links", value: stats.links, detail: "Discovered links", action: { kind: "type", value: "Link" } },
    { label: "Images", value: stats.images, detail: "Discovered images", action: { kind: "type", value: "Image" } },
    { label: "Status issues", value: stats.statusIssues, detail: "Non-200 status or errors", action: { kind: "flag", value: "issuesOnly" } },
    { label: "404s", value: stats.notFound, detail: "Not found items", action: { kind: "only404" } },
    { label: "Redirects", value: stats.redirects, detail: "Items with redirects", action: { kind: "flag", value: "redirectsOnly" } },
    { label: "Skipped", value: stats.skipped, detail: "Not checked by filters or stop", action: { kind: "flag", value: "skippedOnly" } }
  ];

  elements.summaryMetrics.replaceChildren(...metrics.map((metric) => renderSummaryMetric(metric)));
  elements.summaryBreakdowns.replaceChildren(
    renderSummaryBreakdown("Asset type", stats.total, [
      { label: "Pages", count: stats.pages, tone: "page", action: { kind: "type", value: "Page" } },
      { label: "Links", count: stats.links, tone: "link", action: { kind: "type", value: "Link" } },
      { label: "Images", count: stats.images, tone: "image", action: { kind: "type", value: "Image" } }
    ]),
    renderSummaryBreakdown("Status", stats.total, [
      { label: "2xx", count: stats.families["2xx"], tone: "success", action: { kind: "family", value: "2xx" } },
      { label: "3xx", count: stats.families["3xx"], tone: "warning", action: { kind: "family", value: "3xx" } },
      { label: "4xx", count: stats.families["4xx"], tone: "danger", action: { kind: "family", value: "4xx" } },
      { label: "5xx", count: stats.families["5xx"], tone: "danger", action: { kind: "family", value: "5xx" } },
      { label: "Errors", count: stats.errors, tone: "danger", action: { kind: "flag", value: "errorsOnly" } },
      { label: "Skipped", count: stats.skipped, tone: "muted", action: { kind: "flag", value: "skippedOnly" } }
    ]),
    renderSummaryBreakdown("Page issues", stats.pageIssueTotal, [
      { label: "Missing title", count: stats.pageIssues.missingTitle, tone: "page", action: { kind: "flag", value: "missingTitle" } },
      { label: "Missing description", count: stats.pageIssues.missingDescription, tone: "page", action: { kind: "flag", value: "missingDescription" } },
      { label: "Missing H1", count: stats.pageIssues.missingH1, tone: "page", action: { kind: "flag", value: "missingH1" } },
      { label: "Missing canonical", count: stats.pageIssues.missingCanonical, tone: "page", action: { kind: "flag", value: "missingCanonical" } },
      { label: "Canonicalized", count: stats.pageIssues.canonicalizedPages, tone: "page", action: { kind: "flag", value: "canonicalizedPages" } },
      { label: "Noindex", count: stats.pageIssues.noindexPages, tone: "page", action: { kind: "flag", value: "noindexPages" } }
    ], false),
    renderSummaryBreakdown("Asset issues", stats.assetIssueTotal, [
      { label: "Non-200 links", count: stats.non200Links, tone: "link", action: { kind: "typeIssue", type: "Link" } },
      { label: "Non-200 images", count: stats.non200Images, tone: "image", action: { kind: "typeIssue", type: "Image" } },
      { label: "Missing image alt", count: stats.pageIssues.missingImageAlt, tone: "image", action: { kind: "flag", value: "missingImageAlt" } },
      { label: "Skipped assets", count: stats.assetSkipped, tone: "muted", action: { kind: "flag", value: "skippedOnly" } }
    ], false)
  );

  renderPanelStates();
}

export function summaryStats(counts = computeRowCounts()) {
  const pageIssues = {
    missingTitle: counts.missingTitle,
    missingDescription: counts.missingDescription,
    missingH1: counts.missingH1,
    missingCanonical: counts.missingCanonical,
    canonicalizedPages: counts.canonicalizedPages,
    noindexPages: counts.noindexPages,
    missingImageAlt: counts.missingImageAlt
  };
  const families = {
    "2xx": counts.family2xx,
    "3xx": counts.family3xx,
    "4xx": counts.family4xx,
    "5xx": counts.family5xx
  };

  return {
    total: counts.total,
    checked: counts.checked,
    complete: counts.checked,
    pages: counts.typePage,
    links: counts.typeLink,
    images: counts.typeImage,
    issueRows: counts.issues,
    statusIssues: counts.issues,
    notFound: counts.notFound,
    redirects: counts.redirects,
    skipped: counts.skipped,
    assetSkipped: counts.assetSkipped,
    errors: counts.errors,
    non200Links: counts.non200Links,
    non200Images: counts.non200Images,
    families,
    pageIssueTotal: pageIssues.missingTitle + pageIssues.missingDescription + pageIssues.missingH1 + pageIssues.missingCanonical + pageIssues.canonicalizedPages + pageIssues.noindexPages,
    assetIssueTotal: counts.non200Links + counts.non200Images + pageIssues.missingImageAlt + counts.assetSkipped,
    pageIssues
  };
}

export function summaryStatusText(stats) {
  const statePrefix = state.running
    ? (state.paused ? "Paused" : "Crawling")
    : (state.currentPhase.startsWith("Stopped") ? "Stopped" : "Complete");
  const scopeParts = [
    stats.pages ? `${formatMaybeNumber(stats.pages)} page${stats.pages === 1 ? "" : "s"}` : "",
    stats.links ? `${formatMaybeNumber(stats.links)} link${stats.links === 1 ? "" : "s"}` : "",
    stats.images ? `${formatMaybeNumber(stats.images)} image${stats.images === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  const scope = scopeParts.length ? scopeParts.join(", ") : `${formatMaybeNumber(stats.total)} item${stats.total === 1 ? "" : "s"}`;
  const issueSuffix = state.running ? "found so far" : "found";

  return `${statePrefix}: ${scope}. ${formatMaybeNumber(stats.checked)}/${formatMaybeNumber(stats.total)} items checked. ${formatMaybeNumber(stats.statusIssues)} status issue${stats.statusIssues === 1 ? "" : "s"} ${issueSuffix}.`;
}

export function renderSummaryMetric(metric) {
  const button = document.createElement("button");
  const disabledForRun = isActivelyRunning();
  const disabledForEmpty = !metric.value && metric.action.kind !== "all";
  button.className = "summary-metric";
  button.classList.toggle("is-running-disabled", disabledForRun);
  button.classList.toggle("is-empty", disabledForEmpty);
  button.type = "button";
  button.disabled = disabledForRun || disabledForEmpty;
  button.setAttribute("aria-pressed", String(summaryActionActive(metric.action)));
  button.title = disabledForRun ? "Summary filters unlock when the crawl is paused, stopped, or complete." : (button.disabled ? metric.detail : `Filter results: ${metric.label}`);
  button.innerHTML = `<strong>${formatMaybeNumber(metric.value)}</strong><span>${escapeHtml(metric.label)}</span><small>${escapeHtml(metric.detail)}</small>`;
  button.addEventListener("click", () => applySummaryFilter(metric.action));
  return button;
}

export function renderSummaryBreakdown(title, total, items, showBar = true) {
  const section = document.createElement("section");
  section.className = "summary-breakdown";

  const header = document.createElement("div");
  header.className = "summary-breakdown-header";
  header.innerHTML = `<span>${escapeHtml(title)}</span><span class="summary-breakdown-total">${formatMaybeNumber(total)}</span>`;
  section.append(header);

  if (showBar) {
    const bar = document.createElement("div");
    bar.className = "summary-bar";
    const visibleItems = items.filter((item) => item.count > 0);
    if (visibleItems.length) {
      bar.append(...visibleItems.map((item) => renderSummaryBarSegment(item, total)));
    }
    section.append(bar);
  }

  const legend = document.createElement("div");
  legend.className = "summary-legend";
  legend.append(...items.map((item) => renderSummaryLegendButton(item)));
  section.append(legend);

  return section;
}

export function renderSummaryBarSegment(item, total) {
  const button = document.createElement("button");
  button.className = "summary-bar-segment";
  button.type = "button";
  button.dataset.tone = item.tone || "muted";
  button.style.flexBasis = `${Math.max(2, (item.count / Math.max(total, 1)) * 100)}%`;
  button.title = `${item.label}: ${formatMaybeNumber(item.count)}`;
  button.disabled = isActivelyRunning() || !item.action;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => applySummaryFilter(item.action));
  return button;
}

export function renderSummaryLegendButton(item) {
  const button = document.createElement("button");
  button.className = "summary-legend-button";
  button.type = "button";
  button.disabled = isActivelyRunning() || !item.count || !item.action;
  button.setAttribute("aria-pressed", String(summaryActionActive(item.action)));
  button.title = button.disabled ? item.label : `Filter results: ${item.label}`;

  const dot = document.createElement("span");
  dot.className = "summary-dot";
  dot.dataset.tone = item.tone || "muted";

  const label = document.createElement("span");
  label.textContent = item.label;

  const count = document.createElement("span");
  count.className = "summary-count";
  count.textContent = formatMaybeNumber(item.count);

  button.append(dot, label, count);
  button.addEventListener("click", () => applySummaryFilter(item.action));
  return button;
}

export function applySummaryFilter(action) {
  if (!action || isActivelyRunning()) {
    return;
  }

  // Clicking the already-active filter card toggles it off (back to all results).
  if (action.kind !== "all" && summaryActionActive(action)) {
    clearResultFilters(false);
    state.panelCollapsed.results = false;
    renderResults();
    scrollResultsIntoView();
    return;
  }

  clearResultFilters(false);
  state.panelCollapsed.results = false;

  if (action.kind === "all") {
    renderResults();
    scrollResultsIntoView();
    return;
  }

  // Note: we intentionally do not auto-open the filter panel here. Opening it would push
  // the filtered results below the fold; the highlighted summary card and updated counts
  // already signal the active filter, and the Filter button still opens the panel to refine.
  if (action.kind === "only404") {
    state.only404 = true;
  } else if (action.kind === "type") {
    state.filters.types = [action.value];
  } else if (action.kind === "family") {
    state.filters.families = [action.value];
  } else if (action.kind === "flag") {
    state.filters[action.value] = true;
  } else if (action.kind === "typeIssue") {
    state.filters.types = [action.type];
    state.filters.issuesOnly = true;
  }

  renderResults();
  scrollResultsIntoView();
}

export function summaryActionActive(action) {
  if (!action) {
    return false;
  }

  if (action.kind === "all") {
    // The "All results" card is a reset action, not a selectable state, so it never
    // shows as pressed. This avoids a phantom "selected" look when no filter is applied.
    return false;
  }

  if (action.kind === "only404") {
    return state.only404;
  }

  if (action.kind === "type") {
    return state.filters.types.includes(action.value);
  }

  if (action.kind === "family") {
    return state.filters.families.includes(action.value);
  }

  if (action.kind === "flag") {
    return Boolean(state.filters[action.value]);
  }

  if (action.kind === "typeIssue") {
    return state.filters.types.includes(action.type) && state.filters.issuesOnly;
  }

  return false;
}

export function topDomainCounts(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const domain = getUrlHostname(row.inputUrl);
    if (domain) {
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => `${domain} ${count}`)
    .join(", ");
}

export function topSlowDomains(rows) {
  const timings = new Map();
  rows.forEach((row) => {
    const ms = Number(row.responseTimeMs);
    const domain = getUrlHostname(row.inputUrl);
    if (!domain || !Number.isFinite(ms) || ms <= 0) {
      return;
    }

    const current = timings.get(domain) || { count: 0, total: 0, max: 0 };
    current.count += 1;
    current.total += ms;
    current.max = Math.max(current.max, ms);
    timings.set(domain, current);
  });

  return [...timings.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 5)
    .map(([domain, timing]) => `${domain} max ${formatMaybeNumber(timing.max)} ms avg ${formatMaybeNumber(Math.round(timing.total / timing.count))} ms`)
    .join(", ");
}

export function getUrlHostname(value) {
  try {
    return new URL(value).hostname;
  } catch (_error) {
    return "";
  }
}

export function updateSummary(counts = computeRowCounts()) {
  const total = counts.total;
  const checked = counts.checked;
  const issues = counts.issues;
  const notFound = counts.notFound;
  const skipped = counts.skipped;
  elements.only404Button.disabled = isActivelyRunning() || !state.rows.length || !notFound;
  elements.only404Button.setAttribute("aria-pressed", String(state.only404));
  elements.only404Button.querySelector("span").textContent = "404 Results";
  updateRetryErrorsButton();
  const activeFilters = activeFilterSummary();
  const filter = activeFilters ? ` Filters active: ${activeFilters}.` : "";

  elements.summaryLine.textContent = total
    ? `${formatMaybeNumber(checked)}/${formatMaybeNumber(total)} items checked. ${formatMaybeNumber(issues)} status issues. ${formatMaybeNumber(notFound)} 404s. ${formatMaybeNumber(skipped)} skipped.${filter}`
    : "No checks run yet.";
  renderSummaryPanel(counts);
}

export function activeFilterSummary() {
  const parts = [];
  if (state.only404) {
    parts.push("404");
  }
  if (state.filters.search) {
    parts.push("search");
  }
  if (state.filters.families.length) {
    parts.push(state.filters.families.join("/"));
  }
  if (state.filters.statuses.length) {
    parts.push(state.filters.statuses.join("/"));
  }
  if (state.filters.types.length) {
    parts.push(state.filters.types.join("/"));
  }
  if (state.filters.areas.length) {
    parts.push(state.filters.areas.join("/"));
  }
  if (state.filters.issuesOnly) {
    parts.push("status issues");
  }
  if (state.filters.redirectsOnly) {
    parts.push("redirects");
  }
  if (state.filters.errorsOnly) {
    parts.push("errors");
  }
  if (state.filters.skippedOnly) {
    parts.push("skipped");
  }
  if (state.filters.missingTitle) {
    parts.push("missing title");
  }
  if (state.filters.missingDescription) {
    parts.push("missing description");
  }
  if (state.filters.missingH1) {
    parts.push("missing H1");
  }
  if (state.filters.missingCanonical) {
    parts.push("missing canonical");
  }
  if (state.filters.canonicalizedPages) {
    parts.push("canonicalized");
  }
  if (state.filters.noindexPages) {
    parts.push("noindex");
  }
  if (state.filters.missingImageAlt) {
    parts.push("missing image alt");
  }
  return parts.join(", ");
}

export function pageOnlyPlaceholder(row) {
  return row.rowType === "Page" ? "" : "";
}

export function successPlaceholder(row) {
  return row.statusCode ? "OK" : "";
}

export function applySettingsAvailability() {
  const activeRun = isActivelyRunning();
  const pausedRun = state.running && state.paused;
  const lockedTitle = "Stop the crawl to change this setting.";
  const activeTitle = "Pause the crawl to change speed and timing for remaining checks.";

  if (elements.pausedSettingsNotice) {
    elements.pausedSettingsNotice.hidden = !pausedRun;
  }
  elements.settingsBand.classList.toggle("is-paused-run", pausedRun);

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
    elements.openInactiveInput,
    elements.useDedicatedRenderWindowInput,
    elements.useBrowserSessionInput,
    elements.closeRenderedTabsInput,
    elements.maxInputUrlsInput,
    elements.maxDiscoveredAssetsInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, state.running, lockedTitle);
  });

  [
    elements.pageConcurrencyInput,
    elements.renderedConcurrencyInput,
    elements.renderWaitInput,
    elements.linkConcurrencyInput,
    elements.timeoutInput,
    elements.linkDelayInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, activeRun, activeRun ? activeTitle : "");
  });

  [
    elements.themePreferenceInput,
    elements.timeDisplayUnitInput,
    elements.resultsDensityInput
  ].forEach((input) => {
    setSettingsControlDisabled(input, false);
  });

  elements.columnToggles.forEach((input) => {
    setSettingsControlDisabled(input, false);
  });

  [
    elements.hideImagesToggle,
    elements.hideLinksToggle,
    elements.hideSkippedToggle
  ].forEach((input) => {
    setSettingsControlDisabled(input, activeRun, activeRun ? "Pause the crawl to adjust result display filters." : "");
  });

  [
    elements.linksChip,
    elements.imagesChip
  ].forEach((button) => {
    setSettingsButtonDisabled(button, state.running, lockedTitle);
  });

  elements.presetButtons.forEach((button) => {
    setSettingsButtonDisabled(button, state.running, lockedTitle);
  });

  setSettingsButtonDisabled(elements.saveDefaultsButton, state.running, "Stop the crawl before saving settings as the default.");
  setSettingsButtonDisabled(elements.resetSettingsButton, state.running, "Stop the crawl before resetting settings.");
}

export function setControls() {
  updateInputUrlCount();
  const sourceMode = state.inputMode !== "list";
  const activeRun = isActivelyRunning();
  const canUseRows = Boolean(state.rows.length) && (!state.running || state.paused);
  elements.runButton.disabled = state.running;
  elements.copyUrlsButton.disabled = activeRun || !elements.urlInput.value.trim();
  elements.fileInput.disabled = sourceMode || state.running || state.loadingInputSource;
  elements.uploadFileButton.classList.toggle("is-disabled", elements.fileInput.disabled);
  elements.uploadFileButton.setAttribute("aria-disabled", String(elements.fileInput.disabled));
  elements.loadSourceButton.disabled = !sourceMode || state.running || state.loadingInputSource;
  elements.loadSourceButton.classList.toggle("is-loading", state.loadingInputSource);
  elements.loadSourceButton.setAttribute("aria-busy", String(state.loadingInputSource));
  elements.loadSourceButton.title = state.loadingInputSource ? "Fetching URLs" : "Fetch URLs";
  // In list mode the field is a read-only "click to upload" trigger, so it must stay
  // enabled (disabled inputs do not fire click events); it is read-only via renderInputMode.
  elements.sourceUrlInput.disabled = state.running || state.loadingInputSource;
  elements.exportButton.disabled = !canUseRows;
  elements.exportSummaryButton.disabled = !canUseRows;
  elements.copyResultsButton.disabled = !canUseRows;
  elements.copySummaryButton.disabled = !canUseRows;
  elements.copyAiSummaryButton.disabled = !canUseRows;
  elements.filterButton.disabled = !canUseRows;
  updateRetryErrorsButton();
  elements.copyDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.downloadDiagnosticsButton.disabled = !state.runDiagnostics.length;
  elements.only404Button.disabled = activeRun || !state.rows.length || !state.rows.some((row) => is404Row(row));
  elements.clearButton.disabled = state.running;
  applySettingsAvailability();
  elements.inputModeButtons.forEach((button) => {
    button.disabled = state.running || state.loadingInputSource;
  });
  renderPaginationControls();
  updateRunControlButtons();
}

export function updateRunControlButtons() {
  elements.progressControls.hidden = !state.running;
  elements.pauseRunButton.disabled = !state.running || state.stopRequested;
  elements.stopRunButton.disabled = !state.running || state.stopRequested;
  elements.pauseRunButton.classList.toggle("is-paused", state.paused);
  elements.pauseRunButton.setAttribute("aria-pressed", String(state.paused));
  elements.pauseRunButton.title = state.paused ? "Resume crawl" : "Pause crawl";
  elements.pauseRunButton.setAttribute("aria-label", state.paused ? "Resume crawl" : "Pause crawl");
  elements.stopRunButton.title = state.stopRequested ? "Stopping crawl" : "Stop crawl";
  elements.stopRunButton.setAttribute("aria-label", state.stopRequested ? "Stopping crawl" : "Stop crawl");

  const pauseIcon = elements.pauseRunButton.querySelector("[data-pause-icon]");
  const playIcon = elements.pauseRunButton.querySelector("[data-play-icon]");
  if (pauseIcon && playIcon) {
    pauseIcon.hidden = state.paused;
    playIcon.hidden = !state.paused;
  }
}

export function updateRetryErrorsButton() {
  const count = retryableErrorEntries().length;
  const autoRetryNote = state.settings.autoRetryErrors ? " Automatic retry is enabled for future runs." : "";
  elements.retryErrorsButton.hidden = count === 0;
  elements.retryErrorsButton.disabled = state.running || count === 0;
  elements.retryErrorsButton.title = count
    ? `Retry ${formatMaybeNumber(count)} row${count === 1 ? "" : "s"} that ended with Error.${autoRetryNote}`
    : "No error rows to retry";
  elements.retryErrorsButton.setAttribute("aria-label", count
    ? `Retry ${formatMaybeNumber(count)} error row${count === 1 ? "" : "s"}`
    : "Retry Errors");
}
