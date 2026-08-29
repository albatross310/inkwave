// A DETERMINISTIC MULTI-PAGE PDF, BUILT BY HAND.
//
// The reader view's whole job is to re-set a PDF's text, so a probe of it needs a PDF whose text it
// KNOWS — every line, at every coordinate. Three ways of getting one were rejected:
//   - one of Peter's own sources: his prose never enters this repo, its fixtures, logs or
//     screenshots. Not negotiable and not worth arguing about.
//   - a PDF checked into the repo as bytes: opaque. When the probe says "the reader dropped a
//     paragraph" nobody can check whether the paragraph was ever there.
//   - a generator library: another dependency, and its output is only as knowable as its docs.
// So the bytes are written here, from text that is right above them, with uncompressed content
// streams you can read with `strings`.
//
// ⚠ THE GEOMETRY IS THE FIXTURE, not the words. `buildPageReflow` decides paragraph boundaries from
// leading, indents, line length and glyph size — so the numbers below are chosen against ITS
// thresholds and a change to them changes what this file proves:
//   · body 11pt on 15pt leading   ⇒ intra-paragraph gap 4.0px, well under the 0.65×H (≈7.2px) break
//   · a 25pt step between paragraphs ⇒ gap 14px, comfortably over it
//   · every non-final line ≥ 60 chars ⇒ over the 0.62-of-measure "this line stopped early" backstop
//   · headings at 18pt vs an 11pt body ⇒ over BOTH the 0.28 size-change break and the 1.22 heading flag
// If a threshold in pdfReflow.ts moves, this fixture must be re-derived rather than nudged until the
// probe goes green — a fixture tuned to keep a probe passing is how a probe stops measuring.

const PAGE_W = 612, PAGE_H = 792
const LEFT = 72, TOP_Y = 720
const BODY_PT = 11, HEAD_PT = 18
const LEADING = 15          // baseline-to-baseline inside a paragraph
const PARA_STEP = 25        // baseline-to-baseline across a paragraph boundary
const HEAD_GAP = 30         // heading baseline → first body baseline

// ── the text, written out in full so an assertion can quote it ──────────────────────────────────
// Synthetic prose about harbour surveying: neutral, unmistakably not anyone's real writing, and
// long-lined enough that every line clears the short-line backstop.
export const PAGES = [
  {
    heading: 'On the Reading of Tide Tables',
    paras: [
      [
        'The harbour master keeps a ledger of the water, and the ledger is older than the pier.',
        'Each column of it records a height above the datum stone that was set in the north wall,',
        'and each row records an hour at which some person stood in the cold and read the mark.',
        'What the table therefore contains is not the sea but a long sequence of small readings,',
        'and the difference between those two things is the whole difficulty of using the table.',
      ],
      [
        'Consider the anomalous quartz gnomon that the survey of that year left on the breakwater.',
        'It was placed to settle an argument about refraction and it settled nothing whatsoever,',
        'because the argument had never been about the instrument in the first instance at all.',
        'A reading is a claim, and a claim carries the whole apparatus that was used to make it.',
      ],
    ],
  },
  {
    heading: 'Second: The Harbour Survey',
    paras: [
      [
        'The second survey was carried out in weather that the first survey had not encountered,',
        'and its figures differ from the earlier ones by rather more than the instruments allow.',
        'Two explanations were offered at the time and both of them are still perfectly available,',
        'though the papers that would decide between them went into the harbour with the shed.',
      ],
      [
        'A later hand has written in the margin that the discrepancy is entirely accounted for,',
        'which is the kind of remark that closes an enquiry without ever having opened it once.',
        'The marginal note is undated, unsigned, and written in an ink the ledger does not use.',
      ],
    ],
  },
  {
    heading: 'Third: Notes on Instruments',
    paras: [
      [
        'Every instrument in the shed was calibrated against one brass rule kept in a drawer,',
        'and nobody now living can say what that brass rule was itself calibrated against once.',
        'This is not a scandal; it is the ordinary condition of measurement in a working harbour,',
        'and the ledger is worth more, not less, for admitting the chain it hangs at the end of.',
      ],
    ],
  },
]

/** The block texts the reader view should show for a page — lines joined by single spaces, exactly
 *  as buildPageReflow joins them. This is the probe's independent expectation, derived from the
 *  fixture rather than from the code under test. */
export function expectedBlocks(pageIdx) {
  const p = PAGES[pageIdx]
  return [p.heading, ...p.paras.map(lines => lines.join(' '))]
}

/** A phrase that occurs exactly once in the whole fixture — the highlight's identity. */
export const UNIQUE_PHRASE = 'anomalous quartz gnomon'
/** The page (1-based) and block index that phrase lives in. */
export const UNIQUE_AT = { page: 1, block: 2 }

// ── the bytes ───────────────────────────────────────────────────────────────────────────────────

const esc = (s) => {
  if (/[()\\]/.test(s)) throw new Error(`fixture text must not contain parens or backslashes: ${s}`)
  if (/[^\x20-\x7e]/.test(s)) throw new Error(`fixture text must be printable ASCII: ${s}`)
  return s
}

function contentStream(page) {
  const out = ['BT']
  let y = TOP_Y
  out.push(`/F2 ${HEAD_PT} Tf`, `1 0 0 1 ${LEFT} ${y} Tm`, `(${esc(page.heading)}) Tj`)
  y -= HEAD_GAP
  out.push(`/F1 ${BODY_PT} Tf`)
  page.paras.forEach((lines, pi) => {
    if (pi > 0) y -= PARA_STEP - LEADING       // the extra step on top of the ordinary leading
    lines.forEach((line) => {
      out.push(`1 0 0 1 ${LEFT} ${y} Tm`, `(${esc(line)}) Tj`)
      y -= LEADING
    })
  })
  out.push('ET')
  return out.join('\n')
}

/** The fixture as a Uint8Array. Byte-identical on every run — no dates, no ids, no compression. */
export function buildFixturePdf() {
  const objs = []                                  // 1-based; objs[i] is object i+1
  const add = (body) => { objs.push(body); return objs.length }

  add('')                                           // 1: catalog (filled below)
  add('')                                           // 2: pages
  const pageIds = []
  const contentIds = []
  for (const p of PAGES) {
    const cs = contentStream(p)
    const pageId = add('')
    const contentId = add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`)
    pageIds.push(pageId); contentIds.push(contentId)
  }
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>')

  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  pageIds.forEach((id, i) => {
    objs[id - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
  })

  let out = '%PDF-1.4\n'
  const offsets = [0]
  objs.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array([...out].map(c => c.charCodeAt(0)))
}

/** The fixture as a base64 string — how it crosses into the page for seeding. */
export function fixtureBase64() {
  return Buffer.from(buildFixturePdf()).toString('base64')
}
