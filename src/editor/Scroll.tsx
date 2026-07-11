import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx, paperCssSize } from './pageModel'
import { syncPrintPageStyle } from './printPageStyle'
import { getMagnify, setUserMagnify, persistMagnify, setFitContext, subscribe as subscribeMagnify, scaleFor, MIN_MAGNIFY, WATER_MARGIN_PX } from './magnify'
import { stepToZoom, zoomToStep, ZOOM_STEP_RATIO } from './zoomStep'
import { isWaterAtX, createZoomLatch } from './zoomZone'
import { syncTwinkles, reportSway, retimeCoast } from './waveTwinkle'

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
// Phone pinch: multiplier on the finger-distance-ratio → steps mapping (log(d/d₀)/log(RATIO)).
// 1 = the pinched distance ratio maps 1:1 onto the zoom ratio; higher = fewer centimetres of
// pinch per step. Steps still commit whole on the shared zoomStep lattice. Raised 1.75 → 2.5
// (Peter, 2026-07-10) now the transform preview decouples gesture feel from reflow cost.
const PINCH_ZOOM_SENSITIVITY = 2.5

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

// ─── Additive coast (v3, 2026-07-11 — the drift→coast double-snap fix) ───────────────────────
// The drift is never stopped: the coast is a SECOND animation composited with
// `animation-composition: add` (see the .iw-coast-add block in index.css). Its value starts at 0
// with zero initial velocity, so the handoff is continuous BY CONSTRUCTION whenever the commit
// lands — the freeze-clock arithmetic, the compositor-lead compensation and the late-first-frame
// refreeze (rebaseCoast) are all deleted. ONE COAST PER LOAD: the first surface to freeze creates
// the shared record; every other surface (the loading shell + the editor underneath, and any
// late-mounting duplicate — the editor double-mount dispatched reveal-imminent TWICE, each
// rewriting the shared keyframes ≈7px apart = Peter's two visible snaps) adopts the same clock
// and the same snapped distance, so all copies are pixel-identical by construction.
export const ADDITIVE_COAST =
  typeof CSS !== 'undefined' && !!CSS.supports?.('animation-composition', 'add')
