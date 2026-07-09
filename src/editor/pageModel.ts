// The ONE canonical page-break model — shared by gapped pagination (PaginationExtension), the
// ungapped page guides (Scroll.tsx PageGuides), citation page numbers (citationNav) and the print
// `@page` CSS (printPageStyle). Pure functions, no DOM — unit-tested in pageModel.test.ts.
//
// Geometry derives from the PHYSICAL paper size in mm mapped through the CSS reference pixel
// (96dpi: 1in = 96px = 25.4mm → 1mm = 96/25.4 px), NOT from a measured clientWidth. clientWidth
// returns an INTEGER rounded from the fractional mm width, and which way it rounds flips with
// browser zoom / devicePixelRatio (Blink lays out at effective-zoom LayoutUnits and divides back)
// — so deriving pageH from it made pagination depend on the browser zoom level, and even at 100%
// it baked a ±0.5px-per-page error in (794 × √2 ≈ 1122.9px vs the true 297mm = 1122.52px) that
// drifted against the printed page. The canonical values here are exact at 100%, and because
// browser zoom scales CSS px uniformly they stay correct at every zoom.

import type { Orientation } from './pageSettings'

export const PX_PER_MM = 96 / 25.4

// Physical paper dimensions, portrait, in mm. Letter is 8.5in × 11in exactly.
export const PAPER_MM: Record<'a4' | 'letter', { w: number; h: number }> = {
  a4:     { w: 210,   h: 297 },
  letter: { w: 215.9, h: 279.4 },
}

export interface PaperDimsMm { wMm: number; hMm: number }

export function paperDimsMm(paperSize: 'a4' | 'letter', orientation: Orientation): PaperDimsMm {
  const p = PAPER_MM[paperSize]
  return orientation === 'landscape' ? { wMm: p.h, hMm: p.w } : { wMm: p.w, hMm: p.h }
}

export interface PageBoxInput {
  paperSize: 'a4' | 'letter'
  orientation: Orientation
  topMarginPx: number     // user setting (pageSettings.getTopMarginPx)
  bottomMarginPx: number  // MARGIN_BOTTOM (pageSettings)
  // Contexts with no mm paper identity — 'scroll' paper in gapped mode ONLY: keep the paper's
  // aspect RATIO but base it on the rendered width. Print parity is impossible there anyway (the
  // text wraps at a different width than the printed page). Phone paper no longer takes this path:
  // phones measure inside the forced canonical mm context (canonicalMeasure.ts), so phone breaks
  // = desktop breaks = print breaks.
  fluidWidthPx?: number
}

export interface PageBox {
  pageWidthPx: number   // full page width  (210mm → 793.70px at canonical 100%)
  pageHeightPx: number  // full page height (297mm → 1122.52px)
  textAreaPx: number    // content height per page: pageHeightPx − topMargin − bottomMargin
}

export function pageBoxPx(input: PageBoxInput): PageBox {
  const { wMm, hMm } = paperDimsMm(input.paperSize, input.orientation)
  const pageWidthPx = input.fluidWidthPx && input.fluidWidthPx > 0 ? input.fluidWidthPx : wMm * PX_PER_MM
  const pageHeightPx = pageWidthPx * (hMm / wMm)
  const textAreaPx = Math.max(1, pageHeightPx - input.topMarginPx - input.bottomMarginPx)
  return { pageWidthPx, pageHeightPx, textAreaPx }
}

// CSS length strings for the parchment width (Scroll.tsx) and the print `@page size` — the same
// mm the px model above is derived from, so screen and print share one physical page.
export function paperCssSize(paperSize: 'a4' | 'letter', orientation: Orientation): { width: string; height: string } {
  const { wMm, hMm } = paperDimsMm(paperSize, orientation)
  return { width: `${wMm}mm`, height: `${hMm}mm` }
}
