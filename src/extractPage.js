import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const UNSUPPORTED_PROTOCOLS = new Set([
  "about:",
  "chrome:",
  "chrome-extension:",
  "edge:",
  "file:",
  "moz-extension:",
  "opera:",
  "view-source:"
]);

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

export class UnsupportedPageError extends Error {
  constructor(url) {
    super(`Cannot read this page type: ${url || "unknown URL"}`);
    this.name = "UnsupportedPageError";
  }
}

export function isSupportedPageUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return !UNSUPPORTED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function collectPageSnapshot() {
  const clone = document.documentElement.cloneNode(true);

  clone.querySelectorAll("script, noscript, style, svg, canvas, iframe").forEach((node) => {
    node.remove();
  });

  return {
    baseUrl: document.baseURI,
    html: `<!doctype html>${clone.outerHTML}`,
    lang: document.documentElement.lang || "",
    text: document.body?.innerText || "",
    title: document.title || "",
    url: location.href
  };
}

export function extractMarkdownFromSnapshot(snapshot) {
  if (!snapshot?.html) {
    throw new Error("The page did not return readable HTML.");
  }

  const documentForReadability = parseHtml(snapshot.html, snapshot.baseUrl || snapshot.url);
  const article = new Readability(documentForReadability, {
    charThreshold: 200,
    keepClasses: false
  }).parse();

  const title = cleanInlineText(article?.title || snapshot.title || "Untitled Page");
  const markdownBody = article?.content
    ? htmlToMarkdown(article.content)
    : fallbackTextToMarkdown(snapshot.text);

  if (!markdownBody.trim()) {
    throw new Error("No readable text was found on this page.");
  }

  return {
    markdown: formatMarkdown({
      byline: article?.byline,
      content: markdownBody,
      excerpt: article?.excerpt,
      lang: snapshot.lang,
      title,
      url: snapshot.url
    }),
    title
  };
}

export function makeMarkdownFilename(title, url, index) {
  const prefix = typeof index === "number" ? `${String(index + 1).padStart(3, "0")}-` : "";
  const safeTitle = sanitizeFilename(title || hostFromUrl(url) || "page");
  return `${prefix}${safeTitle}.md`;
}

export function makeZipFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `markdown-tabs-${timestamp}.zip`;
}

function parseHtml(html, baseUrl) {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");

  if (baseUrl && parsedDocument.head) {
    const base = parsedDocument.createElement("base");
    base.href = baseUrl;
    parsedDocument.head.prepend(base);
  }

  return parsedDocument;
}

function htmlToMarkdown(html) {
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    headingStyle: "atx"
  });

  turndown.addRule("expandedTable", {
    filter: "table",
    replacement: (_content, node) => {
      const markdownTable = tableToMarkdown(node);
      return markdownTable ? `\n\n${markdownTable}\n\n` : "";
    }
  });

  turndown.remove(["form", "input", "button", "select", "textarea"]);

  return normalizeMarkdown(turndown.turndown(html));
}

function tableToMarkdown(table) {
  const sourceRows = Array.from(table.rows || []);

  if (!sourceRows.length) {
    return "";
  }

  const matrix = expandTableCells(sourceRows);

  if (!matrix.length) {
    return "";
  }

  const columnCount = Math.max(...matrix.map((row) => row.length));
  const headerRowIndex = sourceRows.findIndex((row) =>
    Array.from(row.children).some((cell) => cell.tagName.toLowerCase() === "th")
  );
  const hasHeader = headerRowIndex >= 0;
  const header = hasHeader
    ? normalizeTableRow(matrix[headerRowIndex], columnCount)
    : Array.from({ length: columnCount }, (_value, index) => `Column ${index + 1}`);
  const bodyRows = matrix
    .filter((_row, index) => index !== headerRowIndex)
    .map((row) => normalizeTableRow(row, columnCount));

  return [
    markdownTableRow(header),
    markdownTableRow(Array.from({ length: columnCount }, () => "---")),
    ...bodyRows.map(markdownTableRow)
  ].join("\n");
}

function expandTableCells(sourceRows) {
  const matrix = [];
  const rowSpans = [];

  for (const sourceRow of sourceRows) {
    const row = [];
    let columnIndex = 0;
    const cells = Array.from(sourceRow.children).filter((cell) =>
      ["td", "th"].includes(cell.tagName.toLowerCase())
    );

    for (const cell of cells) {
      columnIndex = applyActiveRowSpans(row, rowSpans, columnIndex);

      const text = tableCellText(cell);
      const rowSpan = parseSpan(cell.getAttribute("rowspan"));
      const colSpan = parseSpan(cell.getAttribute("colspan"));

      for (let spanIndex = 0; spanIndex < colSpan; spanIndex += 1) {
        row[columnIndex] = text;

        if (rowSpan > 1) {
          rowSpans[columnIndex] = {
            rowsLeft: rowSpan - 1,
            text
          };
        }

        columnIndex += 1;
      }
    }

    applyRemainingRowSpans(row, rowSpans, columnIndex);

    if (row.some(Boolean)) {
      matrix.push(row);
    }
  }

  return matrix;
}

function applyActiveRowSpans(row, rowSpans, columnIndex) {
  let nextColumnIndex = columnIndex;

  while (rowSpans[nextColumnIndex]?.rowsLeft > 0) {
    row[nextColumnIndex] = rowSpans[nextColumnIndex].text;
    rowSpans[nextColumnIndex].rowsLeft -= 1;

    if (rowSpans[nextColumnIndex].rowsLeft === 0) {
      delete rowSpans[nextColumnIndex];
    }

    nextColumnIndex += 1;
  }

  return nextColumnIndex;
}

function applyRemainingRowSpans(row, rowSpans, columnIndex) {
  for (let index = columnIndex; index < rowSpans.length; index += 1) {
    if (rowSpans[index]?.rowsLeft > 0) {
      applyActiveRowSpans(row, rowSpans, index);
    }
  }
}

function normalizeTableRow(row, columnCount) {
  return Array.from({ length: columnCount }, (_value, index) => escapeMarkdownTableCell(row[index] || ""));
}

function markdownTableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

function tableCellText(cell) {
  return cleanInlineText(cell.textContent || "");
}

function parseSpan(value) {
  const parsed = Number.parseInt(value || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function escapeMarkdownTableCell(value) {
  return cleanInlineText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_");
}

function fallbackTextToMarkdown(text) {
  return normalizeMarkdown(
    (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n\n")
  );
}

function formatMarkdown({ byline, content, excerpt, lang, title, url }) {
  const metadata = [
    `Source: ${url || "Unknown"}`,
    `Exported: ${new Date().toISOString()}`,
    lang ? `Language: ${lang}` : "",
    byline ? `Byline: ${cleanInlineText(byline)}` : "",
    excerpt ? `Excerpt: ${cleanInlineText(excerpt)}` : ""
  ].filter(Boolean);

  return [`# ${title}`, "", ...metadata, "", "---", "", content.trim(), ""].join("\n");
}

function normalizeMarkdown(markdown) {
  return (markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanInlineText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function sanitizeFilename(value) {
  const cleaned = cleanInlineText(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  const fallback = cleaned || "page";
  return RESERVED_WINDOWS_NAMES.has(fallback.toLowerCase()) ? `${fallback}-page` : fallback;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
