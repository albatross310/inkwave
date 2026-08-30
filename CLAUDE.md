# Inkwave Scroll — CLAUDE.md

Project context for Claude Code sessions. Read this first.

## What this is

**Inkwave Scroll v0.1** — the free tier of Inkwave, a calm writing environment for
short academic/philosophical writing. Solo developer: Peter (Brisbane). Target users:
STEM & philosophy honours students writing short documents.

The defining mechanic is **SCAS** (Stochastically Constrained And Suggested) — words
outside a per-paragraph "active vocabulary" glow red, and the writer can cycle through
thesaurus synonyms to replace them. The friction becomes an interpretable authorship
trace (provenance) without surveillance.

This is the **free Scroll tier only**. The paid **Tablet** tier (Clay/Stone commitment
states, weathering, hollow clocks, sentence-level glyphs, etc.) is Phase 2+ and **must
not be built here**. See the canonical docs for the full deferred list.

## Canonical documentation (lives OUTSIDE the repo)

On the Windows host, accessible from WSL at:
`/mnt/c/Users/peter/OneDrive/Documents/Claude/Projects/Inkflow Studio/`

Read in this order:
1. **`inkwave-scroll-v01-build-spec.md`** — start here. The focused build spec for v0.1.
   Tech stack, document model, SCAS scope, the 4-week build plan, explicit out-of-scope list.
2. `inkwave-architecture-decisions-v5.md` — full ~60-page architecture. Reference only.
3. `claude-session-memory.md` — session-by-session decision history; *why* choices were made.

Do **not** build against the older v3/v4 architecture docs (audit trail only).

## Tech stack

Vite + React 18 + TypeScript + Tailwind 3 + Tiptap (on ProseMirror) + OPFS/IndexedDB.
**React Router v7 in framework mode** (`@react-router/dev` Vite plugin) for routing +
build-time prerendering. `uuid` for IDs. Hosting: Vercel. Domain: `inkwave.studio`.

```
pnpm dev        # react-router dev (http://localhost:5173)
pnpm build      # react-router build — outputs static client + prerendered HTML to build/client/
pnpm typecheck  # react-router typegen && tsc -b
pnpm preview    # vite preview --outDir build/client
pnpm test       # vitest — ~37 files / 426 tests; ALL must pass before any push
pnpm test:e2e   # playwright (none written yet)
```

