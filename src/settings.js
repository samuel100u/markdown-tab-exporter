export const DEFAULT_EXPORT_SETTINGS = {
  linkedExportEnforceLanguage: true,
  linkedExportMaxPages: 50,
  linkedExportParallelTabs: 3,
  linkedExportUrlPrefix: "",
  linkedExportScope: "same-origin",
  linkedExportTimeoutSeconds: 30
};
export const LAST_BACKGROUND_ERROR_KEY = "lastBackgroundError";
export const EXPORT_STOP_REQUEST_KEY = "exportStopRequestedAt";

const SETTINGS_KEYS = Object.keys(DEFAULT_EXPORT_SETTINGS);

export async function getExportSettings() {
  if (!chrome.storage?.local) {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }

  const storedSettings = await chrome.storage.local.get(SETTINGS_KEYS);
  return normalizeExportSettings({
    ...DEFAULT_EXPORT_SETTINGS,
    ...storedSettings
  });
}

export async function saveExportSettings(settings) {
  const normalizedSettings = normalizeExportSettings({
    ...DEFAULT_EXPORT_SETTINGS,
    ...settings
  });

  if (chrome.storage?.local) {
    await chrome.storage.local.set(normalizedSettings);
  }

  return normalizedSettings;
}

export async function getLastBackgroundError() {
  if (!chrome.storage?.local) {
    return null;
  }

  const result = await chrome.storage.local.get(LAST_BACKGROUND_ERROR_KEY);
  return result[LAST_BACKGROUND_ERROR_KEY] || null;
}

export async function saveLastBackgroundError(error, message) {
  if (!chrome.storage?.local) {
    return;
  }

  await chrome.storage.local.set({
    [LAST_BACKGROUND_ERROR_KEY]: {
      message: message || error?.message || String(error),
      stack: error?.stack || "",
      timestamp: new Date().toISOString()
    }
  });
}

export async function clearLastBackgroundError() {
  if (chrome.storage?.local) {
    await chrome.storage.local.remove(LAST_BACKGROUND_ERROR_KEY);
  }
}

export async function requestExportStop() {
  if (chrome.storage?.local) {
    await chrome.storage.local.set({
      [EXPORT_STOP_REQUEST_KEY]: new Date().toISOString()
    });
  }
}

export async function clearExportStopRequest() {
  if (chrome.storage?.local) {
    await chrome.storage.local.remove(EXPORT_STOP_REQUEST_KEY);
  }
}

export async function isExportStopRequested() {
  if (!chrome.storage?.local) {
    return false;
  }

  const result = await chrome.storage.local.get(EXPORT_STOP_REQUEST_KEY);
  return Boolean(result[EXPORT_STOP_REQUEST_KEY]);
}

export function normalizeExportSettings(settings) {
  return {
    linkedExportEnforceLanguage: settings.linkedExportEnforceLanguage !== false,
    linkedExportMaxPages: clampInteger(settings.linkedExportMaxPages, 1, 1000, 50),
    linkedExportParallelTabs: clampInteger(settings.linkedExportParallelTabs, 1, 5, 3),
    linkedExportUrlPrefix: normalizeUrlPrefix(settings.linkedExportUrlPrefix),
    linkedExportScope: ["same-origin", "same-hostname"].includes(settings.linkedExportScope)
      ? settings.linkedExportScope
      : "same-origin",
    linkedExportTimeoutSeconds: clampInteger(settings.linkedExportTimeoutSeconds, 5, 120, 30)
  };
}

function normalizeUrlPrefix(value) {
  return (value || "").trim();
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
