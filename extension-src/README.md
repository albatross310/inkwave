# Inkwave — cross-browser extension (WXT build)

Multi-browser extension built with [WXT](https://wxt.dev). Imports the shared TypeScript pipeline from `../src/citations/` so logic is never duplicated. Targets Chrome MV3 and Firefox (MV2 via WXT's compatibility layer).

## Development

```sh
pnpm install
pnpm dev          # Chrome (loads .output/chrome-mv3 as unpacked extension)
pnpm dev:firefox  # Firefox
```

## Build & package for stores

```sh
pnpm zip          # → .output/inkwave-extension-<version>-chrome.zip  (Chrome Web Store)
pnpm zip:firefox  # → .output/inkwave-extension-<version>-firefox.zip + sources.zip (AMO)
```

## Store submission

**Chrome Web Store:**
1. `pnpm zip` → `inkwave-extension-<version>-chrome.zip`
2. [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) → New item → upload zip.
3. Fill in store listing: name, description, privacy policy, category (Productivity).
4. Submit for review (usually 1–3 business days for a new extension).

**Firefox AMO:**
1. `pnpm zip:firefox` → `inkwave-extension-0.1.0-firefox.zip` + `sources.zip`
2. [AMO Developer Hub](https://addons.mozilla.org/developers/) → Submit a New Add-on → upload firefox.zip.
3. Upload `sources.zip` as the source code submission (AMO rebuilds and diffs — required for reviewed add-ons).
4. Fill store listing. AMO review is longer (1–6 weeks for new extensions).

## Firefox compatibility notes

WXT builds the Firefox target as MV2 (the mature, stable manifest version for Firefox). The extension logic is identical; WXT's built-in `browser.*` polyfill ensures the same API surface on both browsers. The gecko extension ID is `inkwave@inkwave.studio` (changed 2026-08-30 while the add-on was still unpublished — the id is permanent once AMO has it).

## Adding the LLM-scrape path

The identifier-only path (DOI/arXiv/ISBN/PMID) is live. The AI-extraction branch for blogs/websites (`api/summarise.mjs` → `{ extract: { url, html } }`) is server-side and ready — the extension just needs to call it when `detectIdentifier` returns null. Enable it when ready to test with a live `ANTHROPIC_API_KEY`.
