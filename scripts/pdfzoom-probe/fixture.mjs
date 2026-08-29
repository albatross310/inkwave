// A DETERMINISTIC PDF, GENERATED — never one of Peter's own documents (CLAUDE.md: his prose never
// enters this repo, its fixtures, logs or screenshots). Hand-written PDF 1.4 bytes: base-14
// Helvetica, no embedding, no dependency. The same input gives the same file every time, so a
// measurement taken against it is reproducible.
//
// It must have a REAL TEXT LAYER: PdfViewer's default view is fit-to-TEXT, computed from
// `textExtentsOf` (pdf.js getTextContent). A blank page would take the page-fit branch instead and
// the probe would be measuring a different code path from the one Peter uses.

const LINES_PER_PAGE = 34

/** A page's content stream: left-aligned lines inside a known text block. */
function contentStream(pageNo, { x0, top, leading, size }) {
  const parts = [`BT /F1 ${size} Tf ${leading} TL 1 0 0 1 ${x0} ${top} Tm`]
  for (let i = 0; i < LINES_PER_PAGE; i++) {
    // Deterministic filler: no prose from anywhere, just an index-derived line of words.
    const n = pageNo * 100 + i
    const words = Array.from({ length: 11 }, (_, w) => `w${n}${String.fromCharCode(97 + ((n + w) % 26))}${w}`)
    parts.push(`(p${pageNo} l${String(i).padStart(2, '0')} ${words.join(' ')}) Tj T*`)
  }
  parts.push('ET')
  return parts.join('\n')
}

/**
 * @param {{pages?:number,width?:number,height?:number}} opts
 * @returns {Uint8Array}
 */
export function makePdf({ pages = 6, width = 612, height = 792 } = {}) {
  const objects = []
  const add = (s) => { objects.push(s); return objects.length }

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = []
  // Reserve the Pages object id so each Page can name its parent.
  const pagesId = objects.length + 1
  add('') // placeholder, filled below
  for (let p = 1; p <= pages; p++) {
    const stream = contentStream(p, { x0: 72, top: height - 90, leading: 18, size: 11 })
    const cid = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`))
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pages} >>`
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  // Serialise with a real xref table — pdf.js will happily recover from a broken one, and a probe
  // whose fixture is quietly repaired is a probe measuring the repair.
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = [0]
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}
