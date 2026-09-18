// ─── Toolbar keyboard dock ───────────────────────────────────────────────────
// Keeps the phone footer toolbar flush on top of the keyboard / bottom URL bar.
//
// iOS model: the on-screen keyboard does NOT resize the LAYOUT viewport (what
// position:fixed anchors to) — it only shrinks the VISUAL viewport; and scrolling
// while the keyboard is up PANS the visual viewport within the layout viewport
// (visualViewport.offsetTop changes), during which WebKit composites the pan
// WITHOUT re-running layout. So a fixed element whose `bottom` is recomputed in
// JS still drifts "all over the shop" mid-pan: layout-property writes don't take
// visual effect until the pan ends. The fix is a compositor-path property —
// transform: translateY — slaved to visualViewport geometry every frame the
// geometry is moving (events are sparse mid-slide and unreliable in momentum
// tails, hence the rAF follow loop + drift watchdog).
//
// This module is pure logic over an injected host so the exact frame-by-frame
// behaviour is unit-testable against a stubbed visualViewport (toolbarDock.test.ts).

/** Snapshot of the geometry the dock positions against. */
export interface DockGeom {
  /** window.innerHeight — the layout viewport height fixed elements anchor to. */
  innerHeight: number
  /** visualViewport.offsetTop — the visual viewport's pan within the layout viewport. */
  offsetTop: number
  /** visualViewport.height */
  height: number
  /** visualViewport.scale — >1 means pinch-zoomed (fixed elements don't scale; pin at 0). */
  scale: number
  /**
   * The page is in a rubber-band phase (scrollY < 0 at the top — pull-to-refresh — or past
   * the max at the bottom). Fixed elements ride the elastic layout viewport WITH the content
   * and vv.offsetTop goes elastic, so geometry reads are garbage — the dock FREEZES its last
   * good value until the elastic releases.
   */
  overscroll?: boolean
  /**
   * An editable element (the ProseMirror surface, an input) has focus. While it does, ANY visual-
   * viewport shrink is keyboard-family — see ACCESSORY_MIN_PX.
   */
  focused?: boolean
}

/**
 * Gap from the LAYOUT viewport's bottom edge up to the VISUAL viewport's bottom
 * edge = how far a fixed-bottom element must LIFT (translateY(-off)) to sit flush
 * on the keyboard / collapsed-URL-bar assembly. 0 when nothing overlaps.
 * Pinch-zoom shrinks vv.height without moving fixed elements — pin at 0 there.
 * offsetTop is clamped at 0: NEGATIVE offsetTop (top rubber-band / pull-to-refresh)
 * is elastic displacement, not keyboard space — counting it lifted the bar to
 * mid-screen. The lift can never exceed the REAL keyboard/URL-bar overlap.
 */
export function kbOffsetFor(g: DockGeom): number {
  if (g.scale > 1.01) return 0
  return Math.max(0, Math.round(g.innerHeight - Math.max(0, g.offsetTop) - g.height))
}

/**
 * The smallest visual-viewport shrink that counts as a KEYBOARD. Below this it is browser chrome
 * (Safari's collapsing bottom URL bar, ~50-80px on an iPhone), which position:fixed already
 * tracks natively. One number, shared with the editor's `keyboardUp` detection, so the dock and
 * the keyboard flag can never disagree about whether a keyboard is up.
 */
export const KEYBOARD_MIN_PX = 150

/**
 * ⚠ THE ACCESSORY-ONLY KEYBOARD (Peter, iPhone, 2026-09-17: "toolbar behaviour seems worse when
 * this thing is up"). With a hardware keyboard attached — or the software keyboard minimised —
 * iOS shows ONLY the ▲ ▼ ✓ accessory strip, ~70px, which shrinks the visual viewport exactly like
 * a keyboard does but stays UNDER KEYBOARD_MIN_PX: the dock never lifted, and the toolbar sat in
 * the layout viewport's bottom band BEHIND the strip. The threshold exists to ignore Safari's
 * URL-bar transients, and those only matter when nothing is focused (with focus the URL bar is
 * the floating pill and never collapses/expands); so while an editable has focus, a much smaller
 * shrink latches. 40px: above any frame-to-frame jitter, below the strip.
 */
