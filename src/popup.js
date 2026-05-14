import "./popup.css";
import {
  exportAllTabs,
  exportCurrentPage,
  exportLinkedPagesFromCurrentTab,
  toUserMessage
} from "./exportService.js";
import { getExportSettings, saveExportSettings } from "./settings.js";

const exportCurrentButton = document.querySelector("#export-current");
const exportAllButton = document.querySelector("#export-all");
const exportLinkedButton = document.querySelector("#export-linked");
const actionButtons = [exportCurrentButton, exportAllButton, exportLinkedButton];
const linkedMaxPagesInput = document.querySelector("#linked-max-pages");
const linkedScopeSelect = document.querySelector("#linked-scope");
const linkedTimeoutInput = document.querySelector("#linked-timeout");
const settingsInputs = [linkedMaxPagesInput, linkedScopeSelect, linkedTimeoutInput];
const statusMessage = document.querySelector("#status-message");
const detailsList = document.querySelector("#details");

initializeSettings();

exportCurrentButton.addEventListener("click", () => {
  runWithBusyState(() => exportCurrentPage({ onStatus: setStatus }));
});

exportAllButton.addEventListener("click", () => {
  runWithBusyState(() => exportAllTabs({ onStatus: setStatus }));
});

exportLinkedButton.addEventListener("click", () => {
  runWithBusyState(() => exportLinkedPagesFromCurrentTab({ onStatus: setStatus }));
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

async function saveSettingsFromForm() {
  try {
    const settings = await saveExportSettings({
      linkedExportMaxPages: linkedMaxPagesInput.value,
      linkedExportScope: linkedScopeSelect.value,
      linkedExportTimeoutSeconds: linkedTimeoutInput.value
    });

    renderSettings(settings);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus("Could not save settings.", [toUserMessage(error)]);
  }
}

function renderSettings(settings) {
  linkedMaxPagesInput.value = settings.linkedExportMaxPages;
  linkedScopeSelect.value = settings.linkedExportScope;
  linkedTimeoutInput.value = settings.linkedExportTimeoutSeconds;
}

