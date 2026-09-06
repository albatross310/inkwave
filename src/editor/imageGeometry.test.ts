import { describe, expect, it } from 'vitest'
import { clampImageGeometry, dragImageGeometry } from './imageGeometry'

describe('image geometry', () => {
  it('is left aligned by default and only moves horizontally', () => {
    const start = { widthPct: 60, xPct: 0, heightPx: null }
    expect(dragImageGeometry(start, 'move-x', 200, 900, 1000, 300)).toEqual({ widthPct: 60, xPct: 20, heightPx: null })
  })

  it('clamps movement inside the writing column', () => {
    expect(clampImageGeometry({ widthPct: 70, xPct: 80, heightPx: null })).toEqual({ widthPct: 70, xPct: 30, heightPx: null })
  })

  it('resizes width or height independently without changing vertical position', () => {
    const start = { widthPct: 50, xPct: 10, heightPx: null }
    expect(dragImageGeometry(start, 'resize-width', 100, 50, 1000, 240)).toEqual({ widthPct: 60, xPct: 10, heightPx: null })
    expect(dragImageGeometry(start, 'resize-height', 100, 60, 1000, 240)).toEqual({ widthPct: 50, xPct: 10, heightPx: 300 })
  })

  it('keeps the image proportions when its bottom-right corner is resized', () => {
    const start = { widthPct: 50, xPct: 10, heightPx: null }
    expect(dragImageGeometry(start, 'resize-both', -100, -40, 1000, 240)).toEqual({ widthPct: 40, xPct: 10, heightPx: 192 })
    expect(dragImageGeometry(start, 'resize-both', 20, 120, 1000, 240)).toEqual({ widthPct: 75, xPct: 10, heightPx: 360 })
  })

  it('keeps the left edge anchored when width reaches the writing-column edge', () => {
    const start = { widthPct: 60, xPct: 25, heightPx: null }
    expect(dragImageGeometry(start, 'resize-width', 500, 0, 1000, 240)).toEqual({ widthPct: 75, xPct: 25, heightPx: null })
  })

  it('resizes proportionally from bottom-left while anchoring the right edge', () => {
    const start = { widthPct: 50, xPct: 20, heightPx: 200 }
    expect(dragImageGeometry(start, 'resize-both-left', -100, 0, 1000, 200)).toEqual({ widthPct: 60, xPct: 10, heightPx: 240 })
    expect(dragImageGeometry(start, 'resize-both-left', 100, 0, 1000, 200)).toEqual({ widthPct: 40, xPct: 30, heightPx: 160 })
  })
})
