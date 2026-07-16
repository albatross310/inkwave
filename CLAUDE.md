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
- **Review layer (IN PROGRESS, branch `feat/review`).** Peter's spec: live suggestion mode (track
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
- PROBE RULES: /snapshot needs a fallback-faithful static server (vite preview serves the
  prerendered editor page → hydration mismatch kills the water); never pkill vite preview; no
  windows over Peter's screen (xvfb; Firefox needs `env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0`).
  `window.__iwTwkPool` exposes the pool for probes.

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
  certifies a fiction the editor never uses; (2) `document.fonts.check()` returns TRUE for a family
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
- **Toolbar slots are ONE population (2026-07-12):** the 6 main-row circles + the ▲ drop-up
  overflow (S style and ⚙ settings are slots too; only ▲/⋮ fixed). `inkwave-toolbar-slots`
  stores 6 (legacy 4 migrates by appending style,settings). Touch: hold-drag reorders the row
  (insertion semantics, FLIP previews) and hold-drag a ▲ entry ONTO a row slot to swap it in;
  desktop keeps HTML5 drag. During any drag the circle discs go opaque
  (`--iw-slot-drag-bg`; night token in the nightable block) so the lifted circle passes OVER
  neighbours.

## Working model (how these sessions run)

Peter tests live on iPhone + desktop and reports in batches; work is delegated to parallel
isolated-worktree agents with precise briefs (root-cause first, no half-fixes), merged serially into
master from `/root/dev/Inkwave-perf` (Peter's own sessions use `/root/dev/Inkwave` — NEVER share a
checkout) with the full gate: typecheck (ignore pre-existing TS7016/TS2550 in test files), ALL tests,
build (gate on real exit codes — `| tail` swallows failures), then push (= production deploy).
Snapshot React state is METADATA-ONLY (`SnapshotMeta`; fetch full snapshots via `listSnapshots` at
action time — never hold contentJson in state). Autosave failures dispatch `inkwave:save-failed`.

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

Panels already migrated: CitationPanel + EditDialog, ReceiptPanel, SyncStatus, footer toolbar,
OptionsMenu (+ its export modal), SettingsMenu, PageMenu, LimitSelector, StyleBar popups, ReviewBar,
VerifyModal, AccountControl, the Google-Drive/OneDrive pickers + openers, the PDF find bar. When you add a
panel, add it here too.

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
