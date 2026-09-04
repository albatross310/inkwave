# /snapshot scrub — the measurement record (rounds 1–15, 2026-07-10 → 2026-07-18)

**This is the NARRATIVE. The RULES it produced live in CLAUDE.md** under "Snapshot review"; that
entry points here. If you are about to change how `/snapshot` scrubs, read the rules there first —
they are the operative text. This file exists so the *evidence* behind them survives without the
rules being buried in 800 lines of it.

Why keep it at all: nearly every rule here was won by a measurement that refuted a plausible guess,
and several were re-derived twice because the first refutation was forgotten. The numbers are what
make the rules arguable rather than superstitious. Read the round that owns your area before you
propose an alternative — the alternative has often already been measured and lost.

The recurring lesson, stated once here rather than fifteen times below: **the instrument was wrong
more often than the feature.** Round 10's overlay could not see a burst because it repainted on the
thread the burst saturated; round 11's `registered` metric scored a line-open hold that wrapping
alone decides; round 12's control passed by construction because the flag it set disabled the only
call site that could have failed it. Before reading any verdict below, check what would have had to
be true for that cell to fail.

---

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
      **⚠ CORRECTED 2026-07-19 (`dd4cbe5`) — `debug` specifically should NOT have been in that
      localStorage set.** Peter set `?snapThumbs=debug` once for this scrub work, and it then wrote
      localStorage and showed the diagnostic overlay on EVERY later `/snapshot` visit forever — a
      debugging aid that outlived its session. Fixed: the DEBUG flag now lives in `sessionStorage`
      (still survives in-session scrub URL rewrites, per this ROUND-8 fix, but gone on a new
      session), any stale PERSISTENT debug flag is purged on load, and `?snapThumbs=1` clears debug.
      The feature flag itself (`?snapThumbs=1`/`off`) stays persistent — only `debug` changed.
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

  ROUND 15 (2026-07-18, `ef96306` — **GRADUATED TO DEFAULT ON, the flag mentioned throughout ROUND
  14 above is now stale.** "the fast scrub rich text" ships live). Peter: *"unblock textRender"* /
  "STOP FLAGGING EVERYTHING" (below). `/snapshot`'s doc pane now renders RICH formatted pages
  (`RichDiffView`) for EVERY version instead of the flat pre-wrap transcript 115 of 116 versions used
  to show. Readiness gates, all run against the real built app before flipping the default:
  `breaks.prove.mjs` IDENTICAL BREAKS true; `typematrix.prove.mjs` (per-type, offsets not counts) —
  paragraph/heading/lists/citation/refList/hardBreak/marks IDENTICAL, math/code/font-family/full-set
  DECLARED-DEFER (refuse + say so), taskList/blockquote/codeBlock/hr/mathBlock diverge but DECLARE low
  reliability rather than silently misreporting — Peter's bar ("accurate across all text types, or
  give the reason") is met; `panecontent.prove.mjs` — the normal (no `?textRender`) path now renders
  rich and paginates byte-identically to the first-version rich render, closing the round-11 "two
  rules, one pane" divergence. `textRenderFlag.ts` reader flipped to `!== '0'` (absent-means-on);
  `?textRender=off` a sticky `'0'`. The 1477-line measurement PROBE stays decoupled from the flag
  (it used to share it, which would have installed the harness for every writer on default-ON) — it
  now arms only on the fresh `?textRender` URL param, which is what `.prove.mjs` scripts navigate to
  and nobody else. Mutation-proved default both ways.

---

# <a id="snapshotview"></a>`routes/SnapshotView.tsx` — the narrative, moved out of the route (2026-09-04)

The comment-compression pass left each rule below beside its code, in the standard form, and moved
the reasoning here **verbatim, with its numbers**. Nothing was deleted on either side. If a rule in
the source looks arbitrary, its evidence is under the matching anchor.

## <a id="sv-palette"></a>The /snapshot palette

> EVERY colour on this route resolves through a `--iw-snap-*` token defined at :root in BOTH themes
> (the SNAPSHOT VIEW block in src/styles/index.css, which carries the reasoning). Deliberately NOT
> `.iw-nightable`: that class exists for a floating panel and forces a dolphin-grey fill on whatever
> it sits on — here it would paint the three full-height panes light grey over the near-black
> document pane, which is the half-lit screen this palette was written to fix. Each name below is a
> `var(…, <day literal>)`, so a missing stylesheet still yields the day design rather than nothing.
> KEEP THE INDIRECTION: an inline literal here is a night bug by construction, because these panes
> sit outside every scope that remaps one.

