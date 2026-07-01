# Inkwave Citation Capture — browser extension (Phase 2)

A minimal, build-free MV3 extension that captures citations from any page into the Inkwave
writing studio. Journal articles with a DOI and arXiv preprints capture instantly (CrossRef /
arXiv API, no AI); the captured CSL-JSON is queued and handed to an open Inkwave tab via the
postMessage bridge.

## Files
- `manifest.json` — MV3. `activeTab` + scoped `host_permissions` (Inkwave + the citation APIs).
- `lib.js` — dependency-free capture logic (mirrors `src/citations/{identifiers,cslMap,lookup}`).
- `background.js` — service worker: capture active tab → CrossRef → queue in `chrome.storage.local`
  (network in the worker, not a content script — content-script fetch is bound by page CORS).
- `content-inkwave.js` — injected into inkwave.me / localhost: drains the queue → `window.postMessage`
  to the page (the app validates origin + source, writes to its OPFS library, and acks → dequeue).
- `popup.html` / `popup.js` — the "Capture this page" UI.

## Load it (manual, needs a real Chrome)
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this `extension/` dir.
2. Open a journal article (or any page with a DOI), click the Inkwave toolbar icon → **Capture this page**.
3. Open your Inkwave tab — the citation appears in the library (the ‟ citations panel).

## What's verified
- **Capture logic** (`lib.js`): CrossRef + arXiv paths → correct CSL-JSON + citekey.
- **Bridge protocol**: the app-side receiver (`src/citations/extensionChannel.ts`) is browser-tested
  for the exact `{source:'inkwave-ext', type:'cite/upsert', uuid, items}` messages this sends —
  stored on match, spoofed source rejected, UUID-idempotent.
- The live MV3 `chrome.*` wiring (storage/tabs/runtime) is standard boilerplate; verify by loading
  unpacked as above (MV3 service workers don't boot in headless CI).

## Shipping (per the build spec)
This build-free version proves the mechanism. The cross-browser shipping version should migrate to
**WXT** (`wxt build -b chrome|firefox|safari`), import the shared TS pipeline modules instead of the
duplicated `lib.js`, add the arXiv/ISBN/LLM-scrape paths and hover-to-source, and follow the §14.1
Safari-readiness rules (browser.* polyfill, activeTab, centralised origin constant).
