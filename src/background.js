import {
  exportAllTabs,
  exportCurrentPage,
  exportLinkedPagesFromTab,
  exportSelectedElementLinksFromTab,
  toUserMessage
} from "./exportService.js";
import { clearLastBackgroundError, requestExportStop, saveLastBackgroundError } from "./settings.js";

const MENU_IDS = {
  exportAllTabs: "markdown-tab-exporter:all-tabs",
  exportCurrentPage: "markdown-tab-exporter:current-page",
  exportLinkedPages: "markdown-tab-exporter:linked-pages",
  exportSelectedElementLinks: "markdown-tab-exporter:selected-element-links",
  stopExport: "markdown-tab-exporter:stop-export",
  parent: "markdown-tab-exporter:parent"
};

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  runContextMenuAction(info.menuItemId, tab);
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.parent,
      title: "Markdown Tab Exporter"
    });

    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.exportCurrentPage,
      parentId: MENU_IDS.parent,
      title: "Export this page as Markdown"
    });

    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.exportAllTabs,
      parentId: MENU_IDS.parent,
      title: "Export all open tabs as ZIP"
    });

    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.exportLinkedPages,
      parentId: MENU_IDS.parent,
      title: "Export linked pages from this page"
    });

    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.exportSelectedElementLinks,
      parentId: MENU_IDS.parent,
      title: "Select element links and export"
    });

    chrome.contextMenus.create({
      contexts: ["page"],
      id: MENU_IDS.stopExport,
      parentId: MENU_IDS.parent,
      title: "Stop running export"
    });
  });
}

async function runContextMenuAction(menuItemId, tab) {
  try {
    if (menuItemId === MENU_IDS.stopExport) {
      await requestExportStop();
      setActionStatus("STOP", "Stop requested.");
      return;
    }

    await clearLastBackgroundError();
    setActionStatus("...", "Markdown export is running...");

    if (menuItemId === MENU_IDS.exportCurrentPage) {
      await exportCurrentPage({
        tab
      });
      await clearLastBackgroundError();
      setActionStatus("OK", "Markdown export finished.");
      return;
    }

    if (menuItemId === MENU_IDS.exportAllTabs) {
      await exportAllTabs({
        windowId: tab?.windowId
      });
      await clearLastBackgroundError();
      setActionStatus("OK", "Markdown export finished.");
      return;
    }

    if (menuItemId === MENU_IDS.exportLinkedPages) {
      await exportLinkedPagesFromTab(tab);
      await clearLastBackgroundError();
      setActionStatus("OK", "Markdown export finished.");
      return;
    }

    if (menuItemId === MENU_IDS.exportSelectedElementLinks) {
      await exportSelectedElementLinksFromTab(tab);
      await clearLastBackgroundError();
      setActionStatus("OK", "Markdown export finished.");
    }
  } catch (error) {
    const message = toUserMessage(error);
    await saveLastBackgroundError(error, message);
    setActionStatus("!", message);
  }
}

function setActionStatus(text, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title });

  if (text === "OK" || text === "STOP") {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Export page to Markdown" });
    }, 5000);
  }
}