Pattern **R2** (one definition, not two) applied to colour: the token block in `index.css` is the
definition; a literal in this file is a second one that cannot be remapped.

## <a id="sv-pane-wrap"></a>The pane's white-space must match the editor

> WHITE-SPACE MUST MATCH THE EDITOR (2026-07-18 — a measured /snapshot bug, not a style choice).
> ProseMirror injects `.ProseMirror { white-space: break-spaces }` from prosemirror-view's own
> stylesheet, and it injects it ONLY WHEN AN EditorView MOUNTS. /snapshot has no view, so the class
> is on the element and the RULE IS NOT: measured, the editor's flow computes `break-spaces` and
> this pane computed `normal`. Those wrap by DIFFERENT RULES — `break-spaces` HANGS a trailing
> space, `normal` COLLAPSES it — so every page break landed one character apart from the editor's
> (halvesbisect: editor 2426 vs pane 2425 at the FIRST break, on plain prose, on every shape).
> Canonical pagination's whole claim is "the same text on page N at every zoom, on phone, and in
> print"; a pane that mirrors the editor cannot wrap by another rule. blockEligibility already
> refuses to model anything but `break-spaces` for exactly this reason ("whitespace-unproven").
> NB the flat branch below has always pinned `pre-wrap` — a THIRD mode. Three surfaces meant to
> mirror each other, three wrapping rules, none of them checked against another until now.

Also the FullDiffView contract that surrounded it:

> Left pane: entire document with inline green/red diff marks (no collapsing).
> When ops is null (first snapshot), falls back to the rich DocView with formatting.
> When ops exists, renders plain-text diff — inline marks (bold etc.) are not
> preserved because the diff runs at the text level. A ProseMirror-aware diff
> would be needed for mark-level fidelity (future work).
> onOpClick: called with opIdx when a change span is clicked (reverse hyperlink to right pane).

## <a id="sv-rich-pane"></a>Rich pages for every version, on ONE flag

> RICH PAGES FOR EVERY VERSION (flag `inkwave:textRender`, DEFAULT ON since 2026-07-18). Below this
> line is the legacy FLAT transcript: one pre-wrap span of `pmToText`, which is what 115 of 116
> versions rendered before this graduated. It survives ONLY behind the sticky `?textRender=off`
> opt-out. RichDiffView projects the same ops back onto the PM tree (provenance/textMap.ts) so the
> pane shows real headings/lists/citations with the diff marks intact.
>
> GATED ON textRenderEnabled(), DELIBERATELY — not on a flag of its own. The canvas renderer and
> this DOM landing must move TOGETHER: a rich canvas frame settling onto a flat pane (or the
> reverse) is round 11's two-rules-one-pane disease, which cost 186px of drift. One flag makes
> that combination unrepresentable rather than merely unlikely.

## <a id="sv-doclayer"></a>DocLayer — one snapshot's pane, kept alive

> The flip-to-card architecture (2026-07-11): each recently-visited snapshot keeps its whole
> rendered pane (static HTML + inserted gaps + sheet panels + its own scroll position) mounted in
> an absolutely-positioned layer; only the active one is visible. `visibility:hidden` (NEVER
> display:none) keeps the hidden layers' layout alive, so flipping to a warm layer is paint-only —
> no React remount, no re-layout of a 40-page document, no gap re-insertion. Pagination runs ONCE
> per layer: immediately when it mounts active, ~150ms deferred when it mounts as a hidden warm
> neighbour (splits the warm into two shorter tasks: subtree layout, then canonical measure).
> On activation the layer points the shared refs (leftScrollRef/pagRef/pageGeo) at itself in a
> LAYOUT effect, so every parent effect keyed on snapshot.id still reads the right scroller.

