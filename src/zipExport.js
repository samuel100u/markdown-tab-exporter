import JSZip from "jszip";

export const CREATE_ZIP_URL_MESSAGE = "markdown-tab-exporter:create-zip-url";
export const REVOKE_OBJECT_URL_MESSAGE = "markdown-tab-exporter:revoke-object-url";

export async function createMarkdownZip(files) {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.name, file.content);
  }

  return zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: {
      level: 6
    },
    type: "blob"
  });
}

export async function downloadZipFiles(files, filename) {
  const downloadUrl = await createZipDownloadUrl(files);

  try {
    return await downloadUrlWithChrome(downloadUrl.url, filename);
  } finally {
    downloadUrl.revoke();
  }
}

export function downloadBlob(blob, filename) {
  return getDownloadUrl(blob).then((url) => {
    const shouldRevoke = url.startsWith("blob:");

    return downloadUrlWithChrome(url, filename).finally(() => {
      if (shouldRevoke) {
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    });
  });
}

async function createZipDownloadUrl(files) {
  if (typeof URL.createObjectURL === "function") {
    const blob = await createMarkdownZip(files);
    const url = URL.createObjectURL(blob);

    return {
      revoke: () => globalThis.setTimeout(() => URL.revokeObjectURL(url), 30000),
      url
    };
  }

  const response = await chrome.runtime.sendMessage({
    files,
    type: CREATE_ZIP_URL_MESSAGE
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to create ZIP download URL.");
  }

  return {
    revoke: () => {
      globalThis.setTimeout(() => {
        chrome.runtime.sendMessage({
          type: REVOKE_OBJECT_URL_MESSAGE,
          url: response.url
        });
      }, 30000);
    },
    url: response.url
  };
}

function downloadUrlWithChrome(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        conflictAction: "uniquify",
        filename,
        saveAs: true,
        url
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(downloadId);
      }
    );
  });
}

async function getDownloadUrl(blob) {
  if (typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(blob);
  }

  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
