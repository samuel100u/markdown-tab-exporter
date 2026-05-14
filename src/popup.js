import "./popup.css";
import {
  exportAllTabs,
  exportCurrentPage,
  exportLinkedPagesFromCurrentTab,
  readCurrentPageMarkdown,
  toUserMessage
} from "./exportService.js";
import {
  LAST_BACKGROUND_ERROR_KEY,
  getExportSettings,
  getLastBackgroundError,
  requestExportStop,
  saveExportSettings
} from "./settings.js";

const exportCurrentButton = document.querySelector("#export-current");
const copyCurrentButton = document.querySelector("#copy-current");
const exportAllButton = document.querySelector("#export-all");
const exportLinkedButton = document.querySelector("#export-linked");
const stopExportButton = document.querySelector("#stop-export");
const actionButtons = [exportCurrentButton, copyCurrentButton, exportAllButton, exportLinkedButton];
const linkedMaxPagesInput = document.querySelector("#linked-max-pages");
const linkedParallelTabsInput = document.querySelector("#linked-parallel-tabs");
const linkedScopeSelect = document.querySelector("#linked-scope");
const linkedUrlPrefixInput = document.querySelector("#linked-url-prefix");
const linkedTimeoutInput = document.querySelector("#linked-timeout");
const linkedEnforceLanguageInput = document.querySelector("#linked-enforce-language");
const settingsInputs = [
  linkedMaxPagesInput,
  linkedParallelTabsInput,
  linkedScopeSelect,
  linkedUrlPrefixInput,
  linkedTimeoutInput,
  linkedEnforceLanguageInput
];
const statusMessage = document.querySelector("#status-message");
const detailsList = document.querySelector("#details");

initializeSettings();
showLastBackgroundError();

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[LAST_BACKGROUND_ERROR_KEY]) {
      renderLastBackgroundError(changes[LAST_BACKGROUND_ERROR_KEY].newValue);
    }
  });
}

exportCurrentButton.addEventListener("click", () => {
  runWithBusyState(() => exportCurrentPage({ onStatus: setStatus }));
});

copyCurrentButton.addEventListener("click", () => {
  runWithBusyState(copyCurrentPageToClipboard);
});

exportAllButton.addEventListener("click", () => {
  runWithBusyState(() => exportAllTabs({ onStatus: setStatus }));
});

exportLinkedButton.addEventListener("click", () => {
  runWithBusyState(() => exportLinkedPagesFromCurrentTab({ onStatus: setStatus }));
});

stopExportButton.addEventListener("click", async () => {
  try {
    await requestExportStop();
    setStatus("Stop requested.", ["The running export will stop after the current tab cleanup finishes."]);
  } catch (error) {
    setStatus("Could not request stop.", [toUserMessage(error)]);
  }
});

for (const input of settingsInputs) {
  input.addEventListener("change", () => {
    saveSettingsFromForm();
  });
}

async function runWithBusyState(task) {
  setBusy(true);
  clearDetails();

  try {
    await task();
  } catch (error) {
    setStatus("Export failed.", [toUserMessage(error)]);
  } finally {
    setBusy(false);
  }
}

async function copyCurrentPageToClipboard() {
  const exported = await readCurrentPageMarkdown({ onStatus: setStatus });
  setStatus("Copying Markdown to clipboard...");
  await writeClipboardText(exported.content);
  setStatus("Current page copied.", [`Copied ${exported.name}`]);
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command was rejected.");
    }
  } finally {
    textarea.remove();
  }
}

function setBusy(isBusy) {
  for (const button of actionButtons) {
    button.disabled = isBusy;
  }
}

function setStatus(message, details = []) {
  statusMessage.textContent = message;
  detailsList.replaceChildren(...details.map(createDetailItem));
}

function clearDetails() {
  detailsList.replaceChildren();
}

function createDetailItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

async function initializeSettings() {
  try {
    renderSettings(await getExportSettings());
  } catch (error) {
    setStatus("Could not load settings.", [toUserMessage(error)]);
  }
}

async function showLastBackgroundError() {
  try {
    renderLastBackgroundError(await getLastBackgroundError());
  } catch {
    // Best-effort diagnostics only.
  }
}

async function saveSettingsFromForm() {
  try {
    const settings = await saveExportSettings({
      linkedExportEnforceLanguage: linkedEnforceLanguageInput.checked,
      linkedExportMaxPages: linkedMaxPagesInput.value,
      linkedExportParallelTabs: linkedParallelTabsInput.value,
      linkedExportScope: linkedScopeSelect.value,
      linkedExportUrlPrefix: linkedUrlPrefixInput.value,
      linkedExportTimeoutSeconds: linkedTimeoutInput.value
    });

    renderSettings(settings);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus("Could not save settings.", [toUserMessage(error)]);
  }
}

function renderSettings(settings) {
  linkedEnforceLanguageInput.checked = settings.linkedExportEnforceLanguage;
  linkedMaxPagesInput.value = settings.linkedExportMaxPages;
  linkedParallelTabsInput.value = settings.linkedExportParallelTabs;
  linkedScopeSelect.value = settings.linkedExportScope;
  linkedUrlPrefixInput.value = settings.linkedExportUrlPrefix;
  linkedTimeoutInput.value = settings.linkedExportTimeoutSeconds;
}

function renderLastBackgroundError(error) {
  if (!error) {
    return;
  }

  setStatus(
    "Last background export failed.",
    [
      error.message,
      error.timestamp ? `Time: ${error.timestamp}` : "",
      error.stack ? error.stack.split("\n").slice(0, 2).join(" ") : ""
    ].filter(Boolean)
  );
}

