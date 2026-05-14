import "./popup.css";
import {
  UnsupportedPageError,
  collectPageSnapshot,
  extractMarkdownFromSnapshot,
  isSupportedPageUrl,
  makeMarkdownFilename,
  makeZipFilename
} from "./extractPage.js";
import { createMarkdownZip, downloadBlob } from "./zipExport.js";

const exportCurrentButton = document.querySelector("#export-current");
const exportAllButton = document.querySelector("#export-all");
const statusMessage = document.querySelector("#status-message");
const detailsList = document.querySelector("#details");

exportCurrentButton.addEventListener("click", () => {
  runWithBusyState(exportCurrentPage);
});

exportAllButton.addEventListener("click", () => {
  runWithBusyState(exportAllTabs);
});

async function exportCurrentPage() {
  setStatus("Reading current page...");
  const [tab] = await queryTabs({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("No active tab was found.");
  }

  const exported = await exportTab(tab);
  const blob = new Blob([exported.content], {
    type: "text/markdown;charset=utf-8"
  });

  setStatus("Choose where to save the Markdown file...");
  await downloadBlob(blob, exported.name);
  setStatus("Current page exported.", [`Saved ${exported.name}`]);
}

async function exportAllTabs() {
  const tabs = await queryTabs({ currentWindow: true });
  const readableTabs = tabs.filter((tab) => isSupportedPageUrl(tab.url));
  const skippedTabs = tabs
    .filter((tab) => !isSupportedPageUrl(tab.url))
    .map((tab) => `${tab.title || tab.url || "Untitled tab"}: unsupported page type`);

  const files = [];
  const failures = [...skippedTabs];

  for (const [readableIndex, tab] of readableTabs.entries()) {
    setStatus(`Reading tab ${readableIndex + 1} of ${readableTabs.length}...`);

    try {
      files.push(await exportTab(tab, readableIndex));
    } catch (error) {
      failures.push(`${tab.title || tab.url || "Untitled tab"}: ${toUserMessage(error)}`);
    }
  }

  if (!files.length) {
    throw new Error("No readable tabs could be exported.");
  }

  setStatus(`Creating ZIP with ${files.length} Markdown file${files.length === 1 ? "" : "s"}...`);
  const zipBlob = await createMarkdownZip(files);

  setStatus("Choose where to save the ZIP file...");
  await downloadBlob(zipBlob, makeZipFilename());

  const summary = [`Exported ${files.length} tab${files.length === 1 ? "" : "s"}.`];

  if (failures.length) {
    summary.push(`Skipped ${failures.length} tab${failures.length === 1 ? "" : "s"}.`);
  }

  setStatus("All readable tabs exported.", [...summary, ...failures.slice(0, 8)]);
}

async function exportTab(tab, index) {
  if (!isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab.url);
  }

  const snapshot = await executeInTab(tab.id, collectPageSnapshot);
  const extracted = extractMarkdownFromSnapshot(snapshot);

  return {
    content: extracted.markdown,
    name: makeMarkdownFilename(extracted.title || tab.title, tab.url, index)
  };
}

function executeInTab(tabId, func) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        func,
        target: { tabId }
      },
      (results) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        const [mainFrameResult] = results || [];

        if (!mainFrameResult?.result) {
          reject(new Error("The page did not return content."));
          return;
        }

        resolve(mainFrameResult.result);
      }
    );
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tabs);
    });
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
  exportCurrentButton.disabled = isBusy;
  exportAllButton.disabled = isBusy;
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

function toUserMessage(error) {
  if (!error) {
    return "Unknown error.";
  }

  if (error.message?.includes("Cannot access")) {
    return "Chrome blocked access to this page.";
  }

  if (error.message?.includes("The extensions gallery cannot be scripted")) {
    return "Chrome blocks extensions from reading the Chrome Web Store.";
  }

  return error.message || String(error);
}
