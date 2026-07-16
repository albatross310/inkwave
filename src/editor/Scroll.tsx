import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gappedPagesEnabled } from './pageView'
import { getSideMarginPx, getTopMarginPx, getBtmMarginPx, getParaSpacingEm, getColumns, getPaperSize, getOrientation, MARGIN_BOTTOM } from './pageSettings'
import { pageBoxPx, paperCssSize } from './pageModel'
import { syncPrintPageStyle } from './printPageStyle'
import { getMagnify, setUserMagnify, persistMagnify, setFitContext, subscribe as subscribeMagnify, scaleFor, MIN_MAGNIFY, WATER_MARGIN_PX } from './magnify'
import { stepToZoom, zoomToStep, ZOOM_STEP_RATIO } from './zoomStep'
import { isWaterAtX, createZoomLatch } from './zoomZone'
import { notePerf, probePerf } from './perflog'
import { syncTwinkles, reportSway, swayFields } from './waveTwinkle'

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

// ─── The S-curve slow down — an ADDITIVE BRAKE over the never-stopped drift ──────────────────
// The load unit's deceleration (Peter's spec, 2026-07-11): the drift animation is never stopped;
// SETTLE adds a second animation composited with `animation-composition: add` whose value starts
// at 0 with zero initial velocity — the handoff is continuous BY CONSTRUCTION whenever the
// commit lands, however starved the main thread is. After the coast time T a linear hold cancels
// the drift exactly, so the TOTAL pose is static until the rest handoff, however late its commit
// lands. The twinkle fields ride the SAME injected keyframes via CSS (index.css), so every layer
// decelerates in lockstep. ONE COAST PER LOAD: every surface (shell + editor) swaps class in the
// same event dispatch and shares the injected keyframes + the resolved clock.
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
}
const timelineNow = (): number => {
  const t = typeof document !== 'undefined' ? (document.timeline?.currentTime as number | null) : null
  return t ?? performance.now()
}

// ─── Load watchdog — the ONE backstop (replaces the old per-stage fallback caps) ─────────────
// Playback is compositor-only and the rest handoff is a resolved-clock timer, so on any healthy
// load the whole chain always completes; the only way it cannot is SETTLE never arriving (the
// document never became ready) or the page's timers being dead. If a load is still drifting
// WATCHDOG_MS after it began, LOG loudly and force the chain: start the coast and dispatch
// 'inkwave:load-watchdog' (Edit.tsx force-drops the shell; TiptapEditor force-lifts `covered`).
// 30s ≫ any healthy load (worst measured cold 20MB open ≈ 12s) — it must never fire on one.
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

