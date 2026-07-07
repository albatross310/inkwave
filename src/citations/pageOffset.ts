// One-time detection of a PDF's "sheet index → printed page number" offset, via Haiku vision.
// Renders a few representative pages to PNG, asks the server (api/summarise { pageNumbers }) what
// number is printed on each, and stores a single arabic offset on the source (_iw.pageOffset) so
// displayed citation pages are the book's real pages, not the PDF's sheet count.
//
// Front matter (roman-numeral preface) is handled by only trusting ARABIC results — those come from
// the main body, whose offset is what we want. If detection fails for any reason we store offset 0
// with flag 'raw' (use the PDF's own pages, flagged as unverified).

import { getPdfjs, PDF_DOC_PARAMS } from './pdfjsSetup'
import { getPdfData } from './pdfSource'
import { bibProvider } from './bibProvider'
import { addToLibrary } from './library'
import type { IwCitationMeta, CSLItem } from '../types/document'
import { urlLookupEnabled } from '../editor/aiSettings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPagePng(doc: any, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1.1 }) // enough for header/footer digits, small payload
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas.toDataURL('image/png').split(',')[1] // strip the data: prefix
}

/** Detect + persist the page offset for a source's embedded PDF. Safe to fire-and-forget. */
export async function detectPageOffset(citekey: string): Promise<void> {
  // Privacy gate: sends rendered PDF page images to Anthropic via our server — opt-in only
  // (bundled under the URL-lookup consent; see editor/aiSettings.ts).
  if (!urlLookupEnabled()) return
  let offset = 0
  let flag: 'verified' | 'raw' = 'raw'
  try {
    const bytes = await getPdfData(citekey)
    if (!bytes) return
    const pdfjs = await getPdfjs()
    const task = pdfjs.getDocument({ data: bytes, ...PDF_DOC_PARAMS })
    const doc = await task.promise
    const n = doc.numPages
    // Sample content pages (skip the cover; bias to the body where arabic numbers live).
    const samples = [...new Set(
      [Math.max(2, Math.round(n * 0.3)), Math.round(n * 0.55), Math.round(n * 0.8)]
        .filter(p => p >= 1 && p <= n),
    )]
    const images: Array<{ page: number; data: string }> = []
    for (const p of samples) images.push({ page: p, data: await renderPagePng(doc, p) })
    void task.destroy()

    const res = await fetch('/api/summarise', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageNumbers: { images } }),
    })
    if (!res.ok) throw new Error(`api ${res.status}`)
    const { results } = await res.json() as { results?: Array<{ sheet: number; printed: string | null }> }

    // Offset from arabic-numbered pages only (roman front matter is ignored). Take the most common.
    const counts = new Map<number, number>()
    for (const r of results ?? []) {
      const printed = String(r.printed ?? '').trim()
      if (!/^\d+$/.test(printed)) continue
      const o = Number(printed) - Number(r.sheet)
      counts.set(o, (counts.get(o) ?? 0) + 1)
    }
    if (counts.size) {
      offset = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      flag = 'verified'
    }
  } catch {
    offset = 0
    flag = 'raw'
  }

  const cur = bibProvider.get(citekey)
  if (!cur) return
  const iw: IwCitationMeta = { ...((cur as { _iw?: IwCitationMeta })._iw ?? {}), pageOffset: offset, pageOffsetFlag: flag }
  await addToLibrary({ ...cur, _iw: iw })
}

/** The source's PDF-sheet → printed-page offset (0 if unknown). */
export function pageOffsetOf(item: CSLItem | undefined): number {
  return (item as { _iw?: IwCitationMeta } | undefined)?._iw?.pageOffset ?? 0
}
