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
const KNOWN_LANGUAGE_CODES = new Set([
  "ar",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh"
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
    readyState: document.readyState,
    text: document.body?.innerText || "",
    title: document.title || "",
    url: location.href
  };
}

export function collectReadableLinks(options = {}) {
  const knownLanguageCodes = new Set([
    "ar",
    "bg",
    "bn",
    "ca",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "et",
    "fi",
    "fr",
    "he",
    "hi",
    "hr",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "lt",
    "lv",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "sr",
    "sv",
    "th",
    "tr",
    "uk",
    "vi",
    "zh"
  ]);
  const enforceLanguage = options.enforceLanguage !== false;
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 50;
  const scope = options.scope === "same-hostname" ? "same-hostname" : "same-origin";
  const baseUrl = location.href;
  const urlPrefix = normalizeUrlPrefix(options.urlPrefix, baseUrl);
  const sourceSectionPrefix = getSectionPrefix(new URL(baseUrl).pathname);
  const sourceLanguage = detectLocalPageLanguage(baseUrl, document.documentElement.lang);
  const origin = location.origin;
  const hostname = location.hostname;
  const ignoredExtensions = new Set([
    ".7z",
    ".avi",
    ".css",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".svg",
    ".tar",
    ".webp",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip"
  ]);
  const ignoredPathParts = [
    "/account",
    "/auth",
    "/login",
    "/logout",
    "/signin",
    "/signup",
    "/share",
    "/subscribe"
  ];
  const candidates = [];
  const seen = new Set();

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const rawHref = anchor.getAttribute("href") || "";

    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      continue;
    }

    let url;

    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(url.protocol) || !isWithinScope(url)) {
      continue;
    }

    url.hash = "";

    if (urlPrefix && !url.href.startsWith(urlPrefix)) {
      continue;
    }

    if (enforceLanguage && !isSameLanguageUrl(sourceLanguage, url)) {
      continue;
    }

    const normalizedUrl = url.href;
    const lowerPath = url.pathname.toLowerCase();
    const extension = lowerPath.match(/\.[a-z0-9]+$/)?.[0] || "";

    if (
      normalizedUrl === baseUrl.split("#")[0] ||
      ignoredExtensions.has(extension) ||
      ignoredPathParts.some((part) => lowerPath.includes(part)) ||
      seen.has(normalizedUrl)
    ) {
      continue;
    }

    seen.add(normalizedUrl);
    candidates.push({
      sectionRank: getSectionRank(url),
      text: normalizeLinkText(anchor.textContent),
      url: normalizedUrl
    });
  }

  const links = candidates
    .sort((left, right) => left.sectionRank - right.sectionRank)
    .slice(0, maxPages)
    .map(({ text, url }) => ({ text, url }));

  return {
    sourceLanguage,
    sourceTitle: document.title || "",
    sourceUrl: baseUrl,
    links
  };

  function normalizeLinkText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isWithinScope(url) {
    if (scope === "same-hostname") {
      return url.hostname === hostname;
    }

    return url.origin === origin;
  }

  function getSectionRank(url) {
    if (urlPrefix && url.href.startsWith(urlPrefix)) {
      return 0;
    }

    if (sourceSectionPrefix && url.pathname.startsWith(sourceSectionPrefix)) {
      return 0;
    }

    if (url.pathname.startsWith("/docs/")) {
      return 2;
    }

    return 1;
  }

  function getSectionPrefix(pathname) {
    const segments = pathname.split("/").filter(Boolean);
    const docsIndex = segments.indexOf("docs");

    if (docsIndex > 0) {
      return `/${segments.slice(0, docsIndex + 1).join("/")}/`;
    }

    if (docsIndex === 0) {
      return "/docs/";
    }

    return segments.length ? `/${segments[0]}/` : "";
  }

  function normalizeUrlPrefix(value, baseUrl) {
    const trimmedValue = (value || "").trim();

    if (!trimmedValue) {
      return "";
    }

    try {
      return new URL(trimmedValue, baseUrl).href;
    } catch {
      return trimmedValue;
    }
  }

  function detectLocalPageLanguage(url, htmlLang = "") {
    const normalizedHtmlLang = normalizeLocalLanguageCode(htmlLang);
    const urlLanguage = detectLocalUrlLanguage(url);

    return {
      htmlLang: normalizedHtmlLang,
      primary: normalizedHtmlLang || urlLanguage || "",
      urlLanguage
    };
  }

  function isSameLanguageUrl(sourceLanguage, url) {
    if (!sourceLanguage?.urlLanguage) {
      return true;
    }

    const targetUrlLanguage = detectLocalUrlLanguage(url.href);

    if (!targetUrlLanguage) {
      return true;
    }

    return languageFamiliesMatch(sourceLanguage.urlLanguage, targetUrlLanguage);
  }

  function detectLocalUrlLanguage(url) {
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return "";
    }

    for (const param of ["hl", "lang", "language", "locale"]) {
      const value = normalizeLocalLanguageCode(parsedUrl.searchParams.get(param));

      if (isLocalLanguageCode(value)) {
        return value;
      }
    }

    for (const segment of parsedUrl.pathname.split("/").filter(Boolean)) {
      const normalizedSegment = normalizeLocalLanguageCode(segment);

      if (isLocalLanguageCode(normalizedSegment)) {
        return normalizedSegment;
      }
    }

    return "";
  }

  function normalizeLocalLanguageCode(value) {
    return (value || "").toLowerCase().replace("_", "-").trim();
  }

  function isLocalLanguageCode(value) {
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(value || "")) {
      return false;
    }

    return knownLanguageCodes.has(value.split("-")[0]);
  }

  function languageFamiliesMatch(sourceLanguage, targetLanguage) {
    const sourcePrimary = normalizeLocalLanguageCode(sourceLanguage).split("-")[0];
    const targetPrimary = normalizeLocalLanguageCode(targetLanguage).split("-")[0];

    return Boolean(sourcePrimary && targetPrimary && sourcePrimary === targetPrimary);
  }
}

