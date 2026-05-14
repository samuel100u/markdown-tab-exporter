import {
  UnsupportedPageError,
  collectPageSnapshot,
  collectReadableLinks,
  detectPageLanguage,
  extractMarkdownFromSnapshot,
  isSupportedPageUrl,
  isSameLanguagePage,
  makeMarkdownFilename,
  makeZipFilename,
  selectElementLinks
} from "./extractPage.js";
import { clearExportStopRequest, getExportSettings, isExportStopRequested } from "./settings.js";
import { downloadBlob, downloadZipFiles } from "./zipExport.js";

const DEFAULT_LINKED_EXPORT_LIMIT = 50;
const SNAPSHOT_POLL_INTERVAL_MS = 500;
const SNAPSHOT_MAX_SETTLE_MS = 2500;
const SNAPSHOT_STABLE_POLLS = 2;
const TAB_LOAD_TIMEOUT_MS = 30000;
const TAB_OPERATION_RETRIES = 4;
const TAB_OPERATION_RETRY_DELAY_MS = 750;
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen.html";
const OFFSCREEN_CONVERT_MESSAGE = "markdown-tab-exporter:convert-snapshot";
const EXPORT_STOPPED_MESSAGE = "Export stopped by user.";

let offscreenCreationPromise;

export async function exportCurrentPage(options = {}) {
  const { onStatus = noop } = options;
  const exported = await readCurrentPageMarkdown(options);
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

export async function readCurrentPageMarkdown(options = {}) {
  const { onStatus = noop } = options;
  onStatus("Reading current page...");

  const tab = options.tab || (await queryTabs({ active: true, currentWindow: true }))[0];

  if (!tab) {
    throw new Error("No active tab was found.");
  }

  return exportTab(tab);
}

export async function exportAllTabs(options = {}) {
  const { onStatus = noop, windowId } = options;
  await clearExportStopRequest();
  const tabs = await queryTabs(windowId ? { windowId } : { currentWindow: true });
  const readableTabs = tabs.filter((tab) => isSupportedPageUrl(tab.url));
  const skippedTabs = tabs
    .filter((tab) => !isSupportedPageUrl(tab.url))
    .map((tab) => `${tab.title || tab.url || "Untitled tab"}: unsupported page type`);

  const files = [];
  const failures = [...skippedTabs];

  for (const [readableIndex, tab] of readableTabs.entries()) {
    await throwIfExportStopped();
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
    enforceLanguage = settings.linkedExportEnforceLanguage,
    onStatus = noop,
    parallelTabs = settings.linkedExportParallelTabs,
    scope = settings.linkedExportScope,
    urlPrefix = settings.linkedExportUrlPrefix,
    timeoutSeconds = settings.linkedExportTimeoutSeconds
  } = options;
  const timeoutMs = timeoutSeconds * 1000 || TAB_LOAD_TIMEOUT_MS;

  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab?.url);
  }

  await clearExportStopRequest();
  onStatus(
    `Collecting links (${formatScope(scope)}, max ${maxPages}, ${formatLanguageLock(enforceLanguage)}${urlPrefix ? `, prefix ${urlPrefix}` : ""})...`
  );

  const linkCollection = await executeInTab(tab.id, collectReadableLinks, [
    { enforceLanguage, maxPages, scope, urlPrefix }
  ]);
  return exportLinkCollectionFromTab(tab, linkCollection, {
    enforceLanguage,
    onStatus,
    parallelTabs,
    source: "Linked pages",
    timeoutMs
  });
}

