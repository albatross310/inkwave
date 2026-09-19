// THE SHIFT-WHEEL FLIPBOOK'S TUNED CONSTANTS, AND THE WHEEL-DEBT REVERSAL — pinned. ~30ms, no browser.
//
// CLAUDE.md lists MAX_PER_FRAME=1, LAND_QUIET_MS=260, FREEZE_HOLD=400 and RASTER_DPR_CAP=1 as "THE
// RULES" of the /snapshot scrub, each a live bug if moved (→ docs/archive/snapshot-scrub-rounds.md
// #sv-flipbook, #raster-budgets). Until 2026-09-16 nothing pinned any of them: the six scrub probes
// that produced the numbers hardcoded a port and booted no server, so they could not run, and no
// unit test read the values. PROBE-TRIAGE.md (PR #6) claim #7: "unguarded TODAY, not only if archived."
//
// WHY THIS PARSES SOURCE INSTEAD OF IMPORTING. The four constants are LOCAL to an effect inside the
// SnapshotView component (`const SW_STEP = trimmed(40), MAX_PER_FRAME = 1, …`) and RASTER_DPR_CAP is
// module-private; exporting them is a change to a 3,000-line route this lane does not own. So the test
// reads the DECLARATION STATEMENTS — code, with every comment stripped first, never the prose that
// explains them — and executes the debt block of the real `onWheel` body. A slice anchor that stops
// matching fails LOUDLY ("declaration not found"), which is the right direction for a guard.
//
// The debt block (probe-reverse.mjs's claim, Peter's oldest scrub complaint): a step consumes SW_STEP
// of a 120-unit mouse notch, so undischarged delta compounds and a reversal used to step the WRONG
// WAY until the debt was paid off — read as presentation latency for weeks. The fix cancels the
// accumulator on a direction change, guarded by `>= SW_STEP` so a trackpad's fine-delta stream (which
// never leaves a whole step of debt) is untouched. Cell A (`__iwWheelDebtFix=false`) must REPRODUCE
// the bug or cell B proves nothing.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { trimmed, SCRUB_SPEED_TRIM } from '../editor/scrubDetent'

const SV = readFileSync(new URL('./SnapshotView.tsx', import.meta.url), 'utf8')
const RASTER = readFileSync(new URL('../editor/scrubRaster.ts', import.meta.url), 'utf8')

/** Strip block and line comments so a number in PROSE can never satisfy a pin meant for CODE. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
const svCode = stripComments(SV)
const rasterCode = stripComments(RASTER)

// ── the declaration statement, as the code writes it ──────────────────────────────────────────
const DECL_RE = /const\s+SW_STEP\s*=\s*trimmed\((\d+)\)\s*,\s*MAX_PER_FRAME\s*=\s*(\d+)\s*,\s*LAND_QUIET_MS\s*=\s*(\d+)\s*,\s*FREEZE_HOLD_MS\s*=\s*(\d+)/g
const DPR_RE = /const\s+RASTER_DPR_CAP\s*=\s*(\d+)/g

describe('the flipbook constants are declared once and hold their measured values', () => {
  // VOID guard for the pin: a regex that matches nothing would let every `expect` below be skipped.
  it('finds exactly ONE declaration of the four constants in SnapshotView.tsx (code, not comments)', () => {
    const hits = [...svCode.matchAll(DECL_RE)]
    expect(hits, 'the flipbook declaration moved or was split — re-anchor this pin, do not delete it').toHaveLength(1)
  })
  it('finds exactly ONE declaration of RASTER_DPR_CAP in scrubRaster.ts', () => {
    expect([...rasterCode.matchAll(DPR_RE)]).toHaveLength(1)
  })

  const decl = () => [...svCode.matchAll(DECL_RE)][0]
  it('MAX_PER_FRAME = 1 — at 2 the driver silently DROPS the intermediate version when behind', () => {
    expect(Number(decl()[2])).toBe(1)
  })
  it('LAND_QUIET_MS = 260 — must exceed a real mouse-wheel notch gap (~150-250ms); at 120 it lands a React render per notch', () => {
    expect(Number(decl()[3])).toBe(260)
  })
  it('FREEZE_HOLD_MS = 400 — holds past the landing so the panes do not re-render mid-scrub', () => {
    expect(Number(decl()[4])).toBe(400)
  })
  it('SW_STEP = trimmed(40) — one mouse notch (120) stays exactly one version', () => {
    expect(Number(decl()[1])).toBe(40)
    // trimmed() is the shared scrub cadence rule; pin what the driver actually gets, not just the 40.
    expect(trimmed(40)).toBe(Math.round(40 / SCRUB_SPEED_TRIM))
    expect(trimmed(40)).toBeLessThan(120) // a notch must still clear a step, or the wheel does nothing
  })
  it('RASTER_DPR_CAP = 1 — cap the RASTER DPR, never the display; DPR1 quarters the per-swap upload', () => {
    expect(Number([...rasterCode.matchAll(DPR_RE)][0][1])).toBe(1)
  })
})

// ── the wheel-debt block, executed from the REAL onWheel body ─────────────────────────────────
// Slice from the fix flag's read to the step computation. The body references `window`,
// `wheelAccum.current`, `SW_STEP` and `d`, and declares `let n`.
const START = 'const debtFixOn ='
const END = 'if (!n) return'

type Debt = (window: { __iwWheelDebtFix?: boolean }, wheelAccum: { current: number }, SW_STEP: number, d: number) => number
let debt: Debt
const SW_STEP = trimmed(40)

beforeAll(async () => {
  const a = svCode.indexOf(START), b = svCode.indexOf(END, a)
  if (a < 0 || b < 0) throw new Error('wheel-debt slice anchors not found in SnapshotView.tsx — re-anchor this test')
  const body = svCode.slice(a, b) + '; return n'
  const { code } = await transformWithEsbuild(`function debt(window, wheelAccum, SW_STEP, d) {\n${body}\n}`, 'debt.ts', { loader: 'ts', format: 'esm', minify: false })
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  debt = new Function(`${code}; return debt`)() as Debt
})

/** Drive `n` notches of `delta`; returns the step each notch produced. */
function notches(win: { __iwWheelDebtFix?: boolean }, acc: { current: number }, delta: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(debt(win, acc, SW_STEP, delta))
  return out
}

