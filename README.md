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
- `Export All Tabs as ZIP` exports every readable tab in the current window into one `.zip`.
- `Export Linked Pages as ZIP` collects same-origin links from the current page, opens them in temporary background tabs, and exports up to 50 readable pages into one `.zip`.
- You can also right-click a page and use `Markdown Tab Exporter` from the context menu.

The popup settings let you adjust linked page export behavior:

- `Max pages`: how many linked pages to export, from 1 to 200.
- `Link scope`: `Same origin` keeps protocol, host, and port the same; `Same hostname` allows http/https differences on the same host.
- `Load timeout`: how long to wait for each temporary linked page tab.

Chrome blocks extensions from reading browser pages such as `chrome://`, extension pages, the Chrome Web Store, and some protected viewers. Those tabs are skipped during ZIP export.