**Routing / SSR model.** `react-router.config.ts` sets `ssr: false` (SPA mode, no runtime
server) + `prerender(['/', '/about'])` — `/` and `/about` are rendered to static HTML at
build for SEO + instant first paint. The editor IS the landing page (`/`): the route
prerenders the empty-editor SHELL (`<Scroll>` chrome + `<EmptyEditorSurface>` facsimile,
same CSS classes as the live editor — see `src/editor/Scroll.tsx`), then the real Tiptap
editor mounts client-side in its place (ProseMirror can't SSR). The prerendered page is a
direct CSS function of the shared components, so style changes propagate automatically.
Flip `ssr: true` later when the Phase-2 "rooms" model needs per-request rendering.

Package manager is **pnpm** (`packageManager: pnpm@10.33.2`), not npm.

## Build progress (vs. build-spec 4-week plan)

- **Week 1 — Foundation: DONE.** `/edit` route, Tiptap editor, OPFS autosave (200ms
  debounce), restore-on-refresh, IndexedDB metadata index, hand-rolled PWA
  (`public/manifest.webmanifest` + `public/sw.js`).
- **Week 2 — SCAS variant: DONE (and gone beyond spec).** Per-paragraph stochastic
  re-ranking, red highlighting, Datamuse thesaurus, limit selector, compliance tracking,
  the inline word-cycle UI (Stages A & B done; C & D in progress).
- **Provenance spine M0 — SCAS engine swap: DONE.** Building the v4 spec
  (`inkwave-scroll-v01-provenance-spine-build-spec-v4.md`), which supersedes the old
  Week-3 plan. The Week-2 per-paragraph `ranking.ts` model is replaced by `scas/engine.ts`
  + `scas/state.ts` + `scas/controller.ts`: a rotating seed-derived exclusion set `S_v`
  (local seed in M0; server-held from M3) and the ban-credit/satisfied/immunity state
  machine. `RedHighlightExtension` now *renders* engine state (locked ∪ liveKicks) instead
  of recomputing vocab. Delete a kicked word → it locks (forced kick on retype, suppressed
  from popovers); swap → resolves; verdicts freeze at commit so `S_v` rotation never
  reflows committed text. Unit-tested (`scas/engine.test.ts`) + browser-verified.
- **Provenance spine M1 — snapshots + local hashing: DONE.** `provenance/hash.ts`
  (RFC 8785 JCS + SHA-256 + bundleHash), `provenance/kicks.ts` (KickEvent emitter),
  `provenance/snapshots.ts` (OPFS append-only store; snapshot on a resolved kick when
  the contentHash changed — typing/pastes never snapshot), `components/ReceiptPanel.tsx`.
  Offline, no network; `ots:unstamped` until M2. Unit-tested (`hash.test.ts`) +
  browser-verified (accrues on resolution, persists across reload).
- **Provenance spine M2 — OpenTimestamps → Bitcoin: DONE.** Each snapshot's bundleHash
  is stamped to Bitcoin via OpenTimestamps: unstamped → pending (seconds) → confirmed
  (hours, upgradeable by anyone). `javascript-opentimestamps` is a Node lib that fights the
  SPA's SSR/prerender bundling (global Buffer, stream-browserify in SSR), so OTS runs in a
  **stateless relay** — `api/ots.mjs` (Vercel) + `api/_ots-core.mjs`, mirrored in dev by a
  vite `configureServer` middleware (see vite.config.ts). This is the spec's sanctioned
  `api/stamp` fallback: it logs nothing and only handles a hash, so verification stays
  independently Bitcoin-anchored. Client wrapper `provenance/ots.ts` POSTs to `/api/ots`;
  the ReceiptPanel shows status + a "check Bitcoin" upgrade. `vercel.json` excludes `/api`
  from the SPA rewrite. Browser-verified to pending.
- **Provenance spine M3 — live-composition signing service: DONE.** A stateless,
  content-free signing service issues a rotating server-held exclusion set S_v and signs
  hash-chained receipts. Server (Node; Vercel functions + dev middleware):
  `api/_provenance-core.mjs` (Ed25519 @noble, seed derivation H(masterSecret,docId,v),
  S_v INDEX sampling → bitmask, signPeriod), `api/session.mjs`, `api/sign.mjs`. Client:
  `provenance/receipts.ts` (verifyReceipt/verifyChain), `provenance/session.ts`
  (SessionRunner). The editor opens a session on doc load, drives the SCAS controller off
  the server's S_v (`controller.useServerSet`), and on the period timer signs the period's
  receipt (content + resolved kicks, hashes only) + rotates the set; receipts persist
  (`scasReceipts`) and fold into snapshot bundles so OTS anchors them. Offline → falls back
  to local S_v (degrades visibly). ReceiptPanel shows the chain + a verify action.
  Real keys come from env (INKWAVE_SIGNING_SK / INKWAVE_MASTER_SECRET / VITE_SIGNING_PK);
  published key at `/.well-known/inkwave-signing-key.json` + committed. 49 tests; live
  loop browser-verified (session → receipts chain → verify ✓).
- **Provenance spine M4 — writer-held storage + export bundle: DONE.**
  `provenance/bundle.ts` builds the self-verifying export bundle (content + snapshots
  with OTS proofs + receipt chain + key ref); the ReceiptPanel "⤓ export bundle" downloads
  it. `storage/folder.ts` (File System Access, Chromium-only) — grant a folder once
  (`showDirectoryPicker`), persist the handle in IndexedDB, re-permission on return, and
  mirror doc + snapshots + bundle into it on every provenance checkpoint ("🗀 save to
  folder"). Non-Chromium falls back to OPFS + the export download. FSA grant needs a real
  user gesture (not headless-testable) — verify manually in Chrome.
- **Provenance spine M5 — open verifier + /verify: DONE.** `src/verify/index.ts` (pure,
  framework-free): verifyBundle = content integrity (recompute contentHash + bundleHash)
  + signed-chain (per-session prevHash + Ed25519, reuses receipts.ts) + kick consistency
  (each in-S kick's lemma is in that period's SIGNED set) + friction score + OTS existence
  tally. Verifies against the INDEPENDENTLY published key (not the bundle's claimed key).
  `routes/Verify.tsx` + `/verify` (prerendered): drop in a bundle → full report, entirely
  client-side, no login. 55 tests (6 verifier interop tests via the real server core);
  round-trip browser-verified (export → /verify ✓; tampered → ✗). HONEST GAP: full "no
  silent dodging" replay needs per-period content diffs (bundle carries period content
  *hashes* only) — kick-consistency + friction are the current conformance signals; deeper
  per-word replay is a planned extension. Next: M6 (paid cadence tier + billing).
- **Week 4 — Glyphs, dashboard, certification: NOT STARTED.** No `glyphList.ts`,
  `ParagraphGlyphExtension`, `GlyphDashboard`, or certification PDF/QR. Per the v4 spec's
  out-of-scope list these are later/Phase-2; the spine (M2–M6) comes first.

## Major systems added since the spine (2026-06 → 2026-07)

- **Cloud sync + writer-held files.** `storage/onedrive.ts` (Graph API), `storage/gdrive.ts`,
  `storage/folder.ts` (File System Access). All three write the self-contained `.studio` bundle, and
  all three are governed by the data-loss rules immediately below — read those before touching any
  write path.
- **⚠ THE DATA-LOSS FAMILY — SIX INCIDENTS ON PETER'S REAL THESIS, ONE SHAPE. These rules are the
  most load-bearing text in this file. The forensics are in `docs/archive/data-loss-incidents.md`;
  read them before deciding a new code path is not an instance.**
  **THE SHAPE: an unknown answered as if it were a known-empty.** Every rule below is that sentence
  applied to one read.
  - **A failed READ is not an empty archive.** `readSnapshotsFromDisk` returns `[]` ONLY on
    `NotFoundError`; every other fault — including an unreadable payload — THROWS. Both catch arms
    are load-bearing and mutation-proved: with only the open arm, collapsing the parse arm to
    `return []` left the probe fully green.
  - **A failed READ is not an absent document.** `opfs.ts readJson` returns null ONLY on
    `NotFoundError` and throws `StorageReadError` otherwise (a corrupt JSON parse is a failure, not
    an absence). `newDocument()` must be reachable ONLY from absence. On a read failure render
    `StorageUnavailable` — never a blank page, which is what sends a writer to a backup file.
  - **A failed VERIFICATION is not a forged snapshot.** It shows only that this build could not
    verify it with this key, and the commonest cause is innocent. **Never delete provenance to make
    a check go green.** Deletion must be writer-initiated (a `confirm()`-gated button), never a
    background sweep — kept by `provenance/noAutoDelete.test.ts`, whose allow-list is exactly
    `{provenance/snapshots.ts, routes/SnapshotView.tsx}` and must stay that short.
  - **What we SIGN with is not what we ACCEPT.** `signingPublicKeys()` accepts any key we ever
    signed with, so a production-signed document verifies on localhost; `bundle.ts` keeps the
    single-key `signingPublicKeyHex()`. Guard each key attempt separately — `ed.verifyAsync` THROWS
    on an unparseable key rather than returning false, and an unguarded loop rejects a receipt a
    later key would have verified.
  - **Snapshot history is GROW-ONLY.** Every write-back unions with the target's existing snapshots
    first (`mergeSnapshots`); `restoreSnapshotsFromBundle` unions too.
  - **A stale read is not a short read, and `mergeSnapshots` does not catch it.** `_snapCache` is
    module state, so it is PER TAB. Every write unions against DISK inside the write chain, gated on
    a byte-SIZE comparison so the single-tab path pays one metadata read and no gunzip. **A failed
    re-read ABANDONS the write** — losing one new snapshot is recoverable, overwriting an archive we
    could not read is not. `deleteSnapshot` must ask for `allowShrink`; it defaults false so a new
    write path cannot silently acquire the power to truncate.
  - **The cloud mirrors do not re-read.** `syncToOneDrive` takes the array it is handed, so
    `oneDriveWriteNow`'s local-read check (TiptapEditor.tsx) is load-bearing.
  - **Decide an open by ANCESTRY, never by `updatedAt`.** `storage/openConflict.ts classifyOpen`:
    incoming hash in the local archive ⇒ `incoming-stale`, keep local (its snapshots still merge —
    pure gain); local in the incoming archive ⇒ `incoming-newer`, adopt; neither, ambiguous, **or
    the local read failed** ⇒ `diverged`, open as a SEPARATE document and overwrite nothing. This
    path stamps `updatedAt: now`, so a stale file arrives looking brand new. **The two bugs compose:
    a null-on-failure read makes `localHash` null ⇒ `incoming-newer` ⇒ blind overwrite**, so the
    read rule above is load-bearing for this guard.
  - **Document identity is PER TAB** (`storage/tabDoc.ts`), carried in sessionStorage, never the URL
    — OneDrive sign-in returns to a bare `/` and any `?doc=` is gone. Precedence: `?doc=` ??
    sessionStorage ?? last-doc hint (new tabs only); the URL is a reflection, never load-bearing.
  - **ONE LIVE TAB PER DOCUMENT**, via Web Locks, name from the ONE exported `DOC_LOCK_PREFIX` (the
    OpfsInspector badge queries it; a private copy of that string would put the badge silently to
    sleep). `claimDocLock` RETRIES past the reload unload-race, or a plain refresh intermittently
    hands the writer a blank page. No Web Locks ⇒ never block the writer.
  - **An effect that takes a lock needs a cancellation token that also RELEASES it.** React's
    StrictMode double-invoke is a real second claimant: skipping the stale `setState` alone still
    leaks the lock.
  - **A take-over is enforced at the bytes, not asserted.** The write freeze lives at the
    `saveDocument` funnel; the holder flushes → freezes → ACKs, and the taker waits for that ack
    before stealing. After an ack TIMEOUT, steal, then wait a brief grace for a LATE `surrendered` —
    a live slow-flusher posts it once frozen, so the caller reads AFTER the freeze; a dead holder
    never posts and the grace expires.
- **Unsynced-work notice (2026-07-17, Peter's ask).** `editor/unsyncedWatch.ts` — PURE rule
  (`shouldWarnUnsynced` + reducer), `components/UnsyncedNotice.tsx` is only its face. Fires after 5
  minutes of unsynced WORK; never while sync is active; never again once waved away (the anti-nag
  clause). Every input is **read, not awaited** (linked folder / OneDrive account / Drive flag), so
  it is correct from cold. **THE CLOCK STARTS AT A DOC CHANGE THE WRITER CAUSED** — user input
  (`keydown`/`paste`) ARMS it, the next real change starts it: a docChanged transaction alone began
  the clock at PAGE LOAD (would nag someone who typed nothing), and `beforeinput` alone never fires
  at all under ProseMirror (measured 0 events at document capture — a signal that never arrives
  silently disables the feature). Both caught by `scripts/tabdoc-probe/unsynced.mjs` (5/5, threshold
  shortened via `__iwUnsyncedWarnMs`); rule mutation-tested in `unsyncedWatch.test.ts`.
- **Native citations** (replacing Zotero/BBT). `citations/` — `bibProvider` (reactive store),
  real CSL formatting, `CitationNodeView` (in-text purple hooks; reactive via editor.on('update')
  + queueMicrotask), `ReferenceListNodeView` (bibliography). Citation nav (click hook ↔ reference
  back-refs by DOCUMENT page). `pmToText(doc, resolveCitations)` — **must stay byte-deterministic**
  when resolveCitations=false (verify/bundle rely on it); SnapshotView passes true for display.
- **PDF viewer + annotations.** `components/PdfViewer.tsx` — bundled pdf.js (self-hosted wasm/fonts
  in `public/pdfjs/`), lazy per-page render, markup overlays (highlight/underline/strike/text notes
  stored on `_iw.highlights`, NOT baked into the PDF), select-sentence→link-to-citation, cursor-
  anchored zoom, supersampled canvas (≥2× for crispness). `PdfSidePanel` docks side/bottom.
  PDFs stored as OneDrive **sidecars** (`<base>.<citekey>.pdf`, uploaded once) + OPFS; embedded in
  local-folder saves. URL-linked PDFs + the `api/pdf.mjs?proxy=` relay were REMOVED 2026-07-08
  (slow, often blocked, and the one PDF path through our server) — sources embed files only;
  legacy `pdfUrl` metadata is inert. Haiku page-offset
  detection (`citations/pageOffset.ts`). CSP (middleware.ts): `frame-src blob:`, `wasm-unsafe-eval`.
- **The PDF panel's three measurement rounds are in `docs/archive/pdf-panel-rounds.md`** (zoom
  snap-back, fit-to-panel, the reader view). **Their shared lesson is a rule, not a story: the fix
  you can argue for is not the fix — reproduce the symptom against a control in the SAME build.**
  All three rounds shipped a plausible mechanism that measurement later refuted.
  - **A layout constant must never be scaled as though it were content.** The zoom snap-back was
    `PDF_OVERSCROLL_PX` (180) keyed to the LIVE zoom, so the gutter appeared mid-gesture — during
    the CSS-transform preview, whose whole premise is "no reflow" — and was then scaled by the
    settle. The gutter follows the RENDERED zoom; the anchor is a fraction of the PAGE'S OWN BOX
    applied as a scroll DELTA, so paddings, margins and gutters cancel because they are already
    inside `page.left`. Re-apply the delta after React commits the gutter (probed load-bearing).
  - **The error was independent of the cursor**, which is why it read as "flashes back centrally"
    and why staring at the anchor arithmetic — which was correct — never found it.
  - **`zoom === 1` NEVER means "the reader has not chosen a zoom".** Zoom is a multiplier on the fit
    baseline, persisted per document, and a Mac trackpad pinch fires ctrl+wheel — the gesture can
    land back on exactly 1. An early-return on it froze the page size and left dead background.
  - **One fit rule, one accessor.** `computeTextFit` is THE fit; four hand-rolled copies had already
    drifted, and the fullscreen path drifted first.
  - **Marks anchor by TEXT, not by rectangle** (`src/reader/marks.ts`) — the reflowed reader re-sets
    the page in its own font at its own width, so a rect addresses different words every visit.
    Rect-only legacy marks stay rect-only and are drawn at normalised rectangles.
  - **Markup lives on `_iw.highlights`, never baked into the PDF bytes.**
  - **A helper that cannot see its subject must return null, never an empty list** — "no marks
    painted" and "there is nothing to paint on" are different answers, the same distinction
    `readJson` and `readSnapshotsFromDisk` exist to keep.
  - Probe traps, all of which accused a working feature: `fetch('data:…')` is refused by the app's
    own CSP (use `atob`); `getSelection().toString()` is EMPTY after mouseup because
    `createFromSelection` clears it on SUCCESS; **Escape closes the panel rather than disarming the
    tool**; a click at (5,5) lands on the editor, which is how a bottom-docked panel is designed to
    close.
  - HONEST GAPS: Chromium only (WebKit has no `navigator.storage` here, so the iOS worker write path
    is untouched); the fixture is a born-digital text-layer PDF, so a SCANNED page takes an unprobed
    branch; multi-column, RTL and footnote-heavy typesetting are not represented.
- **Media import (2026-07-17, `src/media/`, LIVE — no flag).** Peter's "photo import button (which
  has photo or audio or video)" — GENERAL, into any document, and the prerequisite for the music
  lane's "turn this photo into a piece" and §A5's practice recordings. `mediaStore.ts` REUSES
  `writeOpfsFile` + `blobToBase64`/`base64ToBlob` from `citations/pdfStore` rather than copying them
  (a copy would re-acquire both bugs those primitives exist to fix — WebKit has NO createWritable and
  savePdf threw on iOS until the worker shim; the hand-rolled btoa was a 20MB main-thread stall per
  save). Bytes in OPFS `library/media/<id>.<ext>`; the document carries only `media?: MediaAsset[]` —
  a .studio that inlined a 20MB video would re-break every load-performance rule the PDF precedent
  exists to keep. **ONE importer** (`importMedia`): Peter's two paths (media import → music bar →
  label it; music panel → import directly) CONVERGE on it, so the second is a CALLER of the first,
  never a parallel road — the music lane has no file input, no OPFS write and no size rule of its own.
  REFUSES rather than guesses: an unknown MIME is never stored as a photo (a file the writer could
  never open again), an oversized file is NAMED not truncated (the email lane's rule), and a failed
  write yields NO asset — a reference without bytes is the shape of every "the file is gone" bug here.
  **⚠ A PHOTO LIVES IN A DOCUMENT; IT DOES NOT BECOME ONE** — this AGREES with the music lane ("§1
  says the Piece IS a `.studio`") rather than competing: import makes an ASSET, and "turn this photo
  into a piece" READS one to produce a `docType:'music'` document. Every inline image minting its own
  .studio is the parallel-container mistake that lane just deleted.
  **⚠ TWO OPEN RULINGS, Peter's, deliberately not guessed:** (1) media is NOT anchored — `bundleHash`
  is v:1/v:2/v:3/v:4 and this adds no version, so it takes the PDF precedent (bytes unanchored), not
  the music one (masters anchored by {id,contentHash}). Defensible while media is a reference the
  prose does not depend on; NOT once a photo is part of the argument. (2) There is no `Image` node in
  the schema and no `@tiptap/extension-image`, so a photo cannot yet be placed IN the prose — adding
  one touches `pmToText` → `contentHash` → Bitcoin, i.e. ruling (1) again.
- **Editor chrome.** `Scroll.tsx` — the fixed full-region scroll container is opt-in via the `fill`
  prop (live editor only; SnapshotView reuses `<Scroll>` in-flow inside its split pane — do NOT make
  it fixed there or it covers the diff panel). Solid styled scrollbar + inset `::before` so the fixed
  waves don't bleed over it. `StyleBar.tsx` = the formatting bar (font/size/B/H/align/list/∀).
- **Hybrid zoom (SHIPPED 2026-07-09).** TWO zooms, one owner module `src/editor/magnify.ts`:
  Ctrl/⌘+wheel over the PAGE = font-reflow zoom (`--iw-editor-zoom`, `inkwave:editorZoom`); over the
  WATER (or a page gap) = GPU transform-magnify of the whole page (`--iw-magnify` on a dedicated
  `.iw-magnify-box` wrapper, top-left origin, NO transform at scale 1). Fit-to-width: when the window
  is narrower than the page, the fit scale binds — never a partial page horizontally; it CAPS zoom-in
  and user magnify can go far below (infinite zoom-out). The wrapper is sized to the page's VISUAL
  dims (height set imperatively from a paper RO) so scroll range == visual content exactly.
  **Coordinate convention:** getBoundingClientRect under the transform returns VISUAL px — convert
  via `scaleFor(el)`/`unscale()` from magnify.ts, NEVER ad-hoc reads. Pagination measures in the
  canonical window where magnify is forced to 1, so breaks are magnify-independent by construction.
  Do NOT use CSS `zoom` on the parchment — it inflates clientWidth and breaks the paginator. Phone
  zoom = pinch → the font-reflow pipeline (Scroll.tsx touch handlers); browser-native zoom is
  suppressed app-wide on phone (universal `touch-action: pan-x pan-y` — NB touch-action does NOT
  inherit, hence the `*` rule — + gesture*/two-finger-touchmove preventDefault + 16px input floor).
- **Review layer — MERGED AND LIVE ON MASTER (probed 2026-07-17: `origin/feat/review` is an
  ancestor of `origin/master`, ZERO commits ahead; ReviewBar.tsx and the R button ship on master).
  This entry said "IN PROGRESS, unmerged" long after it landed** — a lane that refactors "under"
  it on that basis is reasoning from archaeology. Peter's spec: live suggestion mode (track
  changes on every keystroke, behind a toggle so normal typing is unaffected), comments as sticky
  notes over the wave (not a panel), triggered from the **R** button in the footer toolbar, review
  nav (←/→ + Alt+A accept / Alt+S discard), named annotation sets via a drop-up.
- **Snapshot review** (`routes/SnapshotView.tsx`, `/snapshot`) — split diff (annotated doc + hunk
  panel), minimap, swipe/shift-wheel/trackpad scrubbing, per-version summaries (Haiku, opt-in).
  **The scrub is the moat and it is heavily tuned. THE RULES ARE BELOW; the 15 rounds of measurement
  that produced them — including every refuted hypothesis — are in
  `docs/archive/snapshot-scrub-rounds.md`. Read the round that owns your area before proposing an
  alternative: it has usually already been measured and lost.**
  - **Grow-only snapshots and byte-deterministic `pmToText` apply here as everywhere.** The doc pane
    passes `resolveCitations: true` for display only; verify/bundle depend on the `false` form.
  - **Never make `<Scroll>` `fill` on this route.** It is in-flow inside the split pane; fixed there
    covers the diff panel.
  - **Hidden keep-alive layers use `opacity: 0.001` — never `0`, `visibility` or `display`.** A
    truly-hidden layer loses its compositor backing store and the next flip stalls ~500ms.
  - **A `DocLayer` binds the shared refs in a CHILD layout effect.** Child effects flush before the
    parent's, which is what makes every `[snapshot.id]`-keyed effect read the right scroller.
  - **`DocLayer.run()` must clear its deferred warm timer** or activation between warm-mount and
    its +150ms pagination paginates the layer twice.
  - **Detect rapid scrubbing from the INPUT EVENT's own `timeStamp`, never from `goTo` spacing.**
    `goTo` runs after the previous step's synchronous render, so spacing misses rapid streams
    exactly when flips render slowly.
  - **Clear `liveSnapId` ONLY in the catch-up effect once `urlSnapId` matches.** `navigate()` lands
    as a transition; clearing it alongside renders one frame with the old URL and ping-pongs.
  - **A plain flick steps exactly ONE version.** The multi-snap position scrubber arms only after
    a ~280ms mostly-still hold, checked at decisive-move time, not at touchstart.
  - **Slide LEFT = next version, slide RIGHT = previous.** Multi-touch bails to the pinch — keep
    that guard.
  - **`MAX_PER_FRAME = 1`.** At 2 the driver silently drops the intermediate version when it falls
    behind, which is the bug the flipbook exists to fix.
  - **`LAND_QUIET_MS = 260`** (a mouse-wheel notch gap is ~150-250ms; at 120 the driver "lands" a
    full React render per notch, which is the felt lag) **and `FREEZE_HOLD = 400`.**
  - **`RASTER_DPR_CAP = 1`.** The bitmap only shows while flipping; DPR1 quarters the per-swap
    texture upload and quadruples cache depth, which is what keeps real intermediate versions
    resident instead of stale-nearest.
  - **`show()` blits into ONE persistent per-pane canvas.** Attaching a fresh `<canvas>` per step
    re-layerises and re-uploads a full texture every step.
  - **Lay offscreen replica capture hosts IN FLOW and mirror the real host's `position`.** An
    absolutely-positioned host rasterises outside the crop, returns blank, is silently dropped by
    blank-detect, and stalls the sweep on that version forever.
  - **`getAnchorTop(scroller, snapId)` resolves the anchor in the TARGET VERSION'S OWN layout** —
    EXACT text match → surviving NEIGHBOUR (`provenance/anchorMap.ts`) → ratio, never the top.
    Priming a warm layer with the active pane's raw `scrollTop` registers every baked frame to an
    offset while the active pane alone is content-anchored: two rules, one pane.
  - **Judge registration by DRIFT IN PX, not by the `registered` line-open metric** — wrapping alone
    decides whether the anchor sits mid-line, so that metric cannot reach 1.0 and its shortfall is
    not a bug to chase.
  - **A doc-pane thumbnail is a picture at a scrollTop**, so its signature carries `|a1`; bitmaps
    baked under an older anchoring rule must never hydrate into an anchored library.
  - **Thumbnails NEVER travel with the `.studio`.** They are a local OPFS cache, regenerable; a
    fresh device warms as used.
  - **No component of a persisted cache signature may be a counter since page load.** Use
    content-derived state (`bibSignature()`), memoised BY the epoch — an epoch is a proxy for
    "something changed", not a description of what the state IS, and only the latter survives a
    reload.
  - **Anything putting the bibliography in a persisted key must `await libraryReady()`** — the
    library hydrates asynchronously, and a builder that runs first bakes an empty-library key that
    misses forever, silently.
  - **Header +N/−N badges read `peekOpsBetween` (CACHE-ONLY) and BLANK with `visibility` on a
    miss.** Showing another version's number mid-fling is worse than showing none.
  - **Feature flags resolve ONCE per load into localStorage; a DEBUG flag lives in sessionStorage.**
    Local-first nav rewrites the URL every scrub step, so a flag re-read from the URL dies exactly
    when the feature starts being used — and a persistent debug flag outlives its session and shows
    a diagnostic overlay forever.
  - **The doc pane renders RICH formatted pages for every version** (`RichDiffView`, default ON
    since `ef96306`). A run is a SLICE of an op, never a new op: it must emit the same
    `diff-add`/`diff-del` classes and the same `data-opidx`, because hover, click-to-jump,
    highlight injection and `computeDiffPagesFor` all key on exactly those.
  - **`staticPagination` re-runs the editor's canonical break pipeline** — the break rule exists in
    three copies (`PaginationExtension.computeBreaks`, `arithmeticLayout.paginate`,
    `staticPagination.computeBreakPicks`) and a retired widow/orphan rule was once fixed in two and
    missed in the third, putting the pane +2 pages out on plain prose. **Change one, check all
    three**, and compare break POSITIONS, not page counts — equal counts hide divergent offsets.

## Productivity + email (`src/productivity/`, `src/email/`, LIVE except email send)

Session capture → a per-month attested ledger → §A3.3 rollups → charts and an AI report the WRITER
runs in their own AI and pastes back. Surface is the toolbar's **clock drop-up** (`ClockMenu.tsx`, a
5-button nav shell); `/ledger` and `/productivity` the routes are GONE. Email compose is live behind
`?email` (send blocked on Google verification).

Spec: `docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md` — **cite the version**, since a spec
edit silently re-points an unversioned § reference. **Build log:
`docs/archive/productivity-email-build.md`** — read it before changing the heuristic, the fixtures,
or the tone.

