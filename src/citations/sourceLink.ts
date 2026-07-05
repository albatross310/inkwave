// Deep-link a citation's source in the reader's OWN default browser, landing on the cited sentence.
// Uses a Text Fragment (#:~:text=…) to scroll-to + highlight the exact sentence — works for any web
// page in Chromium/Safari (no proxy, CORS or iframe limits) — and #page=N for a PDF URL. This is the
// lightweight complement to the in-app viewer: jump-to-source rather than annotate-in-app.

import type { CSLItem, IwCitationMeta } from '../types/document'

/** The best source URL for an item (explicit URL, else the captured origin page/DOI). */
export function sourceUrlOf(item: CSLItem | undefined): string | null {
  if (!item) return null
  const url = (item.URL as string | undefined) ?? (item as { _iw?: IwCitationMeta })._iw?.sourceUrl
  return url && /^https?:\/\//i.test(String(url)) ? String(url) : null
}

/** Open the source in the default browser at the cited sentence (text fragment) or page. */
export function openSourceAtPinpoint(url: string, opts: { quote?: string | null; page?: number | null } = {}): void {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(url)) return
  let target = url
  const quote = opts.quote?.trim()
  if (quote) {
    // Text Fragment. Cap the length — very long fragments can fail to match; the spec matches on the
    // exact substring, so a representative slice is safest.
    target = `${url}#:~:text=${encodeURIComponent(quote.slice(0, 300))}`
  } else if (opts.page && opts.page > 0) {
    target = `${url}#page=${opts.page}`
  }
  window.open(target, '_blank', 'noopener,noreferrer')
}
