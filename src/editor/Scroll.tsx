import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx, paperCssSize } from './pageModel'
import { syncPrintPageStyle } from './printPageStyle'
import { getMagnify, setUserMagnify, persistMagnify, setFitContext, subscribe as subscribeMagnify, scaleFor, MIN_MAGNIFY, WATER_MARGIN_PX } from './magnify'
import { presentedPaperWidth, usesTransformMagnify, type SurfacePresentation } from './surfacePresentation'
import { stepToZoom, zoomToStep, ZOOM_STEP_RATIO } from './zoomStep'
import { createZoomLatch, projectedZoomDelta, zoomModeForWheel } from './zoomZone'
import { probePerf, notePerf } from './perflog'
import { syncTwinkles, setScrollScene, swayFields } from './waveTwinkle'

// Re-exported so the callers that want BOTH this and <Scroll> are unchanged. It lives in its own
// leaf module because fourteen of its seventeen importers want nothing else from this file — see
// `isTouchDevice.ts`.
import { isTouchDevice } from './isTouchDevice'
export { isTouchDevice }

// ── Zoom input sensitivity — RETUNE THESE FOUR, never the formulas they feed ──────────────────
// Each was measured against a real gesture on Peter's own hardware; the reasoning and the numbers
// they replaced are in → docs/archive/editor-surface.md#scroll-zoom-tuning
const TRACKPAD_ZOOM_SENSITIVITY = 4 // fine-delta fraction per 100px of deltaY; a full notch is always 1 step
const FIRST_STEP_BONUS = 0.92 // one-time head start on a gesture's first event, so it needs no warm-up
// ⚠ The SETTLE is the heavy half of zooming (exit the live window, re-measure canonically,
// re-anchor), so this must sit PAST a deliberate notch cadence (~400ms) or every notch outruns the
// debounce and pays its own re-measure — the felt "three zooms then stops".
const ZOOM_SETTLE_MS = 450
const PINCH_ZOOM_SENSITIVITY = 2.5 // finger-distance ratio → steps; higher = fewer cm of pinch per step

// ── Deep-zoom-out scroll acceleration ─────────────────────────────────────────────────────────
// A content-proportional notch (delta × scale) goes GLACIAL at tiny scales, so below the knee the
// multiplier ramps above proportionality: f(s) = s^(1 − a·t), t = (KNEE − s)/(KNEE − MIN) ∈ [0,1].
// At the knee f(s) = s exactly, so the s ≥ KNEE regime is byte-identical. Retune the KNEE and the
// STRENGTH, not the formula. → docs/archive/editor-surface.md#scroll-accel
const SCROLL_ACCEL_KNEE = 1 / 3
const SCROLL_ACCEL_STRENGTH = 0.5
function scrollScale(s: number): number {
  if (s >= SCROLL_ACCEL_KNEE) return s
  const t = (SCROLL_ACCEL_KNEE - s) / (SCROLL_ACCEL_KNEE - MIN_MAGNIFY)
  return Math.pow(s, 1 - SCROLL_ACCEL_STRENGTH * Math.min(1, t))
}

// ─── The S-curve slow down — an ADDITIVE BRAKE over the never-stopped drift ──────────────────
// ⚠ THE DRIFT IS NEVER STOPPED. SETTLE composites a second animation over it (`animation-
// composition: add`) starting at zero value AND zero velocity, so the hand-off is continuous BY
// CONSTRUCTION however starved the main thread is; after the coast time T a linear hold cancels
// the drift exactly. ONE COAST PER LOAD: every surface swaps class in the same dispatch and shares
// the injected keyframes + the resolved clock, and the twinkle fields ride those same keyframes.
// → docs/archive/editor-surface.md#scroll-coast
export const ADDITIVE_COAST =
  typeof CSS !== 'undefined' && !!CSS.supports?.('animation-composition', 'add')
const COAST_HOLD_MS = 8000 // linear hold after T: total pose static until the rest handoff lands
const ANCHOR_SLACK_MS = 150 // brake anchor headroom: the startTime write must reach the compositor first
interface LoadCoast {
  t0: number // settle-time guess (timeline clock) — staleness check only
  resolvedT0: number | null // the coast animations' actual start (first painted frame)
  d: number // coast travel; device-pixel-snapped at resolve
  end: number | null // the snapped rest offset ((drift pose at t0) − d) — the --wave-x handoff value
  phone: boolean
}
let loadCoast: LoadCoast | null = null
const driftSurfaces = new Set<HTMLElement>() // mounted drifting surfaces — the sibling-clock registry
if (typeof window !== 'undefined') {
  // PER-LOAD LIFECYCLE RESET: a new open aborts any in-flight coast — never adopt a stale clock.
  window.addEventListener('inkwave:open-begin', () => { loadCoast = null })
  // Once the document is ready, a pause belongs to the user-facing Continue gate rather than a
  // failed load. The coast has its own resolved-clock caps after Continue, so this pre-reveal
  // watchdog has completed its job and must not force the page through the user's pause.
  window.addEventListener('inkwave:load-awaiting-continue', disarmLoadWatchdog)
}
const timelineNow = (): number => {
  const t = typeof document !== 'undefined' ? (document.timeline?.currentTime as number | null) : null
  return t ?? performance.now()
}

// ─── Load watchdog — the ONE backstop, and it MUST NEVER FIRE ON A HEALTHY LOAD ──────────────
// Playback is compositor-only, so the only way the chain does not complete is SETTLE never arriving
// or the page's timers being dead. 30s ≫ any healthy load (worst measured cold 20MB open ≈ 12s).
// → docs/archive/editor-surface.md#scroll-coast
const WATCHDOG_MS = 30000
let watchdogT: ReturnType<typeof setTimeout> | undefined
function armLoadWatchdog(): void {
  if (watchdogT !== undefined) return
  watchdogT = setTimeout(() => {
    watchdogT = undefined
    console.error(`[inkwave] load watchdog: no SETTLE after ${WATCHDOG_MS / 1000}s — forcing the reveal chain`)
    window.dispatchEvent(new Event('inkwave:reveal-imminent')) // drifting surfaces coast → rest
    window.dispatchEvent(new Event('inkwave:load-watchdog'))
  }, WATCHDOG_MS)
}
function disarmLoadWatchdog(): void {
  if (watchdogT === undefined) return
  clearTimeout(watchdogT)
  watchdogT = undefined
}

// Inject the brake keyframes in LITERAL px — `var()`-dependent keyframes cannot composite. The
// curve is zero-jerk: add(τ) = vT(τ³ − τ⁴/2), d = vT/2, so a residual anchor lag ε costs ∝ ε³
// rather than ∝ ε². ONE injection drives every layer — the twinkle fields' CSS brake names these
// same keyframes. → docs/archive/editor-surface.md#scroll-coast
function injectAdditiveCoastFrames(phone: boolean, d: number): boolean {
  const v = 140 / 1.944 // px/s — must match the drift exactly
  const T = phone ? 2 : 2.5
  const D = T + COAST_HOLD_MS / 1000
  const endV = v * D - d
  const N = 24
  const seg = (s: number) => {
    let out = ''
    for (let k = 0; k <= N; k++) {
      const tau = k / N
      const add = v * T * (tau * tau * tau - (tau * tau * tau * tau) / 2) + (v * T * 0.5 - d) * tau // exact at ends for any snapped d
      out += `${((tau * T / D) * 100).toFixed(4)}%{transform:translate3d(${(s * add).toFixed(3)}px,0,0)}`
    }
    out += `100%{transform:translate3d(${(s * endV).toFixed(3)}px,0,0)}`
    return out
  }
  const css = `@keyframes iw-wave-coast-l{${seg(1)}}@keyframes iw-wave-coast-r{${seg(-1)}}`
  try {
    let st = document.getElementById('iw-coast-kf') as HTMLStyleElement | null
    if (!st) { st = document.createElement('style'); st.id = 'iw-coast-kf'; document.head.appendChild(st) }
    if (st.textContent !== css) st.textContent = css
    return true
  } catch { return false }
}

// The scroll "paper" chrome — the white page surface and the parchment column with its drop shadow,
// shared by BOTH the live editor and the prerendered/loading shell, so the static landing page is a
// direct visual function of the same components + CSS. Style changes here flow to both.
// → docs/archive/editor-surface.md#scroll-chrome
/** ⚠ WHEN THE NON-PASSIVE WHEEL LISTENER MUST EXIST — pure, so it can be asserted without a browser.
 *  The `pointerOver` term is load-bearing and easy to lose: a TRACKPAD PINCH arrives as
 *  wheel{ctrlKey:true} with NO keydown, so a listener not ALREADY attached hears about it only
 *  after the browser has zoomed — and a browser zoom level a page cannot undo.
 *  → docs/archive/editor-surface.md#scroll-zone */
/** ⚠ The zoom's no-anchor fallback position, as a fraction of the scroll range — pure, so the clamp
 *  can be asserted without a browser. R1: `scrollRange()` FLOORS AT 1 so it can be divided by, and
 *  on a document that FITS its viewport that floor is a fiction — every scrollTop then reads as
 *  "you are at the bottom" and the next frame leaps the document to its end.
 *  → docs/archive/editor-surface.md#scroll-anchor */
export function scrollRatioOf(top: number, range: number): number {
  if (!Number.isFinite(top) || !Number.isFinite(range) || range <= 1) return 0
  return Math.min(1, Math.max(0, top / range))
}

