// Resolve a source's PDF bytes, whether it's an embedded PDF (OPFS) or a URL-referenced one (fetched
// on demand through the CORS proxy at /api/pdf?proxy=). Callers get an ArrayBuffer either way, so the
// viewer + page-offset detection treat both the same.

import { loadPdf } from './pdfStore'
import { bibProvider } from './bibProvider'
import type { CSLItem, IwCitationMeta } from '../types/document'

const iwOf = (citekey: string): IwCitationMeta | undefined =>
  (bibProvider.get(citekey) as { _iw?: IwCitationMeta } | undefined)?._iw

/** The remote PDF URL set on a source, or null. */
export function pdfUrlOf(citekey: string): string | null {
  const u = iwOf(citekey)?.pdfUrl
  return u && /^https?:\/\//i.test(u) ? u : null
}

/** True if a source has any PDF — embedded bytes or a URL. */
export function hasPdf(item: CSLItem | undefined): boolean {
  const iw = (item as { _iw?: IwCitationMeta } | undefined)?._iw
  return !!(iw?.pdfName || iw?.pdfUrl)
}

/** Fetch a source's PDF bytes: local OPFS first, else the URL via the proxy. */
export async function getPdfData(citekey: string): Promise<ArrayBuffer | null> {
  const blob = await loadPdf(citekey)
  if (blob) return blob.arrayBuffer()
  const url = pdfUrlOf(citekey)
  if (!url) return null
  try {
    const res = await fetch(`/api/pdf?proxy=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}
