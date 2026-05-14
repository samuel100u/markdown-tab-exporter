import {
  UnsupportedPageError,
  collectPageSnapshot,
  collectReadableLinks,
  extractMarkdownFromSnapshot,
  isSupportedPageUrl,
  makeMarkdownFilename,
  makeZipFilename
} from "./extractPage.js";
import { getExportSettings } from "./settings.js";
import { downloadBlob, downloadZipFiles } from "./zipExport.js";

const DEFAULT_LINKED_EXPORT_LIMIT = 50;
const TAB_LOAD_TIMEOUT_MS = 30000;
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen.html";
const OFFSCREEN_CONVERT_MESSAGE = "markdown-tab-exporter:convert-snapshot";

let offscreenCreationPromise;

export async function exportCurrentPage(options = {}) {
  const { onStatus = noop } = options;
  onStatus("Reading current page...");

  const tab = options.tab || (await queryTabs({ active: true, currentWindow: true }))[0];

  if (!tab) {
    throw new Error("No active tab was found.");
  }

  const exported = await exportTab(tab);
  const blob = new Blob([exported.content], {
    type: "text/markdown;charset=utf-8"
  });

  onStatus("Choose where to save the Markdown file...");
  await downloadBlob(blob, exported.name);

  const details = [`Saved ${exported.name}`];
  onStatus("Current page exported.", details);

  return {
    details,
    exportedCount: 1,
    skippedCount: 0
  };
}

export async function exportAllTabs(options = {}) {
  const { onStatus = noop, windowId } = options;
  const tabs = await queryTabs(windowId ? { windowId } : { currentWindow: true });
  const readableTabs = tabs.filter((tab) => isSupportedPageUrl(tab.url));
  const skippedTabs = tabs
    .filter((tab) => !isSupportedPageUrl(tab.url))
    .map((tab) => `${tab.title || tab.url || "Untitled tab"}: unsupported page type`);

  const files = [];
  const failures = [...skippedTabs];

  for (const [readableIndex, tab] of readableTabs.entries()) {
    onStatus(`Reading tab ${readableIndex + 1} of ${readableTabs.length}...`);

    try {
      files.push(await exportTab(tab, readableIndex));
    } catch (error) {
      failures.push(`${tab.title || tab.url || "Untitled tab"}: ${toUserMessage(error)}`);
    }
  }

  if (!files.length) {
    throw new Error("No readable tabs could be exported.");
  }

  return downloadMarkdownZip({
    baseFilename: makeZipFilename(),
    files,
    failures,
    onStatus,
    source: "Open tabs"
  });
}

export async function exportLinkedPagesFromCurrentTab(options = {}) {
  const { onStatus = noop } = options;
  const [tab] = await queryTabs({ active: true, currentWindow: true });

  if (!tab) {
    throw new Error("No active tab was found.");
  }

  return exportLinkedPagesFromTab(tab, options);
}

export async function exportLinkedPagesFromTab(tab, options = {}) {
  const settings = await getExportSettings();
  const {
    maxPages = settings.linkedExportMaxPages || DEFAULT_LINKED_EXPORT_LIMIT,
    onStatus = noop,
    scope = settings.linkedExportScope,
    timeoutSeconds = settings.linkedExportTimeoutSeconds
  } = options;
  const timeoutMs = timeoutSeconds * 1000 || TAB_LOAD_TIMEOUT_MS;

  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab?.url);
  }

  onStatus(`Collecting links (${formatScope(scope)}, max ${maxPages})...`);

  const linkCollection = await executeInTab(tab.id, collectReadableLinks, [{ maxPages, scope }]);
  const links = linkCollection.links || [];

  if (!links.length) {
    throw new Error("No same-origin readable links were found on this page.");
  }

  const files = [];
  const failures = [];

  for (const [index, link] of links.entries()) {
    onStatus(`Reading linked page ${index + 1} of ${links.length}...`, [link.url]);

    try {
      const temporaryTab = await createInactiveTab(link.url, tab.windowId);

      try {
        const loadedTab = await waitForTabLoad(temporaryTab.id, timeoutMs);
        files.push(
          await exportTab(
            {
              ...loadedTab,
              url: loadedTab.url || link.url
            },
            index
          )
        );
      } finally {
        await removeTab(temporaryTab.id);
      }
    } catch (error) {
      failures.push(`${link.url}: ${toUserMessage(error)}`);
    }
  }

  if (!files.length) {
    throw new Error(`No linked pages could be exported. ${summarizeFailures(failures)}`);
  }

  const summaryFile = createExportSummaryFile({
    exportedFiles: files,
    failures,
    links,
    sourceTitle: linkCollection.sourceTitle,
    sourceUrl: linkCollection.sourceUrl
  });

  return downloadMarkdownZip({
    baseFilename: makeZipFilename("linked-pages"),
    files: [...files, summaryFile],
    failures,
    onStatus,
    source: "Linked pages"
  });
}

