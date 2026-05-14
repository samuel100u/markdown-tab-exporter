import JSZip from "jszip";

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

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

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
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(downloadId);
      }
    );
  });
}
