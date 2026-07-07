// Resolve a source's PDF bytes from the device-local store (OPFS). URL-referenced PDFs (and the
// /api/pdf?proxy= CORS relay they needed) were removed 2026-07-08: they were slow, often blocked
// by publishers, and were the one PDF path that passed bytes through our server. A source has a
// PDF iff a file is embedded; legacy `pdfUrl` entries in old documents are simply inert.

import { loadPdf } from './pdfStore'
import type { CSLItem, IwCitationMeta } from '../types/document'

/** True if a source has an embedded PDF. */
export function hasPdf(item: CSLItem | undefined): boolean {
  const iw = (item as { _iw?: IwCitationMeta } | undefined)?._iw
  return !!iw?.pdfName
}

/** Fetch a source's PDF bytes from OPFS (null if none embedded). */
export async function getPdfData(citekey: string): Promise<ArrayBuffer | null> {
  const blob = await loadPdf(citekey)
  return blob ? blob.arrayBuffer() : null
}
