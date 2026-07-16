// THE MID-LINE BREAK PROVER — does every LIVE page break land at a true line start?
//
// A break that lands mid-line opens a page gap in the middle of a rendered line: the "space left on
// the last line" of a split paragraph that Peter reported. `collectLines` builds its line list from
// range.getClientRects() over a whole block, which DESCENDS INTO inline NodeViews — so a citation's
// ⤵ biblink button (inline-flex, ~6px below the text line, i.e. past the 3px same-line dedup) was
// counted as its own PHANTOM LINE, and a break attributed to it lands mid-line.
//
// THE INSTRUMENT IS GATED ON BOTH POLARITIES, because a probe that cannot see the bug cannot verify
// the fix (the house disease: a self-check that measures a fiction disables what it guards silently):
//   • CONTROL (known-negative): plain prose has no NodeViews ⇒ must audit 0 mid-line breaks. If this
//     is non-zero the line-start definition itself is wrong and NOTHING here means anything.
//   • KNOWN-POSITIVE: with EXPECT_POSITIVE=1 (run against the UNFIXED build), citation-dense prose
//     must reproduce mid-line breaks. If it does not, the probe is blind and exits non-zero.
// Fixtures are SYNTHETIC (scripts/textrender-probe/fixture.mjs) — Peter's real thesis never enters
// the repo, in fixtures, output or logs.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4239}`
const EXPECT_POSITIVE = process.env.EXPECT_POSITIVE === '1'

const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2500)

// Multi-line paragraphs with citations MID-PARAGRAPH — a fixture of one-line blocks would make the
// buggy branch a no-op and the probe structurally blind (the trap that let paginate()'s tests pass
// through a real drift).
const CASES = [
  ['plain      (CONTROL — no NodeViews)', { cites: 0, headings: false, lists: false, refList: false }],
  ['headings   (CONTROL)', { cites: 0, headings: true, lists: false, refList: false }],
  ['lists      (CONTROL)', { cites: 0, headings: false, lists: true, refList: false }],
  ['citations  (THE BUG)', { cites: 29, headings: false, lists: false, refList: false }],
  ['citations UNMARKED', { cites: 29, marked: 0, headings: false, lists: false, refList: false }],
  ['citations DENSE', { cites: 60, headings: true, lists: true, refList: false }],
  // INLINE MATH — the OTHER NodeView with the same artifact (KaTeX's sub/superscript + fraction
  // spans emit off-baseline rects; arithmeticLayout.ts documents the identical one-rect remedy).
  // The collapse is type-agnostic (any PM inline atom), but "by construction" is what this codebase
  // has been burned believing, so math is measured, not assumed.
  ['math pills only', { cites: 0, maths: 24, headings: false, lists: false, refList: false }],
  ['math + citations', { cites: 29, maths: 24, headings: true, lists: true, refList: false }],
  // THE HEADLINE SAMPLE: the thesis-shaped fixture (~13k words / ~174 citations) — ~56 breaks, the
  // corpus the 6/56 mid-line rate was measured on. Synthetic prose, thesis SHAPE only.
  ['citations THESIS-SHAPE (13k)', { words: 13000, cites: 174, headings: true, lists: true, refList: false }],
]

let fail = 0
let sawPositive = 0
const rows = []
for (const [name, o] of CASES) {
  const doc = buildCitationDoc({ words: 2200, id: 'ml-' + name.replace(/\W+/g, '-'), ...o })
  const minWords = Math.min(800, Math.round((o.words ?? 2200) * 0.35))
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction((w) => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w, minWords, { timeout: 90000 })
  await page.waitForTimeout(o.words > 5000 ? 9000 : 5000)
  const r = await page.evaluate(() => window.__iwTextRenderProbe.midlineAudit())
  const isControl = name.includes('CONTROL')

  // THE INSTRUMENT MUST HAVE SEEN SOMETHING. Every failure mode here reported "0 mid-line" before —
  // indistinguishable from a pass.
  const blind = r.lineStarts < 10 || r.charsScanned < 500 || r.breaks === 0
  if (blind) { console.log(`BLIND     ⚠  ${name} — instrument scanned nothing (${JSON.stringify(r)})`); fail++; continue }
  // THE VACUITY GATE. The page-gap widget forces a line break at its own position, so an audit run
  // against the GAPPED DOM reports 0 mid-line for everything — a confident, meaningless pass. The
  // gaps must be proven out of flow (natural layout strictly shorter) before any verdict counts.
  if (!r.gapsLeftFlow) {
    console.log(`VACUOUS   ⚠  ${name} — gaps did NOT leave flow (gappedH=${r.gappedH} naturalH=${r.naturalH}); verdict would be meaningless`)
    fail++; continue
  }
  // The verdict is only readable where the RENDERING is canonical (this harness is desktop/defaults).
  if (!r.renderingIsCanonical) {
    console.log(`INCONCLUSIVE ⚠  ${name} — rendering not canonical (base ${r.baseFont}px, coarse=${r.coarse}); verdict unreadable`)
    fail++; continue
  }
  if (!isControl && r.atoms === 0) { console.log(`BLIND     ⚠  ${name} — expected NodeViews, found 0`); fail++; continue }

  rows.push({ name, ...r })
  const ok = r.midline === 0
  if (!ok) fail += isControl ? 1 : 0
  if (!isControl && r.midline > 0) sawPositive += r.midline
  console.log(
    `${ok ? 'CLEAN  ✓' : 'MIDLINE ✗'}  ${name.padEnd(36)} ${String(r.midline).padStart(2)}/${String(r.breaks).padEnd(3)} mid-line breaks` +
    `  (lineStarts=${r.lineStarts} atoms=${r.atoms} chars=${r.charsScanned})`,
  )
  for (const f of r.offenders.slice(0, 3)) console.log(`             at=${f.at} sits between true line starts ${f.prevLineStart} and ${f.nextLineStart}`)
}

const totalMid = rows.reduce((a, r) => a + r.midline, 0)
const totalBreaks = rows.reduce((a, r) => a + r.breaks, 0)
console.log(`\nTOTAL: ${totalMid}/${totalBreaks} live breaks land mid-line`)

if (EXPECT_POSITIVE) {
  // Running against the UNFIXED build: the probe MUST reproduce the bug, or it cannot verify a fix.
  if (sawPositive === 0) { console.log('\nPROBE IS BLIND ✗ — EXPECT_POSITIVE set but no mid-line break reproduced.'); fail++ }
  else console.log(`KNOWN-POSITIVE REPRODUCED ✓ — ${sawPositive} mid-line breaks visible on citation prose.`)
} else if (totalMid > 0) fail++

await b.close()
process.exit(fail ? 1 : 0)