export function selectElementLinks(options = {}) {
  return new Promise((resolve, reject) => {
    const highlight = document.createElement("div");
    const label = document.createElement("div");
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 50;
    const scope = options.scope === "same-hostname" ? "same-hostname" : "same-origin";
    const baseUrl = location.href;
    const origin = location.origin;
    const hostname = location.hostname;
    const urlPrefix = normalizeUrlPrefix(options.urlPrefix, baseUrl);
    let selectedElement = document.body;

    highlight.style.cssText = [
      "position: fixed",
      "z-index: 2147483646",
      "pointer-events: none",
      "border: 3px solid #38bdf8",
      "background: rgba(56, 189, 248, 0.12)",
      "box-shadow: 0 0 0 99999px rgba(15, 23, 42, 0.18)",
      "transition: all 80ms ease"
    ].join(";");

    label.style.cssText = [
      "position: fixed",
      "z-index: 2147483647",
      "pointer-events: none",
      "max-width: 420px",
      "padding: 8px 10px",
      "border-radius: 10px",
      "background: #0f172a",
      "color: #e0f2fe",
      "font: 12px/1.4 system-ui, sans-serif",
      "box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35)"
    ].join(";");

    document.documentElement.append(highlight, label);
    updateHighlight(selectedElement);

    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);

    function onMouseMove(event) {
      selectedElement = findLinkContainer(event.target);
      updateHighlight(selectedElement);
    }

    function onClick(event) {
      event.preventDefault();
      event.stopPropagation();

      const links = collectLinksFromElement(selectedElement);
      cleanup();

      if (!links.length) {
        reject(new Error("No links were found inside the selected element."));
        return;
      }

      resolve({
        links,
        sourceLanguage: {
          htmlLang: "",
          primary: "",
          urlLanguage: ""
        },
        sourceTitle: document.title || "",
        sourceUrl: baseUrl
      });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup();
        reject(new Error("Element link selection was canceled."));
      }
    }

    function cleanup() {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      highlight.remove();
      label.remove();
    }

    function findLinkContainer(target) {
      let element = target instanceof Element ? target : document.body;

      while (element && element !== document.documentElement) {
        if (element.querySelectorAll?.("a[href]").length) {
          return element;
        }

        element = element.parentElement;
      }

      return document.body;
    }

    function updateHighlight(element) {
      const rect = element.getBoundingClientRect();
      const linkCount = collectLinksFromElement(element).length;

      highlight.style.left = `${Math.max(rect.left, 0)}px`;
      highlight.style.top = `${Math.max(rect.top, 0)}px`;
      highlight.style.width = `${Math.max(rect.width, 0)}px`;
      highlight.style.height = `${Math.max(rect.height, 0)}px`;

      label.style.left = `${Math.min(Math.max(rect.left, 8), window.innerWidth - 430)}px`;
      label.style.top = `${Math.min(Math.max(rect.top - 44, 8), window.innerHeight - 56)}px`;
      label.textContent = `Click to export ${linkCount} link${linkCount === 1 ? "" : "s"} inside this element. Esc to cancel.`;
    }

    function collectLinksFromElement(element) {
      const links = [];
      const seen = new Set();

      for (const anchor of Array.from(element.querySelectorAll("a[href]"))) {
        const rawHref = anchor.getAttribute("href") || "";

        if (
          rawHref.startsWith("#") ||
          rawHref.startsWith("javascript:") ||
          rawHref.startsWith("mailto:") ||
          rawHref.startsWith("tel:")
        ) {
          continue;
        }

        let url;

        try {
          url = new URL(rawHref, baseUrl);
        } catch {
          continue;
        }

        url.hash = "";

        if (!["http:", "https:"].includes(url.protocol) || !isWithinScope(url)) {
          continue;
        }

        if (urlPrefix && !url.href.startsWith(urlPrefix)) {
          continue;
        }

        if (url.href === baseUrl.split("#")[0] || seen.has(url.href)) {
          continue;
        }

        seen.add(url.href);
        links.push({
          text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
          url: url.href
        });

        if (links.length >= maxPages) {
          break;
        }
      }

      return links;
    }

    function isWithinScope(url) {
      if (scope === "same-hostname") {
        return url.hostname === hostname;
      }

      return url.origin === origin;
    }

    function normalizeUrlPrefix(value, baseUrl) {
      const trimmedValue = (value || "").trim();

      if (!trimmedValue) {
        return "";
      }

      try {
        return new URL(trimmedValue, baseUrl).href;
      } catch {
        return trimmedValue;
      }
    }
  });
}