⚠ **That paragraph was STALE where it named the hiding mechanism, and the compression pass corrected
the rule rather than preserving the error.** The shipped code has used `opacity: 0.001` since the
round-11 keep-alive work (`DocLayer`'s own inline style, and the same value on the sweep replicas);
`visibility:hidden` is not what runs, and the archive's round-11 entry, CLAUDE.md and three other
comments in this same file all say `opacity: 0.001 — never 0 / visibility / display`. A truly-hidden
layer loses its compositor backing store and the next flip stalls ~500ms. The header now states the
mechanism the code uses; the paragraph above is kept only as the record of what it used to claim.

The layer's own anchor and warm-capture contracts, moved from the `DocLayerHooks` fields:

> Where THIS layer's version must sit so the reader's content stays under the reading line.
> CONTENT identity, not scroll offset: versions differ in LENGTH, so a shared scrollTop lands
> different words in every version (measured: anchor drift 0px, centre content held 33%). The
> scroller is passed in because the answer is a property of the TARGET version's own layout.

> Warm (NON-ACTIVE) layer painted → scrub-bitmap capture. `pages` is THIS layer's canonical page
> geometry (round 10): the sweep's offscreen minimap replica needs a non-active version's real
> page regions, and this hidden layer is the only place they exist. ADDITIVE — it rides the
> warm-only branch that already ran; the ACTIVE path (onActivate / onGeo / the shared
> leftScrollRef+pagRef+pageGeo binding) is untouched.

And the LRU window it sits in:

> Pagination + rendering moved INTO DocLayer (one per snapshot, kept alive). Here we manage the
> LRU window: the active id joins at render time (a flip to an unwarmed snapshot must mount this
> commit); the ±1 neighbours warm AFTER the flip has painted, staggered so each warm (a hidden
> full render + canonical measure) is its own task; old layers beyond MAX_LAYERS evict LRU,
> never evicting current/prev/next.

## <a id="sv-sweep-panes"></a>Sweep panes and the offscreen replicas (round 10)

> BACKGROUND SWEEP (2026-07-16 — Peter "yes add the sweep"): bake a thumbnail for EVERY version
> while /snapshot sits open, Photos-style library pre-generation. A thumbnail can only be
> rasterised from a MOUNTED pane, so the sweep drives one extra hidden warm DocLayer at a time
> (opacity 0.001 — same keep-alive machinery): mount → onWarmReady → queueCapture → bake → next.
> Idle-only, pauses on ANY input or active scrub, resumable, bakes OUTWARD from the current
> position. Without this the flipbook has nothing to flip on a first-pass cold scroll.

> Sweep PANES (round 10, 2026-07-16) — the diff panel + minimap for an UNVISITED version.
> The sweep bakes from a hidden warm DocLayer, which only ever gave us the DOC pane; the diff
> panel and the minimap render off the ACTIVE snapshot's state, so two of the three panes had no
> thumbnail for an unvisited version and a cold fling fell back to a stale nearest for both
> (the asymmetry Peter saw: one pane flickering, two lagging).
>
> Neither needs the version ACTIVATED, and neither touches the visible panes:
>  · DIFF — `opsBetween(prev, target)` is a PURE, diffCache-backed function of two snapshots and
>    InlineDiffView is a pure render of those ops. So we render a second InlineDiffView into an
>    OFFSCREEN host sized to the real diff pane's box and capture THAT.
>  · MAP  — MinimapPanel is already parameterised by (leftRef, ops, pageGeo); it never reads the
>    active snapshot. Point it at the SWEEP LAYER's own scroller + that layer's page geometry.
> The contract change is exactly one line in DocLayer: the warm-only branch now hands its pages
> to onWarmReady. The ACTIVE layer's activation path is byte-unchanged.

> Sweep replica panes (round 10) — the offscreen diff panel + minimap for the sweep version.
> opacity 0.001 (the DocLayer keep-alive rule, NOT display:none/visibility): a truly-hidden
> subtree has no boxes to measure and nothing to rasterise. Fixed at the viewport origin behind
> the panes (z 0, pointer-events none); everything on top of it is opaque.

> LAY THE REPLICAS OUT IN FLOW (flex row), NEVER with position:absolute + a left/top offset.
> A captured element's OWN inline position rides into the clone, and captureRegion drops the
> clone at the foreignObject's origin — so an offset host rasters OUTSIDE the crop, comes back
> blank, gets silently dropped by blank-detect, and stalls the sweep on that version forever
> (probed: scrub.capture.fail.map, map baked 1/36). Each host also mirrors its real
> counterpart's `position` exactly (mapHost is relative).

## <a id="sv-fit"></a>Fit cap, pane zoom and the phone pinch

> Fit cap + effective pane zoom (Peter, 2026-07-10 — the main editor's fit-to-width floor).
> The doc pane's zoom lives as CSS `zoom` on the PAPER (applied imperatively below), so scaling
> shrinks the whole page — sheet, panels, gaps, text — and a narrow pane always shows the FULL
> page, never a horizontally-cut one. fit = (paneWidth − water margins) / canonical page width,
> recomputed on every pane resize (split drag, window resize, side panel). Manual zoom below the
> cap works; zooming past fit is capped, exactly like magnify.ts's fitScale. PHONE: the pane
> defaults to the phone view — fluid full-width paper + PHONE_PAGE_MARGIN (staticPagination), so
> effective zoom is pinned to 1 and the page spans edge-to-edge with no side water.

> Phone PINCH → pane zoom (Peter, 2026-07-10: "two-finger zoom doesn't work at all").
> Two fingers on the doc pane drive the SAME CSS-zoom effZoom pipeline, live: the zoom writes
> are imperative + rAF-coalesced during the gesture (CSS zoom on the static pane is one cheap
> uniform rescale — the sheet panels/gaps live INSIDE the zoomed paper, so nothing needs
> repositioning mid-gesture), and the gesture end commits to phoneZoom state → one repaint
> refreshes pageGeo. The pinch midpoint's content point is held stationary via scroll
> correction. CAPTURE-phase listeners + stopPropagation own the two-finger gesture on this
> pane: Scroll.tsx's surface pinch (the font-reflow pipeline) must never double-zoom, and the
> swipe scrub's multi-touch bail hands off here. Per the phone input invariant, touchstart is
> passive and the non-passive touchmove is armed only while two fingers are down.

## <a id="sv-page-sync"></a>Midline page sync

> Midline PAGE SYNC (Peter, 2026-07-10).
> When the DRIVER pane's midline crosses a page boundary, the FOLLOWER flies to that page — the
> editor's boundaries are the real canonical page regions (pageGeo); the diff panel's are its
> page rules ([data-page], wired to the same breaks). Fires ONLY where the continuous bijection
> isn't already driving that direction (it would fight the spring / the per-frame inverse map):
> editor→diff jumps unless bijMode 'both'; diff→editor jumps only in 'off'. Hysteresis: pages
> are latched per pane — one jump per boundary CROSSING (a further crossing mid-flight simply
> RETARGETS the follower); snapshot navigation re-latches without jumping (nav-settle window).

## <a id="sv-hover"></a>Cross-pane hover rings paint PER FRAGMENT

> hover: NO gold. Just the same green/red ring, THICKENED — from 1× (unlit) up to 2× when the diff
> is fully lit (--iw-align=1), proportionally in between. Full-alpha so the hover reads on any diff.
> PER-FRAGMENT (Peter, 2026-07-10): `outline` paints ONE rect around the union of an inline's
> fragments, and a diff span straddling a page break hosts a BLOCK gap/marker child (block-in-
> inline split) — the union rect became a giant empty box spanning the water / the whole page
> (gapped AND marker mode). An inset ring shadow + box-decoration-break:clone paints per LINE
> FRAGMENT instead — each wrapped line gets its own ring, gaps get nothing, and the browser
> recomputes fragments on any reflow (zoom included) for free. Ring listed before the fill so
> it stays on top.
> COLOURS COME FROM THE --iw-snap-* TOKENS, never literals: these rules paint over BOTH panes
> and both themes, and a literal here reproduces the exact half-lit screen the palette fixes.
> The channel triples are substituted into rgba() so one token drives ring, fill and alpha.

## <a id="sv-anchor"></a>The registration anchor

> THE REGISTRATION ANCHOR (the doc pane's "same words at the centre" contract).
> Same shape as the zoom focal anchor (99bf8a0): hold a CONTENT identity, re-find it after the
> thing changed, land on it. Here the "change" is the version itself, so the counterpart is
> found through the provenance word-diff rather than re-read from the same DOM.
>
> THE RULE, in order — every branch lands SOMEWHERE sensible, never the top:
>   1. EXACT      — the anchor text exists in this version → put it under the reading line.
>   2. NEIGHBOUR  — the anchor text was inserted/deleted between the versions, so it HAS no
>                   counterpart. Fall back to the nearest text that provenance says survives
>                   into this version (`same` ops) and land THAT under the line. The reader
>                   drifts by the length of the edit, which is the smallest honest error
>                   available: there is nothing else to be at the centre.
>   3. RATIO      — no anchor at all (never scrolled / no surviving text). Proportional
>                   position, the pre-existing behaviour.
> Runs on the WARM layer's deferred pagination task (idle, beside a 130-270ms paginate and a
> 300ms+ raster), never on the input path. Observable: probes below tally each branch, so a
> fallback storm is visible instead of silently reading as "registered".

> KNOWN-NEGATIVE A/B (harness-only): the OLD rule — prime every version to the active pane's
> raw scrollTop. A probe must prove it can SEE this misregistration before its verdict on the
> fix means anything (this codebase has trusted instruments that measured a fiction).

> NB the scrub is ALWAYS content-registered — including under lineMode 'longest' (the
> default), which deliberately abandons the anchor to snap each version to ITS OWN biggest
> change. That rule is right for a deliberate single step ("show me what changed") and ruin
> for a burst: measured, it flings the reading position a median 50,455px per version, which
> is the mush Peter is describing. So 'longest' stays exactly as it is on the LIVE landing
> render (this changes no navigation semantics), while the flipbook frames the sweep bakes
> hold the reader's place. Landing in 'longest' then snaps to the change — as it already did
> before this commit, since the live render always re-anchored itself on landing regardless.

The harness-only registration trace beside it:

> Registration trace (harness-only; zero cost unless a probe defines the array).
> The burst RECORDER can only carry a centre signature for frames it CAPTURED this session — a
> hydrated thumbnail has none — so its `registered` rate is computed over a handful of steps
> (measured: 0-7 of a 12-step burst). Far too small to accept or reject an anchoring rule.
> This traces the real thing at FULL sample instead: for every version the sweep primes, the text
> actually sitting under that version's centre line AT THE SCROLLTOP ITS BITMAP IS CAPTURED AT.
> Read across the sweep, consecutive versions agreeing = the flip is registered. Same locator the
> recorder uses (paneCentreSig — text granularity; the pane is ~4 giant [data-opidx] spans, so
> block granularity would call every frame registered).

## <a id="sv-flipbook"></a>The shift-wheel flipbook and its four constants

> Shift-wheel FLIPBOOK (2026-07-16 — Peter: "if Apple Photos can flicker frame-by-frame on
> scroll, so should we"). Root cause of the old "stays put until you stop": the handler computed
> target off the COMMITTED idxRef and called goTo per event, so it advanced at most ±1 per React
> commit — a fast shift-wheel commanded only 1-3 distinct versions of 30 (probed). Photos swaps
> among ALREADY-RESIDENT textures decoupled from app state; so does this: a COMMANDED index runs
> ahead of React per event, an rAF driver presents EVERY intermediate from the resident bitmap
> cache (compositor swap, no React commit), the counter updates imperatively, and ONE React
> commit lands the live full render on settle. DPR1 cap keeps the resident pool affordable.
> Live diagnostics for ?snapThumbs=debug — separates "driver never ran" from "driver ran but had
> nothing to show" from "showed into an invisible node" (the wave-video bug class).

> LAND_QUIET_MS must be LONGER than a real mouse-wheel notch gap. At 120ms it landed BETWEEN
> notches (a hand-rolled wheel fires every ~150-250ms): the driver caught up, saw "quiet", and
> committed a full live render per notch — which is exactly Peter's "the minimap goes a few
> times a second but no flashing". Land only once the stream is no longer RAPID (same 250ms
> window goTo uses), and hold the freeze past that so the panes don't re-render mid-scrub.
> MAX_PER_FRAME=1 — EVERY commanded version gets its own frame (the Photos bar). At 2 the
> driver jumped two versions when behind and only show()ed the landing one, silently DROPPING
> the intermediate: a 12-notch fling commanded 11 but presented 7. One-per-frame at 60fps =
> 60 versions/s, far above any wheel cadence, so it keeps up AND flickers every version; an
> extreme fling just trails by a few frames and catches up (Photos does exactly this).
> SW_STEP trimmed 40 → 67 (Peter, 2026-08-28: "take 40% off the net scroll speed for
> trackpad/phone"). This costs a MOUSE nothing — a notch delivers 120, so one notch is still
> exactly one version, which is this path's whole contract — and halves what a trackpad's
> fine-delta stream flies through, which is the surface the complaint is about.

## <a id="sv-wheel-debt"></a>Debt on reversal

> DEBT ON REVERSAL (Peter's oldest complaint: "lags behind which version you're actually
> up to. When you stop it catches up.")
> A step consumes only SW_STEP(40) of the event's delta, but a mouse notch delivers 120 — so
> 80 of undischarged intent survives EVERY notch and compounds. After 12 backward notches the
> accumulator sits at ~-960, and a forward notch then reads -840: still negative, so it steps
> BACKWARD. Probed: 12 back then 12 forward = 5 fwd / 5 back, starts at 8, ends at 8 — the
> reversal nets nothing until the debt is paid off. Everyone (me included) read that as
> presentation latency for weeks; presenting was measured at 49-51/s the whole time.
> So: a direction change cancels the debt. NOT a full discharge — one notch stays one version
> (Peter's call: it removes the bug and changes nothing he likes).
> The `>= SW_STEP` test is what makes this safe for a TRACKPAD: a fine-delta stream never
> leaves debt (its accumulator always lands back inside [0, SW_STEP) after a step), so its
> jittery sign flips can never wipe legitimate in-progress accumulation. Only a coarse-delta
> device — the one that actually leaks — can hold a debt worth cancelling.

## <a id="sv-touch"></a>Touch swipe — flick vs scrub

> Touch swipe → snapshot scrub (phone).
> TWO modes, split by a PRESS-AND-HOLD (Peter, round 2: "a single flick goes over lots of
> snapshots — we need a short click-and-hold before the many-snaps-at-once kicks in"):
>  • FLICK (default): a plain horizontal swipe steps EXACTLY ONE version — slide LEFT = next,
>    slide RIGHT = previous — no matter how far or fast the finger travels.
>  • SCRUB (armed): hold the finger ~280ms mostly still FIRST, then drag — the position-based
>    scrubber (FIRST detent + REST px per step, like Apple Photos) with the fling coalescing.
> Vertical stays native scroll. Works starting on either pane. The swipe OWNS horizontal on
> this view: `touch-action: pan-y` on the root + panes keeps the browser's native x-pan from
> racing it, and the horizontal branch preventDefaults. EXCEPTION: a pinch-zoomed doc pane
> (zoom > 1) pans the page horizontally instead of scrubbing.

The trackpad position scrubber, and the **duplicate** that sat under it:

> Trackpad TWO-FINGER HORIZONTAL swipe over the editor or diff pane → snapshot scrub — a pure position
> scrubber (Apple-Photos style): NO flick/momentum. A small detent (FIRST) commits the first snap, then
> every REST px is another, applied as a NET hop per event so a light swipe flies through 10-30. A pause
> resets the gesture so the next swipe re-arms the detent. Vertical wheels are untouched.
> GESTURE STATE LIVES IN REFS (round 3): this effect re-subscribes on every step (per-render `nav`
> identity + the per-landing scroller swap), and effect-local accum/started reset the detent
> mid-gesture — every step cost ~5 more events (probed: a 22-step scrub degenerated to ~3 hops).

> Detent state in a REF, not effect-local: this effect re-subscribes on every step (per-render
> `nav` identity + the per-landing scroller swap), and effect-local state reset the gesture
> mid-scrub (round 3 — a 22-step scrub degenerated to ~3 hops).

Those two paragraphs state the SAME rule (R7 — decided once while the world kept moving) about the
SAME mechanism, back to back, in slightly different words. One survives in the source.

## <a id="sv-fling"></a>Fling coalescing

> Fling coalescing (2026-07-11).
> Rapid navigation streams (fling / held key / shift-wheel storm) FREEZE the heavy split view on
> the snapshot it's already showing and render only the LANDING version once inputs go quiet.
> Detection lives in goTo (the chokepoint for every navigation) and keys off INPUT spacing —
> detecting off render spacing failed: when each step renders slowly the steps land >160ms
> apart and nothing froze, which was the whole case that needed freezing. An isolated step
> (a normal swipe) never freezes, so single flips stay immediate. The header counter/word-diff
> stay live off the real idx, so the user still sees the position fly during a fling.

## <a id="sv-swipe-nav"></a>The browser must not steal the sideways swipe

> The browser must not steal the sideways swipe (Peter, 2026-08-30).
> On a Mac trackpad a two-finger horizontal swipe fired the browser's own back/forward and threw
> him out of the review mid-read — while THIS VIEW already owns that gesture (the deltaX position
> scrubber below). `overscroll-behavior-x` on the ROOT is what suppresses it, and it must be the
> root because the rule propagates to the viewport only from `<html>`; a swipe landing on the
> minimap or the header has no scroller under it at all and chains straight there. Scoped to this
> route by adding the class on mount, so nothing about the editor's own gestures changes.
> See the `.iw-no-swipe-nav` block in index.css for why preventDefault is not the mechanism.

## <a id="sv-break-tables"></a>Break tables for every version

> BREAK TABLES FOR EVERY VERSION (flag `inkwave:snapBreaks`, default OFF).
> The whole-document index the plaintext page renderer opens from: per version, the doc position
> each page starts at (~656B on disk vs the 62.9MB bitmap pool). Built here — on the route that
> OWNS the versions — because /snapshot has no editor, which is exactly why the tables could not
> be built at all until `editorSchema.ts` made a version's contentJson parseable outside one.
>
> Keyed on [docId, allSnapshots.length] — NOT on snapId. A scrub step must never restart the
> sweep (the perf note above this block is the same lesson: a pure snapId change must not re-read
> the archive). Hydration makes a re-run nearly free anyway, but "nearly free × every scrub step"
> is how a background task becomes the thing you are debugging at 2am.
>
> This does NOT paint. It fills the index and stops; wiring the renderer's show() path is the
> paint lane's, and a table is useless-but-harmless until then. Nothing here can touch typing:
> there is no editor on this route (see snapshotBreaks.ts's header).

## <a id="sv-badges"></a>Header +N/−N badges

> Header words-diff badges (+N / −N) — live per step, like the counter.
> These used to be pinned to the HEAVY (frozen) pair, on the stated reasoning that an LCS per
> intermediate would jank the gesture "for a number nobody reads mid-fling". Peter reads it
> mid-fling: the premise was wrong, not the implementation. The counter already shows the shape
> — precomputed per index, written imperatively by the driver, no React commit per step — which
> is exactly why the version number keeps up while these crawled.
>
> NEVER an LCS on the input path (that concern was legitimate): peekOpsBetween is cache-only.
> `preloadDiffWindow` keeps ±20 resident, so a scrub is reading numbers already paid for.
> Memoised per PAIR (not per index — indices shift when a snapshot arrives; ids don't).

## <a id="sv-grid"></a>One stable DOM structure for wide↔narrow

> ONE stable DOM structure — the same 5 items in a constant order — placed by CSS-grid areas that differ
> for wide vs narrow. Because the panes keep their position/identity, the wide↔narrow flip re-lays-out via
> CSS instead of tearing down and rebuilding every pane (the remount storm that caused the switch jank).
>   wide:  [ diff | d1 | editor | d2 | side ]           (one row)
>   narrow: editor on top; d1 splits it from a bottom row of [ side | d2 | diff ]

## <a id="sv-drift"></a>Judge registration by DRIFT IN PX

> DRIFT, in px — the measure the zoom focal anchor was proved with (99bf8a0: 0.0-0.3px), and
> the only one that is honest here. A signature of the centre LINE cannot answer this: it is
> the line's OPENING 60 chars, so an anchor sitting mid-line (which wrapping alone decides,
> and wrapping differs between versions of different length) reads as a miss even though it is
> exactly under the reading line. So ask geometry instead: where IS the anchor text now,
> relative to the centre? `null` = the anchor has no counterpart in this version at all.

> Warm layers pre-scroll to the anchor's position IN THEIR OWN VERSION — the same CONTENT
> under the reading line, not the same scrollTop (see getAnchorTop). This is the whole
> registration contract: this scrollTop is the one the layer's scrub bitmap is CAPTURED at,
> and a warm layer never gets the active path's midline reposition, so if it is primed to a
> raw offset its bitmap is misregistered FOREVER — every frame individually correct, the
> sequence sliding. Once painted here the layer is ready for its capture (idle — scrubRaster).

## <a id="sv-pane-water"></a>No `--wave-x` sway on a pane-scoped water pseudo

> NO --wave-x scroll sway here (2026-07-12 "snapshots lagging massively"): the pane-scoped
> water pseudo is CONTENT-tall (>60,000px on a thesis), so every sway write invalidated its
> whole paint and re-rastered the visible water tiles per scroll event — the same class of
> bug as the editor's --wave-x subtree invalidation (see the typing-invariants block). The
> absolute pseudo already scrolls WITH the content; the waves in the page gaps move naturally.

## <a id="sv-warp"></a>The warp physics, the magnetic snap and the alignment glow

> Editor snap mode A — WHEEL-TAKEOVER PHYSICS: we take the wheel and integrate a particle (the scroll
> position) moving with LINEAR RESISTANCE through a landscape of POTENTIAL WELLS at the diffs. A wheel
> delta is an impulse to velocity; each frame: v += wellForce − resist·v (exponential-decay fling that
> the wells bend), then x += v · speedWarp (the Mexican-hat slow-through/fast-before layered on). Result:
> a fast flick coasts and decays Apple-style; a slow one is captured and settles onto the nearest diff.
> Ctrl/⌘+wheel is left alone (that's the diff zoom). Centres come from the cache → zero layout per frame.

> Local magnetic snap: within ±W of a diff LOCK POINT, blend the linear map toward a slope-1 line
> through the lock, so both midlines move in lockstep AT the lock (dry/dlMid = 1, d²ry/dlMid² = 0 —
> Taylor-matched to 2nd order), easing back to linear by the window edge. smootherstep gives zero
> 1st AND 2nd derivative at both ends → no kink where it hands back to the linear segments. The
> window is capped to half the gap to the nearest neighbouring lock so adjacent windows never
> overlap (they meet at u=0, staying continuous). This is what makes passing a change feel like it
> "clicks in" without the whole follow being snappy.

> Synchronised alignment glow: a CONTINUOUS Gaussian per diff — intensity 1 when its centre is on
> the midline, tapering to ~0 about 40px past its top/bottom edges (reach = half-height + 40). No
> cap: every diff glows in turn as it passes. Both panes get the same --iw-align, so they light up
> together. Clear diffs that scrolled out of reach.
> PLATEAU glow: fully lit (1) the whole time the midline is inside the diff body (|d| ≤ half) — so
> every diff is reliably, fully lit once as it passes — with a smootherstep dropoff over the next
> GLOW_DROP px (curved shoulders, zero slope at both ends → no visible edge).

> Hover glow lights whenever the cursor is over a diff — EXCEPT while panning or scrolling (scrolling the
> content under a still cursor was the case that spuriously lit it; see the scroll-suppress effect).
> A multi-line diff is ONE wrapped span, so the leading between its lines isn't over the span and fires a
> mouseleave. Treat the diff as a BLOCK: on leave, keep it lit if the cursor is still inside its bounding
> box (a span's getBoundingClientRect spans all its line-boxes, gaps included). Applies to both panes.

## <a id="sv-unreadable"></a>'unreadable' is its own status

> 'unreadable' is its OWN status, and both other answers were wrong. A throw would leave this
> on 'loading' forever ("Loading…" with nothing coming — the spinner-forever shape). And
> 'missing' renders "That snapshot isn't on this device", which on a failed read is a LIE
> about the one thing this page exists to show: it would tell Peter his history is gone while
> it sits intact on disk. Neither. Say the truth: we couldn't read it, try again.

This is **R1** (an unknown is not a known-empty), the family that caused six data-loss incidents.

## <a id="sv-rapid-input"></a>Rapid detection reads the INPUT EVENT's own timestamp

> INPUT-TIME rapid detection (round 3): goTo runs AFTER the previous step's synchronous React
> render, so goTo-to-goTo spacing ≈ render time — a heavy cold flip (300-500ms) kept every
> pair >250ms and rapid mode never engaged EXACTLY when it was needed (probed). Events carry
> hardware timestamps (e.timeStamp, performance.now() clock): each input source stamps ONCE
> per user input; goTo checks the last INPUT pair. The old goTo-spacing check stays as an OR.

> PERF (2026-07-11): a pure snapId change (every scrub step) must NOT re-read the archive —
> the list is already in state and a fresh `.slice()` per step invalidated every downstream
> memo. Only a doc change (or an unknown snap) goes back to the store.

> ARMED-SCRUB inputs (the hold-armed touch drag, the trackpad position scrubber) are bitmap
> mode from their FIRST step (Peter's spec: "armed multi-scrub AND rapid single flips") — the
> first step of a burst otherwise takes the live path, and its 300-1100ms cold render bunches
> the queued inputs into fling jumps (probed: 21 steps collapsed into ~3 goTos). Flicks stay
> 'flick' → the isolated single-step live flip is untouched.

> This path FLIPS THE BITMAP TOO, so it owes the badges the same update the rAF driver gives
> them — otherwise the header keeps the old version's number while a new version is on
> screen. That is the exact lie this whole change removes, and it was measurable: a burst's
> first notch is not yet `rapid` (lastNavInputAt is 0 on a fresh page), so it lands HERE, and
> the probe saw 14 versions presented against 13 badge paints — one stale frame at the start
> of every gesture. Same cache-only read; an uncached pair still blanks rather than lying.

## <a id="sv-aria"></a>`aria-disabled`, not `disabled`, on the header lozenges

> `aria-disabled` rather than `disabled`: the click is already withheld, and this states the fact
> that the lozenge is INACTIVE — which is what licenses its deliberately faint colours in both
> themes (WCAG 1.4.3 exempts inactive components, and a contrast sweep must be able to tell an
> unavailable control from an illegible one rather than being handed an exemption list).