export async function exportSelectedElementLinksFromTab(tab, options = {}) {
  const settings = await getExportSettings();
  const {
    enforceLanguage = settings.linkedExportEnforceLanguage,
    maxPages = settings.linkedExportMaxPages || DEFAULT_LINKED_EXPORT_LIMIT,
    onStatus = noop,
    parallelTabs = settings.linkedExportParallelTabs,
    scope = settings.linkedExportScope,
    timeoutSeconds = settings.linkedExportTimeoutSeconds,
    urlPrefix = settings.linkedExportUrlPrefix
  } = options;
  const timeoutMs = timeoutSeconds * 1000 || TAB_LOAD_TIMEOUT_MS;

  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab?.url);
  }

  await clearExportStopRequest();
  onStatus("Select an element on the page...");
  const linkCollection = await executeInTab(tab.id, selectElementLinks, [{ maxPages, scope, urlPrefix }]);

  return exportLinkCollectionFromTab(tab, linkCollection, {
    enforceLanguage,
    onStatus,
    parallelTabs,
    source: "Selected element links",
    timeoutMs
  });
}

async function exportLinkCollectionFromTab(tab, linkCollection, options) {
  const { enforceLanguage, onStatus, parallelTabs, source, timeoutMs } = options;
  const { duplicates, links } = dedupeLinks(linkCollection.links || []);
  const sourceLanguage = linkCollection.sourceLanguage?.primary
    ? linkCollection.sourceLanguage
    : detectPageLanguage(linkCollection.sourceUrl || tab.url);

  if (!links.length) {
    throw new Error("No readable links were found for export.");
  }

  const files = [];
  const failures = duplicates.map((duplicate) => `${duplicate.url}: skipped duplicate of ${duplicate.originalUrl}`);
  const inFlightUrls = new Set();
  const processedUrls = new Set();
  let nextLinkIndex = 0;
  let completedCount = 0;
  let stopRequested = false;

  const workerCount = Math.min(Math.max(parallelTabs || 1, 1), 5, links.length);
  const shouldStop = async () => {
    if (stopRequested) {
      return true;
    }

    stopRequested = await isExportStopRequested();
    return stopRequested;
  };

  await Promise.all(
    Array.from({ length: workerCount }, async (_value, workerIndex) => {
      while (nextLinkIndex < links.length && !(await shouldStop())) {
        const index = nextLinkIndex;
        nextLinkIndex += 1;

        await processLinkedPage({
          enforceLanguage,
          failures,
          files,
          inFlightUrls,
          index,
          link: links[index],
          onProgress: (currentLink) => {
            onStatus(`Reading linked page ${completedCount + 1} of ${links.length} (${workerCount} parallel)...`, [
              `Worker ${workerIndex + 1}: ${currentLink.url}`
            ]);
          },
          processedUrls,
          shouldStop,
          sourceLanguage,
          timeoutMs,
          windowId: tab.windowId
        });

        completedCount += 1;
      }
    })
  );

  if (stopRequested || (await isExportStopRequested())) {
    throw new Error(EXPORT_STOPPED_MESSAGE);
  }

  if (!files.length) {
    throw new Error(`No linked pages could be exported. ${summarizeFailures(failures)}`);
  }

  const exportedFiles = files.filter(Boolean);
  const summaryFile = createExportSummaryFile({
    exportedFiles,
    failures,
    links,
    sourceTitle: linkCollection.sourceTitle,
    sourceUrl: linkCollection.sourceUrl
  });

  return downloadMarkdownZip({
    baseFilename: makeZipFilename(source === "Selected element links" ? "selected-element-links" : "linked-pages"),
    files: [...exportedFiles, summaryFile],
    failures,
    onStatus,
    source
  });
}

function dedupeLinks(links) {
  const duplicates = [];
  const seen = new Map();
  const uniqueLinks = [];

  for (const link of links) {
    const canonicalUrl = canonicalizeUrl(link.url);
    const originalUrl = seen.get(canonicalUrl);

    if (originalUrl) {
      duplicates.push({
        originalUrl,
        url: link.url
      });
      continue;
    }

    seen.set(canonicalUrl, link.url);
    uniqueLinks.push({
      ...link,
      canonicalUrl
    });
  }

  return {
    duplicates,
    links: uniqueLinks
  };
}

function canonicalizeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const trackingPrefixes = ["utm_"];
    const trackingParams = new Set([
      "_ga",
      "_gl",
      "fbclid",
      "gclid",
      "gclsrc",
      "mc_cid",
      "mc_eid"
    ]);
    const keptParams = [];

    parsedUrl.hash = "";

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();

      if (trackingParams.has(normalizedKey) || trackingPrefixes.some((prefix) => normalizedKey.startsWith(prefix))) {
        continue;
      }

      keptParams.push([key, value]);
    }

    keptParams.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`)
    );

    parsedUrl.search = "";

    for (const [key, value] of keptParams) {
      parsedUrl.searchParams.append(key, value);
    }

    if (parsedUrl.pathname.length > 1) {
      parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/g, "");
    }

    return parsedUrl.href;
  } catch {
    return url;
  }
}

async function processLinkedPage({
  enforceLanguage,
  failures,
  files,
  inFlightUrls,
  index,
  link,
  onProgress,
  processedUrls,
  shouldStop,
  sourceLanguage,
  timeoutMs,
  windowId
}) {
  if (await shouldStop()) {
    return;
  }

  onProgress(link);
  const canonicalUrl = link.canonicalUrl || canonicalizeUrl(link.url);
  let finalCanonicalUrl = canonicalUrl;

  if (processedUrls.has(canonicalUrl)) {
    failures.push(`${link.url}: skipped duplicate already processed`);
    return;
  }

  if (inFlightUrls.has(canonicalUrl)) {
    failures.push(`${link.url}: skipped duplicate already being processed`);
    return;
  }

  inFlightUrls.add(canonicalUrl);

  try {
    const temporaryTab = await createInactiveTab(link.url, windowId);

    try {
      const loadedTab = await waitForTabLoad(temporaryTab.id, timeoutMs, shouldStop);
      const snapshot = await waitForStablePageSnapshot(temporaryTab.id, link.url, timeoutMs, shouldStop);
      if (await shouldStop()) {
        return;
      }
      finalCanonicalUrl = canonicalizeUrl(snapshot.url || loadedTab.url || link.url);

      if (finalCanonicalUrl !== canonicalUrl) {
        if (processedUrls.has(finalCanonicalUrl)) {
          failures.push(`${link.url}: skipped duplicate already processed as ${snapshot.url || loadedTab.url}`);
          return;
        }

        if (inFlightUrls.has(finalCanonicalUrl)) {
          failures.push(`${link.url}: skipped duplicate already being processed as ${snapshot.url || loadedTab.url}`);
          return;
        }

        inFlightUrls.add(finalCanonicalUrl);
      }

      files[index] = await exportTab(
        {
          ...loadedTab,
          title: snapshot.title || loadedTab.title,
          url: snapshot.url || loadedTab.url || link.url
        },
        index,
        {
          snapshot,
          sourceLanguage: enforceLanguage ? sourceLanguage : undefined
        }
      );
      processedUrls.add(canonicalUrl);
      processedUrls.add(finalCanonicalUrl);
    } finally {
      await removeTab(temporaryTab.id);
    }
  } catch (error) {
    failures.push(`${link.url}: ${toUserMessage(error)}`);
  } finally {
    inFlightUrls.delete(canonicalUrl);
    inFlightUrls.delete(finalCanonicalUrl);
  }
}

function formatScope(scope) {
  return scope === "same-hostname" ? "same hostname" : "same origin";
}

function formatLanguageLock(enforceLanguage) {
  return enforceLanguage ? "same language" : "any language";
}

export async function exportTab(tab, index, options = {}) {
  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new UnsupportedPageError(tab?.url);
  }

  const snapshot = options.snapshot || (await executeInTab(tab.id, collectPageSnapshot));
  const pageLanguage = detectPageLanguage(snapshot.url || tab.url, snapshot.lang);

  if (options.sourceLanguage && !isSameLanguagePage(options.sourceLanguage, pageLanguage)) {
    throw new Error(
      `Skipped different language page (${pageLanguage.primary || "unknown"}; expected ${options.sourceLanguage.primary}).`
    );
  }

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
  return retryTabOperation(
    () =>
      new Promise((resolve, reject) => {
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
      })
  );
}

async function retryTabOperation(operation, retries = TAB_OPERATION_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableTabError(error) || attempt === retries) {
        throw error;
      }

      await delay(TAB_OPERATION_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError;
}

function isRetryableTabError(error) {
  return /Tabs cannot be edited|dragging a tab|No tab with id/i.test(error?.message || "");
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
  return retryTabOperation(
    () =>
      new Promise((resolve, reject) => {
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
      })
  );
}

function getTab(tabId) {
  return retryTabOperation(
    () =>
      new Promise((resolve, reject) => {
        chrome.tabs.get(tabId, (tab) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          resolve(tab);
        });
      })
  );
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      resolve();
    });
  });
}

async function waitForTabLoad(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS, shouldStop = neverStop) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await shouldStop()) {
      throw new Error(EXPORT_STOPPED_MESSAGE);
    }

    const tab = await getTab(tabId);

    if (tab.status === "complete") {
      return tab;
    }

    await delay(SNAPSHOT_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out while loading the linked page.");
}

async function waitForStablePageSnapshot(tabId, expectedUrl, timeoutMs = TAB_LOAD_TIMEOUT_MS, shouldStop = neverStop) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot;
  let lastSignature = "";
  let stablePolls = 0;
  let firstUsableAt = 0;
  let bestSnapshot;
  let bestTextLength = 0;
  let lastError;

  while (Date.now() < deadline) {
    if (await shouldStop()) {
      throw new Error(EXPORT_STOPPED_MESSAGE);
    }

    try {
      const snapshot = await executeInTab(tabId, collectPageSnapshot);
      const signature = snapshotSignature(snapshot);

      if (isUsableSnapshot(snapshot, expectedUrl)) {
        const now = Date.now();
        const textLength = snapshot.text.trim().length;

        if (!firstUsableAt) {
          firstUsableAt = now;
        }

        if (textLength >= bestTextLength) {
          bestSnapshot = snapshot;
          bestTextLength = textLength;
        }

        if (signature === lastSignature) {
          stablePolls += 1;
        } else {
          stablePolls = 1;
          lastSignature = signature;
        }

        lastSnapshot = snapshot;

        if (stablePolls >= SNAPSHOT_STABLE_POLLS) {
          return snapshot;
        }

        if (now - firstUsableAt >= SNAPSHOT_MAX_SETTLE_MS) {
          return bestSnapshot || snapshot;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await delay(SNAPSHOT_POLL_INTERVAL_MS);
  }

  if (bestSnapshot || lastSnapshot) {
    return bestSnapshot || lastSnapshot;
  }

  throw lastError || new Error("Timed out while waiting for linked page content.");
}

function isUsableSnapshot(snapshot, expectedUrl) {
  if (!snapshot?.url || !snapshot.text?.trim()) {
    return false;
  }

  if (snapshot.readyState && snapshot.readyState !== "complete") {
    return false;
  }

  if (snapshot.url === "about:blank") {
    return false;
  }

  if (snapshot.text.trim().length < 200) {
    return false;
  }

  return isExpectedNavigation(snapshot.url, expectedUrl);
}

function isExpectedNavigation(actualUrl, expectedUrl) {
  try {
    const actual = new URL(actualUrl);
    const expected = new URL(expectedUrl);

    return actual.origin === expected.origin;
  } catch {
    return true;
  }
}

function snapshotSignature(snapshot) {
  return [snapshot.url, snapshot.title, snapshot.text.length, snapshot.text.slice(0, 500)].join("\n");
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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

async function throwIfExportStopped() {
  if (await isExportStopRequested()) {
    throw new Error(EXPORT_STOPPED_MESSAGE);
  }
}

async function neverStop() {
  return false;
}

function noop() {}
