import { extractMarkdownFromSnapshot } from "./extractPage.js";
import { CREATE_ZIP_URL_MESSAGE, REVOKE_OBJECT_URL_MESSAGE, createMarkdownZip } from "./zipExport.js";

const OFFSCREEN_CONVERT_MESSAGE = "markdown-tab-exporter:convert-snapshot";
const objectUrls = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === OFFSCREEN_CONVERT_MESSAGE) {
    try {
      sendResponse({
        ok: true,
        result: extractMarkdownFromSnapshot(message.snapshot)
      });
    } catch (error) {
      sendResponse({
        error: error.message || String(error),
        ok: false
      });
    }

    return true;
  }

  if (message?.type === CREATE_ZIP_URL_MESSAGE) {
    createZipUrl(message.files)
      .then((url) => {
        sendResponse({
          ok: true,
          url
        });
      })
      .catch((error) => {
        sendResponse({
          error: error.message || String(error),
          ok: false
        });
      });

    return true;
  }

  if (message?.type === REVOKE_OBJECT_URL_MESSAGE) {
    if (objectUrls.has(message.url)) {
      URL.revokeObjectURL(message.url);
      objectUrls.delete(message.url);
    }

    sendResponse({
      ok: true
    });

    return true;
  }

  return false;
});

async function createZipUrl(files) {
  const zipBlob = await createMarkdownZip(files);
  const url = URL.createObjectURL(zipBlob);
  objectUrls.add(url);
  return url;
}
