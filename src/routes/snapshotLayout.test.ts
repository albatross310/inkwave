// CHARACTERIZATION TESTS for the four rules lifted out of SnapshotView — ~6ms, no browser.
//
// Written against the ORIGINAL behaviour before the originals were deleted, so they pin what the
// snapshot view actually did rather than what the extracted copy happens to do. Each rule carries a
// stated reason (an empty highlighted line, Peter's minimap band); none of those reasons was
// checkable while the functions were private to a 3,800-line route.

import { describe, it, expect } from 'vitest'
import type { DiffOp } from '../provenance/diff'
import { splitEdges, longestChangeOpIdx, stackHeight, bestGrid } from './snapshotLayout'

describe('splitEdges — never paint whitespace', () => {
  it('plain text is all core', () => {
    expect(splitEdges('hello')).toEqual({ lead: '', core: 'hello', trail: '' })
  })

  it('strips both edges into lead and trail', () => {
    expect(splitEdges('  hello  ')).toEqual({ lead: '  ', core: 'hello', trail: '  ' })
  })

  // THE CASE THE FUNCTION EXISTS FOR. A change that ends a paragraph carries the newline; painting
  // it draws an empty highlighted line across the page.
  it('a trailing RETURN goes to trail, never to core', () => {
    expect(splitEdges('end.\n\n')).toEqual({ lead: '', core: 'end.', trail: '\n\n' })
  })

  it('ALL-whitespace has NO core, and lands entirely in trail so nothing is highlighted', () => {
    expect(splitEdges('\n\n')).toEqual({ lead: '', core: '', trail: '\n\n' })
    expect(splitEdges('   ')).toEqual({ lead: '', core: '', trail: '   ' })
  })

  it('empty string is inert', () => {
    expect(splitEdges('')).toEqual({ lead: '', core: '', trail: '' })
  })

  it('interior whitespace is untouched — only the EDGES move', () => {
    expect(splitEdges(' a  b ').core).toBe('a  b')
  })

  it('reassembles to the input exactly, for every shape', () => {
    for (const s of ['hello', '  hi  ', '\n', '', ' a  b ', 'x\n', '\n\ny']) {
      const { lead, core, trail } = splitEdges(s)
      expect(lead + core + trail).toBe(s)
    }
  })
})

describe('longestChangeOpIdx — the biggest contiguous change', () => {
  const op = (type: DiffOp['type'], text: string) => ({ type, text }) as DiffOp

  it('null ops → null (no diff computed yet is not "no change")', () => {
    expect(longestChangeOpIdx(null)).toBeNull()
  })

  it('all-same → null', () => {
    expect(longestChangeOpIdx([op('same', 'a whole unchanged paragraph')])).toBeNull()
  })

  // THE INDEX IS A DOM ADDRESS — it is `data-opidx` in the left pane, so it must be the position in
  // the array as given, never a position after any re-ordering.
  it('returns the ARRAY INDEX, counting same-ops', () => {
    expect(longestChangeOpIdx([op('same', 'xxxxxxxxxx'), op('add', 'hi'), op('del', 'longer')])).toBe(2)
  })

  it('a long SAME never wins — only add/del are candidates', () => {
    expect(longestChangeOpIdx([op('same', 'x'.repeat(500)), op('add', 'y')])).toBe(1)
  })

  it('ties keep the FIRST, so the choice is stable across renders', () => {
    expect(longestChangeOpIdx([op('add', 'aaa'), op('del', 'bbb')])).toBe(0)
  })

  it('empty ops → null', () => {
    expect(longestChangeOpIdx([])).toBeNull()
  })
})

describe('stackHeight — Peter\'s minimap bands', () => {
  it('matches the stated bands exactly at every boundary', () => {
    expect([1, 2].map(stackHeight)).toEqual([1, 1])
    expect([3, 6].map(stackHeight)).toEqual([2, 2])
    expect([7, 9].map(stackHeight)).toEqual([3, 3])
    expect([10, 16].map(stackHeight)).toEqual([4, 4])
  })

  it('past 16 it is ceil(sqrt(pages))', () => {
    expect(stackHeight(17)).toBe(5)
    expect(stackHeight(25)).toBe(5)
    expect(stackHeight(26)).toBe(6)
    expect(stackHeight(100)).toBe(10)
  })

  it('never returns 0 — a zero-height column renders nothing', () => {
    for (const n of [0, 1, 2, 3, 50, 400]) expect(stackHeight(n)).toBeGreaterThan(0)
  })
})

describe('bestGrid — every cell stays portrait', () => {
  const ratio = (n: number, W: number, H: number) => {
    const { rows, cols } = bestGrid(n, W, H)
    return (H / rows) / (W / cols)
  }

  it('degenerate inputs fall back to a single column rather than dividing by zero', () => {
    expect(bestGrid(0, 100, 100)).toEqual({ rows: 1, cols: 1 })
    expect(bestGrid(1, 100, 100)).toEqual({ rows: 1, cols: 1 })
    expect(bestGrid(5, 0, 100)).toEqual({ rows: 5, cols: 1 })
    expect(bestGrid(5, 100, 0)).toEqual({ rows: 5, cols: 1 })
  })

  it('covers every page — rows*cols is never short', () => {
    for (const n of [2, 3, 7, 12, 40, 116]) {
      const { rows, cols } = bestGrid(n, 300, 800)
      expect(rows * cols).toBeGreaterThanOrEqual(n)
    }
  })

  // ⚠ THE BAND IS A TARGET, NOT A GUARANTEE — established by writing the test the other way first.
  // At n=2 in a 300x800 panel NO split reaches it: 2 rows gives 1.33 and 2 cols gives 5.33, so the
  // scorer takes 1.33 as the lesser miss. Asserting band-membership would have encoded a promise the
  // function cannot keep and does not make. The REAL invariant is that the chosen split is the best
  // available one, which is both true and stronger.
  it('picks the OPTIMAL rows/cols — no other split scores better', () => {
    const score = (rows: number, cols: number, W: number, H: number) => {
      const r = (H / rows) / (W / cols)
      return (r < 2 ? 2 - r : r > 4 ? r - 4 : 0) * 100 + Math.abs(r - 3)
    }
    for (const [n, W, H] of [[2, 300, 800], [4, 300, 800], [9, 300, 800], [40, 300, 800],
                             [4, 360, 300], [16, 360, 300]] as const) {
      const got = bestGrid(n, W, H)
      const mine = score(got.rows, got.cols, W, H)
      for (let rows = 1; rows <= n; rows++) {
        expect(score(rows, Math.ceil(n / rows), W, H), `n=${n} ${W}x${H}: rows=${rows} beats ${got.rows}`)
          .toBeGreaterThanOrEqual(mine - 1e-9)
      }
    }
  })

  it('and WHERE the band is reachable it is actually reached', () => {
    for (const n of [4, 9, 16, 40]) {
      const r = ratio(n, 300, 800)
      expect(r, `n=${n} ratio=${r}`).toBeGreaterThanOrEqual(2)
      expect(r, `n=${n} ratio=${r}`).toBeLessThanOrEqual(4)
    }
  })

  // The 2026-07-10 revision: the old [3,5] band rendered "longer than 1:5" here.
  it('never exceeds 1:4 on a SHORT phone panel — the case that forced MAX', () => {
    for (const n of [4, 9, 16]) {
      const r = ratio(n, 360, 300)
      expect(r, `n=${n} ratio=${r}`).toBeLessThanOrEqual(4)
    }
  })
})
