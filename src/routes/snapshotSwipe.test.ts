// THE SIDEWAYS SWIPE ON /snapshot — the view must consume it, and only the sideways one. ~30ms.
//
// Peter, 2026-08-30, Mac trackpad: a two-finger horizontal swipe fired the browser's history
// navigation and threw him out of the review mid-read. Two mechanisms answer that, and each has its
// own guard: `overscroll-behavior-x: contain` on the ROOT while /snapshot is mounted
// (`snapshotPalette.test.ts`), and the panes' wheel handler, which must (1) claim a horizontal
// delta with preventDefault and drive the position scrubber, (2) leave a shift-wheel alone — that
// is the flipbook's, on the window — and (3) leave a vertical scroll alone. This file holds (1)–(3).
// `snapswipe.prove.mjs` (retired to docs/archive/probes/) held them in a browser and said itself
// that the browser added nothing it could honestly claim: headless Chromium cannot perform a macOS
// swipe-back, so "history did not navigate" is true on every build.
//
// The handler is effect-local inside SnapshotView, so this executes a SLICE of the real body with the
// real detent rule (`editor/scrubDetent.ts`) — not a re-implementation. A moved anchor fails loudly.
// → docs/archive/snapshot-scrub-rounds.md#sv-swipe-nav, #sv-touch

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { stepDetent, newDetent, resetDetent, TRACKPAD_DETENT, type DetentState } from '../editor/scrubDetent'

const code = readFileSync(new URL('./SnapshotView.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const KEY = 'if (e.shiftKey || e.ctrlKey || e.metaKey) return'
const END = "L?.addEventListener('wheel', onWheel"

type Ev = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; deltaX: number; deltaY: number; timeStamp: number; preventDefault: () => void }
type Handler = (e: Ev) => void
type Make = (hDetentRef: { current: DetentState }, onScrub: ((n: number, t: number, kind: string) => void) | undefined) => Handler
let make: Make

beforeAll(async () => {
  const k = code.indexOf(KEY)
  const start = code.lastIndexOf('let idle', k)
  const end = code.indexOf(END, k)
  if (k < 0 || start < 0 || end < 0) throw new Error('horizontal-swipe slice anchors not found in SnapshotView.tsx — re-anchor this test')
  const body = code.slice(start, end)
  if (!body.includes('stepDetent(hDetentRef.current, e.deltaX, TRACKPAD_DETENT)')) throw new Error('the slice no longer contains the detent call — re-anchor')
  const src = `function make(hDetentRef, onScrub, stepDetent, resetDetent, TRACKPAD_DETENT) {\n${body}\n return onWheel }`
  const { code: js } = await transformWithEsbuild(src, 'swipe.ts', { loader: 'ts', format: 'esm', minify: false })
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${js}; return make`)() as (...a: unknown[]) => Handler
  make = (ref, onScrub) => factory(ref, onScrub, stepDetent, resetDetent, TRACKPAD_DETENT)
})

const ev = (o: Partial<Ev>, log: string[]): Ev => ({
  deltaX: 0, deltaY: 0, timeStamp: 1, preventDefault: () => log.push('pd'), ...o,
})

describe('/snapshot horizontal swipe handler (the slice of the real onWheel)', () => {
  it('a horizontal delta is CLAIMED (preventDefault) and, once the detent arms, steps the position scrubber', () => {
    const log: string[] = []
    const calls: Array<[number, number, string]> = []
    const h = make({ current: newDetent() }, (n, t, k) => calls.push([n, t, k]))
    // 60px per event — enough events to pass `first` + `buffer` and reach the cadence.
    for (let i = 0; i < 40; i++) h(ev({ deltaX: 60, deltaY: 4, timeStamp: i }, log))
    expect(log.filter((x) => x === 'pd').length).toBe(40) // every horizontal event is consumed
    expect(calls.length).toBeGreaterThan(0)
    // Slide RIGHT (deltaX > 0) = PREVIOUS: the handler negates the detent's sign.
    expect(calls.every(([n]) => n < 0)).toBe(true)
    expect(calls.every(([, , k]) => k === 'scrub')).toBe(true)
  })

  it('slide LEFT (deltaX < 0) steps forward (positive net)', () => {
    const log: string[] = []
    const calls: number[] = []
    const h = make({ current: newDetent() }, (n) => calls.push(n))
    for (let i = 0; i < 40; i++) h(ev({ deltaX: -60, deltaY: 0, timeStamp: i }, log))
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((n) => n > 0)).toBe(true)
  })

  it('KNOWN-NEGATIVE: a SHIFT-wheel is left alone — the flipbook on the window owns it', () => {
    const log: string[] = []
    const calls: number[] = []
    const h = make({ current: newDetent() }, (n) => calls.push(n))
    for (let i = 0; i < 40; i++) h(ev({ shiftKey: true, deltaX: 60, deltaY: 0, timeStamp: i }, log))
    expect(log).toEqual([])
    expect(calls).toEqual([])
  })

  it('KNOWN-NEGATIVE: a vertical scroll is left alone (not prevented, no scrub)', () => {
    const log: string[] = []
    const calls: number[] = []
    const h = make({ current: newDetent() }, (n) => calls.push(n))
    for (let i = 0; i < 40; i++) h(ev({ deltaX: 5, deltaY: 60, timeStamp: i }, log))
    expect(log).toEqual([])
    expect(calls).toEqual([])
  })

  it('the axis test is deltaX > 1.3 × deltaY — a diagonal biased to vertical is NOT a swipe', () => {
    const log: string[] = []
    const h = make({ current: newDetent() }, undefined)
    h(ev({ deltaX: 12, deltaY: 10, timeStamp: 0 }, log)) // 12 <= 13 → not horizontal
    expect(log).toEqual([])
    h(ev({ deltaX: 14, deltaY: 10, timeStamp: 0 }, log)) // 14 > 13 → horizontal
    expect(log).toEqual(['pd'])
  })

  it('gesture state lives in the REF the caller owns (R7): a fresh ref starts un-armed, the same ref carries on', () => {
    const log: string[] = []
    const calls: number[] = []
    const ref = { current: newDetent() }
    const h = make(ref, (n) => calls.push(n))
    h(ev({ deltaX: TRACKPAD_DETENT.first - 1, deltaY: 0, timeStamp: 0 }, log))
    expect(calls).toEqual([]) // one px short of arming
    expect(ref.current.accum).toBe(TRACKPAD_DETENT.first - 1) // …but the travel is remembered in the ref
    // A second handler over the SAME ref (the effect re-subscribed) finishes arming on the next px.
    const h2 = make(ref, (n) => calls.push(n))
    h2(ev({ deltaX: 1, deltaY: 0, timeStamp: 1 }, log))
    expect(calls).toEqual([-1])
  })
})
