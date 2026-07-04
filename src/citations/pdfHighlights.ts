// Persistent PDF annotations, stored as our OWN overlay data (not baked into the PDF bytes) on the
// source's _iw.highlights. Rects are normalised (0..1 of the page box) so they scale with zoom, and
// being plain JSON they persist in the library and travel inside the exported .studio bundle.

import type { CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from './bibProvider'
import { addToLibrary } from './library'

export interface HighlightRect { x: number; y: number; w: number; h: number } // normalised 0..1

export type HighlightKind = 'highlight' | 'underline' | 'strike'

export interface PdfHighlight {
  id: string
  page: number            // 1-based
  rects: HighlightRect[]
  color: string           // rgba/hex
  kind?: HighlightKind    // fill (default), underline, or strikethrough
  text: string            // the selected text (used for search fallback + display)
  note?: string           // optional annotation note
  citekey?: string        // set when this highlight is linked to an in-text citation's pinpoint
  createdAt: string
}

export function highlightsOf(item: CSLItem | undefined): PdfHighlight[] {
  const hs = (item as { _iw?: IwCitationMeta } | undefined)?._iw?.highlights
  return Array.isArray(hs) ? hs : []
}

/** Distinct, sorted PDF pages that carry any highlight/annotation for a source. */
export function highlightPages(item: CSLItem | undefined): number[] {
  const set = new Set<number>()
  for (const h of highlightsOf(item)) if (h.page > 0) set.add(h.page)
  return [...set].sort((a, b) => a - b)
}

/** Replace the full highlight list for a source and persist. */
export async function saveHighlights(citekey: string, highlights: PdfHighlight[]): Promise<void> {
  const item = bibProvider.get(citekey)
  if (!item) return
  const iw: IwCitationMeta = { ...((item as { _iw?: IwCitationMeta })._iw ?? {}) }
  if (highlights.length) iw.highlights = highlights
  else delete iw.highlights
  await addToLibrary({ ...item, _iw: iw })
}
