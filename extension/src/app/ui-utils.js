// Low-level UI utilities: toasts, scrolling, fullscreen, control enable/disable,
// run-state check, and the pause-aware delay. Depend only on shared state + DOM.

import { state } from "./state.js";
import { elements } from "./dom.js";

export function scrollAppToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function updateBackToTopVisibility() {
  if (!elements.floatingBackToTop) {
    return;
  }
  const scrolled = (window.scrollY || document.documentElement.scrollTop || 0) > 480;
  elements.floatingBackToTop.hidden = !scrolled || state.resultsFullscreen;
}

export function setResultsFullscreen(on) {
  state.resultsFullscreen = Boolean(on);
  document.body.classList.toggle("results-maximized", state.resultsFullscreen);
  elements.resultsBand.classList.toggle("is-maximized", state.resultsFullscreen);
  updateBackToTopVisibility();
  const button = elements.resultsFullscreenButton;
  if (button) {
    const label = state.resultsFullscreen ? "Exit full screen" : "Expand results to full screen";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

export function scrollResultsIntoView() {
  const target = elements.resultsPanelBody?.closest("section") || elements.resultsPanelBody;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function setStatus(value) {
  document.title = value && value !== "Ready." ? `${value} - BulkStatus - Bulk URL Checker` : "BulkStatus - Bulk URL Checker";
}

export function isActivelyRunning() {
  return state.running && !state.paused;
}

export function setContextTitle(element, disabled, title) {
  if (!element) {
    return;
  }

  if (element.dataset.defaultTitle === undefined) {
    element.dataset.defaultTitle = element.getAttribute("title") || "";
  }

  if (disabled && title) {
    element.title = title;
    return;
  }

  const defaultTitle = element.dataset.defaultTitle;
  if (defaultTitle) {
    element.title = defaultTitle;
  } else {
    element.removeAttribute("title");
  }
}

export function setSettingsControlDisabled(control, disabled, title = "") {
  if (!control) {
    return;
  }

  control.disabled = Boolean(disabled);
  setContextTitle(control, disabled, title);

  const wrapper = control.closest(".check-row, .number-field, .select-field");
  if (wrapper) {
    wrapper.classList.toggle("is-disabled", Boolean(disabled));
    setContextTitle(wrapper, disabled, title);
  }
}

export function setSettingsButtonDisabled(button, disabled, title = "") {
  if (!button) {
    return;
  }

  button.disabled = Boolean(disabled);
  button.classList.toggle("is-disabled", Boolean(disabled));
  setContextTitle(button, disabled, title);
}

export function showToast(message) {
  const toast = elements.appToast;
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toast._hideTimer);
  toast._hideTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

export function openExternalUrl(url) {
  if (!url) {
    return;
  }
  if (globalThis.chrome?.tabs?.create) {
    globalThis.chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function flashButton(button, label) {
  const text = button.querySelector("span") || button;
  if (!text || !text.textContent) {
    return;
  }

  const previous = text.textContent;
  text.textContent = label;
  window.setTimeout(() => {
    text.textContent = previous;
  }, 1200);
}

export function flashIconButton(button, label) {
  const previousTitle = button.title;
  const previousLabel = button.getAttribute("aria-label") || previousTitle;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "true");
  window.setTimeout(() => {
    button.title = previousTitle;
    button.setAttribute("aria-label", previousLabel);
    button.setAttribute("aria-pressed", "false");
  }, 1200);
}

export function delay(ms) {
  const duration = Number(ms) || 0;
  if (duration <= 0 || state.stopRequested) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let remaining = duration;
    let lastTick = performance.now();

    function tick() {
      if (state.stopRequested) {
        resolve();
        return;
      }

      const now = performance.now();
      if (!state.paused) {
        remaining -= now - lastTick;
      }
      lastTick = now;

      if (remaining <= 0) {
        resolve();
        return;
      }

      window.setTimeout(tick, Math.min(remaining, 200));
    }

    tick();
  });
}
