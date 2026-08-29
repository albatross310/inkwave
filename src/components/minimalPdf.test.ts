// THE EXPORTED FILE HAS TO BE A PDF SOMEONE ELSE'S READER WILL OPEN.
//
// The whole risk of writing the container by hand is the cross-reference table: it is a list of
// BYTE offsets, and the streams are binary JPEG, so a writer that accumulates `str.length` instead
// of encoded byte length produces offsets that point into the middle of an image. Every reader then
// rejects the file — and nothing about the export *code path* would look wrong. So the test reads
// the xref back out of the bytes and follows every offset.
//
// The fixture JPEGs deliberately carry bytes ≥ 0x80. That is what makes the check DISCRIMINATING: a
// pure-ASCII fixture would give identical answers under the correct and the broken rule, and the
// test would be a tautology (see CLAUDE.md on fixtures whose classes do not overlap in the proxy
// the rule actually reads). `THE FIXTURE CAN SEE THE BUG` below proves that property rather than
// assuming it.

import { describe, it, expect } from 'vitest'
import { buildImagePdf, jpegSize, type PdfImagePage } from './minimalPdf'

/** A structurally valid JPEG: SOI, an APP0 with high bytes in it, SOF0 carrying the dims, EOI. */
function fakeJpeg(width: number, height: number, filler = 24): Uint8Array {
  const app0Payload: number[] = []
  for (let i = 0; i < filler; i++) app0Payload.push(0x80 + (i % 0x60)) // ≥0x80 ⇒ multi-byte in UTF-8
  const app0Len = app0Payload.length + 2
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, (app0Len >> 8) & 0xff, app0Len & 0xff, ...app0Payload,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ])
}

const latin1 = (b: Uint8Array) => Array.from(b, c => String.fromCharCode(c)).join('')

/** Read the trailer's startxref, then the table, exactly as a PDF reader would. */
function readXref(pdf: Uint8Array): { offsets: number[]; size: number; startxref: number } {
  const text = latin1(pdf)
  const m = /startxref\s+(\d+)\s+%%EOF/.exec(text)
  if (!m) throw new Error('no startxref/%%EOF')
  const startxref = Number(m[1])
  const table = text.slice(startxref)
  const head = /^xref\s+0 (\d+)\s/.exec(table)
  if (!head) throw new Error('xref table not at startxref')
  const size = Number(head[1])
  const body = table.slice(head[0].length) // the regex consumes the newline before entry 0
  const offsets: number[] = []
  for (let i = 0; i < size; i++) {
    const entry = body.slice(i * 20, i * 20 + 20)
    offsets.push(Number(entry.slice(0, 10)))
  }
  return { offsets, size, startxref }
}

describe('buildImagePdf', () => {
  const pages: PdfImagePage[] = [
    { jpeg: fakeJpeg(1224, 1584), widthPt: 612, heightPt: 792 },
    { jpeg: fakeJpeg(1000, 1400, 40), widthPt: 595.276, heightPt: 841.89 },
  ]

  it('THE FIXTURE CAN SEE THE BUG: the file is genuinely binary', () => {
    // The offset assertions below are only DISCRIMINATING if the file contains bytes a text-based
    // writer would mis-count. Encoding the file's own characters back as UTF-8 must therefore give
    // a DIFFERENT length: that difference is exactly the drift a `str.length` offset would take on.
    // (Note the obvious version of this check does not work — `TextDecoder` maps each invalid byte
    // to one replacement char, so decode(pdf).length === pdf.length and the assertion measures
    // nothing. It was written that way first and passed for the wrong reason.)
    const pdf = buildImagePdf(pages)
    expect(new TextEncoder().encode(latin1(pdf)).length).toBeGreaterThan(pdf.length)
    expect(pages.some(p => p.jpeg.some(b => b >= 0x80))).toBe(true)
  })

  it('every xref offset lands on that object', () => {
    const pdf = buildImagePdf(pages)
    const text = latin1(pdf)
    const { offsets, size } = readXref(pdf)
    expect(size).toBe(1 + 2 + pages.length * 3) // free entry + catalog + tree + 3 per page
    for (let id = 1; id < size; id++) {
      expect(text.slice(offsets[id], offsets[id] + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
  })

  it('startxref points at the table, and the trailer names the catalog', () => {
    const pdf = buildImagePdf(pages)
    const text = latin1(pdf)
    const { startxref, size } = readXref(pdf)
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    expect(text).toContain(`/Size ${size}`)
    expect(text).toContain('/Root 1 0 R')
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('the page tree, boxes and image dictionaries describe what was handed in', () => {
    const pdf = buildImagePdf(pages)
    const text = latin1(pdf)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/Kids [ 3 0 R 6 0 R ]')
    expect(text).toContain('/MediaBox [ 0 0 612 792 ]')
    expect(text).toContain('/MediaBox [ 0 0 595.276 841.89 ]')
    // Declared pixel dims must be the JPEG's OWN — a disagreement renders nothing.
    expect(text).toContain('/Width 1224 /Height 1584')
    expect(text).toContain('/Width 1000 /Height 1400')
    // /Length must be the raw byte count, not a character count.
    expect(text).toContain(`/Length ${pages[0].jpeg.length} >>`)
  })

  it('the image bytes survive byte-for-byte', () => {
    const pdf = buildImagePdf(pages)
    const needle = pages[1].jpeg
    let found = -1
    outer: for (let i = 0; i + needle.length <= pdf.length; i++) {
      for (let j = 0; j < needle.length; j++) if (pdf[i + j] !== needle[j]) continue outer
      found = i; break
    }
    expect(found).toBeGreaterThan(0)
  })

  it('refuses an empty document rather than emitting a file with no pages', () => {
    expect(() => buildImagePdf([])).toThrow(/no pages/)
  })
})

describe('jpegSize', () => {
  it('reads the SOF dimensions, skipping earlier segments', () => {
    expect(jpegSize(fakeJpeg(1224, 1584))).toEqual({ width: 1224, height: 1584 })
    expect(jpegSize(fakeJpeg(7, 9, 200))).toEqual({ width: 7, height: 9 })
  })

  it('KNOWN-NEGATIVE: it is really reading the marker, not guessing', () => {
    // A payload whose bytes happen to contain plausible numbers must not yield a size.
    const noSof = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x04, 0xc8, 0x03, 0x20, 0xff, 0xd9])
    expect(() => jpegSize(noSof)).toThrow(/SOF/)
    expect(() => jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/not a JPEG/)
  })

  it('does not mistake DHT (0xc4) for a start-of-frame', () => {
    const withDht = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc4, 0x00, 0x07, 0x00, 0x01, 0x02, 0x03, 0x04,   // DHT, deliberately in the SOF range
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x00, 0xc8,   // progressive SOF2: 300 × 200
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ])
    expect(jpegSize(withDht)).toEqual({ width: 200, height: 300 })
  })
})