export const ACCESSORY_MIN_PX = 40

/**
 * ⚠ THE LIFT IS FOR THE KEYBOARD ONLY — the root cause of the toolbar "doing funny things" while
 * scrolling (Peter, iPhone, 2026-09-17). Safari's collapsing bottom URL bar ALSO changes
 * innerHeight and vv.height, by ~50-80px and NOT in the same frame: on a scroll-up the bar
 * expands, vv.height shrinks first and innerHeight catches up a frame or two later, so the raw
 * overlap read as a 60-80px "keyboard" for those frames. The dock lifted the bar (with the 250ms
 * ease, being a >60px jump) and dropped it again on every scroll direction change, and
 * `--iw-kb-offset` briefly padded the surface by the same amount, jolting the scroll under the
 * finger. A fixed element already rides Safari's bar perfectly; only a keyboard (which never
 * resizes the layout viewport on iOS) needs the transform.
 *
 * A LATCH, not a bare threshold: the keyboard is recognised once the un-panned height gap reaches
 * KEYBOARD_MIN_PX (panning changes offsetTop, never the gap), and then tracked all the way back
 * down so the dismiss slide stays smooth to 0 rather than snapping at the threshold.
 */
export function keyboardLatched(g: DockGeom, was: boolean): boolean {
  const gap = g.innerHeight - g.height
  return was ? gap > 0 : gap >= (g.focused ? ACCESSORY_MIN_PX : KEYBOARD_MIN_PX)
}

/**
 * The lift to apply: the real overlap while a keyboard is latched (plus `allowancePx` — the
 * floating URL pill, see floatingBarAllowance — whenever that overlap is non-zero), otherwise 0.
 */
export function liftFor(g: DockGeom | null, latched: boolean, allowancePx = 0): number {
  // The allowance rides the LATCH, not the overlap: with the keyboard up and the page panned to
  // its end the overlap reads 0, and the toolbar dropped flush onto the vv bottom — under the pill.
  return g && latched ? kbOffsetFor(g) + allowancePx : 0
}

/**
 * The keyboard's HEIGHT — the un-panned shrink of the visual viewport — while latched, else 0.
 * PAN-INVARIANT, unlike the lift: this is what the editor surface's bottom padding must reserve.
 * ⚠ THE GREY BAND (Peter, iPhone, 2026-09-17: "the classic ios keyboard coming up from scrolling
 * up… mainly when you get to bottom"). The reserve was padded with the LIFT, which reads 0 once
 * the vv has panned to the page's end; the caret near the end then had nowhere legal to scroll
 * to, so WebKit scrolled PAST the document (scrollY > max) to reveal it and shrank the layout
 * viewport to match — a band of bare background between the toolbar and the keyboard, with the
 * toolbar stranded above it. Reserving the keyboard's height keeps every caret reveal inside the
 * legal scroll range, so WebKit never has to.
 */
export function keyboardHeightFor(g: DockGeom | null, latched: boolean, allowancePx = 0): number {
  if (!g || !latched || g.scale > 1.01) return 0
  return Math.max(0, Math.round(g.innerHeight - g.height)) + allowancePx
}

/**
 * iOS 26 Safari draws its COLLAPSED URL pill ("localhost") floating INSIDE the visual viewport
 * while the keyboard is up, over anything docked on the vv's bottom edge — our toolbar
 * (Peter, iPhone, 2026-09-17). The pill is ~36px tall with ~10px of air; this is the extra lift
 * that keeps the toolbar above it. Only Safari-the-browser: an installed (standalone) app has no
 * URL bar, and Chrome/Firefox on iOS keep theirs outside the vv.
 */
