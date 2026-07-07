// Tiny event bus that lets an in-text citation (rendered in an isolated Tiptap React root) ask the
// app-level PDF side panel to open a source's embedded PDF at a given page. Decoupled via a window
// CustomEvent so the two React trees don't need to share context.

export interface OpenPdfDetail {
  citekey: string
  page?: number | null
  label?: string        // human label for the panel header (e.g. the in-text citation text)
  quote?: string | null // a stored pinpoint sentence to scroll to + highlight on open
  instanceId?: string | null // the citation OCCURRENCE — scopes highlights/page refs to this inline
  context?: string | null    // the sentence in the editor just before the citation (shown for context)
  noRef?: boolean            // opened from the bibliography → annotations must NOT create page refs/links
  onLink?: (quote: string, page: number) => void // present when opened from a citation → set its pinpoint
}

export const OPEN_PDF_EVENT = 'inkwave:open-pdf'

export function openPdf(detail: OpenPdfDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OpenPdfDetail>(OPEN_PDF_EVENT, { detail }))
}

// Last viewed page per source PDF, so clicking a citation's author-year reopens where the reader left
// off. Module-level (survives the viewer unmounting); the viewer reports its top visible page here.
const lastPageByKey = new Map<string, number>()
export function setLastPdfPage(citekey: string, page: number): void { if (page > 0) lastPageByKey.set(citekey, page) }
export function getLastPdfPage(citekey: string): number | null { return lastPageByKey.get(citekey) ?? null }

// Extract the first page number from a citation locator ("45", "p. 45", "pp. 45–47", "ch. 3, 45").
// Returns null when there's no numeric page (e.g. "ch. 3" alone) — the viewer then opens at page 1.
export function pageFromLocator(locator?: string | null): number | null {
  if (!locator) return null
  const m = /\d+/.exec(locator)
  return m ? Number(m[0]) : null
}
