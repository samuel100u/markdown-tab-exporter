import {
  exportAllTabs,
  exportCurrentPage,
  exportLinkedPagesFromTab,
  toUserMessage
} from "./exportService.js";

const MENU_IDS = {
  exportAllTabs: "markdown-tab-exporter:all-tabs",
  exportCurrentPage: "markdown-tab-exporter:current-page",
  exportLinkedPages: "markdown-tab-exporter:linked-pages",
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
  });
}

async function runContextMenuAction(menuItemId, tab) {
  try {
    setActionStatus("...", "Markdown export is running...");

    if (menuItemId === MENU_IDS.exportCurrentPage) {
      await exportCurrentPage({
        tab
      });
      setActionStatus("OK", "Markdown export finished.");
      return;
    }

    if (menuItemId === MENU_IDS.exportAllTabs) {
      await exportAllTabs({
        windowId: tab?.windowId
      });
      setActionStatus("OK", "Markdown export finished.");
      return;
    }

    if (menuItemId === MENU_IDS.exportLinkedPages) {
      await exportLinkedPagesFromTab(tab);
      setActionStatus("OK", "Markdown export finished.");
    }
  } catch (error) {
    const message = toUserMessage(error);
    setActionStatus("!", message);
    console.error("Markdown Tab Exporter failed:", message, error);
  }
}

function setActionStatus(text, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title });

  if (text === "OK") {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Export page to Markdown" });
    }, 5000);
  }
}