- **`productivity/types.ts` is a CONTRACT** (`SessionRow`, snake_case because it is a CSV/wire
  shape, not repo style — don't "tidy" it). `DocType` is declared ONCE in `types/document.ts`.
- **An email is an ORDINARY document** (`docType: 'email'` + an `email` header block; the BODY is
  `contentJson`). It gets history, hashing and session capture because it is a document. The email
  layer sets `docType` and nothing else; the ledger owns resolution.
- **TYPING COST IS THE DESIGN.** Capture rides the existing `onTransaction` stream and reuses
  `countSteps`: ~0.30µs/keystroke, flat from 200 to 40k words. Every O(doc) number is computed at
  session CLOSE — a session boundary IS an inactivity gap, so the word count at the previous close
  IS the next session's `words_start`. Idle is one 30s interval, never a per-input timer churn.
- **The tick NEVER renders React.** `pomodoroStore` has two channels: state (rare, React may use it)
  and the per-second tick (IMPERATIVE ONLY — `TimeFace`/`TimeRing` write `textContent`/
  `strokeDashoffset`). A `setState` per second inside the editor's tree re-renders it every second
  while someone is typing. The countdown overlay is PORTALLED to `document.body` with
  `contain: layout style paint`, so its write cannot reach the page subtree by construction.
- **Measured, estimated and judged are THREE provenances, and a series' style is a function of
  `series.provenance`** with no style prop anywhere — so no caller can paint AI output as a measured
  bar. Post-hoc ("remembered") minutes get SEPARATE COLUMNS so conflation is unrepresentable, at all
  three split sites.
- **`entered: 'timer' | 'post-hoc'` is explicit on every row — never absence-means-timer.** A
  post-hoc block is TESTIMONY, not an `estimated` rule anyone can recompute; read it only through
  `isPostHoc()`, which asks the positive question. Show "about 45m", never start–end times: printing
  "13:15–14:00" dresses testimony as measurement.
- **A guard on one implementation of a rule says nothing about the other.** `daySummary` in
  `ClockMenu.tsx` is a SECOND implementation of "sum the day's minutes"; every guard was on
  `aggregate.ts`, so the drop-up reported 45 remembered minutes to Peter as "focused minutes" with
  the full suite green.
- **Measured numbers never round-trip.** Out yes, back never: `judged.ts` REFUSES a judged table
  carrying any measured column; `claims.ts` flags narrative numerals absent from the payload.
- **You cannot judge writing from minutes and word counts.** `insight`/`quality` are asked for ONLY
  when text was sent and REFUSED otherwise; `contentIncluded` defaults FALSE so a caller that
  forgets it refuses a guess rather than accepts one.
- **The payload is an ALLOW-LIST** (`report/compile.ts` NAMES every field that leaves). **Do not
  reintroduce a deny-list** — it fails the opposite way, silently, and the last one had zero live
  callers while `/privacy` cited it as the enforcing mechanism. Name new columns in compile.ts, and
  keep `/privacy` naming the guard that is REAL.
- **`place` is a word the writer TYPES. There is no geolocation anywhere.** Never write copy
  implying otherwise.
- **`sessions: []` at weekly/monthly**; opted-in notes travel as `note_digest` per local day. Rows at
  monthly would put a SECOND copy of every measured number beside the day rollups, which is how a
  narrative ends up contradicting the bars. One representation of measurement, always.
- **The deep-vs-shallow heuristic is RATIO ONLY — no duration**, deviating from the spec's `e.g.`
  because duration scored *worse than chance*. `unclear` is a first-class share, not a rendering
  failure. **A synthetic fixture can prove a rule INSENSITIVE; it cannot CALIBRATE a cut-point** —
  and check the classes overlap in the proxy the rule actually READS, not in one that happens to be
  there.
- **A defensive clamp on a quantity with a provable range is not safety — it is a silencer.**
  `pearson()`'s `clamp(-1,1)` hid a formula with an axis dropped, past the whole suite. It now snaps
  only floating-point hair and REFUSES anything grossly out of range.
- **§A5 tone: honest first, funny second, kind third.** Do NOT restore the "kind, non-shaming" rule
  — a test asserts it is gone. The surviving distinction is the whole thing: **productivity guilt is
  a standard IMPOSED on the writer; accountability is a goal the writer SET.** So the ban is on the
  SUBJECT and the STANDARD, not on vocabulary. Goals travel only on their own consent tick, so a
  model sent none has nothing to hold him to; never default a goal to empty — empty and absent are
  different states.
- **A hedge does not launder an invented standard.** Daily may GUESS at causality if the guess
  announces itself ("the break maybe helped"); it may not assert ("the break helped"), and it may
  not suggest a standard the writer never set. The hedge must govern the CLAUSE it exempts.
- **Time is ISO-8601 WITH the local offset — never a bare `Z`**, so the local day is recoverable.
- **The ledger is its OWN file beside the `.studio`** and takes READ-MERGE-WRITE on EVERY write —
  **do not copy the snapshot archive's once-per-session merge gate**; a month of rows is tens of KB
  and the file's cheapness buys the stronger invariant. `RemoteRead` has NO `null` member: 'absent'
  (safe to write) and 'error' (never write) are different words and the type enforces it.
- **⚠ THERE IS NO AT-REST ENCRYPTION.** Spec §C2 says there is; the code writes plaintext JSON. Copy
  tracks the CODE.
- **§C1.4 copy guard is PRODUCT-WIDE** (`src/copy/claimMatchers.ts`, swept by `claims.test.ts`).
  Matchers must be proved to FIRE on known-bad copy AND to stay silent on an honest control before
  their verdict is read — "assert the bad phrase is absent" passes trivially on a broken matcher.
- **A guard that reads PROSE as CODE attacks its own documentation.** Comments are STRIPPED before
  every source scan in this repo, deliberately: these rules must NAME what they forbid in order to
  forbid it, and the tempting fix is always to delete the sentence. **Judge what the code DOES** —
  an import, a call, a header actually sent. Every such guard needs the pair proved: fires on a real
  use, silent on a mention.

## Music module (`src/music/`, LIVE — default ON since 2026-07-19)

Photo score + reflow + markup (§A1/§A2), the MusicXML path (§B), lesson capture (`src/music/lesson/`,
`?lesson`, DEFAULT OFF). Reached from the toolbar's **♪ bar** as portalled panels over the open
editor — `/music` the route is GONE; heavy canvas/OSMD chunks stay behind lazy imports, so the
module being on costs the editor's load path nothing.

**Build log and the full reasoning: `docs/archive/music-module-build.md`.**

- **⚠ NO OMR, EVER.** The CV is barline/whitespace GEOMETRY only — row darkness, longest horizontal
  run, longest vertical run. Nothing recognises a note and nothing may. The score is
  **markup-only, never editable**; no field on `Piece` changes a note. Inkwave consumes
  Sibelius/MuseScore/Dorico output; it does not compete with them.
- **Barline pre-detection REFUSES a single stave, and the refusal IS the feature.** On a grand stave
  the connector test is decisive; on a single stave the populations overlap and the only separating
  cut exists because a synthetic barline is geometrically perfect — calibrating there would be
  circular, and a real photographed barline would be rejected. **A hallucinated bar mis-anchors
  every heatmap range, lesson note and recording pinned to it, and looks like a correct answer.**
  `{singleStave:true}` exists ONLY as the test's known-negative.
- **`groupStavesIntoSystems`' connector test is what keeps a grand stave whole** — engravers cramp
  system spacing, so a gap-size heuristic slices a pianist's hands apart. `{connectorTest:false}`
  exists ONLY as the test's known-negative; never turn it off in the app.
- **`deskew`'s `repair` step is not polish** — a binary shear quantises each column to a whole row,
  so without the 1px vertical dilation an EXACT skew estimate still detects 0 staves.
- **`binarise` is LOCAL because a harsh shadow demands it**, not on principle — global Otsu does
  just as well at moderate lighting. If the `harshShadow` known-negative stops firing, local has no
  proven reason to be there.
- **Anchors live in SOURCE-IMAGE space; the reflow is a pure view transform.** Marks written into
  inserted gaps carry a `GapOffset`. Deskew happens at capture, ONCE, so image, anchors, layout and
  bar regions share one coordinate space — two spaces for one page is the "two rules, one pane" bug.
- **A Piece is an ORDINARY document** (`docType: 'music'`, `piece.id === doc.id`) — it gets edit
  history, provenance hashing, session capture and cloud sync because it is a document, not because
  anything in `src/music/` arranges it. Do not grow a parallel container. `piece` and `music` are
  DIFFERENT fields and both are right: `music` is prose that QUOTES music, `piece` is a document that
  IS music.
- **`bar_index` (0-based ordinal) is the JOIN KEY; `bar_label` (as printed) is NEVER a key** — a
  printed bar number is a STRING by MusicXML spec ('0' pickups, '8a' endings) and is NOT UNIQUE.
  Both are optional because they are known at different times. **Carry what you know; resolve later;
  never fabricate the key.** `BarAnchor` carries no region and **must not grow one**.
- **A recolour KEEPS what it covered** (the heatmap record is over TIME, so `colourAt` is
  latest-by-ts); **`erase` refuses across the author boundary and says so**; a backwards sweep is
  NORMALISED; `heatmapHash` sorts by (ts,id) so array order cannot move it. The palette carries NO
  severity ordering — a numeric level is the field a later change starts averaging.
- **Rendered notation cannot use `var()`** — OSMD accepts only concrete hex, so `music/theme.ts`
  RESOLVES tokens against the live DOM at draw time and a `data-theme` observer redraws. A score
  container missing `iw-nightable` silently reads every day fallback and renders black on charcoal.
- **The reflow GAP BAND is PAPER, not chrome** — it takes `--iw-score-gap` in both themes. A
  photograph of a page has no night mode.
- **ONE type ramp** (`music/typeScale.ts`, five semantic steps, every step ≥16px so the iOS
  auto-zoom floor is unreachable by construction). Pick a step by what the text is FOR, not by size.
- **§A5 practice recordings CANNOT SHIP without editing `vercel.json`'s `microphone=()`** — that
  header is the lesson lane's deliberate firebreak and the single place the decision must be made.
  Coordinate before touching it.
- **Lesson STT is 'unverifiable', not on-device, and no copy may claim otherwise.**
  `webkitSpeechRecognition` asks for on-device only opportunistically and falls back to Apple's
  servers SILENTLY; the page cannot require, query or observe which happened. The transcript is
  non-storable STRUCTURALLY (`#private` field, redacting `toJSON`, no field on `LessonRecord`).
  Copy is SCOPED to the screen — "nothing on this screen can reach a microphone" — because the
  app-wide claim expires when §A5 ships.
- **⚠ THERE IS NO AT-REST ENCRYPTION IN THIS BUILD.** Both music specs say there is; verified in the
  code, there is not (`storage/opfs.ts` writes plaintext JSON; no `crypto.subtle.encrypt` in src).
  **Copy tracks the CODE, not the spec** — a plan is not a property. The shippable sentence is
  "Stored on your device — we never hold it", which is true.
- **`vercel.json` TAKES NO COMMENTS** — a `"//"` key is a hard schema reject that fails every deploy
  **before the build starts**, and `pnpm build` never reads the file, so a clean local build passes
  with the site broken. The error text from a failed deploy is the only evidence; rationale goes in
  CLAUDE.md, where it costs nothing.
## Canonical pagination (2026-07-09 — the load-bearing invariant)

Page breaks are CANONICAL: measured in a forced context (paper mm width from `editor/pageModel.ts`,
desktop side margins, `--iw-editor-zoom:1`, `--iw-magnify:1`, font 1.125rem — defeats the phone
×1.25 rule) inside `PaginationExtension.recompute()`'s single-rAF no-paint window
(`editor/canonicalMeasure.ts` does capture→force→restore-exactly), then applied as DOCUMENT-POSITION
break widgets. Same text on page N at every zoom, on phone (which "calculates relative to A4") and
in print. Consequences: live zoom/width changes ONLY repaint panels (`zoom-settled` → stable-set
no-op re-measure + `paint()`); window resize doesn't re-measure breaks at all; phone gap GEOMETRY is
compact fixed 32px (`PHONE_PAGE_MARGIN` — canonical fill-margins don't match phone-reflowed text
heights). Hard-won bugs, do not reintroduce: (a) a child's useLayoutEffect runs BEFORE the parent's
ref attaches on fresh mounts (PageGuides went dark; StrictMode masks it in dev — resolve elements
from your OWN refs); (b) the ResizeObserver must FOLD into the edit debounce, not measure next frame
(it fired the triple-reflow measure one frame after every line-wrapping keystroke); (c) Tiptap's
`update` fires on EVERY updateState incl. unrelated React re-renders — gate reschedules on doc
identity; (d) 'scroll' paper must still measure font-canonically. Citation-label hydration reflows
invisibly to inputSig → bibProvider.subscribe drives a debounced re-measure.

**INLINE-ATOM NODEVIEWS COLLAPSE TO ONE RECT (2026-07-17 — the mid-line break fix).** Peter: "even if
the paras do split, there's space left on the last line." Root cause: `collectLines` built its line
list from `range.selectNodeContents(block).getClientRects()`, which DESCENDS INTO NodeView subtrees —
so an inline atom's internal boxes each contributed a rect. The citation NodeView's ⤵ biblink button
(`display:inline-flex`, ~6px below the text line, i.e. past the **3px** same-line dedup) survived as a
PHANTOM LINE whose posAtCoords sample sits MID-LINE, so a break attributed to it opened a page gap in
the middle of a rendered line. Inline math has the identical artifact (KaTeX sub/superscript +
fraction spans). THE RULE: an inline ATOM has no internal break opportunity — the parent line can only
break AROUND it — so it contributes EXACTLY ONE rect, its own bounding box. Atomhood comes from
ProseMirror (`isInline && isAtom`), never a CSS class (a class list silently misses the next
NodeView); a block with NO atoms takes the byte-identical old path, which is what keeps plain/
headings/lists bit-for-bit unchanged. SCOPE: inline atoms only — a TOP-LEVEL atom (refList, block
math) keeps its deliberate `atomLike` pseudo-block-per-line treatment. MEASURED in the real app:
phantom lines citations 24 blocks/+29, math 23 blocks/+30 → **0** (`linecount.prove.mjs`); mid-line
breaks **6/55 → 0/55** on the thesis-shaped fixture (`midline.prove.mjs`); `isolate.prove.mjs`
citations DIVERGE → **IDENTICAL**; desktop==phone breaks and scoped==full both unchanged. This also
satisfies the long-documented co-requisite in `arithmeticLayout.ts` — but `mathEligible` is still
passed FALSE deliberately; flipping it hands math paragraphs to the arithmetic engine and needs its
own proof. THREE INSTRUMENT TRAPS THIS ROUND (all live, all in the probe README): (1) the page-gap
widget is a `display:block` span that FORCES a line break at its own position, so auditing the GAPPED
DOM for mid-line breaks is VACUOUS — it reported a confident 0/104 on a document full of them; hide
the gaps and ask the NATURAL wrapping (`gapsLeftFlow` guards it). (2) The verdict is unreadable where
the RENDERING is non-canonical — the phone renders 22.5px/350px, so canonical breaks land mid-line in
its own reflow BY DESIGN (`renderingIsCanonical` guards it). (3) A mid-line RATE cannot see a rare
NodeView: math showed 0 mid-line breaks even unfixed because no break happened to land on a phantom —
measure the artifact per block, not the coincidence.

## Wave / water system (REBUILT 2026-07-11 — Peter's strip-down)

Cyan→aquamarine gradient, two 140px SVG wave tiles drifting at 72px/s, a precomputed pool of
glitters and wave-marks, and an S-curve slow-down at reveal. **The load animation is precomputed and
playback is COMPOSITOR-ONLY — no per-frame JS, so main-thread starvation cannot touch it.** Exactly
two control events cross from the app into it: START (implicit, the prerendered `.iw-wave-anim`
class) and SETTLE (`inkwave:reveal-imminent`).

**The rebuild's rounds, the wave-video ladder, and the refuted desync hypothesis are in
`docs/archive/wave-system-rounds.md`. EVERY RULE BELOW WAS A LIVE BUG** — none is preference.

- **NOTHING MAY WRITE TO THE DOM BEFORE HYDRATION.** `hydrateRoot(document)` makes React own every
  node, so an imperative pre-hydration append triggers React #418/#423 and React then **REPLACES the
  `<html>` ELEMENT** — losing `.iw-water-ready` and `data-theme`, which puts every wave layer at
  `display:none` for the whole session. Wait behind the `hydrated()` barrier.
- **Only ever wait on a signal that ALWAYS arrives, and make it ASKABLE.** A one-shot async signal
  fails two ways — it never fires, or it already fired before you subscribed — and a bare
  `addEventListener` loses to both, silently and forever. Check the state and subscribe in ONE
  synchronous block (`__iwHydrated`, `libraryReady()`). Do NOT paper over it with a timeout.
- **Correctness of a feature must not depend on another feature succeeding.** The video keyed its
  barrier on the twinkle pool's event and hung forever on loads where the pool never announced.
- **A `reason`/status field that only some code paths write is a field that LIES.** Discriminate a
  hang from a stall by which fields are POPULATED, not by the status string.
- **Sentinel values must not be able to masquerade as measurements.** `last = -1` made the first
  tick satisfy "advancing" for a video at `currentTime` 0; require `readyState >= 2` AND a real
  delta.
- **Never hold `document.documentElement`** — resolve it at every use and observe `document` itself
  (never replaced) for the swap, or a guard re-stamps a DETACHED element forever.
- **Ask the LAYOUT ENGINE whether something painted** (box/display/visibility/opacity), never the
  decoder. Every field can be green on a build that never rendered a frame.
- **An alarm that fires on the healthy path trains the one person whose eyes are ground truth to
  distrust the instrument.** A completed hand-off must not look like a video that never ran.
- **`iw-wave-video-on` is a promise that something ELSE is drawing the water**, so it must be
  DERIVED from a live element, never latched — when a re-render tore the `<video>` out, the class
  stayed and nothing drew the water.
- **Any on-device overlay whose screenshots may cross a deploy must print `__BUILD_COMMIT__`.**
- **The tile must be 140 CSS px at every viewport.** `object-fit: cover` scales it with the
  viewport and breaks the hand-off to the CSS water; the element is sized to the chosen rung's
  DESIGN box with `fill` and the viewport crops. `pickRung` returns the SMALLEST rung of the right
  device class that COVERS the viewport, never one that must be stretched, and NEVER a rung a phone
  would have to decode past H.264 Level 4.0.
- **Brakes are born CSS-PAUSED and started at a FORWARD anchor** (`t_a = currentTime + 150ms`).
  Engines resolve pending CSS animations at STYLE time, so a brake started now shows
  `brake(commit-lag)` — a backward step ∝ lag². The drift is never stopped; the brake composites
  over it.
- **A surface mounting mid-load ADOPTS the reference surface's drift `startTime`, and must RETRY
  until that surface commits.** A `sibling != null` check that runs too early skips adoption
  forever, and the two drifts then resolve 10-25px apart permanently — which throws every mark off
  its own crest, because the marks share one clock.
- **Re-assert an adopted `startTime` at each animation's `ready`**: a write to a play-pending CSS
  animation is CLOBBERED when the pending start resolves.
- **Never create-then-re-clock mark tracks on VISIBLE water** — gate creation on `clockReady()`; a
  late mass re-clock is a whole-field teleport.
- **`--wave-x` must never invalidate the page subtree.** Firebreak it to `0px` on
  `.iw-magnify-box` / `.scroll-paper` / `.iw-wave-twinkles` and give twinkle fields LITERAL
  transforms via `swayFields()`. Without this, desktop scroll frames were p50 417ms; with it, 50ms.
- **In-flow surfaces get PANE-SCOPED water and it must stay UNPROMOTED** (`will-change: auto`,
  `transform: none`). They are content-tall, so promotion gave every keep-alive layer a ~90-megapixel
  raster; hidden layers paint no water at all, and /snapshot writes no `--wave-x` sway.
- **ONE backstop only: the 30s load watchdog.** It must never fire on a healthy load. Per-stage caps
  are gone *because* playback cannot be starved.
- **A twinkle field wakes only on SUSTAINED scroll** (two reports within 200ms) — a single
  caret-reveal nudge must not read as full-rate velocity.
- **Dash respawns must never rasterise** — relocate on the 140px lattice; `toDataURL` on the scroll
  path cost ~150ms/frame.
- KNOWN RESIDUALS (Peter, live, build `72783da`): no consistent tick, but occasional blue flash and
  white lines briefly lagging their wave, worst on phone then Chrome. Probes pass 9/9 — this class
  is real-device raster scheduling that a GPU-less headless box structurally cannot see. **The next
  wave round starts HERE, not from "all green"**, and the clock hypothesis is already REFUTED
  (measured 0.00px on 4/5 loads; WAAPI and CSS share `document.timeline`). Next tool is on-device
  capture, not another headless probe.
- PROBE RULES: /snapshot needs a fallback-faithful static server; never `pkill` a shared
  `vite preview`; no windows over Peter's screen (`scripts/pw-headed.sh`). The wave-video probes need
  `scripts/wave-video/server.mjs` — the scrub-probe server has no `.mp4` MIME and no Range/206.

Build marker: Settings footer + console show `__BUILD_COMMIT__` (vite.config.ts).

## Open pipeline + cloud caching (2026-07-09)

`storage/openCache.ts`: cloud `.studio` bytes cached in OPFS keyed by change-tag (Graph cTag/eTag,
Drive md5/version), 100MB LRU; cache HITS may only compare TRUSTED tags (fresh listing / live
metadata GET) — a stale listing tag could false-hit and the next sync would clobber the newer
remote. `warmCloudOpen()` (runWhenQuiet) pre-warms tokens/listings/recent bytes; background warm
paths must NEVER call GIS `getDriveToken` — its requestAccessToken opens a real popup window even
for prompt:'none' (Firefox blocks + warns); use `peekDriveToken()`. Parse runs OFF-THREAD
(`parseStudio` op in workers/parseClient.ts — the .studio parse on the main thread was the historic
0.5-1s open freeze); `inkwave:open-doc` carries the parsed doc. Snapshot restore defers its disk
write behind the reveal (write-through `_snapCache` is authoritative in-session; grow-only holds
because every write-back reads through the cache). Library/PDF restore is fire-and-forget AFTER the
reveal. `openPerf.ts` logs one line per open. OneDrive PDF sidecars self-heal: quiet-pass
`fetchMissingSidecars` + on-demand `fetchSidecarFor` in PdfSidePanel (savePdf threw on iOS until the
write shim, so metadata can say a PDF exists with no local bytes).

## iOS / WebKit invariants (2026-07-08/09 — each was a live bug)

- ALL OPFS writes go through `storage/opfsWrite.ts` (WebKit has NO createWritable; worker
  createSyncAccessHandle, serialized — ONE open handle per file or it throws; truncate/flush/close
  awaited for ≤16.x).
- File inputs: NO `accept` extension lists on touch (unregistered UTIs grey out every file).
- `navigator.storage.persist()` on first write (Safari's 7-day eviction); iOS <16.4 (no
  CompressionStream) degrades gracefully + banner.
- touch-action does NOT inherit — per-element, hence the universal phone rule; mid-gesture elements
  that own a drag (SCAS reel) need their own `touch-action:none`.
- iOS auto-zooms (and STAYS zoomed) focusing controls <16px — global 16px floor on phone.
- **THE FLOOR SETS A FONT AND NOBODY EVER GREW THE BOXES (2026-08-30).** That rule is
  `font-size: max(16px, 1em) !important` on `input, select, textarea` — it changes the TYPE and
  nothing else, so a control declared at `height: 22` is now shorter than the line it has to hold.
  Measured on the source reader's address bar, its composer, its two reading selects, the live-mode
  page-width select, the PDF's note-size select and the PDF reader view's font select: every one
  had been floored months ago and every one was still a 22-28px box. `TOUCH_FIELD_H = 40`
  (SourceBrowser) is the answer, and 40 rather than 34 for a structural reason: **a `<select>` is a
  REPLACED element and renders no `::before`/`::after` in Chrome or Safari**, so it can never
  borrow a pseudo-element hit region — its own box is the only target it has.
- **TAP TARGETS: GROW THE HIT REGION, NOT THE LAYOUT — `.iw-tap` / `.iw-tap-row` (index.css,
  2026-08-30).** Measured at 375×667 with touch: reader header icons 24×24, markup tools 26×26,
  zoom −/+ 22×22, the notice's ✕ 12.7×14; the whole PDF toolbar 28×28; a text note's delete badge
  16×16. Both bars are DELIBERATELY dense (Peter asked the PDF toolbar down to ONE row; the reader's
  phone dock is 50dvh), so the painted control keeps its size and only its hit region grows — a
  `::after` on the control, which is part of that control's own hit region, so nothing reflows.
  · **THE WIDTH IS HALF THE ROW GAP PER SIDE, NEVER A FLAT 44px.** Two neighbours each claiming 44
    OVERLAP, and the later sibling paints last and WINS the overlap — an unconditional expansion
    TAKES a tap target away. `--iw-tap-x` is the row's own gap, set per row (8/6/2px in the reader,
    3px in the PDF toolbar); one shared constant would be wrong in most of them.
  · **NEVER INSIDE A VERTICAL MENU.** `.iw-tap-row` treats every descendant button, and the PDF's ⋮
    drop-up is a COLUMN 2px apart — 44px regions there would make "Print" eat part of "Export".
    `[role="menu"] button::after { content: none }`, and those rows grow for real instead.
  · **RESIDUAL, STATED:** horizontal reaches only (control + gap) — 29-32px. A dense icon row cannot
    give every icon 44px WIDE without reflowing, and that is Peter's call. Most misses on a
    horizontal row are vertical, which is the half this fixes.