export const SAFARI_FLOATING_BAR_PX = 48
export function floatingBarAllowance(userAgent: string, standalone: boolean): number {
  if (standalone) return 0
  if (!/iPhone|iPad|iPod/.test(userAgent)) return 0
  if (/CriOS|FxiOS|EdgiOS/.test(userAgent)) return 0
  const m = /Version\/(\d+)/.exec(userAgent)
  if (!m || Number(m[1]) < 26) return 0
  return SAFARI_FLOATING_BAR_PX
}

/**
 * Where a toolbar of height `toolbarH`, lifted by kbOffsetFor(g), lands on the
 * SCREEN (visual-viewport coordinates). Test invariant: === g.height - toolbarH
 * (flush on the vv bottom) whenever the offset isn't clamped/pinned.
 */
export function dockedVisualTop(g: DockGeom, toolbarH: number): number {
  const layoutTop = g.innerHeight - kbOffsetFor(g) - toolbarH
  return layoutTop - g.offsetTop
}

export interface DockHost {
  /** Read the live geometry (null → treat as offset 0, e.g. no visualViewport). */
  readGeom(): DockGeom | null
  /** Write the offset (CSS var + transform). Called only when the value CHANGED. `kbHeightPx` is
   *  keyboardHeightFor — the pan-invariant reserve for the surface's bottom padding. */
  apply(offsetPx: number, kbHeightPx: number): void
  /**
   * Geometry has been still for SETTLE_FRAMES — safe to run follow-up work that
   * must not fight an in-flight pan (caret reveal, PM scroll-reserve sync).
   * Fires ONCE per movement episode.
   */
  onSettled(offsetPx: number): void
  raf(cb: () => void): number
  caf(id: number): void
}

/** Frames of unchanged geometry before the rAF follow loop parks (~0.5s @60fps —
 *  outlasts iOS momentum tails, which move the viewport WITHOUT firing events). */
export const PARK_FRAMES = 30
/** Frames of unchanged geometry before it counts as settled (~100ms @60fps). */
export const SETTLE_FRAMES = 6

export interface Dock {
  /** An event said the viewport moved: write synchronously, then follow via rAF. */
  kick(): void
  /** Cheap drift probe (watchdog): kick only if the parked value is stale. */
  check(): void
  /** True when no movement episode is in flight (reveals may run). */
  isSettled(): boolean
  stop(): void
}

export function createDock(host: DockHost, allowancePx = 0): Dock {
  let raf = 0
  let lastOff = -1 // sentinel: the first step always applies (clears stale state)
  let lastKbH = -1
  let stable = 0
  let settled = true
  let keyboard = false // the latch — see keyboardLatched

  const measure = () => {
    const g = host.readGeom()
    return liftFor(g, g ? keyboardLatched(g, keyboard) : false, allowancePx)
  }

  const step = () => {
    const g = host.readGeom()
    if (g?.overscroll) {
      // Elastic phase: freeze the last good value; keep the loop alive (no settle, no
      // park) so tracking resumes the frame the rubber-band releases.
      stable = 0
      return
    }
    if (g) keyboard = keyboardLatched(g, keyboard)
    const off = liftFor(g, keyboard, allowancePx)
    const kbH = keyboardHeightFor(g, keyboard, allowancePx)
    if (off !== lastOff || kbH !== lastKbH) {
      lastOff = off
      lastKbH = kbH
      stable = 0
      settled = false
      host.apply(off, kbH)
    } else {
      stable++
      if (!settled && stable >= SETTLE_FRAMES) {
        settled = true
        host.onSettled(off)
      }
    }
  }

  const tick = () => {
    step()
    raf = stable < PARK_FRAMES ? host.raf(tick) : 0
  }

  return {
    kick() {
      stable = 0
      step() // synchronous with the event — the reserve var lands in the SAME turn
      if (!raf) raf = host.raf(tick)
    },
    check() {
      if (measure() !== lastOff) this.kick()
      else if (keyboardHeightFor(host.readGeom(), keyboard, allowancePx) !== lastKbH) this.kick()
    },
    isSettled() {
      return settled
    },
    stop() {
      if (raf) host.caf(raf)
      raf = 0
    },
  }
}
