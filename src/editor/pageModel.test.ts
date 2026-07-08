import { describe, it, expect } from 'vitest'
import { PX_PER_MM, paperDimsMm, pageBoxPx, paperCssSize } from './pageModel'

// The canonical mm→px mapping: CSS reference pixel, 96dpi.
describe('PX_PER_MM', () => {
  it('is the CSS reference pixel (96dpi)', () => {
    expect(PX_PER_MM).toBeCloseTo(96 / 25.4, 12)
    expect(25.4 * PX_PER_MM).toBeCloseTo(96, 12) // 1 inch = 96px exactly
  })
})

describe('paperDimsMm', () => {
  it('A4 portrait is 210×297', () => {
    expect(paperDimsMm('a4', 'portrait')).toEqual({ wMm: 210, hMm: 297 })
  })
  it('A4 landscape swaps the axes', () => {
    expect(paperDimsMm('a4', 'landscape')).toEqual({ wMm: 297, hMm: 210 })
  })
  it('Letter is exactly 8.5in × 11in', () => {
    const { wMm, hMm } = paperDimsMm('letter', 'portrait')
    expect(wMm).toBeCloseTo(8.5 * 25.4, 10)
    expect(hMm).toBeCloseTo(11 * 25.4, 10)
  })
})

describe('pageBoxPx', () => {
  const margins = { topMarginPx: 96, bottomMarginPx: 72 }

  it('A4 portrait: canonical width/height at 100% zoom', () => {
    const box = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', ...margins })
    expect(box.pageWidthPx).toBeCloseTo(793.7008, 3)   // 210mm
    expect(box.pageHeightPx).toBeCloseTo(1122.5197, 3) // 297mm
    expect(box.textAreaPx).toBeCloseTo(1122.5197 - 96 - 72, 3)
  })

  it('A4 landscape: height is the 210mm side', () => {
    const box = pageBoxPx({ paperSize: 'a4', orientation: 'landscape', ...margins })
    expect(box.pageWidthPx).toBeCloseTo(297 * PX_PER_MM, 6)
    expect(box.pageHeightPx).toBeCloseTo(210 * PX_PER_MM, 6)
  })

  it('Letter portrait: 816×1056 css px exactly (8.5in×96, 11in×96)', () => {
    const box = pageBoxPx({ paperSize: 'letter', orientation: 'portrait', ...margins })
    expect(box.pageWidthPx).toBeCloseTo(816, 9)
    expect(box.pageHeightPx).toBeCloseTo(1056, 9)
    expect(box.textAreaPx).toBeCloseTo(1056 - 96 - 72, 9)
  })

  it('Letter landscape swaps to 1056×816', () => {
    const box = pageBoxPx({ paperSize: 'letter', orientation: 'landscape', ...margins })
    expect(box.pageWidthPx).toBeCloseTo(1056, 9)
    expect(box.pageHeightPx).toBeCloseTo(816, 9)
  })

  it('text area follows the margin settings', () => {
    const a = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', topMarginPx: 72, bottomMarginPx: 72 })
    const b = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', topMarginPx: 120, bottomMarginPx: 72 })
    expect(a.textAreaPx - b.textAreaPx).toBeCloseTo(48, 9)
    expect(a.pageHeightPx).toBe(b.pageHeightPx) // page height is margin-independent
  })

  it('text area is clamped to ≥ 1px for absurd margins', () => {
    const box = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', topMarginPx: 2000, bottomMarginPx: 2000 })
    expect(box.textAreaPx).toBe(1)
  })

  it('fluidWidthPx keeps the paper RATIO on the rendered width (phone / scroll paper)', () => {
    const box = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', ...margins, fluidWidthPx: 390 })
    expect(box.pageWidthPx).toBe(390)
    // NB the PHYSICAL A4 ratio 297/210 = 1.4142857…, not Math.SQRT2 (1.4142136…) — the old
    // width×√2 code drifted ~0.05px/page from the real printed page even before rounding.
    expect(box.pageHeightPx).toBeCloseTo(390 * (297 / 210), 6)
    const letter = pageBoxPx({ paperSize: 'letter', orientation: 'portrait', ...margins, fluidWidthPx: 500 })
    expect(letter.pageHeightPx).toBeCloseTo(500 * (11 / 8.5), 6)
  })

  it('ignores a zero/negative fluid width (falls back to canonical)', () => {
    const box = pageBoxPx({ paperSize: 'a4', orientation: 'portrait', ...margins, fluidWidthPx: 0 })
    expect(box.pageWidthPx).toBeCloseTo(210 * PX_PER_MM, 6)
  })
})

describe('paperCssSize', () => {
  it('emits the same mm the px model uses', () => {
    expect(paperCssSize('a4', 'portrait')).toEqual({ width: '210mm', height: '297mm' })
    expect(paperCssSize('a4', 'landscape')).toEqual({ width: '297mm', height: '210mm' })
    expect(paperCssSize('letter', 'portrait')).toEqual({ width: '215.9mm', height: '279.4mm' })
    expect(paperCssSize('letter', 'landscape')).toEqual({ width: '279.4mm', height: '215.9mm' })
  })
})
