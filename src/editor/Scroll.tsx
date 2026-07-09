import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx, paperCssSize } from './pageModel'
import { syncPrintPageStyle } from './printPageStyle'
import { getMagnify, setUserMagnify, persistMagnify, setFitContext, subscribe as subscribeMagnify, scaleFor, MIN_MAGNIFY, WATER_MARGIN_PX } from './magnify'
import { stepToZoom, zoomToStep } from './zoomStep'
import { syncTwinkles, reportSway } from './waveTwinkle'

// True on touch phones/tablets (coarse pointer, no hover). Device-based — does NOT change with
// browser zoom — so it's the right signal for "phone vs desktop" layout (margins, background).
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse) and (hover: none)')?.matches === true
}

// ── Zoom input sensitivity (Peter, 2026-07-10: both were too slow — retune HERE) ──────────────
// Trackpad ctrl-pinch fine-deltas: multiplier on the fractional step per 100px of deltaY. A
// discrete mouse-wheel notch (|ΔY| ≥ 100) is ALWAYS exactly one 1.08 step — this only speeds up
// the sub-notch accumulation, capped at one step per event.
const TRACKPAD_ZOOM_SENSITIVITY = 2
// Phone pinch: multiplier on the finger-distance-ratio → steps mapping (log(d/d₀)/log(1.08)).
// 1 = the pinched distance ratio maps 1:1 onto the zoom ratio; higher = fewer centimetres of
// pinch per step. Steps still commit whole on the shared zoomStep lattice.
const PINCH_ZOOM_SENSITIVITY = 1.75

// ── Deep-zoom-out scroll acceleration (Peter, 2026-07-10) ─────────────────────────────────────
// The plain-wheel scroll is content-proportional (delta × scale) so a notch always covers the
// same fraction of a page — but taken literally that gets GLACIAL at tiny scales (at 0.05 a notch
// is 5px). Below the knee the multiplier accelerates above pure proportionality, ramping harder
// as the scale approaches MIN_MAGNIFY: f(s) = s^(1 − a·t), t = (KNEE − s)/(KNEE − MIN) ∈ [0,1].
// At the knee t=0 → f(s) = s exactly (continuous, and the s ≥ KNEE regime is byte-identical);
// with a = 0.5 the boost over proportional is ≈2.4× at s=0.1, ≈3.9× at s=0.05, ≈7× at 0.02.
// Retune the KNEE (where acceleration starts) and STRENGTH (how hard it ramps) — not the formula.
const SCROLL_ACCEL_KNEE = 1 / 3
const SCROLL_ACCEL_STRENGTH = 0.5
function scrollScale(s: number): number {
  if (s >= SCROLL_ACCEL_KNEE) return s
  const t = (SCROLL_ACCEL_KNEE - s) / (SCROLL_ACCEL_KNEE - MIN_MAGNIFY)
  return Math.pow(s, 1 - SCROLL_ACCEL_STRENGTH * Math.min(1, t))
}

