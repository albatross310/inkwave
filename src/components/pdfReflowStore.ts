// ONE reflow per page per document, shared by the two views.
//
// The page view needs it to give a NEW mark its text anchor at creation; the reader view needs it
// to render. If each built its own there would be two answers to "which paragraph is this", and the
// mark you made in one view would land somewhere else in the other. Memoised on the pdf.js document
// object itself (WeakMap), so closing a source drops its reflows with it and nothing needs clearing.

import { buildPageReflow, type PageReflow, type PlacedItem } from './pdfReflow'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = { numPages: number; getPage: (n: number) => Promise<any> }

const cache = new WeakMap<object, Map<number, Promise<PageReflow | null>>>()

/**
 * Convert one page's text items into viewport-space boxes.
 *
 * `convertToViewportPoint` (not the raw transform) because it is what handles the page's viewBox
 * offset and its inherent rotation — the same call `textExtentsOf` in PdfViewer makes, for the same
 * reason. The item's transform gives a BASELINE origin, so the box is lifted by the ascent; the
 * fraction is the usual 0.8 of the em box, and it only has to be close enough that two glyph boxes
 * on one printed line overlap vertically — the line grouping is an overlap test, not an equality.
 */
export async function readPlacedItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
): Promise<{ items: PlacedItem[]; pageW: number; pageH: number }> {
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items: PlacedItem[] = []
  for (const it of tc.items as Array<{ str?: string; width?: number; height?: number; transform?: number[] }>) {
    if (typeof it.str !== 'string' || !it.transform) continue
    const t = it.transform
    const h = (it.height && it.height > 0 ? it.height : Math.hypot(t[2] ?? 0, t[3] ?? 0)) || 0
    const [ax, ay] = vp.convertToViewportPoint(t[4], t[5])
    const [bx] = vp.convertToViewportPoint(t[4] + (it.width ?? 0), t[5])
    const x = Math.min(ax, bx)
    items.push({ str: it.str, x, y: ay - h * 0.8, w: Math.abs(bx - ax), h: Math.max(h, 1) })
  }
  return { items, pageW: vp.width, pageH: vp.height }
}

/** The reflow of one 1-based page, or null if it could not be read (a scan with no text layer). */
export function getPageReflow(doc: AnyDoc, pageNum: number): Promise<PageReflow | null> {
  let per = cache.get(doc as unknown as object)
  if (!per) { per = new Map(); cache.set(doc as unknown as object, per) }
  const hit = per.get(pageNum)
  if (hit) return hit
  const p = (async () => {
    try {
      const page = await doc.getPage(pageNum)
      const { items, pageW, pageH } = await readPlacedItems(page)
      if (!items.some(i => i.str.trim())) return null
      return buildPageReflow(items, pageW, pageH)
    } catch { return null }
  })()
  per.set(pageNum, p)
  return p
}
