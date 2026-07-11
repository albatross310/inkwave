// Toolbar keyboard-dock — frame-exact behaviour against a stubbed visualViewport.
// WebKit emulation can't raise a real iOS keyboard, so these scenarios script the
// GEOMETRY the keyboard/URL-bar/pan produces (vv.offsetTop / vv.height / innerHeight)
// and assert the dock keeps the toolbar flush on the visual viewport's bottom edge
// EVERY frame. Peter's device remains the final arbiter of the real thing.
import { describe, it, expect } from 'vitest'
import {
  createDock,
  kbOffsetFor,
  dockedVisualTop,
  PARK_FRAMES,
  SETTLE_FRAMES,
  type DockGeom,
  type DockHost,
} from './toolbarDock'

// ─── Harness: manual rAF queue + mutable geometry ───────────────────────────

function makeHarness(initial: DockGeom) {
  const geom: DockGeom = { ...initial }
  const applied: number[] = []
  const settled: number[] = []
  const rafQ = new Map<number, () => void>()
  let nextId = 1
  const host: DockHost = {
    readGeom: () => ({ ...geom }),
    apply: (off) => applied.push(off),
    onSettled: (off) => settled.push(off),
    raf: (cb) => {
      const id = nextId++
      rafQ.set(id, cb)
      return id
    },
    caf: (id) => {
      rafQ.delete(id)
    },
  }
  const frame = () => {
    // Run everything scheduled BEFORE this frame (a real rAF callback scheduling
    // another rAF runs it next frame, not this one).
    const pending = [...rafQ.values()]
    rafQ.clear()
    pending.forEach((cb) => cb())
  }
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) frame()
  }
  const lastApplied = () => applied[applied.length - 1]
  const pendingFrames = () => rafQ.size
  return { geom, applied, settled, host, frame, frames, lastApplied, pendingFrames }
}

/** The toolbar is flush when the applied lift equals the live geometry's overlap. */
function expectFlush(h: ReturnType<typeof makeHarness>) {
  expect(h.lastApplied()).toBe(kbOffsetFor(h.geom))
}

// iPhone-ish portrait numbers.
const RESTING: DockGeom = { innerHeight: 844, offsetTop: 0, height: 844, scale: 1 }
const KEYBOARD_H = 336

// ─── Pure math ───────────────────────────────────────────────────────────────

describe('kbOffsetFor', () => {
  it('is 0 at rest (visual viewport fills the layout viewport)', () => {
    expect(kbOffsetFor(RESTING)).toBe(0)
  })
  it('equals the keyboard overlap when the keyboard shrinks the visual viewport', () => {
    expect(kbOffsetFor({ ...RESTING, height: 844 - KEYBOARD_H })).toBe(KEYBOARD_H)
  })
  it('shrinks as the visual viewport pans down within the layout viewport (offsetTop)', () => {
    // Scrolling with the keyboard up: iOS pans the vv down — the fixed element needs less lift.
    expect(kbOffsetFor({ ...RESTING, height: 508, offsetTop: 200 })).toBe(136)
    expect(kbOffsetFor({ ...RESTING, height: 508, offsetTop: KEYBOARD_H })).toBe(0)
  })
  it('never goes negative (URL-bar races where vv momentarily exceeds the layout viewport)', () => {
    expect(kbOffsetFor({ ...RESTING, offsetTop: 0, height: 900 })).toBe(0)
  })
  it('pins to 0 while pinch-zoomed (fixed elements do not scale with the vv)', () => {
    expect(kbOffsetFor({ ...RESTING, height: 400, scale: 2 })).toBe(0)
  })
  it('rounds to whole px (iOS reports fractional heights mid-slide)', () => {
    expect(kbOffsetFor({ ...RESTING, height: 507.6 })).toBe(336)
  })
  it('ignores NEGATIVE offsetTop (pull-to-refresh rubber-band is not keyboard space)', () => {
    // Top elastic with no keyboard: must stay docked at 0, not ride up by the elastic amount.
    expect(kbOffsetFor({ ...RESTING, offsetTop: -120, height: 844 })).toBe(0)
    // Top elastic WITH the keyboard: the lift stays the REAL keyboard overlap.
    expect(kbOffsetFor({ ...RESTING, offsetTop: -120, height: 508 })).toBe(KEYBOARD_H)
  })
})

