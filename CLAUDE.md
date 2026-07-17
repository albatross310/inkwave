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
  `storage/folder.ts` (File System Access). All three write the self-contained `.studio` bundle.
  **INVARIANT — snapshot history is grow-only:** every write-back MUST union with the target's
  existing snapshots first (`mergeSnapshots` in `provenance/snapshots.ts`) so a short local set
  (fresh login / cleared data / a save racing ahead of restore) can never TRUNCATE the archive.
  This was a real data-loss incident (2026-07-05). `restoreSnapshotsFromBundle` also unions.
- **THE DOCUMENT BODY IS NOW GUARDED TOO (2026-07-17) — the 07-15 incident, and it destroyed real
  thesis work.** The grow-only rule above protected the snapshot ARCHIVE and *nothing protected
  `current.json`*. That asymmetry ate a day of Peter's honours-proposal annotations. TWO silent
  failures in sequence, both now fixed, both with live known-negatives:
  - **The swallowed READ (11:19:40).** `opfs.ts readJson` ended `catch { return null }`, so a
    transient failure was **indistinguishable from "no such file"** — and Edit.tsx answers null by
    falling through to `newDocument()` **and repointing the active-doc pointer at the blank**
    (measured: doc `978e0772`, createdAt == updatedAt, 0 chars). **The defect was not the missing
    log — the TYPE erased the difference.** Now `readJson` returns null ONLY on `NotFoundError` and
    throws **`StorageReadError`** otherwise (a corrupt JSON parse counts as a failure, not an
    absence); `newDocument()` is **reachable only from absence, never from an error** — and if any
    read failed while walking the index, init throws rather than concluding "you have nothing".
    A failure renders **`StorageUnavailable`** (never a blank page — the blank page is what sent him
    to a backup file) with Reload + the Storage inspector inline. NB the same file already insisted
    **writes** stay loud; the read path was the silent half.
  - **The blind OVERWRITE on open (11:30:18).** `openDoc.ts` takes the id FROM THE FILE, stamps
    `updatedAt: now`, and called `saveDocument(doc)` — an unconditional whole-file replace. He
    opened a stale `.studio` (07-10 file carrying 07-08 content) to recover from the blank and it
    replaced Wednesday's work (proved: stale export and the `current.json` written that instant hash
    identically, `ce421bc5…`). **The read bug CAUSED the open that triggered the write bug.**
    Now `storage/openConflict.ts` `classifyOpen` decides by **ANCESTRY, never `updatedAt`** (this
    path stamps `updatedAt` to now, so a stale file arrives looking brand new): if the incoming
    contentHash is in the LOCAL snapshot archive the file is a PAST STATE ⇒ `incoming-stale` ⇒ keep
    the local body untouched (its snapshots still merge in — pure gain). Local in the incoming
    archive ⇒ `incoming-newer` ⇒ a legitimate sync-down, adopt. Neither, ambiguous, **or the local
    read failed** ⇒ `diverged` ⇒ open as a SEPARATE document, nothing overwritten, no cloud binding
    for the copy. **The two bugs compose**: a null-on-failure read makes `localHash` null ⇒
    `incoming-newer` ⇒ blind overwrite, so the read fix is load-bearing for this guard.
  - PROVED, both engines incl. Firefox (Peter's), control-vs-fixed in ONE build:
    `scripts/openguard-probe/repro.mjs` (`__iwOpenGuard='off'` ⇒ destroys the later work;
    on ⇒ `verdict=incoming-stale`, 1 doc, work survives) and `blankdoc.mjs`
    (`__iwReadGuard='off'` ⇒ blank doc minted + pointer moved; on ⇒ pointer untouched, nothing
    minted). Unit keepers `openConflict.test.ts` — **mutation-tested** (drop the stale clause / move
    the ambiguous clause after the directional tests ⇒ named tests fail).
- **Per-tab document identity (2026-07-17).** `storage/tabDoc.ts`. `inkwave:activeDocumentId` was
  ONE localStorage slot **for the whole origin**: every tab wrote it, every tab read it on boot, so
  one tab's document switch silently re-pointed another, which adopted it on its next reload —
  leaving the first tab's work orphaned on disk (intact, unreachable). **sessionStorage is the
  carrier, NOT the URL**: OneDrive sign-in is `msal.loginRedirect` with
  `redirectUri: window.location.origin` — it returns to a BARE `/` and any `?doc=` is gone (the
  hard case Peter named: "even if you leave to go to microsofts page"). Precedence
  `?doc=` ?? sessionStorage ?? last-doc hint (new tabs only); the URL is a reflection, never
  load-bearing (round-8 bug 2 is the precedent). **ONE LIVE TAB PER DOCUMENT** via Web Locks
  (`claimDocLock`, name = `DOC_LOCK_PREFIX + id` — **one exported constant**, because OpfsInspector
  badges "open in another tab" from `navigator.locks.query()` and a private copy of that string
  would let a rename put the badge silently to sleep): two tabs on one file blind-autosave over each
  other (`saveDocument` has no union/generation check), so a tab that finds its document held takes
  one of its own. `claimDocLock` RETRIES past the reload unload-race — without it a plain refresh
  intermittently looks like "another tab has this" and hands the writer a blank page. No Web Locks
  (older WebKit) ⇒ never block the writer. PROVED both engines, control `__iwTabDocRule='shared'`
  loses data in all 3 cells (identity / two-tab clobber / OAuth round-trip), fixed loses none:
  `scripts/tabdoc-probe/repro.mjs`. **NB this is NOT what caused the 07-15 loss** (forensics refuted
  it: an opened file, not a pointer race) — it is a separate, real, reproduced class.
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
  panel) with warp physics (finite-range well, WARP_IMPULSE 0.14, snap On/Off, midline locks),
  minimap (wheel + diff ticks + page numbers/logos), position-based swipe scrub + momentum fling
  (multi-touch bails to the pinch — keep that guard), shift-wheel fast scrub, golden-ratio reading
  line, narrow/phone CSS-grid layout, per-version summaries (Haiku, opt-in), LoadingVeil wave
  choreography on open. Grow-only + deterministic pmToText apply here too. The doc pane has GAPPED
  PAGES (2026-07-10): `editor/staticPagination.ts` re-runs the editor's canonical break pipeline
  against the pane's static HTML (forced canonical measure → breaks cached as text-node char
  offsets → the shared `pageGap.ts` widgets + sheet panels inserted post-render; content keyed by
  snapshot.id so the DOM surgery never fights React). Minimap + diff-panel page numbers now come
  from those REAL canonical page regions (the old paper-width×√2 drift is fixed). Scrub diffs are
  cached + read-ahead ±20 in idle time (`provenance/diffCache.ts`) so hard scrubs hit only cache.
  2026-07-10 batch: MIDLINE PAGE SYNC (driver pane's midline crossing a page boundary flies the
  follower to that page — editor→diff unless bijMode 'both'; diff→editor only in 'off'; crossings
  retarget in-flight jumps, nav-settle window suppresses scrub/reposition); doc-pane zoom is a
  fit-capped CSS `zoom` on the PAPER (min(diffZoom, paneFit) — full page always fits the pane;
  phone pinned to 1 = edge-to-edge; staticPagination forces it to 1 in the canonical window +
  converts visual→local px in the band paint); FULL FINAL PAGE (last sheet extends to avg of prior
  ≤5 page regions, sheet min-height grows to cover — recompute's baseline must respect lastMinH or
  the RO ping-pongs; same treatment in PaginationExtension); minimap wheel = exactly 2× the pane.
  2026-07-11 SWIPE PERF (the 500ms-per-swipe fix — keep these invariants):
  - KEEP-ALIVE LAYERS: each recently-visited snapshot's doc pane (static HTML + gaps + sheet
    panels + its own scrollTop) stays mounted in a `DocLayer` (LRU window ≤5, current±1 warmed
    post-flip, staggered 300/900ms). Hidden layers use **opacity:0.001** — NEVER 0 / visibility /
    display — a truly-hidden layer loses its compositor backing store and re-rastering the pane
    stalled the flip ~500ms. Layers keyed by snapshot.id (DOM surgery still never fights React).
  - ACTIVATION: the active DocLayer points leftScrollRef/pagRef/pageGeo at itself in a child
    LAYOUT effect (child effects flush before the parent's per-snapshot effects — that ordering is
    what keeps every [snapshot.id]-keyed effect reading the right scroller). Pagination runs ONCE
    per layer (warm = deferred 150ms, primed to the active pane's scrollTop); the zoom-apply
    effect SKIPS repaint when the paper is already at effZoom (pinch commit repaints explicitly).
  - FLING COALESCING: rapid streams (inputs <250ms apart, detected in goTo — NOT by render
    spacing, which misses exactly when steps render slowly) freeze the heavy SplitDiffView on its
    current snapshot and render only the landing one; counter/header stay live. Scrub steps are
    rAF-coalesced (virtualIdx re-bases flushes that beat React's render).
  - LOCAL-FIRST NAV: goTo flips liveSnapId immediately; the URL syncs 200ms after quiet. Clear
    liveSnapId ONLY in the catch-up effect once urlSnapId matches — navigate() lands as a
    TRANSITION, so clearing it alongside renders one frame with the OLD url (A→B→A→B ping-pong).
    A pure snapId change never re-reads the snapshot archive (loadedDocRef guard).
  - Swipe direction: slide LEFT = next, slide RIGHT = previous (Peter 2026-07-11, reverts the
    07-10 flip). Perf probes: `probePerf` (perflog.ts) feeds window.__iwPerf when a harness
    defines it — zero cost otherwise; per-step timings for /snapshot live in SnapshotView +
    staticPagination.
  ROUND 2 (2026-07-12, Peter's live phone test):
  - HOLD-TO-ARM SCRUB: a plain flick steps EXACTLY ONE version regardless of distance; the
    multi-snap position scrubber (FIRST/REST detents + fling coalescing) only arms when the
    finger held ~280ms mostly still BEFORE the decisive move. Keep the arming check at
    decisive-move time (elapsed since touchstart), not at touchstart.
  - PHONE bottom bar owns everything: no version/"draft" label next to ◈ (date only), narrowed
    Off + L←R toggles IN the bar (snapMode/bijMode state lives in SnapshotView now, passed down),
    actions right-aligned with ⇥ bgst Δ + ← edit at the right end (flex `order` 8/9), NO Verify
    button on phone, and the version pill floats over the side↔diff boundary (shares the d2 grid
    track, pointer-events none). Desktop layout unchanged.
  - Longtask fixes (keep): DocLayer's run() must clear the deferred warm timer (activation
    between warm-mount and its +150ms pagination double-paginated the layer); staticPagination's
    readBands computes total from the ROOT's rect + sheet padding in the SAME layout pass as the
    band rects — never re-hide the panel layer / clear minHeight to read scrollHeight (that
    forced 2 extra full re-layouts per band repaint); the layer-window LRU touch is a no-op when
    the active id is already most-recent.
  ROUND 3 (2026-07-12, "flash through — raster them as PNGs at current resolution of screen"):
  SCRUB BITMAP LAYER (`editor/scrubRaster.ts` + wiring in SnapshotView). During rapid stepping
  the doc pane, diff panel and minimap flip through PRE-RASTERISED bitmaps: per-pane overlay
  hosts (`.iw-scrub-overlay`, absolute inset-0, z 4 under the midline) get cached <canvas>
  elements swapped in per step — sub-ms show(), zero layout; at rest the presenter holds the
  overlay until the LANDING snapshot's live render has painted (notifyLanded on heavySnap.id +
  double rAF; 1.5s safety), then lifts it off the identical frame. Invariants:
  - ENGAGEMENT (each clause was a probed failure): (a) rapid detection reads the INPUT events'
    own timeStamps (stamped ONCE per input at each source — keyboard, shift-wheel, trackpad
    scrubber, touch flick/scrub, buttons; the old goTo-spacing check stays as an OR) — goTo
    runs after the previous step's synchronous render, so goTo spacing missed rapid streams
    exactly when flips rendered slowly. (b) ARMED scrubs (hold-armed touch drag, trackpad
    position scrubber) pass mode 'scrub' → freeze + bitmap from their FIRST step — the first
    step's live cold render (300-1100ms) bunched queued inputs into fling jumps (a 21-step
    scrub collapsed into ~3 goTos). (c) The trackpad scrubber's detent state (accum/started)
    lives in REFS — its effect re-subscribes every render (fresh `nav` identity per step) and
    closure state reset the detent mid-gesture (~5 events per step). An ISOLATED flick stays
    the live path (single-flick semantics untouched).
  - CAPTURE is SVG-foreignObject rasterisation of the live pane subtree: whole app CSS inlined
    from CSSOM with `:root`/`html` selectors re-pointed at the `.iw-raster-root` clone wrapper
    (theme attr + documentElement inline style copied onto it); LOADED webfont faces fetched
    same-origin and embedded as data: URIs (an SVG-image document may not fetch ANYTHING — and
    the CSP img-src has data:, NOT blob:, so the SVG itself must load as a data: URI too).
    Crop = the pane's viewport region at its own scrollTop, selected by NEGATIVE MARGINS inside
    a pane-sized foreignObject — never viewBox/transform (WebKit foreignObject bugs). The clone
    pins the live client box (width AND height: %-height children — diff-panel spacers, minimap
    1fr rows — collapse under height:auto). Raster at device resolution: pane px × DPR (desktop
    full DPR per Peter; phone capped ×2) × CSS zoom for the DIFF pane only (its `zoom` wraps the
    pane, so its scroller measures in local px; doc-pane zoom lives on the paper INSIDE the
    clone). Blank-detect before caching (a WebKit FO failure must not cache an empty rect);
    opaque bg backstop composited UNDER (transparent bitmaps let the frozen pane peek through).
  - CAPTURE-COST BOMBS (defused; keep): the clone is TRIMMED to the crop band (Range-delete at
    `.inkwave-page-gap` block boundaries — text after a gap widget starts a fresh line, so far
    content can't re-wrap the kept band; pixel-exact spacer, CSS-zoom-corrected; the diff panel
    falls back to its block children); twinkle/spark fields are STRIPPED (per-instance PNG data
    URIs); small-rendered <img>s (≤128px declared — the page seals) get DOWNSCALED data URIs —
    the 95KB logo × ~125 sheet + minimap copies serialised to ~13MB of XML per capture and the
    SVG doc decoded every copy. Together: captures 4.5-13s → 130-500ms (xml 16.8MB → ~1.8MB).
  - CACHE: LRU keyed kind|snap.id|WxH|zoom|dpr, hard byte budget 60MB desktop / 24MB touch;
    eviction protects the on-screen canvases + target±2. Misses show the NEAREST cached
    snapshot's bitmap in the same bucket (never blank); unknown target → exact-only.
  - Captures run strictly OFF the input path: idle-pumped (rIC; WebKit setTimeout), paused
    while scrubbing / within 350ms of nav input; sources = active panes 700ms after settle
    (re-keyed on zoom/pane geometry), scroll-settle recapture (700ms), and warm DocLayers via
    hooks.onWarmReady (hidden layers are capturable — opacity 0.001 keeps them painted).
  - The counter/header stay live outside the overlays. MEASURED (36-snapshot 20k-word doc,
    22-event trackpad scrub over a walked region): Chromium desktop 17 bitmap flips, show()
    p50 0.4ms/max 2.1ms, burst frames p50 16.7ms (one >50ms), at-rest swap pixel-diff 0.00%
    (1600×900); isolated flips 50-182ms live with ZERO bitmap-mode entries; cache 62.1MB ≤
    budget. WebKit iPhone-emu: shows 1-3ms, swap diff 0.11%, but its slower renders coalesce a
    burst into ~4 fling-style goTos (each shows a bitmap) — real-device touch scrubbing paces
    by finger position; re-probe on device. Probes: scrub.step/scrub.step.miss/
    scrub.capture(.prep/.img/.draw/.xmlKB)/scrub.swap/scrub.mem in __iwPerf; window.__iwScrub
    exposes the presenter (stats(), show()). Playwright's Linux WebKit has NO navigator.storage
    — the probe seeds via an init-script OPFS shim (scratchpad scrub-probe), NOT vite preview
    (fallback-faithful static server + prod-like CSP).
  ROUND 4/5 (2026-07-14, Peter "keep + salvage" after live DPR2 test — the show() 0.4ms was
  JS-only and hid the real cost): (a) show() now BLITS into ONE persistent per-pane canvas via
  drawImage(ImageBitmap) instead of ATTACHING a fresh <canvas> element per step — the old attach
  re-layerized + re-uploaded a full texture every step (the felt lag the JS timer never saw). (b)
  RASTER DPR IS CAPPED (RASTER_DPR_CAP=1; window.__iwRasterDprCap A/Bs it): the bitmap only shows
  WHILE flipping fast (the full-DPR live DOM shows at rest), so DPR1 crispness is moot, and it
  QUARTERS the per-swap texture upload AND ~4×s cache depth. (c) Capture PRIORITY = nearest-to-
  scrub-position, doc→map→diff. MEASURED (chromium deviceScaleFactor 2, thesis doc, salvage probe):
  cap=1 holds 36 cache entries / 62MB vs cap=2's 11 — and within a warmed window the doc pane
  presents REAL intermediate versions at exactRate 0.97 vs cap=2's 0.04. THIS is regression #3's
  fix ("only some versions seen; lags; catches up on stop"): at DPR2 the shallow cache evicted the
  window → stale-nearest; DPR1 keeps the versions cached so the scrub flips through real content.
  Version-fidelity probes: scrub.want (commanded target idx) / scrub.shown (doc idx presented) /
  scrub.exact (1=real hit, 0=stale nearest) in __iwPerf. RESIDUAL (secondary, DPR-independent):
  scrubBy rAF-coalescing collapses several inputs/frame into one net goTo, so an EXTREME fling
  (>1 version/frame) still skips intermediates before show() sees them — at realistic notch
  cadence (~45ms) it commands 17/24 and presents them; only the fast-fling tail coalesces. Left
  as-is (touching scrubBy risks the swipe-perf invariants); revisit only if Peter still sees skips.
  ROUND 6 (2026-07-16 — SHIFT-WHEEL FLIPBOOK, Peter: "if Apple Photos flickers frame-by-frame on
  scroll, so should we"). ROOT CAUSE of "shift+wheel stays put until you finish, then jumps": the
  window shift-wheel handler computed target off the COMMITTED idxRef and called goTo PER EVENT, so
  it advanced at most ±1 per React commit — probed: 30 fast events commanded only 1-3 DISTINCT
  versions; the panes never flipped. FIX (Photos model = swap resident textures decoupled from app
  state): a COMMANDED index (swCmdRef) runs AHEAD of React per wheel event; an rAF driver (`tick`)
  presents EVERY intermediate via presenter.show() from the resident DPR1 bitmap cache — NO React
  re-render per step; the counter updates IMPERATIVELY (counterElRef ← counterStrings[idx], written
  in the driver; React re-asserts on landing); ONE React commit lands the live full render on
  settle (goTo, ≥120ms quiet). Heavy panes freeze for the scrub (frozenSnapId, 220ms hold). An
  ISOLATED notch (not rapid) still takes the legible single live step (legacy goTo). MAX_PER_FRAME
  2 (presents ~every version, catches up 2× on flings). Flag: window.__iwSwFlipbook=false disables;
  touch is unaffected (isTouchDevice gate — touch keeps scrubBy). PROVED (chromium dSF 2): fast
  burst now commands 16 distinct (was 3), counter flies through ~10-16 versions, JS show() 0.2ms,
  lands clean (overlay lifts, URL+counter settle, active→false); single notch unchanged. HONEST
  GAPS: (1) per-frame GPU present is UNMEASURABLE headless — WSL software raster shows 33ms frames
  (JS is 0.2ms), unrepresentative of Peter's GPU where a DPR1 ~3MB drawImage+composite is a few ms;
  confirm 60fps on device. If it's NOT 60fps there, the next lever is a RESIDENT opacity-pool
  (present-by-opacity among pre-uploaded canvases = compositor-only swap, no re-upload) — but it
  only helps RE-VISITS, a single forward sweep uploads each version once regardless. (2) COVERAGE =
  the warmed window only: cold/never-visited versions have no bitmap → show() falls to nearest
  (presentedDistinct collapses to 1 on a cold range); captures need a mounted DocLayer (≤5) so we
  can't warm-ahead unvisited versions cheaply. Resident window ≈ the DPR1 cache (~12 versions)
  around visited positions — Photos-like (a warm window, not the whole library).
  ROUND 7 (2026-07-16 — PRE-BAKED THUMBNAILS, the cold-scrub fix; Peter "build it, LOCAL cache, no
  file bloat", all three panes). MEASURED cold-warm first: scrubbing INTO a cold range presents ~0
  real intermediates (exactRate 0.09; captures pause during scrub + only source from ≤5 mounted
  DocLayers + each is a 360-1400ms SVG-foreignObject render), and warming a 12-version span
  on-demand is ~tens of seconds. FIX (`editor/snapThumbs.ts`): a LOCAL OPFS cache of pre-rasterised
  pane thumbnails. When the presenter captures a pane (idle, off the input path) it also encodes a
  downscaled WebP (doc/diff 0.5×, minimap natural; q0.7) and persists it to OPFS keyed by
  snapshot-id + PANE + a per-pane RENDER-SIGNATURE (doc/diff = box+zoom+theme+loaded-fonts; map =
  box+theme only — no body-font/zoom dep). On a cold miss show() HYDRATES the ~KB WebP (~5-20ms
  decode) instead of rendering; preloadThumbs hydrates a ±5 direction window ahead. LRU
  byte-budgeted (80MB, regenerable). NEVER travels with the .studio (Peter's hard-minimise: the
  emailed file is byte-unchanged; a fresh device warms as used). Flag `inkwave:snapThumbs` /
  window.__iwSnapThumbs, DEFAULT OFF. KEY DESIGN CHOICE: baking lives ENTIRELY in the /snapshot
  presenter's idle capture path — the editor snapshot-create/persist path gets ZERO added code, so
  save latency is unchanged BY CONSTRUCTION (not merely measured-equal); a snapshot's thumbnails
  bake the first time it's warmed in review. PROVED (chromium dSF 2, real in-memory OPFS shim):
  combined 33KB/snapshot (doc 18KB, map 14KB, diff 3.4KB); after disposing the presenter (cold
  in-memory cache = 3 entries) a fast fling into the baked range presents REAL versions per pane at
  exactRate doc 0.83 / diff 1.0 / map 0.5 first pass (async hydration racing the fling), doc 1.0 /
  diff 0.86 / map 0.86 second pass — vs the 0.09 baseline; the in-memory cache grew 3→40 by
  hydrating from OPFS. Probes: scrub.exact.<kind> (1=exact incl. hydrated, 0=nearest). COVERAGE:
  still the visited set (a version must be warmed once in review to bake) — but now it PERSISTS
  across reload/eviction, so the second-ever scrub of any range is instant. A never-visited range
  is cold once; the (unbuilt) next lever is a background idle sweep to bake ahead.
  ROUND 8 (2026-07-16 — Peter: "still not noticing it… the minimap goes a few times a second but no
  flashing like apple photos"). Built the DEBUG OVERLAY FIRST (the wave-video lesson) — `?snapThumbs
  =debug` (sticky) shows, live: flipbook DRIVER engaged?, wheel events, legacy-goTo count, LANDS,
  commanded distinct, show() calls, per-pane hit/thumb/near/none, each overlay's computed
  display/opacity/z/box/canvas + a NOT-PAINTED warning, and store/mem sizes. It found three real
  bugs the guessing missed:
  (1) LAND_QUIET_MS was 120ms — SHORTER than a real mouse-wheel notch gap (~150-250ms). Between
      notches the driver caught up, saw "quiet", and LANDED = a full React commit + live render PER
      NOTCH. That is exactly "the minimap goes a few times a second": the live path re-rendering at
      notch pace while the bitmaps never got a chance. Now 260ms (= goTo's own rapid window) +
      FREEZE_HOLD 400ms. Overlay proof: lands 0 across a 12-notch fling (was 1/notch).
  (2) STICKY FLAGS: /snapshot's local-first nav rewrites the URL every step (goTo → navigate without
      our params), so a flag read fresh from the URL DIED on the first scrub — silently disabling
      thumbnails AND the overlay exactly when you started using them. Flags now resolve ONCE per
      load into localStorage (the `?auth` pattern): ?snapThumbs=1 | debug | off.
  (3) COLD CACHE was the rest of it — his flag was OFF and nothing was baked, so show() had nothing
      to show. THE SWEEP (Peter: "yes add the sweep") now bakes the library in idle: it drives ONE
      extra hidden warm DocLayer at a time (opacity 0.001, the same keep-alive machinery) →
      onWarmReady → queueCapture → bake → next; outward from the current position; idle-only
      (pauses on any input / active scrub, 900ms gate), resumable, LRU-budgeted. MEASURED from
      cold: 7→23 thumbs in 35s idle, 21/36 doc versions baked (~0.6 versions/s).
  HEADLESS OVERLAY READOUT after the sweep (12-notch fast fling): DRIVER ENGAGED, lands 0,
  commanded 11, shows 7, doc pane 7/0/0/0 (every present a REAL version), all three panes PAINTED
  (display block, opacity 1, z 4, real canvas backing) — so it is NOT the video's invisible-element
  bug. HONEST GAP: the sweep bakes the DOC pane only — the diff panel + minimap render from the
  ACTIVE snapshot's ops, not per-DocLayer, so they can't be rastered for an unvisited version and
  still fall to nearest on a cold fling (overlay: diff/map 0/0/5/2). Doc is the big pane; diff/map
  bake as visited. What Peter reads back: "flipbook DRIVER", "lands", and the doc hit/near line.
  ROUND 9 (2026-07-16 — "keep searching on the 60hz scrub"). PER-FRAME DROP FIXED: MAX_PER_FRAME
  was 2, so when the driver fell behind it JUMPED two versions and show()ed only the landing one —
  silently dropping the intermediate (12 notches → 11 commanded → 7 presented). Now 1: every
  commanded version gets its own frame. MEASURED after the fix: presented == commanded exactly
  (20 events → 21 shows → 21 wants, 1.05×; 24-event 4ms fling → 11/11) — ZERO drops at 31-79
  versions/s. JS per swap 0.5-0.9ms ⇒ the DPR1 swap is cheap and the RESIDENT-POOL idea is DROPPED
  (the ceiling is the frame rate, 60 versions/s, far above any wheel cadence; only a real GPU can
  confirm the paint). Overlay now shows presented/commanded as a ratio (flags drops).
  PROBE ARTEFACT worth knowing: an await-loop probe at a 150ms notch cadence showed 0 shows —
  because each legacy live render (200-700ms) pushed the NEXT synthetic event past the 250ms rapid
  window, so it never latched. Real hardware queues events with their ORIGINAL timeStamps (which is
  why round-3 made rapid-detection read e.timeStamp), so this shouldn't happen on device — BUT if
  Peter's overlay shows "legacy goTo (live)" counting up per notch, that IS this failure and it is
  the same felt bug (a live render per notch). The overlay diagnoses it directly.
  ROUND 10 (2026-07-16 — sweep ALL THREE panes; and the instrument that could not see a burst).
  - SWEEP PANES: the sweep only ever baked the DOC pane (diff/map render from the ACTIVE
    snapshot's state), so a cold fling flickered ONE pane and lagged two. Both are bakeable
    WITHOUT activating a version: `opsBetween(prev,target)` is pure + diffCache-backed and
    InlineDiffView is a pure render of those ops; MinimapPanel is already parameterised by
    (leftRef, ops, pageGeo) and never reads the active snapshot. So the sweep now renders BOTH
    into offscreen replicas (opacity 0.001, sized from the live panes so the captures land in the
    real surfaces' cache buckets) and captures those. CONTRACT CHANGE — exactly one line, and
    ADDITIVE: DocLayer's WARM-ONLY branch hands its own pages to `onWarmReady(id, scroller,
    pages)`; the ACTIVE path (onActivate/onGeo, the leftScrollRef+pagRef+pageGeo binding, the
    child-layout-effect ordering) is BYTE-UNCHANGED. Proved unregressed: 11 shows / 11 commanded
    = 1.00×, zero drops, showJs p50 0.3ms, capturesDuringBurst 0.
  - THE BLANK-CAPTURE TRAP (cost hours; keep): a captured element's OWN inline `position` rides
    into the clone, and captureRegion drops the clone at the foreignObject's ORIGIN — so a host
    laid out with `position:absolute; left:456px` rastered outside the crop, came back blank, was
    silently dropped by blank-detect, and STALLED the sweep on that version forever (map baked
    1/36). Lay replica hosts out IN FLOW and mirror the real host's `position`. New probe
    `scrub.capture.fail.<kind>` / `.throw.<kind>` makes this class visible — every other probe
    reported only successes, which is why it was invisible.
  - The sweep now advances only when EVERY REGISTERED pane is baked (`pendingThumbs`, not
    `isThumbBaked('doc')` — asking about an unregistered surface stalls forever), with a
    give-up set so one unbakeable version can't park the library. MEASURED: doc/diff/map
    19/19/19 in 45s idle, 32.1KB/version (vs the round-7 33KB estimate).
  - THE INSTRUMENT COULD NOT SEE THE BURST. Peter's MID-scrub overlay capture came back
    byte-identical to his idle one: the overlay is a DOM node repainting on the same main thread
    the scrub saturates, so every number ever read off it — including a scary "thumb=0 on every
    pane" — was an AT-REST sample. Same family as canvasShapingMatchesEditor returning false
    forever. FIX: the burst is RECORDED, not watched — a preallocated ring buffer in the
    presenter (typed arrays; no allocation, no strings, no DOM, no console in the hot path),
    serialised only after settle (`presenter.record()`/`resetRecord()`, `window.__iwSummarise`,
    pure `summariseRecord`, unit-tested). The overlay now prints the RECORDED burst and marks its
    live section "AT REST ONLY — stale mid-burst". PROVE IT BEFORE TRUSTING IT: probe-recorder.mjs
    asserts a known-POSITIVE (17 show()s → exactly 17 presents/pane) and a known-NEGATIVE (reset
    → 0) before reading a single real number.
  - thumb=0 IS NOT A BUG, and the key contract is FINE (traced verbatim via
    `window.__iwThumbTrace` — bake and lookup signatures match byte-for-byte). `hydrate()` returns
    EARLY when `entries.has(key)`, so hydration is structurally unreachable whenever the
    in-memory cache is a superset of the disk cache — which is exactly the state of any session
    that did its own baking (Peter: 59 thumbs on disk, 57 bitmaps in mem = the same versions).
    thumb>0 only when memory LACKS what disk has: measured thumb=1 on a cold burst here, and
    round 7's 3→40 hydration came from disposing the presenter first. Read `hit+thumb` (exact),
    never `thumb` alone.
  - REGISTRATION (Peter: "nothing happens except the version number"): versions differ in LENGTH,
    so preserving the SCROLL OFFSET does not preserve the CONTENT. The recorder carries the
    content under the reading line (hashed at CAPTURE time via `paneCentreSig`, interned to an
    int — the hot path writes a number). MEASURED, and it is decisive: anchor drift 0px (every
    doc bitmap is captured at the SAME scrollTop — warm layers are primed to `getAnchorTop()`)
    while the doc pane's centre content HELD only 33% of steps; diff and map hold 100%. So the
    doc pane is misregistered by construction: identical offsets, sliding content. Speed cannot
    fix that — the fix has the shape of the zoom focal anchor (99bf8a0): anchor on CONTENT
    IDENTITY via the provenance spine, not on scrollTop.
  ROUND 11 (2026-07-17 — THE REGISTRATION FIX, and the metric that hid it). THE SEAM WAS ONE LINE:
  DocLayer primed every WARM layer with `L.scrollTop = getAnchorTop()` — the ACTIVE pane's raw
  offset — and a warm layer is exactly what the sweep bakes a bitmap from, and it never receives
  the active path's midline reposition. So every baked frame was registered to an OFFSET forever,
  while the active pane alone was content-anchored (the reposition effect). Two rules, one pane.
  Now `getAnchorTop(scroller, snapId)` resolves the anchor IN THE TARGET VERSION'S OWN LAYOUT:
  EXACT (anchor text found) → NEIGHBOUR (`survivingNeighbourSig`, provenance/anchorMap.ts: the
  anchor was inserted/deleted, so land on the nearest text `opsBetween` says SURVIVES — pure,
  7 unit tests) → RATIO (never the top). MEASURED (probe-anchor.mjs, full sample, real app/fonts/
  DPR/doc), anchor drift per version: p50 186px / max 374px / 0-of-27 within 8px → **p50 0px /
  max 1px / 26-of-26 within 8px**, exact 26/26. showJs A/B in the SAME build: 0.6ms old vs 0.5ms
  new (the rule runs in the warm layer's deferred paginate task, ~1.4ms, never the input path);
  flips 1.08× commanded, no drops. Thumb sig gains `|a1` (doc only) — a bitmap IS a picture at a
  scrollTop, so thumbs baked under the old rule MUST NOT hydrate into an anchored library.
  TWO TRAPS, both the house speciality:
  (1) THE ANCHOR NEVER ENGAGED, SILENTLY. `midlineSignature` hit-tests via caretFromPoint, which
      returns the TOPMOST element — at mount the LoadingVeil covers the pane, so it returned the
      veil, the anchor came back null, and the effect only re-runs on a snapshot/mode change. The
      anchor stayed null for the WHOLE SESSION unless the reader happened to scroll: probed 23/23
      warm layers took `ratio.nosig`. Content anchoring has been dead code at load since it was
      written. Fixed with an overlay-immune geometric fallback (`offsetAtContentY`, binary search
      over Range rects). Same family as canvasShapingMatchesEditor.
  (2) **THE 33% WAS SUBSTANTIALLY A METRIC ARTIFACT — do not re-chase it.** `paneCentreSig` (the
      recorder's `registered`) returns the centre LINE'S OPENING 60 chars: every char on a line
      shares a rect top, so its binary search converges on the line's FIRST char. When the anchor
      sits mid-line — which WRAPPING alone decides, and wrapping differs between versions of
      different length — the anchor is exactly under the reading line and the metric still scores
      a miss. Proof: versions with drift 0px reporting a different centre sig. So line-open hold
      CANNOT reach ~1.0 and reads 0.27→0.44 across this fix; it also runs on 0-7 steps of a
      12-step burst (a hydrated thumb carries no capture-time sig), so it is a tiny sample too.
      The honest measure of registration is DRIFT IN PX (what 99bf8a0 used: 0.0-0.3px), and it is
      what probe-anchor.mjs reports, at full sample, with the old rule kept as a live KNOWN-
      NEGATIVE (`window.__iwAnchorRule='scrolltop'`) that must reproduce the bug before any
      verdict is read. Trust drift; treat `registered` as a wrapping-sensitive proxy.
  DELIBERATE: the scrub is content-registered even under lineMode 'longest' (the DEFAULT), which
  snaps each version to ITS OWN biggest change — right for one deliberate step, ruin for a burst
  (measured: it flings the reading position a median 50,455px per version). 'longest' is untouched
  on the LIVE landing render, so no navigation semantics change; only the flipbook frames hold.
  ROUND 12 (2026-07-17 — A NEGATIVE THAT CANNOT FAIL, and who keeps a proof alive).
  The header +N/-N badges were pinned to the frozen heavy pair ("a number nobody reads mid-fling"
  — Peter reads it mid-fling). They now ride the counter's imperative per-version path, reading
  `peekOpsBetween` (CACHE-ONLY; an uncached pair BLANKS with `visibility`, keeping the box, rather
  than showing another version's number). MEASURED on the DOM: old = stale on 10/14 steps; new =
  14/14 exact, 0 stale, 0 blank.
  THE INSTRUMENT BUG, and it is the third of the same species in one lane: the probe's own header
  demanded the control "MUST show stale numbers, or cell B proves nothing" — and it never could.
  It scored cell A by counting index-stamped paints, while cell A's flag disabled the ONLY call
  site that stamps an index. `painted === 0` was true BY CONSTRUCTION: the control proved the FLAG
  worked, not that the badge was frozen, and the commit message claimed "frozen" as if observed.
  Caught by an outside auditor reading the code, not by the probe passing. Fixed by scoring what
  the DOM actually SHOWS. **Any cell whose PASS condition is satisfiable by the mechanism that
  disables the feature is not a control.** Ask of every negative: what would have to be true for
  this cell to FAIL? If the answer is "nothing the feature could do", it is decoration.
  THE DEEPER ONE — this codebase is excellent at ESTABLISHING truth and has no mechanism for
  KEEPING it. A browser probe needs a build, a server and a burst; it proves a thing once, is not
  in `package.json`, and six weeks later a proof that ran once is indistinguishable from one that
  never ran — the gate says green either way. So when a probe establishes an invariant, ask what
  cheap UNIT-level assertion keeps it true. `provenance/diffCache.test.ts` is the worked example:
  it pins "peek never computes" in 14ms with no browser, and it was MUTATION-TESTED (inject
  `?? opsBetween(...)` — the innocent fallback someone will one day add — and 3 of 6 tests fail).
  A keeper that has never been shown to fail is the same disease one level up.
  RESIDUAL: thumbs are baked around the reading position the sweep ran at and the sig does not key
  on the anchor, so scrolling far away and scrubbing presents frames anchored to the sweep's
  position until re-baked (true of the old rule too; keying on the anchor would invalidate the
  whole library on every scroll). Peter's call.
  - Note for the on-demand-text-renderer proposal: the MINIMAP still needs baked thumbnails
    regardless — it shows every page at once, so per-page on-demand rendering does not serve it.
  - `paneCentreSig` binary-SEARCHES text by char offset (~17 Range rect reads): /snapshot's doc
    flow is a handful of giant `[data-opidx]` spans (measured 4 over a 151,000px pane), so
    block-granularity anchoring would call every frame registered.
  ROUND 12 (2026-07-17 — THE TEXT RENDERER MODELS THE WRONG DOCUMENT. Read this BEFORE wiring
  textRender into show()). The plaintext page renderer is real and its numbers are real — O(window)
  layout (p50 0.9/0.9/0.6ms at 2k/10k/40k), prefix-independence (30/30, 31/31, 31/31), zoom
  invariance, ~1.4KB/version break tables vs the 62.9MB bitmap pool, coverage 99.7%, citeBox 667/0.
  EVERY ONE of those was measured against `editor.state.doc`: all 14 `buildRenderModel`/
  `buildBreakTable` call sites live in textRenderProbe.ts and all are fed the LIVE EDITOR's rich
  document. The model has NEVER been run against a snapshot, and nothing on the /snapshot route
  imports textRender or breakTable at all. The pane it is meant to paint renders something else:
  - PROVED (`panecontent.prove.mjs`, real app/fonts/DPR, byte-identical content on both sides):
    DocLayer renders `<FullDiffView ops>`, and FullDiffView returns the rich `<DocView>` ONLY when
    `ops === null` — i.e. `prev === null` — i.e. the FIRST snapshot. `prev={li>0 ? allSnaps[li-1]
    : null}`, so **1 version in 116 renders rich and 115 render FLAT**: one `[data-opidx]` span of
    `pmToText(contentJson, true)` under `white-space: pre-wrap`. Census rich→flat: headings 6→0,
    lists/items 6/18→0/0, paragraphs 48→0, top-level children 50→1, white-space normal→pre-wrap.
  - THE CONSEQUENCE, measured through the pane's OWN staticPagination on the SAME BYTES: rich = 8
    gaps/9 pages/10481px flow, flat = 9 gaps/10 pages/11532px. The gap offsets diverge PROGRESSIVELY
    — 63 chars apart at the first break, **1247 chars (over half a page) by the eighth**. So a rich
    model's page N is not the flat pane's page N: scrub frames painted from it would not register
    against the live pane they settle onto. That is round 11's disease exactly — two rules, one pane.
  - THE citeBox BLOCKER IS MOOT FOR THIS PANE, and (a)/(b) were both wrong. `pmToText(…, true)`
    resolves a citation to the plain STRING `simpleInText()` = "(Family, Year)" BEFORE the pane sees
    it; measured citation NodeViews in the /snapshot doc pane = **0 on both paths**. There is no box
    to harvest because there is no CitationNodeView — in the pane a citation is ordinary text under
    ordinary wrapping. Harvesting from a warm DocLayer (option (a)) would have measured DocView's
    bare `<span>` — no `nowrap`, no `margin:0 2px`, no `⤵` biblink, `simpleInText` instead of real
    CSL — and fed the EDITOR's opaque-box model a number from a different element. A fiction.
  - THE refList GAP IS NOT THIS PANE'S GAP. `referenceList` is `atom:true` with no content, so
    pmToText's walk SKIPS it and DocView's `block()` has no case for it: measured refList nodes and
    "References" text = **0 on BOTH paths**. The bibliography does not reach the /snapshot doc pane
    at all. The 120px-vs-880px guess still caps `reliablePages` in the EDITOR's model — it just
    cannot be what stops the pane.
  - HEADINGS ARE NOT STYLED ANYWHERE. Tailwind preflight resets h1-h6 to `font-size/font-weight:
    inherit`, there is no typography plugin and no `.ProseMirror h*` rule in the repo: measured, a
    DocView `h2` computes 18px/400/margin-0 — identical to a `<p>` but for 9px margin-bottom. The
    first cut of this probe gated on `distinctFontSizes > 1` and correctly VOIDED ITSELF against the
    rich path. Font size is not a structural signal in this app; the ELEMENTS are. (blockStyles.ts's
    "real ~40px" is a heading's ADVANCE incl. margins, not its font size.)
  - breakTable.ts's whole OPFS layer — `loadTables`/`putTable`/`getTable`/`persist`/`tableStats` —
    has **ZERO callers** in src, scripts or tests. "OPFS across a reload" is not merely unproven; it
    has never been called. It needs the wiring first, and the wiring needs the decision below.
  THE DECISION — **PETER CHOSE (B) RICH** (2026-07-17): "I'm thinking rich text." The pane must
  render formatted pages for every version, not just the first. Rationale: he had asked that the
  renderer "look pretty similar to an actual page", and the census showed it doesn't — v1 rich,
  v2-116 a flat transcript, an inconsistency he'd been living with. Note the perf case runs the same
  way: every number we hold IS a rich-model number (buildRenderModel is fed editor.state.doc), so
  the canvas half is already built and proved; the FLAT model would have been the unmeasured one.
  Rejected: (A) model the flat pane from `opsBetween` — cheaper and registers by construction, but
  it locks in the transcript.
  THE PRICE OF RICH — MEASURED FIRST, before building (`landingcost.prove.mjs`, thesis scale 13k
  words/174 citations, n=12 fresh loads/condition, byte-identical content, real app/fonts/DPR).
  **RICH IS CHEAPER THAN FLAT, ~2×, on both devices** — the risk everyone expected is inverted:
    desktop   paginateStaticDoc  RICH p50 68.5 / max 90.9   vs  FLAT p50 144.2 / max 292   (0.5×)
    phone-emu paginateStaticDoc  RICH p50 96.1 / max 153    vs  FLAT p50 182.6 / max 311.6 (0.5×)
    desktop   longtask worst     RICH p50 178 / max 214     vs  FLAT p50 249 / max 420     (0.7×)
  MECHANISM (traced, because a passing result that favours what you want to build must be): the flat
  pane is ONE block of ~124k chars and `collectStaticLines` dedupes GLOBALLY because "inline diff
  spans share lines across elements" — every span boundary fragments a line into another rect to
  sort. The pagination stage genuinely prefers 385 small blocks to one giant one. Flat is also 1051px
  TALLER (11532 vs 10481) ⇒ more lines to measure.
  BOTH NUMBERS ARE FLOORS, and both caveats favour FLAT, so they cannot manufacture rich's win:
  (a) flat is at its CHEAPEST here — identical content ⇒ diffWords returns one 'same' op ⇒ 1 span /
  129 nodes; a real diff pane has hundreds of spans and is slower. (b) rich is a floor too — DocView
  carries NO diff marks; RichDiffView must, which is strictly more nodes. **That increment is THE
  unmeasured number** and only the built feature can give it. p99 is NOT reported: n=12 cannot
  support one — it needs the 116-version walk, which needs the feature. p50 + max only.
  TWO INSTRUMENT NOTES from this probe: (1) `__iwPerf` entries are ARRAYS `[label, ms, endTime]`,
  NOT `{label, ms}` — the first cut read `e.label`/`e.ms` and would have reported every timing as an
  empty list, i.e. a blind instrument reporting "no cost"; a metric that collects nothing must VOID,
  never read as zero. (2) The `ops` probe reads ~0ms and that is NOT "the diff is free" — it is a
  diffCache HIT, because DocLayer's own UNPROBED useMemo computed it first. The diff's real price is
  unattributed and sits inside the longtask total. Never quote it as the diff's cost.
  **THE PROJECTION IS BUILT** (`provenance/textMap.ts`, pure, 36 tests) — the crux of rich rendering,
  and the part that had to be right before any pixel moves:
  - `buildFlatMap(doc, resolveCitations)` → `{ text, blocks[] }`, each block carrying `flatStart/
    flatEnd` and per-leaf `segs` ({path, nodeStart, flatStart, len}). It MIRRORS pmToText's three
    structural rules — BLOCK types {paragraph,heading,listItem,blockquote,codeBlock} whose content is
    FLATTENED by `inline` (a listItem is matched BEFORE recursion, so a paragraph nested in one is
    never walked as its own block); each block `.trim()`ed and DROPPED if empty; join '\n\n' + a
    trailing '\n'. Segs are clipped to the surviving [lead, keepEnd) window, so a trim-clipped leaf
    carries a non-zero `nodeStart`.
  - **THE PROVENANCE GUARD.** pmToText is hashed into the bundle, recomputed by verify, and anchored
    to Bitcoin (M2/M5) — a drifting mirror would render subtly wrong text while every hash still
    verified. So pmToText IS NOT TOUCHED, and `textMap.test.ts` ASSERTS
    `buildFlatMap(d, r).text === pmToText(d, r)` byte-for-byte at BOTH resolve settings over 10
    fixtures (trim, empty blocks, nested lists, hardBreaks, citations, marks, empty doc). The one
    shared leaf, `citationText`, is now EXPORTED from bundle.ts and IMPORTED here rather than copied
    — `export` alone changes no output byte, and a second copy of the resolve/locator/prefix/suffix
    rules is exactly how two implementations drift. The identity negative is a real drifted mirror
    (wrong join / missing trailing newline), proven CAUGHT, with a correct variant proven to match so
    the assertion is not always-false.
  - `anchorOps(ops)` → the DELETION rule: one cursor over CUR, advanced by `same` and `add` and NOT
    by `del`; a del's `curStart === curEnd` — it is a POINT, not a range. `opsInRange(a, from, to)`
    splits a node into marked runs and EXCLUDES a del anchored at `to` (included at `from`) so two
    adjacent segments cannot render the same deletion twice.
  TWO TEST TRAPS CAUGHT HERE, both the house speciality: (1) the deletion known-negative was BLIND on
  first writing — with a SINGLE del that is also the FIRST change, the correct and buggy cursor rules
  BOTH answer 5; they cannot diverge until a del has been passed over. TWO deletions are the minimum
  that can see the bug. (2) The resolve=true tests were exercising the resolve=FALSE path: with an
  empty bibProvider, citationText never takes its `simpleInText` branch and falls through to the bare
  "(key)" form — so the suite looked like it covered the display path (`displayTextOf` → pmToText(doc,
  true), the one the diff is computed under) and did not. bibProvider is now seeded, guarded by a test
  asserting resolve actually changes the bytes.
  **RichDiffView IS BUILT** (2026-07-17, `components/RichDiffView.tsx` + 26 tests, wired into
  `FullDiffView`'s `ops !== null` branch, gated on `textRenderEnabled()` — DEFAULT OFF). It walks
  contentJson exactly as DocView does and splits each text leaf into marked runs via `opsInRange`
  over its seg's flat range. Gated on the TEXTRENDER flag deliberately, not one of its own: the
  canvas frames and the DOM landing must move TOGETHER, and one flag makes "rich canvas onto flat
  pane" unrepresentable rather than merely unlikely (round 11 inverted).
  - CONTRACT KEPT: the runs emit the SAME `diff-add`/`diff-del` classes and the SAME `data-opidx` as
    FullDiffView, because the hover / click-to-jump / highlight-injection / `computeDiffPagesFor`
    machinery all key on exactly those. A run is a SLICE of an op, never a new op — hence
    `AnchoredOp.idx`. With `ops === null` it renders markup BYTE-IDENTICAL to DocView (asserted).
  - **THE "GAP DEL" MECHANISM WAS DEAD CODE — instrumented, not reasoned about.** The first cut
    carried elaborate machinery to place a del falling in a '\n\n' join (a whole deleted paragraph)
    at the head of the following block. Instrumented across **15 document shapes it NEVER FIRED
    ONCE**, while all 24 tests passed. Structural reason: `diffWords` tokenises `\S+\s*`, so a
    block's last token ABSORBS the join ⇒ every block's `flatStart` IS a token boundary and a join's
    interior never is ⇒ a del can only anchor at a block's start or inside it ⇒ `opsInRange`
    (inclusive at `from`) already claims it. Deleted. **Tracing a PASSING result found it.**
  - **AND THE INSTRUMENTATION FOUND A REAL HOLE THE TESTS MISSED:** when CUR has NO blocks (all
    blocks empty ⇒ pmToText drops them ⇒ `map.blocks === []`), nothing could claim a del and **every
    deletion vanished from the pane** while the flat view still showed them. Deleting all your text
    is not exotic. FIXED with an ORPHAN rule (any del no block claims renders at the end); pinned by
    2 tests, MUTATION-PROVED (disable the rule ⇒ exactly those 2 fail, nothing else — so the rule is
    load-bearing precisely where claimed and inert elsewhere).
  - TEST-INSTRUMENT TRAP: the conservation extractor used `.*?`, which DOES NOT MATCH NEWLINES —
    and `splitChangesAtReturns` keeps newlines in a del's text ("\n\ndoomed\n"), so it read a
    correctly-rendered deleted paragraph as DROPPED. An extractor blind to its own subject fails
    toward "the feature is broken", the most expensive direction to be wrong in. Use `[\s\S]*?`.
  **THE DIFF-MARK INCREMENT — MEASURED, AND IT ERASES THE 2× WIN. Do not quote "rich is 2× cheaper".**
  That earlier figure compared a DocView FLOOR (no marks) against a flat pane fed BYTE-IDENTICAL
  versions (one `same` op ⇒ ONE span) — both sides unrepresentative, as its own caveats said. Re-run
  with versions that genuinely differ (~2% of paragraphs reworded per version) and the real
  RichDiffView under the flag (`landingcost.prove.mjs`, thesis scale, n=8):
    desktop    paginateStaticDoc  floor 215.8 · RICH+MARKS 569.9 (2.64× floor) · FLAT 582.4 → **0.98× flat**
    phone-emu  paginateStaticDoc  floor 328.4 · RICH+MARKS 920.1 (2.80× floor) · FLAT 981.0 → **0.94× flat**
  So: **the diff MARKS dominate, not the structure** — both diff-carrying renderers cost ~2.7× the
  no-marks floor, and rich+marks lands at PARITY with the flat pane (2-6% cheaper, inside the noise).
  Peter gets the formatted pages he asked for at ~the landing cost he already pays. That is a fine
  trade and it is the HONEST one; the 2× saving is not real for the shipped renderer.
  READ RATIOS, NOT ABSOLUTES: this box is CPU-contended (auditor agents probe concurrently; round 13
  measured 103→177ms/version from contention alone), so the absolute ms are inflated ~3× vs the
  quiet-box run and the maxima are wild. Every ratio is measured WITHIN one run across conditions.
  The structural gate had to be rewritten to see this at all: `flat.blocks <= 2` was written when the
  versions were identical and the flat pane was ONE span — with a real diff it is ~524 top-level
  spans, so child count no longer separates the conditions. It VOIDED rather than reporting a
  fiction; the discriminator is now real BLOCK ELEMENTS (`p,h1..h4,li,blockquote,pre`), which the
  flat transcript has ZERO of by construction.
  **BOTH HALVES — COMPARED FOR THE FIRST TIME (2026-07-17, `halvesbisect.prove.mjs` +
  `bothhalves.prove.mjs`). ONE REAL BUG FOUND AND FIXED; THREE DIVERGENCES REMAIN, all named.**
  The probe reads THREE corners from ONE document — the canvas model, the LIVE EDITOR's own gap
  widgets, and the /snapshot pane — and bisects by content kind, because a rate over a mixed document
  cannot say WHICH ingredient diverged. Its CONTROL is `ops === null` (DocView, no marks): if the two
  halves cannot agree with NO diff, on the document the model models exactly, nothing may be read
  from the diff row. That control VOIDED, and the void was the finding.
  - **FIXED — `staticPagination` STILL SNAPPED ORPHANS AFTER THE EDITOR RETIRED THE RULE.** There are
    THREE copies of the break rule (PaginationExtension.computeBreaks · arithmeticLayout.paginate ·
    staticPagination.computeBreakPicks). When production retired the widow/orphan snap
    (`const snap = false`), `paginate()`'s default was corrected and **this copy was missed** — while
    its own comment claimed "identical policy (and 0.22 constant) to the editor" and the file header
    claimed "the SAME overflow / orphan-snap rules as PaginationExtension.compute()". **The claim of
    sameness is why nobody looked.** MEASURED: the pane was **+2 pages on a 25-page document of PLAIN
    PROSE** — no lists, no citations, no refList — so every page number /snapshot has shown since
    2026-07-10 (the minimap's and the diff panel's included) disagreed with the editor. After the fix
    canvas === EDITOR === pane, **Δ0**, on prose / headings / lists / citations.
    KEPT, not just fixed: `computeBreakPicks` is PURE, so `staticPagination.test.ts` pins it in the
    gate in **7ms, no browser** (`_computeBreakPicksForTest`). Its fixture SEPARATES `blockFirstLine`
    from `i` — the same trap one level down that CLAUDE.md already records for arithmeticLayout.test
    ("a test only sees a rule it VARIES"). MUTATION-PROVED with the retired rule restored VERBATIM ⇒
    3 tests fail, full gate exit 1. **The first mutation attempt SURVIVED and the keeper was
    innocent: it wrote `lineIdx: snap ? i : i` and `orphan = used - 0`, so `snap` stayed false and
    nothing was mutated.** A mutation that does not reproduce the bug tests nothing — check that your
    mutant actually misbehaves before concluding the guard is weak.
  - **STILL OPEN 1 — THE MODEL HAS NO DELETIONS.** `buildRenderModel(doc, …)` takes ONLY the document;
    textRender.ts contains no `DiffOp`/`opsBetween`/`anchorOps` (grep -a is empty). RichDiffView
    renders cur's document PLUS every deleted run. MEASURED at thesis scale with a real diff: canvas
    **58 pages** vs pane **88** — the pane carries **86,717 chars of deleted text (261 spans)** the
    model has never heard of. This is not a drift to tune: until the model is fed the diff, "identical
    offsets" cannot be claimed, and a scrub frame would paint a document the landing does not show.
  - **STILL OPEN 2 — THE MODEL'S LISTS DIVERGE FROM THE EDITOR'S, SILENTLY. IT IS NOT CITATIONS —
    I ATTRIBUTED IT WRONG AND THE SWEEP REFUTED ME** (`breakdensity.prove.mjs`, 2026-07-17).
    **`breaks.prove.mjs` — the load-bearing proof, the sentence everyone quotes — runs on 4,000 words
    of PLAIN PARAGRAPHS: not one citation, heading, list, blockquote or refList.** So "byte-identical
    to the live editor" was established on prose alone and had never seen a citation. Sweeping
    density and structure at 13k against the SAME live editor:
        LEGACY prose 4k · prose 13k · 20/80/174 cites · 174 UNMARKED · 174 in 4k   → ALL IDENTICAL
        13k + HEADINGS only                                                        → IDENTICAL
        13k + LISTS (0 cites)          → **DIVERGES** first break 23, mine 55007 vs live 55021 (Δ −14)
        13k + LISTS + HEADINGS         → **DIVERGES** first break 2,  mine 6975  vs live 7055  (Δ −80)
        13k + 174 cites + LISTS + HEADINGS → DIVERGES first break 25, Δ −33  (halvesbisect's row)
    **CITATIONS ARE EXONERATED** — identical at every density, marked and unmarked, with **0 citeBox
    misses** throughout. My "the pane's citation is not the editor's" was a GUESS from the round-12
    prediction, and it was wrong; the divergent fixture merely also carried `lists: true`. The
    round-12 point still stands about the PANE (DocView's bare span ≠ CitationNodeView) — it is just
    not what moves these breaks.
    **LISTS ARE THE CAUSE, and the failure is SILENT**: `estimatedBlocks 0`, `reliablePages 55/55` —
    the model lays lists out ARITHMETICALLY (not placeholders), gets them subtly wrong, and reports
    FULL reliability. Wrong words on the page, declared trustworthy. Headings alone are clean, so it
    is lists, and lists+headings is worse than either (Δ −80, break 2) ⇒ an INTERACTION, likely list
    spacing after a heading. Unfixed, unattributed further — needs the next round.
    **AND A LIMIT OF MY OWN INSTRUMENT, worth more than the finding:** the +LISTS row reads **model
    55p / live 55p — the page COUNT agrees while the break POSITIONS diverge.** `halvesbisect`
    compares COUNTS, so its Δ0 rows do NOT establish identical offsets; they establish identical
    counts, which is exactly the weaker claim that lets wrong words sit on a right-numbered page.
    Compare POSITIONS. This is why the divergence hid at 6k.
  - **STILL OPEN 3 — THE PANE RENDERS NO BIBLIOGRAPHY.** The model/editor give the refList its own
    forced page; DocView has no case for it, so the pane has never shown one: Δ1 at 6k, Δ2 at 13k.
    `feat/reflist-layout`'s; deliberately not touched here (rendering it makes the 120px-vs-880px
    guess live).
  THEN: the show() miss path; idle-pumped cancellable table builds; the COLD far-from-origin burst. WATCH: rich rendering may bring the refList into the pane FOR THE
  FIRST TIME (today `pmToText` skips the atom, so the pane has never shown a bibliography) — at which
  point the 120px-vs-880px guess goes LIVE and silently moves every break below it. Its real height
  must come with it, or `reliablePages` must stop there honestly.
  ROUND 13 (2026-07-17 — THE STORE EXECUTES FOR THE FIRST TIME; the WebKit zoom re-run; and the
  per-version cost, traced).
  - **⚠ `src/editor/textRender.ts` CONTAINS A NUL BYTE — GREP IS SILENTLY BLIND TO THE WHOLE FILE.**
    Line 620 is `const k = font + '\0' + text` (a deliberate cache-key separator, committed in
    21febe3). One NUL makes `file` report "data", so **grep treats it as BINARY: it matches NOTHING
    and exits 1** — which reads as "that symbol doesn't exist" rather than "grep refused to look".
    Every agent grepping this file since 21febe3 has been getting silence and believing it. **Use
    `grep -a`** (or ripgrep). This is the house disease in the TOOLING rather than the code: an
    instrument that cannot report its own failure. Same family as canvasShapingMatchesEditor.
  - **THE WEBKIT ZOOM RE-RUN — the free-zoom claim HOLDS on Peter's device class.** The proof was
    Chromium-only and WebKit's CSS-`zoom` LayoutUnit quantisation was unprobed. `panezoom.prove.mjs`
    is now PARAMETERISED by `PROBE_ENGINE` (not forked — a second copy is how two probes drift and
    one starts certifying a fiction). PROBED: WebKit's known-negative FIRES on its own text stack
    (canonical side margin 96→220px: 37 gaps → 61, first offsets [2007,3981,5846] → [1194,2424,3631]
    — identical to Chromium's), so the verdict is readable; all four conditions (0.5/0.75/1.5/2.0×)
    leave the offsets UNCHANGED; `zoomSeenByMeasure "1"` confirms the canonical pin engages. BONUS,
    stronger than the claim under test: **WebKit's baseline offsets are BYTE-IDENTICAL to
    Chromium's** — canonical pagination agrees cross-engine. Zoom stays a pure PAINT SCALE; one
    table serves every zoom. NB the Chromium baseline was re-run FIRST to prove the instrument
    faithful on this build before the WebKit verdict was read.
  - **THE 10s IS REAL — and the word-width cache was ALREADY BUILT.** The "116 × 90ms" projection is
    sound (`versioncost.prove.mjs`, 12,563 words / 174 cites synthetic): naive full build **~62-82ms
    settled ⇒ ~9.1s/116**. The repo's own numbers did NOT reconcile (breakTable.ts said 4/16/62ms at
    2k/10k/40k; textRenderStore.ts said cold 129.5/warm 82.2 at 40k, contradicting it AT THE SAME
    SIZE; landingcost's `paginateStaticDoc` max was 90.9ms — a DIFFERENT operation that happens to
    read "90ms"), so the constant was measured rather than inherited. `makeCanvasMeasure` ALREADY
    memoises per (cssFont, text) and `TextRenderStore` holds ONE for its lifetime, so versions 2..116
    never paid the cold price: worth 67% off a cold build (753→249ms) and **already banked** inside
    the 62-82ms. There is no second win there. **JIT TIER-UP was poisoning the numbers**
    (`versioncost.attrib.mjs`): 12 identical in-page `build()` calls go 291.7 → settled p50 81.8ms.
    Any probe timing a few builds over separate CDP round-trips reports the tier-up, not the build —
    that is where the bogus "249ms warm" came from. Also: per-version cost is CPU-CONTENDED on this
    box (103 → 177ms/version between runs while other agents' probes ran); quote the attributed
    settled number, not a single loaded run.
  - **THE OPFS LAYER RAN FOR THE FIRST TIME, AND IT WAS BROKEN TWO WAYS.** `loadTables`/`putTable`/
    `getTable`/`persist`/`tableStats` had ZERO callers and had never executed once. `opfs.prove.mjs`
    is the first execution — real OPFS, real reload, through `storage/opfsWrite.ts`. It caught both:
    (1) **THE SIGNATURE COULD NEVER REPRODUCE.** `contextSig` embedded `opts.bibEpoch` =
        `bibProvider.getVersion()`, which is a **monotonic SESSION EVENT COUNTER** (`notify()` does
        `_version++`). Measured 15 before reload, 2 after, on a byte-identical document. So EVERY
        hydrated table stale-missed, always: the layer was **structurally incapable of ever scoring a
        hit** and would have shipped reporting "116 tables persisted" while serving ZERO lookups
        forever. The intent was right (a citation's box changes its wrap, so the bibliography belongs
        in the sig); the instrument was wrong — an epoch is a proxy for "something changed", not a
        description of WHAT THE STATE IS, and only the latter crosses a process boundary. FIXED:
        `bibSignature()` = FNV-1a over the sorted CSL entries (content-derived, stable), memoised BY
        the epoch — which keeps the epoch's one legitimate job, an in-session memo key. Over-
        invalidation is safe (a miss rebuilds); under-invalidation paints wrong words, so it hashes
        the whole entry rather than guessing which fields a style reads. **RULE: no component of a
        persisted signature may be counted since page load.**
    (2) **`getTable` REFUSED TABLES IT HAD JUST BUILT.** It early-returned a miss whenever
        `!i.loaded`, but `putTable` populates `tables` WITHOUT setting `loaded` — so a session that
        built its own tables and looked one up MISSED EVERY TIME, silently rebuilding forever.
        `loaded` only ever meant "ABSENCE is authoritative", and absence already returns null. Same
        family as the signature-blind bake counter reporting 116/116 while every lookup missed.
    PROVED after the fixes (Chromium, real OPFS, real reload, thesis-scale synthetic): 116 tables
    built → `persist` 744ms → **RELOAD** → `loadedFromDisk 116/116`, hydrate **148ms**, HIT with
    byte-identical starts ([1,2277,4448,6775]), **74.3KB on disk / 656B per version** (vs the 62.9MB
    bitmap pool), zero evictions at 3.6% of a 2MB budget. Signature REPRODUCES across the reload.
    KNOWN-NEGATIVE fires: a mutated sig is REFUSED and COUNTED as stale — and the correct sig STILL
    HITS afterwards, which is what proves the negative DISCRIMINATES rather than merely breaking the
    cache. `tableStats` now reports per-doc hits/misses/stale/builds/persisted/loadedFromDisk + bytes
    + **evictions BY NAME** (LRU to a 2MB budget; it should never fire at Peter's scale, which is
    exactly why it must be reported rather than assumed).
    **SCOPE, STATED:** this proves THE STORE. It does NOT wire tables to the pane and says NOTHING
    about the renderer's fidelity — round 12 stands: the pane renders FLAT for 115/116 until
    RichDiffView lands, so wiring now would model the wrong document.
    **ENGINE GAP, STATED:** Playwright's Linux WebKit has NO `navigator.storage` at all (verified
    directly), so this proves the **main-thread `createWritable` branch only**. The iOS worker
    `createSyncAccessHandle` path — the one Peter's iPhone 8 actually takes — remains UNPROVEN here
    and needs a real device.
  - **`storeProof` WAS LYING, and fixing it unmasked a real signal.** It read `coverageOf('v0')` for
    its reference model — but the LRU evicts the OLDEST FIRST, so at n=116 v0 is the first casualty:
    it reported `pagesPerVersion: 0` and `lastPageReachableByContent: false`, which read exactly like
    the whole-document claim COLLAPSING when the truth was that it queried a key it had thrown away.
    Now it asks the MOST-RECENTLY-USED version (LRU-guaranteed resident) and carries `refId`/
    `refResident` so a null can never be read as a zero: `pagesPerVersion` 0 → **58**.
    **ATTRIBUTED AND FIXED (2026-07-17, `tail.prove.mjs`) — it was TWO faults stacked, and the
    refList WAS involved after all.** The handoff said "PROBED that it is NOT the refList (identical
    with refList:false)"; measured directly, that is **wrong** — refList:true → pageOfLast 56 vs
    lastPageIdx 57 = UNREACHABLE; refList:false → 56 vs 56 = REACHABLE. Both faults are real:
    (1) **THE MODEL BUG — a LEAF ATOM's line claimed the position AFTER itself.** Every placeholder
        block pushed `pos: offset + 1`, which is right for a normal block (content starts past the
        opening token) and WRONG for a leaf atom (`referenceList`, `mathBlock`, `horizontalRule`):
        `nodeSize === 1`, so it occupies exactly `[offset, offset+1)` and `offset+1` is the position
        AFTER it — the next block's start, or (trailing) the doc end. MEASURED: refList at
        start=122267 end=122268 took line pos **122268 = doc.content.size**, so
        `pageContainingPos(122267)` — the refList's OWN position — returned page 56 while it rendered
        on 57. FIXED: `blockFirstLinePos(node, offset)` = `node.isLeaf ? offset : offset + 1`.
        **Breaks are byte-unchanged against the LIVE EDITOR** (`breaks.prove.mjs`
        [2403,4856,7205,9476,…] IDENTICAL) — this moves what a position MEANS, not where pages fall.
    (2) **THE PROBE ASKED THE WRONG POSITION.** `lastPos = doc.content.size - 2` lands INSIDE the
        second-to-last block whenever the doc ends in a leaf atom, and correctly resolves to the
        second-to-last page — so the assertion read "last page unreachable" while measuring a
        different page. Now asks the LAST BLOCK's own position, derived from the DOC
        (`doc.content.size - doc.lastChild.nodeSize`), not the model.
    **WHY THE SELF-CONSISTENCY CHECKS COULD NOT SEE IT** (`pagesAgreesWithWalk`, `maxPageOfLine ===
    pages-1`, `pageTopLen === pages` all PASSED, and `emptyPages` was `[]`): every one of them is
    derived from the SAME line list, so they agree with each other perfectly. The error was in what a
    line's pos MEANS. Nothing built from the line list can check that — only a query from OUTSIDE
    ("which page holds this doc position?") can, which is exactly the seam RichDiffView and the
    content anchor use. **THE SHAPE TO REMEMBER: when a bug survives every self-consistency check,
    stop adding checks derived from the same structure and ask it from outside.**
    **THE GATE COULD NOT SEE THIS FIX AT ALL — F6, found by the test auditor, now CLOSED.** Reverting
    `blockFirstLinePos` to the legacy rule left `pnpm test` at **exit 0, all 79 files green**: the
    only guard was `tail.prove.mjs`, which is in no CI and no package.json script, needs a browser +
    a thesis-shape doc, and is run BY HAND. A fix for a bug MEASURED in the real app was one careless
    edit from silently returning. `src/editor/textRender.test.ts` now carries it in the gate —
    4-node schema (doc/paragraph/referenceList/horizontalRule/text), `measure = t => t.length * 8`,
    **~90ms, no browser, no canvas, no fixture** (harness adapted from the auditor's own
    reproduction, `/root/dev/iw-audit-tests/audit/probe-atompos.test.ts.txt`, rather than
    reinvented). PROVED: applying the auditor's exact mutation takes the FULL gate to **exit 1, 4
    failures**. `tail.prove.mjs` remains the in-browser truth; the unit test is what stops a silent
    revert six weeks from now.
    **AND THE NEGATIVE HAD TO SWEEP PLACEMENTS TO WORK.** The two rules can only differ where the
    atom STARTS a page — an atom mid-page resolves identically either way. The first cut tested a
    `horizontalRule` at index 25, it landed mid-page, and that test PASSED AGAINST THE MUTATED BUILD
    while its neighbours failed: a true invariant discriminating nothing. The negative now sweeps
    every placement per atom type and asserts `discriminating > 0`, so it cannot silently become a
    coin toss again.
    **THE GENERAL LESSON (the auditor's, and it is the sharpest one this project has produced):**
    *"This codebase's probe culture is genuinely excellent at ESTABLISHING truth. It has no mechanism
    for KEEPING it. A proof that ran once and convinced everyone is indistinguishable, six weeks
    later, from a proof that never ran — and the gate says green either way. The measured facts in
    these file headers read as guarantees; they're archaeology."* So: **of every claim you prove, ask
    whether there is a cheap unit-level version that KEEPS it true.** If it is 90ms and needs no
    browser, there is no excuse. The `.prove.mjs` probes stay as the in-browser truth — they are not
    redundant — but a browser-only proof is not a guard.
  - **THE LIBRARY-HYDRATION RACE — PETER'S iPHONE 8 FOUND IT, AND THE iOS WRITE PATH PASSED (2026-07-17).**
    `?btDebug=1` on his device: **the worker `createSyncAccessHandle` branch WORKS** — 24/24 read back,
    HIT after reload, byte-identical starts, both negatives firing (build 183ms · write 1509ms · read
    925ms, iOS 18_7). That is the branch no test on this box can reach (Playwright's Linux WebKit has
    NO `navigator.storage` at all — verified directly), so it needed a real device and it got one.
    THE RUN BEFORE IT **FAILED**, and it named its own cause: `capa@0:w7k42t` at build →
    `capa@20:12qxw1k` after reload. **`bibSignature()` was RIGHT** — it hashes the bibliography's
    CONTENT, and the content genuinely differed: **0 entries when the table was built, 20 after the
    reload.** The library hydrates ASYNCHRONOUSLY from OPFS (`loadLibrary`), so a builder that runs
    first bakes an EMPTY-library key and **every later lookup misses, forever, silently** — bug 1's
    ghost wearing a correct signature. NOT fixed by loosening the key (under-invalidation paints wrong
    words; the asymmetric-cost reasoning stands). FIXED AT THE SOURCE: `libraryReady()` in
    `citations/library.ts` — a LATCH, not an event, because the defect's shape is **a one-shot async
    signal with no "has it already happened?" check** (the wave video hit the identical shape the same
    minute). Already done → resolves immediately; in flight → same promise; **never started → STARTS
    it** (or a caller that only ever awaits hangs forever — the same stranding bug relocated). Resolves
    on FAILURE too: the contract is "the initial attempt COMPLETED", not "a library exists" — 0 entries
    is a real state that may legitimately sign a table. **ANY CALLER THAT PUTS THE BIBLIOGRAPHY IN A
    PERSISTED KEY MUST AWAIT IT.** `loadLibrary()` keeps its exact semantics (still re-reads); only the
    latch is memoised. PROVED BOTH WAYS (`btrace.prove.mjs`): `?btDebug=race` skips the await when
    BUILDING and reproduces Peter's failure verbatim — the identical `capa@0:w7k42t` hash — while
    `?btDebug=1` passes with 20 entries. **THE PROBE WOULD HAVE BEEN A FICTION WITHOUT ITS SEED:** with
    an EMPTY library both phases sign `capa@0` and the signatures MATCH, so race mode would go GREEN
    while reproducing nothing; it seeds 20 real entries into real OPFS and asserts the seed landed
    before reading any verdict. The race only exists where there is something to hydrate. Race mode
    races **phase 1 only** — skipping the await on BOTH sides lets phase 2 also catch an empty library,
    the sigs agree, and the negative silently passes: **a negative that can accidentally agree with
    itself is not a negative.** The RACE LINE is informational (`ok:null`), NOT a forced `ok:false` —
    hardcoding the failure would make race mode go red whether or not the race reproduced, which proves
    exactly as little as an assertion that passes by construction.
    **AND MUTATION TESTING CAUGHT TWO OF THE FIVE NEW UNIT TESTS BEING DECORATION** (`library.ready
    .test.ts`, the cheap guard that KEEPS this — the browser probe is the truth, not a guard):
    (a) an explicit `_libDone` "already happened?" branch was **redundant and unkillable** — the
        PROMISE is the latch, a resolved promise resolves every later await forever, so removing the
        branch left all 5 tests green. **A guard no test can kill is not a guard; it is a comment that
        costs a branch.** Deleted.
    (b) the test named "resolves even when the OPFS read THROWS" **passed against a mutant with no
        `finally` at all** — because `readFile()` swallows its own errors and returns `[]`, so the read
        CANNOT throw and the finally was never reached. It measured nothing while reading like a
        guarantee. Re-aimed at the path that can actually reach it (hydration throwing PAST the read),
        and it asserts the throwing path really ran.
    Mutants now die 4/1/1 (no self-start / no finally / latch resolves early), restored green.
    LIVE KNOWN-NEGATIVE: `window.__iwAtomPos='legacy'` restores the bug; `tail.prove.mjs` reproduces
    it (legacy 56/UNREACHABLE → fixed 57/REACHABLE) before reading any verdict, and VOIDS where the
    fixture's tail is not a leaf atom so the rules structurally cannot differ. It caught a real
    tooling failure doing so: the negative "did not fire" purely because the flag had been added but
    NOT REBUILT — the served chunk was the previous bundle, and the probe's own build check only
    asserted `tailProof` existed (it did, from the older build). **Assert the served chunk carries the
    thing you just changed, not merely that the probe surface exists.**

  ROUND 14 (2026-07-17 — THE SCHEMA LEAVES THE EDITOR; /snapshot can build a PM Node at last).
  THE BLOCKER, closed: `buildBreakTable` needs a real PM `Node`; SnapshotView has no `useEditor`, and
  the extension list was an inline array literal INSIDE it — so a version's contentJson had no schema
  to parse against and the store had ZERO production callers. `extensions/editorExtensions.ts` holds
  THE list (moved verbatim: 27 entries, same order, same configure args — audited by mechanical
  extraction, not by trusting the report); `editorSchema.ts` = `getSchema(buildEditorExtensions())` +
  `nodeFromContentJson`. ONE list, so the editor and /snapshot agree BY CONSTRUCTION — a schema-only
  copy is the pmToText/textMap drift trap wearing a different hat.
  - **THE THREE CLOSURES REACH ONLY THE PLUGINS, NEVER THE SCHEMA** — the load-bearing claim.
    `getDoc`/`getHintState`/`getScasLookup` are destructured only inside RedHighlight's
    `addProseMirrorPlugins`; it declares no nodes, no marks, no `addGlobalAttributes`; and `getSchema`
    never installs plugins. So a deps-less list is safe FOR A SCHEMA — and **`getDoc`'s default
    THROWS**, so it is fatal for an EDITOR (proved: a real Editor built without deps throws). Do not
    "tidy" that throw into something forgiving; it is what makes a silent omission loud.
  - **PROVED FROM OUTSIDE** (`schemaIdentity.prove.mjs`): the standalone schema is spec-identical to
    the LIVE editor's (17 nodes / 11 marks / 0 divergences) and the live doc — 40 citations, 44 math,
    refList, marks — round-trips structurally identical. Strongest arm: run against a build whose
    editor still used the ORIGINAL INLINE LITERAL, it PASSED — the extraction is faithful measured
    against the original, not against itself. `breaks.prove.mjs` byte-identical pre/post
    ([2403,4856,7205,9476,…], 16 pages, 601.7007874015749). Editor mounts ONCE ([1,1,1,1,1]).
  - **⚠ `Node.eq` CANNOT COMPARE ACROSS SCHEMAS — it is REFERENCE equality on NodeType** (`hasMarkup`
    does `this.type == type`). The first identity check used it and reported `false` for the UNTOUCHED
    live document: a check structurally incapable of passing, which would have condemned a correct
    schema. It was caught ONLY because the known-negative reads its POSITIVE arm too (clean must still
    say yes). Cross-schema comparison must be STRUCTURAL (type NAMES + attrs + marks). `schemaSpec()`
    is that comparison, shared by the probe and the gate — one definition of "same".
  - **THE GATE NOW KEEPS IT** (the audit's headline: this codebase establishes truth superbly and has
    no mechanism for keeping it). `editorSchema.test.ts` builds a REAL `Editor` in jsdom (17/11,
    matching the browser) and compares — ~515ms, no browser. Its negative is mutation-proved. NB the
    drift must be VALID-BUT-DIFFERENT: deleting `taskItem` merely makes the schema unconstructable
    ("No node type taskItem found in content expression taskItem+") — an exception, not a divergence.
  - **AUDIT FINDINGS, all three real:** (F7) mutating `RedHighlightExtension.configure({})` strips
    every closure from the live editor and the FULL gate stayed exit 0 — the /edit half, the half this
    lane promises is unchanged, had NO assertion. `editorExtensions.test.ts` pins it BY IDENTITY, and
    identity is required: both sides are functions named `getDoc`, so typeof/truthiness passes on the
    stripped list. (F8) RICH's taskItem held only a paragraph — valid under BOTH `paragraph block*`
    and `paragraph+` — so dropping `.configure({nested:true})` survived the whole suite; and
    `fromJSON` calls `type.create`, which does NOT validate content, so a round-trip is blind to it.
    It takes `check()` or the content expression. (F9) a comment true for the wrong reason.
  - **THE COST, PROBED, AND IT IS NOT UNDER 1s.** `parsecost.prove.mjs`: contentJson → PM Node is
    **9.10ms p50/version** (thesis scale, JIT-warmed). ROUND 13's 62-82ms/version was
    `buildRenderModel` fed `editor.state.doc` — ALREADY PARSED — so the parse is this seam's OWN
    increment and no prior number covered it. Peter's 116: ~9.1s build + ~1.06s parse ≈ **10.2s** vs
    his <1s target. The incremental lane owns closing that; do not quote 62-82ms as the wired cost.
  - **THE WIRING** (`editor/snapshotBreaks.ts`, flag `inkwave:snapBreaks` DEFAULT OFF, sticky):
    hydrate → build only what is missing → persist, on /snapshot open, keyed [docId, snaps.length]
    (never snapId — a scrub step must not restart it). Imported by SnapshotView and NOTHING else, and
    /snapshot has no editor, so it cannot touch typing BY CONSTRUCTION, not by measurement (the
    snapThumbs round-7 pattern, taken deliberately). **PROBED it costs the editor +77 BYTES**: chunk
    sizes are meaningless here (rollup re-split the graph — master's 949KB TiptapEditor is not the
    branch's file of the same name), so `editorbytes.prove.mjs` measures what the browser ACTUALLY
    downloads to open `/`: 2,115,262 → 2,115,339, 32 files both. No paint path, no sweep, no font
    probe in any editor chunk.
  - **HONEST GAP — RELIABILITY, NOT COVERAGE.** `blockStyle()` returns null for unharvested kinds and
    there is no canonical `.ProseMirror` on /snapshot, so headings/lists DEFER to `estimated`
    placeholders and `reliablePages` stops at the first one. That is the renderer's own design working
    ("Never guess a heading's height: it moves every break below it") — plain-paragraph docs table
    exactly; a heading-bearing doc tables reliably only to its first heading. The sweep REPORTS this
    rather than implying coverage, and deliberately does NOT harvest from the pane's DocView DOM
    (ROUND 12: that feeds the editor's model a number measured off a different element — "A fiction.").
    Closing it is the paint lane's business. **ALSO UNMEASURED (STATED, not probed): the end-to-end
    sweep on a real /snapshot route with 116 seeded versions** — the wiring is chunk-proven present
    and the per-version arithmetic is probed, but the route-level run has not been driven.
  - HARNESS FIXES: `breaks.prove.mjs` ALWAYS EXITED 0 — it printed "IDENTICAL BREAKS: false" and
    reported success to its caller; a gate that could not fail (now exits on the verdict, forced-
    divergence confirms exit 1). `serve.mjs`: probes take an EPHEMERAL port and boot their own server,
    so tonight's port-collision fiction cannot happen by construction; it never kills a server it did
    not start. `pnpm prove:schema|mount|breaks|editor`.
  - TWO INSTRUMENT TRAPS worth the next agent's time: (1) **`.ProseMirror` IS NOT THE EDITOR** — a
    load transiently carries TWO, the real editor (`contenteditable=true`) and an aria-hidden
    anti-flash SHELL that is removed by ~3s. Counting the class alone reports 2 and cries "double
    mount" on a healthy load; and waiting on `.tiptap-editor` with `state:'attached'` matches the
    SHELL, so a probe can call a surface before the editor exists (it made parsecost's staleness guard
    fire on a FRESH bundle). An editor is `.ProseMirror[contenteditable=true]`. (2) A childList
    MutationObserver counting inserted `.ProseMirror` nodes reports **0 on a page that has one** —
    @tiptap/react passes `{mount: element}`, so PM REUSES React's attached div and sets the class as an
    ATTRIBUTE mutation; nothing is ever inserted. Its known-negative fired anyway (it injected a div
    that already carried the class — a path the editor never takes): a blind counter with a green
    negative. Observe attributes; drive negatives through the real mechanism.

## Productivity AI report — the free paste-back path (P1c, 2026-07-17, `?prodReport` DEFAULT OFF)

`src/productivity/report/` — spec §A7.1 Path 1: Inkwave compiles a payload, the WRITER runs it in
their own AI and pastes the reply back, Inkwave parses + merges + graphs client-side. Inkwave sends
nothing; no account, no key, never paywalled (§C6). Path 2 (backend) and Path 3 (BYO-key) NOT built.

- **⚠️ §A5 WAS REVERSED 2026-07-17 — the tone is "honest first, funny second, kind third".** Peter:
  *"it's too nice and not enough humour… read like a comedian wrote it"* / *"It doesn't need to be
  kind. It needs to be honest."* Do NOT restore the kind/non-shaming rule from an earlier draft; a
  test asserts it is GONE. **What makes the reversal safe is §A5's surviving distinction, and it is
  the whole thing: PRODUCTIVITY GUILT IS A STANDARD IMPOSED ON THE WRITER; ACCOUNTABILITY IS A GOAL
  THE WRITER SET (§A5b).** "You only managed 200 words, poor effort" is imposed and banned. "You
  said Friday and you've opened it twice" is his own words quoted back, and is the point.
- **§A5b GOALS ARE THE PRECONDITION, NOT A FOLLOW-UP.** `DocGoals` on `InkwaveDocument`
  (types/document.ts — a document property, declared once, the `DocType` precedent). No goal ⇒ the
  prompt says NO GOALS WERE SHARED / DESCRIBE, DO NOT PUSH. **Structural, not asked:** goals travel
  only on their own tick, so a model sent none has nothing to hold him to. ⚠ **NOTHING AUTHORS
  GOALS YET** — no editor UI (Peter's design call, raised). Every doc is `undefined` today, which
  takes the honest branch. Never default it to an empty goal: empty and absent are different states.
- **THE GUILT LIST WAS RE-DERIVED, NOT DELETED.** The old prompt banned words ("only", "just",
  "failed to"…) — most are now exactly right when quoting a missed goal. The rule is about the
  SUBJECT and the STANDARD, not vocabulary: `claims.ts findPersonVerdicts` flags only what can never
  be said about a Tuesday (lazy/pathetic/…, plus ranking + comparison to other people); "wasted" is
  deliberately NOT on it ("you wasted three sessions circling the intro" is about the sessions).
  Quoted spans are skipped — the narrative may quote his own diary note back.
- **THE RULE (§A6.4): measured numbers never round-trip.** Out yes (the model can't narrate what it
  can't see), back never. `judged.ts` REFUSES a judged table carrying any measured column;
  `claims.ts` flags narrative numerals absent from the payload. PROBED: empty MEASURED_COLUMNS and a
  measured table is STILL refused (exact-header rule) — two guards; the list supplies the diagnosis.
- **§A6.1 — "which sessions produced your best content" REQUIRES content.** You cannot judge writing
  from minutes and word counts; that is vibes-as-numbers wearing a judged label. So `insight`/
  `quality` (CONTENT_ONLY_COLUMNS) are asked for ONLY when text was sent and **REFUSED** otherwise,
  with a message saying to tick a document. `contentIncluded` defaults FALSE so a caller that forgets
  it refuses a guess rather than accepts one. Weekly+ has no quality column at all — the ledger sends
  `sessions: []` there, so nothing grounds a per-day verdict.
- **THE LEDGER+DOC COMBO (`report/excerpts.ts`)** — Peter's "structured ledger+doc combo data". Each
  session paired with the prose it produced, **from the snapshot record, exactly**: baseline = last
  snapshot ≤ session start, final = last ≤ end, diff the adds. DAILY only (the `sessions: []`
  contract makes per-session pairing structurally impossible at weekly+, and §A7.3 agrees content
  belongs on daily). §A7.3 gates every word — ticked docs only. **THE `diffWords` ARTIFACT BIT HERE
  TOO:** it tokenises [word][trailing-whitespace], so appending re-emits the OLD last token as
  del+add and a naive `filter(type==='add')` credits the session with the sentence before it
  (measured — the first cut did exactly that). `capture.ts wordDiffStats` hit the same thing but
  CANNOT be reused: it normalises for COUNTING (strips punctuation/paragraphs). Same insight, other
  purpose. Honest limits, all surfaced in the payload: snapshots are event-triggered so a real
  session may have none (says so — a gap in the RECORD, not the writer doing nothing); pairing is by
  the writer's LOCAL CLOCK (ordering only, never authority — not a provenance claim); a wide baseline
  is labelled. The demo carries `s-4` deliberately to SHOW the gap state.
- **§A6.2 — THE HEDGE IS THE LINE (Peter relaxed this TWICE, both 2026-07-17 — read them together
  or the rule reads as toothless).** (1) *"I want correlations on daily too. Just more brief"* ⇒
  daily DESCRIBES co-occurrence. (2) *"I sort of want them to hazard guesses at causality too. They
  don't have to commit… 'the break maybe helped' or 'you could've taken more breaks'"* ⇒ daily may
  GUESS. **He moved the line; he did not delete it:** `"the break helped."` = an assertion one day
  cannot support → still flagged. `"the break maybe helped."` = a hypothesis announced as one → IN,
  and wanted. A guess that announces itself is honest; a guess dressed as a finding is not.
  `findCausalClaims` now SKIPS any hedged sentence (`isHedged`) and fires only on the unhedged
  assertion. **This sits INSIDE §A6.2, not against it** — the spec's words are "**Confident** pattern
  claims… permitted only at weekly+", and hedging removes the confidence; we had been reading a ban
  on the SUBJECT where the spec bans the CERTAINTY. Suggestions must be TETHERED to the window's own
  evidence: *"you should take a break every 25 minutes"* is a standard he never set — **a hedge does
  not launder an invented standard**. Second honest limit, accepted: a hedge anywhere in the sentence
  passes it ("the break definitely helped, maybe"), pinned by a test so it stays known.
- **FIVE consent tiers** (metadata always · diary notes · **place labels, SEPARATE** · goals+plan ·
  per-document content). Peter split notes from places: one tier by provenance, two very different
  disclosures. Each absence is STATED in the prompt — a model told only what it HAS will fill the
  gap, and "you didn't record where you worked" is a claim we'd be inventing. **`place` is a word the
  writer TYPES — no geolocation. Never write copy implying otherwise (§C1.4).**
- **The payload is an ALLOW-LIST** (compile.ts names every field that leaves) so a field the ledger
  gains later cannot ride out. A deny-list fails the other way, silently. Tested.
- **TWO PROVIDERS, free on Path 1** (he runs it himself). No Claude-isms: the parser is tested
  against tagged/untagged/uppercase/tilde/4-backtick fences, prose wrappers, pipe tables, and BARE
  unfenced CSV (`allowUnfenced` — what a copy-code button yields, used only by the dedicated table
  box). Path 2 multi-provider is a real cost — NOT built.
- **The panel type ramp has ONE root** (`PANEL_ROOT_PX = 18`, everything an `em` of it) — Peter:
  "every font proportionally up", scrolling acceptable. Inputs land ≥16px (the iOS auto-zoom floor).
- `/privacy` has a "Your work report" section naming the tiers — keep it in sync with the code.
- ~142 report tests. Every guard mutation-proved to FIRE. `scripts/prodreport.prove.mjs` drives the
  REAL built app 51/51 (own port 4933). **THREE INSTRUMENT TRAPS caught there, all the house
  speciality:** (1) it served a STALE `build/` and reported a real feature missing — rebuild before
  reading a verdict; (2) every section heading appears TWICE (the prompt explains it, the data
  carries it), so `payload.includes('WHAT EACH SESSION PRODUCED')` is true whenever the PROMPT
  mentions it — four excerpt checks passed with the feature SUPPRESSED until they were scoped to the
  data section, proved by suppressing it; (3) the excerpt prose also appears in DOCUMENT TEXT, so an
  unscoped prose check cannot discriminate either.

## Productivity layer — P1a-viz: aggregates + graphs (2026-07-17, `feat/prod-graphs`)

The read half of the productivity layer (build-spec §A3.3/§A8, the private Productivity-Email spec —
read it, never copy it into the repo). `src/productivity/`: ~~`ledger.ts` (the §A3.2 row CONTRACT)~~ — **that mirror is RETIRED; the schema
is `types.ts` and `ledger.ts` is now the real attested per-month ledger (see the integration section
below)**, `aggregate.ts` (pure day/week/month rollups, now sharing one module with the ledger's
window builder), `phase.ts` (the deep-vs-shallow rule), `judged.ts` (the
AI seam + the honesty gate), `summary.ts` (the copy), `charts/` (hand-rolled SVG — NO chart
dependency; follows `src/verify/ActivityGraph.tsx`), `ProductivityPanel.tsx`, `fixtures.ts`.
Route `/productivity`, flag `inkwave:prodGraphs` DEFAULT OFF (`?prodGraphs=1` / `=demo` / `=off`,
sticky, the `?auth` pattern). Off costs nothing BY CONSTRUCTION: the whole lane sits behind a lazy
import (`Report-*.js`, 21kB/7kB gzip) and the route stub is 2kB. Nothing reads the `.studio` or walks
the doc; aggregation is pure and runs on mount, never on the load path.

**THE HEURISTIC DEVIATES FROM THE SPEC'S EXAMPLE, AND THE MEASUREMENT IS WHY.** §A3.3 offers "high
add-to-delete ratio + long sessions → drafting; high delete + short → editing" as an `e.g.`. Scored
against labelled synthetic writing (`phase.variants.test.ts`, 64 sessions, 48.4% drafting truth):

    rule                        precision   coverage   called-drafting
    ratio + duration (spec e.g.)   100.0%      34.4%      81.8%   ← skews the mix badly
    ratio only            SHIPPED  100.0%      78.1%      50.0%   ← mix ≈ the 48.4% truth
    duration only                   47.2%      82.8%      79.2%   ← worse than chance, 28 wrong

Session LENGTH does not track what the writer is doing (long revising sessions and short drafting
bursts are both ordinary). Conjoined it never causes a WRONG call, but it suppresses coverage to 34%
and skews survivors to 82% drafting against a 48% truth — i.e. the spec's rule would tell a writer
they spent the month drafting when they spent half of it editing. So the ratio ships ALONE; the
duration thresholds remain only as the scored alternative. ⚠ Peter to confirm the deviation.
`unclear` is a first-class share, not a rendering failure: forcing a call is exactly where precision
breaks (93.8%, 4 wrong). Residual, honest: it declines ~25% of HARD drafting sessions (they cut most
of what they lay down — indistinguishable from editing to a word counter) and ~half of `revising`.

**THE EVIDENCE ABOVE WAS ONCE A TAUTOLOGY — the F1 audit finding, and the fix (2026-07-17).** An
external mutation audit found `phase.variants.test.ts` could not feel a wrong threshold: mutating
`draftAddRatio` 0.70 → 0.65/0.75/0.78 and `editAddRatio` 0.50 → 0.79 ALL SURVIVED GREEN. The
assertions weren't the problem — THE FIXTURE was: its `deleteRatio` bands were DISJOINT across the
truth classes (measured: editing topped at addRatio 0.624, drafting started at 0.803, **zero of 64
sessions between them**), so the 0.70 cut sat in a void and every value in [0.625, 0.800] scored
numerically identically. `expect(wrong).toBe(0)` was a property of the data, not of the rule. The
fixture's own header had named the standard it was breaking ("the classes OVERLAP… if they didn't,
this file would be a fiction that always reports success") — they overlapped in DURATION, the proxy
the rule does NOT use. **THE SHAPE: check the overlap in the proxy the rule actually reads, not in
the one that happens to be there.** Fixed by widening the bands to what real writing does (a hard
drafting hour cuts most of what it lays down ⇒ addRatio ~0.58; restructuring writes new connective
prose ⇒ ~0.69) — the classes now overlap [0.577, 0.689] with ~14% of sessions contested.
`phase.thresholds.test.ts` PINS that property (drafting's floor must stay below editing's ceiling,
both classes must be present in the band) and proves all four audit mutants now FAIL (4/3/1/2).
**RE-DERIVED, THE CONCLUSION HELD AND SHARPENED:** ratio-only keeps 100% precision across 7 seeds
(448 sessions, 0 wrong) and its mix lands 47.9% vs a 47.6% truth — the closest of every candidate.
The audit's own sharper claim (that `editAddRatio: 0.65` beats 0.50 on all three criteria) was
ITSELF an artifact of the void: on the corrected fixture it costs 35 wrong calls (90.5% precision).
The thresholds did not move. **A synthetic fixture can prove a rule INSENSITIVE; it cannot CALIBRATE
a cut-point** (tuning thresholds on data invented by the same author who chose them is circular the
other way) — real calibration needs real ledger rows. `phase.sweep.probe.test.ts` prints the
distribution, the overlap band and the full sweep; read it before touching a threshold.

**Three provenances, not two.** §A6.1 names measured + judged; the heuristic is neither (a rule
anyone can re-run — not AI; still an inference — not a measurement), so it gets its own tag/legend
`estimated`. STRUCTURAL, not conventional: a series' style is a function of `series.provenance`
(`charts/series.ts`) with no style prop anywhere, so no caller can paint AI output as a measured bar.
Judged = hatched amber, reusing `--iw-badge-ai` (the amber CitationPanel already uses for AI-sourced
material). Two series sharing a provenance vary by TONE only — never by identity.

**The §A6.2 gate is enforced in the UI, not the prompt** (`selectClaims`): daily is a descriptive
recap and pattern/causal claims are withheld there — and SHOWN AS withheld (§A9: never silently
dropped), pointing at the weekly view. PROVED BOTH WAYS by mutation: forcing the gate open fails 3
tests, forcing it closed fails 2 — a gate that can't fire is a feature silently disabled.
`summary.ts` holds the §A5/§C3 kind, non-shaming copy as pure functions so the constraint is
testable; `summary.test.ts` sweeps every day shape for shaming/target/scoring/causal language and
proves the matchers fire on 17 banned strings. NO RED anywhere in the palette — cutting is writing.
(The first cut of that matcher could NOT catch "productivity down 40%": `down\s+\d\b` fails between
"4" and "0". A matcher that can't catch the thing it names is the house disease in miniature.)

**THE DEFENSIVE CLAMP THAT LAUNDERED A BROKEN FORMULA — the F2 audit finding (2026-07-17).**
`pearson()` shipped as `clamp(num/den, -1, 1)`. The audit dropped the Y spread from the denominator
(`sqrt(dx2*dy2)` → `sqrt(dx2*dx2)` — i.e. NOT Pearson's r at all) and **the whole 1054-test repo
stayed green** (reproduced before fixing). Two things combined: every fixture was degenerate (on the
perfect-positive case the mutant computes r=2 and the clamp returns exactly the 1 the test asserts),
and the ONE non-degenerate fixture asserted only `-1 ≤ r ≤ 1` — **which the clamp guarantees by
construction**. A vacuous assertion sitting on the only data that could have caught it. User-facing:
it feeds `breakVsOutput`, so the mutant would show the writer r=1.0 ("your breaks predict your
output") where the truth is 0.696 — vibes-as-numbers presented as MEASURED, §A6.1's exact failure.
FIXED: that assertion is now `toBeCloseTo(0.696, 3)` plus symmetry and scale-invariance properties
(a denominator that drops an axis is asymmetric and scale-sensitive by construction). **AND THE
CLAMP IS GONE**: for a correct Pearson, Cauchy–Schwarz makes |r| ≤ 1 always, so a wide clamp is
UNREACHABLE in working code and its only possible effect is to disguise a broken formula as a
plausible number. It now snaps only the floating-point hair (±1e-9) and REFUSES anything grossly out
of range — an impossible measurement must stop being reported, not be rounded into looking fine.
Mutation-proved: drop-Y now fails 6 tests (3 from the value assertion, 3 more from the guard).
**THE SHAPE TO REMEMBER: a defensive clamp on a quantity with a provable range is not safety — it is
a silencer.** F3 (also real): pearson's `n`-truncation had never been exercised (every fixture passed
equal-length arrays, so `mean(xs.slice(0,n))` → `mean(xs)` survived); now covered both directions
plus the min-sample gate applying to the TRUNCATED length. Five pearson mutants die (3/6/4/2/2).

**Tests are the deliverable's spine** — 122 across `phase`/`phase.variants`/`phase.thresholds`/
`phase.sweep.probe`/`aggregate`/`judged`/`summary`/`charts`. Fixtures (`fixtures.ts`) generate from labelled BEHAVIOURAL processes
whose ranges deliberately straddle the rule's cut-points, so the classes overlap and the rule CAN
fail; an inverted-classifier known-negative proves the scorer isn't measuring a fiction. Ledger tests
carry explicit UTC offsets — a suite that passes only in Australia/Brisbane is a check that can't see
its own failure. PRE-EXISTING, NOT THIS LANE'S: `vite preview` throws React hydration errors (#418/
#423) on EVERY route — /about and /verify included, 28 apiece — which strips `<html data-theme>` (the
recovery failure entry.client.tsx:100 documents), so the screenshot probe asserts the theme attribute
directly.

## Productivity ledger (P1a-core, 2026-07-17 — `src/productivity/`, flag `inkwave:prodLedger`, DEFAULT OFF)

Session capture + a per-month ledger, per the Productivity/Email build spec §A3–A5. **The surface is the
TOOLBAR'S CLOCK DROP-UP (`components/ClockMenu.tsx`) — `/ledger` the route is GONE** (Peter, 2026-07-17:
"make the ledger a drop up rather than a new page"; a Pomodoro you must navigate away to reach is not one
you would use while writing). **The schema (`types.ts`) is a CONTRACT** — `feat/prod-graphs`,
`feat/prod-ai-report` and the email layer all read `SessionRow`. snake_case is deliberate (it is a CSV/wire
contract, not repo style); don't "tidy" it. `types.ts` is now the ONE contract file: the AI-report path's
type-only mirrors were folded in on rebase (its aggregate shapes kept verbatim; its SessionRow/DocType
mirrors deleted — the real schema supersedes them, and the names matched already).

### The clock UI (2026-07-17 — Peter's UI round)

- **THE CLOCK IS A SLOT, not a button bolted on the bar.** `SlotId` gains `'clock'`; the row is
  `slotCount()` = 6, or **7 when `?prodLedger` is on** — so a writer without the feature sees no width
  change at all. It migrates the way CLAUDE.md's own 4→6 note documents (append), and is DROPPED from a
  stored row if the flag goes off, so a 7-slot config can't strand an unrenderable id. Reorderable +
  ▲-overflowable like every other slot. PROBED on a 390px iPhone viewport: 7 slots + ▲ + ⋮ FIT.
- **THE TICK NEVER RENDERS REACT — the whole design.** `pomodoroStore.ts` is a module store with TWO
  channels: `subscribe` (state: start/pause/phase/config — RARE, React may use it) and `subscribeTick`
  (the NUMBER, once a second — IMPERATIVE ONLY). `TimeFace`/`TimeRing` write `textContent`/
  `strokeDashoffset` off the tick; the store's interval exists only while a phase counts down. A
  `setState` per second inside TiptapEditor's tree would re-render it every second, forever, while
  someone is typing — the `--wave-x` shape. KEPT IN THE GATE by `components/TimeFace.test.tsx`
  (mutation-proved: the obvious setState-per-second TimeFace kills 2 tests).
  **THE IN-BROWSER TYPING A/B IS VOID ON THIS BOX, and the probe says so rather than passing:** a
  deliberate per-second 40ms main-thread block moved keydown→rAF p95 only 1.20-1.28× — the harness
  could not see its own known-positive through other agents' concurrent probes (idle p50 wandered
  4.8→9.2ms between runs), and RUNNING scored *noisier* than the block. Two instrument lessons: a
  per-second event lands on ~1 of 50 keystrokes so a MEDIAN is structurally blind to it (read the tail);
  and the first known-positive wrote `--wave-x` per second, which costs nothing because the shipped
  FIREBREAK prunes exactly that write on a near-empty document. Re-run on a quiet box for a number.
- **The countdown** (`CountdownOverlay.tsx`): faint grey, top-right, DESKTOP only, only while a block
  runs (parking 25:00 over the prose forever is noise), click → opens the drop-up. It is PORTALLED TO
  `document.body` — a SIBLING of the editor, never a descendant — plus `contain: layout style paint`, so
  its per-second write cannot reach the page subtree BY CONSTRUCTION. PHONE: not rendered (the corner is
  the writing area there); the drop-up's own face is the phone's countdown.
- **Chimes are customisable with previews** (`chime.ts`): five SYNTHESISED voices (bell/bowl/glass/wood/
  harp) — sine partials + slow exponential release, no audio assets on a writing app's load path. A
  preview plays from a TAP, which is also the gesture iOS needs to unlock the AudioContext for the real
  chime later. Every voice is gentle by construction: this interrupts someone who is writing.
- **NIGHT MODE FOUND A REAL BUG — `--iw-on-ink` is new (2026-07-17).** The filled controls (Start, the
  active preset pills) were `color: #fff` on `background: var(--iw-ink)`. `--iw-ink` is DARK purple in
  day (white reads) and LIGHT purple in night (#cbb8f2 — white VANISHES). Measured on screenshots, not
  reasoned about. `--iw-on-ink` (day #fff / night #2c2e35) is the token for text on an ink FILL — same
  shape as the existing `--iw-newbtn-fg` ("darker on its light-blue chip in night"). **Any new filled
  control must use it; a literal white on an --iw-ink fill is a night-mode bug by construction.**
- Lengths are PRESET PILLS (the PageMenu pattern), not bare number inputs. §A5 holds: completed blocks
  are DOTS, not a number to beat; no red anywhere.

- **The flag is `ledgerFlag.ts` (`?prodLedger=1` / `=off`, sticky), NOT `flag.ts`** — that one is the AI
  report's (`?prodReport`). A `flag.ts`/`flags.ts` pair in one directory is how someone imports the wrong
  feature and never notices; hence the rename.
- **`sessions` at weekly/monthly is `[]` — DECIDED (2026-07-17), answering prod-ai-report's contract ask.**
  Opted-in notes travel as `note_digest` (per LOCAL day) instead. The serious reason is §A6.4: shipping
  session rows at monthly puts a SECOND copy of every measured number in the payload beside the day
  rollups, and two copies is exactly how a narrative ends up contradicting the bars. One representation of
  measurement, always. (§A6/§A7's "rollups, not raw logs" is the second reason; the note TEXT dominates
  tokens either way, so the digest costs the writer's own words and nothing more.) COROLLARY: "where do I
  work best" must be a MEASURED client-side by-place rollup, never inferred by the model from raw rows.
- `installSource.ts` fills prod-ai-report's `setAggregateSource` seam with `aggregate.ts` (real §A3.3
  rollups from the real ledger). Gated on the ledger flag: with capture OFF there is no source, so the
  panel says "tracking is off" rather than measuring an empty ledger and reporting "you did nothing".
  It never clobbers the labelled `?prodReport=demo` fixtures.

- **TYPING COST IS THE WHOLE DESIGN.** The tap rides the EXISTING `onTransaction` stream and reuses
  `countSteps` (provenance/cadence.ts) — no new content instrumentation. Per keystroke it does: countSteps →
  compare 2 numbers → increment 3 fields. **MEASURED (Node, 13k-word doc): 0.30µs/keystroke, flat from 200 →
  40k words (0.39µs → 0.52µs); disabled gate 0.07µs.** The known-positive in `capture.perf.test.ts` (one
  `countWords` walk = 1.97ms, 6581×) proves the harness can SEE an O(doc) cost before its verdict is read.
- **THE BASELINE TRICK (why words_start is free):** a session boundary IS an inactivity gap, so the document
  cannot change while nobody edits it ⇒ the word count at the previous CLOSE is exactly the next session's
  `words_start`. Every O(doc) number (words_end, the word diff) is computed at CLOSE, never on a keystroke.
  Idle is found by ONE 30s interval — never a clearTimeout/setTimeout churn per input.
- **GROW-ONLY (§A9 + the real 2026-07-05 truncation incident):** every write reads the target and UNIONS
  first (`mergeLedgerRows`, keyed by session_id). LWW only within one session_id: later `end` wins, then more
  edit_events, then the RICHER row — that last clause stops a plain copy syncing in from another device from
  erasing a diary note (annotating does NOT change `end`).
- **DAILY ATTESTATION BLOCKS ARE NOT CHAINED TO EACH OTHER — deliberate, a failing test forced it.** A
  cross-day prevHash chain makes any late append (the NORMAL multi-device case) invalidate every later day's
  blockHash and burn its Bitcoin anchor. Each day hashes only its own rows (bound to month+day) and is
  independently OTS-anchorable — exactly how snapshots already work (they aren't chained either; the chain
  lives inside a signing session). Proofs carry over iff the blockHash is unchanged. OTS stamping runs on
  demand for CLOSED days only, NEVER on load (the ~10s sweep rule).
- **`wordDiffStats` (capture.ts), not raw `diffWords`:** diffWords tokenises as [word][trailing-whitespace]
  for display round-tripping, so a 2-word addition measured 3 added + 1 deleted; and `diffStats` counts \S+
  while `countWords` counts [\p{L}\p{N}]+, so `added-removed` would contradict `net_words` in the same row.
  Both are pinned with a live known-negative. HONEST LIMIT: churn that nets out inside one session isn't
  counted (that evidence is the paid cadence tap's, not the ledger's).
- **§A9 time:** `start`/`end` are ISO-8601 WITH the local offset — one field carrying the UTC instant AND
  the offset, so the local day is recoverable. Never emit a bare `Z`.
- **Location: there is NO location collection and no `navigator.geolocation` anywhere.** `place` is a word the
  writer TYPES ("library"), same class as their `note`. Peter overruled §A3.2 to want location, then chose
  user-labelled (2026-07-17). Do not "upgrade" it to real location without re-reading §A3.2 and asking him.
- **`note`/`place` are USER PROSE, not telemetry** — OFF by default, their own opt-in (§A7.3). WHAT ENFORCES
  IT: `report/compile.ts`'s ALLOW-LIST (it NAMES every field that leaves; note/place are not among them) +
  the `includeNotes` gate, default false. **`LEDGER_PRIVATE_FIELDS`/`stripPrivateFields`/`PublicSessionRow`
  are GONE (2026-07-17)** — that deny-list had ZERO non-test callers on every branch incl. master while
  types.ts called it "the DEFAULT payload shape" and `/privacy`'s header cited it as the enforcing mechanism.
  The property held (the allow-list is real, so this was never a leak) — the danger was quieter: editing
  `LEDGER_PRIVATE_FIELDS` to protect a new field would have done NOTHING, silently. Two rules for one
  question, only one live, docs pointing at the dead one. **Do not reintroduce a deny-list** (compile.ts's
  banner has the argument: it fails the opposite way, and that failure is silent); name new columns in
  compile.ts instead. `/privacy` MUST stay in sync and MUST name the guard that is real.
- **`doc_label` IS TIER 1 (ungated); its §A3.2 suppression is now REACHABLE (2026-07-17).** `/ledger` has a
  **Titles** section listing every document the month recorded, with a per-doc Hide/Record toggle wired to
  `setLabelSuppressed` — which until now had ZERO non-test callers, so the mechanism was live and nothing
  could turn it on. It changes what FUTURE sessions record: rows already written sit inside an attested
  daily block, and silently rewriting history is the one thing the ledger exists to make impossible.
  STILL OPEN (Peter's call, proposal with the lane's report): the sharp case is the EXPORT, not the local
  file — the ledger never leaves the device, so the disclosure happens at §A7.3's tick-box. Proposed there:
  a per-document **pseudonym** ("Document 1") rather than dropping the label, which keeps §B1's "40m on
  email" readable while the title stays home. That screen is prod-ai-report's; not built unilaterally.
  THE ORIGINAL FINDING, kept for the argument:
  `isLabelSuppressed` is wired into capture.ts's close path, but `setLabelSuppressed` has ZERO non-test
  callers: no UI turns it on, so in practice EVERY title travels to the AI in tier 1. A title is
  writer-authored prose, so compile.ts's tier-2 rationale ("tiers 1 and 3 alone would let the writer's own
  prose ride out inside 'metadata'") applies verbatim. Why tier 1 is nonetheless right for it: a label is the
  IDENTIFIER of the measured thing, not an extra disclosure — drop it and §B1's "40m on email" cannot be read
  (every row becomes `doc-a1b2f3`), and §A7.3's tick-box lists documents BY LABEL at the moment of consent.
  That covers the ordinary case, not the sharp one ("Chapter 3 — my mother's illness") — which is exactly why
  §A3.2 asks for per-doc suppression. **The missing control is a real gap; placement is a consent decision.**
- **§A5 is a hard constraint:** kind, non-shaming, no scoring. The day summary leads with TIME and SESSIONS;
  a cutting day reads "editing is writing too". Nothing here may grow a red number.
- **CLOUD SYNC IS WIRED (2026-07-17) — `ledgerSync.ts` + `ledgerRemotes.ts`, and it is shaped by the
  2026-07-15 blind overwrite.** The ledger is its OWN file beside the .studio (`inkwave-ledger-2026-07.json`),
  never inside it (the .studio is per-document; the ledger spans all of them). READ-MERGE-WRITE, always:
  - **A FAILED READ IS NOT AN EMPTY REMOTE.** `RemoteRead` is a discriminated union with NO `null` member —
    'absent' (safe to write) and 'error' (never write) are different words and the type system enforces it.
    That distinction IS the 2026-07-15 bug. Malformed/truncated JSON and a wrong-month file are ERRORS, not
    empty ledgers. MUTATION-PROVED: treating 'error' as empty kills exactly the "FAILED READ WRITES NOTHING"
    test; writing local instead of the union kills 5.
  - **NO ONCE-PER-SESSION MERGE GATE.** `syncToOneDrive` merges the remote's snapshots once per session
    because re-reading a 20MB .studio per save is real lag. A month of rows is tens of KB, so the ledger
    takes the safe path on EVERY write. The file's cheapness buys the stronger invariant — don't copy the gate.
  - `mergeIntoLocalLedger` re-reads local INSIDE the per-month write chain (the read-to-write gap is where a
    blind overwrite lives); a row queued mid-sync is pinned by a test.
  - Sync is debounced + single-flight, runs only at session boundaries, and is **DYNAMICALLY imported**
    (`ledgerRemotes-*.js`, 4KB) — PROBED in the real browser: 0 requests on the editor's load, >0 after a
    close (the known-positive, so "never fetched" can't be a blind detector reporting success).
  - ONEDRIVE is the only adapter (the live provider). Drive/folder take the same `LedgerRemote` shape and are
    deliberately NOT written blind — an absent-vs-error mapping never exercised against the real API is the
    guess that becomes a blind overwrite. **STATED, NOT PROBED: Graph 404 ⇒ absent.** It fails SAFE (a wrong
    mapping means sync never starts, never that data is lost), but it needs Peter's account to confirm live.
- **F5 (test auditor) FIXED BEFORE IT WENT LIVE:** `mergeLedgers` returned `attestations: []` — harmless
  while unwired, a proof-shredder the moment sync called it (every write-back would drop both devices'
  Bitcoin anchors and re-stamp the month). It now offers BOTH sides' proofs to `buildAttestations`, which
  keeps one only where it still attests the recomputed block, preferring the strongest (confirmed > pending).
  Mutation-proved: the original bug restored verbatim kills 3 tests.
- **`doc_type` DEFAULTS TO 'essay' — DECIDED (2026-07-17), and there will be no heuristic.** Nothing in the
  document model distinguishes a note from an essay, and inventing a rule (length? title?) is the
  vibes-as-numbers §A6.1 forbids for a measured field. Inkwave's documents ARE prose documents, so 'essay' is
  the honest default and the email layer's explicit `docType: 'email'` — the one distinction any feature
  actually reads (§B1's "40m on email") — flows through untouched. If note-vs-essay ever earns a feature it
  needs a field the WRITER sets, like the email lane's, never a guess.
- NOT wired: at-rest ENCRYPTION — the repo has no encryption layer for ANY document (spec §C2 assumes one),
  so the ledger inherits the same posture. Google Drive / local-folder ledger adapters.

## Email layer — P1b (2026-07-17, `src/email/`, flag `?email`, DEFAULT OFF)

Spec: `Inkwave-Productivity-Email-BuildSpec-v0.2.md` §B (Peter's private doc — read it, never copy it
into the repo). MVP = compose in Inkwave, count it in the productivity ledger, OTS the draft, hand
off to the provider to send. Inkwave never sends mail and never touches an inbox.

**An email is an ORDINARY document — that is the whole design.** `docType: 'email'` + an `email`
header block (To/Cc/Bcc/Subject) on InkwaveDocument; the BODY is `contentJson`. Edit history,
provenance hashing and ledger session capture apply because it is an ordinary document, not because
anything in `src/email/` arranges it. Don't grow a parallel email path.

**THE HONESTY BOUNDARY (§B2.2/§C1.4 — existential, not cosmetic).** OTS proves *this content existed
by time T*. It does NOT prove sending, delivery, or origin. Proof of origin needs DKIM (Phase 3, not
built). The handoff hands the draft to the provider's compose window and the user can edit before
sending — so the provenance is of the *Inkwave draft*, not the sent bytes.

⚠️ **THERE IS NO AT-REST ENCRYPTION IN THIS BUILD — DO NOT SAY THERE IS** (verified in the code
2026-07-17). Spec §C2 says at-rest encryption is "default on" and the P1b brief repeated it as fact,
but it is design INTENT: `storage/opfs.ts` writes `JSON.stringify(data)` through writeOpfsFile in
PLAINTEXT, `crypto.subtle.encrypt`/AES-GCM appear NOWHERE in src, and package.json carries no crypto
library. Documents, snapshots and emails are gzip'd JSON in OPFS — protected by the browser's origin
sandbox and the device's own disk encryption, not by Inkwave. The email copy shipped "stored
encrypted on your device" until the code was checked; it now says "stored on your device — we never
hold it", which is TRUE (zero-retention is real: there is no server holding it). `copy.test.ts`
guards this with a matcher. **Copy tracks the CODE, not the spec** — the spec is a plan, and a plan
is not a property. When §C2's encryption ships, the word can come back. NOT E2E either, ever, unless
the recipient runs PGP/S-MIME.

ALL of the EMAIL lane's in-product copy lives in `src/email/copy.ts` (one source
of truth) and `copy.test.ts` asserts the forbidden claims are absent — each matcher proved to fire on
known-bad copy AND not to fire on an honest control FIRST, because "assert the bad phrase is absent"
passes trivially on empty or broken matchers. The control earned its keep immediately: the naive
matchers flagged "It does not prove that you sent the email" — they could not tell an assertion from
its denial. Hence two matcher classes (affirmative-only vs literal). If new copy sounds better than
"you had written exactly this by this time", it is wrong.

**Hashing — `bundleHash` gained a v:3 form.** v:1 `{contentHash,receipts}` / v:2 adds `bibHash` /
**v:3** `{v:3,contentHash,bibHash:…|null,emailHash,receipts}` when the doc is an email. Snapshots
freeze `email` + `emailHash` exactly as they freeze `bibliography` + `bibHash`; verify recomputes
both and folds them into the bundleHash recompute, so OTS genuinely BINDS the headers. Non-email
docs keep v:1/v:2 BYTE-IDENTICALLY — every already-anchored snapshot verifies unchanged (asserted
against literal canonical forms, not against the function's own output). Headers are canonicalised
before hashing (`email/headers.ts` normaliseHeaders: address lowercased, display name kept,
whitespace collapsed, de-duped, order PRESERVED, absent cc/bcc ⇒ `[]`) so one header set has exactly
one anchored hash. That rule is a provenance boundary like pmToText — changing it changes what past
anchors mean. `pmToText` itself is UNTOUCHED.

**PROVED, not assumed** (`email/roundtrip.test.ts`, 13 tests): drives the REAL
createSnapshotIfChanged → gzip archive → stampSnapshot → buildExportBundle → verifyBundle, with an
in-memory OPFS shim (`email/testOpfsShim.ts`, test-only) and fetch stubbed at the network boundary
only. Asserts the digest submitted to the calendar IS the v:3 bundleHash (not contentHash), and that
tampering with a recipient / subject / bcc / body, STRIPPING the headers (downgrade to v:1), or
tampering-and-recomputing emailHash all FAIL verify. A round-trip that only ever passes proves
nothing.

**Sending — `MailSender` (§B3)**, one interface, `email/sender.ts`. Only adapter today: `handoff`
(Gmail/Outlook compose URL, `mailto:` fallback), no OAuth. Gmail API send (`gmail.send`) is Phase 2
and needs Google's restricted-scope verification — it slots in as another MailSender. If an API
adapter ever lands it is SEND-ONLY; never request inbox-read (§B5). `SendOutcome` has no `'sent'`
variant on purpose — the handoff genuinely cannot know. Over-long drafts are REFUSED, never
truncated (mailto 2000 / web compose 8000 chars, conservative).

**Ledger seam (§A3.2 `doc_type`):** this layer sets `docType: 'email'` on the document and NOTHING
else; `productivity/capture.ts` `resolveDocType(doc)` reads it and tags the session row. The two
branches agreed on this contract independently — the ledger's own comment says "the email layer sets
`docType: 'email'` explicitly and it flows through untouched" — so no field negotiation was needed.
The ledger owns RESOLUTION (its `DEFAULT_DOC_TYPE` is 'essay' for untyped docs); this owns the
classification only. An accessor with a competing 'note' default was written here and REMOVED before
commit: two rules for one question is how implementations drift. MERGE NOTE: `DocType` is declared
in BOTH `types/document.ts` and `productivity/types.ts` (identical unions, written in parallel) —
whichever lands second should import from `types/document.ts` rather than keep the copy.

**Live probe:** `scripts/email.prove.mjs` (headless, own port, nothing on Peter's screen) drives the
REAL built app: flag-off → no panel, `?email=1` → menu → panel, the copy, header PERSISTENCE across
a reload, finalise → frozen canonical headers + emailHash, and asserts the digest the browser
submits to `/api/ots` is the v:3 bundleHash and NOT the contentHash. 16/16. It caught two bugs the
unit tests structurally could not: a header edit never called `scheduleSave` (autosave is driven by
the editor's own update handler, which a header field never fires — headers lived in React state and
died on reload), and `ensureDocFresh` overwrote an email's subject-derived title with the first line
of the BODY. Its copy checks VOID rather than pass when no panel renders — "no forbidden claim" on a
page with no copy is a pass that means nothing, and it did exactly that on the first run.

TRAPS FOUND HERE (both the house speciality): (1) `listSnapshots` serves from a write-through
in-memory cache, so reading back through the same module instance NEVER touches the archive — the
first cut of the persistence test passed while proving nothing; it now resets modules for a genuine
cold gunzip. (2) That cold read exposed a REAL latent bug in `workers/parseClient.ts`
`inlineGunzipJson`: it wrote a raw ArrayBuffer to DecompressionStream, which REJECTS the chunk — and
both promises were `void`ed, so it HUNG forever instead of throwing, defeating the caller's
try/catch. The no-Worker fallback (node/vitest/prerender) had never once been exercised. Fixed
(write a Uint8Array view).

## §C1.4 copy guard — PRODUCT-WIDE (2026-07-17)

The matchers live in **`src/copy/claimMatchers.ts`** (extracted from `email/copy.test.ts`, byte-for-byte,
NOT copied — two copies of these regexes is how one guard silently stops catching what the other does).
Two consumers: the email suite (semantics unchanged, still its own verdict) and **`src/copy/claims.test.ts`**,
a REPO-WIDE sweep of string literals + JSX text across `src/` + `extension-src/`.

- **Why:** `ALL_COPY = Object.entries(copy)` only ever saw ONE file while its describe block read "the real
  in-product copy makes no forbidden claim". §C1.4 is a PRODUCT rule — nothing stopped another lane shipping
  "stored encrypted on your device" with that suite green, and the music lanes are being built against a spec
  whose §0 asserts encryption at rest **which this build does not have**. PROPHYLACTIC: 0 violations today.
- **Scope is deliberate, and both exclusions are asserted, not assumed:** comments are STRIPPED (this repo's
  comments must NAME the forbidden claims in order to forbid them — a guard that can't survive its own
  documentation gets disabled); test files + `claimMatchers.ts` are skipped because they carry `knownBad`
  BY DESIGN. A test asserts the fixture carrier is imported by tests ONLY, so the exclusion can't become a
  hole. VOID conditions fail the suite if the sweep sees <50 files or extracts <200 strings — an empty sweep
  must fail, never pass.
- **PROVED IN SITU:** planting overclaims in REAL production files (`email/copy.ts` AND `routes/Privacy.tsx`
  JSX — a non-email lane) fails the sweep; restoring them greens it.
- **A REAL HOLE WAS FOUND AND CLOSED in `affirmativeOnly`.** The split was punctuation-only, so a negator
  anywhere in an unpunctuated clause deleted the WHOLE clause — overclaim included. Measured:
  "Every note is tamper-proof." → caught; "…, and we cannot read it." → caught; **"…and we cannot read it."
  → MISSED**. One absent comma hid a forbidden claim. Now splits on and/but/though/although/while/yet,
  proved both ways (every knownBad still fires; the honest control still fires nothing).
  **KEEP NEW AFFIRMATIVE MATCHERS CONJUNCTIVE** — the finer split exposes short clauses standalone
  ("that it arrived"), which is safe only because each matcher needs its "prov…" stem in the SAME clause.

## Productivity + email INTEGRATION (2026-07-17, `feat/prod-integrate` — the four lanes merged)

P1a-core (ledger), P1a-viz (graphs), P1b (email) and P1c (AI report) were built in parallel and are
now ONE layer. What was decided on the merge, and what the merge FOUND. **All flags stay default OFF**
(`prodGraphs`, `prodReport`, `prodLedger`, `email`) — verified, not assumed.

- **ONE SCHEMA: `productivity/types.ts`.** prod-graphs' `ledger.ts` was an explicit placeholder mirror
  of §A3.2 ("THE LEDGER SEAM: a one-line import swap when feat/prod-ledger lands") — retired exactly
  as it anticipated. `LedgerSession` → the real `SessionRow` everywhere. `ledger.ts` is now the real
  per-month ATTESTED ledger; the mirror's five time functions moved to `sessionLogic.ts`, which
  already owned `localDayOf` — one rule for one question. Its tests live on verbatim in
  `dayKeys.test.ts` (imports re-pointed, not one assertion changed).
- **`DocType` is declared ONCE, in `types/document.ts`** — a document's own property; the ledger READS
  it (`capture.ts` resolveDocType owns the absent→default rule). `productivity/types.ts` re-exports.
  Two identical unions are not harmless: they drift the first time one side gains a member.
- **ONE `aggregate.ts`, TWO output shapes — and that is NOT a fork.** `DayAggregate` (types.ts,
  snake_case) is the §A3.3 WIRE contract the report emits; `ChartDayAggregate` (camelCase) is the
  charts' view model (prod-graphs' `DayAggregate`, renamed — the wire name belongs to the schema
  owner; two exported types sharing one name in one module is how a caller silently gets the wrong
  contract). `busiest_hours` (start-hour) and `hourHistogram` (apportioned across the span) BOTH
  conserve total active minutes, so they cannot contradict each other on any total — they differ only
  in distribution WITHIN a day and each documents its own limitation. Collapsing them would have
  silently rewritten a lane's measured behaviour to make a merge look tidy.
- **The deep-vs-shallow heuristic is RATIO ONLY — no duration.** Do not let a future merge quietly
  reintroduce it; the measurement (39% coverage / 84%-called-drafting vs a 48% truth) is in phase.ts.
  Three provenance tags stay: `measured` / `estimated` / `judged`.
- **THE SILENT BREAK THIS MERGE FOUND (the house disease, live).** `report/compile.ts` read tier-2
  notes off `agg.sessions` at EVERY window — an assumption written BEFORE prod-ledger answered the
  contract question. The ledger's answer: `sessions: []` at weekly/monthly, notes travel as
  `note_digest` per local day (§A6.4 — rows at monthly would put a SECOND copy of every measured
  number beside the day rollups, and two copies is how a narrative ends up contradicting the bars).
  Result: a writer who ticked "include my notes" on a weekly or monthly report got NO notes,
  `notesIncluded: false`, and no error anywhere. **Both lanes' suites were green** — the `?prodReport
  =demo` fixtures still carried the pre-answer shape, so the path a developer eyeballs worked while
  the real ledger's did not. compile.ts now reads `note_digest` first (session fallback kept for daily
  + demo); the fixtures now mirror the decided contract. A demo whose shape the real source never
  produces is a fiction to build against.

**THE JOINT PROBE — `productivity/emailLedger.integration.test.ts`.** §B1's primary goal ("2h10m
writing, of which 40m on email") had never been verified by anything: the email lane owns
`docType: 'email'` but had no ledger to tag; the ledger lane owns the row but nothing in its tree ever
set `docType: 'email'`. It drives the REAL chain — `newEmailDocument` → `SessionCapture` (real PM
steps) → the real debounced `ledgerStore` on a real OPFS shim → the real §A3.3 `aggregate` → the real
`compilePayload` — and asserts 130 active minutes of which 40 are email, with no message text or
address anywhere in the ledger or payload. **PROVED TO FIRE, both directions:** mutate
`resolveDocType` to ignore the document (the real silent bug — every email minute filed as 'essay')
⇒ 4 §B1 tests fail; hard-wire it to 'email' ⇒ the known-negative fails. No constant passes both.

**TEST-HARNESS TRAP, and it cost a real detour.** `storage/opfsWrite.ts` decides ONCE AT MODULE LOAD
whether OPFS writes use createWritable or the parse worker (`hasCreateWritable`), and node has
neither. Under STATIC imports that constant is already false before any `beforeEach` can install the
OPFS shim, so every ledger write routes to a worker that does not exist, throws, and is SWALLOWED by
`writeAppJson`'s catch — the probe then reads an empty ledger and concludes "the email row never
arrives", which is exactly the fiction it exists to detect. Install the shim, THEN `await import()`
the modules under test (`vi.resetModules()` first) — `feat/email-compose`'s `roundtrip.test.ts` does
this for the same reason, and its comment about `_snapCache` is the other half of the same discipline.
`testOpfsShim` also gained `text()`: `storage/opfs`'s readJson reads TEXT where snapshots read
arrayBuffer, and its absence surfaced only as an empty ledger.

## Music module — photo score + reflow + markup (2026-07-17, `src/music/`, flag `?music`, DEFAULT OFF)

Spec: `Inkwave-Music-Module-BuildSpec-v0.1.md` §A1/§A2 (Peter's private doc — read it, never copy it
into the repo). Build order step 1 of 7. `/music` is the surface; the studio, the detector, pdf.js and
all canvas work sit behind a lazy import (`MusicStudio` 29kB/11.3kB gzip; route stub 2.3kB) so OFF
costs nothing BY CONSTRUCTION — the editor bundle is untouched.

- **⚠️ NO OMR, EVER (§0, repeatedly).** The CV is barline/whitespace GEOMETRY only: row darkness,
  longest horizontal run, longest vertical run. Nothing recognises a note, and nothing may. The score
  is **markup-only, never editable** — no field on `Piece` changes a note. Inkwave consumes
  Sibelius/MuseScore/Dorico output; it does not compete with them.
- **`music/types.ts` IS A CONTRACT** — the §1 `Piece`. Two other lanes (MusicXML §B, lesson capture
  §A3) build against it. snake_case is deliberate (a document/wire contract written as the spec
  writes it, so three lanes reading one spec converge); don't "tidy" it. ADD to it; never redefine a
  field in place. `Anchor` is a discriminated union (`region` for photo | `musicxml` for notation)
  with `bar_index`/`bar_label` as the JOIN KEY on both (see the BarRef ruling below) — that is what
  links a lesson note, a heatmap range and a recording to the same music whichever path the Piece
  came in through.
- **⚠️ `bar: number` IS GONE — IT MEANT THREE DIFFERENT THINGS AT ONCE (2026-07-17, the Piece owner's
  ruling, raised by the MusicXML lane which refused to fork).** One field name was being read as: the
  MusicXML lane's `Measure.index` (a 0-based ORDINAL), the lesson lane's `{bar: 24}` (a number a
  TEACHER TYPED, i.e. a printed label), and the heatmap's `bars: [a,b]` (an ordinal RANGE). The facts
  that decide it come from `parse.ts`, not from taste: **a printed bar number is a STRING by MusicXML
  spec** ('0' pickups, '8a'/'8b' repeat endings) **and is NOT UNIQUE** (`indicesOfPrintedBar` returns
  an ARRAY; multi-movement files restart at 1; `onlyIndexOf` REFUSES ambiguity). A value that can
  match two different bars cannot be a key. So:
  · **`bar_index`** — 0-based ORDINAL, identical to `parse.ts` `Measure.index` (no conversion for that
    lane, and nobody misreads `bar_index: 23` as "bar 23"). Sortable, rangeable. THE JOIN KEY.
  · **`bar_label`** — the bar as PRINTED or SPOKEN. Display + citation. Ambiguous. NEVER a key.
  BOTH OPTIONAL, and that is the point: they are known at different times. A teacher saying "bar 24"
  mid-lesson on a PHOTO piece gives a label and nothing else — that Piece has no bar model until
  barlines are tapped (§A4) or pre-detected, so there is no ordinal and inventing one is a guess.
  Carry what you know; resolve later; never fabricate the key. FOUND ON THE WAY: `LessonPanel` did
  `Number(bar) > 0` on the teacher's typed value, so **'8a' → NaN and '0' → false BOTH silently
  dropped the anchor** — the note attached to nothing, no error. It stores the label verbatim now.
  **Carry what you know; resolve later; never fabricate the key.**
  `LessonNote`/`Assignment` are declared ONCE — in `types.ts`, the CONTRACT — and IMPORTED by
  `lesson/types.ts`. The direction was WRONG on this branch first (types.ts imported them FROM the
  lesson lane), which went circular the moment that lane unforked: §1 itself declares
  `lesson_notes: [LessonNote]` and spells the type out, so it is a contract type the lesson lane
  FILLS, not a lesson type the Piece borrows. Both lanes reached "declare once" independently; only
  the arrow needed settling.
- **`Anchor` HAS A THIRD VARIANT — `BarAnchor` `{kind:'bar', bar_index?, bar_label?, page?}` (2026-07-17),
  answering the lesson lane's `BarOnlyAnchor` ask.** That lane found §1's union could not express
  **"bar 24" alone** — which is ALL a student has mid-lesson, typing while their teacher talks on a
  photograph whose barlines may never be marked — and REFUSED all three dishonest ways round it
  (fabricate a `region` rect the student never drew; misuse `MusicXmlAnchor` on a photo Piece; fork
  its own anchor). It was right on every count. The variant is not a special case bolted on: it is
  what BarRef's "both optional" MEANS, made reachable. It carries NO region and **must not grow
  one** — the moment it can hold coordinates, the temptation returns to fill them with a guess,
  which is the exact lie that lane refused. `page` is a HINT for later resolution, never an address.
  Consequence: `PinnedLessonNote` is GONE (the bar rides inside `LessonNote.anchor`, where §1 always
  said it belonged) and a bar-pinned lesson note round-trips into `Piece.lesson_notes[].anchor` for
  real. NB the ask proposed `bar: number`; the answer is `bar_label` (a teacher SAYS a label), with
  `bar_index` left absent until there is a bar model to resolve against.
- **THE HEATMAP (§A2, step 5 — `heatmap.ts` pure + 21 tests, `HeatmapScreen.tsx`).** Sweep a Pencil
  across bars, pick a colour. **MANUAL ANNOTATION, NEVER AN AI JUDGEMENT** ("nothing opaque to
  defend") — nothing computes, scores or suggests a colour, and the palette carries NO severity
  ordering precisely because a numeric level is the field a later change would start averaging
  (asserted structurally). Rules that are load-bearing: a recolour **KEEPS what it covered** (§A2's
  record is "over TIME", so `colourAt` = latest-by-ts and `historyAt` shows the layers — deleting
  would let the anchored record attest a history that had been rewritten); `erase` **refuses across
  the author boundary** and SAYS so (a student's stray tap must not delete what the teacher marked
  mid-lesson); a backwards sweep is NORMALISED (right-to-left is as natural, and unnormalised
  `colourAt` finds nothing between 4 and 2 — a stroke that silently does nothing); `heatmapHash`
  reuses `provenance/hash`'s JCS+SHA-256 and sorts by (ts,id) so **array order cannot move it** (two
  devices legitimately differ; a hash that moved with order would cry tamper on a mere sync).
- **BARLINE PRE-DETECTION EXISTS AND REFUSES SINGLE STAVES — the refusal IS the feature.** §A2 allows
  optional bar pre-detection "to make selection easier". On a GRAND STAVE it is decisive and
  structural: barlines cross between the staves, a stem is trapped in one, so the populations are
  ~1.0 vs <0.7 — measured, threshold-independent. On a SINGLE stave it is **not solvable by geometry**:
  a stem on a note sitting on the bottom line reaches the top line (real engraving, not a fixture
  artifact). MEASURED on `cleanThreeSystems`: real barlines coverage 1.000 / stems 0.848–**0.939**,
  and longest-run does NOT separate them either (stems reach 1.000 by bridging their gaps) — system 2
  hallucinated FOUR extra bars. The only separator is a cut in (0.939, 1.000), **a margin that exists
  only because a synthetic barline is geometrically perfect**; a photographed one fades and breaks, so
  the cut would reject real barlines on real paper. Calibrating it here would be `phase.variants`' F1
  circularity exactly (a synthetic fixture can prove a rule INSENSITIVE; it cannot CALIBRATE a
  cut-point). So it is not calibrated — it refuses, and §A4's MVP (the student taps) takes over. A
  hallucinated bar mis-anchors every heatmap range, lesson note and recording pinned to it AND looks
  like a correct answer. `{singleStave:true}` exists ONLY as the test's known-negative. Resolving a
  single stave needs to know a line is attached to a NOTEHEAD — that is note recognition. Never.
- **⚠️ THERE IS NO AT-REST ENCRYPTION — the spec says there is, and it is WRONG.** §0 lists
  "encryption at rest" as reused from the engine and §1 repeats it. Verified in the code (again,
  2026-07-17): `storage/opfs.ts` writes `JSON.stringify` in PLAINTEXT, no `crypto.subtle.encrypt`/
  AES-GCM anywhere in src, no crypto library in package.json (`@noble/ed25519` is for SIGNING).
  Copy tracks the CODE, not the spec — a plan is not a property. The shipped sentence is the email
  lane's: **"Stored on your device — we never hold it"**, which is exactly true (zero-retention IS
  real: no server holds any of it). Do not build a music-only encryption scheme over an app-wide gap.
- **ANCHORS LIVE IN SOURCE-IMAGE SPACE; THE REFLOW IS A PURE VIEW TRANSFORM.** The whole §A1 feature
  inserts blank bands between systems, and the student drags handles to resize them. Had anchors been
  stored in rendered coordinates, one handle-drag would slide every mark below it off its music. So
  `reflow.ts` maps source↔layout (`buildLayout`/`sourceToLayout`/`layoutToSource`) and the image is
  NEVER rewritten — each slice is the same `<img>` shifted under its own window. Marks written INTO
  inserted space have no source pixel (that is the point of the gap), so they carry `GapOffset`
  {after_system, t} and travel with their gap when it resizes. Pinned by tests.
- **DESKEW HAPPENS AT CAPTURE, ONCE** (`capture.ts` rotates the bitmap before storing) so the stored
  image, the anchors, the layout and the bar regions share ONE coordinate space. Two spaces for one
  page is round 11's bug ("two rules, one pane").
- **THE CONNECTOR TEST IS WHAT KEEPS A GRAND STAVE WHOLE — gap size alone cannot.** §A1's "never
  split a system" fails exactly where it matters: engravers cramp system spacing, so on a piano score
  the treble→bass gap and the system→system gap nearly collide and a size heuristic slices the
  pianist's hands apart. The robust signal is structural and still pure geometry: staves inside one
  system are JOINED by barlines running through the gap. `hasVerticalConnector` reads that; it reads
  the same on a cramped page as a spacious one because it measures the engraver's INTENT, not their
  spacing budget. `groupStavesIntoSystems({connectorTest:false})` exists ONLY as the test's
  known-negative (it splits every grand stave) — never turn it off in the app.
- **`deskew`'s `repair` step is NOT polish — without it deskew makes things WORSE, silently.**
  MEASURED: the skew estimate came back EXACT (2.40 vs a 2.4 truth) and detection still found **0
  staves**, because a binary shear rounds each column's shift to a whole row, so a staff line wobbles
  between adjacent rows and no ROW holds a long run (longest collapsed to 0.15 of the width). A 1px
  vertical dilation stitches it back: 0 staves → 4, at the fixture's exact truth positions. It lives
  inside `deskew` because it repairs that function's OWN quantisation.
- **`binarise` is LOCAL (Bradley–Roth), and the reason was measured, not assumed.** At moderate
  lighting a global Otsu threshold does JUST AS WELL — the first version of that test proved nothing.
  Local only wins under a harsh shadow (fixture `harshShadow`, strength 1.4) where shadowed paper is
  darker than lit ink: global floods 36% of the page and detection collapses 2 systems → 1; local
  holds. That is the known-negative; if it stops firing, `binarise` has no proven reason to be local.
- **FIXTURES ARE SYNTHETIC AND GENERATED (`fixtures.ts`)** — copyright/thesis integrity (no real
  engraving, none of Peter's material, ever) and ground truth (the generator knows where it put every
  system). They rotate for REAL while the detector models skew as a SHEAR, deliberately: a fixture
  sharing the model's assumption certifies that assumption against itself. Each one exists to break
  something: `crampedGrandStaves` (the collision), `skewedPhoto`, `harshShadow`, `withLyrics` (ink in
  the whitespace), `singleSystem` (no gap population to reason from), `mixedGrandAndSingle`.
  **HONEST GAP: synthetic proves the GEOMETRY, not a real phone photo of real paper** — no
  perspective/keystone (only rotation), no paper texture, no JPEG ringing. A page held at an angle has
  converging staff lines no shear can straighten; the manual handles are the current answer.
- **Leader routing (`leader.ts`) scores candidate curves** (crossings → exit style → length), and its
  "avoidance" has an HONEST LIMIT recorded in the code: a system spans the page width, so a leader
  from a distant gap MUST cross what lies between — no curve routes around a band with no ends. It
  chooses WHERE to cross. What it genuinely routes around are LOCAL obstacles (the student's other
  sticky notes crowding the same gap), which is the congestion §A2 actually describes. The vertical
  exit exists ONLY to dodge; the sideways exit wins ties for LEGIBILITY (a line leaving the label
  sideways reads as a pointer; a vertical one reads as a stem) — it must not win on length, which it
  otherwise does whenever the target sits directly below the label, i.e. the commonest case.
  **⚠️ §A2's midline rule ("above-midline → belongs to the stave below") is GENUINELY AMBIGUOUS** and
  is implemented LITERALLY as a default with `LeaderContent.side` overriding it — Peter to confirm.
- **`scripts/music.prove.mjs`** (headless, own port 4941, nothing on Peter's screen) drives the REAL
  built app: flag-off → stub + the chunk never fetched (with a known-negative proving the listener can
  see a fetch), demo → capture → detect → reflow handles → OPFS round-trip → a stroke → RELOAD → the
  stroke survives. 13/13. **It caught a bug the unit tests structurally could not:** the demo minted a
  fresh `uuidv4()` per load, so reloading orphaned every mark under the old id AND leaked a piece
  (two page images) into OPFS every time. Both live in browser storage, not in the pure detector.
  Its hydration-error control is `/productivity`, NOT `/verify`: /verify is PRERENDERED so it has no
  mismatch to reproduce and threw nothing, which read as "these errors are yours". Non-prerendered
  routes are served the prerendered EDITOR page through the SPA fallback and hydrate against it — the
  same artefact CLAUDE.md records for /snapshot. Compare like with like.
  ROUND 2 (2026-07-17) — 21/21, now also: **the EDITOR's load path** (opening `/` fetches no music
  chunk, with a void-guard so a blind listener can't pass it — "off costs nothing" is a claim about
  `/`, not about /music, and `Edit.tsx`'s module-scope `import()` proves a dynamic import can still
  be eager-in-effect); the heatmap sweep → teacher attribution → provenance hash → reload.
  - **A SEPARATE CHUNK FILE IS NOT EVIDENCE OF LAZINESS — caught here, live.** `demo.ts` statically
    imported `fixtures.ts` (the whole synthetic score GENERATOR, for tests + `?music=demo`) and
    MusicStudio statically imported demo — so the generator's strings were measured INSIDE
    `MusicStudio-*.js`, shipping to every REAL music user. Now `await import('./demo')`: 3.8KB splits
    out, fetched only for `?music=demo`. Grep a surviving STRING LITERAL to locate code in a chunk;
    minified identifiers don't grep.
  - **`chunk.test.ts` READS REAL BUILD OUTPUT — it fails against a STALE `build/`.** It failed the
    full gate here purely because the build predated another lane's merge; `pnpm build` → 12/12. It
    is not flaky; it is telling you the truth about a directory you forgot to refresh.
  - **A PROBE THAT PASSED BY LUCK.** The stroke-persistence check reloaded the instant the pointer
    lifted, racing the async `savePiece`. It passed for a round, then failed when unrelated rendering
    shifted the timing a few ms — i.e. it would have reported "persistence is broken" about a
    persistence layer that works. It waits for the write now.
- **TYPE SCALE — `music/typeScale.ts`, ONE ramp, five semantic steps** (Peter 2026-07-17: "Music
  likewise needs all the fonts increased… **Every font proportionally up**. **It's okay if users have
  to scroll**"). Before it the module had **NINE nearly-identical sizes** (10,12,13,14,15,16,17,20,22)
  across TWO vocabularies (inline `fontSize` here, Tailwind `text-xs/sm/xl` in `MusicPanel`/
  `ScoreView`) — nobody chose nine, they accumulated one component at a time. Scaling by hand makes
  nine new ones; two lanes doing it independently makes fifteen. Steps are SEMANTIC (`TYPE.label`,
  because the thing IS a label) — "which number is closest" has no answer, "what is this text for"
  does. **title 30 / heading 24 / body 20 / label 18 / meta 16.** Every step ≥16, so the iOS
  auto-zoom trap is unreachable BY CONSTRUCTION rather than by remembering a two-tier rule someone
  forgets the day they add an input. The ramp is FLATTER than the old one (bottom rises 1.6×, top
  1.36×) — a real consequence of the floor, and right: hierarchy is carried by weight and colour, and
  a 10px timestamp was illegible at music-stand distance, which is this module's actual reading
  distance. ⚠️ **OFFERED TO THE MusicXML LANE as the shared ramp** — it has the same instruction.
- **NIGHT MODE, EYEBALLED (2026-07-17) — and the theming rule was WRONG in one place.** The reflow
  GAP BAND carried `iw-nightable`, so it took the dolphin-grey chrome surface and rendered as a DARK
  BAND slicing through a white photograph of a page; it looked like a rendering fault. **The gap is
  not chrome — it is PAPER**, the space the student writes on, inserted into their own photograph,
  and a photograph has no night mode (you cannot invert a picture of a page and still call it their
  score). It now takes `--iw-score-gap` (paper in both themes). Structural assertions could never
  have caught this: the class was present and the token resolved — it was *correct* and *wrong*.
  Bar thumbnails scale with the ramp (`TYPE.title * 2`); words growing while the music stayed at 34px
  would invert the hierarchy of a screen whose whole subject is the music.
- NOT BUILT: **OMR (never)**; reference tracks/tap-sync §A4 (step 3 — and the barline refusal above
  makes it load-bearing: the tap is what gives a PHOTO Piece its bar model at all); practice tools
  §A5 (step 4 — and §A5 CANNOT SHIP without editing `vercel.json`'s `Permissions-Policy:
  microphone=()`, which is the lesson lane's deliberate firebreak; coordinate before touching it).
  `Practice.sessions` REFERENCES productivity ledger rows rather than copying minutes — §A6.4's
  "one representation of measurement, always". LANDED SEPARATELY: lesson capture §A3
  (`music/lesson/`), the MusicXML path §B, the heatmap §A2 (step 5, above).

### §B5 provenance — `bundleHash` gained a v:4 form (2026-07-17)

v:1 `{contentHash,receipts}` / v:2 adds `bibHash` / v:3 adds `emailHash` / **v:4** `{v:4,contentHash,
bibHash:…|null,emailHash:…|null,musicHash,receipts}` when the document carries an attached score.
Snapshots freeze `music` + `musicHash` exactly as they freeze `email` + `emailHash`; verify recomputes
both and folds them into the bundleHash recompute, so OTS genuinely BINDS the notation. Music WINS
over email (a doc with both is v:4) or the musicHash would be silently dropped from what Bitcoin
commits to. Non-music docs keep v:1/v:2/v:3 BYTE-IDENTICALLY — asserted against LITERAL canonical
strings computed by hand (`provenance/musicHash.test.ts`), never against bundleHash's own output,
which would agree with itself however the function changed.

- **WHAT IS ANCHORED IS THE HASH, NOT THE BYTES.** A master's MusicXML lives in OPFS like a PDF
  sidecar; `musicAttachmentsHash` commits to `{id, contentHash}` per master + the §B6 excerpt
  addresses. So correcting the score under an anchored analysis makes the bundle stop verifying —
  strictly stronger than the PDF precedent, where only citation metadata is anchored. Deliberately
  EXCLUDED: the rendered SVG (a function of engine version — anchoring it would make an OSMD upgrade
  look like tampering) and per-master titles/`addedAt` (display metadata and a local clock are not
  evidence; a corpus renaming a piece must not read as a tamper).
- **`annotations` IS HASHED NOW, AT `[]`** — the `receipts`-before-M3 precedent. An empty array
  canonicalises to `[]` whatever its element type turns out to be, so §B4 can land — and settle the
  contested `MusicXmlAnchor.measure: number` question (bar numbers are STRINGS by spec: '0' pickups,
  '8a' endings) — without a new bundle version and without moving any hash computed today.
- **PROVED, not assumed** (`music/provenance.roundtrip.test.ts`): drives the REAL
  createSnapshotIfChanged → gzip archive → stampSnapshot → buildExportBundle → verifyBundle. Asserts
  the digest submitted to the calendar IS the v:4 bundleHash (not contentHash), and that swapping a
  master's notation, editing an excerpt's bar range, tampering-and-recomputing musicHash, or
  STRIPPING the music all FAIL verify. Both halves mutation-proved: dropping mHash from the snapshot's
  bundleHash ⇒ 3 fail; making the verifier ignore frozen music ⇒ 2 fail.
- **A SHARED MUTABLE FIXTURE IS A TEST MEASURING THE TESTS BEFORE IT.** The music fixture was a
  module-level const passed BY REFERENCE into every document; the first tamper test mutated it, so
  the tamper-and-recompute case later "tampered" with an already-tampered value, changed nothing, and
  VERIFIED — reading exactly like the anchor failing to bind. It is a function now.

## Music lesson capture (§A3/§A3b, 2026-07-17 — `src/music/lesson/`, flag `?lesson`, DEFAULT OFF)

**THE SPEC'S PREMISE DOES NOT HOLD IN A PWA, AND NO COPY CLAIMS IT DOES.** §0/§A3/§C1 promise
on-device STT ("audio never leaves the device… there is provably no keepable recording of them").
PROBED, primary sources:
- Inkwave cannot reach the Apple Speech framework. It is not a native app.
- WebKit DOES ask for on-device, but only opportunistically. Verbatim, `WebCore/Modules/speech/
  cocoa/WebSpeechRecognizerTask.mm` (on every shipping `safari-*-branch` checked):
  `if ([_recognizer supportsOnDeviceRecognition]) [_request setRequiresOnDeviceRecognition:YES];`
  **Read the condition, not the wish** — when it is false the audio goes to APPLE'S SERVERS and the
  fallback is SILENT.
- **Apple's own docs settle it** (`supportsOnDeviceRecognition`): *"If `supportsOnDeviceRecognition`
  is `false`, the `SFSpeechRecognizer` requires a network in order to recognize speech."* And
  `requiresOnDeviceRecognition`: *"The request only honors this setting if the
  `supportsOnDeviceRecognition` property is also `true`"* — plus *"on-device requests won't be as
  accurate"*, so the quality argument does not favour it either. Apple documents **no device
  guarantee**: it is a runtime property, so an iPhone-12/A14 floor does NOT buy the on-device branch.
- **The page cannot require, query, or observe it.** `processLocally`/`available()`/`install()` are
  Chrome 139+ only (MDN BCD: safari `false`) and WebKit's `SpeechRecognition.idl` declares none of
  them. Safari's prompt ("Allow X to capture your audio and use it for speech recognition?") does not
  mention Apple either.
⇒ `webkitSpeechRecognition` is **'unverifiable'** — not on-device, not cloud, but *unknowable from
here*, per utterance. **A promise whose entire value is that it is provable cannot rest on it.** It is
classified in `stt.ts` and NOT REGISTERED; only a `no-audio` source exists. whisper-WASM is the only
provable ambient path (`local-model` seam) and is NOT built — its latency on an A14 is **unmeasured**.
**Correction to an earlier objection: there is NO YouTube IFrame anywhere in this repo** (§A4's player
is unbuilt), so "cross-origin isolation would break the embed" is currently moot — probed by grep.
Note for anyone reviving it: **COOP/COEP and Permissions-Policy are per-DOCUMENT, and this app is an
SPA (`ssr:false`) where a route is NOT a document** — client-side navigation to `/lesson` keeps the
entry document's headers, so isolation would apply only on a hard load. Check `crossOriginIsolated`
at runtime; never assume it from the route.

**THE MICROPHONE FIREBREAK (`micBoundary.ts`) — three layers, and layer 1 already existed.**
§A5's practice recordings (student records themselves: consensual, theirs, storable) and §A3's lesson
(the teacher's voice, where "no keepable recording" IS the product) want the SAME API and keep
DIFFERENT promises. The separation is structural:
1. **`Permissions-Policy: microphone=()` in `vercel.json`, DEPLOYED** — the mic is off for the whole
   origin at the HTTP header, so `getUserMedia` cannot succeed anywhere no matter what any module
   calls. **This is the real line: §A5 cannot ship without editing that header** — which is exactly
   the single place the decision must be made, and `micBoundary.test.ts` **binds the lesson copy to
   it** (flip it to `microphone=(self)` and the copy test FIRES with instructions).
2. A source allow-list (`MIC_CAPABLE`, **empty today**) — naming a capture API is a decision.
3. An **import-graph** firebreak — nothing REACHABLE from `src/music/lesson/` may be mic-capable.
   Layer 3 is the one that survives the API moving behind a helper: a grep of `lesson/`'s own files
   would pass forever once §A5 lands `recording/recorder.ts` and `lesson/` imports it. The walk is
   proved to CROSS a real boundary (`lesson/session.ts` → `../types.ts`) before any "found nothing"
   verdict is read — otherwise it is the empty-list probe.
**Mention vs use is load-bearing**: `stt.ts` must NAME `webkitSpeechRecognition` to feature-detect it
(that is the finding), and reading a property captures no audio — only `new` does. The first cut
matched names broadly and flagged `stt.ts`, i.e. it would have forced the module documenting the
microphone problem onto the microphone allow-list. `micBoundary.ts` is itself the PATTERN CARRIER
(it names every API as data), excluded from its own scan and **proved inert** — a test asserts only
test files import it, the same guard `claims.test.ts` puts on `claimMatchers.ts`.
**The copy is SCOPED to the screen, deliberately**: "nothing on this screen can reach a microphone",
never "Inkwave does not record audio" — the app-wide claim EXPIRES when §A5 ships, and an expired
sentence goes on being read.

**⚠️ NO ENCRYPTION (§0 and §1 are both WRONG about this)** — verified independently again here.
The transcript is non-storable STRUCTURALLY: `#private` field (invisible to `stringify`), `toJSON()`
redacts, `LessonRecord` has no field to hold one, `end()` drops the reference. Also refused:
*"unrecoverable"/"securely erased"* — `end()` drops a JS reference; it does not wipe a heap.
**TWO INSTRUMENT TRAPS caught here, both the house speciality:** (1) the first deletion test scanned
an ENDED session, found nothing and went green — but the same scan finds nothing on a RUNNING one,
because `#lines` is genuinely private. It scored both states **identically BY CONSTRUCTION** and could
not tell deletion from encapsulation. Claims are now split: the serialisation firebreak is proved by
the scanner (positive control = a `LeakySession`), the deletion by the session's own API (proved to
show the lines BEFORE `end()`). (2) The `audio never leaves your device` matcher **could never fire** —
an affirmative promise phrased as a DENIAL, so `affirmativeOnly()` stripped it and the matcher read an
empty string, passing vacuously. Now `scope: 'literal'`. **Only the prove-it-first rule caught either.**
NOT WIRED to a route (no Piece surface consumed yet); `BarOnlyAnchor` in `lesson/types.ts` records the
one contract ask — §1's `Anchor` union cannot express "bar 24" alone, which is all a student has
mid-lesson.

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

Peter's spec, verbatim intent: "just sine waves, some stochastic glitters and wave marks from a
precalculated data pool, and an S-curve slow down — all of which on a different workflow to
whatever has to load so it doesn't get interrupted." The load animation is a SELF-CONTAINED,
PRECOMPUTED unit; playback is COMPOSITOR-ONLY (the "different workflow"); exactly TWO control
events cross from the app into it.

**The water.** Cyan→aquamarine gradient (`#00b4d8 → #00bfa8`, 98.5°). Waves = two 140px SVG
data-URI tiles as vars `--iw-wave-a/b` (night re-points them; thick line on TOP), drawn by
`::before`/`::after` with ±280px overdraw = exactly two tiles (keep it ≡0 mod 140 or the
transform↔background-position handoff tears). Drift = CSS `iw-wave-drift-l/r`, 72px/s (140px per
1.944s loop), in the prerendered class → runs from first paint.

**The pool** (`waveTwinkle.ts`). Sparks (glitters) + dashes (wave marks) are generated in ONE
pass before playback: positions through the never-strike-twice sampler (`memPick`, per-band ring
memory, localStorage-persisted), canvas-rastered PNG art (NEVER per-instance SVG URIs — Chromium
builds an IsolatedSVGDocumentHost per unique URI, ~4.3s at ~600), and a per-instance SCHEDULE: a
~46.7s cycle (24 tile loops) of blink envelopes (dash: 0.3s S rise / 0.4s hold / 0.3s S fall),
each at a fresh 140px-lattice slot (same wave phase ⇒ same art stays valid; own recent slots
excluded ⇒ no repeats). Playback = two looping WAAPI tracks per instance (opacity envelopes +
transform that moves at EXACTLY the drift velocity while lit — the mark rides its crest — and
glides to the next slot while dark). ZERO per-frame JS during the load: no rAF driver, no
respawns, no style writes — main-thread starvation is physically incapable of touching it. One
clock, set once per load: `alignTracks()` batch-sets track startTimes ≡ the tile drift's literal
startTime (mod 1944ms) with a random whole-loop offset. A `.iw-twk-rest` layer (static texture,
hidden during drift) fades in over the coast; the blink layer fades out — twinkling calms exactly
as the water slows.

**The two events.**
1. START — implicit: prerendered `.iw-wave-anim` + pool mount. ATOMIC WATER: everything is gated
   behind `.iw-water-ready` on `<html>` (entry.client decodes the tile URIs AND waits for
   `inkwave:twinkles-ready`) — colour, waves, twinkles land in one paint. Add any NEW tile var to
   that decode list.
2. SETTLE — `inkwave:reveal-imminent` (TiptapEditor's settle gate / LoadingVeil's ready): the
   S-curve slow down. The drift is NEVER stopped — the coast class adds a BRAKE composited on top
   (`animation-composition: replace, add`): injected literal sampled keyframes (#iw-coast-kf,
   Scroll.tsx) of the ZERO-JERK profile v(τ) = −v·(1−smoothstep(τ)) (add ∝ τ³ near 0; T/d =
   2.5s/90px desktop, 2s/72px phone) then a LINEAR HOLD at +v that cancels the drift — the total
   pose is STATIC after T. Brakes (and the coast-length fades) are born CSS-PAUSED and started by
   the FORWARD ANCHOR: one rAF after the swap commit, t_a = timeline.currentTime + 150ms slack;
   drift pose at t_a computed from the drift animation's own startTime, rest pose device-pixel
   snapped, keyframes finalized, then every coast animation gets play() + startTime = t_a. This
   is THE tick fix (2026-07-12): engines resolve pending CSS animations at STYLE time, so under a
   CPU spike the first presented brake frame showed brake(commit-lag) — a backward step ∝ lag².
   Paused-birth + future anchor makes the start compositor-exact at any spike size, and the τ³
   curve makes any residual lag sub-pixel. Rest handoff = timer at t_a+T+80ms → write `--wave-x`
   = the snapped end, drop classes, dispatch `inkwave:wave-rest`.

**Kept invariants (each was a live bug — do not regress):**
- PHONE: surfaces are in-flow, so the shell surface is VIEWPORT-PINNED (fixed, inset 0, z 0 under
  the z:1 transparent covered editor) while wave classes run; gradient `background-attachment:
  scroll` + 100lvh sizing (WebKit fixed-attachment is flaky; browser-UI transitions must not
  reshape the water). Shell stays OPAQUE until wave-rest AND the paper fade completes; parchment
  only over still water. The covered phone editor renders NO wave classes and never syncs
  twinkles (its early 'off' would clobber the global mode).
- Editor mounts ONCE per load (no lazy/Suspense around TiptapEditor); the editor chunk is eagerly
  imported at module scope. A surface mounting mid-load adopts its sibling's drift startTime
  (pixel-identical copies — the old reveal hiccup); pre-gate mounts need nothing (same recalc).
  The adopt must RE-ASSERT at each animation's `ready`: a startTime write to a play-pending CSS
  animation is CLOBBERED when the pending start resolves (live 2026-07-12: the covered editor ran
  33-500ms out of phase → doubled lines through the reveal fade + marks off their crests).
- Mark tracks are NEVER created-then-re-clocked on VISIBLE water: creation is gated on
  clockReady() (the load clock stamped from the drift's literal startTime), and any deferred
  creation fades the field layer through the transition (a late batch re-clock/mass creation was
  a whole-field teleport/pop measured at +18-62px — Peter's live "backward tick just before the
  slowdown"). Pre-gate boot mounts are exempt (hidden until the gate recalc). A host whose dashes
  mount mid-coast still gets its statics ramp (startRestDrift from mountSet).
- PER-LOAD LIFECYCLE RESET: `inkwave:open-begin` clears the coast record + Edit.tsx's chain state;
  twinkle anim re-entry re-aligns the pool clock. A new load never reuses timers or clocks.
- ONE backstop only: the 30s load watchdog (Scroll.tsx) — if SETTLE never arrives it logs loudly
  and forces the chain (`inkwave:load-watchdog`). It must never fire on a healthy load; the old
  per-stage caps (reveal/shell/covered/veil 4s) are gone BECAUSE playback can't be starved.
- Scroll-time (post-reveal): sway = `--wave-x` on the surface + LITERAL field transforms via
  `swayFields()` — never var() into the twinkle subtree, and `--wave-x: 0px` firebreaks on
  `.iw-magnify-box`/`.scroll-paper`/`.iw-wave-twinkles` (the inherited-var write invalidated the
  whole PM subtree: p50 417→50ms; `@property inherits:false` breaks WebKit pseudo re-resolve).
  Scroll twinkles = driven WAAPI blinks (velocity→playbackRate) with raster-free lattice
  relocation through the same never-twice memory; full art regenerates only at zoom/resize
  reseeds. `memPick`'s farthest-candidate fallback must init bestD to −Infinity (−1 left `best`
  null on saturated rings — real bug).
- IN-FLOW surfaces (SnapshotView doc/diff panes — anything :not(.iw-fill)) get PANE-SCOPED water
  pseudos (position:absolute override in index.css): the snapshot card-flip keep-alive layers are
  stacking contexts, so the old viewport-fixed ::before painted wave lines OVER the minimap/
  summary/diff panels (Peter's 2026-07-12 screenshots; pixel-verified fixed with seeded snapshot
  data). Only .iw-fill surfaces (live editor, LoadingVeil) keep viewport-fixed water.
  PANE-SCOPED WATER MUST STAY UNPROMOTED (2026-07-12 "snapshots lagging massively"): in-flow
  surfaces are CONTENT-tall (>60,000px on a thesis-scale snapshot pane), so the base rule's
  will-change/translateZ gave every keep-alive layer a ~90-megapixel promoted water layer (3-5
  resident = 300MB+ raster, scroll 37fps → 60 once removed). The :not(.iw-fill) override pins
  will-change:auto + transform:none; hidden .iw-snap-layer surfaces paint NO water at all
  (content:none — only the active pane pays); SnapshotView writes NO --wave-x sway (a sway write
  invalidates the whole content-tall pseudo's paint per scroll event).
- **NOTHING MAY WRITE TO THE DOM BEFORE HYDRATION (2026-07-17 — Peter's "the video works but it
  never loads"; the wave video re-triggered the 2026-07-10 catastrophe).** `hydrateRoot(document)`
  makes React own EVERY node, so there is NO DOM anywhere for an imperative pre-hydration append.
  waveVideo appended its `<video>` into the PRERENDERED `.iw-wave-twinkles` before `bootstrap()`
  reached hydrateRoot (it `await`s a dynamic import first, so the video always won) ⇒ React #418 ⇒
  it discarded the server HTML and client-rendered the whole document (#423). THE DAMAGE, PROBED:
  React's recovery **REPLACES the `<html>` ELEMENT** — it does not strip attributes off it. So the
  new `<html>` had no `.iw-water-ready` and no `data-theme`, `:root:not(.iw-water-ready)` put every
  wave layer AND the twinkle host at display:none for the session, and the video — which lives
  inside that host — painted nothing while `play()` resolved happily. On PHONE the reset is
  `.inkwave-editor-surface:not(.is-phone)`, so the aqua GRADIENT still painted: a flat aqua screen,
  no waves, no document. CONFIRMED FIXED ON PETER'S iPHONE 8 (2026-07-17: `water-gate OPEN`). Fix =
  a `hydrated()` barrier — every DOM write waits behind it. The 150ms re-attach interval is GONE:
  it existed only to heal the wipe, and post-hydration React never touches the host's children
  (waveTwinkle removes only its own `.iw-twk-set` nodes). Probes:
  `scripts/wave-video/reveal.prove.mjs` + `barrier.prove.mjs` (both `--expect-broken`).
- **ONE-SHOT ASYNC SIGNALS — THE BUG CLASS, and it hit TWO lanes in the same minute (2026-07-17).**
  A signal you wait on can fail two ways: **(a) it never fires**, or **(b) it already fired before
  you subscribed**. A bare `addEventListener` loses to both, silently and forever — no error, no
  timeout, just a promise that never settles. THE RULE: only ever wait on a signal that ALWAYS
  arrives, and make it ASKABLE — check the state first, subscribe only if the answer is no, both in
  ONE synchronous block so nothing can slip between them. Do NOT paper over it with a timeout; that
  re-creates the self-healing machinery this lane deleted. Instances:
  - The wave video's barrier first keyed on `inkwave:twinkles-ready` — post-hydration, but the pool
    announces only if BOTH its sets generate, while the water gate opens anyway on its own 1500ms
    timeout. A load whose pool never announced hung the video FOREVER with the gate wide open
    (PROBED). Now `inkwave:hydrated` + `__iwHydrated` (entry.client's `HydrationBeacon`, a null
    component whose post-commit effect always fires). `__iwWaterReady` was added for the same reason
    — the class `.iw-water-ready` is not a safe proxy for "it happened", since a recovery strips it.
  - The break-table lane, same minute, same shape: a signature built before `bibProvider` had
    hydrated, keyed on `capa@0` instead of `capa@20`, missing forever after.
  Correctness of a feature must not depend on ANOTHER feature succeeding (the video did not need the
  twinkles; it was merely borrowing their timing).
- **A `reason`/status field that only some code paths write is a field that LIES.** waveVideo's
  `reason` was set once before the barrier and then not again until `play()` resolved, so a video
  stuck in its DECODE still displayed 'waiting for hydration…'. That stale line sent the next reader
  (and Peter's coordinator) hunting a barrier bug that had already released — the same overlay's
  `clip` and `fetch` fields, both written INSIDE `run()`, proved it was well past. Discriminate a
  hang from a stall by asking which fields are POPULATED, not by reading the status string. `reason`
  now tracks every stage of `run()`.
- **`advancing` reported "YES (real decode)" for a video holding NO DATA.** `let last = -1` meant the
  first tick satisfied `now > last + 0.001` for a `currentTime` of 0 — so Peter's overlay showed
  `readyState 0 (NOT decoded)` beside `advancing YES (real decode)`, a physically impossible pair
  that cost real time to see through. It now requires `readyState >= 2` AND a genuine delta against
  a previous sample. Sentinel values must not be able to masquerade as measurements.
- **entry.client's stamp-guard WAS A FICTION until 2026-07-17** — and it failed the one case it was
  written for. It captured `const root = document.documentElement` and observed THAT node, so after
  a recovery it re-stamped a DETACHED element forever while the live `<html>` stayed bare. Never
  hold the node: resolve `document.documentElement` at every use, and watch `document` itself
  (never replaced) with a childList observer to catch the swap + re-arm. Same family as
  canvasShapingMatchesEditor: a guard that cannot see its own failure.
- **`iw-wave-video-on` IS A PROMISE THAT SOMETHING ELSE IS DRAWING THE WATER — and it outlived the
  element (2026-07-17, round 4; Peter, live desktop: "after I signed in just now the wave background
  completely went away", flat teal, document fine).** The class suppresses the CSS water outright
  (`visibility:hidden` on the wave pseudos AND the twinkle host) with NO dependency on the video
  existing, so `master` was a LATCH: when a re-render tore the `<video>` out — mounting Clerk at
  sign-in does exactly that — the CSS water stayed suppressed, the video was gone, and NOTHING drew
  the water. PROVED by removing the element while master (`master.prove.mjs`): class still set,
  `::before` visibility:hidden, `master` still true. `guardMaster` now derives it — a childList
  observer on the host (and its parent) hands the water back the microtask our last live element
  leaves; `:not([data-going])` makes the legitimate loop→brake swap a non-event. **AND THE ALARM WAS
  RIGHT ALL ALONG:** round 3 called `master`-with-no-element a benign swap transient and greyed it
  out — that is EXACTLY this bug's signature, so the instrument would have been blind to the very
  failure it had been reporting. **Excusing a symptom is not the same as excluding a cause**; exclude
  the cause (read the LIVE element) and let the alarm keep firing on everything else.
- **THE OVERLAY WAS RED ON A WORKING APP — and that is worse than green on a broken one (2026-07-17,
  round 3).** A successful run ENDS with the video torn down and `master` cleared, so a completed
  hand-off displayed the identical red `● CSS WATER (no video)` as a video that never ran at all.
  Peter read it and reported "the first time the video ran, from then on just the css" — the fix
  worked, the instrument said otherwise, and two rounds went hunting a phantom. `masterEver` now
  separates them: `✔ VIDEO RAN, then handed back — HEALTHY` vs a red that means EXACTLY "the video
  never ran this load". The ▲ alarm also fired on healthy runs twice over: `painted` demanded
  opacity ≥ 0.9 while `.iw-wave-video-el` fades in over `transition: opacity 0.3s` (~270ms of every
  successful start — "right before it loads", exactly when he was watching), and the overlay picked
  the FIRST `video.iw-wave-video-el` (the dying loop, opacity 0, `data-going`) during the 80ms
  loop→brake swap. A half-faded video IS painting; select `:not([data-going])`. **An alarm that
  fires on the healthy path trains the one person whose eyes are the ground truth to distrust the
  instrument.**
- **THE OVERLAY MUST NAME ITS BUILD.** Peter's three screenshots were read as one healthy run; the
  `fetch` field said otherwise — `200 / decoded` is round-1 code, `warm 200 → cached` is round-2, and
  they CANNOT coexist in one build. Two builds, one minute, and no way to tell from the picture. The
  box now prints `__BUILD_COMMIT__`. Any on-device overlay whose screenshots cross a deploy needs it.
- **THE HARNESS'S FIRST LOAD WAS ITS ONLY LOAD (`twoload.prove.mjs`).** Every wave-video probe did ONE
  load in a FRESH context, so nothing could see what a SECOND load changes: `serviceWorker.controller`
  is NULL on a first load (the SW's cache-first /wave/ handler is not even in the path), Cache Storage
  and the HTTP cache are empty, and there is no saved document. **A race gives you *sometimes*;
  works-once-then-never is STATE.** But: **Linux WebKit CANNOT run the warm load at all** — it has no
  `navigator.storage`, so load 2 reads back the document load 1 created, hits the app's own
  storage-error page, and renders NO editor surface. The video then bails `load already past drift`
  because there is no `.iw-wave-anim` surface ANYWHERE, and the probe reported "PETER'S SEQUENCE
  REPRODUCED" — a fiction; a control with the flag OFF showed the identical dead page. It reports
  INCONCLUSIVE now. Chromium (which has OPFS) renders warm loads and reaches master on all 3, h264
  included. **The drift window (hydrated→settle) DOES halve on warm loads** (WebKit av1 3.3s → 1.7s;
  Chromium 744ms → 427ms) because caching makes everything else faster — a real mechanism by which a
  slow decode could lose on load 2+ and never on load 1, unreproduced in either engine and left
  STATED, not probed.
- **`no-store` IS FAITHFUL TO NOTHING.** The probe server sent it for every asset, so waveVideo's
  pre-hydration warm fetch warmed precisely nothing and the `<video>` re-downloaded the whole 280KB
  h264 clip — a "decode timeout" manufactured entirely by the harness. Production serves /wave/
  cache-first from the SW's Cache Storage (permanent per build id); `server.mjs` now serves /wave/
  `immutable` (the behavioural equivalent) and everything else no-store.
- **THE OVERLAY MEASURED THE DECODER AND REPORTED IT AS PIXELS.** `?waveVideo=debug` printed
  "● VIDEO ON SCREEN / advancing YES / VIDEO is master" — all TRUE, all about the decode — while
  the element sat in a display:none subtree painting nothing. Every field was green on a build that
  never rendered a frame, which is exactly how a broken build talks you out of a real bug. It now
  asks the LAYOUT ENGINE (`painted`: box/display/visibility/opacity) and prints the water gate,
  with a distinct third state "▲ VIDEO IS MASTER BUT NOT PAINTED". NB the box is written with
  innerHTML — no angle brackets in any diag string (a literal "&lt;video&gt;" parsed as a TAG and
  swallowed the reason line). Probes read `window.__iwWaveVideo` (masterEver included — the video
  can run and hand back between samples), NEVER the overlay's rendered text.
- PROBE RULES: /snapshot needs a fallback-faithful static server (vite preview serves the
  prerendered editor page → hydration mismatch kills the water); never pkill vite preview; no
  windows over Peter's screen (xvfb; Firefox needs `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0`).
  `window.__iwTwkPool` exposes the pool for probes. The wave-video probes need
  `scripts/wave-video/server.mjs` — the scrub-probe server has no `.mp4` MIME and no Range/206, so
  it would test a transport iOS never uses.

Build marker: Settings footer + console show `__BUILD_COMMIT__` (vite.config.ts).

KNOWN RESIDUALS (Peter's live verdict, 2026-07-12, build 72783da — "workable on the whole"):
no consistent tick remains, but inconsistent performance artifacts persist, worst on PHONE then
Chrome: occasional blue flash; white lines briefly lagging their wave. Probes pass 9/9 — these
are real-device/raster-scheduling class issues the emulated probes don't catch. Next wave round
starts HERE, not from "all green"; candidate tools: on-device capture, WebKit raster ahead-of-time
hints, reduced phone pool density.

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
- **Toolbar slots are ONE population (2026-07-12):** the 6 main-row circles + the ▲ drop-up
  overflow (S style and ⚙ settings are slots too — CONFIRMED still true; only ▲/⋮ fixed).
  Peter 2026-07-17: the row is SIX because "it fits well on phone" and phone/desktop must stay
  continuous; the population grows freely because "it's only 1 extra click to access a button
  behind the arrow" — ▲ is the app drawer, not a cupboard ("a toolbar is like your app homepage").
  `inkwave-toolbar-slots` stores 6 (legacy 4 migrates by appending style,settings) — but it is now
  only the writer's DEFAULT for their next new document: **the layout follows the .studio**
  (`doc.toolbar`, `ToolbarConfig`). Chain: doc config → the writer's own last layout → the
  first-run six (page, style, info, settings, media import, review — ALL SIX LIVE since the media lane
  landed 2026-07-17; the `media`→`bib` fallthrough is retired). A received document brings its
  author's layout, which is the feature; it can never hide ▲/⋮ or name a button this build lacks,
  because every path resolves through `migrateSlots`. NOT anchored — `contentHash` takes contentJson
  only. Touch: hold-drag reorders the row
  (insertion semantics, FLIP previews) and hold-drag a ▲ entry ONTO a row slot to swap it in;
  desktop keeps HTML5 drag. During any drag the circle discs go opaque
  (`--iw-slot-drag-bg`; night token in the nightable block) so the lifted circle passes OVER
  neighbours.

## Working model (how these sessions run)

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
ProductivityReportModal, ProductivityPanel (`/productivity`), the ledger CLOCK DROP-UP
(`components/ClockMenu.tsx` — the toolbar's clock slot; `/ledger` the route is gone), OpfsInspector (`components/OpfsInspector.tsx` — the hamburger's "Storage" item: every
document actually in OPFS, with orphan/this-tab/busy badges + Open/Download recovery),
EmailComposePanel (+ its provider drop-up), LessonPanel (`src/music/lesson/`, flag
`?lesson`, DEFAULT OFF — its three screens: consent gate, bar-pinned notes, teacher recap),
MusicPanel + ScoreView (`/music?musicXml=1`, DEFAULT OFF — the MusicXML path), the music studio
(`music/MusicStudio.tsx` — its footer toolbar + symbol drop-up carry `iw-touch-guard`,
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
