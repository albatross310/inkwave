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
  /** Write the offset (CSS var + transform). Called only when the value CHANGED. */
  apply(offsetPx: number): void
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

export function createDock(host: DockHost): Dock {
  let raf = 0
  let lastOff = -1 // sentinel: the first step always applies (clears stale state)
  let stable = 0
  let settled = true

  const measure = () => {
    const g = host.readGeom()
    return g ? kbOffsetFor(g) : 0
  }

  const step = () => {
    const g = host.readGeom()
    if (g?.overscroll) {
      // Elastic phase: freeze the last good value; keep the loop alive (no settle, no
      // park) so tracking resumes the frame the rubber-band releases.
      stable = 0
      return
    }
    const off = g ? kbOffsetFor(g) : 0
    if (off !== lastOff) {
      lastOff = off
      stable = 0
      settled = false
      host.apply(off)
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