- **AN ELEMENT THAT OWNS A DRAG DECLARES `touch-action`, and two shipped ones did not (2026-08-30).**
  The rule was already in this list; these are the instances it had not reached. The PDF's TEXT NOTE
  (drag-to-move) and the PDF reader view's SIZE and LINE-SPACING sliders both own a drag, and under
  the app-wide `pan-x pan-y` a finger on either was a candidate PAN: the browser took the gesture,
  scrolled, and sent `pointercancel`. **`setPointerCapture` cannot override that** — capture routes
  events, it does not claim the gesture — so the note simply never moved and the sliders never slid,
  silently, on the only device that matters here. No UA stylesheet sets touch-action on
  `input[type=range]`; do not assume one does.
- **A HOLD GESTURE NEEDS `onPointerCancel`, and a DISMISS SCRIM NEEDS `onPointerDown` (2026-08-30).**
  The reader's hold-to-open palette had no pointercancel while the PDF toolbar's identical gesture
  always had: a finger that drifted got no `pointerup`, so the 400ms timer still fired — the palette
  opened under a finger that had left AND `heldRef` stayed set, swallowing the next tap on that tool.
  Separately, all three full-screen scrims (both colour palettes, the ⋮ export menu) dismissed on
  `mousedown` alone; **iOS withholds the synthetic mouse event whenever the gesture is treated as a
  scroll or a touchmove was preventDefaulted** — which this panel's own `.iw-touch-guard` handler
  does. A scrim on mousedown is a dismiss that sometimes is not there.
- **A POPOVER CENTRED ON YOUR FINGER HANGS OFF A 375px SCREEN.** The reader's selection popover and
  its coloured-text composer are `left: x; translateX(-50%)`; the composer is ~354px wide, so any
  selection near a margin put half of it — and the ✓/✕ that commit or cancel — past the edge
  (`useClampedX`, a layout effect so the clamp lands before paint). The PDF's ⋮ menu measured
  **left = −134**: it is `right: 0` of the ⋮ BUTTON and the toolbar WRAPS on a phone, so the ⋮ can
  land near the left edge with a 232px right-aligned card behind it.
- KEPT: `src/components/touchTargets.test.ts` (25 tests, ~25ms, no browser, 8 mutants proved to die;
  **comments are STRIPPED before scanning** — these fixes are explained by sentences containing the
  literal words "onMouseDown", "mousedown" and "pan-x pan-y", and a raw-text guard would fire on its
  own documentation). In-browser truth: `pnpm prove:phonetouch`
  (`scripts/textrender-probe/phonetouch.prove.mjs`) — 375×667 `hasTouch`/`isMobile`, computed styles
  and real geometry, with a DESKTOP CONTROL proving the hit region cannot reach a mouse (0 of 16),
  a collision check proving no region reaches into a neighbour's own button (a flat `max(100%,80px)`
  fires it on 24 + 22 pairs; a flat 44px does NOT — it only reaches the neighbour's EDGE, which is
  why the first negative proved nothing), and VOID guards throughout.
  **THREE PROBE ARTEFACTS to know before writing another:** a naive overflow walk accused the reader
  of a 24px overflow that was KaTeX's 1px-clipped MathML (`getBoundingClientRect` answers where a box
  WOULD be — intersect with every clipping ancestor); pressing **Escape to dismiss a palette CLOSES
  THE READER**, so the later checks measured a panel that was not there; and an **armed highlight
  tool deliberately MARKS a selection instead of raising the popover**, so the popover checks
  reported the feature broken until the probe disarmed first (and disarming takes TWO clicks — the
  hold's `heldRef` is consumed by the browser's own post-long-press click, which a synthetic
  pointerdown/pointerup never produces).
- Phone typing scheduling: pagination re-measure 850ms (1200ms keyboard-up), SCAS tick 250ms,
  autosave 800ms, word count 1s — input latency owns the main thread; `inkwave:perflog=1` for
  on-device numbers.
