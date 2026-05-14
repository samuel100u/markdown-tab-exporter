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

Chrome blocks extensions from reading browser pages such as `chrome://`, extension pages, the Chrome Web Store, and some protected viewers. Those tabs are skipped during ZIP export.
