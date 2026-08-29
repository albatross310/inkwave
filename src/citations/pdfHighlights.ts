// Persistent PDF annotations, stored as our OWN overlay data (not baked into the PDF bytes) on the
// source's _iw.highlights. Rects are normalised (0..1 of the page box) so they scale with zoom, and
// being plain JSON they persist in the library and travel inside the exported .studio bundle.

import type { CSLItem, IwCitationMeta } from '../types/document'
import { bibProvider } from './bibProvider'
import { addToLibrary } from './library'

export interface HighlightRect { x: number; y: number; w: number; h: number } // normalised 0..1

export type HighlightKind = 'highlight' | 'underline' | 'strike' | 'text'

/**
 * WHERE A MARK IS, SAID IN TEXT RATHER THAN IN PIXELS — what the reader view anchors on.
 *
 * A rectangle describes the page as the publisher drew it. The reader view does not draw that page:
 * it re-sets the text in the reader's own font at the reader's own line spacing, so a rectangle
 * there means nothing. So a mark made from today on carries BOTH: `rects` (the page view, unchanged)
 * and `anchor` (the reader view). They are derived from ONE mapping — `src/components/pdfReflow.ts`
 * — read in the two directions, so the two views cannot disagree about where a highlight sits.
 *
 * `block`/`start` are HINTS. `text` is the identity, re-found by `locateMark` in src/reader/marks.ts
 * — the same model, deliberately not a second one.
 *
 * ⚠ OPTIONAL, AND IT STAYS OPTIONAL. A mark made before this existed has no anchor; Peter's call
 * was that those may go stale ("I don't care if old docs go stale"). Stale is not DELETED — an
 * un-anchorable mark is listed in the reader view as one it could not place, and the page view
 * renders it exactly as it always did.
 */
export interface TextAnchor {
  /** Index of the paragraph within that page's reflowed blocks. A hint, re-checked against `text`. */
  block: number
  /** Character offset within the block. A hint, re-checked against `text`. */
  start: number
  /** The exact reflowed text the mark covered — the thing that actually identifies it. */
  text: string
}

export interface PdfHighlight {
  id: string
  page: number            // 1-based
  rects: HighlightRect[]
  anchor?: TextAnchor     // reader-view placement; absent on marks made before the reader view
  color: string           // rgba/hex
  kind?: HighlightKind    // fill (default), underline, or strikethrough
  text: string            // the selected text (used for search fallback + display)
  note?: string           // optional annotation note
  size?: number           // text-note font size in px (defaults to 12)
  citekey?: string        // set when this highlight is linked to an in-text citation's pinpoint
  instanceId?: string     // the citation OCCURRENCE this highlight belongs to (scopes page refs per inline)
  noRef?: boolean         // made from the bib window / with "don't add pages" on → never a page reference
  createdAt: string
}

export function highlightsOf(item: CSLItem | undefined): PdfHighlight[] {
  const hs = (item as { _iw?: IwCitationMeta } | undefined)?._iw?.highlights
  return Array.isArray(hs) ? hs : []
}

/** Distinct, sorted PDF pages that carry a highlight for a source. When `instanceId` is given, only
 *  highlights tagged to THAT citation occurrence (plus legacy untagged ones) count — so each inline
 *  citation shows the pages IT pinpointed, not every highlight ever made on the source. */
export function highlightPages(item: CSLItem | undefined, instanceId?: string | null): number[] {
  const set = new Set<number>()
  const want = instanceId ?? null
  for (const h of highlightsOf(item)) {
    if (h.page <= 0 || h.noRef) continue          // noRef = never a page reference
    // Per-instance: the highlight's instance must match EXACTLY (both null = legacy doc). An untagged
    // highlight no longer leaks onto every citation, and a fresh inline starts with no auto pages.
    if ((h.instanceId ?? null) !== want) continue
    set.add(h.page)
  }
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
