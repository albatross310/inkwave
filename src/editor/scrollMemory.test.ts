import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readScrollMemory, writeScrollMemory, restoreOffset } from './scrollMemory'

beforeEach(() => {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  })
})

describe('round trip', () => {
  it('remembers per DOCUMENT, so two tabs on two documents each get their own', () => {
    writeScrollMemory('doc-a', 4200, 90000)
    writeScrollMemory('doc-b', 100, 5000)
    expect(readScrollMemory('doc-a')?.top).toBe(4200)
    expect(readScrollMemory('doc-b')?.top).toBe(100)
    expect(readScrollMemory('doc-c')).toBeNull()
  })
  it('ignores rubbish rather than throwing into a load path', () => {
    localStorage.setItem('inkwave:scrollPos:doc-x', '{not json')
    expect(readScrollMemory('doc-x')).toBeNull()
  })
})

describe('restoreOffset', () => {
  const mem = (top: number, height: number) => ({ top, height, at: Date.now() })

  it('restores where you were', () => {
    expect(restoreOffset(mem(4200, 90000), 90000, 88000)).toBe(4200)
  })

  it('clamps past the end instead of scrolling into nothing', () => {
    expect(restoreOffset(mem(99000, 90000), 90000, 40000)).toBe(40000)
  })

  it('THE REFUSAL: a document that changed size materially starts at the top', () => {
    // An offset measured against a different layout is a guess about where the reader was, and a
    // confident guess in the wrong place is worse than no guess. Half the document is gone here.
    expect(restoreOffset(mem(4200, 90000), 40000, 38000)).toBeNull()
  })

  it('…but tolerates a re-measure or a late font', () => {
    expect(restoreOffset(mem(4200, 90000), 95000, 93000)).toBe(4200)   // +5.5%
    expect(restoreOffset(mem(4200, 90000), 83000, 81000)).toBe(4200)   // −7.8%
  })

  it('does not bother restoring the very top', () => {
    expect(restoreOffset(mem(3, 90000), 90000, 88000)).toBeNull()
  })

  it('a document with nowhere to scroll restores nothing', () => {
    expect(restoreOffset(mem(4200, 90000), 500, 0)).toBeNull()
  })

  it('forgets after a fortnight', () => {
    const old = { top: 4200, height: 90000, at: Date.now() - 1000 * 60 * 60 * 24 * 15 }
    localStorage.setItem('inkwave:scrollPos:doc-old', JSON.stringify(old))
    expect(readScrollMemory('doc-old')).toBeNull()
  })
})