describe('wheel debt — a direction change cancels the accumulator (probe-reverse.mjs, as a unit)', () => {
  it('the slice is the real code: it references the accumulator and the fix flag', () => {
    const a = svCode.indexOf(START), b = svCode.indexOf(END, a)
    const body = svCode.slice(a, b)
    expect(body).toContain('wheelAccum.current')
    expect(body).toContain('__iwWheelDebtFix')
    expect(body).toContain('SW_STEP')
  })

  it('a 120 notch is exactly one step and leaves debt (this is why the bug existed)', () => {
    const acc = { current: 0 }
    expect(notches({}, acc, 120, 1)).toEqual([1])
    expect(acc.current).toBe(120 - SW_STEP)
    expect(acc.current).toBeGreaterThan(0)
  })

  it('KNOWN-NEGATIVE (cell A, fix off): after 12 notches down, the first notch UP does not move up', () => {
    const win = { __iwWheelDebtFix: false }
    const acc = { current: 0 }
    notches(win, acc, -120, 12)
    expect(acc.current).toBeLessThanOrEqual(-SW_STEP) // a whole step of debt survives the burst
    const first = debt(win, acc, SW_STEP, 120)
    // The bug: the reversal pays debt instead of moving — steps the OLD way (−1) or not at all.
    expect(first).toBeLessThanOrEqual(0)
  })

  it('FIXED (cell B): after 12 notches down, the first notch UP moves UP by exactly one', () => {
    const win = {}
    const acc = { current: 0 }
    notches(win, acc, -120, 12)
    expect(debt(win, acc, SW_STEP, 120)).toBe(1)
  })

  it('the two cells genuinely disagree — the fix is real, not a no-op', () => {
    const a = { current: 0 }, b = { current: 0 }
    notches({ __iwWheelDebtFix: false }, a, -120, 12)
    notches({}, b, -120, 12)
    expect(debt({ __iwWheelDebtFix: false }, a, SW_STEP, 120)).not.toBe(debt({}, b, SW_STEP, 120))
  })

  it('TRACKPAD ±12: a fine-delta stream still accumulates and reverses, with no backward step after the turn', () => {
    const win = {}
    const acc = { current: 0 }
    const p1 = notches(win, acc, -12, 40)
    expect(p1.filter((s) => s === -1).length).toBeGreaterThan(0)
    const p2 = notches(win, acc, 12, 40)
    expect(p2.filter((s) => s === 1).length).toBeGreaterThan(0)
    expect(p2.filter((s) => s === -1)).toEqual([]) // never steps the old way after the reversal
  })

  it('the cancel is guarded by >= SW_STEP: a residual smaller than a step is NOT cancelled (trackpad safety)', () => {
    const win = {}
    const acc = { current: -(SW_STEP - 1) } // less than one step of debt
    debt(win, acc, SW_STEP, 12)
    expect(acc.current).toBe(-(SW_STEP - 1) + 12) // paid down, not zeroed
  })
})