const COAST_HOLD_MS = 8000 // linear hold after T: total pose static until the rest handoff lands
interface SharedCoast {
  t0: number // freeze-time guess (timeline clock) — staleness checks + the safety cap
  resolvedT0: number | null // the coast animations' actual start (first painted frame)
  d: number // coast travel; device-pixel-snapped at resolve
  end: number | null // the snapped rest offset ((drift pose at t0) − d) — the --wave-x handoff value
  phone: boolean
}
let sharedCoast: SharedCoast | null = null
if (typeof window !== 'undefined') {
  // A new open aborts any in-flight coast choreography — never adopt a stale clock.
  window.addEventListener('inkwave:open-begin', () => { sharedCoast = null })
}
const timelineNow = (): number => {
  const t = typeof document !== 'undefined' ? (document.timeline?.currentTime as number | null) : null
  return t ?? performance.now()
}
// Inject the additive coast keyframes (literal px — var()-dependent keyframes can't composite).
// add(t) = (vT−d)·(3τ²−τ³)/2 ≡ cubic-bezier(1/3, 0, 2/3, 0.5) on 0 → (vT−d), then linear +v to
// D so the hold cancels the drift exactly. Direction: coast-l opposes drift-l (positive), coast-r
// mirrored. Written once per load; the resolve step rewrites with the snapped d (≤0.5 device px
// delta, landing in the same frame as the first coast paint — invisible).
function injectAdditiveCoastFrames(phone: boolean, d: number): boolean {
  const v = 140 / 1.944 // px/s — must match the drift exactly
  const T = phone ? 2 : 2.5
  const D = T + COAST_HOLD_MS / 1000
  const p = ((T / D) * 100).toFixed(4)
  const mid = v * T - d
  const endV = v * D - d
  const kf = (s: number) =>
    `0%{transform:translate3d(0,0,0);animation-timing-function:cubic-bezier(0.33333,0,0.66667,0.5)}` +
    `${p}%{transform:translate3d(${(s * mid).toFixed(3)}px,0,0);animation-timing-function:linear}` +
    `100%{transform:translate3d(${(s * endV).toFixed(3)}px,0,0)}`
  const css = `@keyframes iw-wave-coast-l{${kf(1)}}@keyframes iw-wave-coast-r{${kf(-1)}}`
  try {
    let st = document.getElementById('iw-coast-kf') as HTMLStyleElement | null
    if (!st) { st = document.createElement('style'); st.id = 'iw-coast-kf'; document.head.appendChild(st) }
    if (st.textContent !== css) st.textContent = css
    return true
  } catch { return false }
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
  covered = false,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
  phone?: boolean // touch device: paper fills the screen, no background (see isTouchDevice())
  fill?: boolean  // the live editor: make the surface a fixed, full-region scroll container (desktop).
                  // Off for the snapshot view, where the surface must stay in-flow inside its split pane.
  revealed?: boolean
  /** The live editor while the OPAQUE loading shell still covers it: its water must not paint —
      the two wave copies are never pixel-identical mid-boot (the editor's fixed pseudos anchor to
      its still-shifting flow box), and the double-paint visibly smears/dims the lines (measured:
      line peak 223 doubled vs 242 single). visibility, NOT display: the drift/coast animations
      keep running + clocked, so the freeze/coast state machine is unaffected, and the copy
      appears exactly at the reveal handoff — geometry settled, clock-identical, seamless. */
  covered?: boolean
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
    //
    // SCROLL LOCK THROUGH THE SQUEEZE (Peter, 2026-07-10): when a width change re-binds the fit
    // cap — the PDF panel opening/closing (its --iw-pdf-room inset narrows this fixed surface over
    // a 0.18s transition), or a window resize — the effective magnify changes, the wrapper's
    // height changes with it, and the reading position would scroll away. Anchor the TOP-visible
    // text line: read its viewport top, apply the new fit (setFitContext → the subscriber's
    // apply() resizes the wrapper SYNCHRONOUSLY), read it again, and displacement-correct
    // scrollTop — per RO tick, so the transition's stream of small changes each cancels to zero
    // and the text you were reading stays put through the whole open/close relayout. Same
    // held-anchor rule (and the same block-rejection rules) as the zoom paths below.
    const pickTopAnchor = (): HTMLElement | null => {
      const vr = el.getBoundingClientRect()
      const pr = paperElRef.current?.getBoundingClientRect()
      const x = pr ? pr.left + pr.width / 2 : vr.left + vr.width / 2
      for (const dy of [40, 90, 150, 220, 300]) {
        const t = document.elementFromPoint(x, vr.top + dy) as HTMLElement | null
        if (!t || !el.contains(t)) continue
        if (t.classList.contains('ProseMirror') || t.classList.contains('scroll-paper')) continue
        if (!t.closest('.ProseMirror')) continue // sheet chrome / layer divs — their tops don't track text
        if (t.closest('.inkwave-page-gap') || t.classList.contains('inkwave-page-gap-band')) continue
        return t
      }
      return null
    }
    const computeFit = () => {
      const anchor = pickTopAnchor()
      const topBefore = anchor ? anchor.getBoundingClientRect().top : 0
      setFitContext(Math.max(60, el.clientWidth - 2 * WATER_MARGIN_PX), pageW())
      if (anchor && anchor.isConnected) {
        const topAfter = anchor.getBoundingClientRect().top // forces layout at the new wrapper size
        if (topAfter !== topBefore) el.scrollTop += topAfter - topBefore
      }
    }
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
    let anchorTop0 = 0 // the anchor's viewport top when picked — the gesture's PIN position
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
        if (anchorEl) anchorTop0 = anchorEl.getBoundingClientRect().top // the gesture's pin position
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
      // DESKTOP lazy off-screen too (Peter, 2026-07-10: "sometimes lag in the reflow zoom on
      // desktop"): the live-reflow window makes each step lay out ~one screenful. Phone enters at
      // touchstart; desktop enters on the first committed step; both exit in the settle below.
      enterZoomLive(anchorX, anchorY)
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
        // LIVE WINDOW: pin the anchor to its GESTURE-START viewport top, not last frame's — the
        // content-visibility placeholder set re-evaluates between frames (scroll corrections move
        // the viewport), and per-frame displacement correction PRESERVES that inter-frame drift
        // instead of undoing it (the pinch midpoint slid ~200px over a big gesture). While the
        // window is active the user cannot scroll (fingers down / ctrl+wheel burst), so the pin
        // is safe; outside it (CV unsupported) the classic displacement correction stands.
        setScrollTop(getScrollTop() + (topAfter - (zoomLiveEd ? anchorTop0 : topBefore)))
        if (!phone) el.scrollLeft = keepLeft
      } else {
        setScrollTop(ratio * scrollRange()) // no anchor → keep relative position
        if (!phone) el.scrollLeft = keepLeft
      }
      editorZoomRef.current = next
      if (settle) clearTimeout(settle)
      settle = setTimeout(function settleFn() {
        // Fingers still down = the gesture is NOT over (a paused pinch) — settling now would tear
        // down the live window + anchor pin mid-gesture and re-measure under held fingers. Wait.
        if (pinchDist) { settle = setTimeout(settleFn, 200); return }
        exitZoomLive() // full layout returns (anchored) BEFORE the re-measure + React catch-up
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
    // MODE LATCH + COOLDOWN (Peter, 2026-07-10): the FIRST zoom event of a gesture picks the
    // mode (water = whole-page magnify, text = font reflow) and it stays LOCKED until 0.5s
    // after the last zoom event — regardless of cursor movement. (Replaces the old 8px-cursor-
    // movement latch: zooming moves the page under a stationary cursor, and a deliberate slow
    // notching gesture must never flip modes mid-flight.) The latch also drives the zoom-cursor
    // classes on the surface (zoomZone.ts + the .iw-zooming-* rules in index.css).
    const latch = createZoomLatch(() => surfaceRef.current)
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
      // ZONE GEOMETRY v2 (Peter, 2026-07-10) — X-BASED, not point-in-panel: the text column's
      // left/right edges (the live .ProseMirror rect — custom margins respected) are two
      // imaginary vertical lines. Cursor x OUTSIDE them → WATER zoom (side water, the page's
      // own side margins, and the parts of gaps/bottom margins beyond the lines); x INSIDE
      // them → font zoom (text, bottom margins, gap regions within the column's x-range).
      // y never enters the test. Latched per gesture — see zoomZone.ts.
      const mode = latch.resolve(
        () => (hybrid && isWaterAtX(el, e.clientX) ? 'water' : 'text'),
        e.deltaY > 0,
      )
      // LATTICE QUANTIZATION: a full mouse-wheel notch (|ΔY| ≥ 100 in Chrome/Firefox) = exactly
      // ±1 step (identical to the old feel); trackpad ctrl-pinch fine-deltas (small |ΔY|)
      // contribute proportional FRACTIONS that accumulate until a whole step commits — so every
      // input lands on the shared zoomStep lattice instead of an arbitrary float in between.
      // TRACKPAD_ZOOM_SENSITIVITY scales ONLY the fine-delta fraction (Peter: raise it "quite a
      // bit") — a discrete notch stays exactly one step; retune the constant, not the formula.
      const mag = Math.abs(e.deltaY)
      const stepDelta = (e.deltaY < 0 ? 1 : -1)
        * (mag >= 100 ? 1 : Math.min(1, (mag / 100) * TRACKPAD_ZOOM_SENSITIVITY))
      if (mode === 'water') {
        mSteps += stepDelta
      } else {
        steps += stepDelta
      }
      if (!raf) raf = requestAnimationFrame(applyFrame)
    }
    // PHONE PINCH-TO-ZOOM — LIVE font reflow per lattice step, exactly like the desktop wheel
    // (Peter, 2026-07-10: "I want live reflow with better performance — do everything off the
    // screen lazily; anchor to the point between the two fingers"). The performance budget comes
    // from the LIVE-REFLOW WINDOW below: during the gesture, off-screen blocks skip layout
    // entirely (content-visibility: auto — a phone screen holds ~one screenful of text, so each
    // zoom step lays out only that in real time). ANCHOR: the pinch MIDPOINT's vertical position
    // (applyFrame's phone branch picks the text block at pinchX/pinchY and holds its displacement
    // to zero) — horizontal is inherently fixed by the full-width reflow. Feature-detected: where
    // content-visibility is unsupported (iOS < 18) the same live pipeline runs against the full
    // document (correct, just heavier).
    //
    // INPUT-PIPELINE COST (round-2 iPhone lag, 2026-07-10): a NON-PASSIVE touchstart / touchmove
    // on the whole surface makes iOS synchronously dispatch EVERY touch to the main thread and
    // wait — so touchstart stays PASSIVE (records pinch state only), and the non-passive
    // touchmove is attached ONLY while two fingers are down (armed synchronously inside the
    // second finger's touchstart, before any move can dispatch). Pinch suppression = that
    // preventDefault + the CAPTURE-phase document backstop + gesture* preventDefault
    // (entry.client.tsx) + the universal phone `touch-action: pan-x pan-y`.
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    let pinchMoveArmed = false
    let gestureStartZoom = 1 // zoom level at pinch start — detects a no-commit gesture
    const armPinchMove = () => {
      if (!pinchMoveArmed) { pinchMoveArmed = true; el.addEventListener('touchmove', onTouchMove, { passive: false }) }
    }
    const disarmPinchMove = () => {
      if (pinchMoveArmed) { pinchMoveArmed = false; el.removeEventListener('touchmove', onTouchMove) }
    }
    // ── LIVE-REFLOW WINDOW (the "lazy off-screen" strategy — phone pinch AND desktop wheel) ──
    // While a zoom gesture is active, `.iw-zoom-live` puts content-visibility:auto on the
    // editor's block children (see index.css): the browser natively SKIPS layout of off-screen
    // blocks, so a zoom step reflows ~one screenful instead of the whole document. Skipped-
    // placeholder height = the document's average REAL block height, published as ONE root-level
    // var (--iw-cis) — NEVER per-block inline styles: writing a style attribute on a ProseMirror-
    // OWNED node trips PM's DOM observer, which REBUILDS the touched blocks — that detached the
    // gesture's touch target (iOS keeps dispatching a pinch's touchmoves to the ORIGINAL node, so
    // the gesture died after the first commit) and stripped the placeholder sizes (scroll
    // collapse). The aggregate scroll geometry stays ≈ exact (n·avg ≈ total content); per-block
    // error is absorbed by the anchor PIN (anchorTop0) and trued by the exit bracket + settle.
    // Measurement stays exact: forceCanonicalContext forces --iw-cv: visible inside every
    // canonical window, and no measure runs mid-gesture anyway (__iwZoomHold + no edits, with the
    // SCAS tick / PageGuides also deferring on the hold). Scoped to the GESTURE only.
    const CV_LIVE = typeof CSS !== 'undefined' && !!CSS.supports?.('content-visibility', 'auto')
    let zoomLiveEd: HTMLElement | null = null
    const enterZoomLive = (ax: number, ay: number) => {
      if (!CV_LIVE || zoomLiveEd) return
      const ed = el.querySelector('.ProseMirror') as HTMLElement | null
      if (!ed || !ed.children.length) return
      // Mean of the blocks' REAL heights (reads only — PM-safe), not scrollHeight/n: container
      // padding / page-fill min-heights skewed that high, and oversize placeholders churned the
      // geometry on every placeholder↔real swap as the viewport moved.
      let sum = 0
      for (const c of Array.from(ed.children) as HTMLElement[]) sum += c.offsetHeight
      // ENTRY BRACKET: switching blocks above the viewport to placeholder heights SHIFTS the
      // content the user is looking at — visible as a jump the instant a gesture starts (and it
      // poisoned the anchor pin, which would hold the SHIFTED position for the whole gesture).
      // Hold the block at the gesture's anchor point still across the switch, same task.
      const ref = document.elementFromPoint(ax, ay)?.closest('.ProseMirror > *') as HTMLElement | null
      const before = ref ? ref.getBoundingClientRect().top : 0
      ed.style.setProperty('--iw-cis', `${Math.max(24, Math.round(sum / ed.children.length))}px`)
      ed.classList.add('iw-zoom-live')
      zoomLiveEd = ed
      if (ref) {
        const after = ref.getBoundingClientRect().top // forces the skipped layout now, pre-paint
        setScrollTop(getScrollTop() + (after - before))
      }
    }
    const exitZoomLive = () => {
      const ed = zoomLiveEd
      if (!ed) return
      zoomLiveEd = null
      // Re-anchoring bracket: skipped blocks held placeholder heights; un-skipping lays them out
      // at the committed zoom, displacing everything below — pin the held anchor back to its
      // gesture-start viewport top in the same task so the anchored text never jumps.
      const held = anchorEl && anchorEl.isConnected ? anchorEl : null
      ed.classList.remove('iw-zoom-live')
      ed.style.removeProperty('--iw-cis')
      if (held) {
        const after = held.getBoundingClientRect().top // forces the full relayout now, pre-paint
        setScrollTop(getScrollTop() + (after - anchorTop0))
      }
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      pinchDist = touchDist(e.touches)
      pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      anchorEl = null // fresh gesture → applyFrame anchors the text block under THIS midpoint
      steps = 0
      // Hold from the FIRST touch (not the first commit): a queued SCAS tick landing mid-pinch
      // rebuilds the touched paragraph and the gesture dies on the detached node (iOS dispatches
      // a pinch's touchmoves to the ORIGINAL target). Cleared by the settle, or at touchend on a
      // gesture that never commits.
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = true
      gestureStartZoom = editorZoomRef.current
      enterZoomLive(pinchX, pinchY)
      armPinchMove()
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchDist) return
      e.preventDefault() // our zoom replaces the browser's — stop the native pinch
      const d = touchDist(e.touches)
      if (d < 8) return // fingers (nearly) touching — the ratio is degenerate noise
      steps += (Math.log(d / pinchDist) / Math.log(ZOOM_STEP_RATIO)) * PINCH_ZOOM_SENSITIVITY
      pinchDist = d
      if (!raf) raf = requestAnimationFrame(applyFrame) // live commit — one visible-window reflow per frame
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2 || !pinchDist) return
      pinchDist = 0
      disarmPinchMove()
      // Final commit LANDS NEAREST the fingers (round the fractional remainder), then the
      // live-reflow window closes — both in this same task, one paint, anchored throughout.
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      steps = Math.round(steps)
      applyFrame()
      exitZoomLive()
      // A pinch that never committed a step arms no settle — release the deferred work now.
      if (editorZoomRef.current === gestureStartZoom)
        (window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = false
    }
    // iOS Safari's non-standard gesture events drive the native pinch — suppress them over the editor.
    const onGesture = (e: Event) => e.preventDefault()
    let cleanupWheelArming: (() => void) | undefined
    if (phone) {
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchend', onTouchEnd)
      el.addEventListener('touchcancel', onTouchEnd)
      el.addEventListener('gesturestart', onGesture)
      el.addEventListener('gesturechange', onGesture)
    } else {
      // ── SCROLL LATENCY: the non-passive wheel listener exists ONLY when it can actually
      // preventDefault (Peter, 2026-07-10: ~100ms wheel→scroll lag). A non-passive wheel listener
      // — however cheap its body — forces the compositor to WAIT for main-thread dispatch on
      // EVERY wheel event, so plain scrolling inherited whatever task was running (SCAS tick,
      // measures). The listener is now ARMED only while it could intercept: ctrl/⌘ held (zoom) or
      // magnify ≠ 1 (content-proportional scroll). At rest there is NO non-passive wheel listener
      // at all — plain scrolling is fully compositor-threaded, native latency.
      // Residual edge: entering the window with ctrl ALREADY held gives the browser the first
      // notch (page zoom) until a keydown/pointer event reveals the modifier — the passive
      // pointermove check below closes that for the mouse-first flow.
      let wheelArmed = false
      const armWheel = () => { if (!wheelArmed) { wheelArmed = true; el.addEventListener('wheel', onWheel, { passive: false }) } }
      const disarmWheel = () => { if (wheelArmed) { wheelArmed = false; el.removeEventListener('wheel', onWheel) } }
      let ctrlHeld = false
      const syncWheelArming = () => { if (ctrlHeld || getMagnify() !== 1) armWheel(); else disarmWheel() }
      const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld = true; syncWheelArming() } }
      const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld = false; syncWheelArming() } }
      const onBlurWin = () => { ctrlHeld = false; syncWheelArming() }
      const onPointerCheck = (e: PointerEvent) => { // came-in-held: reveal the modifier before the first wheel
        const held = e.ctrlKey || e.metaKey
        if (held !== ctrlHeld) { ctrlHeld = held; syncWheelArming() }
      }
      window.addEventListener('keydown', onKeyDown, { capture: true })
      window.addEventListener('keyup', onKeyUp, { capture: true })
      window.addEventListener('blur', onBlurWin)
      el.addEventListener('pointermove', onPointerCheck, { passive: true })
      const unsubArm = subscribeMagnify(syncWheelArming)
      syncWheelArming()
      cleanupWheelArming = () => {
        window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
        window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions)
        window.removeEventListener('blur', onBlurWin)
        el.removeEventListener('pointermove', onPointerCheck)
        unsubArm()
        disarmWheel()
      }
    }
    return () => {
      cleanupWheelArming?.()
      el.removeEventListener('touchstart', onTouchStart)
      disarmPinchMove()
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGesture)
      el.removeEventListener('gesturechange', onGesture)
      if (raf) cancelAnimationFrame(raf)
      if (settle) clearTimeout(settle)
      exitZoomLive() // never leave the live-reflow window (content-visibility) on the editor
      latch.dispose() // drop the mode latch + zoom-cursor classes with the listeners
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
    // FULLSCREEN PDF SWAY (Peter, 2026-07-10): while the PDF viewer floats over the water it
    // dispatches its absolute scrollTop ('inkwave:pdf-sway'); folded into the SAME base+top
    // formula as a second scroll source, so the waves at the pane's sides sway with PDF scrolling
    // exactly like editor scrolling — one write path, and the zoom-hold/coast rules stay intact.
    let pdfTop = 0
    const writeWave = () =>
      el.style.setProperty('--wave-x', `${(waveBaseRef.current + (el.scrollTop + pdfTop) * WAVE_SWAY).toFixed(1)}px`)
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
      writeWave()
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    const onPdfSway = (e: Event) => {
      const top = (e as CustomEvent<{ top: number }>).detail?.top ?? 0
      const prev = pdfTop
      pdfTop = top
      if (waveModeRef.current !== 'off') return // drift/coast own the wave position
      const now = performance.now()
      if (top !== prev) reportSway(Math.abs(top - prev) / Math.max(8, now - lastTs) * 1000) // dashes twinkle too
      lastTs = now
      writeWave()
    }
    apply()
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('inkwave:pdf-sway', onPdfSway)
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('inkwave:pdf-sway', onPdfSway)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [phone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Loading wave drift — CSS/compositor does ALL the moving (`.iw-wave-anim`, in the prerendered
  // HTML, so it starts at FIRST PAINT and never stutters however busy the main thread is; the reveal
  // coast is a CSS keyframe animation too). JS only manages the phase boundaries, each a one-shot
  // write: sync the surface to the shared animation clock at mount; at reveal-imminent ADD the
  // additive coast on top of the still-running drift (v3 — see the module header; classic engines
  // freeze the offset into --wave-t and swap to replace-keyframes instead); and at coast end hand
  // the final offset to the scroll sway as its persistent base — no boundary snapping, so the
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
  // Start (additive path: adopt/create the load's SHARED coast — the drift keeps running) or
  // freeze (classic path: sample the drift into --wave-t) — shared by the desktop trigger
  // (revealed, below) and the phone trigger ('inkwave:reveal-imminent'). coastT0 = the load's one
  // coast clock (additive: the resolved first-paint start; classic: the freeze moment). The
  // twinkle fields coast from the same number, so tiles + twinkles share one start by construction.
  const coastT0Ref = useRef(0)
  const coastEndRef = useRef<number | null>(null) // device-pixel-snapped coast end offset (see below)
  const coastDistRef = useRef<number | null>(null) // the snapped coast travel (tx − end)
  const freezeToCoast = () => {
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    // PHONE + covered (2026-07-10): this surface renders NO wave classes (see the className) —
    // the SHELL owns the only water. WebKit proved hidden-pseudo animations unreliable (its
    // covered coast never fired animationend → wave classes lingered as a parchment "freeze
    // frame"), and a class-less surface has no drift to freeze — running the maths here would
    // clobber the shell's injected keyframes with tx=0. Drop straight to rest.
    if (phone && covered) { setWaveMode('off'); return }
    if (ADDITIVE_COAST) {
      // ADDITIVE PATH (v3): no freeze at all — the drift keeps running and the additive coast
      // starts from zero. ONE coast per load: adopt the shared record when a coast is already
      // in flight (< T old — a stale record is an abandoned choreography, e.g. a veil unmounted
      // mid-coast), otherwise create it. All surfaces therefore share d + the resolved clock.
      const now = timelineNow()
      const T = phone ? 2000 : 2500
      let sc = sharedCoast
      if (!sc || now - sc.t0 > T) {
        const d0 = phone ? 48 : 60 // v·T/3 — snapped to a device pixel at resolve
        if (!injectAdditiveCoastFrames(phone, d0)) {
          // Injection failed → the stylesheet's var-based replace keyframes would ADD garbage.
          // Fall back to the classic replace path for this load.
          freezeToCoastClassic(el)
          return
        }
        sc = sharedCoast = { t0: now, resolvedT0: null, d: d0, end: null, phone }
      }
      coastT0Ref.current = sc.resolvedT0 ?? sc.t0
      coastDistRef.current = sc.d
      coastEndRef.current = sc.end
      setWaveMode('coast')
      return
    }
    freezeToCoastClassic(el)
  }
  // CLASSIC (replace) coast — only for engines without animation-composition. Freeze the drift
  // offset from the animation clock and swap to keyframes that continue it.
  const freezeToCoastClassic = (el: HTMLElement) => {
    let tx = 0
    let t0 = (document.timeline?.currentTime as number | null) ?? performance.now()
    try {
      const a = el.getAnimations({ subtree: true })
        .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
      if (typeof a?.currentTime === 'number') {
        tx = -140 * (((a.currentTime as number) / 1000) % 1.944) / 1.944
        // The exact timeline moment tx corresponds to — NOT performance.now(), which runs ahead
        // of the frozen frame clock by however long this task has been running.
        if (typeof a.startTime === 'number') t0 = (a.startTime as number) + (a.currentTime as number)
      } else {
        const m = getComputedStyle(el, '::before').transform
        if (m && m !== 'none') tx = new DOMMatrixReadOnly(m).m41
      }
    } catch { /* transform unreadable → coast from 0 */ }
    coastT0Ref.current = t0
    // LITERAL coast keyframes (2026-07-10, Peter's phone "style change at the slowdown"): the
    // stylesheet's iw-wave-coast-l/r keyframes read var(--wave-t)/var(--wave-coast-dist), and
    // var()-dependent keyframes CANNOT run on the compositor — the coast ran as a MAIN-THREAD
    // animation whose fractional transform is re-rastered CRISP each frame, while the drift
    // (literal keyframes, composited) is GPU-sampled at fractional texel offsets = slightly
    // SOFTENED lines. The swap therefore visibly sharpened/brightened every wave line in one
    // frame (measured: line peak RGB ~[177,225,228] drifting → ~[227,238,234] coasting). Fix:
    // inject the SAME keyframe names with literal px values into a late <style> (last definition
    // wins) so the coast composites exactly like the drift — identical rendering, only motion
    // differs. The END offset is snapped to an integer DEVICE pixel: at rest the composited
    // texture then sits texel-exact (bilinear ≡ nearest), so dropping to background-position at
    // the coast→off handoff paints identical pixels too — no sharpen-pop at either boundary.
    // The var-based CSS keyframes remain as the no-JS fallback (today's behaviour).
    writeCoastFrames(el, tx)
    setWaveMode('coast')
  }
  // CLASSIC PATH ONLY — freeze offset → literal replace-coast keyframes + refs + --wave-t.
  const writeCoastFrames = (el: HTMLElement, tx: number) => {
    const dist = phone ? 48 : 60
    const dpr = window.devicePixelRatio || 1
    const end = Math.round((tx - dist) * dpr) / dpr
    coastEndRef.current = end
    coastDistRef.current = tx - end // the snapped travel — the twinkle fields must coast EXACTLY this
    try {
      const css =
        `@keyframes iw-wave-coast-l{from{transform:translate3d(${tx.toFixed(3)}px,0,0)}to{transform:translate3d(${end.toFixed(3)}px,0,0)}}` +
        `@keyframes iw-wave-coast-r{from{transform:translate3d(${(-tx).toFixed(3)}px,0,0)}to{transform:translate3d(${(-end).toFixed(3)}px,0,0)}}`
      let st = document.getElementById('iw-coast-kf') as HTMLStyleElement | null
      if (!st) { st = document.createElement('style'); st.id = 'iw-coast-kf'; document.head.appendChild(st) }
      if (st.textContent !== css) st.textContent = css // both surfaces freeze the same clock — one write
    } catch { /* injection failed → var-based keyframes still coast (pre-fix rendering) */ }
    el.style.setProperty('--wave-t', `${tx.toFixed(2)}px`)
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
  useLayoutEffect(() => {
    if (waveMode !== 'coast') return
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    let cancelled = false
    let done = false
    const finish = () => {
      if (done) return
      done = true
      // On phone the waves cease to exist the moment the classes drop (parchment surface,
      // ::before display:none), so the sway base/--wave-x write is inert there — kept
      // unconditional for one code path.
      // The coast ends on a device-pixel-SNAPPED offset (coastEndRef) — the --wave-x handoff
      // must write that same number or the bg-position repaint shifts sub-pixel.
      const txFinal = coastEndRef.current
        ?? (ADDITIVE_COAST && sharedCoast ? sharedCoast.end : null)
        ?? (parseFloat(el.style.getPropertyValue('--wave-t')) || 0) - (phone ? 48 : 60) // v·T/3: 2s/48 phone, 2.5s/60 desktop
      waveBaseRef.current = txFinal - el.scrollTop * WAVE_SWAY
      el.style.setProperty('--wave-x', `${txFinal.toFixed(3)}px`) // 3 decimals — must carry the device-px snap exactly
      setWaveMode('off') // class drops on React's commit — --wave-x is already in place
      // This load's coast is over — the next load must never adopt its clock. (Sibling surfaces
      // finishing moments later already carry the resolved values in their own refs.)
      if (sharedCoast && timelineNow() - sharedCoast.t0 > (phone ? 1900 : 2400)) sharedCoast = null
      // The waves are at REST — the phone load choreography keys on this (Edit.tsx drops the
      // shell + TiptapEditor uncovers the editor's water in listeners of this same dispatch, so
      // React batches all three into ONE commit: no frame ever shows a mid-motion swap).
      window.dispatchEvent(new Event('inkwave:wave-rest'))
    }
    // animationend fires at T on the classic path only (the additive coast's duration is T + the
    // hold); the additive path finishes on the resolved-clock timer below. Harmless on both.
    const onEnd = (e: AnimationEvent) => { if (e.animationName === 'iw-wave-coast-l') finish() }
    el.addEventListener('animationend', onEnd)
    let cap = setTimeout(finish, 3300) // safety net if the animation never ran (e.g. reduced paint states)

    if (ADDITIVE_COAST && sharedCoast) {
      // ADDITIVE PATH: nothing to backdate — the coast animations start naturally at their first
      // painted frame (continuous by construction; the drift never stopped). This effect's job is
      // the ONE-SHOT CLOCK RESOLVE: the first surface whose coast `ready` resolves stamps the
      // load's effective start (t0), snaps the coast distance so the REST pose lands on an
      // integer device pixel (rewriting the shared keyframes by ≤0.5 device px INSIDE the frame
      // that first paints the coast — invisible), and retimes the twinkle fields to the same
      // clock. Every other surface — including a late-mounting duplicate editor (the double-mount
      // dispatched reveal-imminent TWICE; each old-path freeze rewrote the shared keyframes ≈7px
      // apart = Peter's two visible snaps) — aligns its own coast animations to the stamped t0,
      // so all copies are pixel-identical.
      const coastAnims = () => {
        try {
          return el.getAnimations({ subtree: true }).filter((a) => {
            const n = (a as CSSAnimation).animationName ?? ''
            return n === 'iw-wave-coast-l' || n === 'iw-wave-coast-r' || n === 'iw-spark-fade'
          })
        } catch { return [] }
      }
      const align = (t0: number) => {
        for (const a of coastAnims()) { try { a.startTime = t0 } catch { /* pending — resolves to ~t0 anyway */ } }
      }
      const schedule = (t0: number) => {
        // The rest handoff: T after the resolved start (+ a small margin). The linear hold keeps
        // the total pose STATIC after T, so timer slop — even a starved commit — is invisible.
        const T = phone ? 2000 : 2500
        clearTimeout(cap)
        cap = setTimeout(finish, Math.max(0, t0 + T + 80 - timelineNow()))
      }
      const resolve = () => {
        if (cancelled || waveModeRef.current !== 'coast') return
        const sc = sharedCoast
        if (!sc) return
        let t0 = sc.resolvedT0
        if (t0 == null) {
          const a0 = coastAnims().find((a) => (a as CSSAnimation).animationName === 'iw-wave-coast-l')
          t0 = (typeof a0?.startTime === 'number') ? a0.startTime as number : timelineNow()
          const w = window as unknown as { __iwWaveEpoch?: number; __iwWaveEpochAnim?: Animation }
          const epoch = (typeof w.__iwWaveEpochAnim?.startTime === 'number')
            ? w.__iwWaveEpochAnim.startTime as number
            : w.__iwWaveEpoch ?? t0
          const tx0 = -140 * (((t0 - epoch) / 1000) % 1.944) / 1.944 // drift pose at the coast start
          const dpr = window.devicePixelRatio || 1
          const end = Math.round((tx0 - sc.d) * dpr) / dpr // rest pose on an integer device pixel
          sc.resolvedT0 = t0
          sc.d = tx0 - end
          sc.end = end
          injectAdditiveCoastFrames(phone, sc.d) // ≤0.5 device px rewrite, same frame as first paint
          retimeCoast(t0, sc.d) // twinkle fields ride the same resolved clock + snapped travel
        }
        coastT0Ref.current = t0
        coastDistRef.current = sc.d
        coastEndRef.current = sc.end
        align(t0)
        schedule(t0)
      }
      if (sharedCoast.resolvedT0 != null) {
        // A surface joining an in-flight coast (the duplicate-mount case): adopt, don't re-stamp.
        resolve()
      } else {
        const a0 = coastAnims().find((a) => (a as CSSAnimation).animationName === 'iw-wave-coast-l')
        if (a0) void a0.ready.then(resolve).catch(() => { /* cancelled — a mode change owns it */ })
        else requestAnimationFrame(() => resolve()) // display-gated pseudos: best-effort clock
      }
    } else {
      // CLASSIC PATH (no animation-composition): BACKDATE the coast animations to the freeze
      // clock. A CSS animation created by the class swap is PLAY-PENDING until the compositor
      // acks a commit — through that window the compositor keeps running the LAST committed
      // state (the infinite drift), so an un-backdated coast snapped every wave line BACKWARD
      // to --wave-t when it finally activated. Setting startTime = coastT0 resolves the pending
      // start NOW (residual = the deceleration over the starved window — sub-pixel in the
      // normal ~1-frame case). The spark S-fade rides the same clock.
      try {
        for (const a of el.getAnimations({ subtree: true })) {
          const n = (a as CSSAnimation).animationName ?? ''
          if (n === 'iw-wave-coast-l' || n === 'iw-wave-coast-r' || n === 'iw-spark-fade') {
            try { a.startTime = coastT0Ref.current } catch { /* not ready — pending start is the fallback */ }
          }
        }
      } catch { /* getAnimations unavailable → original pending-start behaviour */ }
    }
    return () => { cancelled = true; el.removeEventListener('animationend', onEnd); clearTimeout(cap) }
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
    // PHONE + covered: no twinkles on this host, and — critically — do NOT call syncTwinkles at
    // all: waterMode is GLOBAL, and this surface's early drop to 'off' (freezeToCoast) would
    // clobber the shell's live coast for every host. The shell owns the water until wave-rest.
    if (phone && covered) return
    syncTwinkles(host, {
      sparks: waveMode !== 'off',
      dashes: !phone || waveMode !== 'off',
      mode: waveMode,
      phone,
      // The tiles' exact coast clock (see freezeToCoast) — fields must coast from the SAME number
      // or they shear off the crests by the task-time skew between the freeze and this effect.
      coastStart: waveMode === 'coast' ? coastT0Ref.current : undefined,
      // …and the same SNAPPED travel (the tiles' end offset is rounded to a device pixel), or the
      // dashes end ≤1 device px off their crests at rest.
      coastDist: waveMode === 'coast' ? coastDistRef.current ?? undefined : undefined,
    })
    // covered IS a dep: the phone editor skips sync while covered (above), so the uncover at
    // wave-rest must run one sync — it carries the global twinkle mode to 'off' (the shell
    // unmounts in the same commit, so its own 'off' sync never runs) and parks the driver.
  }, [fill, phone, waveMode, covered])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}${phone && covered ? '' : waveMode === 'anim' ? ' iw-wave-anim' : waveMode === 'coast' ? ` iw-wave-coast${ADDITIVE_COAST && sharedCoast ? ' iw-coast-add' : ''}` : ''}${covered ? ' iw-wave-covered' : ''}`}
      style={{
        '--iw-editor-zoom': editorZoom,
        // The shell's atomic reveal: fade the whole covering surface out over the LAST 0.5s of the
        // wave S-decay — doc, text and pills fade in together underneath, over coasting waves.
        ...(fadingOut ? { opacity: 0, transition: `opacity ${phone ? 0.8 : 1}s cubic-bezier(0.4, 0, 0.2, 1)`, pointerEvents: 'none' as const } : null),
      } as React.CSSProperties}>
      {/* Twinkle host — sparkles + accent dashes live in here as generated layers, NOT on the wave
          ::before/::after (fading/blinking those would dim the wave lines too). Rendered EMPTY
          (deterministic — identical in the prerender), populated post-hydration by the effect
          above; the layers ride the same drift/coast keyframes + --wave-phase clock as the wave
          layers, so every fleck moves in lockstep with its crest. Pure visual layer. */}
      <div ref={twinkleRef} className="iw-wave-twinkles" aria-hidden="true" />
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
          transition: `opacity ${phone ? 800 : 1000}ms cubic-bezier(0.4, 0, 0.2, 1)`, // 0.8s phone / 1s desktop atomic fade
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
      // ZOOM-GESTURE DEFERRAL: the sheet resizes on every zoom step, so the RO fired this on
      // every gesture frame — marker rect reads + a possible React re-render, on the reflow's
      // critical path. While a gesture holds the painters, skip; the settle's zoom-settled
      // re-measure fires 'inkwave:pagination-measured' (listened below), which recomputes once.
      if ((window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold) return
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

  const phoneG = isTouchDevice()
  const logoSize = (gapped ? 76 : 32) * (phoneG ? 1.2 : 1) // bigger mark on phone (Peter, 2026-07-10)
  const pageNumSize = phoneG ? (gapped ? '3rem' : '1.35rem') : (gapped ? '2.6rem' : '1.1rem') // phone: a few pt bigger, solid black
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