// Inject the brake keyframes (literal px — var()-dependent keyframes can't composite).
// ZERO-JERK S-CURVE (2026-07-11 live-tick round): total velocity = −v·(1 − smoothstep(τ)) — the
// water holds full speed with ZERO initial deceleration, eases into the slowdown, and lands with
// zero end velocity: a true S-curve slow down (Peter's spec), and any residual anchor lag ε now
// costs add(ε) ∝ ε³ (sub-pixel even at hundreds of ms) instead of ∝ ε². add(τ) = vT(τ³ − τ⁴/2),
// d = vT/2 (90px desktop / 72px phone), sampled as ~24 linear segments (max deviation from the
// true quartic ≈ 0.06px); after T a linear hold at +v cancels the still-running drift exactly.
// Direction: coast-l opposes drift-l (positive), coast-r mirrored. The twinkle fields' CSS brake
// uses these SAME keyframe names, so one injection drives every layer in lockstep.
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
      // NB: NO holdWavesFor here (2026-07-14 sway-freeze fix). This RO fires on EVERY paper resize
      // (pagination, typing reflow, the box.height write's own relayout) — open-ended, unlike a
      // bounded zoom gesture. Arming a 250ms wave-hold per fire meant that whenever the paper
      // resizes more often than every 250ms at s≠1 (fit-cap bound on a narrow window / PDF panel
      // open / persisted magnify≠1), the hold never lapsed and the scroll sway froze permanently
      // (Peter's live "waves don't wave when scrolling"). Zoom-induced clamps are ALREADY held by
      // the gesture path (holdWavesFor 350 per step + 800 at settle); a clamp from an ordinary
      // reflow is genuine content motion the sway SHOULD follow. Just track the height.
      if (s !== 1 && box && paper) box.style.height = `${paper.offsetHeight * s}px`
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
  // The ref is the AUTHORITATIVE live zoom; React state only trails it (the settle's catch-up
  // setEditorZoom). Do NOT re-assign the ref from state on render — any re-render landing
  // MID-GESTURE (reveal chain, panel updates) reset it to the stale state and the next commit
  // stepped from zoom 1: a visible multi-step snap-back (probed: a −9-step jump mid-pinch).
  const editorZoomRef = useRef(editorZoom)
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
      // The zoom guard discriminates OUR writes from user scrolls (rebase vs pin): record every
      // write's clamped result so commit/exit corrections never read as user scrolls — the guard
      // was rebasing its pin onto relevancy-wave displacement whenever a commit's correction
      // landed between its ticks (probed: 11 rebases vs 3 pins over one wheel session).
      guardScrollTop = getScrollTop()
    }
    const scrollRange = () => {
      if (!phone) return Math.max(1, el.scrollHeight - el.clientHeight)
      const se = document.scrollingElement || document.documentElement
      return Math.max(1, se.scrollHeight - window.innerHeight)
    }
    // Pinch state (phone): the gesture-START midpoint picks the anchor; holding it and correcting
    // by its actual displacement keeps the pinched-on text stationary for the whole gesture (the
    // same held-anchor rule as the wheel path, midpoint instead of viewport centre).
    let pinchDist = 0
    let pinchX = 0, pinchY = 0
    // One STABLE anchor per gesture — a TEXT POSITION (caret range), not a block top. Re-picking
    // under the viewport centre every frame made the anchor flip between elements at block
    // boundaries (drift toward the doc top in both directions — fixed 2026-07-09 by holding one
    // element per gesture). But holding a BLOCK's TOP was still too coarse (Peter, 2026-07-11:
    // "phone screen doesn't stay in fixed scroll position when zooming"): a font-zoom step scales a
    // paragraph's height ≈ zoom² (line count × line height), so text N px into the block slides to
    // N·zoom² while the block top sits perfectly pinned — on a phone one paragraph can exceed the
    // screen, so the pinched-on words sailed off by hundreds of px (measured: 1300px over one
    // gesture at the lattice cap). The anchor is now the CARET position at the pinch midpoint /
    // cursor (caretRangeFromPoint), whose line-box rect tracks the exact content through any
    // reflow; the block element is kept for connectivity checks and as the fallback when no text
    // caret resolves (margins, gaps, empty paragraphs).
    let anchorEl: HTMLElement | null = null
    let anchorNode: Node | null = null // text node of the caret anchor (null → block-top fallback)
    let anchorOff = 0
    let anchorTop0 = 0 // the anchor's viewport top when picked — the gesture's PIN position
    // Viewport top of a held anchor: the caret's line-box top when the text position is alive,
    // else the block top, else null (both dead → caller falls back to the ratio correction).
    // A skipped block (content-visibility mid-gesture) yields a degenerate 0×0 caret rect at the
    // origin — fall through to the block-top placeholder box rather than trust it.
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
    // Resolve the content anchor at (x, y). Preferred: the CARET text position under the point
    // (caretRangeFromPoint / caretPositionFromPoint), validated to sit in real editor text.
    // Fallback: the old block probe — reject the big containers (.ProseMirror / .scroll-paper —
    // they span the whole doc, so their top reflows toward the doc top and a correction against
    // them lurches — the old "jump to top" bug) and the PAGE-GAP widgets/sheet chrome (their
    // heights are pinned px that do NOT reflow with the font — the "funky near page gaps" bug).
    // When the point falls in a gap/margin, probe outward until real text is found.
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
        // STRICT pass: refuse blocks SPLIT by a page gap (a mid-paragraph break nests the fixed-px
        // gap widget inside the block). Such a block's rect straddles the boundary, so as the text
        // redistributes across it the top↔gap relationship warps and successive frame corrections
        // alternate direction — the boundary-zoom flicker. Prefer a block fully inside one page.
        if (strict && t.querySelector('.inkwave-page-gap')) return null
        return t
      }
      // Probe the point first, then alternate above/below in growing steps — finds the nearest
      // text block when the midline sits in a page gap. Two passes: strict (whole block inside
      // one page), then lenient (a split block still beats the no-anchor ratio fallback).
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
      // GESTURE REBASE (Peter, 2026-07-11: "if it has to load, it has to measure the zoom from
      // when it starts working, not the finger width at the start — so there's not a big jump"):
      // when the main thread is busy at gesture start (a previous settle's relayout, a SCAS tick),
      // the queued touchmoves burst in together and the whole backlog would commit as one
      // multi-step leap (then the next frames replay the rest — Peter's "multiple jumps"). The
      // FIRST responsive frame of a pinch instead DISCARDS the backlog and takes the current
      // finger spread as the gesture's baseline (pinchDist already tracks it — every queued move
      // updated it), so zoom follows finger movement from the moment the pipeline actually
      // responds. Costs at most one frame's worth of spread on a responsive start.
      if (!gestureRebased) { gestureRebased = true; steps = 0 }
      const net = Math.trunc(steps) // commit whole lattice steps; the fractional remainder carries
      steps -= net
      const vr = el.getBoundingClientRect()
      const anchorX = phone ? pinchX : vr.left + vr.width / 2
      const anchorY = phone ? pinchY : vr.top + vr.height / 2
      // No step committed this frame → nothing to apply. Between-commit drift (native pan on
      // phone, content-visibility relevancy waves on both platforms) is owned by the zoom GUARD
      // loop (guardTick below), which runs every frame while the live window is up.
      if (!net) return
      // Pick (or re-pick, if the node was destroyed) the content anchor under the pinch midpoint /
      // viewport centre (phone picks at touchstart; this is the desktop first-commit pick and the
      // dead-anchor re-pick).
      if (!anchorEl || !anchorEl.isConnected) pickAnchor(anchorX, anchorY)
      const keepLeft = el.scrollLeft // desktop only; the phone helper pins window.scrollX itself
      const ratio = getScrollTop() / scrollRange()
      const topBefore = anchorTop() ?? 0 // at the CURRENT size
      // LATTICE COMMIT: level = 1.08^step exactly (same 8%-per-notch feel as the old multiply, but
      // every reachable level is a shared lattice point the pagination step cache can precompute).
      const stepNext = zoomToStep(editorZoomRef.current) + net // zoomToStep clamps; re-clamped inside stepToZoom
      const next = stepToZoom(stepNext)
      if (next === editorZoomRef.current) return // pinned at a lattice bound — nothing to apply
      const commitT0 = performance.now() // perflog zoom-commit: reflow + anchor + bands, this task
      // Pin pagination's RO-driven painters for the whole gesture (per-frame LIVE repositioning
      // lagged the reflowing text 1–2 frames — the page-boundary up/down flicker). The step cache
      // below replaces live repositioning with instant precomputed geometry; the RO path stays
      // gated as the cache-MISS fallback. Cleared in the settle, right before zoom-settled.
      ;(window as unknown as { __iwZoomHold?: boolean }).__iwZoomHold = true
      // Lazy off-screen (both platforms): the live-reflow window makes each step lay out ~one
      // screenful. BOTH enter on the first committed step (2026-07-11 — phone used to enter at
      // touchstart, which forced a full placeholder-switch relayout inside the touchstart task
      // and a second reflow at the first commit; entering here folds the switch into the commit's
      // one forced layout below). Both exit in the settle.
      enterZoomLive()
      el.style.setProperty('--iw-editor-zoom', String(next)) // apply now → text reflows
      // Skipped-placeholder heights track the committed zoom (see enterZoomLive) — same recalc.
      if (zoomLiveEd) el.style.setProperty('--iw-cis-scale', ((next / zoomLiveZ0) ** 2).toFixed(4))
      // Hybrid at magnify ≠ 1: the reflow changed the paper's height, and the wrapper box must
      // track it SYNCHRONOUSLY (its RO fires later this frame) or the scroll-range clamp below
      // could bite against the stale height near the document end. One offsetHeight read in a
      // frame that's about to force layout anyway.
      const mag = getMagnify()
      if (mag !== 1 && magnifyBoxRef.current && paperElRef.current)
        magnifyBoxRef.current.style.height = `${paperElRef.current.offsetHeight * mag}px`
      // ONE forced layout for the whole frame (2026-07-11 first-response cost): placeholder
      // switch + font reflow + wrapper sync all land in this single anchor read.
      const topAfter = anchorTop()
      // PREDICTIVE STEP CACHE: tell the paginator which lattice step just committed — AFTER the
      // anchor read, so a cache MISS's band measure rides the layout just forced above (a hit is
      // pure style writes that batch into this frame's paint; the panels still move WITH the
      // text). The surface is included so the SnapshotView's zoom (its own Scroll dispatches too)
      // can never drive the live editor's panels. Dispatched before the scroll correction below —
      // applyBands' sheet min-height write must precede the scroll write or the range could clamp.
      window.dispatchEvent(new CustomEvent('inkwave:zoom-step', { detail: { step: zoomToStep(next), surface: el, z0: zoomLiveZ0 } }))
      if (topAfter != null) {
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
      notePerf('zoom-commit', performance.now() - commitT0)
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
    let gestureRebased = true // false between a pinch's touchstart and its first responsive frame
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
    let zoomLiveStyle: HTMLStyleElement | null = null
    let zoomLiveZ0 = 1 // zoom at live-window entry — the placeholder rules' height baseline
    // The arith exit leaves the content-visibility window ON at rest (exactly sized) instead of
    // paying the O(doc) un-skip — see exitZoomLive. Tracked so the next entry re-arms the guard and
    // replaces the stylesheet, and so the unmount teardown still hard-clears the class.
    let zoomLiveResting = false
    const arithBandsOn = (): boolean => {
      try { return typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:arithBands') === '1' } catch { return false }
    }
    // ── ZOOM GUARD (round-3 flicker, 2026-07-12): the live window's placeholder regime is only
    // piecewise-consistent AT commit instants — the browser re-evaluates content-visibility
    // RELEVANCY asynchronously between frames, and each wave (skipped↔rendered swaps, heights
    // start-zoom vs current-zoom) shifts the layout with NO handler running: the text moved but
    // the pin and the band/panel geometry were commit-time — measured 93-546px of band/text
    // desync lasting until the next commit ("text flows over gap", "page joins gap"). While the
    // live window is up, this rAF loop re-pins the anchor and re-syncs the bands the frame a
    // wave lands. A DESKTOP scrollTop change between commits is a genuine user scroll (wheel
    // without ctrl) — accept it (rebase the pin); on PHONE fingers are down, so any scroll not
    // ours is a native pan that survived suppression — fight it (pin), the round-2 rule.
    let guardRaf = 0
    let guardScrollTop = 0
    // Shared across Scroll instances (the loading shell's instance would otherwise shadow the
    // live editor's counters) — debug/probe only.
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
      // below reads a placeholder (no content layout) and the doc is never un-skipped. The old
      // exact stylesheet is replaced by the fresh baseline the rules below generate.
      zoomLiveResting = false
      zoomLiveStyle?.remove()
      zoomLiveStyle = null
      // EXACT per-block placeholder heights, via ONE generated stylesheet — :nth-child rules,
      // NEVER inline styles on PM-owned nodes (PM's DOM observer rebuilds touched blocks and the
      // gesture dies on the detached touch target — the original --iw-cis lesson). Exactness
      // matters (2026-07-12): a flat mean placeholder shifted off-screen geometry by Σ(real−mean),
      // so the entry needed a huge compensating scroll (~5,000px at the doc bottom) which DRAGGED
      // the content-visibility relevancy set across the doc — and WebKit's async relevancy
      // relayout landed AFTER that frame's pin correction: one painted frame with the pinched
      // text ~2,400px off (deterministic at the document bottom). Height-identical placeholders
      // make the switch geometry-neutral at the current zoom — no compensating scroll, no
      // relevancy drag, no second-wave jump. --iw-cis stays as the fallback for any child beyond
      // these rules; the :nth-child specificity beats the base `> *` rule in index.css.
      // Placeholders TRACK the zoom (2026-07-12, the residual single-frame blips): a multiline
      // block's height ≈ lines·lineHeight ∝ zoom² (both factors scale), so frozen gesture-start
      // heights diverge from rendered blocks as the gesture moves — every relevancy swap then
      // jumped by (z/z0)²−1 of the block (probed: 90-450px single-frame blips at commits). Each
      // rule multiplies the measured height by --iw-cis-scale = (zoom/z0)², written next to the
      // zoom var each commit (same style recalc — zero extra invalidation), so swap deltas drop
      // to line-quantization noise.
      const kids = Array.from(ed.children) as HTMLElement[]
      let css = ''
      let sum = 0
      for (let i = 0; i < kids.length; i++) {
        const h = kids[i].offsetHeight
        sum += h
        css += `.ProseMirror.iw-zoom-live>:nth-child(${i + 1}){contain-intrinsic-size:auto calc(${h}px*var(--iw-cis-scale,1))}\n`
      }
      zoomLiveZ0 = editorZoomRef.current
      // No entry bracket (2026-07-11): the ONLY caller is applyFrame's commit path, immediately
      // before the zoom var write — the (geometry-neutral) switch and the font reflow land in ONE
      // forced layout (the anchor read that follows), and the pin correction against anchorTop0
      // absorbs the frame's whole displacement. The old touchstart-time entry paid a separate
      // full bracketed relayout inside the touchstart task (gesture-start lag).
      zoomLiveStyle = document.createElement('style')
      zoomLiveStyle.textContent = css
      document.head.appendChild(zoomLiveStyle)
      ed.style.setProperty('--iw-cis', `${Math.max(24, Math.round(sum / kids.length))}px`)
      ed.classList.add('iw-zoom-live')
      zoomLiveEd = ed
      guardScrollTop = getScrollTop()
      if (!guardRaf) guardRaf = requestAnimationFrame(guardTick)
    }
    const exitZoomLive = () => {
      const ed = zoomLiveEd
      if (!ed) return
      const exitT0 = performance.now() // perflog zoom-exit: un-skip relayout + atomic band re-derive
      zoomLiveEd = null
      if (guardRaf) { cancelAnimationFrame(guardRaf); guardRaf = 0 }
      // ── ARITH EXIT (flag inkwave:arithBands) ────────────────────────────────────────────────
      // The un-skip below is O(doc): dropping content-visibility invalidates every block and the
      // anchor read then forces the whole document's layout (240/722/2688ms at 5k/20k/40k words).
      // Ask the paginator instead: if the doc is arith-eligible it computes the bands AND every
      // block's exact render height with NO layout read. Then the window STAYS ON with exact
      // reservations — only the on-screen blocks lay out — and the exit is O(visible). The bands
      // are applied inside the dispatch, so they still land in THIS task, atomic with the pin.
      if (arithBandsOn()) {
        const ax: { surface: Element; ok?: boolean; blockHeights?: number[]; why?: string } = { surface: el }
        window.dispatchEvent(new CustomEvent('inkwave:arith-exit', { detail: ax }))
        ;(window as unknown as { __iwArithExit?: unknown }).__iwArithExit = { ok: !!ax.ok, why: ax.why, n: ax.blockHeights?.length }
        if (ax.ok && ax.blockHeights) {
          // Exact per-block reservations ⇒ the uniform gesture-scale approximation retires. Blocks
          // already rendered keep their remembered size (the rules' `auto` leg); gap widgets carry
          // their own fixed inline height, read from the style attribute (no layout).
          const heights = ax.blockHeights
          const kids = Array.from(ed.children) as HTMLElement[]
          let bi = 0
          let css = ''
          for (let i = 0; i < kids.length; i++) {
            const isGap = kids[i].classList.contains('inkwave-page-gap')
            const h = isGap ? parseFloat(kids[i].style.height) || 0 : heights[bi++]
            if (h > 0) css += `.ProseMirror.iw-zoom-live>:nth-child(${i + 1}){contain-intrinsic-size:auto ${h}px}\n`
          }
          if (zoomLiveStyle) zoomLiveStyle.textContent = css
          el.style.removeProperty('--iw-cis-scale')
          zoomLiveResting = true // window stays on — the REST regime, exactly sized (zoomLiveEd null
                                 // so the next gesture's enterZoomLive re-arms guard + baseline)
          const after = anchorTop() // O(visible): skipped blocks answer from the exact reservations
          if (after != null) setScrollTop(getScrollTop() + (after - anchorTop0))
          notePerf('zoom-exit-arith', performance.now() - exitT0); probePerf('zoom-exit-arith', performance.now() - exitT0)
          return
        }
      }
      // Re-anchoring bracket: skipped blocks held their gesture-START heights; un-skipping lays
      // them out at the committed zoom, displacing everything below — pin the held content anchor
      // back to its gesture-start viewport top in the same task so the anchored text never jumps.
      ed.classList.remove('iw-zoom-live')
      ed.style.removeProperty('--iw-cis')
      el.style.removeProperty('--iw-cis-scale')
      zoomLiveStyle?.remove()
      zoomLiveStyle = null
      const after = anchorTop() // forces the full relayout now, pre-paint
      // ATOMIC EXIT (round-3 flicker): the un-skip relayout must never paint under the
      // placeholder-era panels — that window (exit → settle recompute → paint, 2 rAFs + a forced
      // measure) showed 779-1170px of band/text desync for ~180ms at EVERY settle. Re-derive the
      // band geometry from the full layout in this same task: the class is off, so onZoomStep
      // routes to the full-regime stepCache (hit = pure writes; miss = one band read riding the
      // layout the anchor read just forced). Dispatched BEFORE the scroll write so applyBands'
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
      // Fresh gesture → anchor the TEXT POSITION under THIS midpoint, from the pre-gesture
      // layout (before the live window's placeholder switch), so the pin holds exactly what the
      // fingers grabbed for the whole gesture. This hit-test is the touchstart task's ONLY
      // layout-touching work — the live window enters lazily at the first commit (applyFrame).
      pickAnchor(pinchX, pinchY)
      // Hold from the FIRST touch (not the first commit): a queued SCAS tick landing mid-pinch
      // rebuilds the touched paragraph and the gesture dies on the detached node (iOS dispatches
      // a pinch's touchmoves to the ORIGINAL target). Cleared by the settle, or at touchend on a
      // gesture that never commits.
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
      if (zoomLiveResting) { // the arith exit rests the window ON — tear it down for real here
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
    const writeWave = () => {
      // ONE rounded value for both consumers: the surface var (wave pseudos) and the twinkle
      // fields' literal transforms (swayFields — no var inheritance into the instance leaves;
      // see the --wave-x firebreak block in index.css).
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
  // SIBLING CLOCK ADOPT (the one cross-surface sync the tiles need). Two overlapping surfaces
  // (the loading shell + the editor beneath it) each carry their own CSS drift; a surface that
  // mounts MID-LOAD starts its animation at its own recalc, out of phase with the shell's — the
  // reveal cross-fade would smear two offset copies (the 2026-07-09 ~10px hiccup). Adopting the
  // sibling's literal startTime makes every copy pixel-identical by construction. Surfaces that
  // mount BEFORE the atomic gate opens have no animations at all — then every copy is born in
  // the same gate recalc and is identical without any adoption. useLayoutEffect: the adopt must
  // land before this surface's first paint. Also arms the load watchdog (disarmed at rest).
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el || !startedHiddenRef.current) return
    armLoadWatchdog()
    driftSurfaces.add(el)
    let sibling: number | null = null
    for (const s of driftSurfaces) {
      if (s === el || !s.isConnected) continue
      try {
        const a = s.getAnimations({ subtree: true })
          .find((x) => (x as CSSAnimation).animationName === 'iw-wave-drift-l')
        if (typeof a?.startTime === 'number') { sibling = a.startTime as number; break }
      } catch { /* getAnimations unavailable */ }
    }
    if (sibling != null) {
      const sib = sibling
      try {
        for (const a of el.getAnimations({ subtree: true })) {
          const n = (a as CSSAnimation).animationName ?? ''
          if (n === 'iw-wave-drift-l' || n === 'iw-wave-drift-r') {
            try { a.startTime = sib } catch { /* pending write below re-asserts */ }
            // STICKY (2026-07-11 live tick/doubling round): a write to a PLAY-PENDING CSS
            // animation is CLOBBERED when the pending start resolves (measured: the covered
            // editor kept its own natural start, 33ms-500ms out of phase with the shell —
            // doubled lines through the reveal fade and marks off their crests after it).
            // Re-assert at ready, when the write sticks.
            void a.ready.then(() => { try { if (a.startTime !== sib) a.startTime = sib } catch { /* detached */ } }).catch(() => { /* cancelled */ })
          }
        }
      } catch { /* getAnimations unavailable */ }
    }
    return () => {
      driftSurfaces.delete(el)
      // The last drifting surface unmounting (the desktop /snapshot veil fades out mid-coast and
      // takes its animations with it) ends the choreography — there is no chain left to watch.
      if (driftSurfaces.size === 0) disarmLoadWatchdog()
    }
  }, [])
  // Two effects, deliberately: the settle (switch class) must not share an effect with the
  // handoff — setWaveMode('coast') inside a [waveMode]-dep effect re-ran the effect and its
  // CLEANUP tore down the just-armed listeners, leaving .iw-wave-coast stuck forever.
  // SETTLE → coast. The drift is never stopped: the brake is added on top (see the module
  // header), so there is nothing to freeze and no clock to compensate — shared by the desktop
  // trigger (revealed, below) and the 'inkwave:reveal-imminent' event. ONE coast per load: every
  // surface adopts the same record (injected keyframes + resolved clock + snapped travel).
  const coastT0Ref = useRef(0)
  const coastEndRef = useRef<number | null>(null) // device-pixel-snapped coast end offset (see below)
  const settleToCoast = () => {
    const el = surfaceRef.current
    if (!el) { setWaveMode('off'); return }
    // PHONE + covered: this surface renders NO wave classes (see the className) — the SHELL owns
    // the only water, and a class-less surface has nothing to coast. Drop straight to rest.
    if (phone && covered) { setWaveMode('off'); return }
    // No animation-composition (pre-2023 engines): no brake possible — stop cleanly instead.
    // Read the drift pose from the animation clock, hand it to the sway, done. A hard stop, not
    // a coast; acceptable degrade on engines none of our targets ship.
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
  // SETTLE arrives as 'inkwave:reveal-imminent' (TiptapEditor's gate; LoadingVeil's ready). The
  // brake starts on that light frame, ahead of the heavy reveal commit — and because it is
  // additive with zero start velocity, a starved commit cannot make the handoff discontinuous
  // anyway. Every drifting surface listens — the visible loading SHELL (revealed never flips
  // there; it unmounts at/after the reveal) and the editor's own surface underneath coast in
  // lockstep (same adopted clock, same injected keyframes), so the shell swap is seamless.
  useEffect(() => {
    if (waveMode !== 'anim') return
    const onImminent = () => settleToCoast()
    window.addEventListener('inkwave:reveal-imminent', onImminent)
    return () => window.removeEventListener('inkwave:reveal-imminent', onImminent)
  }, [waveMode]) // eslint-disable-line react-hooks/exhaustive-deps
  // Coast END → sway handoff. The deceleration itself is pure CSS (drift + brake); JS wakes only
  // at the resolved-clock timer to hand over: the snapped rest offset is written into --wave-x in
  // the same commit the coast class drops. Because the coast geometry's ±280px overdraw is
  // exactly two 140px tiles, transform +tx ≡ background-position +tx — dropping the class while
  // setting --wave-x = txFinal paints identical pixels: no snap, no dead frame, and the sway then
  // continues from that offset (base = txFinal − scrollTop·WAVE_SWAY, rebased here).
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
      // On phone the waves cease to exist the moment the classes drop (parchment surface,
      // ::before display:none), so the sway base/--wave-x write is inert there — kept
      // unconditional for one code path.
      // The coast ends on a device-pixel-SNAPPED offset (coastEndRef) — the --wave-x handoff
      // must write that same number or the bg-position repaint shifts sub-pixel.
      const txFinal = coastEndRef.current ?? loadCoast?.end ?? -(phone ? 72 : 90)
      waveBaseRef.current = txFinal - el.scrollTop * WAVE_SWAY
      el.style.setProperty('--wave-x', `${txFinal.toFixed(3)}px`) // 3 decimals — must carry the device-px snap exactly
      setWaveMode('off') // class drops on React's commit — --wave-x is already in place
      // This load's coast is over — the next load must never adopt its clock. (Sibling surfaces
      // finishing moments later already carry the resolved values in their own refs.)
      if (loadCoast && timelineNow() - loadCoast.t0 > (phone ? 1900 : 2400)) loadCoast = null
      // The waves are at REST — the load choreography keys on this (Edit.tsx drops the shell +
      // TiptapEditor uncovers the editor's water in listeners of this same dispatch, so React
      // batches all three into ONE commit: no frame ever shows a mid-motion swap).
      window.dispatchEvent(new Event('inkwave:wave-rest'))
    }
    // Provisional cap until the anchor lands (covers exotic states where no frame ever runs).
    let cap = setTimeout(finish, (phone ? 2000 : 2500) + ANCHOR_SLACK_MS + 1200)

    // FORWARD ANCHOR (2026-07-11, Peter's live "backward tick"). The brake animations are born
    // CSS-PAUSED (zero additive value — the drift alone keeps rendering, byte-identical), so
    // engines that resolve a pending CSS animation at STYLE time (Firefox; Chromium under
    // starved compositor acks) can never present brake(lag) as a first frame — the old tick:
    // when a CPU spike delayed the swap commit, the compositor had drifted past the brake's
    // recorded start and its first presented frame applied a cancellation computed for a pose
    // N frames ago (a backward step proportional to the spike). Instead, ONE rAF after the swap
    // commit we stamp the load's anchor t_a = now + slack ON THE TIMELINE CLOCK, compute the
    // drift pose AT t_a analytically from the drift animation's own startTime (presentation-
    // exact for a long-running compositor animation), snap the rest pose to a device pixel,
    // inject the final keyframes, and start every coast animation (tiles + twinkle-field brakes
    // + the layer fades, both surfaces — all name-matched in the subtree) at exactly t_a. The
    // brake then begins at zero value/velocity at a future compositor time: continuous BY
    // CONSTRUCTION however starved the main thread was, and every copy shares one clock.
    const coastAnims = () => {
      try {
        return el.getAnimations({ subtree: true }).filter((a) => {
          const n = (a as CSSAnimation).animationName ?? ''
          return n === 'iw-wave-coast-l' || n === 'iw-wave-coast-r' || n === 'iw-spark-fade'
            || n === 'iw-twk-fade-out' || n === 'iw-twk-fade-in'
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
        // The drift pose at t_a, from the drift animation's own clock (shared across surfaces
        // via the sticky sibling adopt).
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
        // play() first: it marks the WAAPI override (the CSS paused declaration must never
        // re-pause on a later recalc), then the explicit startTime sets the exact shared clock.
        try { a.play(); a.startTime = tA } catch { /* detached — a mode change owns it */ }
      }
      schedule(tA)
    }
    requestAnimationFrame(() => anchor())
    return () => { cancelled = true; clearTimeout(cap) }
  }, [waveMode, phone])

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
    // all: waterMode is GLOBAL, and this surface's early drop to 'off' (settleToCoast) would
    // clobber the shell's live coast for every host. The shell owns the water until wave-rest.
    if (phone && covered) return
    // No clock/travel plumbing: the fields' brake is the SAME injected CSS keyframes the tiles
    // composite (one writer), and the pool's playback clock is aligned once per load inside
    // waveTwinkle (alignTracks).
    syncTwinkles(host, {
      sparks: waveMode !== 'off',
      dashes: !phone || waveMode !== 'off',
      mode: waveMode,
      phone,
    })
    // covered IS a dep: the phone editor skips sync while covered (above), so the uncover at
    // wave-rest must run one sync — it carries the global twinkle mode to 'off' (the shell
    // unmounts in the same commit, so its own 'off' sync never runs) and parks the driver.
  }, [fill, phone, waveMode, covered])

  return (
    <div ref={surfaceRef} className={`inkwave-editor-surface${phone ? ' is-phone' : ''}${fill ? ' iw-fill' : ''}${phone && covered ? '' : waveMode === 'anim' ? ' iw-wave-anim' : waveMode === 'coast' ? ' iw-wave-coast' : ''}${covered ? ' iw-wave-covered' : ''}`}
      style={{
        '--iw-editor-zoom': editorZoom,
        // The shell's atomic reveal: fade the whole covering surface out over the LAST 0.5s of the
        // wave S-decay — doc, text and pills fade in together underneath, over coasting waves.
        ...(fadingOut ? { opacity: 0, transition: `opacity ${phone ? 0.8 : 1}s cubic-bezier(0.4, 0, 0.2, 1)`, pointerEvents: 'none' as const } : null),
      } as React.CSSProperties}>
      {/* Twinkle host — sparkles + accent dashes live in here as generated layers, NOT on the wave
          ::before/::after (fading/blinking those would dim the wave lines too). Rendered EMPTY
          (deterministic — identical in the prerender), populated post-hydration by the effect
          above with the precomputed pool; every fleck rides its crest by construction (see the
          waveTwinkle.ts header). Pure visual layer. */}
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
