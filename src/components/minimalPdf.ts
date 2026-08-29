// A minimal, dependency-free PDF writer: one JPEG image per page.
//
// WHY THIS EXISTS AT ALL, since the print view can already reach the browser's "Save as PDF":
// Peter asked for TWO things — "export and print … as a pdf … or to printer". The print dialog is
// the printer path, and Save-as-PDF inside it is a *setting on a dialog*, not an Export button: it
// costs a dialog, a dropdown and a save sheet, it is absent or differently-named across platforms,
// and on iOS it is a share sheet. So Export produces a FILE, directly, from the same pixels.
//
// WHY NOT pdf-lib: it would be a new runtime dependency for the one operation below, whose entire
// job is to wrap already-encoded JPEG bytes in the smallest legal PDF skeleton. That skeleton is
// ~80 lines and is pinned by tests that parse the output back. A dependency is not free here — this
// is a PWA whose load path is guarded page by page (CLAUDE.md, "Load performance").
//
// WHAT IT IS NOT: the output is a RASTER of the marked-up pages, so its text is not selectable.
// That is inherent to exporting a document whose marks are DOM overlays, not PDF annotations — the
// browser's own Save-as-PDF of the same print view rasterises the canvases identically. It is
// stated in the UI, not hidden.

/** One page: an encoded JPEG plus the page box in POINTS (1/72") the image should fill. */
export interface PdfImagePage {
  jpeg: Uint8Array
  /** Page width in points (a pdf.js viewport at scale 1 is already in points). */
  widthPt: number
  /** Page height in points. */
  heightPt: number
}

const enc = new TextEncoder()

/** Fixed-width xref entry: exactly 20 bytes, per PDF 32000-1 §7.5.4. */
function xrefEntry(offset: number, gen: number, type: 'n' | 'f'): string {
  return `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${type} \n`
}

/** Points, trimmed: PDF wants a number, not `612.0000000001`. */
function num(n: number): string {
  return (Math.round(n * 1000) / 1000).toString()
}

/**
 * Assemble the pages into a single PDF file.
 *
 * Object layout (the ids are load-bearing — the xref is built from the same table):
 *   1        catalog
 *   2        page tree
 *   3+3i     page i
 *   4+3i     page i's content stream
 *   5+3i     page i's image XObject
 *
 * ⚠ OFFSETS ARE BYTE OFFSETS, NOT STRING LENGTHS. The streams are binary JPEG, so a writer that
 * accumulates `str.length` produces an xref pointing into the middle of an image and yields a file
 * every reader rejects. Every chunk is measured after encoding; `minimalPdf.test.ts` reads the xref
 * back and asserts each offset lands on `<n> 0 obj`, which is exactly what that mistake breaks.
 */
export function buildImagePdf(pages: PdfImagePage[]): Uint8Array {
  if (!pages.length) throw new Error('buildImagePdf: no pages')

  const chunks: Uint8Array[] = []
  let offset = 0
  /** offsets[objId] = byte offset of that object's `N 0 obj` header. */
  const offsets: number[] = []

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    chunks.push(bytes)
    offset += bytes.length
  }
  const obj = (id: number, body: string) => {
    offsets[id] = offset
    push(`${id} 0 obj\n${body}\nendobj\n`)
  }

  // Header. The binary comment on line 2 is the conventional marker telling readers (and any
  // transport that might mangle line endings) that the file is not text.
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  obj(2, `<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>`)

  pages.forEach((pg, i) => {
    const pageId = 3 + i * 3
    const contentId = pageId + 1
    const imageId = pageId + 2
    const w = num(pg.widthPt)
    const h = num(pg.heightPt)

    obj(pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${w} ${h} ] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)

    // Draw the image over the whole MediaBox: `cm` scales the unit square an image is drawn into.
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`
    offsets[contentId] = offset
    push(`${contentId} 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`)

    const { width, height } = jpegSize(pg.jpeg)
    offsets[imageId] = offset
    push(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`)
    push(pg.jpeg)
    push('\nendstream\nendobj\n')
  })

  // xref. Entries must be contiguous from object 0, so every id in the table above must be filled.
  const maxId = 2 + pages.length * 3
  const startxref = offset
  let xref = `xref\n0 ${maxId + 1}\n` + xrefEntry(0, 65535, 'f')
  for (let id = 1; id <= maxId; id++) {
    const at = offsets[id]
    if (at === undefined) throw new Error(`buildImagePdf: object ${id} was never written`)
    xref += xrefEntry(at, 0, 'n')
  }
  push(xref)
  push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/**
 * Pixel dimensions from a JPEG's SOF marker.
 *
 * The image dictionary must declare /Width and /Height, and they must be the JPEG's OWN dimensions
 * — a reader that disagrees with the DCT data renders nothing. Taking them from the canvas we
 * encoded would usually agree, but "usually" is how a wrong number survives; reading the bytes we
 * are actually embedding cannot drift from them.
 */
export function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG')
  let i = 2
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) { i++; continue }             // resync past fill bytes
    const marker = jpeg[i + 1]
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3]
    // SOF0..SOF15, minus the DHT / JPG / DAC markers that share the 0xc0-0xcf range.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: (jpeg[i + 5] << 8) | jpeg[i + 6], width: (jpeg[i + 7] << 8) | jpeg[i + 8] }
    }
    if (len < 2) throw new Error('malformed JPEG segment')
    i += 2 + len
  }
  throw new Error('JPEG has no SOF marker')
}