export function shouldArmWheel(s: { ctrlHeld: boolean; pointerOver: boolean; magnify: number }): boolean {
  return s.ctrlHeld || s.pointerOver || s.magnify !== 1
}

export function Scroll({
  children,
  paperRef,
  containerRef,
  phone = false,
  fill = false,
  presentation = 'document',
  revealed = true,
  fadingOut = false,
  covered = false,
  loadingTwinkles = false,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
  phone?: boolean // touch device: paper fills the screen, no background (see isTouchDevice())
  fill?: boolean  // the live editor: make the surface a fixed, full-region scroll container (desktop).
                  // Off for the snapshot view, where the surface must stay in-flow inside its split pane.
  /** `application` keeps the shared Scroll/loading/explicit editor-zoom machinery, but replaces
      fixed transform-scaled paper with a responsive tool surface. Email is the first consumer. */
  presentation?: SurfacePresentation
  revealed?: boolean
  /** The live editor while the OPAQUE loading shell still covers it: its water must not paint —
      the two wave copies are never pixel-identical mid-boot (the editor's fixed pseudos anchor to
      its still-shifting flow box), and the double-paint visibly smears/dims the lines (measured:
      line peak 223 doubled vs 242 single). visibility, NOT display: the drift/coast animations
      keep running + clocked, so the freeze/coast state machine is unaffected, and the copy
      appears exactly at the reveal handoff — geometry settled, clock-identical, seamless. */
  covered?: boolean
  /** Keep only the sparkle population looping over the stationary loading water. The loading
      owner drops this at the exact frame the page starts revealing. */
  loadingTwinkles?: boolean
  /** 0.5s opacity fade-out of the WHOLE surface (the loading shell's atomic cross-fade reveal). */
  fadingOut?: boolean // one-paint load: false hides the whole PARCHMENT (waves only) while fonts/
                     // pagination settle — visibility, not display, so layout + measurement still run.
                     // The editor flips it once; the loading shell passes false so page + text appear
                     // together, atomically, instead of paper-then-text.
}) {
  const application = presentation === 'application'
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
  // ⚠ ZOOM MUST NOT MOVE THE WAVES, and no synchronous bracket can catch every scroll it causes
  // (the browser's own clamps land at a later layout flush). So zoom opens a HOLD WINDOW and the
  // sway handler rebases its base EQUAL-AND-OPPOSITE for every delta inside it, holding --wave-x
  // exactly constant through gesture, settle, re-measure and clamp.
  // → docs/archive/editor-surface.md#scroll-wave-hold
  const WAVE_SWAY = 0.06 // 2/3 of the old 0.09 sway speed — shared by the sway + the rebases
  const waveBaseRef = useRef(0)
  const zoomHoldUntilRef = useRef(0)
  const holdWavesFor = (ms: number) => {
    zoomHoldUntilRef.current = Math.max(zoomHoldUntilRef.current, performance.now() + ms)
  }
  // Gapped mode draws a per-break drop shadow (PaginationExtension's rounded caps), so the single
  // tall outer shadow is dropped here — it would bleed down the edges and through the gaps.
  const gapped = gappedPagesEnabled()
  const [, rerender] = useState(0)
  useEffect(() => {
    const onChanged = () => { syncPrintPageStyle(); rerender(n => n + 1) }
    syncPrintPageStyle() // keep the print @page size in sync with the paper settings (see printPageStyle)
    window.addEventListener('inkwave:page-settings-changed', onChanged)
    return () => window.removeEventListener('inkwave:page-settings-changed', onChanged)
  }, [])

  // HYBRID ZOOM scope: only the desktop LIVE editor (fill) with a fixed-size paper gets the
  // transform-magnify + fit-to-width cap. Isolated applications own their equivalent fit wrapper;
  // phone, SnapshotView's in-flow Scroll, and fluid paper stay plain.
  const hybrid = usesTransformMagnify({ fill, phone, paperSize: getPaperSize(), presentation })

  // ── Magnify plumbing (hybrid only) ──────────────────────────────────────────────────────────
  // ONE subscriber applies the effective magnify to the DOM: the --iw-magnify var, the
  // .iw-magnified class, and the wrapper box's size. ⚠ THE WRAPPER IS SIZED TO THE PAGE'S VISUAL
  // DIMS because a transform does not change layout size — that is what keeps the scroll range
  // equal to what is on screen. useLayoutEffect so a narrow window never flashes a frame at
  // scale 1. → docs/archive/editor-surface.md#scroll-magnify
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
    // holdWavesFor: a new scale resizes the wrapper and the browser may CLAMP scrollTop against
    // the new extent ASYNCHRONOUSLY, at the next layout — scroll the sway must absorb.
    const unsub = subscribeMagnify(() => { holdWavesFor(350); apply(); armSettle() })
    // FIT CAP: recompute from the surface's clientWidth (excludes the scrollbar, so the fit page
    // never sits under it) on every resize and page-settings change.
    // SCROLL LOCK THROUGH THE SQUEEZE: a width change re-binds the cap, so the wrapper's height
    // changes and the reading position would scroll away. Anchor the top-visible TEXT line and
    // displacement-correct per RO tick, so a 0.18s panel transition's stream of small changes each
    // cancels to zero. Same held-anchor and block-rejection rules as the zoom paths below.
    // → docs/archive/editor-surface.md#scroll-magnify
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
      // ⚠ NO holdWavesFor here. This RO fires on EVERY paper resize — open-ended, unlike a bounded
      // gesture — so a hold per fire never lapses at s≠1 and the scroll sway freezes permanently.
      // A clamp from an ordinary reflow is genuine content motion the sway SHOULD follow; the
      // gesture path already holds the zoom-induced ones.
      if (s !== 1 && box && paper) box.style.height = `${paper.offsetHeight * s}px`
      // SELF-HEAL, belt-and-braces beside the className-keyed effect below (that one is the actual
      // root cause). The var and the class are independently mutable and `apply()` keeps them in
      // lockstep on ITS OWN writes only, so re-asserting both on every paper reflow is a standing
      // correction rather than a fix for one cause. → docs/archive/editor-surface.md#scroll-classname
      if (el) { el.style.setProperty('--iw-magnify', String(s)); el.classList.toggle('iw-magnified', s !== 1) }
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
      // ⚠ The module's fit cap is deliberately NOT reset here: shell and editor are BOTH hybrid
      // surfaces during the load handoff, so the shell unmounting must not yank the cap from under
      // the editor. A remount recomputes it immediately.
    }
  }, [hybrid]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⚠ Non-hybrid fill surfaces render the magnify wrapper too (hydration STRUCTURE must match the
  // desktop-built prerender) but must CLEAR its width pre-paint: React 18 adopts a mismatched
  // server attribute at hydration and never rewrites one whose vdom value does not change, so the
  // build-time `width:210mm` would stick to a phone's wrapper forever.
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
  // ⚠ THE REF IS THE AUTHORITATIVE LIVE ZOOM; React state only trails it. Never re-assign the ref
  // from state on render — a re-render landing MID-GESTURE resets it to the stale state and the
  // next commit steps from zoom 1 (probed: a −9-step snap-back mid-pinch).
  const editorZoomRef = useRef(editorZoom)
  // Anchor the font zoom SYNCHRONOUSLY (no flicker): set the zoom var, force layout by reading the
  // anchored element's new position, correct scrollTop in the SAME frame, all before paint. The
  // anchor is the real element under the cursor — a fraction estimate drifts badly down the page,
  // because reflow does not grow uniformly. → docs/archive/editor-surface.md#scroll-anchor
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return // desktop: Ctrl/⌘+wheel on the surface; phone: two-finger pinch (body-scroll, below)
    // ⚠ FRAME COALESCING: every zoom step forces a FULL-document reflow, and trackpads emit several
    // wheel events per frame, so events only ACCUMULATE and ONE rAF applies the net step count —
    // one reflow per painted frame, and rAF runs pre-paint so the anchor logic stays flicker-free.
    // BOTH accumulators are FRACTIONAL and commit WHOLE lattice steps (the remainder carries), so
    // every input quantizes onto the shared zoomStep lattice — which is what makes zoom levels
    // precomputable at all. → docs/archive/editor-surface.md#scroll-anchor
    let steps = 0 // plain pinch/ctrl-scroll: font reflow
    let mSteps = 0 // Command+scroll/pinch: whole-page magnify
    let raf = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    // Phone is BODY-scroll: the anchor correction must move window.scrollY — the surface itself
    // never scrolls there. ONE pair of helpers keeps every path identical for both scrollers (R2).
    const getScrollTop = () => (phone ? window.scrollY : el.scrollTop)
    const setScrollTop = (y: number) => {
      if (phone) window.scrollTo(window.scrollX, Math.max(0, y))
      else el.scrollTop = Math.max(0, y)
      // ⚠ Record every write's CLAMPED result: the zoom guard discriminates OUR writes from user
      // scrolls (rebase vs pin), and without this it rebased its pin onto relevancy-wave
      // displacement (probed: 11 rebases vs 3 pins in one wheel session).
      guardScrollTop = getScrollTop()
    }
    const scrollRange = () => {
      if (!phone) return Math.max(1, el.scrollHeight - el.clientHeight)
      const se = document.scrollingElement || document.documentElement
      return Math.max(1, se.scrollHeight - window.innerHeight)
    }
    // Pinch state (phone): the gesture-START midpoint picks the anchor; holding it and correcting
    // by its actual displacement keeps the pinched-on text stationary for the whole gesture.
    let pinchDist = 0
    let pinchX = 0, pinchY = 0
    // ⚠ ONE STABLE anchor per gesture, and it is a TEXT POSITION (caret range), NOT a block top.
    // Re-picking every frame flips the anchor at block boundaries; a block TOP is too coarse,
    // because a font-zoom step scales a paragraph's height ≈ zoom² and text N px into the block
    // slides to N·zoom² while its top sits perfectly pinned (measured: the pinched-on words 1300px
    // away over one gesture). The block is kept only for connectivity checks and as the fallback
    // where no caret resolves. → docs/archive/editor-surface.md#scroll-anchor
    let anchorEl: HTMLElement | null = null
    let anchorNode: Node | null = null // text node of the caret anchor (null → block-top fallback)
    let anchorOff = 0
    let anchorTop0 = 0 // the anchor's viewport top when picked — the gesture's PIN position
    // Viewport top of a held anchor: the caret's line-box top when alive, else the block top, else
    // null (the caller falls back to the ratio). R1: a skipped block yields a degenerate 0×0 caret
    // rect at the origin — fall through to the block-top box rather than trust it as a position.
    const anchorTopFor = (node: Node | null, off: number, block: HTMLElement | null): number | null => {
      if (node && node.isConnected && node.nodeType === Node.TEXT_NODE) {
        const len = (node as Text).length
        if (len > 0) {
          const o = Math.min(off, len - 1)
          const r = document.createRange()
          r.setStart(node, o)
          r.setEnd(node, o + 1)
          const rect = r.getBoundingClientRect()
          if (rect.width !== 0 || rect.height !== 0) return rect.top
        }
      }
      return block && block.isConnected ? block.getBoundingClientRect().top : null
    }
    const anchorTop = () => anchorTopFor(anchorNode, anchorOff, anchorEl)
    // Resolve the content anchor at (x, y): the CARET text position, validated to sit in real
    // editor text, else a block probe that REJECTS the big containers (.ProseMirror /
    // .scroll-paper reflow toward the doc top — the "jump to top" bug) and the PAGE-GAP widgets
    // and sheet chrome (pinned px that do NOT reflow with the font — "funky near page gaps").
    const pickAnchor = (x: number, y: number): void => {
      anchorEl = null
      anchorNode = null
      const docAny = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      }
      const caret = docAny.caretRangeFromPoint
        ? (() => { const r = docAny.caretRangeFromPoint!(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null })()
        : docAny.caretPositionFromPoint
          ? (() => { const p = docAny.caretPositionFromPoint!(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null })()
          : null
      if (caret && caret.node.nodeType === Node.TEXT_NODE) {
        const host = caret.node.parentElement
        if (host && el.contains(host) && host.closest('.ProseMirror')
          && !host.closest('.inkwave-page-gap') && !host.classList.contains('inkwave-page-gap-band')) {
          const block = host.closest('.ProseMirror > *') as HTMLElement | null
          if (block) {
            anchorEl = block
            anchorNode = caret.node
            anchorOff = caret.offset
            anchorTop0 = anchorTop() ?? 0
            return
          }
        }
      }
      const pickAt = (py: number, strict: boolean): HTMLElement | null => {
        const t = document.elementFromPoint(x, py) as HTMLElement | null
        if (!t || !el.contains(t)) return null
        if (t.classList.contains('ProseMirror') || t.classList.contains('scroll-paper')) return null
        if (t.closest('.ProseMirror') == null) return null // outside the text (sheet chrome, layer divs)
        if (t.closest('.inkwave-page-gap') || t.classList.contains('inkwave-page-gap-band')) return null
        // STRICT pass refuses blocks SPLIT by a page gap: such a block's rect straddles the
        // boundary, so successive frame corrections alternate direction — the boundary flicker.
        if (strict && t.querySelector('.inkwave-page-gap')) return null
        return t
      }
      // Probe the point, then alternate above/below in growing steps. Two passes: strict, then
      // lenient — a split block still beats the no-anchor ratio fallback.
      for (const strict of [true, false]) {
        anchorEl = pickAt(y, strict)
        for (const dy of [40, -40, 90, -90, 150, -150, 220, -220]) {
          if (anchorEl) break
          anchorEl = pickAt(y + dy, strict)
        }
        if (anchorEl) break
      }
      if (anchorEl) anchorTop0 = anchorEl.getBoundingClientRect().top // the gesture's pin position
    }
    // MAGNIFY frame (hybrid, Command+scroll/pinch): scale the page about the VIEWPORT CENTRE.
    // The wrapper box's rect IS the page's
    // visual bounds, so the content point at the centre is (centre − box.top) into the page and
    // lands at box'.top + offset·(after/before). → docs/archive/editor-surface.md#scroll-anchor
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
      // ⚠ Multiply the EFFECTIVE scale, never the raw intent: while the fit cap binds, intent
      // hovers just above it instead of running to 2.5 and snapping huge when the window widens.
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
      // GESTURE REBASE: a busy main thread at gesture start bursts its queued touchmoves in
      // together, and the whole backlog would commit as one multi-step leap. The FIRST responsive
      // frame DISCARDS the backlog and takes the current finger spread as the baseline, so zoom
      // follows the fingers from the moment the pipeline actually responds.
      if (!gestureRebased) { gestureRebased = true; steps = 0 }
      const net = Math.trunc(steps) // commit whole lattice steps; the fractional remainder carries
      steps -= net
      const vr = el.getBoundingClientRect()
      const anchorX = phone ? pinchX : vr.left + vr.width / 2
      const anchorY = phone ? pinchY : vr.top + vr.height / 2
      // No step committed this frame → nothing to apply. Between-commit drift (native pan on
      // phone, content-visibility relevancy waves on both) is owned by the zoom GUARD loop.
      if (!net) return
      // Pick (or re-pick, if the node was destroyed) the content anchor under the pinch midpoint /
      // viewport centre; phone picks at touchstart.
      if (!anchorEl || !anchorEl.isConnected) pickAnchor(anchorX, anchorY)
      const keepLeft = el.scrollLeft // desktop only; the phone helper pins window.scrollX itself
      // ⚠ THE RATIO MUST BE CLAMPED — this is the "doc keeps jumping down to the bottom" (R1: a
      // defensive `max(1,…)` silently became a measurement). See scrollRatioOf above.
      const ratio = scrollRatioOf(getScrollTop(), scrollRange())
      const tPick0 = performance.now()
      const topBefore = anchorTop() ?? 0 // at the CURRENT size
      probePerf('zoom-anchorPre', performance.now() - tPick0)
      // LATTICE COMMIT: level = 1.08^step exactly, so every reachable level is a shared lattice
      // point the pagination step cache can precompute.
      const stepNext = zoomToStep(editorZoomRef.current) + net // zoomToStep clamps; re-clamped inside stepToZoom
      const next = stepToZoom(stepNext)
      if (next === editorZoomRef.current) return // pinned at a lattice bound — nothing to apply
      const commitT0 = performance.now() // perflog zoom-commit: reflow + anchor + bands, this task
      // Pin pagination's RO-driven painters for the whole gesture: per-frame LIVE repositioning
      // lagged the reflowing text 1–2 frames (the page-boundary flicker). The step cache replaces
      // it with precomputed geometry; the RO path stays gated as the cache-MISS fallback.
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = true
      // Lazy off-screen (both platforms): the live-reflow window makes each step lay out ~one
      // screenful. BOTH enter on the first committed step (2026-07-11 — phone used to enter at
      // touchstart, which forced a full placeholder-switch relayout inside the touchstart task
      // and a second reflow at the first commit; entering here folds the switch into the commit's
      // one forced layout below). Both exit in the settle.
      const tLive0 = performance.now()
      enterZoomLive()
      probePerf('zoom-enterLive', performance.now() - tLive0)
      const tReflow0 = performance.now()
      el.style.setProperty('--iw-editor-zoom', String(next)) // apply now → text reflows
      // Skipped-placeholder heights track the committed zoom (see enterZoomLive) — same recalc.
      if (zoomLiveEd) el.style.setProperty('--iw-cis-scale', ((next / zoomLiveZ0) ** 2).toFixed(4))
      // Hybrid at magnify ≠ 1: the wrapper box must track the reflowed paper height SYNCHRONOUSLY
      // (its RO fires later this frame) or the scroll-range clamp bites against a stale height near
      // the document end.
      const mag = getMagnify()
      if (mag !== 1 && magnifyBoxRef.current && paperElRef.current)
        magnifyBoxRef.current.style.height = `${paperElRef.current.offsetHeight * mag}px`
      // ONE forced layout for the whole frame (2026-07-11 first-response cost): placeholder
      // switch + font reflow + wrapper sync all land in this single anchor read.
      const topAfter = anchorTop()
      const tAfterAnchor = performance.now()
      // PREDICTIVE STEP CACHE: dispatch AFTER the anchor read, so a cache MISS's band measure rides
      // the layout just forced; BEFORE the scroll correction, because applyBands' sheet min-height
      // write must precede the scroll write or the range clamps. The surface is carried so
      // SnapshotView's own Scroll can never drive the live editor's panels.
      const tStep0 = performance.now()
      window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(next), surface: el, z0: zoomLiveZ0 } }))
      probePerf('zoom-stepEvent', performance.now() - tStep0)
      if (topAfter != null) {
        // ⚠ LIVE WINDOW: pin to the GESTURE-START viewport top, not last frame's. The
        // content-visibility set re-evaluates between frames, and per-frame displacement correction
        // PRESERVES that inter-frame drift instead of undoing it (~200px over a big gesture). The
        // pin is safe only because the user cannot scroll while the window is up.
        setScrollTop(getScrollTop() + (topAfter - (zoomLiveEd ? anchorTop0 : topBefore)))
        if (!phone) el.scrollLeft = keepLeft
      } else {
        setScrollTop(ratio * scrollRange()) // no anchor → keep relative position
        if (!phone) el.scrollLeft = keepLeft
      }
      editorZoomRef.current = next
      notePerf('zoom-commit', performance.now() - commitT0)
      // Per-EVENT profiling: `notePerf` keeps only the worst value per 2s, which cannot answer
      // "what does ONE notch cost"; `probePerf` costs one property check unless a harness defines
      // window.__iwPerf. See scripts/textrender-probe/zoomcost.prove.mjs.
      probePerf('zoom-commit', performance.now() - commitT0)
      probePerf('zoom-reflow', tAfterAnchor - tReflow0)   // the write + the forced anchor read
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
        // ZOOM-SETTLE RE-MEASURE: breaks stay pinned DURING the gesture (re-measuring live made the
        // text lurch), so the gaps + panels are still at the OLD font size. One clean re-measure,
        // re-anchored around the same held anchor so the adjustment moves no text.
        const heldNode = anchorNode, heldOff = anchorOff, heldEl = anchorEl
        anchorEl = null; anchorNode = null // gesture over → next gesture picks a fresh anchor
        const topBeforeMeasure = anchorTopFor(heldNode, heldOff, heldEl)
        const onMeasured = () => {
          window.removeEventListener('inkwave:pagination-measured', onMeasured)
          requestAnimationFrame(() => { // re-anchor is a zoom correction too — inside the hold window
            const topAfterMeasure = anchorTopFor(heldNode, heldOff, heldEl)
            if (topBeforeMeasure != null && topAfterMeasure != null)
              setScrollTop(getScrollTop() + (topAfterMeasure - topBeforeMeasure))
          })
        }
        window.addEventListener('inkwave:pagination-measured', onMeasured)
        window.dispatchEvent(new Event('inkwave:zoom-settled'))
        // Non-gapped mode: no pagination plugin listening → drop the one-shot listener shortly.
        setTimeout(() => window.removeEventListener('inkwave:pagination-measured', onMeasured), 1000)
      }, ZOOM_SETTLE_MS)
    }
    // MODE LATCH + COOLDOWN: a plain pinch/ctrl-scroll is font reflow; ⌘+scroll/pinch is whole-page
    // magnify. Cursor position is irrelevant. The first event stays latched for the full gesture.
    // → docs/archive/editor-surface.md#scroll-zone
    const latch = createZoomLatch(() => surfaceRef.current)
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        // CONTENT-PROPORTIONAL PLAIN SCROLL below the knee only: the wrapper sizes scroll space to
        // VISUAL dims, so at a deep zoom-out a native notch covers 1/scale× the document distance
        // and the tiny page zips past. Scale 1 returns without preventDefault.
        if (!hybrid) return
        const s = getMagnify()
        // ⚠ NATIVE SCROLLING FOR THE WHOLE NORMAL ZOOM BAND — Peter felt "a resistance". Above the
        // knee this multiplied every delta by the scale, so a fit-to-width 0.57 (what a 570px
        // window gives you, not a zoom anyone chose) moved the page 57% of what the fingers asked,
        // and preventDefault replaced the trackpad's momentum with discrete main-thread writes.
        // The wrapper already sizes the RANGE to the visual content, so native scrolling covers the
        // document correctly by itself. → docs/archive/editor-surface.md#scroll-accel
        if (s >= SCROLL_ACCEL_KNEE) return
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
      const zoomDelta = projectedZoomDelta(e.deltaX, e.deltaY)
      if (zoomDelta === 0) return
      // ⚠ `isIdle()` must be read BEFORE `resolve()`, which latches a mode on its first call.
      const freshGesture = latch.isIdle()
      const mode = latch.resolve(
        () => zoomModeForWheel(e, hybrid),
        zoomDelta > 0,
      )
      // LATTICE QUANTIZATION: a full wheel notch (|ΔY| ≥ 100) is exactly ±1 step; fine-deltas
      // contribute proportional FRACTIONS that accumulate until a whole step commits, so every
      // input lands on the shared lattice rather than an arbitrary float between points.
      // TRACKPAD_ZOOM_SENSITIVITY scales ONLY the fraction — a discrete notch stays one step.
      const mag = Math.abs(zoomDelta)
      const dir = zoomDelta < 0 ? 1 : -1
      let stepDelta = dir * (mag >= 100 ? 1 : Math.min(1, (mag / 100) * TRACKPAD_ZOOM_SENSITIVITY))
      // FIRST-STEP HEAD START, once per gesture and applied AFTER the mode is decided (the mode
      // does not affect which accumulator gets it; `freshGesture` was captured pre-resolve).
      if (freshGesture) stepDelta += dir * FIRST_STEP_BONUS
      if (mode === 'water') {
        mSteps += stepDelta
      } else {
        steps += stepDelta
      }
      if (!raf) raf = requestAnimationFrame(applyFrame)
    }
    // PHONE PINCH-TO-ZOOM — LIVE font reflow per lattice step, exactly like the desktop wheel, on
    // the LIVE-REFLOW WINDOW's budget; the anchor is the pinch MIDPOINT (horizontal is fixed by the
    // full-width reflow). Feature-detected: without content-visibility the same pipeline runs
    // against the full document — correct, just heavier.
    // ⚠ TOUCHSTART STAYS PASSIVE and the non-passive touchmove is attached ONLY while two fingers
    // are down (armed inside the second finger's touchstart, before any move can dispatch): a
    // non-passive listener on the whole surface makes iOS dispatch EVERY touch to the main thread
    // and wait. → docs/archive/editor-surface.md#scroll-pinch
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    let pinchMoveArmed = false
    let gestureStartZoom = 1 // zoom level at pinch start — detects a no-commit gesture
    let gestureRebased = true // false between a pinch's touchstart and its first responsive frame
    const armPinchMove = () => {
      if (!pinchMoveArmed) { pinchMoveArmed = true; el.addEventListener('touchmove', onTouchMove, { passive: false }) }
    }
    const disarmPinchMove = () => {
      if (pinchMoveArmed) { pinchMoveArmed = false; el.removeEventListener('touchmove', onTouchMove) }
    }
    // ── LIVE-REFLOW WINDOW (the "lazy off-screen" strategy — phone pinch AND desktop wheel) ──
    // `.iw-zoom-live` puts content-visibility:auto on the editor's block children, so a zoom step
    // reflows ~one screenful instead of the whole document. ⚠ NEVER write a style attribute on a
    // ProseMirror-OWNED node to size the placeholders: PM's DOM observer REBUILDS the touched
    // blocks, which detaches the gesture's touch target (iOS keeps dispatching to the ORIGINAL
    // node) and strips the placeholder sizes. Measurement stays exact because forceCanonicalContext
    // forces `--iw-cv: visible`, and no measure runs mid-gesture anyway.
    // → docs/archive/editor-surface.md#scroll-live-window
    const CV_LIVE = typeof CSS !== 'undefined' && !!CSS.supports?.('content-visibility', 'auto')
    let zoomLiveEd: HTMLElement | null = null
    let zoomLiveStyle: HTMLStyleElement | null = null
    let zoomLiveZ0 = 1 // zoom at live-window entry — the placeholder rules' height baseline
    // The arith exit leaves the content-visibility window ON at rest (exactly sized) instead of
    // paying the O(doc) un-skip — see exitZoomLive. Tracked so the next entry re-arms the guard and
    // replaces the stylesheet, and so the unmount teardown still hard-clears the class.
    let zoomLiveResting = false
    let restUnskipTimer: ReturnType<typeof setTimeout> | undefined
    const arithBandsOn = (): boolean => {
      try { return typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithBands') === '1' } catch { return false }
    }
    // ── ZOOM GUARD: the placeholder regime is only piecewise-consistent AT commit instants,
    // because the browser re-evaluates content-visibility RELEVANCY asynchronously between frames
    // and each wave shifts the layout with NO handler running (measured 93-546px of band/text
    // desync until the next commit). This rAF loop re-pins the anchor and re-syncs the bands on the
    // frame a wave lands. A DESKTOP scroll between commits is a genuine user scroll — REBASE; on
    // PHONE fingers are down, so any scroll not ours is a native pan that survived suppression —
    // PIN. → docs/archive/editor-surface.md#scroll-live-window
    let guardRaf = 0
    let guardScrollTop = 0
    // Shared across Scroll instances (the loading shell's would otherwise shadow the live
    // editor's) — debug/probe only.
    const gw = window as unknown as { __iwZoomGuard?: { ticks: number; rebase: number; pin: number; noAnchor: number } }
    const guardStats = (gw.__iwZoomGuard ||= { ticks: 0, rebase: 0, pin: 0, noAnchor: 0 })
    const guardTick = () => {
      guardRaf = 0
      if (!zoomLiveEd) return
      guardStats.ticks++
      const st = getScrollTop()
      const t = anchorTop()
      if (t != null) {
        if (!phone && Math.abs(st - guardScrollTop) > 0.5) {
          guardStats.rebase++
          anchorTop0 = t // user scrolled mid-window (desktop) — keep guarding from the new pose
        } else if (Math.abs(t - anchorTop0) > 1) {
          guardStats.pin++
          setScrollTop(st + (t - anchorTop0))
          // The wave moved sheet-local geometry too: commit-time bands (and every placeholder-
          // regime cache entry) are stale — re-derive from the CURRENT layout, same task.
          window.dispatchEvent(new CustomEvent('inkwave:zoom-step', {
            detail: { step: zoomToStep(editorZoomRef.current), surface: el, z0: zoomLiveZ0, resync: true },
          }))
        }
      } else guardStats.noAnchor++
      guardScrollTop = getScrollTop()
      guardRaf = requestAnimationFrame(guardTick)
    }
    const enterZoomLive = () => {
      if (!CV_LIVE || zoomLiveEd) return
      const ed = el.querySelector('.ProseMirror') as HTMLElement | null
      if (!ed || !ed.children.length) return
      // Re-entering from the RESTING arith window: the class is already on, so every offsetHeight
      // below reads a placeholder and the doc is never un-skipped; the old exact stylesheet is
      // replaced by the fresh baseline the rules below generate.
      zoomLiveResting = false
      if (restUnskipTimer) { clearTimeout(restUnskipTimer); restUnskipTimer = undefined } // a new gesture owns the window
      zoomLiveStyle?.remove()
      zoomLiveStyle = null
      // ⚠ EXACT per-block placeholder heights via ONE generated stylesheet of `:nth-child` rules.
      // A flat mean shifted off-screen geometry by Σ(real−mean), so entry needed a ~5,000px
      // compensating scroll that DRAGGED the relevancy set across the doc and painted one frame
      // with the pinched text ~2,400px off. Height-identical placeholders make the switch
      // geometry-neutral. And they TRACK the zoom (`--iw-cis-scale = (zoom/z0)²`, written beside
      // the zoom var in the same recalc): a block's height ∝ zoom², so frozen gesture-start heights
      // made every relevancy swap jump 90-450px. `--iw-cis` remains the fallback for children
      // beyond these rules. → docs/archive/editor-surface.md#scroll-live-window
      const kids = Array.from(ed.children) as HTMLElement[]
      let css = ''
      let sum = 0
      for (let i = 0; i < kids.length; i++) {
        const h = kids[i].offsetHeight
        sum += h
        css += `.ProseMirror.iw-zoom-live>:nth-child(${i + 1}){contain-intrinsic-size:auto calc(${h}px*var(--iw-cis-scale,1))}\n`
      }
      zoomLiveZ0 = editorZoomRef.current
      // No entry bracket: the ONLY caller is applyFrame's commit path, immediately before the zoom
      // var write, so the geometry-neutral switch and the font reflow land in ONE forced layout and
      // the pin absorbs the frame's displacement.
      zoomLiveStyle = document.createElement('style')
      zoomLiveStyle.textContent = css
      document.head.appendChild(zoomLiveStyle)
      ed.style.setProperty('--iw-cis', `${Math.max(24, Math.round(sum / kids.length))}px`)
      ed.classList.add('iw-zoom-live')
      zoomLiveEd = ed
      guardScrollTop = getScrollTop()
      if (!guardRaf) guardRaf = requestAnimationFrame(guardTick)
    }
    // ── THE DEFERRED EXACT UN-SKIP ──────────────────────────────────────────────────────────
    // The fast exit leaves the window ON, so off-screen blocks still reserve approximate heights
    // and the SCROLL RANGE is off by up to ~5% (measured 20,931px on a 20k-word doc). Nothing on
    // screen is ever wrong — visible bands are read from the same regime the text lays out in — but
    // the scrollbar would lie, so we still pay the un-skip, just when the writer is IDLE and never
    // in the gesture's own frame. Anchored on the first block crossing the viewport top.
    // → docs/archive/editor-surface.md#scroll-live-window
    const restUnskip = () => {
      const ed = el.querySelector('.ProseMirror') as HTMLElement | null
      if (!ed || !zoomLiveResting) return
      let anchorEl: HTMLElement | null = null
      let before = 0
      for (const k of Array.from(ed.children) as HTMLElement[]) {
        const r = k.getBoundingClientRect()
        if (r.bottom > 0) { anchorEl = k; before = r.top; break }
      }
      zoomLiveResting = false
      ed.classList.remove('iw-zoom-live')
      ed.style.removeProperty('--iw-cis')
      el.style.removeProperty('--iw-cis-scale')
      zoomLiveStyle?.remove()
      zoomLiveStyle = null
      const after = anchorEl ? anchorEl.getBoundingClientRect().top : null // forces the exact relayout
      // Same-task band re-derive off the now-full layout (the atomicity contract: bands and text
      // must land in ONE frame — the class is off, so onZoomStep routes to the full-regime cache).
      window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(editorZoomRef.current), surface: el } }))
      if (after != null) setScrollTop(getScrollTop() + (after - before))
      probePerf('zoom-rest-unskip', 0)
    }
    // Genuinely idle only: any input pushes it back, so it never lands in a gesture or a scroll.
    const scheduleRestUnskip = () => {
      if (restUnskipTimer) clearTimeout(restUnskipTimer)
      restUnskipTimer = setTimeout(() => {
        restUnskipTimer = undefined
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
        if (ric) ric(() => restUnskip(), { timeout: 1000 })
        else restUnskip()
      }, 900)
    }
    const exitZoomLive = () => {
      const ed = zoomLiveEd
      if (!ed) return
      const exitT0 = performance.now() // perflog zoom-exit: un-skip relayout + atomic band re-derive
      zoomLiveEd = null
      if (guardRaf) { cancelAnimationFrame(guardRaf); guardRaf = 0 }
      // ── ARITH EXIT (flag inkwave:arithBands) ────────────────────────────────────────────────
      // The un-skip below is O(doc) — 240/722/2688ms at 5k/20k/40k words. EXPERIMENT A: keep the
      // window ON and re-derive the bands in the PLACEHOLDER regime, which is exactly what every
      // mid-gesture step already does, so the exit is O(visible). The bands are applied inside the
      // dispatch, so they still land in THIS task, atomic with the pin.
      if (arithBandsOn()) {
        zoomLiveResting = true
        window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(editorZoomRef.current), surface: el } }))
        const after = anchorTop()
        if (after != null) setScrollTop(getScrollTop() + (after - anchorTop0))
        notePerf('zoom-exit-arith', performance.now() - exitT0); probePerf('zoom-exit-arith', performance.now() - exitT0)
        ;(window as unknown as { __iwArithExit?: unknown }).__iwArithExit = { ok: true, why: 'noUnskip' }
        scheduleRestUnskip() // the exact layout returns at idle — off the gesture's frame
        return
      }
      // Re-anchoring bracket: skipped blocks held their gesture-START heights, so un-skipping
      // displaces everything below — pin the held anchor back in the SAME task.
      ed.classList.remove('iw-zoom-live')
      ed.style.removeProperty('--iw-cis')
      el.style.removeProperty('--iw-cis-scale')
      zoomLiveStyle?.remove()
      zoomLiveStyle = null
      const after = anchorTop() // forces the full relayout now, pre-paint
      // ⚠ ATOMIC EXIT: the un-skip relayout must never paint under placeholder-era panels — that
      // window showed 779-1170px of band/text desync for ~180ms at EVERY settle. Re-derive the
      // bands from the full layout in THIS task, dispatched BEFORE the scroll write so applyBands'
      // sheet min-height lands first (scroll-range clamp order).
      window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(editorZoomRef.current), surface: el } }))
      if (after != null) setScrollTop(getScrollTop() + (after - anchorTop0))
      notePerf('zoom-exit', performance.now() - exitT0); probePerf('zoom-exit', performance.now() - exitT0)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      pinchDist = touchDist(e.touches)
      pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      steps = 0
      gestureRebased = false // first responsive frame discards the backlog (see applyFrame)
      // Fresh gesture → anchor the TEXT POSITION under THIS midpoint, from the PRE-gesture layout,
      // so the pin holds exactly what the fingers grabbed. This hit-test is the touchstart task's
      // ONLY layout-touching work; the live window enters lazily at the first commit.
      pickAnchor(pinchX, pinchY)
      // ⚠ Hold from the FIRST touch, not the first commit: a queued SCAS tick landing mid-pinch
      // rebuilds the touched paragraph and the gesture dies on the detached node.
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = true
      gestureStartZoom = editorZoomRef.current
      armPinchMove()
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchDist) return
      e.preventDefault() // our zoom replaces the browser's — stop the native pinch
      const d = touchDist(e.touches)
      if (d < 8) return // fingers (nearly) touching — the ratio is degenerate noise
      steps += (Math.log(d / pinchDist) / Math.log(ZOOM_STEP_RATIO)) * PINCH_ZOOM_SENSITIVITY
      pinchDist = d
      // PAN-WHILE-PINCHING: `preventDefault` above blocks the browser's native two-finger pan
      // (deliberately — we replace its pinch), so a gesture that pinches AND drags needs its drag
      // half implemented here. Track the MIDPOINT's own frame-to-frame movement as a direct
      // additive scroll — independent of the zoom-step path, which fires only when a lattice step
      // crosses, while this must track every touchmove or the pan reads as sticky. Phone is never
      // CSS-scaled, so a screen pixel is a scroll pixel; vertical goes through setScrollTop (phone
      // scrolls the WINDOW, and it records guardScrollTop so the guard reads this as OUR write).
      // → docs/archive/editor-surface.md#scroll-pinch
      const curMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const curMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const dx = curMidX - pinchX, dy = curMidY - pinchY
      if (dx) el.scrollLeft -= dx // horizontal has no phone/window equivalent — phone content is edge-to-edge
      if (dy) setScrollTop(getScrollTop() - dy)
      pinchX = curMidX; pinchY = curMidY
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
      // ── SCROLL LATENCY: the non-passive wheel listener exists ONLY when it could intercept
      // something. However cheap its body, it forces the compositor to WAIT for main-thread
      // dispatch on EVERY wheel event, so plain scrolling inherited whatever task was running
      // (~100ms of lag). At rest there is NO non-passive wheel listener at all.
      // Residual: entering the window with ctrl ALREADY held gives the browser the first notch
      // until a keydown/pointer event reveals the modifier; the pointermove check closes that for
      // the mouse-first flow. → docs/archive/editor-surface.md#scroll-zone
      let wheelArmed = false
      const armWheel = () => { if (!wheelArmed) { wheelArmed = true; el.addEventListener('wheel', onWheel, { passive: false }) } }
      const disarmWheel = () => { if (wheelArmed) { wheelArmed = false; el.removeEventListener('wheel', onWheel) } }
      let ctrlHeld = false
      // ⚠ A TRACKPAD PINCH PRESSES NO KEY — trackpads synthesise `wheel` with `ctrlKey: true` and
      // NO keydown ever fires, so arming on a real Control/Meta key left the listener unattached
      // and the gesture fell through to the BROWSER's own zoom. R9: a gesture that announces itself
      // only in its own first event cannot be armed for REACTIVELY, because by then the browser has
      // zoomed a notch and a page cannot undo that. So arm WHILE THE POINTER IS OVER THE SURFACE —
      // the only state that reliably PRECEDES the pinch. The latency guard survives where it
      // matters: a cursor over another panel still leaves no listener, and onWheel's first branch
      // returns for an ordinary scroll without preventDefault.
      // → docs/archive/editor-surface.md#scroll-zone
      let pointerOver = false
      const syncWheelArming = () => { if (shouldArmWheel({ ctrlHeld, pointerOver, magnify: getMagnify() })) armWheel(); else disarmWheel() }
      const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld = true; syncWheelArming() } }
      const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld = false; syncWheelArming() } }
      const onBlurWin = () => { ctrlHeld = false; syncWheelArming() }
      const onPointerCheck = (e: PointerEvent) => { // came-in-held: reveal the modifier before the first wheel
        const held = e.ctrlKey || e.metaKey
        if (held !== ctrlHeld || !pointerOver) { ctrlHeld = held; pointerOver = true; syncWheelArming() }
      }
      const onPointerEnter = () => { if (!pointerOver) { pointerOver = true; syncWheelArming() } }
      const onPointerLeave = () => { if (pointerOver) { pointerOver = false; syncWheelArming() } }
      window.addEventListener('keydown', onKeyDown, { capture: true })
      window.addEventListener('keyup', onKeyUp, { capture: true })
      window.addEventListener('blur', onBlurWin)
      el.addEventListener('pointermove', onPointerCheck, { passive: true })
      el.addEventListener('pointerenter', onPointerEnter, { passive: true })
      el.addEventListener('pointerleave', onPointerLeave, { passive: true })
      const unsubArm = subscribeMagnify(syncWheelArming)
      syncWheelArming()
      cleanupWheelArming = () => {
        window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
        window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions)
        window.removeEventListener('blur', onBlurWin)
        el.removeEventListener('pointermove', onPointerCheck)
        el.removeEventListener('pointerenter', onPointerEnter)
        el.removeEventListener('pointerleave', onPointerLeave)
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
      if (restUnskipTimer) { clearTimeout(restUnskipTimer); restUnskipTimer = undefined }
      if (zoomLiveResting) { // the fast exit rests the window ON — tear it down for real here
        zoomLiveResting = false
        ;(el.querySelector('.ProseMirror') as HTMLElement | null)?.classList.remove('iw-zoom-live')
        zoomLiveStyle?.remove(); zoomLiveStyle = null
      }
      latch.dispose() // drop the mode latch + zoom-cursor classes with the listeners
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = false // never leave painters pinned
    }
  }, [phone, hybrid]) // eslint-disable-line react-hooks/exhaustive-deps
  const sideMarginPx  = getSideMarginPx()
  const topMarginPx   = getTopMarginPx()
  const btmMarginPx   = getBtmMarginPx()
  const paraSpacingEm = getParaSpacingEm()
  const columns       = getColumns()
  // Waves sway horizontally with scroll, and NEVER with zoom — see the hold window above. The sway
  // rides on a persistent BASE offset (where the loading coast came to rest), starting at 0 so
  // surfaces that never drift keep the plain scrollTop·WAVE_SWAY sway.
  useEffect(() => {
    const el = surfaceRef.current
    // Phone attaches NO listener: waves exist only DURING load there, and at rest the surface is
    // parchment, so the sway var would be a style recalc per scroll frame for nothing.
    if (!el || phone) return
    const target: HTMLElement | Window = el
    let raf = 0
    let lastTop = el.scrollTop
    // FULLSCREEN PDF SWAY: the PDF viewer dispatches its absolute scrollTop, folded into the SAME
    // base+top formula as a second scroll source (R2) — one write path, so the zoom-hold and coast
    // rules stay intact.
    let pdfTop = 0
    const writeWave = () => {
      // ONE rounded value for both consumers: the surface var and the twinkle fields' LITERAL
      // transforms (`swayFields`). ⚠ `--wave-x` MUST NEVER INVALIDATE THE PAGE SUBTREE — index.css
      // firebreaks it to 0px under the page roots, and a NEW `var(--wave-x)` consumer must not sit
      // beneath them. Without that, desktop scroll frames were p50 417ms; with it, 50ms.
      const wx = Number((waveBaseRef.current + (el.scrollTop + pdfTop) * WAVE_SWAY).toFixed(1))
      el.style.setProperty('--wave-x', `${wx}px`)
      swayFields(el, wx)
    }
    const apply = () => {
      raf = 0
      // NEVER write --wave-x mid-drift/coast (2026-07-09 regression fix): during the load the
      // background-position is class-pinned anyway, but the var write dirtied style on the surface
      // + its animated pseudos every restore-scroll frame — a mid-coast recalc hitch (Firefox
      // re-rasters the overdraw layers on it). The coast's finish() writes the handoff value.
      if (waveModeRef.current !== 'off') return
      const top = el.scrollTop
      // Zoom-driven scroll (gesture / settle / clamp): hold --wave-x exactly still by absorbing
      // the delta into the base. Rebased (not skipped), so sway resumes with no jump.
      if (performance.now() < zoomHoldUntilRef.current) {
        waveBaseRef.current -= (top - lastTop) * WAVE_SWAY
      } else if (top !== lastTop) {
        // GENUINE scroll (zoom-hold deltas excluded): the fixed speck loop is a pure function of
        // absolute scrollTop. No velocity clock means zoom cannot leave it running or re-phase it.
        setScrollScene(el, top + pdfTop)
      }
      lastTop = top
      writeWave()
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    const onPdfSway = (e: Event) => {
      const top = (e as CustomEvent<{ top: number }>).detail?.top ?? 0
      const prev = pdfTop
      pdfTop = top
      if (waveModeRef.current !== 'off') return // drift/coast own the wave position
      if (top !== prev) setScrollScene(el, el.scrollTop + top)
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
  // HTML, so it starts at FIRST PAINT and never stutters however busy the main thread is; the
  // brake is a CSS keyframe animation too). JS touches the animation only at the TWO control
  // events, each a one-shot write: SETTLE ('inkwave:reveal-imminent') adds the brake on top of
  // the still-running drift, and the rest handoff hands the final offset to the scroll sway as
  // its persistent base — no boundary snapping, so the waves can never stop or move backward.
  const startedHiddenRef = useRef(!revealed) // instances that mount revealed (SnapshotView) never drift
  const [waveMode, setWaveMode] = useState<'anim' | 'coast' | 'off'>(startedHiddenRef.current ? 'anim' : 'off')
  // Ref mirror for the scroll-sway rAF (declared above, runs later) — it must not write --wave-x
  // while the drift/coast animations own the wave position.
  const waveModeRef = useRef(waveMode)
  waveModeRef.current = waveMode

  // ⚠ REACT'S className WRITE SILENTLY STRIPS AN IMPERATIVELY-ADDED CLASS. The surface's className
  // is a JSX template keyed on `waveMode`/`covered`, which walk over the several-second reveal, and
  // every transition writes the WHOLE `class` attribute — taking `iw-magnified` with it. So
  // re-assert the class AND the var from a layoutEffect keyed on that template's own inputs: it
  // runs after React's commit (it sees the fresh string) and before paint (the repair is
  // invisible). This was the fit-to-width "zoom snap", past three band-aids.
  // → docs/archive/editor-surface.md#scroll-classname
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el || !hybrid) return
    const s = getMagnify()
    el.style.setProperty('--iw-magnify', String(s))
    el.classList.toggle('iw-magnified', s !== 1)
  }, [hybrid, phone, fill, covered, waveMode])

  // ⚠ SIBLING CLOCK ADOPT — the one cross-surface sync the tiles need. Two overlapping surfaces
  // each carry their own CSS drift, and one that mounts MID-LOAD starts at its own recalc, out of
  // phase; adopting the sibling's LITERAL startTime makes every copy pixel-identical by
  // construction. useLayoutEffect, because the adopt must land before this surface's first paint.
  // It also arms the load watchdog. → docs/archive/editor-surface.md#scroll-sibling-clock
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el || !startedHiddenRef.current) return
    armLoadWatchdog()
    // ⚠ THE REFERENCE IS THE FIRST-MOUNTED SURFACE AND IS NEVER REWRITTEN — `waveTwinkle.findDrift`
    // resolves that same surface, so the marks' clock is read from a startTime nothing here touches.
    // ⚠ AND THE ADOPT MUST RETRY UNTIL THE REFERENCE COMMITS: the covered editor routinely mounts
    // ~150-250ms BEFORE the shell's drift resolves its startTime, so a `sibling != null` gate
    // skipped adoption ENTIRELY, registered no retry, and left the two drifts 10-18px apart forever.
    const isReference = driftSurfaces.size === 0
    driftSurfaces.add(el)
    if (!isReference) {
      // Copy the reference surface's resolved drift-l startTime onto THIS surface's drifts. Returns
      // false while the reference is still pending — the caller retries until it resolves.
      const adopt = (): boolean => {
        let refSt: number | null = null
        for (const s of driftSurfaces) {
          if (s === el || !s.isConnected) continue
          try {
            const a = s.getAnimations({ subtree: true })
              .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
            if (typeof a?.startTime === 'number') { refSt = a.startTime as number; break }
          } catch { /* getAnimations unavailable */ }
        }
        if (refSt == null) return false
        const sib = refSt
        try {
          for (const a of el.getAnimations({ subtree: true })) {
            const n = (a as CSSAnimation).animationName ?? ''
            if (n === 'iw-wave-drift-l' || n === 'iw-wave-drift-r') {
              try { a.startTime = sib } catch { /* pending write below re-asserts */ }
              // ⚠ A write to a PLAY-PENDING CSS animation is CLOBBERED when the pending start
              // resolves — re-assert at `ready`, which is where the write sticks.
              void a.ready.then(() => { try { if (a.startTime !== sib) a.startTime = sib } catch { /* detached */ } }).catch(() => { /* cancelled */ })
            }
          }
        } catch { /* getAnimations unavailable */ }
        return true
      }
      if (!adopt()) {
        // The reference has not committed its startTime yet — retry each frame until it does,
        // capped so a reference that never resolves cannot spin forever.
        let tries = 0
        const kick = (): void => {
          if (!el.isConnected || tries++ > 240) return
          if (!adopt()) requestAnimationFrame(kick)
        }
        requestAnimationFrame(kick)
      }
    }
    return () => {
      driftSurfaces.delete(el)
      // The last drifting surface unmounting (the desktop /snapshot veil fades out mid-coast and
      // takes its animations with it) ends the choreography — there is no chain left to watch.
      if (driftSurfaces.size === 0) disarmLoadWatchdog()
    }
  }, [])
  // ⚠ TWO EFFECTS, DELIBERATELY: the settle must not share an effect with the handoff —
  // `setWaveMode('coast')` inside a `[waveMode]`-dep effect re-ran the effect, and its CLEANUP tore
  // down the just-armed listeners, leaving `.iw-wave-coast` stuck forever.
  // SETTLE → coast: the drift is never stopped, so there is nothing to freeze and no clock to
  // compensate; every surface adopts ONE record. → docs/archive/editor-surface.md#scroll-coast
  const coastT0Ref = useRef(0)
  const coastEndRef = useRef<number | null>(null) // device-pixel-snapped coast end offset (see below)
  const settleToCoast = () => {
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    // PHONE + covered renders NO wave classes — the SHELL owns the only water, and a class-less
    // surface has nothing to coast. Drop straight to rest.
    if (phone && covered) { setWaveMode('off'); return }
    // No animation-composition: no brake possible, so read the drift pose from the animation clock,
    // hand it to the sway and stop cleanly. An acceptable degrade on engines none of ours ship.
    if (!ADDITIVE_COAST) {
      let tx = 0
      try {
        const a = el.getAnimations({ subtree: true })
          .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
        if (typeof a?.currentTime === 'number') tx = -140 * (((a.currentTime as number) / 1000) % 1.944) / 1.944
      } catch { /* pose unreadable → rest at 0 */ }
      disarmLoadWatchdog()
      waveBaseRef.current = tx - el.scrollTop * WAVE_SWAY
      el.style.setProperty('--wave-x', `${tx.toFixed(3)}px`)
      setWaveMode('off')
      window.dispatchEvent(new Event('inkwave:wave-rest'))
      return
    }
    const now = timelineNow()
    const T = phone ? 2000 : 2500
    let sc = loadCoast
    if (!sc || now - sc.t0 > T) { // a stale record is an abandoned choreography (self-heals)
      const d0 = phone ? 72 : 90 // v·T/2 — snapped to a device pixel at the anchor
      injectAdditiveCoastFrames(phone, d0)
      sc = loadCoast = { t0: now, resolvedT0: null, d: d0, end: null, phone }
    }
    coastT0Ref.current = sc.resolvedT0 ?? sc.t0
    coastEndRef.current = sc.end
    setWaveMode('coast')
  }
  useLayoutEffect(() => {
    if (!revealed || waveMode !== 'anim') return
    settleToCoast()
    // Normally a no-op FALLBACK on both platforms: 'inkwave:reveal-imminent' (below) already
    // swapped to 'coast' before revealed flips — but if the event never fired, coast at reveal.
  }, [revealed, waveMode]) // eslint-disable-line react-hooks/exhaustive-deps
  // SETTLE arrives as 'inkwave:reveal-imminent', so the brake starts on that light frame, ahead of
  // the heavy reveal commit — and being additive with zero start velocity, a starved commit cannot
  // make the handoff discontinuous anyway. EVERY drifting surface listens, so shell and editor
  // coast in lockstep on one adopted clock and the swap is seamless.
  useEffect(() => {
    if (waveMode !== 'anim') return
    const onImminent = () => settleToCoast()
    window.addEventListener('inkwave:reveal-imminent', onImminent)
    return () => window.removeEventListener('inkwave:reveal-imminent', onImminent)
  }, [waveMode]) // eslint-disable-line react-hooks/exhaustive-deps
  // Coast END → sway handoff. Deceleration is pure CSS; JS wakes only at the resolved-clock timer
  // to write the snapped rest offset into --wave-x in THE SAME COMMIT the coast class drops.
  // Because the coast's ±280px overdraw is exactly two 140px tiles, transform +tx ≡
  // background-position +tx, so that pair of writes paints identical pixels: no snap, no dead frame.
  useLayoutEffect(() => {
    if (waveMode !== 'coast') return
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    let cancelled = false
    let done = false
    const finish = () => {
      if (done) return
      done = true
      disarmLoadWatchdog()
      // On phone the waves cease to exist the moment the classes drop, so this write is inert
      // there — kept unconditional for ONE code path. ⚠ The coast ends on a device-pixel-SNAPPED
      // offset, and the handoff must write that same number or the repaint shifts sub-pixel.
      const txFinal = coastEndRef.current ?? loadCoast?.end ?? -(phone ? 72 : 90)
      waveBaseRef.current = txFinal - el.scrollTop * WAVE_SWAY
      el.style.setProperty('--wave-x', `${txFinal.toFixed(3)}px`) // 3 decimals — must carry the device-px snap exactly
      setWaveMode('off') // class drops on React's commit — --wave-x is already in place
      // This load's coast is over — the next load must never adopt its clock. Sibling surfaces
      // finishing moments later already hold the resolved values in their own refs.
      if (loadCoast && timelineNow() - loadCoast.t0 > (phone ? 1900 : 2400)) loadCoast = null
      // The waves are at REST, and the load choreography keys on this: Edit.tsx drops the shell and
      // TiptapEditor uncovers in listeners of THIS dispatch, so React batches all three into ONE
      // commit and no frame ever shows a mid-motion swap.
      window.dispatchEvent(new Event('inkwave:wave-rest'))
    }
    // Provisional cap until the anchor lands (covers exotic states where no frame ever runs).
    let cap = setTimeout(finish, (phone ? 2000 : 2500) + ANCHOR_SLACK_MS + 1200)

    // ⚠ BRAKES ARE BORN CSS-PAUSED AND STARTED AT A FORWARD ANCHOR (t_a = now + slack, on the
    // TIMELINE clock). Engines resolve a pending CSS animation at STYLE time, so a brake started
    // "now" presents a cancellation computed for a pose N frames ago — a backward step
    // proportional to the commit lag. Compute the drift pose at t_a analytically from the drift's
    // own startTime, snap to a device pixel, inject the final keyframes, and start EVERY coast
    // animation on both surfaces at exactly t_a: continuous by construction however starved the
    // main thread was, and every copy on one clock. → docs/archive/editor-surface.md#scroll-forward-anchor
    const coastAnims = () => {
      try {
        return el.getAnimations({ subtree: true }).filter((a) => {
          const n = (a as CSSAnimation).animationName ?? ''
          return n === 'iw-wave-coast-l' || n === 'iw-wave-coast-r'
        })
      } catch { return [] }
    }
    const schedule = (t0: number) => {
      const T = phone ? 2000 : 2500
      clearTimeout(cap)
      cap = setTimeout(finish, Math.max(0, t0 + T + 80 - timelineNow()))
    }
    const anchor = () => {
      if (cancelled || waveModeRef.current !== 'coast') return
      const sc = loadCoast
      if (!sc) return
      let tA = sc.resolvedT0
      if (tA == null) {
        tA = timelineNow() + ANCHOR_SLACK_MS
        // The drift pose at t_a, from the drift's own clock — shared across surfaces by the
        // sticky sibling adopt.
        let tx0 = 0
        try {
          const drift = el.getAnimations({ subtree: true })
            .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
          if (typeof drift?.startTime === 'number')
            tx0 = -140 * ((((tA - (drift.startTime as number)) / 1000) % 1.944) / 1.944)
        } catch { /* pose unreadable — coast lands within a tile of true */ }
        const dpr = window.devicePixelRatio || 1
        const end = Math.round((tx0 - sc.d) * dpr) / dpr // rest pose on an integer device pixel
        sc.resolvedT0 = tA
        sc.d = tx0 - end
        sc.end = end
        injectAdditiveCoastFrames(phone, sc.d) // final keyframes, before the brake ever plays
      }
      coastT0Ref.current = tA
      coastEndRef.current = sc.end
      for (const a of coastAnims()) {
        // `play()` FIRST — it marks the WAAPI override, so the CSS paused declaration can never
        // re-pause on a later recalc — then the explicit startTime sets the shared clock.
        try { a.play(); a.startTime = tA } catch { /* detached — a mode change owns it */ }
      }
      schedule(tA)
    }
    requestAnimationFrame(() => anchor())
    return () => { cancelled = true; clearTimeout(cap) }
  }, [waveMode, phone])

  // Scrollbar idle-fade (desktop fill only): the thumb shows while scrolling or near the right
  // edge and fades after 1.4s, so at rest only the waves remain in the channel.
  // ⚠ ARMED ONLY AFTER THE LOAD WAVES REST: each toggle runs a 0.3s scrollbar-color transition,
  // and Firefox repaints the WHOLE scroller for it — landing during the drift, that read as a
  // jump in the wave. → docs/archive/editor-surface.md#scroll-chrome
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

  // Deterministic water marks (see waveTwinkle.ts + waveSceneData.ts). The complete checked-in scene
  // mounts synchronously into this stable host before the atomic gate opens; no art decode, runtime
  // RNG, or server feed exists. Intro objects have one finite opacity window. The overlapping desktop
  // scroll population is driven later by absolute scrollTop; phone has no marks once water rests.
  const twinkleRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = twinkleRef.current
    if (!host || !fill) return
    // ⚠ PHONE + covered: do NOT call syncTwinkles AT ALL. `waterMode` is GLOBAL, so this surface's
    // early drop to 'off' would clobber the shell's live coast for every host; the shell owns the
    // water until wave-rest.
    if (phone && covered) return
    // The two fields use the SAME named drift/brake CSS animations as the tiles. Scroll's sibling
    // adoption and forward coast anchor therefore include them automatically.
    const holdingAtRest = loadingTwinkles && waveMode === 'off'
    syncTwinkles(host, {
      sparks: waveMode !== 'off' || holdingAtRest,
      dashes: waveMode !== 'off' || (!phone && !holdingAtRest),
      mode: waveMode,
      phone,
      hold: holdingAtRest,
    })
    // covered IS a dep: the phone editor skips sync while covered (above), so the uncover at
    // wave-rest must run one sync — it carries the global twinkle mode to 'off' (the shell
    // unmounts in the same commit, so its own 'off' sync never runs) and parks the driver.
  }, [fill, phone, waveMode, covered, loadingTwinkles])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}${phone && covered ? '' : waveMode === 'anim' ? ' iw-wave-anim' : waveMode === 'coast' ? ' iw-wave-coast' : ''}${covered ? ' iw-wave-covered' : ''}`}
      style={{
        '--iw-editor-zoom': editorZoom,
        // The shell's atomic reveal: fade the whole covering surface out over the LAST 0.5s of the
        // wave S-decay — doc, text and pills fade in together underneath, over coasting waves.
        ...(fadingOut ? { opacity: 0, transition: `opacity ${phone ? 0.8 : 1}s cubic-bezier(0.4, 0, 0.2, 1)`, pointerEvents: 'none' as const } : null),
      } as React.CSSProperties}>
      {/* Stable host for the complete checked-in mark scene. It is populated synchronously in the
          layout effect above and remains a pure visual layer. */}
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
            // one source of truth for document paper. Applications own a stable pixel width and
            // their shared inner wrapper transform-fits that layout when the window is too narrow.
            return presentedPaperWidth(presentation, paperCssSize(ps, getOrientation()).width)
          })(),
          // box-shadow (not filter: drop-shadow) so the absolutely-positioned cycle card
          // rendered inside doesn't feed its pixels into the shadow — drop-shadow re-rasterises
          // the whole parchment on every reel frame.
          borderRadius: phone || application ? 0 : '8px',
          boxShadow: phone || gapped || application ? 'none' : '0 8px 32px rgba(80,50,10,0.22), 0 2px 6px rgba(80,50,10,0.18)',
          // One-paint load: hide the entire parchment (waves only) until the editor settles, then
          // fade page + text in together. visibility (not display) keeps layout + font/pagination
          // measurement running underneath.
          // PHONE: 0.5s (Peter, 2026-07-09) — the full-screen paper fades IN over the editor's own
          // still-coasting water (the shell drops instantly at reveal there — see Edit.tsx), so
          // the waves stay fully visible, drifting and decaying, while the page materialises;
          // the fade lands at 2.0s, the moment the waves reach rest.
          visibility: revealed ? 'visible' : 'hidden',
          opacity: revealed ? 1 : 0,
          transition: `opacity ${phone ? 560 : 700}ms cubic-bezier(0.4, 0, 0.2, 1)`, // 30% shorter: 0.56s phone / 0.7s desktop
        }}
      >
        {/* Paper body. The side padding is the text margin: a roomy fixed margin on DESKTOP (driven
            by device type, not the viewport breakpoint, so browser zoom never collapses it); a slim
            one on phones where screen real estate is tight. */}
        <div
          ref={sheetRef}
          className={application ? 'scroll-paper relative iw-application-paper' : 'scroll-paper relative pt-8 pb-24'}
          style={{
            borderRadius: phone || application ? 0 : '8px',
            paddingLeft:  application ? 0 : phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingRight: application ? 0 : phone ? '1.25rem' : `${sideMarginPx}px`,
            paddingTop:   application ? 0 : `${topMarginPx}px`,
            paddingBottom:application ? 0 : `${btmMarginPx}px`,
            '--iw-page-side-margin': phone ? '1.25rem' : `${sideMarginPx}px`,
            '--iw-page-top-margin': `${topMarginPx}px`,
            '--iw-page-bottom-margin': `${btmMarginPx}px`,
            '--iw-page-height': phone || getPaperSize() === 'scroll'
              ? '100dvh'
              : paperCssSize(getPaperSize() === 'letter' ? 'letter' : 'a4', getOrientation()).height,
            '--para-spacing': `${paraSpacingEm}em`,
          } as React.CSSProperties}
        >
          {!application && <PageGuides sheetRef={sheetRef} />}
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
      // The magnify wrapper: its width starts as the paper's own mm value (layout identical to
      // master at scale 1) and is imperatively switched to pageWidth·s while magnified; height is
      // ONLY ever set imperatively, so React never fights the RO's writes.
      // ⚠ RENDERED FOR EVERY `fill` SURFACE, hybrid or not. The prerendered shell is built
      // desktop-side, so gating this div on `hybrid` made a phone's first client render
      // STRUCTURALLY different from the server HTML: hydration failed, React re-rendered <html>
      // from scratch, stripped .iw-water-ready + data-theme, and the whole load choreography died.
      // Structure is a constant of `fill`; hybrid drives only styling.
      // → docs/archive/editor-surface.md#scroll-magnify
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

// Page guides (ungapped mode): a faint dashed rule + page number at each page BREAK, read from the
// pagination extension's own zero-size break markers — the SAME line-measured breaks gapped mode
// uses — so toggling the gapped switch never moves content across pages and the on-screen breaks
// are the print/PDF breaks. Falls back to the uniform canonical model where no markers exist.
// → docs/archive/editor-surface.md#scroll-guides
function PageGuides({ sheetRef }: { sheetRef: RefObject<HTMLDivElement> }) {
  // ⚠ RESOLVE THE SHEET FROM OUR OWN REF's `parentElement`, never from `sheetRef`. React attaches
  // host refs bottom-up during commit, so a CHILD's layout effect runs BEFORE the parent's ref is
  // attached — `sheetRef.current` was null in production and the guides never rendered. StrictMode
  // masks it in dev by re-running effects after the ref attaches.
  const overlayRef = useRef<HTMLDivElement>(null)
  const [breaks, setBreaks] = useState<number[]>([]) // sheet-local y of each page boundary
  // The guides read client-only state (localStorage), so gate on a post-mount flag: the FIRST
  // client render must match the prerendered shell (nothing), and the guides fill in a tick later.
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
          <div style={{ borderTop: '1px dashed rgba(48, 36, 56, 0.45)' }} />
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
