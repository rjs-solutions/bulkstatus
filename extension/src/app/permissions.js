// Runtime permission requests for site access and the scripting API used by
// rendered crawls. The last error message for each is exported as a live binding
// so callers can surface it after a denied request.

export let renderedPermissionError = "";
export let hostPermissionError = "";

export async function ensureRenderedPermission() {
  renderedPermissionError = "";

  if (chrome.scripting?.executeScript) {
    return true;
  }

  if (!chrome.permissions?.request) {
    renderedPermissionError = "Chrome permissions API is unavailable. Reload the unpacked extension, then try Rendered JavaScript again.";
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({ permissions: ["scripting"] });
    if (alreadyGranted) {
      return true;
    }
  } catch (_error) {
    // Continue to request; contains can fail in stale extension instances.
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: ["scripting"] }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        renderedPermissionError = `${error.message} Reload the unpacked extension if this permission was just added to the manifest.`;
        resolve(false);
        return;
      }

      if (!granted) {
        renderedPermissionError = "Permission was not granted.";
      }
      resolve(Boolean(granted));
    });
  });
}

export async function ensureHostPermission() {
  hostPermissionError = "";
  const origins = ["http://*/*", "https://*/*"];

  if (!chrome.permissions?.contains || !chrome.permissions?.request) {
    hostPermissionError = "Chrome permissions API is unavailable. Reload the unpacked extension, then try again.";
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({ origins });
    if (alreadyGranted) {
      return true;
    }
  } catch (_error) {
    // Continue to request access; contains can fail in stale extension instances.
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        hostPermissionError = `${error.message} Reload the unpacked extension if this permission was just added to the manifest.`;
        resolve(false);
        return;
      }

      if (!granted) {
        hostPermissionError = "Site access permission was not granted.";
      }
      resolve(Boolean(granted));
    });
  });
}