- The SCAS tick is WINDOWED on BOTH platforms — INCLUDING deletion ticks (round-4, 2026-07-11,
  Peter's "deleting lags in waves"): the vanished-lemma pass needs whole-doc word PRESENCE, not a
  full rescan, and the controller now maintains a lemma-presence MULTISET (+ slot-original
  multiset) updated per tick by a top-level block IDENTITY diff (persistent PM nodes; per-block
  contributions cached by node identity — `blockLemmas`). The phantom-snapshot guard holds because
  the index is global by construction: a removal anywhere decrements it whether or not the window
  saw it (`controller.presence.test.ts` pins outside-window deletion, duplicate-lemma survival,
  slot protection, split/join). Measured: deletion-tick scas-tick 150ms → ≤21ms (4× phone emu,
  20k words). The windowed decoration splice is only legal when the tick did NOT change SCAS state
  (a verdict change repaints that lemma doc-wide). Word count runs ONLY while ◈ is open.
- Enter must do NO O(doc) work on the keystroke (round-4 "mega lag": Enter p50 300ms → ~100ms,
  ≈2× a plain char): the paragraph-snapshot trigger reads ONLY the completed paragraph's
  textContent, and the snapshot chain (ensureDocFresh + JCS + hash + OPFS + OTS) is deferred to a
  genuine input pause (runWhenQuiet 1.5s — content is captured at WORK time, as it always was).
  The old residual tail (the ~1.1s canonical measure at the 850/1200ms pause) is FIXED by the
  round-5 incremental break recompute below.
- **SCOPED CANONICAL MEASURE + LAZY FULL REFRESH (2026-07-12, round-6 — supersedes round-5's
  measurement-host recompute, which Peter's live thesis falsified: host clones cannot replicate
  NodeViews (math shadow DOM, citation labels) and cv-rendered blocks measure ~9px off even on
  plain text).** EXACT NEAR THE WRITER, DEFERRED FAR AWAY — never approximated: the scoped
  measure (PaginationExtension `computeScoped`) runs in the REAL forced canonical context — live
  DOM, live NodeViews, real posAtCoords — but reads ONLY the changed blocks (+ the block below,
  for the advance); unchanged blocks reuse cached block-relative lines at the previous measure's
  tops (bit-identical above the edit, one telescoped delta below); gap widgets in/next to the
  region are cleared by a REGION-SCOPED decoration dispatch (same natural-wrapping rule as the
  full clear); unresolved break-line positions use the identical posAtCoords sample, baked per
  (node, line). NO content-visibility tricks in measures — the round-6 storms showed cv-rendered
  geometry diverges. `canonicalIsLive()`: on desktop at defaults (no phone rules, zoom 1,
  magnify 1) the live layout IS canonical, so the force — and BOTH its full-document reflows —
  is skipped for scoped AND full measures. A FULL measure re-verifies lazily after every scoped
  one (idle-gated ~2.5s, sig-guard = visually quiet) and refreshes the incremental base.
  PRINT FLOOR (Peter: "render it all properly at time of print"): 'inkwave:measure-now' /
  'beforeprint' run a SYNCHRONOUS full measure + paint; printDoc() and exportPdf() dispatch it
  explicitly (exportPdfToNewTab clones the live body — its widgets must be exact). Snapshot
  staticPagination runs its own canonical pipeline (never lazy); citationNav page labels read
  live widgets (≤2.5s self-healing drift — accepted). PROOF: 'inkwave:pagCheck=1' runs BOTH
  paths per measure and compares signatures — round-6 storms: 23/23 plain-paragraph synthetic
  AND 27/27 on Peter's real citation-heavy Honours doc ×6 (13k words, 174 citation nodes, lists,
  rules, refList). Measured (4× throttle, 20k words): desktop scoped 6-33ms (was 133-277 full);
  phone scoped 311-526ms — the two reflows are the price of exactness there (was 636-1364 full;
  round-5's 18-81ms was wrong on real docs). perflog: page-measure-scoped / page-measure.
  ROUND-7 (2026-07-12): after a scoped success where the full measure is cheap (canonicalIsLive
  desktop), the lazy re-verify runs FAST (450ms, input-gated) so any deferred far-field break
  correction — incl. mid-paragraph splits — lands ~0.5s after the pause (Peter's bar: "paras
  split over pages even if they render 0.2s late; the cursor line moves instantly"). Mid-block
  splits themselves were verified live: page-exceeding paragraphs split at load and stay split
  through edits (mid-split probe on the Honours fixture); scoped==full sig equality already
  covers split placement. `window.__iwPagInc.reasons` counts scoped-bail causes for on-device
  diagnosis (the first edit after any open bails once — open-flow normalization widens the diff).
- **MATH-CERTIFIED FONTS (2026-07-12, round-7 — groundwork for the arithmetic layout engine).**
  Peter's directive: replace fonts that defeat exact math layout rather than carry DOM fallbacks.
  The prover (scratchpad font-calib.mjs): canvas measureText vs DOM parity across family ×
  {400,700} × {normal,italic} × 7 sizes (8pt-72pt + canonical 18px) — advance widths (Δ≤0.05px),
  greedy-wrap break indices at 500px, mixed-run tallest-line-box rule. CERTIFIED + SHIPPED:
  15 families (Peter's palette budget), grouped in the picker (Identity/Serif/Display/Slab/Sans/
  Mono): IM Fell DW Pica + EB Garamond (identity — both pass: the math engine is viable),
  'Times' = TeX GYRE TERMES and 'Arial' = TeX GYRE HEROS (certified CLONES, GUST licence,
  fetched via the DIRECT list in fetch-fonts.mjs — display labels are decoupled from css stacks;
  NB 'Times'/'Arial' are Monotype trademarks: the safe commercial pattern is the clone's own name
  — one-line change in StyleBar FONTS), Crimson Pro, Spectral, Lora (the Cambria-warmth stand-in
  — Caladea failed twice; system Cambria is DEFINITIVELY unshippable: canonical breaks must be
  identical cross-device and a system font can't be), Gelasio, Gentium Plus (classical languages),
  Cormorant Garamond + Fraunces (display), Bitter (slab), Carlito (Calibri twin — also the
  closest shipped cousin to Aptos, which is licence-locked; Open Sans certified as the nearest
  open face in spirit if ever wanted), Atkinson Hyperlegible (a11y), JetBrains Mono. ALSO
  CERTIFIED but cut for palette budget: Cardo, Noto Sans, Noto Serif, Open Sans, Fira Code,
  Nimbus Roman. ⚠️ **THE "FAILED" LIST BELOW IS RETRACTED — RE-CERTIFIED 2026-07-16, ALL 13 PASS.**
  r7 measured canvas vs a PLAIN span with ligatures ON **on both sides** — but prosemirror-view's
  injected sheet sets `font-variant-ligatures:none; font-feature-settings:"liga" 0` on .ProseMirror,
  so the editor renders liga OFF and canvas measureText applies ligatures BY DEFAULT. Those 13 faces
  diverge (Δ3–45px) ONLY when ligatures are applied — a divergence that CANNOT OCCUR in production.
  Re-measured in the real context (real .ProseMirror + `textRendering:'optimizeSpeed'` +
  `fontKerning:'normal'` on the canvas): **every family Δ0.0000, wrap 8/8**. r7 named the cause
  ("hinting/ligature divergence") but blamed the wrong half — ligatures, not hinting; kerning was
  ruled out. What licenses the retraction: a LEGACY A/B re-measures each family in r7's own context
  and reproduces its verdict set 33/33, so ligature shaping is the only variable. The 15 shipped
  fonts ALL still pass — nothing to revert; this is purely additive.
  FORMERLY-"FAILED", NOW CERTIFIED (not yet shipped — palette is Peter's call): Tinos, Arimo,
  Caladea (the Cambria-warmth slot), Vollkorn, Libre Baskerville, PT Serif, Source Serif 4,
  Alegreya, Baskervville, Libre Caslon Text, Quattrocento, STIX Two Text, Inter (700).
  **BASKERVILLE GENRE IS BACK**: all four candidates certify — the genre was abandoned on the
  flawed grid, not on the fonts. Before shipping any of these: the certification is CHROMIUM-ONLY
  (as r7's was) and the canonical-break invariant is CROSS-DEVICE ⇒ a WebKit pass first; and
  Tinos/Arimo/Caladea are Times/Arial/Cambria metric clones (same trademark caveat as TeX Gyre).
  Re-run: `node scripts/fontCertify.fetch.mjs && node scripts/fontCertify.prove.mjs <port>`.
  TWO TRAPS THIS EXPOSED, for any future font/measure work: (1) canvas-vs-DOM parity MUST be
  measured inside a real .ProseMirror (white-space:break-spaces + liga off) — a plain-div harness
  certifies a fiction the editor never uses; **AND THE SAME TRAP KILLS THE RUNTIME GATE, SILENTLY**
  (2026-07-16): `canvasShapingMatchesEditor`'s own probe span had BOTH halves wrong — it set the CSS
  `font:` SHORTHAND (which RESETS font-variant-ligatures to normal, so the probe shaped WITH
  ligatures inside a liga-off editor), and being a direct child of .ProseMirror it inherited the
  zoom-window's `content-visibility:auto` and, parked off-screen, was SKIPPED — measuring 177px
  against a true 1186px. The gate therefore returned FALSE always, so `inkwave:arithLayout` did
  NOTHING in production from the ligature-strip round (f75eef5) until it was fixed. THE GENERAL
  LESSON — a self-check that measures in a fiction does not fail loudly, it silently DISABLES the
  feature it guards, and the feature's absence looks exactly like the feature being unnecessary. Any
  gate of the form "measure X, compare to Y, disable if they differ" must be probed for its OWN
  correctness (assert the gate PASSES on a known-good input) before its verdict is trusted; (2) `document.fonts.check()` returns TRUE for a family
  with NO @font-face (the system fallback counts), so an unfetched font silently measures the
  fallback against itself and "agrees" at 0.000 — detect real load by comparing against the
  monospace fallback. Nimbus Roman remains UNTESTED (CTAN 404) — reported NOT-LOADED, never certified.
  The old
  system-font entries (Times/Cambria/Georgia/Palatino/Baskerville/system-ui) are GONE from the
  StyleBar (device-dependent metrics = uncertifiable + they already broke cross-device canonical
  breaks for marked runs); legacy docs still render — each new css stack keeps the old system
  stack as its fallback tail, and old marks' own stacks resolve exactly as before. Only the
  identity serifs PRELOAD (fetch-fonts.mjs PRELOAD_FAMILIES); the rest load on demand and the
  pagination re-measures on 'loadingdone'. THE MATH LAYOUT ENGINE ITSELF is the designed
  follow-up: per-run canvas advances + greedy breaking feeding computeBreaks as a third
  acquisition path, DOM full measure as idle verifier, pagCheck as prover, gated on
  document.fonts.ready + certified fonts only.
- **⚠ `?arithLayout` — DO NOT GRADUATE. The engine no longer agrees with live pagination, and the
  "0 divergences" below it is STALE (measured 2026-08-30).** The reflow-free canvas-advance engine
  was parked 2026-07-15, unparked in rationale 2026-07-18 (`96b0edb`) on `prove:arith` reporting
  **0 divergences across 4k/6k/8k (15/23/31 breaks)**. That number was true when written and is
  false now: HEAD measures **every break divergent — 17/17, 25/25, 34/34**.
  - **NOT a platform difference, and not a regression in anything a writer sees.** Bisected on ONE
    machine, same fonts, with the probe file itself unchanged since it landed: clean through
    `68ff277`, red from **`8f5ae9d` (2026-08-28, "page breaks no longer cut a line in half at any
    zoom")** onward. The **arith side is byte-unchanged** across the whole range (15/23/31 both
    before and after); it is the **DOM side that moved**, to 17/25/34.
  - **WHY, and it is structural rather than a bug in either half.** `8f5ae9d` snaps a break to the
    block boundary when `!liveIsCanonical` (`shouldSnapToBlock`), so no line is cut at a non-1 font
    zoom. Whole-doc arith is gated to `!canonicalIsLive`, and `arith.prove.mjs` therefore *sets*
    `inkwave:editorZoom = 1.2` to reach the engine at all. **The two gates are exact complements:
    the engine only ever runs in the condition the new snap rule governs**, so it is now guaranteed
    to disagree on every break. Canonical rendering is byte-unchanged (`prove:breaks` green), which
    is why live pagination and print are unaffected.
  - **THE REAL BLOCKER IS NOW `arithmeticLayout.ts`, NOT WebKit.** It does not implement
    `shouldSnapToBlock`. Graduating on a WebKit pass alone would ship an engine that cuts lines in
    half at every zoom — reintroducing verbatim the bug Peter reported on 2026-08-28. The WebKit
    cross-device pass and the scoped-arith typing A/B are still required, just no longer first.
  - **IT WAS RED FOR TWO DAYS AND THE GATE SAID GREEN**, because `prove:arith` was one of 52
    `.prove.mjs` files not wired into `package.json` (fixed 2026-08-30). This is the file's own
    headline — "a proof that ran once is indistinguishable from one that never ran" — happening to
    the very entry that claims it.
- Phone surface touch listeners: touchstart must stay PASSIVE (a non-passive one adds main-thread
  wait to EVERY tap/scroll start); the pinch's non-passive touchmove is attached only while two
  fingers are down (armed inside the second finger's touchstart — early enough to preventDefault
  the first move). Pinch suppression = that preventDefault + gesture events + touch-action.
- iPadOS masquerades as macOS (detect via maxTouchPoints); GIS popups need pre-loaded clients so
  requestAccessToken runs inside the tap's transient activation.
- **The footer toolbar is slaved to the VISUAL viewport by transform (2026-07-11).** iOS never
  resizes the layout viewport for the keyboard — it shrinks/pans the visual viewport, and WebKit
  composites keyboard-up pans WITHOUT re-running layout, so a layout-property lift (`bottom`) on
  the fixed wrapper doesn't apply mid-pan: the bar floated "all over the shop". The dock
  (`editor/toolbarDock.ts`, unit-tested against a stubbed vv) writes `translate3d(0,-off,0)` on
  the wrapper per frame while geometry moves (sync write on each vv resize/scroll + rAF follow
  loop for momentum tails + 500ms drift watchdog); `--iw-kb-offset` carries the same value for
  the scroll-padding reserve. PM's scrollThreshold/scrollMargin stay toolbarH + 28 ONLY:
  prosemirror-view's windowRect bottom is ALREADY visualViewport.height, so a kb-inclusive PM
  reserve double-counts the keyboard (probed: +180px over-scroll then −84px pull-back on
  alternating Enters — a screen bounce per keystroke). Programmatic caret
  reveals (keepCaret) are FORBIDDEN while the geometry is moving (`isSettled()` false) — they
  fight iOS's own focus pan (the tap-to-type double-jump); the dock's onSettled runs them once,
  then re-runs at +250/600ms (no-op-guarded — iOS's focus pan can land AFTER our settle and
  re-hide the caret behind the pill; the tap, not the first keystroke, owns the reveal).
  Never move the lift back into `bottom`/CSS-var positioning. Transitioning the transform is
  allowed ONLY for large event-driven jumps (>60px = a keyboard show/hide step gets a 250ms
  ease-out "chase"); per-frame follow writes (pans/momentum) must stay transition-free.
  Rubber-band/pull-to-refresh: kbOffsetFor clamps negative offsetTop AND the dock freezes
  whole while `overscroll` (scrollY outside [0,max]) — elastic geometry is garbage and the
  old math rode the bar to mid-screen.
- **Toolbar menus must not dismiss the keyboard (2026-07-12).** Any tap outside the
  contenteditable blurs it on iOS → keyboard retracts → the docked pill + its just-opened menu
  slide to the screen bottom. A document-level capture pointerdown guard preventDefaults taps
  on `.iw-touch-guard` surfaces (the pill AND every PORTALED drop-up panel — Settings/Options/
  Page/Guide/Math all carry the class) while the editor owns focus; real form fields
  (input/textarea/select/contenteditable) are exempt. New footer drop-ups MUST carry
  `iw-touch-guard` or their taps will retract the keyboard.
- **THE FOOTER BAND IS THREE INDEPENDENT FIXED ELEMENTS, AND THEY COLLIDE (2026-08-21).** The
  toolbar is CENTRED (`fixed left-0 right-0 flex justify-center`) while the sync pill (SyncStatus,
  `right:0`) and the snaps pill (ReceiptPanel, `left:0`) are EDGE-anchored — nothing made them aware
  of each other, and below ~650px of viewport width the toolbar simply grew into the sync pill.
  **It is invisible above ~700px, which is why several "fixes" verified clean and were not**: Peter
  runs a ~570px window (half-screen on a Retina Mac) and every check had been run at 900-2000px.
  Sweep the WIDTH RANGE, not a point.
  - **ONE BUDGET, TWO CONSUMERS.** `--iw-bar-budget` (written on the pill in TiptapEditor.tsx,
    inherited by `.iw-desktop-toolbar`) caps the box AND drives the circle-shrink clamp. Capping only
    the BOX leaves the circles at full size spilling past the rounded border ("the right button is
    falling off"); capping neither lets the centred box reach the sync pill. Two constraints computed
    from slightly different budgets is what produced a dead width-range where both were true at once.
  - **CIRCLE SIZE IS COMPUTED FIRST; GAPS TAKE THE REMAINDER.** The reverse (sizing gaps from the
    budget, circles from the leftovers) produced both complaints simultaneously — on a wide window
    the gaps grew until the bar spanned the page, on a narrow one the circles collapsed to ~23px.
  - **A COLLAPSED `max-height: 0` ROW STILL HAS A WIDTH**, and this was the real cause of the
    proportions repeatedly drifting back. The pill is a flex COLUMN, so its width is the widest
    child's max-content — and the hidden style bar is wider than the circle row, so it had been
    sizing the pill (measured: 86px of dead pill past the last circle). `width: 0; min-width: 100%`
    while collapsed drops its contribution without breaking its layout when it expands.
  - `TOOLBAR_SIDE_RESERVE_PX` (TiptapEditor.tsx) reserves space per side for the edge pills; the
    reserve is divided by the transform scale because max-width is a LAYOUT property while the
    collision happens in PAINTED px (a 421px pill paints 471 at ×1.12).
  - **THE TWO SIDE PILLS ARE ONE PAIR — `components/sidePill.ts` owns their height, font and offset.**
    They are separate components that never reference each other, which is exactly how they drifted:
    the right pill had been given a height tracking the TOOLBAR's (56px vs the left's 30.8px) and the
    two sat on different `bottom` formulas. `sidePillBottom()` centres each on the toolbar's MIDLINE
    — bottom-edge matching is wrong for boxes of different heights — reading the LIVE `--iw-toolbar-h`
    so they re-centre for free when the style/review row opens. Verified midline delta ≤ 0.5px.
  - **`🗀` HAS NO GLYPH ON macOS** and rendered as tofu (□) in the sync label. Peter moved from
    Windows, where it renders. Check any decorative codepoint on both platforms.
- **THE TOOLBAR CONTRACT IS `editor/toolbarContract.ts` (2026-07-17) — ONE file, and it is the
  only way in.** Three lanes took toolbar real estate at once (prod-ledger's clock, music's bar,
  the media import), which is this repo's "two implementations of one rule" wound pre-authorised.
  So: a lane registers a button by adding a member to `SlotId` + `ALL_SLOTS` (+ `IMPLEMENTED_SLOTS`
  when its button actually renders — ONE predicate covers both "no lane yet" (`media`) and "behind
  a default-OFF flag" (`clock` → `prodLedgerEnabled`); a slot that cannot render must never paint a
  dead circle, nor strand a stored id when a flag goes off), and
  owns the second bar row by adding a member to `BarLayerId`. Nothing else. `migrateSlots` is
  generational (KEEP what is valid in the writer's order, FILL from canonical order, never reset —
  the old `parsed.length === 4` rule stranded every other shape); `planBarToggle` makes Peter's
  "mutually exclusive" STRUCTURAL — the shipped two booleans were four states with one illegal,
  prevented only by one hand-written function. **A SLOT IS A TRIGGER, NEVER AN OWNER**: the ◈
  ReceiptPanel is the precedent Peter named for two access paths (its own button + the ▲ entry
  write ONE lifted `receiptOpen`), and it is how the clock's slot and the top-right countdown stay
  one implementation. 26 unit tests, all four mutants proved to die; `scripts/toolbar.prove.mjs`
  drives the real app (row/drawer partition, curated order survives, S↔R exclusion, day+night).
- **Toolbar hotkeys are POSITIONAL (2026-07-17): Alt+1…Alt+6 = the row, Alt+0 = the ▲ drawer,
  Mod+, = Settings.** Peter's framing is that the binding IS the feature ("apps are like a learning
  tool for learning how to do things on hotkeys"), so the hint teaches it: hold Alt on desktop and
  each circle wears its number (`--iw-hotkey-hint-fg`; the badge sits ON `--iw-ink`, which is LIGHT
  purple in night, so white would be unreadable — it punches out in the night surface instead).
  Positional because "a toolbar is like your app homepage": Alt+3 means THE THIRD CIRCLE, so the
  binding MOVING when you reorder is the design — position is identity on a homescreen.
  **THE HOTKEY IS THE TAP**: it dispatches the slot's own button `.click()` rather than calling an
  action, because every slot owns its open state privately — an action registry would be a SECOND
  way to trigger each slot, and the two would drift the first time a slot changed what its tap
  does. **NOT Alt+<letter>**: Firefox on Windows/Linux (PETER'S OWN BROWSER) binds Alt+F/E/V/S/B/T/H
  to the menu bar; Alt+digit is unbound in both engines. ⚠ ReviewBar binds Alt+A/Alt+S/Alt+Arrows
  and Alt+S is Firefox's History menu — an UNRESOLVED possible collision (its `preventDefault` may
  or may not claim the key first); a Firefox probe of it was inconclusive because the review layer
  never armed. Phone renders no hints and binds nothing — it has no Alt and loses nothing.
- **Toolbar slots are ONE population (2026-07-12):** the 6 main-row circles + the ▲ drop-up
  overflow (S style and ⚙ settings are slots too — CONFIRMED still true; only ▲/⋮ fixed).
  Peter 2026-07-17: the row is SIX because "it fits well on phone" and phone/desktop must stay
  continuous; the population grows freely because "it's only 1 extra click to access a button
  behind the arrow" — ▲ is the app drawer, not a cupboard ("a toolbar is like your app homepage").
  `inkwave-toolbar-slots` stores 6 (legacy 4 migrates by appending style,settings) — but it is now
  only the writer's DEFAULT for their next new document: **the layout follows the .studio**
  (`doc.toolbar`, `ToolbarConfig`) — **which was HALF TRUE until 2026-07-17 and read here as
  fact.** `doc.toolbar` persisted in local OPFS, so on the authoring machine it looked like a
  working feature; `ExportBundle.document` is an ALLOW-LIST and never named the field, so every
  .studio ever emailed, synced or downloaded arrived with the layout STRIPPED. Both halves are wired
  now (bundle.ts emits · openDoc.ts restores) and `storage/openDoc.toolbar.test.ts` drives the REAL
  `openInkwaveFile` (drop the restore ⇒ 3 die). The entry below it claimed the feature; nothing
  could see that the emailed file didn't have it. Chain: doc config → the writer's own last layout → the
  first-run six (page, style, info, settings, media import, review — ALL SIX LIVE since the media lane
  landed 2026-07-17; the `media`→`bib` fallthrough is retired). A received document brings its
  author's layout, which is the feature; it can never hide ▲/⋮ or name a button this build lacks,
  because every path resolves through `migrateSlots`. **NOT anchored — and that is PROVED now, not
  asserted** (`editor/toolbarHash.test.ts`, the real createSnapshotIfChanged → gzip → bundle →
  verifyBundle chain): two documents differing ONLY in their toolbar hash identically (content AND
  bundle), rearranging mints NO snapshot, the snapshot record has no toolbar key, and a TAMPERED
  toolbar STILL verifies — the inverse of every other tamper test here, deliberately: a recipient who
  rearranges the buttons must not be told the writing was altered. It carries a KNOWN-POSITIVE (the
  same comparison sees a one-word prose change) so "identical" is an observation, not a harness that
  hashes nothing; the obvious mutant kills 6 of 9. Peter: "keep the toolbar config out of the hash.
  It doesn't need to be in provenance."
  **⚠ MIGRATION IS A RENDER RULE — KEEP IT OUT OF THE BYTES.** `migrateSlots` resolves against
  `livePopulation()`, which is FLAG-SENSITIVE, so migrating on the way IN, OUT, or THROUGH deletes a
  slot from the AUTHOR'S FILE the first time anyone opens it with a flag off (a `?prodLedger` writer's
  `clock`, silently, forever). Three sites, three functions, one rule: `carryToolbarConfig` (verbatim
  order, registered ids only) for in/out; `mergeRowIntoConfig` for the write-back after a drag —
  it keeps only what the writer COULD NOT have chosen to drop, because the config stores the ROW and
  drawer membership is DERIVED, so a LIVE slot missing from the new row was demoted deliberately and
  must not resurrect (both directions mutation-proved). Migration answers "what can THIS build draw?";
  a document answers "what did the author arrange?".
  **ONE ROW SIZE:** index.css sized the phone circles at `(100vw − 45px) / 8` — a second copy of
  ROW_SLOTS (+ ▲ + ⋮) in another language, which no lane changing ROW_SLOTS would open, on the one
  device the number exists to fit. It now derives from `--iw-row-slots`; the guard reads index.css
  ITSELF (jsdom does not resolve custom properties from a stylesheet — theme.test.ts's lesson).
  **`scripts/toolbar.prove.mjs` IS LOAD-FLAKY AND FAILS TOWARD "THE FEATURE IS MISSING"** — under CPU
  contention it reported `✗ the media-import button renders` + the Alt hints + the drawer remainder,
  17/26, on UNTOUCHED master and on the branch IDENTICALLY; quiet, the branch is 30/30 three times.
  It accuses a live feature of being absent (the pdfposthoc "a probe that fails by luck" disease) —
  wait for the CONTENT, not the clock. Re-run it quiet before reading any verdict off it. Touch: hold-drag reorders the row
  (insertion semantics, FLIP previews) and hold-drag a ▲ entry ONTO a row slot to swap it in;
  desktop keeps HTML5 drag. During any drag the circle discs go opaque
  (`--iw-slot-drag-bg`; night token in the nightable block) so the lifted circle passes OVER
  neighbours.

## Working model (how these sessions run)

**`/root/dev/iw-master` IS A SHARED CHECKOUT. NEVER `git add -A` THERE (2026-07-17).** With 5–6 lanes
running, that checkout is a contended resource: other agents check their branches out in it and leave
work uncommitted in the tree. Both failure modes bit in one minute of one session:
- `git add -A` swept **1,276 lines of four other lanes' in-progress work** (waveVideo, goals,
  archiveWriteback, folder, onedrive) into a commit about a JSON key. Caught only because the gate
  went red on a stranger's unused import — i.e. **caught by luck, by an error in someone else's file.**
- Two commits landed on **`feat/prod-goals` instead of master**, because the tree had been switched
  underneath by the lane working there. `git status -sb` was never run; master was assumed.

The rules, in order of how much they'd have saved:
1. **`git status -sb` before every commit or push.** Never assume the branch. The checkout you started
   on is not the checkout you're standing in.
2. **Add named paths, never `-A`.** `git add CLAUDE.md`, not `git add -A`.
3. **Don't `stash` there** — you are stashing someone else's live work and popping it back blind.
4. **To ship, use your own worktree**, not the shared one:
   `git worktree add --detach /tmp/shipdesk origin/master` → cherry-pick → `pnpm install
   --frozen-lockfile` → gate → `git push origin HEAD:master`. A fresh worktree has no `node_modules`,
   so its first gate fails on that and it means nothing; install first.

The deeper rule: **the gate protects master, not your teammates.** It would have happily shipped a
commit that stole four lanes' work, because that commit was green. Nothing but this discipline stands
between a parallel session and a lane silently losing its night's work — the same loss the OPFS bugs
caused Peter, from the other direction.

**⚠ `set -e` IS SILENTLY IGNORED BY THE Bash TOOL'S SHELL — GATE WITH `&&` (2026-08-30).** Verified
directly: `set -e; false; echo REACHED` prints REACHED. So every gate written as
`set -e` + newline-separated `pnpm typecheck` / `pnpm test` / `pnpm build` + a final `echo GREEN`
reports success **whatever the exit codes were**, and I ran several of those and read them as proof.
An agent hit the same thing and caught it only by testing `set -e` against `false` on purpose.

This is the third shape of the same wound in two days, and the pattern is the point: **anything that
always succeeds, placed between the gate and the push, hides the gate.** The three were
`pnpm test | grep …` (grep exits 0 when it FINDS the failure lines), `pnpm typecheck; echo "tc=$?"`
(echo exits 0), and now `set -e` itself (inert here). Two broken commits were pushed this way.

THE ONE FORM THAT WORKS, because a failure short-circuits the chain rather than being reported by it:

    pnpm typecheck >/dev/null 2>&1 && pnpm test >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 \
      && git commit … && git push …

Nothing between the links. No `echo`, no pipe, no `set -e`. And `&&` short-circuiting was itself
verified here (`false && echo BAD || echo GOOD`) rather than assumed — which is the whole lesson.

**BACKTICKS IN `git commit -m` ARE COMMAND SUBSTITUTION.** A message written inline with
`-m "… `readJson` …"` runs `readJson` and splices its (empty) output into the message. Use
`-F <file>` with a heredoc for any message containing code identifiers — several commits this
session lost words that way.

**`git reset --soft origin/master` IN A WORKTREE WILL STAGE A REVERT OF OTHER LANES' WORK.** Two
agents independently hit this while tidying history: master had moved under them, so the reset
staged the *removal* of commits they had never touched. Both caught it in `git status` before
committing. Prefer `git rebase origin/master`; if you do reset, read `git status` before you commit.

**KEEP AT LEAST 5 AGENTS RUNNING (Peter, 2026-07-17 — a standing floor, not a target).** Whenever
there is work left on the specs, at least five lanes should be in flight. Peter has asked for this
repeatedly across sessions ("I want six working all the time", "agents running low", "where did all
the agents go?") because the bottleneck is his attention, not the machine: a lane that finishes while
he sleeps costs nothing, and an idle lane costs a night. Treat dropping below five as a bug in the
session, and refill without being asked.

Two exemptions, and only two:
- **No work left** that doesn't need him. An idle lane is correct when the remaining items are all
  blocked on his decisions or his devices.
- **Blocked on critical feedback from Peter** — a lane waiting on a decision only he can make (a
  product call, a key, a device test) should not be replaced by a lane inventing an answer. Say it's
  blocked and on what; do not spawn filler to hit the number.

The floor is five *doing real work*, not five processes. Never spawn a lane to satisfy the count.

**Capacity, learned the hard way:** 13 concurrent lanes OOM'd WSL2 at its 7GB default. `.wslconfig`
now allots 11GB + 8GB swap, and **6 lanes is the observed safe ceiling**. So the working band is
5–6. If lanes start dying, suspect memory before suspecting the code.

**STOP FLAGGING EVERYTHING — FINISHED FEATURES SHIP LIVE (Peter, 2026-07-18 — reverses the earlier default).** For most of this project the reflex was "build behind a default-OFF flag" — safe while a feature was half-built, but it hardened into gating *everything*, so Peter kept finding completed, tested features invisible unless he typed `?music`/`?prodLedger` into the URL. His words: *"Stop flagging everything"* and *"take all the flags off for music and everything."* New default:

- **A finished, tested feature SHIPS LIVE — no flag.** Don't reflexively wrap new work in a default-OFF flag; the default is that a writer sees it.
- **A flag is now the EXCEPTION and must earn itself** — only for work genuinely not ready (incomplete, experimental, blocked on an external dependency). It's a temporary scaffold, not a home: it comes with a plan to graduate, and the report says WHY it's not live and WHAT closes the gap.
- **Graduating ≠ flipping a switch on a stub.** Turn a flag on only when the thing behind it is real. `musicEnabled()`=true over a placeholder panel ships a stub to every writer — worse than the flag.
- **Genuinely-unfinished stay gated for now** (updated 2026-07-19): the wave video (`?waveVideo`,
  unresolved desync), the parked arithmetic layout (`?arithLayout`, held because the engine does not
  implement `8f5ae9d`'s mid-line snap and now diverges from the DOM measure on EVERY break — see the
  ⚠ entry in the iOS/WebKit section; the WebKit pass is no longer the first blocker), email send
  (`?email`, blocked on Google verification). Name the reason when you touch them.
  ~~The experimental scrub renderer (`?textRender`)~~ **GRADUATED 2026-07-18 (`ef96306`)** — see the
  "graduate textRender to default-ON" entry in round 14/15 of the canonical-pagination section below;
  it no longer belongs on this still-gated list.

The old blanket "**All flags stay default OFF**" line elsewhere in this file is superseded by this.

**NAME THE FEATURE, EVERY TIME (Peter, 2026-07-17 — a standing reporting rule).** He runs many lanes
at once and intends to keep parallelising aggressively, so a report that says "the model diverges" or
"the signature was stale" is unreadable: he cannot know which of a dozen in-flight features it means.
His words: *"you're gonna have to contextualise which feature you're discussing a bit more going
forward as I intend to keep aggressively parallising."* So every finding reported to him must open by
naming (a) the FEATURE in his words, not the module's ("the fast snapshot scrubbing", not
"`buildRenderModel`"), and (b) **the blast radius — is this live, or behind a default-OFF flag?**
That second half matters most: nearly everything built in these sessions ships dark, so "wrong words
on a page" in an unreleased renderer and "wrong words on a page" in his thesis are the same sentence
and utterly different news. Say which. The same applies to agent briefs — an agent that doesn't know
which user-visible thing it serves optimises the wrong axis.

Peter tests live on iPhone + desktop and reports in batches; work is delegated to parallel
isolated-worktree agents with precise briefs (root-cause first, no half-fixes), merged serially into
master from `/root/dev/Inkwave-perf` (Peter's own sessions use `/root/dev/Inkwave` — NEVER share a
checkout) with the full gate: typecheck (ignore pre-existing TS7016/TS2550 in test files), ALL tests,
build (gate on real exit codes — `| tail` swallows failures), then push (= production deploy).
Snapshot React state is METADATA-ONLY (`SnapshotMeta`; fetch full snapshots via `listSnapshots` at
action time — never hold contentJson in state). Autosave failures dispatch `inkwave:save-failed`.

**A GREEN GATE IS NOT A GUARD (2026-07-17, the test auditor's headline — read this before trusting
one).** The probe culture here ESTABLISHES truth superbly and has no mechanism for KEEPING it: a
`.prove.mjs` that ran once and convinced everyone is indistinguishable, six weeks later, from one
that never ran — and `pnpm test` says green either way. The measured facts in these file headers read
as guarantees; they are archaeology. Demonstrated on a real fix: reverting `textRender.ts`'s
leaf-atom rule (a bug MEASURED in the real app) left the full gate at exit 0 / 79 files green,
because its only guard was a hand-run browser probe. **So: for every claim you prove, ask whether a
cheap unit-level version can KEEP it true — if it is ~90ms and needs no browser, there is no
excuse.** The browser probes stay (they are the in-browser truth, and they catch what unit tests
structurally cannot); they are simply not guards. Corollary for reviewers: `git diff master..<branch>`
on a branch that is BEHIND renders enormous fictional deletions (one lane showed 18,393 deletions for
a real change of 3 files, +196/−11) — always diff `$(git merge-base HEAD origin/master)..HEAD`.

**Standing preferences (Peter, 2026-07-10):**
- **No browser windows over Peter's screen.** Agents running HEADED browsers (Playwright probes
  that need GPU/compositor accuracy) must never pop a window over his workspace: use
  `xvfb-run` (virtual display — headed semantics, zero visible window) as the default, or launch
  args `--window-position=-32000,-32000` as fallback. WSLg GOTCHA: xvfb-run alone does NOT contain
  Firefox — WAYLAND_DISPLAY routes it to the host compositor; use
  `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0 xvfb-run …`. The wrapper **`scripts/pw-headed.sh`**
  bakes this in (unsets WAYLAND_DISPLAY + MOZ_ENABLE_WAYLAND=0 + `xvfb-run -a`) — run any headed
  browser/Playwright command through it (`scripts/pw-headed.sh <cmd>`) and nothing pops on Peter's
  screen. Root cause: WSLg exports `DISPLAY=:0` + `WAYLAND_DISPLAY=wayland-0`, so a headed browser
  forwards its window to Windows; the wrapper contains it. Prefer HEADLESS outright where fidelity
  allows — WSL has no GPU, so real raster/paint fidelity needs a real device regardless. SHARED-BOX
  RULE: never `pkill -f "vite preview"` (it kills OTHER agents' servers — caused a phantom 'editor
  won't mount'); use a dedicated port + kill your own PID only. Headless remains the default where
  fidelity allows. Agent briefs that ask for headed runs must say this.
- **Notifier (task #27, pending):** final reports start with the sentinel "📋 REPORT" so Peter's
  PowerShell hook can either FILTER to reports only, or keep all toasts but play a DIFFERENT SOUND
  for report messages (his preferred option) — audibly distinct without looking. RATIONALE (Peter):
  best of both worlds — when he's focused on development he keeps feeding agents on the ordinary
  toasts; when he's focused elsewhere (writing) he responds only to the significant sound. The
  two-tier cadence is the general model for working with him. Until the hook is updated, keep
  interim turns content-free anyway.
- **Batch the reporting — protect Peter's focus.** He writes (thesis/essays) while agents run;
  every notification breaks his concentration. Do NOT ping per-merge: merge each through the full
  gate as it lands with a bare non-message turn-ending, and send ONE consolidated report when ALL
  agents are done. Default to the quietest possible cadence unless he's actively testing.
- **Keep agents alive with their memories intact — always.** Never discard an agent's context:
  resume completed/failed agents via SendMessage (their transcripts restore full context) instead of
  spawning fresh ones for follow-ups in the same domain; salvage worktrees + transcripts when an
  agent dies (spend limits, filters); preserve agent worktrees until their work is merged.

## Theming / colour schemes (MANDATORY for every new panel — 2026-07-07)

Night mode (and future colour schemes) is driven by ONE switch: `src/editor/theme.ts` sets
`<html data-theme="night">` (applied pre-hydration in `entry.client.tsx`; toggled from Settings). All
colours live as CSS custom properties in the **NIGHT MODE block at the bottom of `src/styles/index.css`**
— never scatter per-component night overrides. Adding a new scheme later = one more `:root[data-theme="…"]`
block; components don't change.

**THE RULE — every floating panel/menu/modal MUST:**
1. Put `iw-nightable` on its outer container (alongside its `bg-white`/`shadow` classes). That class opts
   it into the themed surface: dolphin-grey background, light text, themed inputs/borders, dark hover
   fills — all automatic. This is the single most important step; a panel without it renders white-on-
   white in night mode.
2. For any CUSTOM inline colour, use a theme **token var with a day fallback**, NOT a hard-coded hex:
   - `var(--iw-ink, #5c2d8a)` — primary purple text/icons
   - `var(--iw-light, #9b5ccc)` — lighter purple accent
   - `var(--iw-cite-color, #5c2d8a)` — citation/link colour (light blue in night)
   - `var(--iw-pill-fg, #78716c)` — muted label/pill text
   - `var(--iw-nightable-border, …)` — inline borders (light in night)
   - `var(--iw-verified, #15803d)`, `var(--iw-newbtn-fg, …)`, `var(--iw-addbtn-*)` — specific accents
   Define a NEW token in the night block when you need a new custom colour — don't inline a night hex.
3. The `.iw-nightable` block already remaps Tailwind `text-stone*/gray*/neutral*`, `bg-white`,
   `border-stone*`, `hover:bg-stone-50/100`, inputs/selects, and any `[class*="5c2d8a"]`/`[class*="9b5ccc"]`
   arbitrary purple class. So plain Tailwind utility panels theme themselves once they have `iw-nightable`.

Panels already migrated: MediaMenu (`components/MediaMenu.tsx` — the toolbar's media-import slot:
photo/audio/video; PORTALED, so it carries `iw-touch-guard` + `iw-nightable` itself rather than
inheriting them), CitationPanel + EditDialog, ReceiptPanel, SyncStatus, footer toolbar,
OptionsMenu (+ its export modal), SettingsMenu, PageMenu, LimitSelector, StyleBar popups, ReviewBar,
VerifyModal, AccountControl, the Google-Drive/OneDrive pickers + openers, the PDF find bar,
ProductivityReportModal, ProductivityPanel (`/productivity` the route is GONE since 2026-07-18 —
panel-ified, opened from the clock drop-up), the ledger CLOCK DROP-UP restructured 2026-07-19 into a
5-button nav shell (`components/ClockMenu.tsx` — the toolbar's clock slot; `/ledger` the route is
gone; its READING indicator + POST-HOC ADD sections are inside it, screenshotted day+night by
`scripts/pdfposthoc.prove.mjs`), OpfsInspector (`components/OpfsInspector.tsx` — the hamburger's "Storage" item: every
document actually in OPFS, with orphan/this-tab/busy badges + Open/Download recovery),
EmailComposePanel (+ its provider drop-up), LessonPanel (`src/music/lesson/`, flag
`?lesson`, DEFAULT OFF — its three screens: consent gate, bar-pinned notes, teacher recap),
MusicPanel + ScoreView (opened via the toolbar's ♪ bar as "Import a score" — the `/music` route and
its `?musicXml=1` param are GONE since 2026-07-18; the music module itself is DEFAULT ON since
2026-07-19), the music studio (`music/MusicStudio.tsx` — its footer toolbar + symbol drop-up carry `iw-touch-guard`,
`music/ScorePage.tsx` gap bands + sticky notes, `music/HeatmapScreen.tsx` bar rows + its palette
drop-up). When you add a panel, add it here too.

**RENDERED NOTATION CANNOT USE var() — which is why it needs MORE care, not less (2026-07-17).**
`src/music/theme.ts` + `ScoreView.tsx`: OpenSheetMusicDisplay GENERATES the notation SVG and its
engraving rules accept only concrete `#rrggbb` strings, so the charts' trick (write `var(--iw-ink,
#5c2d8a)` straight into a `fill` and let the night block remap it) is UNAVAILABLE — a `var()` handed
to OSMD is written into the SVG verbatim and renders nothing. So the colours still live ONLY as
tokens (`--iw-score-ink/cursor/paper/highlight/title`, defined in BOTH themes in index.css) and
`theme.ts` RESOLVES them against the live DOM at draw time; a `data-theme` MutationObserver redraws
the score on a theme switch, because a baked-in colour cannot restyle itself. TWO TRAPS: (1) the
night palette is declared `:root[data-theme="night"] .iw-nightable { … }` — SCOPED to that class,
NOT on :root — so a score container missing `iw-nightable` silently reads every day fallback and
renders black on a charcoal page, with no error at all; (2) jsdom does NOT resolve custom properties
from a stylesheet, so a "the night colour applies" unit test reports the DAY value in both themes and
PASSES while proving nothing. `theme.test.ts` therefore checks three independent things: no bare hex
in the TS, every token defined in both themes *with different values* (read off index.css itself, not
off jsdom), and the resolver's own fallback logic. Whether the two palettes are LEGIBLE is unverified
— that needs eyes on a browser.

**Component tests are possible now (2026-07-17).** `vite.config.ts` drops the React Router plugin
under vitest (`process.env.VITEST`): its HMR preamble check made every `render()` throw "React Router
Vite plugin can't detect preamble", which is why this repo had 86 `.ts` test files and not one
component test. Verified it changes nothing else — all 87 pre-existing files still pass. Two gotchas
for the next one: `@testing-library/react` only auto-cleans with `globals: true` (this repo does not
set it), so `afterEach(cleanup)` is MANDATORY or every test silently measures the previous test's
still-mounted components (it inflated a re-render count from 2 to 4 here and read as a component
bug); and in a `.tsx` file `vi.mock`'s factory is hoisted above vitest's OWN import, so `vi.hoisted`
and `await import('vitest')` both fail — build the recorder inside the factory out of plain
functions (see `ScoreView.test.tsx`).

**Charts must theme too (2026-07-17).** `src/productivity/charts/` proves the pattern for SVG: every
`fill`/`stroke` is a token with a day fallback (`var(--iw-ink, #5c2d8a)`), never a bare hex, so the
night block remaps them for free — `judged.test.ts` asserts that structurally (a bare hex in
SERIES_STYLE fails the build). Verified both themes render distinctly: panel bg #fff → #454e59,
`--iw-ink` #5c2d8a → #cbb8f2.

### THE READING SURFACES HAVE THEIR OWN NIGHT — and the paper-never-inverts rule is RETIRED (2026-08-30)

**LIVE, default-on.** The in-app source reader (`SourceBrowser.tsx`) and the PDF reader view
(`PdfReaderView.tsx`). Peter, verbatim: *"the whole read mode on both pdfs and web pages needs a
night mode too — but make sure the palette is slightly different from the main page and there's a
dividing line between."*

**THE RULE THAT WAS THERE — and why it was conflating two things.** The 2026-08-30 morning audit had
established that the reading column is PAPER: it *dims but never inverts*, on the argument that a
mark's colour is stored in the mark and shared with the PDF viewer, so a theme that reinterpreted it
would make one highlight two colours on two devices. That argument protects a real invariant and it
is still true — but it was being applied to two different things at once:

* a mark's **IDENTITY** — its stored hex. Unchanged, in both themes. `#ffe066` is still `#ffe066`;
  there is no per-theme remap of any mark fill anywhere.
* the **CONTRAST PAIRING** it needs to stay readable — what ink sits ON it. That has always been a
  function of the surface. It merely *looked* like a constant while the surface never changed.

A highlight is an opaque **FILL** of a pale colour with text on top, so the ink on it is dark
whatever the page behind is doing (`--iw-reader-on-mark`, whose DAY value is byte-equal to the day
paper ink — so nothing about the day rendering moved). At night a highlighted run becomes an island
of day inside the night page, which is what a highlighter looks like on paper. MEASURED, real
browser, real mark placed through the real UI: fill `rgb(255,224,102)` in **both** themes, ink
10.96:1 day / 12.31:1 night.

**THE ONE GENUINE CASTING, and it is a STROKE not a fill.** The writer's own coloured text
(`TEXT_COLORS` — maroon/navy/green/ink) is a stroke: its colour IS the readable element, and those
inks were chosen for white paper. Maroon on the night reading page measures ~1.5:1, and **no choice
of dark surface fixes it** (4.5:1 against that maroon needs a mid-tone page, which is not a night
mode). So the three get tokens on exactly the footing `--iw-ink` has always had — dark by day, light
by night — and `src/reader/markInk.ts` `readerInk()` maps stored → token for **display only**.
Nothing is ever written back; an unknown colour passes through untouched; the output always carries
the stored value as the `var()` fallback.

**THE PALETTE.** Night reading paper is a WARM charcoal `#26241f` against the editor's own night
page `--iw-paper: #2c2e35` (cool blue-grey) and the chrome's `#454e59`. Same value range, different
temperature — so the panel reads as a *different document* at a glance rather than as more app,
which is Peter's "slightly different from the main page". Measured page↔editor contrast 1.20:1:
near enough to still read as a page, distinct enough not to be one wash.

**FOUR REAL BUGS, all measured, none of which the contrast gate could see:**

1. **`--iw-panel-bg` IS DECLARED NOWHERE IN THIS REPO**, and `SourceBrowser`'s markup bar read
   `var(--iw-panel-bg, #faf8fc)`. So the bar painted its near-white fallback **byte-identically in
   both themes** — a white slab glued to the bottom of a night reading column — and no amount of
   work on the token block could ever have reached it. Only `PdfReaderView` had been migrated to
   `--iw-reader-bar`; the web reader was left behind while the CSS comment claimed both were done.
   **This failure is SILENT BY CONSTRUCTION: a `var()` with a fallback always renders something.**
   That is Peter's *"the bottom bar's fonts are washed out"* — chrome rescues
   (`[class*="text-stone"]` → `#dfe3e9` at ~1.2:1, `--iw-verified` → `#6ee7a0`) painting near-white
   labels onto a near-white bar. KEPT by a sweep in `readerContrast.test.ts`: every `var(--iw-…)`
   either reader reads must be DECLARED in index.css.
2. **THE ENABLED BACK ARROW WAS THE LITERAL `#5c2d8a` ON THE NIGHT HEADER — 1.13:1, invisible** —
   and **nothing had ever scored it**, because with a one-entry history both arrows are `disabled`
   and WCAG 1.4.3 exempts a disabled control. The probe now NAVIGATES first, which is the only way
   the exemption stops covering it. (Its *disabled* colour measured 5.67:1 — **brighter than the
   enabled one beside it**. Backwards in both directions at once.)
3. **THE DIVIDING LINE ALREADY EXISTED AND COULD NOT BE SEEN.** `dockLayout.ts` drew
   `1px solid #5c2d8a33` — a 20%-alpha DARK purple, which over the night panel composites to very
   nearly the panel itself. `PdfSidePanel` carried a second copy of the same literal. Both are the
   token now. **`.iw-nightable { border-color: … !important }` beats an INLINE border**, so the
   token needed `.iw-dock-panel` to win at night — measured: the panel read `rgb(92,102,114)` (the
   chrome border) with `--iw-reader-divider: #7b8494` declared, i.e. the token was inert. A dock
   panel MUST carry that class.
4. **THE HIGHLIGHTER TOOL'S GLYPH `#8a6a04` died on the night control face (2.37:1)** — found by
   the new unit guard, not by Peter. Cast through `readerInk` like the other strokes.

**AND THE WASH HAD TO GO OPAQUE AT NIGHT.** `PdfReaderView`'s `wash()` faded a highlight to 55%
alpha because *"a solid fill over body text is unreadable"* — true only while nothing set the ink ON
the fill, which the source reader has always done. Over the night page that wash composites to
`#9d8b46`, a muddy olive: it *passes contrast* against a dark ink and **it does not look yellow**,
which is precisely the thing Peter asked us not to break. So the strength is a token
(`--iw-reader-wash`: 55% day, 100% night) applied in CSS via `.iw-mark-fill`, with the opaque
declaration as the `@supports` fallback so an engine without `color-mix` degrades to what the other
reader already does rather than to no highlight at all.

**WHICH SURFACE A CONTROL SITS ON IS THE WHOLE QUESTION**, and getting it wrong produced *both* of
Peter's complaints simultaneously, in opposite directions. The reader panel is not one surface: its
HEADER is chrome (`--iw-reader-chrome-fg`/`-dim`), while its ARTICLE, its MARKUP BAR and every
control face in that bar are reader PAPER. Ask first, then take that surface's token. The error
screens are the awkward case — they render inside a pane that is reader paper in reader mode and the
chrome panel in live mode, decided by a prop — so they take the one ink measuring ≥4.5:1 on **both**.

**GUARDS (the browser probe is the truth; it is not a guard).**
`pnpm prove:nightaudit` now measures what the pixels ARE, not merely whether they clear a ratio —
because **the walker ran 0 failures in BOTH themes on the build Peter complained about**. Contrast
is the floor. It reads the surfaces back, navigates so the arrows are live, places a REAL highlight
and reads its fill and ink, and checks the edge that actually faces the editor.
`src/styles/readerContrast.test.ts` (32 tests, ~22ms, no browser) carries the pure half —
**mutation-proved, 5 mutants, all die**: revert the paper (8 fail) · mark ink inherits the page (1) ·
chrome-fg back to `--iw-ink` (1) · the undefined token returns (1) · inks not cast (1).
`markInk.test.ts` (6) and the `dockLayout.test.ts` divider pair (mutant dies) complete it.
⚠ The dangling-token sweep **STRIPS COMMENTS**, and its first cut fired on its own documentation —
the fix's comment in SourceBrowser SAYS `var(--iw-panel-bg, …)` in order to forbid it. Judge what
the code DOES, never prose about it; the pair (fires on a use, silent on a mention) is asserted.

**WHAT NEEDS PETER'S EYES.** The casting of his coloured *text* is the one place a stored mark
renders as a different colour by theme. It follows the app's own `--iw-ink` convention exactly and
touches no highlight, note or textbox — but it is his call whether a maroon annotation reading as a
light red at night is right, or whether that palette should instead be re-chosen to work on both.

## Load performance (KEEP STARTUP FAST — hard-won, 2026-07-06)

A big doc (thesis + embedded PDFs, ~20 MB `.studio`) was lagging ~10s on every load / hard refresh.
Root causes were NOT file size — they were background work on the critical path. What was wrong + the
rule that keeps it fast (measure with a `PerformanceObserver` `longtask` logger + `performance.now()`
timers; the main thread only blocks ~1.5s now):

- **Clerk loaded on every free-tier page.** Its dev-instance init (network handshake + hidden iframe +
  token polling) churned for seconds. M6 auth is dormant, so `authEnabled()` now requires an explicit
  sticky opt-in (`?auth`; `?auth=off` clears) and `entry.client` only mounts `ClerkProvider` then. Do
  NOT mount auth for the free tier. See `src/auth/config.ts`.
- **OTS sweep ran on every load (~10s).** `drainUnstamped` + `upgradePending` re-write the compressed
  snapshot file PER snapshot and do serial calendar round-trips. Bitcoin confirms over HOURS, so this
  must NOT run on load — it runs only when the ReceiptPanel OPENS (`onOpened` → `runOtsSweep`), only if
  something is unstamped/pending, throttled once per 15 min (`inkwave:otsCheckedAt:<docId>`). New
  snapshots still stamp on creation; "check Bitcoin" forces it.
- **Multi-device heartbeat read+JSON-parsed the whole 20 MB file** on load AND every 45s. Now
  `readLocalHeartbeat` compares the File's `lastModified` to our recorded last write — metadata only,
  and (2026-07-08) `readRemoteHeartbeat` does the same via a Graph metadata GET (`getRemoteFileInfo`),
  no content read.
- **`blobToBase64` built a 20 MB string + `btoa` on the main thread** every save. Now native
  `FileReader.readAsDataURL` (off-thread) + a per-PDF base64 cache keyed by `pdfVersion` (bumped on
  save/delete), so unchanged PDFs are never re-encoded.
- **The grow-only snapshot union re-read the whole file on every write-back.** Now once per session per
  target (`needsWritebackMerge`/`markWritebackMerged` in `snapshots.ts`).
- **DON'T lazy-defer the snapshot LIST.** Rapid snapshot scrubbing is a core moat, so `listSnapshots`
  loads EAGERLY on doc open (deferring it made the first snapshot open lag). Only defer/gate the
  genuinely-not-needed-for-first-frame work (OTS), never the list.

Rule of thumb: nothing that reads/parses/encodes the whole `.studio` or hits the network per-snapshot
may run synchronously on load. Stamp on creation, sweep on demand, cache encodes, read metadata not
bodies.

- **Canonical measure block-line cache (2026-07-11 — THE desktop "waves of lag" fix).** The
  measure's per-line range.getClientRects walk over every block cost 1.5-4s on a 20k-word doc
  (4×-throttled probe) at every 150ms desktop typing pause. collectLines now caches each block's
  lines RELATIVE to its own top, keyed by PM NODE IDENTITY (WeakMap — persistent structures:
  untouched block ⇒ same node ⇒ same canonical geometry); an edit re-measures only changed blocks
  (measured: 133-277ms, ~15-20×). INVARIANTS: replace the WeakMap whenever the canonical CONTEXT
  changes (fonts ready/loadingdone, page settings, bibliography hydration — clearLineCache sits
  beside clearStepCache at those sites); never pass the cache for fluid 'scroll' paper (its
  canonical width is the live width); cache reads/writes only on the gap-cleared measure.
- **Editor mounts ONCE per load (2026-07-11 double-mount fix).** TiptapEditor must mount in a
  default-lane render — React.lazy/Suspense retries render at TRANSITION priority (time-sliced),
  and @tiptap/react's in-render editor creation + its 1ms scheduleDestroy timer race across the
  slices: two ~950ms creations + the whole reveal chain doubled. Edit.tsx holds the eagerly-
  imported module in STATE (no Suspense) — do not reintroduce lazy/Suspense around the editor.
- **Keydown-synchronous typing (task #28, 2026-07-11).** editorProps.handleKeyDown dispatches
  plain printable keys synchronously (handleTextInput someProp first — input rules identical to
  the native path; storedMarks via tr.insertText). Flag 'inkwave:kdSync': unset = ON for
  non-touch, OFF on touch (never intercept the virtual keyboard/autocorrect). Guards: no
  modifiers, no composition, no open word-cycle, TextSelection only. Measured (4× throttle,
  20k words): median keydown→paint 80ms → 48ms. perflog label: kd-sync.
- **Enter-caret reveal (2026-07-11).** PM's scrollIntoView IGNORES CSS scroll-padding — Enter
  scrolled the new empty line to the scroller's raw bottom edge, exactly behind the toolbar
  reserve; the caret "appeared when you type" because the browser's native caret-reveal DOES
  honour scroll-padding. The toolbar RO now mirrors the reserve into PM's scrollThreshold/
  scrollMargin (view.setProps) — keep them in sync with any new floating bottom chrome.
- **Twinkle wake needs SUSTAINED scroll (2026-07-11).** A parked dash field only wakes on two
  scroll reports within 200ms — a single caret-reveal scroll nudge (typing at the page bottom)
  must never wake the WAAPI field (it read as full-rate velocity and woke everything per wrapped
  line).
- **Desktop scroll: --wave-x must never invalidate the page subtree (2026-07-11 ablation).** The
  per-frame sway write of the INHERITED custom prop on the surface recalced the whole 100-page
  subtree: scroll frames p50 417ms → 50ms at 4× throttle once (a) `.iw-magnify-box`/`.scroll-paper`/
  `.iw-wave-twinkles` pin `--wave-x: 0px` (constant ⇒ the engine's no-change pruning stops the
  walk; @property inherits:false was cleaner but WebKit never re-resolves a pseudo's explicit
  `--wave-x: inherit` — frozen sway) and (b) twinkle fields take LITERAL transforms per sway frame
  (`swayFields`) instead of consuming the var (kept ~300 instance leaves in the invalidation set).
  Dash respawns NEVER rasterise now (the 140-lattice relocation runs everywhere — toDataURL on the
  scroll path was the second ablation cell, ~150ms/frame; the boot respawn gate became moot and was
  deleted). A new var(--wave-x) consumer must not sit under the firebreak roots.
- **Zoom step-cache precompute waits for GENUINE idle (2026-07-11).** Each precompute step is a
  full-document hypothetical reflow (~100-200ms of layout on a long doc); it used to start 350ms
  after the mount measure — ~18 consecutive long frames exactly while the reveal/coast and the
  writer's first scrolls ran (the post-open jank). PaginationExtension now also holds it while any
  input (pointer/wheel/key/scroll, 1.5s) or reveal-chain event (open-begin/reveal-imminent/
  editor-revealed, 3s) is recent. A cold cache stays CORRECT — onZoomStep measures a miss live.

## Typing performance invariants (2026-07-11 ablation overhaul — measure before touching)

Established by a CPU-throttled Playwright ablation matrix (4× Chromium desktop+phone emulation,
2.5× cgroup-quota WebKit, 100-page synthetic .studio with citations + seeded SCAS state; cells:
baseline / scasOff / gapped-off / both-off / review). Harness pattern: keydown→rAF latency +
longtask observer + `inkwave:perflog=1`; doc injected via `inkwave:open-doc`. Findings + the rules
that keep them fixed:

- **`shouldRerenderOnTransaction: false` on useEditor must stay.** @tiptap/react's legacy default
  re-rendered the entire TiptapEditor tree on EVERY transaction (keystroke, caret move, SCAS
  repaint, pagination meta) — the largest single per-keystroke cost. Consequences: the render body
  must NEVER read `editor.state`/`editor.isActive` — mirror what it needs into React state from an
  editor-event subscription (`selectionEmpty`, `selIsAtomNode`). StyleBar force-updates for its
  isActive states only while `barVisible`; ReviewBar/CommentNotes self-subscribe (mounted only in
  review mode).
- **The pagination measure must never do per-line hit-tests.** collectLines carries each line's
  sample coords and resolves doc positions LAZILY (only the ~1 line per page a break lands on pays
  `posAtCoords`); block boundaries come from ONE `posAtDOM` per top-level block (atoms keep the
  old per-line orphan reset). The eager version was ~4,400 hit-tests per measure = 2.4s (desktop
  4×) to 17–31s (phone emulation 4×) of main-thread freeze per measure — the phone "terrible"
  report. Break positions are identical by construction (same sample formula, same snap/orphan/
  refList decisions).
- **The pagination ResizeObserver folds into the edit debounce on BOTH platforms** (rule (b) had
  regressed to desktop-immediate): in UNGAPPED mode nothing pins the sheet height, so every
  line-wrapping keystroke resized the sheet → immediate full canonical measure DURING typing —
  which made gapped-OFF measurably WORSE than gapped-on (the ablation's surprise: Peter's "is it
  gapped pages?" answer is "the measure, in both modes; ungapped was worse").
- **SCAS scans ride the per-paragraph WeakMap cache** (`scas/controller.ts` scanCommitted): words
  are position-free and per-paragraph pure (persistent PM nodes), the cursor's paragraph is never
  cached, and the full-scan SEMANTICS (deletion pass sees whole-doc presence) is preserved — it's
  assembled from cached arrays. Desktop stays a semantic full scan; don't undo the cache.
- **All citation doc-walks go through the memoised per-doc citation index** (`citationNav.ts`
  citationNodes): occurrencesAt/occurrenceCounts/occurrenceQuotes/citedPages. Before: 34 node
  views × O(doc) walks per 350ms typing pause. Node-view rebuilds must NOT call `editor.getJSON()`
  — `referenceListKeysFromDoc(editor.state.doc)` walks the PM doc directly.
- **Word count runs only while the ◈ panel is open — both platforms** (ReceiptPanel is controlled
  everywhere now); desktop was building the full doc string every 300ms of typing for a hidden
  number.
- **Residual (known, next target):** with SCAS decorations on, the steady-state keystroke cost is
  now dominated by ProseMirror DecorationSet MAPPING/redraw — O(decorated words) per transaction
  (CPU-profiled: forChild/posBeforeChild in the PM chunk). ~2,600 decorated words ⇒ ~22ms real per
  keystroke on a 4×-throttled desktop. The fix is viewport-windowed decoration RENDERING (verdict
  state stays doc-wide; only visible ranges get Decoration objects) — not attempted this round.
- **Scroll-frame budget:** desktop scrolling of a long doc showed 300–900ms frames in ALL ablation
  cells (phone was fine) — desktop-only per-scroll-frame work: the `--wave-x` sway write
  (unregistered inherited custom property on the surface → subtree style invalidation) and the
  waveTwinkle scroll-driven dash respawns (canvas PNG encodes). Owned by the wave/choreography
  lane; attribute before optimising (probe pattern: stub `setProperty('--wave-x')` /
  `toDataURL` in-page and compare frame times).

## Code map

```
app/                                   # React Router v7 framework layer (thin; imports from src/)
  root.tsx                             # document shell (<html>/<head>), <Meta>/<Links>, fonts, global CSS
  routes.ts                            # route config: index('routes/home.tsx') + 'about'
  routes/home.tsx                      # '/' = the editor (renders <Edit/>) + SEO meta()
  routes/about.tsx                     # '/about'
  entry.client.tsx                     # hydrateRoot + service-worker registration + build marker
src/
  routes/Edit.tsx                      # loads/creates the active doc; renders the shell until it loads
  editor/Scroll.tsx                    # shared scroll-paper chrome + EmptyEditorSurface facsimile (CSS-function shell)
  types/document.ts                    # InkwaveDocument, Snapshot, ProvenanceEvent types
  editor/
    TiptapEditor.tsx                   # editor surface, scroll-head chrome, footer, prefetch
    extensions/RedHighlightExtension.ts# PM plugin: red decorations + hint badges + line compression
    suggestions/
      thesaurus.ts                     # Datamuse lookups, in-memory cache, form-matching (sp=)
      textMetrics.ts                   # canvas text measurement
      CycleHintPanel.tsx               # the j/k/space/tab/esc hint strip
      ThesaurusPopover/                # the word-cycle UI (split into focused modules)
        ThesaurusPopover.tsx           #   events (keyboard, pointer, outside-tap) + render
        usePopoverLayout.ts            #   cycle state + openCycleForElement + compression dispatch
        popoverGeometry.ts             #   posOf, measureNaturalLineRight, computeLineCompressionRange
        popoverFallbacks.tsx           #   buildSynonyms, displayFor (⌫)
        popoverConstants.ts            #   CYCLE_SIZE=8, DELETE_SENTINEL, CycleState type
  scas/
    stems.ts                           # getStems — candidate base forms (all that survives of ranking.ts)
    compliance.ts                      # accepted/(accepted+ignored) ratio, React context
  data/wordFrequency.ts                # ~30k-word Norvig/Google list (one big string[])
  storage/
    opfs.ts                            # document persistence (OPFS)
    indexeddb.ts                       # {id,title,updatedAt} metadata index for fast listing
  components/LimitSelector.tsx         # the N selector (500–5000 or infinite)
```

## Non-obvious conventions & invariants (READ BEFORE EDITING)

- **SCAS must never retroactively re-flag committed text.** In the engine model
  (`scas/engine.ts` — the Week-2 per-paragraph `ranking.ts` vocab model was deleted 2026-07-08,
  only `getStems` survives in `scas/stems.ts`): verdicts FREEZE at commit, so S_v rotation never
  reflows committed text; delete a kicked word → it locks. This is the single most important
  behavioural invariant — preserve it.
- **Enter = new paragraph; Shift+Enter = hard break.** Standard Tiptap/StarterKit
  behaviour (the inverted `enterBehavior` extension was removed so paragraph spacing works
  on Enter-separated text, not only pasted content).
- **The word-cycle replaced the original dropdown popover.** Don't reintroduce a dropdown.
  Cycle slots: index 0 = the original word, 1–6 = synonyms (cycled if Datamuse returns
  fewer), 7 = ⌫ delete sentinel. j decrements index, k increments; current sits in the
  middle row, prev above, next below.
- **No vocabulary filter is applied to suggestions** — all Datamuse candidates are shown
  and the writer decides fit (a deliberate Stage A decision).
- **Line compression** (`computeLineCompressionRange`) tightens letter-spacing around a
  focused word to absorb its min-width expansion *in place*, so the popover doesn't reflow
  the paragraph. This is fiddly, pixel-measured, and has had many regression fixes — change
  it carefully and test wrapped lines + first-word-on-line cases.
- **Provenance events** funnel through `compliance.ts` (accept/ignore). (The unused
  `appendEventLog` stub was deleted 2026-07-08; the provenance record is snapshots +
  signed receipts.)
- **Document IDs are stable UUIDs** — they become room identifiers in the future room
  model (Phase 2+). Don't change the ID scheme.
- **Tests exist and must pass** — `pnpm test` runs ~35 vitest files (~400 tests) covering
  scas engine/pool/stems, provenance (hash/receipts/cadence/session-auth), verify, and
  citations. UI/storage/sync are the untested areas — extract logic there before relying on it.

## Style

Match the surrounding code: terse purposeful comments explaining *why*, section dividers
(`// ─── … ───`), single-responsibility modules. Calm visual identity: ink/purple
(`#5c2d8a` / `#9b5ccc`), parchment/cream, serif body (IM Fell DW Pica / EB Garamond).
Commit messages: `feat:` / `fix:` / `refactor:` prefixes, present tense.

## The specs are IN THE REPO (2026-07-17) — `docs/specs/`

Peter: *"yep commit the specs. **Academic integrity not an issue there.**"* The old rule — *"read it, never
copy it into the repo"* — was MY over-caution and it was wrong. His thesis-integrity boundary is about
**his prose**, never his product decisions.

**Why it mattered:** an auditor measured **900 § citations across 60 distinct anchors, and ZERO of the 60
were defined in the repo** — 30 appear nowhere at all. Every rule this codebase enforces was traceable
only to another agent's comment about it. A lane went to verify its own load-bearing quote and couldn't;
when it finally read the source, the **full line was stronger than the ellipsis it had been quoting**.
The most-cited authority was the least verifiable artifact.

- `docs/specs/Inkwave-Productivity-Email-BuildSpec-v0.2.md` — the productivity + email layers
- `docs/specs/Inkwave-Music-Module-BuildSpec-v0.1.md` — the music module

**§ citations are now checkable. Check them.** And note the versions (`v0.2`, `v0.1`): of 900 citations
exactly ONE named a version. Cite the version when the anchor is load-bearing, or a spec edit re-points
your comment silently and nothing detects it.

**Peter's prose — thesis, essays, real documents — still NEVER enters the repo, fixtures, logs, or
screenshots.** That boundary is unchanged and absolute. This was never that.