export function detectPageLanguage(url, htmlLang = "") {
  const normalizedHtmlLang = normalizeLanguageCode(htmlLang);
  const urlLanguage = detectUrlLanguage(url);

  return {
    htmlLang: normalizedHtmlLang,
    primary: normalizedHtmlLang || urlLanguage || "",
    urlLanguage
  };
}

export function isSameLanguagePage(sourceLanguage, pageLanguage) {
  if (!sourceLanguage?.primary || !pageLanguage?.primary) {
    return true;
  }

  return languageFamiliesMatch(sourceLanguage.primary, pageLanguage.primary);
}

function isSameLanguageUrl(sourceLanguage, url) {
  if (!sourceLanguage?.urlLanguage) {
    return true;
  }

  const targetUrlLanguage = detectUrlLanguage(url.href);

  if (!targetUrlLanguage) {
    return true;
  }

  return languageFamiliesMatch(sourceLanguage.urlLanguage, targetUrlLanguage);
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

export function makeZipFilename(prefix = "markdown-tabs") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.zip`;
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

function normalizeLanguageCode(value) {
  return (value || "").toLowerCase().replace("_", "-").trim();
}

function detectUrlLanguage(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return "";
  }

  for (const param of ["hl", "lang", "language", "locale"]) {
    const value = normalizeLanguageCode(parsedUrl.searchParams.get(param));

    if (isLanguageCode(value)) {
      return value;
    }
  }

  for (const segment of parsedUrl.pathname.split("/").filter(Boolean)) {
    const normalizedSegment = normalizeLanguageCode(segment);

    if (isLanguageCode(normalizedSegment)) {
      return normalizedSegment;
    }
  }

  return "";
}

function isLanguageCode(value) {
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(value || "")) {
    return false;
  }

  return KNOWN_LANGUAGE_CODES.has(value.split("-")[0]);
}

function languageFamiliesMatch(sourceLanguage, targetLanguage) {
  const sourcePrimary = normalizeLanguageCode(sourceLanguage).split("-")[0];
  const targetPrimary = normalizeLanguageCode(targetLanguage).split("-")[0];

  return Boolean(sourcePrimary && targetPrimary && sourcePrimary === targetPrimary);
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
