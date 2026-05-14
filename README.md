# Markdown Tab Exporter

A private Chrome MV3 extension that exports readable page content as Markdown for AI analysis.

## Build

```sh
npm install
npm run build
```

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project's `dist` folder.

## Use

- `Export Current Page` downloads the active tab as one `.md` file.
- `Copy Current Page` copies the active tab as Markdown to the clipboard without downloading a file.
- `Export All Tabs as ZIP` exports every readable tab in the current window into one `.zip`.
- `Export Linked Pages` collects same-origin links from the current page, opens them in temporary background tabs, and saves readable pages into one `.zip`.
- You can also right-click a page and use `Markdown Tab Exporter` from the context menu.
- `Select element links and export` enters selection mode: hover an element to highlight it, click to export links inside it, or press `Esc` to cancel. Readable linked pages are saved into one `.zip`.
- `Stop Running Export` in the popup, or `Stop running export` in the right-click menu, asks any long-running export to stop and clean up its temporary tab.

The popup settings let you adjust linked page export behavior:

- `Max pages`: how many linked pages to export, from 1 to 1000.
- `Parallel tabs`: how many temporary linked pages to process at once, from 1 to 5.
- `Link scope`: `Same origin` keeps protocol, host, and port the same; `Same hostname` allows http/https differences on the same host.
- `URL must start with`: only export links whose URL starts with this prefix. Supports absolute URLs or paths such as `/run/docs/`.
- `Load timeout`: how long to wait for each temporary linked page tab.
- `Keep the same language`: detects the starting page language from `html lang` and common URL language markers, then skips linked pages that switch languages.

Chrome blocks extensions from reading browser pages such as `chrome://`, extension pages, the Chrome Web Store, and some protected viewers. Those tabs are skipped during ZIP export.
