export const DEFAULT_EXPORT_SETTINGS = {
  linkedExportMaxPages: 50,
  linkedExportScope: "same-origin",
  linkedExportTimeoutSeconds: 30
};

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

export function normalizeExportSettings(settings) {
  return {
    linkedExportMaxPages: clampInteger(settings.linkedExportMaxPages, 1, 200, 50),
    linkedExportScope: ["same-origin", "same-hostname"].includes(settings.linkedExportScope)
      ? settings.linkedExportScope
      : "same-origin",
    linkedExportTimeoutSeconds: clampInteger(settings.linkedExportTimeoutSeconds, 5, 120, 30)
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