function formatScope(scope) {
  return scope === "same-hostname" ? "same hostname" : "same origin";
}

export async function exportTab(tab, index) {
  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab?.url);
  }

  const snapshot = await executeInTab(tab.id, collectPageSnapshot);
  const extracted = await convertSnapshotToMarkdown(snapshot);

  return {
    content: extracted.markdown,
    name: makeMarkdownFilename(extracted.title || tab.title, tab.url, index)
  };
}

export function toUserMessage(error) {
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

function executeInTab(tabId, func, args = []) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        args,
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

function createInactiveTab(url, windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(
      {
        active: false,
        url,
        windowId
      },
      (tab) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(tab);
      }
    );
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      resolve();
    });
  });
}

function waitForTabLoad(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        getTab(tabId).then(resolve, reject);
      }
    };

    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (tab.status === "complete") {
        resolve(tab);
        return;
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while loading the linked page."));
      }, timeoutMs);
    });
  });
}

function summarizeFailures(failures) {
  if (!failures.length) {
    return "No failure details were recorded.";
  }

  return `First failures: ${failures.slice(0, 3).join(" | ")}`;
}

async function convertSnapshotToMarkdown(snapshot) {
  if (typeof DOMParser === "function") {
    return extractMarkdownFromSnapshot(snapshot);
  }

  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    snapshot,
    type: OFFSCREEN_CONVERT_MESSAGE
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to convert page content.");
  }

  return response.result;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("This browser does not support Chrome offscreen documents.");
  }

  if (offscreenCreationPromise) {
    return offscreenCreationPromise;
  }

  offscreenCreationPromise = createOffscreenDocument();

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = undefined;
  }
}

async function createOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });

    if (existingContexts.length) {
      return;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      justification: "Convert captured page HTML and ZIP blobs from the background service worker.",
      reasons: ["DOM_PARSER"],
      url: OFFSCREEN_DOCUMENT_PATH
    });
  } catch (error) {
    if (!String(error?.message || error).includes("Only a single offscreen document")) {
      throw error;
    }
  }
}

async function downloadMarkdownZip({ baseFilename, files, failures, onStatus, source }) {
  onStatus(`Creating ZIP with ${files.length} Markdown file${files.length === 1 ? "" : "s"}...`);

  if (typeof URL.createObjectURL !== "function") {
    await ensureOffscreenDocument();
  }

  onStatus("Choose where to save the ZIP file...");
  await downloadZipFiles(files, baseFilename);

  const exportedContentFiles = files.filter((file) => file.name !== "export-summary.md");
  const details = [`Exported ${exportedContentFiles.length} ${source.toLowerCase()}.`];

  if (failures.length) {
    details.push(`Skipped ${failures.length} page${failures.length === 1 ? "" : "s"}.`);
  }

  onStatus(`${source} exported.`, [...details, ...failures.slice(0, 8)]);

  return {
    details,
    exportedCount: exportedContentFiles.length,
    skippedCount: failures.length
  };
}

function createExportSummaryFile({ exportedFiles, failures, links, sourceTitle, sourceUrl }) {
  const exportedList = exportedFiles.map((file) => `- ${file.name}`);
  const requestedList = links.map((link) => `- ${link.url}`);
  const failureList = failures.length ? failures.map((failure) => `- ${failure}`) : ["- None"];
  const sourceTitleLine = sourceTitle ? [`Source title: ${sourceTitle}`] : [];

  return {
    content: [
      "# Export Summary",
      "",
      `Source: ${sourceUrl || "Unknown"}`,
      ...sourceTitleLine,
      `Exported: ${new Date().toISOString()}`,
      "",
      "## Requested Links",
      "",
      ...requestedList,
      "",
      "## Exported Files",
      "",
      ...exportedList,
      "",
      "## Skipped Links",
      "",
      ...failureList,
      ""
    ].join("\n"),
    name: "export-summary.md"
  };
}

function noop() {}
