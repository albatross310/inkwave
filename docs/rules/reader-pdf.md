<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Reader panels — PDF, source browser, citations, media

Why: `docs/archive/reader-panels.md`, `docs/archive/pdf-panel-rounds.md`. **Shared lesson, and it is a
rule: the fix you can argue for is not the fix — reproduce the symptom against a control in the SAME
build.** All three PDF rounds shipped a plausible mechanism that measurement later refuted.

- **Markup lives on `_iw.highlights`, never baked into the PDF bytes.** PDFs are OneDrive sidecars
  (`<base>.<citekey>.pdf`) + OPFS, embedded in local-folder saves. URL-linked PDFs and the
  `api/pdf.mjs?proxy=` relay were REMOVED; legacy `pdfUrl` is inert. CSP (middleware.ts):
  `frame-src blob:`, `wasm-unsafe-eval`.
- **Marks anchor by TEXT, not by rectangle** (`src/reader/marks.ts`); rect-only legacy marks stay
  rect-only, drawn at normalised rectangles.
- **A layout constant must never be scaled as though it were content** — the gutter
  (`PDF_OVERSCROLL_PX`) follows the RENDERED zoom, and the anchor is a fraction of the PAGE'S OWN BOX
  applied as a scroll DELTA, re-applied after React commits the gutter.
- **`zoom === 1` NEVER means "the reader has not chosen a zoom"** — it is a multiplier on the fit
  baseline, persisted per document; a trackpad pinch can land back on exactly 1. No early return.
- **One fit rule, one accessor: `computeTextFit`.**
- **A helper that cannot see its subject must return null, never an empty list.**
- **⚠ THE WALL IS OUR OWN CSP, NOT CORS.** `middleware.ts` sets `connect-src 'self' <named hosts>`, so
  a cross-origin fetch is refused BY US before CORS is consulted; that header stands because this
  origin holds the thesis and the signing session. `pdfRouteFor` decides `extension | direct | none`
  BEFORE the card is drawn, and with no extension a publisher's PDF draws **no save button at all**,
  states the wall, and offers the extension.
- **`_iw.pdfName` IS the claim that bytes exist** (`hasPdf` is `!!pdfName`), so the write order is the
  design: entry WITHOUT pdfName (to learn the key `freeCitekey` assigned) → bytes under that key →
  only then pdfName.
- **A content-type header is not the authority; the `%PDF-` magic is.**
- **`reader/file` is a SECOND extension message, not a flag on `reader/fetch`** — that exchange is
  defined to return text and must stay incapable of returning bytes. Bytes cross as base64
  (`runtime.sendMessage` is JSON, not structured clone); decode with `base64ToBlob`, never a
  hand-rolled atob loop.
- **A saved PDF's entry keeps author and year EMPTY** — a file tells us its address, not who wrote it.
- **The extension install card links to a VERSION-PINNED release asset**
  (`reader/extensionDownload.ts`, one constant); a gate test asserts the pin matches
  `extension-src/package.json`.
- **A framed page's `sandbox` needs `allow-downloads`.**
- **Media import: ONE importer, `importMedia`** (`src/media/`, live). REUSE `writeOpfsFile` +
  `blobToBase64`/`base64ToBlob` from `citations/pdfStore`, never copies. Bytes to OPFS
  `library/media/<id>.<ext>`; the document carries only `media?: MediaAsset[]` — never inline bytes in
  a `.studio`. It REFUSES rather than guesses: an unknown MIME is never stored as a photo, an
  oversized file is NAMED not truncated, a failed write yields NO asset.
- **⚠ A PHOTO LIVES IN A DOCUMENT; IT DOES NOT BECOME ONE** — import makes an ASSET; "turn this photo
  into a piece" READS one to produce a `docType:'music'` document. No parallel container.
- **⚠ TWO OPEN RULINGS, Peter's, not to be guessed:** (1) media is NOT anchored (PDF precedent, bytes
  unanchored) — defensible while media is a reference the prose does not depend on, NOT once a photo
  is part of the argument; (2) there is no `Image` node in the schema, so a photo cannot yet sit IN
  the prose — adding one touches `pmToText` → `contentHash` → Bitcoin.
- Citations (`citations/`): `bibProvider` (reactive store), real CSL formatting, `CitationNodeView`
  (reactive via `editor.on('update')` + `queueMicrotask`), `ReferenceListNodeView`, Haiku page-offset
  detection (`citations/pageOffset.ts`).
- Probe traps that accused WORKING features: `fetch('data:…')` is refused by our own CSP (use `atob`);
  `getSelection().toString()` is EMPTY after mouseup (`createFromSelection` clears it on SUCCESS);
  **Escape closes the panel rather than disarming the tool**; a click at (5,5) lands on the editor;
  an armed highlight tool MARKS a selection instead of raising the popover.
- HONEST GAPS: PDF probes are Chromium-only (WebKit has no `navigator.storage` there, so the iOS
  worker write path is untouched); the fixture is a born-digital text-layer PDF, so SCANNED pages take
  an unprobed branch; multi-column, RTL and footnote-heavy typesetting are unrepresented.