describe('dockedVisualTop', () => {
  it('sits the toolbar flush on the visual viewport bottom for any pan/keyboard state', () => {
    const toolbarH = 56
    const states: DockGeom[] = [
      { ...RESTING, height: 508 }, // keyboard up
      { ...RESTING, height: 508, offsetTop: 120 }, // mid-pan
      { ...RESTING, height: 508, offsetTop: 336 }, // panned to the layout bottom
      { ...RESTING, height: 780 }, // URL bar only
    ]
    for (const g of states) {
      expect(dockedVisualTop(g, toolbarH)).toBe(g.height - toolbarH)
    }
  })
})

// ─── The follow loop ─────────────────────────────────────────────────────────

describe('createDock', () => {
  it('writes synchronously with the kicking event (no one-frame stale reserve)', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    expect(h.applied).toEqual([KEYBOARD_H]) // before any frame ran
    dock.stop()
  })

  it('tracks the keyboard OPEN animation frame-by-frame from a single event', () => {
    const h = makeHarness(RESTING)
    const dock = createDock(h.host)
    dock.kick() // initial state: applies 0
    // iOS fires ONE sparse resize early in the slide; the follow loop must do the rest.
    for (let f = 1; f <= 12; f++) {
      h.geom.height = 844 - Math.round((KEYBOARD_H * f) / 12)
      if (f === 1) dock.kick()
      h.frame()
      expectFlush(h)
    }
    expect(h.lastApplied()).toBe(KEYBOARD_H)
    dock.stop()
  })

  it('tracks a scroll pan while the keyboard is up (offsetTop moves, no further events)', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    for (let f = 1; f <= 10; f++) {
      h.geom.offsetTop = f * 30 // pan the vv down within the layout viewport
      h.frame()
      expectFlush(h)
    }
    dock.stop()
  })

  it('follows a momentum tail: movement pauses then resumes WITHOUT any event', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    h.geom.offsetTop = 100
    h.frame()
    expectFlush(h)
    // The finger lifts; geometry stalls for less than the park window…
    h.frames(PARK_FRAMES - 5)
    // …then momentum moves it again with NO vv event. The still-running loop must catch it.
    for (let f = 1; f <= 6; f++) {
      h.geom.offsetTop = 100 + f * 20
      h.frame()
      expectFlush(h)
    }
    dock.stop()
  })

  it('returns to the resting dock on keyboard dismiss', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    expect(h.lastApplied()).toBe(KEYBOARD_H)
    h.geom.height = 844
    dock.kick() // dismiss fires a resize
    expect(h.lastApplied()).toBe(0)
    h.frames(SETTLE_FRAMES + 1)
    expect(h.settled[h.settled.length - 1]).toBe(0)
    dock.stop()
  })

  it('tracks URL-bar collapse/expand (vv.height changes without a keyboard)', () => {
    // Collapsed URL bar: layout + visual heights grow together — offset stays 0 throughout.
    const h = makeHarness({ ...RESTING, innerHeight: 780, height: 780 })
    const dock = createDock(h.host)
    dock.kick()
    for (let f = 1; f <= 8; f++) {
      h.geom.innerHeight = 780 + f * 8
      h.geom.height = 780 + f * 8
      if (f === 1) dock.kick()
      h.frame()
      expectFlush(h)
    }
    expect(h.lastApplied()).toBe(0)
    // Expand where the vv shrinks a frame BEFORE innerHeight catches up: transiently lifted,
    // then settles back to 0 — never stuck.
    h.geom.height = 780
    dock.kick()
    expect(h.lastApplied()).toBe(64)
    h.geom.innerHeight = 780
    h.frame()
    expect(h.lastApplied()).toBe(0)
    dock.stop()
  })

  it('parks after the stability window and the watchdog check() recovers any drift', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    h.frames(PARK_FRAMES + 2)
    expect(h.pendingFrames()).toBe(0) // parked: no rAF scheduled
    // Geometry moves while parked (missed event): frames alone must not wake it…
    h.geom.offsetTop = 200
    h.frames(3)
    expect(h.lastApplied()).toBe(KEYBOARD_H)
    // …the 500ms watchdog (or a window scroll) probes and re-kicks.
    dock.check()
    expectFlush(h)
    expect(h.pendingFrames()).toBe(1) // loop running again
    dock.stop()
  })

  it('check() is a no-op when the parked value is still correct', () => {
    const h = makeHarness(RESTING)
    const dock = createDock(h.host)
    dock.kick()
    h.frames(PARK_FRAMES + 2)
    const writes = h.applied.length
    dock.check()
    expect(h.applied.length).toBe(writes)
    expect(h.pendingFrames()).toBe(0)
    dock.stop()
  })

  it('settles exactly once per movement episode, only after the geometry goes still', () => {
    const h = makeHarness(RESTING)
    const dock = createDock(h.host)
    dock.kick()
    expect(dock.isSettled()).toBe(false)
    h.frames(SETTLE_FRAMES)
    expect(dock.isSettled()).toBe(true)
    expect(h.settled).toEqual([0])
    // Spurious kicks with unchanged geometry must not re-fire the settle callback.
    dock.kick()
    h.frames(SETTLE_FRAMES + 2)
    expect(h.settled).toEqual([0])
    // A real change starts a new episode → exactly one more settle, with the new value.
    h.geom.height = 508
    dock.kick()
    expect(dock.isSettled()).toBe(false)
    h.frames(SETTLE_FRAMES)
    expect(h.settled).toEqual([0, KEYBOARD_H])
    dock.stop()
  })

  it('reveals must wait out the slide: isSettled() is false the whole animated stretch', () => {
    const h = makeHarness(RESTING)
    const dock = createDock(h.host)
    dock.kick()
    h.frames(SETTLE_FRAMES)
    for (let f = 1; f <= 12; f++) {
      h.geom.height = 844 - Math.round((KEYBOARD_H * f) / 12)
      if (f === 1) dock.kick()
      h.frame()
      expect(dock.isSettled()).toBe(false) // keepCaret must stay out of iOS's own pan
    }
    h.frames(SETTLE_FRAMES)
    expect(dock.isSettled()).toBe(true)
    expect(h.settled).toEqual([0, KEYBOARD_H]) // one reveal opportunity per episode
    dock.stop()
  })

  it('freezes through an elastic overscroll phase and resumes when it releases', () => {
    const h = makeHarness({ ...RESTING, height: 508 })
    const dock = createDock(h.host)
    dock.kick()
    h.frames(SETTLE_FRAMES)
    expect(h.settled).toEqual([KEYBOARD_H])
    const writes = h.applied.length
    // Pull-to-refresh: elastic geometry (offsetTop wobbles negative) + overscroll flag.
    h.geom.overscroll = true
    for (let f = 1; f <= 10; f++) {
      h.geom.offsetTop = -f * 15
      if (f === 1) dock.kick()
      h.frame()
      expect(h.applied.length).toBe(writes) // frozen: no writes during the elastic phase
      expect(h.settled.length).toBe(1) // and no settle mid-elastic
    }
    // The loop must still be alive (overscroll resets stability — no park mid-elastic).
    expect(h.pendingFrames()).toBe(1)
    // Release: elastic snaps back, keyboard still up — tracking resumes immediately.
    h.geom.overscroll = false
    h.geom.offsetTop = 0
    h.frame()
    expectFlush(h)
    expect(h.lastApplied()).toBe(KEYBOARD_H)
    dock.stop()
  })

  it('treats a missing visualViewport as offset 0', () => {
    const applied: number[] = []
    const dock = createDock({
      readGeom: () => null,
      apply: (off) => applied.push(off),
      onSettled: () => {},
      raf: () => 0,
      caf: () => {},
    })
    dock.kick()
    expect(applied).toEqual([0])
    dock.stop()
  })
})
