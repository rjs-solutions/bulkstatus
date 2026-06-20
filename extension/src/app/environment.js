// Manifest + runtime environment info (browser, OS, screen) used by the version
// label and diagnostics. Depends only on chrome/navigator globals.

export function appManifest() {
  try {
    return chrome.runtime.getManifest();
  } catch (_error) {
    return { name: "BulkStatus - Bulk URL Checker", version: "dev", manifest_version: 3 };
  }
}

export function currentAppVersion() {
  return appManifest().version || "dev";
}

export function diagnosticsEnvironment() {
  const userAgent = navigator.userAgent;
  return {
    userAgent,
    chromeVersion: getChromeVersion(userAgent),
    operatingSystem: getOperatingSystem(userAgent, navigator.platform),
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages ? [...navigator.languages] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
    screen: {
      width: window.screen?.width || null,
      height: window.screen?.height || null,
      devicePixelRatio: window.devicePixelRatio || null
    },
    extensionId: chrome.runtime?.id || ""
  };
}

export function getChromeVersion(userAgent) {
  const match = String(userAgent || "").match(/(?:Chrome|CriOS|Edg)\/([\d.]+)/);
  return match ? match[1] : "";
}

export function getOperatingSystem(userAgent, platform) {
  const text = `${userAgent || ""} ${platform || ""}`.toLowerCase();
  if (text.includes("windows nt 10")) {
    return "Windows 10/11";
  }
  if (text.includes("windows")) {
    return "Windows";
  }
  if (text.includes("mac os x") || text.includes("macintel")) {
    return "macOS";
  }
  if (text.includes("linux")) {
    return "Linux";
  }
  if (text.includes("android")) {
    return "Android";
  }
  if (text.includes("iphone") || text.includes("ipad")) {
    return "iOS/iPadOS";
  }
  return platform || "";
}