// The scroll "paper" chrome — the white page surface and the parchment column with its drop
// shadow. Shared by BOTH the live editor (TiptapEditor) and the prerendered/loading shell
// (EditorShell) so the static landing page is a direct visual function of the same components
// + CSS. Style changes here flow to both.
//
// Both wooden rollers are now removed and the page is pulled up near the top of the viewport
// (see the `.inkwave-editor-surface` rule in styles/index.css). Long-term the parchment grows a
// vectorised torn-paper edge; keeping the chrome in one shared component makes that a one-place change.
export function Scroll({
  children,
  paperRef,
  containerRef,
  phone = false,
  fill = false,
  revealed = true,
  fadingOut = false,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
  phone?: boolean // touch device: paper fills the screen, no background (see isTouchDevice())
  fill?: boolean  // the live editor: make the surface a fixed, full-region scroll container (desktop).
                  // Off for the snapshot view, where the surface must stay in-flow inside its split pane.
  revealed?: boolean
  /** 0.5s opacity fade-out of the WHOLE surface (the loading shell's atomic cross-fade reveal). */
  fadingOut?: boolean // one-paint load: false hides the whole PARCHMENT (waves only) while fonts/
                     // pagination settle — visibility, not display, so layout + measurement still run.
                     // The editor flips it once; the loading shell passes false so page + text appear
                     // together, atomically, instead of paper-then-text.
}) {
  // The (fixed) background waves don't scroll with the page. As you scroll we only sway them
  // HORIZONTALLY — alternating rows opposite ways (see the opposite --wave-x in styles/index.css) —
  // with no vertical movement. rAF-throttled.
  const surfaceRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Hybrid zoom (desktop live editor only): the paper sits inside a size-compensated wrapper that
  // the magnify transform scales. paperRef is optional (the loading shell passes none) — keep a
  // local ref so the wrapper machinery works on every hybrid surface.
  const magnifyBoxRef = useRef<HTMLDivElement>(null)
  const localPaperRef = useRef<HTMLDivElement>(null)
  const paperElRef = paperRef ?? localPaperRef

  // ── Wave stillness through zoom (Peter: "stop it moving the waves") ─────────────────────────
  // The sway is --wave-x = base + scrollTop·WAVE_SWAY (see the scroll-sway effect below). Zoom
  // writes scrollTop in many ways — anchor corrections, the settle re-anchor, and ASYNC browser
  // scroll-clamps when the wrapper/content shrinks (those materialise at a later layout flush, so
  // no synchronous bracket can catch them all). Mechanism: zoom activity opens a HOLD WINDOW
  // (holdWavesFor, extended by every zoom frame + settle); while it's open, the sway handler
  // treats every scroll delta as zoom-driven and rebases the base EQUAL-AND-OPPOSITE — --wave-x
  // is held exactly constant through gesture, settle, re-measure and any clamp. When the window
  // closes, sway resumes from exactly where the waves were (same rebase pattern as the coast
  // handoff) — no jump. Trade-off: a user scroll INSIDE the window doesn't sway (decorative, and
  // scrolling mid-zoom is rare); the moment the window lapses, normal sway is untouched.
  const WAVE_SWAY = 0.06 // 2/3 of the old 0.09 sway speed — shared by the sway + the rebases
  const waveBaseRef = useRef(0)
  const zoomHoldUntilRef = useRef(0)
  const holdWavesFor = (ms: number) => {
    zoomHoldUntilRef.current = Math.max(zoomHoldUntilRef.current, performance.now() + ms)
  }
  // Gapped mode draws a separate-sheet drop shadow at EACH page break (the rounded caps in
  // PaginationExtension); the single tall outer shadow would otherwise bleed continuously down the
  // left/right edges and through the gaps, so we drop it here and let the per-gap caps do the work.
  const gapped = gappedPagesEnabled()
  const [, rerender] = useState(0)
  useEffect(() => {
    const onChanged = () => { syncPrintPageStyle(); rerender(n => n + 1) }
    syncPrintPageStyle() // keep the print @page size in sync with the paper settings (see printPageStyle)
    window.addEventListener('inkwave:page-settings-changed', onChanged)
    return () => window.removeEventListener('inkwave:page-settings-changed', onChanged)
  }, [])

  // HYBRID ZOOM scope: only the desktop LIVE editor (fill) with a fixed-size paper gets the
  // transform-magnify + fit-to-width cap. Phone has its own model (canonically-narrower render +
  // pinch font zoom); SnapshotView's in-flow Scroll and 'scroll' paper (no mm width) stay plain.
  // getPaperSize() is re-read on the page-settings rerender above, so switching paper flips this.
  const hybrid = fill && !phone && getPaperSize() !== 'scroll'

  // ── Magnify plumbing (hybrid only) ──────────────────────────────────────────────────────────
  // ONE subscriber applies the module's effective magnify to the DOM: the --iw-magnify var (the
  // CSS transform reads it), the .iw-magnified class (scaleFor() keys off it; also gates the
  // transform rule so scale=1 renders EXACTLY like master — no containing-block change), and the
  // wrapper box's width/height. The wrapper is the scroll-height fix: transform doesn't change
  // layout size, so a scaled-down page would leave ghost scroll space (and a scaled-up one would
  // clip) — sizing the wrapper to the page's VISUAL dims (pageW·s × paperH·s) makes layout ≡
  // visual, so the scroll range always matches what's on screen and mx-auto centring stays exact.
  // useLayoutEffect: the first fit/magnify application lands BEFORE the browser paints the mounted
  // surface, so a narrow window (or a persisted magnify) never flashes one frame at scale 1.
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el || !hybrid) return
    const box = magnifyBoxRef.current
    const paper = paperElRef.current
    const pageW = () => pageBoxPx({
      paperSize: getPaperSize() === 'letter' ? 'letter' : 'a4',
      orientation: getOrientation(),
      topMarginPx: getTopMarginPx(),
      bottomMarginPx: MARGIN_BOTTOM,
    }).pageWidthPx
    const apply = () => {
      const s = getMagnify()
      el.style.setProperty('--iw-magnify', String(s))
      el.classList.toggle('iw-magnified', s !== 1)
      if (box) {
        // s=1 → restore the mm width React rendered (layout identical to master) + natural height.
        box.style.width = s === 1
          ? paperCssSize(getPaperSize() === 'letter' ? 'letter' : 'a4', getOrientation()).width
          : `${pageW() * s}px`
        box.style.height = s === 1 || !paper ? '' : `${paper.offsetHeight * s}px`
      }
    }
    // Settle: persist the INTENT + fire the settle event (PageGuides/panels repaint; the breaks
    // are canonical so the pagination re-measure is a stable-set no-op — no lurch). Debounced so
    // a wheel gesture / continuous window resize settles once.
    let settle: ReturnType<typeof setTimeout> | undefined
    const armSettle = () => {
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        persistMagnify()
        holdWavesFor(800) // the settle re-measure (+ any clamp it causes) must not sway the waves
        window.dispatchEvent(new Event('inkwave:zoom-settled'))
      }, 200)
    }
    // holdWavesFor: applying a new scale resizes the wrapper, and the browser may CLAMP scrollTop
    // against the new extent (asynchronously, at the next layout) — scroll changes the sway must
    // absorb, whether this fires inside a wheel frame or standalone on a resize-driven fit change.
    const unsub = subscribeMagnify(() => { holdWavesFor(350); apply(); armSettle() })
    // FIT CAP: recompute from the surface's width on every resize (and page-settings change).
    // clientWidth excludes the scrollbar (scrollbar-gutter: stable), so the fit page never sits
    // under it; WATER_MARGIN_PX keeps a strip of water visible either side.
    const computeFit = () => setFitContext(Math.max(60, el.clientWidth - 2 * WATER_MARGIN_PX), pageW())
    const ro = new ResizeObserver(computeFit)
    ro.observe(el)
    // Wrapper height must track the paper's (unscaled) height through reflows — font zoom,
    // typing, pagination. offsetHeight is layout px (transform-invariant), × s = visual height.
    const roPaper = paper ? new ResizeObserver(() => {
      const s = getMagnify()
      // The height write can clamp scrollTop (content shrank while scrolled near the end) — a
      // layout side-effect, not a user scroll: keep the waves still through it.
      if (s !== 1 && box && paper) { holdWavesFor(250); box.style.height = `${paper.offsetHeight * s}px` }
    }) : null
    if (paper && roPaper) roPaper.observe(paper)
    // Settings change: recompute the fit cap for the new page width, and re-apply AFTER React's own
    // settings rerender commits (rAF lands post-commit, pre-paint) — otherwise React's fresh mm
    // width on the wrapper would clobber the imperative pageWidth·s px while magnified.
    const onSettings = () => { computeFit(); requestAnimationFrame(apply) }
    window.addEventListener('inkwave:page-settings-changed', onSettings)
    computeFit()
    apply()
    return () => {
      unsub()
      ro.disconnect()
      roPaper?.disconnect()
      window.removeEventListener('inkwave:page-settings-changed', onSettings)
      if (settle) clearTimeout(settle)
      el.classList.remove('iw-magnified')
      el.style.removeProperty('--iw-magnify')
      // NB: the module's fit cap is deliberately NOT reset here — the loading shell and the live
      // editor are BOTH hybrid surfaces during the load handoff, and the shell unmounting must not
      // yank the cap from under the editor. A remount recomputes it immediately (computeFit()).
    }
  }, [hybrid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Non-hybrid fill surfaces (phone; 'scroll' paper) render the magnify wrapper too — hydration
  // STRUCTURE must match the desktop-built prerender (see the render below) — but must not keep
  // its width: React 18 silently adopts mismatched server attributes at hydration and never
  // rewrites one whose vdom value doesn't change between renders, so the build-time `width:210mm`
  // would stick to a phone's wrapper forever (horizontal overflow). Clear it pre-paint.
  useLayoutEffect(() => {
    if (fill && !hybrid) magnifyBoxRef.current?.style.removeProperty('width')
  }, [fill, hybrid])

  // In-app editor zoom: Ctrl/⌘+wheel (desktop) or two-finger pinch (phone) over the editor scales
  // the font (so text REFLOWS, like a webpage) — isolated from the PDF panel because we
  // preventDefault the browser zoom. Persisted; both inputs share the same key + pipeline.
  // LATTICE (predictive step cache): the level is always a zoomStep.ts lattice point — legacy
  // persisted floats snap to the nearest step on load, so every rendered zoom is a cacheable one.
  const [editorZoom, setEditorZoom] = useState(() => {
    try { return stepToZoom(zoomToStep(Number(localStorage.getItem('inkwave:editorZoom')) || 1)) } catch { return 1 }
  })
  const editorZoomRef = useRef(editorZoom); editorZoomRef.current = editorZoom
  // Anchor the font zoom to the pointer, SYNCHRONOUSLY (no flicker): set the zoom var, force layout by
  // reading the anchored element's new position, then correct scrollTop in the SAME frame — all before
  // the browser paints. The anchor is the actual element under the cursor (exact — a fraction estimate
  // drifts badly further down the page since reflow doesn't grow uniformly). scrollLeft is held so it
  // never jumps to the left edge. React state is updated after, to the same value (no re-paint).
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return // desktop: Ctrl/⌘+wheel on the surface; phone: two-finger pinch (body-scroll, below)
    // FRAME COALESCING (the zoom-flicker fix): trackpads/pinch emit several wheel events per frame,
    // and each zoom step forces a FULL-document reflow (the font-size is calc'd from the zoom var).
    // 2–3 reflows per 16ms blows the frame budget on a long doc → visible stutter. So wheel events
    // only accumulate ±1 steps; ONE rAF applies the net step count — one reflow per painted frame,
    // and rAF runs before paint so the synchronous anchor logic below stays single-frame/flicker-free.
    // React state + localStorage persist are deferred to a settle timer: neither changes pixels
    // (the var is already on the DOM), and the per-tick setState re-rendered PageGuides for nothing.
    // BOTH accumulators are FRACTIONAL and commit WHOLE lattice steps per frame (Math.trunc, the
    // remainder carries) — wheel notches contribute ±1, trackpad fine-deltas and phone pinch
    // contribute proportional fractions, so every input quantizes onto the shared zoomStep.ts
    // lattice. That's what makes zoom levels precomputable (the pagination step cache).
    let steps = 0 // font-reflow zone
    let mSteps = 0 // magnify zone (hybrid, cursor over the WATER) — same coalescing, separate zone
    let raf = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    // Phone is BODY-scroll: the anchor correction must move window.scrollY — the surface itself
    // never scrolls there (el.scrollTop is always 0). One pair of helpers keeps applyFrame +
    // the settle re-anchor identical for both scrollers.
    const getScrollTop = () => (phone ? window.scrollY : el.scrollTop)
    const setScrollTop = (y: number) => {
      if (phone) window.scrollTo(window.scrollX, Math.max(0, y))
      else el.scrollTop = Math.max(0, y)
    }
    const scrollRange = () => {
      if (!phone) return Math.max(1, el.scrollHeight - el.clientHeight)
      const se = document.scrollingElement || document.documentElement
      return Math.max(1, se.scrollHeight - window.innerHeight)
    }
    // Pinch state (phone): the gesture-START midpoint picks the anchor block; holding that element
    // and correcting by its actual displacement keeps the pinched-on text stationary for the whole
    // gesture (the same held-anchor rule as the wheel path, midpoint instead of viewport centre).
    let pinchDist = 0
    let pinchX = 0, pinchY = 0
    // One STABLE anchor element per gesture. Re-picking under the viewport centre every frame made
    // the anchor flip between elements at block boundaries, and the old correction pinned the picked
    // element's TOP to the centre line (scrollTop += topAfter - anchorY) — with multi-step coalesced
    // frames that per-frame snap compounded into a fast drift toward the doc top in BOTH directions.
    // Instead: keep the element picked at gesture start and correct by its ACTUAL displacement
    // (topAfter - topBefore), which holds the anchored text visually fixed for any zoom step size.
    let anchorEl: HTMLElement | null = null
    // MAGNIFY frame (hybrid, wheel over the water/gaps): scale the whole page about the VIEWPORT
    // CENTRE (Peter: "centre it around the centrepoint of screen" — the cursor position picks the
    // ZONE only, never the anchor). The wrapper box's rect IS the page's visual bounds (layout ≡
    // visual — see the magnify plumbing effect), so the content point at the screen centre is the
    // offset (centre − box.top) into the page; after the scale change it sits at box'.top +
    // offset·(after/before) — correct the scroll by its displacement so it stays pinned at the
    // centre (the shared conversion: paper-local = visual ÷ scale; new visual = local × new scale).
    const applyMagnifyFrame = () => {
      const net = Math.trunc(mSteps) // whole steps only; the fractional remainder carries
      mSteps -= net
      if (!net) return
      const box = magnifyBoxRef.current
      const before = getMagnify()
      const r0 = box?.getBoundingClientRect()
      const vr = el.getBoundingClientRect()
      const cX = vr.left + vr.width / 2, cY = vr.top + vr.height / 2
      const factor = net > 0 ? Math.pow(1.08, net) : Math.pow(0.926, -net)
      // Multiply the EFFECTIVE scale (not the raw intent): while the fit cap binds, intent hovers
      // just above it instead of silently running to 2.5 and snapping huge when the window widens.
      const after = setUserMagnify(before * factor) // subscriber applied var + wrapper sizes synchronously
      if (box && r0 && after !== before) {
        const r1 = box.getBoundingClientRect() // one forced layout, same frame — pre-paint
        el.scrollTop += r1.top + (cY - r0.top) * (after / before) - cY
        el.scrollLeft += r1.left + (cX - r0.left) * (after / before) - cX
      }
      // Persist + zoom-settled ride the magnify subscriber's own settle timer (magnify plumbing).
    }
    const applyFrame = () => {
      raf = 0
      holdWavesFor(350) // zoom corrections (and the clamps they trigger) must not sway the waves
      applyMagnifyFrame()
      const net = Math.trunc(steps) // commit whole lattice steps; the fractional remainder carries
      steps -= net
      if (!net) return
      // Pick (or re-pick, if the node was destroyed) a TEXT block near the VIEWPORT CENTRE. Reject:
      // the big containers (.ProseMirror / .scroll-paper — they span the whole doc, so their top
      // reflows toward the doc top and a correction against them lurches — the old "jump to top"
      // bug) and the PAGE-GAP widgets/sheet chrome (their heights are pinned px that do NOT reflow
      // with the font, so anchoring against one warps the correction — the "funky near page gaps"
      // bug). When the centre line falls inside a gap, probe outward until real text is found, so
      // the anchor is effectively the nearest text above/below the gap.
      const vr = el.getBoundingClientRect()
      const anchorX = phone ? pinchX : vr.left + vr.width / 2
      const anchorY = phone ? pinchY : vr.top + vr.height / 2
      const pickAt = (y: number, strict: boolean): HTMLElement | null => {
        const t = document.elementFromPoint(anchorX, y) as HTMLElement | null
        if (!t || !el.contains(t)) return null
        if (t.classList.contains('ProseMirror') || t.classList.contains('scroll-paper')) return null
        if (t.closest('.ProseMirror') == null) return null // outside the text (sheet chrome, layer divs)
        if (t.closest('.inkwave-page-gap') || t.classList.contains('inkwave-page-gap-band')) return null
        // STRICT pass: refuse blocks SPLIT by a page gap (a mid-paragraph break nests the fixed-px
        // gap widget inside the block). Such a block's rect straddles the boundary, so as the text
        // redistributes across it the top↔gap relationship warps and successive frame corrections
        // alternate direction — the boundary-zoom flicker. Prefer a block fully inside one page.
        if (strict && t.querySelector('.inkwave-page-gap')) return null
        return t
      }
      if (!anchorEl || !anchorEl.isConnected) {
        // Probe the centre first, then alternate above/below in growing steps — finds the nearest
        // text block when the midline sits in a page gap. Two passes: strict (whole block inside
        // one page), then lenient (a split block still beats the no-anchor ratio fallback).
        for (const strict of [true, false]) {
          anchorEl = pickAt(anchorY, strict)
          for (const dy of [40, -40, 90, -90, 150, -150, 220, -220]) {
            if (anchorEl) break
            anchorEl = pickAt(anchorY + dy, strict)
          }
          if (anchorEl) break
        }
      }
      const keepLeft = el.scrollLeft // desktop only; the phone helper pins window.scrollX itself
      const ratio = getScrollTop() / scrollRange()
      const topBefore = anchorEl ? anchorEl.getBoundingClientRect().top : 0 // at the CURRENT size
      // LATTICE COMMIT: level = 1.08^step exactly (same 8%-per-notch feel as the old multiply, but
      // every reachable level is a shared lattice point the pagination step cache can precompute).
      const stepNext = zoomToStep(editorZoomRef.current) + net // zoomToStep clamps; re-clamped inside stepToZoom
      const next = stepToZoom(stepNext)
      if (next === editorZoomRef.current) return // pinned at a lattice bound — nothing to apply
      // Pin pagination's RO-driven painters for the whole gesture (per-frame LIVE repositioning
      // lagged the reflowing text 1–2 frames — the page-boundary up/down flicker). The step cache
      // below replaces live repositioning with instant precomputed geometry; the RO path stays
      // gated as the cache-MISS fallback. Cleared in the settle, right before zoom-settled.
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = true
      el.style.setProperty('--iw-editor-zoom', String(next)) // apply now → text reflows
      // PREDICTIVE STEP CACHE: tell the paginator which lattice step just committed, SYNCHRONOUSLY
      // and before any layout read below — a cache hit applies the precomputed page-band geometry
      // as pure style writes that batch into the SAME reflow as the font change, so the panels
      // move WITH the text instead of waiting for the settle. The surface is included so the
      // SnapshotView's zoom (its own Scroll dispatches too) can never drive the live editor's
      // panels. A miss is fine — the panels hold (the old pinning) and the settle verifies.
      window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(next), surface: el } }))
      // Hybrid at magnify ≠ 1: the reflow changed the paper's height, and the wrapper box must
      // track it SYNCHRONOUSLY (its RO fires later this frame) or the scroll-range clamp below
      // could bite against the stale height near the document end. One offsetHeight read in a
      // frame that's about to force layout anyway.
      const mag = getMagnify()
      if (mag !== 1 && magnifyBoxRef.current && paperElRef.current)
        magnifyBoxRef.current.style.height = `${paperElRef.current.offsetHeight * mag}px`
      if (anchorEl && anchorEl.isConnected) {
        const topAfter = anchorEl.getBoundingClientRect().top // forces synchronous layout at the new size
        setScrollTop(getScrollTop() + (topAfter - topBefore)) // hold the anchored text still
        if (!phone) el.scrollLeft = keepLeft
      } else {
        setScrollTop(ratio * scrollRange()) // no anchor → keep relative position
        if (!phone) el.scrollLeft = keepLeft
      }
      editorZoomRef.current = next
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => {
        ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = false // gesture idle → painters may run
        holdWavesFor(800) // …but the re-measure + re-anchor below must not sway the waves either
        setEditorZoom(editorZoomRef.current) // same var value → no visual change, just React catch-up
        try { localStorage.setItem('inkwave:editorZoom', String(editorZoomRef.current)) } catch { /* private mode */ }
        // ZOOM-SETTLE RE-MEASURE: page breaks stay pinned DURING the gesture (re-measuring live made
        // the text lurch), but the gaps + sheet panels were measured at the OLD font size and sit
        // misaligned with the reflowed text. One clean re-measure now — and we re-anchor the viewport
        // around it (same held-anchor logic) so the adjustment doesn't move the text you're reading.
        const held = anchorEl && anchorEl.isConnected ? anchorEl : null
        anchorEl = null // gesture over → next gesture picks a fresh anchor under the centre
        const topBeforeMeasure = held ? held.getBoundingClientRect().top : 0
        const onMeasured = () => {
          window.removeEventListener('inkwave:pagination-measured', onMeasured)
          requestAnimationFrame(() => { // re-anchor is a zoom correction too — inside the hold window
            if (held && held.isConnected) {
              const topAfterMeasure = held.getBoundingClientRect().top
              setScrollTop(getScrollTop() + (topAfterMeasure - topBeforeMeasure))
            }
          })
        }
        window.addEventListener('inkwave:pagination-measured', onMeasured)
        window.dispatchEvent(new Event('inkwave:zoom-settled'))
        // Non-gapped mode: no pagination plugin listening → drop the one-shot listener shortly.
        setTimeout(() => window.removeEventListener('inkwave:pagination-measured', onMeasured), 1000)
      }, 200)
    }
    // Zone latch — POSITION-based: the zone is re-tested only when the CURSOR actually moves.
    // Zooming moves the page under a stationary cursor (magnify grows/shrinks the paper across
    // it; a gap band slides away as the page rescales), so any time- or per-event re-test flips
    // a deliberate slow-notching gesture between magnify and font-reflow mid-flight (Peter hit
    // this zooming out from a page gap). The user's INTENT is where they pointed: while the
    // pointer stays put (< 8px), the zone they started in holds — however slowly they notch.
    let zoneIsWater = false
    let zoneX = Number.NaN, zoneY = Number.NaN // cursor position the current zone was tested at
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        // CONTENT-PROPORTIONAL PLAIN SCROLL (Peter: "the scroll needs to change depending on how
        // zoomed in we are"): the wrapper sizes scroll space to VISUAL dims, so a native ~100px
        // wheel notch covers 1/scale× the document distance — at 0.1 the tiny page zips past, at
        // 2× it crawls. Scale the delta by scrollScale(s) — pure proportionality down to the
        // knee (one notch = the same fraction of a page), then accelerating toward MIN_MAGNIFY
        // so deep zoom-out scrolling stays brisk (see the curve's constants above).
        // Scale 1 returns without preventDefault — the native path is untouched.
        if (!hybrid) return
        const s = getMagnify()
        if (s === 1) return
        e.preventDefault()
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1 // lines/pages → px
        const f = scrollScale(s)
        const dy = e.deltaY * unit * f
        const dx = e.deltaX * unit * f
        if (e.shiftKey && !dx) el.scrollLeft += dy // reproduce the native shift-wheel → horizontal mapping
        else { el.scrollTop += dy; el.scrollLeft += dx }
        return
      }
      e.preventDefault()
      if (e.deltaY === 0) return
      // CURSOR-ZONE DUAL ZOOM (hybrid): the PAGE zone is the PAINTED PAGE BACKGROUND (Peter,
      // 2026-07-10 — not the text margin): cursor anywhere on parchment, INCLUDING the page's
      // blank margins around the text, = font-reflow zoom; outside the painted parchment — side
      // water AND the between-page gaps — = whole-page magnify.
      // GEOMETRIC test against the parchment's VISUAL rects — not DOM containment (the
      // caret-gutter strips live inside the paper but stretch across the water; the gap widgets
      // span the page margins, which ARE parchment). Gapped mode: the painted parchment is
      // exactly the .inkwave-sheet panel bands (the same rects the step cache positions), so test
      // those; ungapped: the paper element's rect is the one continuous painted parchment.
      // gBCR is transform-aware, so this is exact at any magnify — no scaleFor conversion needed
      // for a visual point-in-rect test.
      if (!(Math.abs(e.clientX - zoneX) < 8 && Math.abs(e.clientY - zoneY) < 8)) {
        const x = e.clientX, y = e.clientY
        const inRect = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        const panels = el.querySelectorAll<HTMLElement>('.inkwave-sheets .inkwave-sheet')
        let overPage: boolean
        if (panels.length) {
          overPage = Array.from(panels).some((p) => inRect(p.getBoundingClientRect()))
        } else {
          const pr = paperElRef.current?.getBoundingClientRect()
          overPage = !!(pr && inRect(pr))
        }
        zoneIsWater = hybrid && !overPage
        zoneX = e.clientX; zoneY = e.clientY
      }
      // LATTICE QUANTIZATION: a full mouse-wheel notch (|ΔY| ≥ 100 in Chrome/Firefox) = exactly
      // ±1 step (identical to the old feel); trackpad ctrl-pinch fine-deltas (small |ΔY|)
      // contribute proportional FRACTIONS that accumulate until a whole step commits — so every
      // input lands on the shared zoomStep lattice instead of an arbitrary float in between.
      // TRACKPAD_ZOOM_SENSITIVITY scales ONLY the fine-delta fraction (Peter: raise it "quite a
      // bit") — a discrete notch stays exactly one step; retune the constant, not the formula.
      const mag = Math.abs(e.deltaY)
      const stepDelta = (e.deltaY < 0 ? 1 : -1)
        * (mag >= 100 ? 1 : Math.min(1, (mag / 100) * TRACKPAD_ZOOM_SENSITIVITY))
      if (zoneIsWater) {
        mSteps += stepDelta
      } else {
        steps += stepDelta
      }
      if (!raf) raf = requestAnimationFrame(applyFrame)
    }
    // PHONE PINCH-TO-ZOOM — the same pipeline as the wheel path (same rAF coalescing, clamps,
    // persistence and settle re-measure), driven by the two-finger distance ratio instead of wheel
    // steps. INPUT-PIPELINE COST (round-2 iPhone lag, 2026-07-10): a NON-PASSIVE touchstart /
    // touchmove on the whole surface makes iOS synchronously dispatch EVERY touch to the main
    // thread and wait before acting on it — every tap and every scroll frame inherits whatever
    // deferred task is running (the pagination measure, the SCAS tick). So: touchstart is PASSIVE
    // (its handler only records pinch state), and the non-passive touchmove is attached ONLY while
    // two fingers are actually down — single-finger scrolling never has a blocking listener at all.
    // Pinch suppression still holds three ways: the first two-finger touchmove preventDefaults
    // (the listener is attached synchronously inside the second finger's touchstart, before any
    // move can dispatch), the gesturestart/gesturechange preventDefault below, and the universal
    // phone `touch-action: pan-x pan-y` as the declarative half of the same contract.
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    let pinchMoveArmed = false
    const armPinchMove = () => {
      if (!pinchMoveArmed) { pinchMoveArmed = true; el.addEventListener('touchmove', onTouchMove, { passive: false }) }
    }
    const disarmPinchMove = () => {
      if (pinchMoveArmed) { pinchMoveArmed = false; el.removeEventListener('touchmove', onTouchMove) }
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      pinchDist = touchDist(e.touches)
      pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      anchorEl = null // fresh gesture → applyFrame picks the text block under THIS midpoint
      steps = 0
      armPinchMove()
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchDist) return
      e.preventDefault() // our zoom replaces the browser's — stop the double-zoom
      const d = touchDist(e.touches)
      if (d < 8) return // fingers (nearly) touching — the ratio is degenerate noise
      // Fractional steps on the wheel's 1.08 curve, boosted by PINCH_ZOOM_SENSITIVITY (Peter,
      // 2026-07-10: pinch felt too slow) — steps still commit whole on the shared lattice.
      steps += (Math.log(d / pinchDist) / Math.log(1.08)) * PINCH_ZOOM_SENSITIVITY
      pinchDist = d
      if (!raf) raf = requestAnimationFrame(applyFrame)
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) { pinchDist = 0; disarmPinchMove() } // settle timer already armed
    }
    // iOS Safari's non-standard gesture events drive the native pinch — suppress them over the editor.
    const onGesture = (e: Event) => e.preventDefault()
    if (phone) {
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchend', onTouchEnd)
      el.addEventListener('touchcancel', onTouchEnd)
      el.addEventListener('gesturestart', onGesture)
      el.addEventListener('gesturechange', onGesture)
    } else {
      el.addEventListener('wheel', onWheel, { passive: false })
    }
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      disarmPinchMove()
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGesture)
      el.removeEventListener('gesturechange', onGesture)
      if (raf) cancelAnimationFrame(raf)
      if (settle) clearTimeout(settle)
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = false // never leave painters pinned
    }
  }, [phone, hybrid]) // eslint-disable-line react-hooks/exhaustive-deps
  const sideMarginPx  = getSideMarginPx()
  const topMarginPx   = getTopMarginPx()
  const btmMarginPx   = getBtmMarginPx()
  const paraSpacingEm = getParaSpacingEm()
  const columns       = getColumns()
  // Waves sway horizontally as you scroll up/down (the "nice motion"), but must NOT move when you
  // ZOOM. Inside the zoom hold window (holdWavesFor above) every scroll delta — anchor
  // corrections, settle re-anchors, async clamp scrolls, whatever — is rebased into the base
  // equal-and-opposite, so base + scrollTop·WAVE_SWAY (the value written here) is CONSTANT
  // through the whole gesture. (The old approach — skip one sway frame when the zoom var changed
  // — leaked: coalesced and clamp-induced scroll events after the skipped one still swayed.)
  // The sway rides on a persistent BASE offset: where the loading coast came to rest (see the coast
  // handoff below, which rebases it against the scroll position at that moment). Starts at 0, so
  // surfaces that never drift (SnapshotView) keep the plain scrollTop·WAVE_SWAY sway.
  useEffect(() => {
    const el = surfaceRef.current
    // Phone: waves exist only DURING load (.iw-wave-anim/.iw-wave-coast in index.css) — at rest the
    // surface returns to parchment (::before display:none), so the sway var would be a style-recalc
    // per scroll frame for nothing — don't attach the listener at all (scroll-lag fix).
    if (!el || phone) return
    const target: HTMLElement | Window = el
    let raf = 0
    let lastTop = el.scrollTop
    let lastTs = performance.now()
    const apply = () => {
      raf = 0
      // NEVER write --wave-x mid-drift/coast (2026-07-09 regression fix): during the load the
      // background-position is class-pinned anyway, but the var write dirtied style on the surface
      // + its animated pseudos every restore-scroll frame — a mid-coast recalc hitch (Firefox
      // re-rasters the overdraw layers on it). The coast's finish() writes the handoff value.
      if (waveModeRef.current !== 'off') return
      const top = el.scrollTop
      const now = performance.now()
      // Zoom-driven scroll (gesture / settle / clamp): hold --wave-x exactly still by absorbing
      // the delta into the base. Rebased (not skipped), so sway resumes with no jump.
      if (performance.now() < zoomHoldUntilRef.current) {
        waveBaseRef.current -= (top - lastTop) * WAVE_SWAY
      } else if (top !== lastTop) {
        // GENUINE scroll (zoom-hold deltas excluded): the accent dashes' twinkle rate tracks the
        // water's motion — feed the scroll velocity to the twinkle driver (waveTwinkle.ts).
        reportSway(Math.abs(top - lastTop) / Math.max(8, now - lastTs) * 1000)
      }
      lastTop = top
      lastTs = now
      el.style.setProperty('--wave-x', `${(waveBaseRef.current + top * WAVE_SWAY).toFixed(1)}px`)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    apply()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [phone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Loading wave drift — CSS/compositor does ALL the moving (`.iw-wave-anim`, in the prerendered
  // HTML, so it starts at FIRST PAINT and never stutters however busy the main thread is; the reveal
  // coast is a CSS keyframe animation too — see iw-wave-coast-l/r in index.css). JS only manages the
  // phase boundaries, each a one-shot write: sync the surface to the shared animation clock at mount,
  // freeze the offset into --wave-t at reveal (the coast keyframes take it from there, continuing
  // FORWARD with a 2s cubic ease-out whose initial slope is the 72px/s drift speed), and at coast end
  // hand the final offset to the scroll sway as its persistent base — no boundary snapping, so the
  // waves can never stop or move backward.
  const startedHiddenRef = useRef(!revealed) // instances that mount revealed (SnapshotView) never drift
  const [waveMode, setWaveMode] = useState<'anim' | 'coast' | 'off'>(startedHiddenRef.current ? 'anim' : 'off')
  // Ref mirror for the scroll-sway rAF (declared above, runs later) — it must not write --wave-x
  // while the drift/coast animations own the wave position.
  const waveModeRef = useRef(waveMode)
  waveModeRef.current = waveMode
  // useLayoutEffect: the FIRST paint of a freshly-mounted surface must already sit at the shared
  // clock. As a plain effect this ran AFTER paint, so every surface remount painted one frame at
  // ramp-start (offset ~0) then jumped to the synced phase — a visible wave flash per remount.
  useLayoutEffect(() => {
    // Pick up mid-loop where the first surface's animation is: negative delay = elapsed % loop.
    const el = surfaceRef.current
    if (!el || !startedHiddenRef.current) return
    // ONE shared clock — the moment the FIRST surface's animation actually started (the prerendered
    // shell's, at first paint). performance.now() alone overestimates elapsed by the first-paint
    // latency (~50–300ms ≈ up to ~20px of drift), and re-setting the delay vars on the already-
    // running hydrated shell would phase-shift (jump) it — so the first surface just PUBLISHES its
    // animation's true start time and leaves its own vars untouched; later surfaces sync to it.
    const w = window as unknown as { __iwWaveEpoch?: number; __iwWaveEpochAnim?: Animation }
    const drifts = () => {
      try {
        return el.getAnimations({ subtree: true }) // includes ::before/::after + twinkle children
          .filter((x) => ((x as CSSAnimation).animationName ?? '').startsWith('iw-wave-drift'))
      } catch { return [] }
    }
    if (w.__iwWaveEpoch === undefined) {
      let start = performance.now() // fallback ≈ this mount (fresh mounts start their animation now)
      const a = drifts().find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
      if (typeof a?.startTime === 'number') start = a.startTime as number
      else if (typeof a?.currentTime === 'number') start = performance.now() - (a.currentTime as number)
      w.__iwWaveEpoch = start
      w.__iwWaveEpochAnim = a ?? undefined
      return // this surface's own running animation IS the clock
    }
    // EXACT clock share (2026-07-09, the ~10px reveal hiccup): wall-clock --wave-phase math left
    // later surfaces ~10px behind the first (animation origins land frames after the delay was
    // computed), and the shell's fade at reveal swapped the visible water BACKWARD by that gap.
    // Adopting the epoch animation's literal startTime makes every surface pixel-identical by
    // construction — no delay/origin arithmetic at all. Twinkle children ride the same call.
    const epochStart = (typeof w.__iwWaveEpochAnim?.startTime === 'number')
      ? w.__iwWaveEpochAnim.startTime as number
      : w.__iwWaveEpoch // fallback: the recorded number (close, not exact)
    const own = drifts()
    if (own.length) {
      for (const a of own) { try { a.startTime = epochStart } catch { /* not ready */ } }
    } else {
      // No animations yet (display gated) — fall back to the delay var; close enough as a fallback.
      const elapsed = Math.max(0, performance.now() - (w.__iwWaveEpoch ?? performance.now())) / 1000
      el.style.setProperty('--wave-phase', `-${(elapsed % 1.944).toFixed(3)}s`)
    }
  }, [])
  // Two effects, deliberately: the freeze (read the animated transform, switch class) must not share
  // an effect with the handoff — setWaveMode('coast') inside a [waveMode]-dep effect re-ran the
  // effect and its CLEANUP tore down the just-armed listeners, leaving .iw-wave-coast stuck forever
  // (frozen waves + background-position pinned at 0 → the scroll sway looked "broken").
  // useLayoutEffect: --wave-t + the coast class land in the SAME commit that drops the anim class,
  // before the browser paints — the first coast frame is already easing from the frozen offset, so
  // there is no dead frame (and no intermediate render ever lacks both classes: waveMode swaps
  // 'anim' → 'coast' atomically in one state).
  // Freeze the compositor animation's current offset into --wave-t and swap to the coast class —
  // shared by the desktop trigger (revealed, below) and the phone trigger ('inkwave:reveal-imminent').
  const freezeToCoast = () => {
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    // Freeze from the animation CLOCK, not getComputedStyle: currentTime is exact and
    // compositor-authoritative (the computed transform lags a variable 1-2+ frames — the old fixed
    // "lead compensation" guess). Drift keyframes are linear 0 → -140px over 1.944s.
    let tx = 0
    try {
      const a = el.getAnimations({ subtree: true })
        .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
      if (typeof a?.currentTime === 'number') {
        tx = -140 * (((a.currentTime as number) / 1000) % 1.944) / 1.944
      } else {
        const m = getComputedStyle(el, '::before').transform
        if (m && m !== 'none') tx = new DOMMatrixReadOnly(m).m41
      }
    } catch { /* transform unreadable → coast from 0 */ }
    el.style.setProperty('--wave-t', `${tx.toFixed(2)}px`)
    setWaveMode('coast')
  }
  useLayoutEffect(() => {
    if (!revealed || waveMode !== 'anim') return
    freezeToCoast()
    // Normally a no-op FALLBACK on both platforms: 'inkwave:reveal-imminent' (below) already
    // swapped to 'coast' before revealed flips — but if the event never fired, coast at reveal.
  }, [revealed, waveMode]) // eslint-disable-line react-hooks/exhaustive-deps
  // BOTH platforms (2026-07-09, the backward-flicker fix): TiptapEditor dispatches
  // 'inkwave:reveal-imminent' at gate-ready and the coast starts THEN, on a light frame. The old
  // desktop path froze inside the reveal commit itself — the busiest frame of the whole load: the
  // compositor kept drifting for the ~100ms that commit blocked the main thread, so the waves were
  // ~7px past the frozen --wave-t when the coast finally started → a visible backward snap. Phone
  // additionally delays the reveal by 1.5s so the page pops as the waves reach rest; desktop
  // reveals two rAFs later (imperceptible — the coast is already easing when the heavy commit
  // lands). Every drifting surface listens — the visible loading SHELL (revealed never flips
  // there; it unmounts at/after the reveal) and the editor's own surface underneath coast in
  // lockstep (same --wave-phase clock → same frozen offset), so the shell swap is seamless.
  useEffect(() => {
    if (waveMode !== 'anim') return
    const onImminent = () => freezeToCoast()
    window.addEventListener('inkwave:reveal-imminent', onImminent)
    return () => window.removeEventListener('inkwave:reveal-imminent', onImminent)
  }, [waveMode]) // eslint-disable-line react-hooks/exhaustive-deps
  // Coast END → sway handoff. The 2s ease-out itself is pure CSS (iw-wave-coast-l/r); JS wakes only
  // at animationend to hand over: the final offset (--wave-t − 72px, the keyframes' end value) is
  // written into --wave-x in the same commit the coast class drops. Because the coast geometry's
  // ±280px overdraw is exactly two 140px tiles, transform +tx ≡ background-position +tx — dropping
  // the class while setting --wave-x = txFinal paints identical pixels: no snap, no dead frame, and
  // the sway then continues from that offset (base = txFinal − scrollTop·0.06, rebased here).
  useEffect(() => {
    if (waveMode !== 'coast') return
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      // Coast distance matches the keyframes' --wave-coast-dist: 72px on desktop (3s), 48px on
      // phone (2s). On phone the waves cease to exist the moment the classes drop (parchment
      // surface, ::before display:none), so the sway base/--wave-x write is inert there — kept
      // unconditional for one code path.
      const txFinal = (parseFloat(el.style.getPropertyValue('--wave-t')) || 0) - (phone ? 48 : 72)
      waveBaseRef.current = txFinal - el.scrollTop * WAVE_SWAY
      el.style.setProperty('--wave-x', `${txFinal.toFixed(1)}px`)
      setWaveMode('off') // class drops on React's commit — --wave-x is already in place
    }
    const onEnd = (e: AnimationEvent) => { if (e.animationName === 'iw-wave-coast-l') finish() }
    el.addEventListener('animationend', onEnd)
    const cap = setTimeout(finish, 3300) // safety net if the animation never ran (e.g. reduced paint states)
    return () => { el.removeEventListener('animationend', onEnd); clearTimeout(cap) }
  }, [waveMode, phone])
  // --wave-t is inert once the coast class is gone; tidy it away after the 'off' commit (removing it
  // BEFORE the class dropped was the old backward-jump bug — the still-coasting transform fell to 0).
  useEffect(() => {
    if (waveMode === 'off') surfaceRef.current?.style.removeProperty('--wave-t')
  }, [waveMode])

  // Scrollbar idle-fade (desktop fill only): the thumb shows while scrolling or when the pointer is
  // near the right edge, and fades out (via .iw-sb-idle - CSS makes it transparent) after 1.4s of
  // inactivity, so at rest only the waves remain in the channel.
  // ARMED ONLY AFTER THE LOAD WAVES REST (waveMode 'off' — 2026-07-09 regression fix): the toggles
  // used to land during the drift (classList.add at hydration; the restore-scroll's show() +
  // its 1.4s re-add timer), and each one ran the 0.3s scrollbar-color transition — a per-frame
  // repaint of the scroll container's bar region (Firefox repaints the whole scroller) that read
  // as the "jump at ~0.7s / bigger jump at ~1.4s" in the wave drift.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !fill || phone || waveMode !== 'off') return
    let t = 0
    el.classList.add('iw-sb-idle')
    const show = () => {
      el.classList.remove('iw-sb-idle')
      clearTimeout(t)
      t = window.setTimeout(() => el.classList.add('iw-sb-idle'), 1400)
    }
    const onMove = (e: PointerEvent) => {
      if (el.getBoundingClientRect().right - e.clientX < 28) show()
    }
    el.addEventListener('scroll', show, { passive: true })
    el.addEventListener('pointermove', onMove, { passive: true })
    return () => { clearTimeout(t); el.removeEventListener('scroll', show); el.removeEventListener('pointermove', onMove) }
  }, [fill, phone, waveMode])

  // Stochastic twinkles (sparkles + accent dashes — see waveTwinkle.ts). The container div is in
  // the JSX (and the prerender) EMPTY; the random instances are populated here, CLIENT-ONLY after
  // hydration, so the server HTML and the first client render always match (no mismatch, and no
  // flash: each instance mounts only after its art decodes). Live-editor surfaces only (fill):
  // sparkles run while the load drift/coast does; the dashes decorate ALL stages on desktop
  // (drift, coast, resting sway — static between scrolls) but exist only during the load on phone
  // (no waves at rest there). useLAYOUTeffect deliberately: the mode handoffs (coast start, rest
  // transform) must land in the SAME pre-paint flush as the wave class swap — a passive effect
  // ran after paint, leaving one visible frame where the dashes stood still against moving waves.
  const twinkleRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = twinkleRef.current
    if (!host || !fill) return
    syncTwinkles(host, { sparks: waveMode !== 'off', dashes: !phone || waveMode !== 'off', mode: waveMode, phone })
  }, [fill, phone, waveMode])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}${waveMode === 'anim' ? ' iw-wave-anim' : waveMode === 'coast' ? ' iw-wave-coast' : ''}`}
      style={{
        '--iw-editor-zoom': editorZoom,
        // The shell's atomic reveal: fade the whole covering surface out over the LAST 0.5s of the
        // wave S-decay — doc, text and pills fade in together underneath, over coasting waves.
        ...(fadingOut ? { opacity: 0, transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)', pointerEvents: 'none' as const } : null),
      } as React.CSSProperties}>
      {/* Twinkle host — sparkles + accent dashes live in here as generated layers, NOT on the wave
          ::before/::after (fading/blinking those would dim the wave lines too). Rendered EMPTY
          (deterministic — identical in the prerender), populated post-hydration by the effect
          above; the layers ride the same drift/coast keyframes + --wave-phase clock as the wave
          layers, so every fleck moves in lockstep with its crest. Pure visual layer. */}
      <div ref={twinkleRef} className="iw-wave-twinkles" aria-hidden="true" />
      {/* Print-only: position:fixed repeats on every printed page (Chromium) — the bottom-centre
          logo. Hidden on screen (inline none; the @media print rule wins with !important). */}
      <img className="iw-print-logo" src="/inkwave-logo-v7.png" alt="" aria-hidden="true" style={{ display: 'none' }} />
      {/* Parchment column. Desktop: a floating page (max-width + shadow + background gap). Phone:
          fills the screen edge-to-edge, no shadow. Hybrid (desktop live editor): the paper sits in
          the .iw-magnify-box wrapper below — the wrapper carries the centring (mx-auto + explicit
          width) and is imperatively sized to the page's VISUAL dims when magnified, while the paper
          itself is transform-scaled from its top-left (see the magnify plumbing effect + index.css).
          Layout width stays the true mm width in every mode, so the canonical breaks never move. */}
      {(() => { const paperNode = (
      <div
        ref={paperElRef}
        // FIXED page width (not max-width + w-full) so the text always reflows at true A4/Letter width.
        // That keeps words-per-line — and therefore words-per-page — constant regardless of screen
        // width, so the page-break guides + gapped pages fall at the SAME content on any screen (they
        // used to move because pageH scaled with the rendered width). Narrower containers scroll
        // horizontally instead of reflowing. Phone + 'scroll' paper keep the fluid full-width layout.
        className={(() => {
          if (phone || getPaperSize() === 'scroll') return 'mx-auto w-full'
          return hybrid ? '' : 'mx-auto' // hybrid: the wrapper centres; the paper stays at its top-left
        })()}
        style={{
          width: (() => {
            if (phone) return undefined
            const ps = getPaperSize()
            if (ps === 'scroll') return undefined
            // The SAME physical mm the break model (pageModel) and the print @page size use —
            // one source of truth, so screen wrapping = print wrapping.
            return paperCssSize(ps, getOrientation()).width
          })(),
          // box-shadow (not filter: drop-shadow) so the absolutely-positioned cycle card
          // rendered inside doesn't feed its pixels into the shadow — drop-shadow re-rasterises
          // the whole parchment on every reel frame.
          borderRadius: phone ? 0 : '8px',
          boxShadow: phone || gapped ? 'none' : '0 8px 32px rgba(80,50,10,0.22), 0 2px 6px rgba(80,50,10,0.18)',
          // One-paint load: hide the entire parchment (waves only) until the editor settles, then
          // fade page + text in together. visibility (not display) keeps layout + font/pagination
          // measurement running underneath.
          // PHONE: 0.5s (Peter, 2026-07-09) — the full-screen paper fades IN over the editor's own
          // still-coasting water (the shell drops instantly at reveal there — see Edit.tsx), so
          // the waves stay fully visible, drifting and decaying, while the page materialises;
          // the fade lands at 2.0s, the moment the waves reach rest.
          visibility: revealed ? 'visible' : 'hidden',
          opacity: revealed ? 1 : 0,
          transition: 'opacity 800ms cubic-bezier(0.4, 0, 0.2, 1)', // both platforms: 0.8s atomic fade (Peter, 2026-07-10)
        }}
      >
        {/* Paper body. The side padding is the text margin: a roomy fixed margin on DESKTOP (driven
            by device type, not the viewport breakpoint, so browser zoom never collapses it); a slim
            one on phones where screen real estate is tight. */}
        <div
          ref={sheetRef}
          className="scroll-paper relative pt-8 pb-24"
          style={{
            borderRadius: phone ? 0 : '8px',
            paddingLeft:  phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingRight: phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingTop:   `${topMarginPx}px`,
            paddingBottom:`${btmMarginPx}px`,
            '--para-spacing': `${paraSpacingEm}em`,
          } as React.CSSProperties}
        >
          <PageGuides sheetRef={sheetRef} />
          <div
            className="mx-auto w-full relative"
            style={{
              zIndex: 1,
              columnCount: columns > 1 && !gapped ? columns : undefined,
              columnGap: columns > 1 && !gapped ? '2em' : undefined,
            }}
            ref={containerRef}
          >
            {children}
          </div>
        </div>
      </div>
      )
      if (!fill) return paperNode // in-flow surfaces (SnapshotView) mount client-only — no wrapper
      // The magnify wrapper: mx-auto + an explicit width centre the page; the width starts as the
      // same mm value the paper uses (layout identical to master at scale 1) and is imperatively
      // switched to pageWidth·s px while magnified (see the magnify plumbing effect). Height is
      // ONLY ever set imperatively (paperHeight·s), so React never fights the RO's writes.
      // RENDERED FOR EVERY fill SURFACE, hybrid or not (2026-07-10 iOS regression): the prerendered
      // shell is built desktop-side (hybrid), so gating this div on `hybrid` made the phone's first
      // client render STRUCTURALLY different from the server HTML — hydration failed (#418), React
      // client-re-rendered <html> from scratch and stripped .iw-water-ready + data-theme, and the
      // whole load choreography died (gradient with no waves). Structure must be a constant of
      // `fill`; hybrid only drives styling/behaviour. Non-hybrid: width comes from the cleanup
      // effect below (the adopted server attribute must be cleared imperatively).
      return (
        <div
          ref={magnifyBoxRef}
          className="iw-magnify-box mx-auto"
          style={{ width: hybrid ? paperCssSize(getPaperSize() === 'letter' ? 'letter' : 'a4', getOrientation()).width : undefined }}
        >
          {paperNode}
        </div>
      )
      })()}
    </div>
  )
}

// Page guides (ungapped mode): a faint dashed rule + page number at each page BREAK. The break
// positions come from the pagination extension's zero-size break markers (.inkwave-page-gap
// .iw-break-marker) — the SAME line-measured breaks gapped mode uses, derived from the canonical
// physical page height in pageModel — so toggling the gapped switch never moves content across
// pages, and the on-screen breaks are the print/PDF breaks. Falls back to the uniform canonical
// model (topMargin + n×textArea) where no markers exist (loading shell, SnapshotView, multi-column).
// Purely visual overlay (no content reflow).
function PageGuides({ sheetRef }: { sheetRef: RefObject<HTMLDivElement> }) {
  // Our OWN overlay div — the sheet is resolved as its parentElement, NOT via sheetRef. React
  // attaches host refs bottom-up during commit, so on a fresh mount a CHILD's useLayoutEffect runs
  // BEFORE the parent's sheetRef is attached: sheetRef.current was null here in production, the
  // effect bailed without wiring its ResizeObserver / pagination-measured listener, and the page
  // guides never rendered (the "dotted lines disappeared" regression, 2026-07-09 — introduced when
  // this went useEffect → useLayoutEffect for the paint-with-the-text reveal). Dev never showed it:
  // StrictMode's double-invoked effects re-ran after the ref attached. A component's ref to its own
  // rendered element IS guaranteed set in its own layout effects — and parentElement is structurally
  // the enclosing .scroll-paper, so this can never resolve to another surface (e.g. the loading
  // shell's), either.
  const overlayRef = useRef<HTMLDivElement>(null)
  const [breaks, setBreaks] = useState<number[]>([]) // sheet-local y of each page boundary
  // The guides depend on client-only state (paper size / gapped, both from localStorage), so the
  // prerendered shell and the client's first render disagree → hydration mismatch. Gate on a post-mount
  // flag so the FIRST client render matches the shell (nothing), then the guides fill in a tick later.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  const gapped = gappedPagesEnabled()
  const [paperSize, setPaperSizeState] = useState(getPaperSize)
  const [orientation, setOrientationState] = useState(getOrientation)

  // Re-read paper size and orientation whenever page settings change
  useEffect(() => {
    const handler = () => { setPaperSizeState(getPaperSize()); setOrientationState(getOrientation()) }
    window.addEventListener('inkwave:page-settings-changed', handler)
    return () => window.removeEventListener('inkwave:page-settings-changed', handler)
  }, [])

  // Pre-decode both logo variants once, so a new page appearing during zoom-out paints its logo in
  // the same frame instead of popping in a beat late (image decode is async even from cache).
  useEffect(() => {
    for (const src of ['/inkwave-logo-v7.png', '/inkwave-logo-night.svg']) {
      const img = new Image()
      img.src = src
      void img.decode?.().catch(() => { /* decode hint only */ })
    }
  }, [])

  const lastSigRef = useRef('')
  // useLayoutEffect (not useEffect): compute the first set of marks BEFORE the browser paints the
  // newly-mounted editor, so page guides + logos appear in the SAME frame as the text instead of
  // popping in a beat later (one visible stage of the staged-load "shakiness").
  useLayoutEffect(() => {
    if (gapped || paperSize === 'scroll') { setBreaks([]); lastSigRef.current = ''; return }
    // Own-ref parent, not sheetRef — see overlayRef above (sheetRef is not attached yet on a fresh
    // production mount; kept only as a fallback for exotic render orders).
    const el = (overlayRef.current?.parentElement as HTMLDivElement | null) ?? sheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const recompute = () => {
      const total = el.scrollHeight
      if (!total) { lastSigRef.current = ''; return setBreaks([]) }
      // Prefer the REAL break markers the pagination extension measured — same breaks as gapped
      // mode. gBCR returns VISUAL (transform-scaled) coords; the overlay lives INSIDE the scaled
      // paper, so divide by the magnify scale to get paper-local px (magnify.ts owns the scale;
      // scaleFor resolves 1 for untransformed surfaces like SnapshotView's).
      const scale = scaleFor(el)
      const markers = Array.from(el.querySelectorAll('.inkwave-page-gap')) as HTMLElement[]
      let next: number[]
      if (markers.length) {
        const sheetTop = el.getBoundingClientRect().top
        next = markers
          .map((m) => (m.getBoundingClientRect().top - sheetTop) / scale)
          .sort((a, b) => a - b)
      } else {
        // No markers yet (loading shell / SnapshotView / multi-column): uniform canonical model —
        // each page holds one text area, exactly where the measured breaks would land if every
        // page filled perfectly. Canonical on phones too: the real markers are measured in the
        // forced canonical A4/Letter context (PaginationExtension), so the fallback must agree
        // (the old phone fluid-width path predates canonical measurement).
        const { textAreaPx } = pageBoxPx({
          paperSize, orientation,
          topMarginPx: getTopMarginPx(), bottomMarginPx: MARGIN_BOTTOM,
        })
        next = []
        for (let y = getTopMarginPx() + textAreaPx; y < total - 4 && next.length < 500; y += textAreaPx) next.push(y)
      }
      // Bail before setState when nothing changed — the ResizeObserver fires on every font-zoom tick
      // and re-rendering ~2 imgs + a div per page for identical marks is pure churn on long docs.
      const sig = next.map((y) => Math.round(y)).join(',')
      if (sig === lastSigRef.current) return
      lastSigRef.current = sig
      setBreaks(next)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    // Marker positions settle/move on every pagination measure (typing is debounced 150ms there);
    // the sheet height usually changes too (RO catches it), but not always — listen directly.
    window.addEventListener('inkwave:pagination-measured', recompute)
    recompute()
    return () => { ro.disconnect(); window.removeEventListener('inkwave:pagination-measured', recompute) }
  }, [sheetRef, paperSize, orientation, gapped])

  const logoSize = gapped ? 76 : 32           // bigger mark in the discrete-sheet (gapped) view
  const pageNumSize = gapped ? '2.6rem' : '1.1rem'
  const active = hydrated && !gapped && paperSize !== 'scroll' // gapped paints its own sheets; scroll has no pages

  return (
    <div ref={overlayRef} className="iw-page-guides absolute inset-0 pointer-events-none select-none" style={{ zIndex: 0 }} aria-hidden="true">
      {/* Logo at top-right of every page (page 1: top=0, page n: top=break n−1) */}
      {active && Array.from({ length: breaks.length + 1 }, (_, i) => {
        const n = i + 1
        const pageTop = i === 0 ? 0 : breaks[i - 1]
        const logoStyle = { position: 'absolute' as const, right: 47, top: pageTop + 12, width: logoSize, height: logoSize, opacity: 0.82 }
        // Two variants toggled by CSS: the day PNG and a night SVG with a light ring (so the mark's dark
        // bottom reads on the black night surface). See index.css .iw-day-logo / .iw-night-logo.
        return (
          <span key={`logo-${n}`}>
            <img className="iw-day-logo" src="/inkwave-logo-v7.png" width={logoSize} height={logoSize} alt="" style={logoStyle} />
            <img className="iw-night-logo" src="/inkwave-logo-night.svg" width={logoSize} height={logoSize} alt="" style={logoStyle} />
          </span>
        )
      })}
      {/* Page 1 label — right of the logo, vertically aligned with it */}
      {active && (
        <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>1</div>
      )}
      {/* A dashed rule at every measured break, page n+1's number just below it */}
      {active && breaks.map((y, i) => (
        <div key={`break-${i}`} style={{ position: 'absolute', top: y, left: 0, right: 0 }}>
          <div style={{ borderTop: '1px dashed rgba(92,45,138,0.45)' }} />
          <div className="font-serif" style={{ position: 'absolute', right: 24, top: 14, fontSize: pageNumSize, fontWeight: 'bold', color: 'var(--iw-page-num, #000000)' }}>
            {i + 2}
          </div>
        </div>
      ))}
    </div>
  )
}

// A static facsimile of the EMPTY ProseMirror surface — same classes as the live editor, so it
// paints identically. Used in the prerendered shell and while the document loads; the real
// editor mounts in its place client-side with no visual jump.
export function EmptyEditorSurface() {
  return (
    <div className="tiptap-editor ProseMirror" aria-hidden="true">
      <p>
        <br />
      </p>
    </div>
  )
}
