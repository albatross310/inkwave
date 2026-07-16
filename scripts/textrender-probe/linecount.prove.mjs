// THE PHANTOM LINE, MEASURED DIRECTLY — per block, not per break.
//
// The mid-line rate only fires when a page break HAPPENS to land on a phantom line. That makes it a
// weak instrument for a NodeView the doc has few of: inline math measured 0 mid-line breaks even
// UNFIXED — which means "no break landed on one", NOT "no phantom". So this measures the artifact
// itself: for every block, the line count the rect path reports vs the count the block really has.
//
//   truth  = line starts from the validated char/atom walk
//   old    = keepLineRects(whole-block range rects)      ← descends into NodeViews
//   fixed  = keepLineRects(blockLineRects(el, atoms))    ← atoms collapsed to one box
//
// Both run the REAL production functions. The controls (no NodeViews) must show old == truth, or the
// notion of "truth" is itself wrong and nothing here means anything.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4239}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2500)

const CASES = [
  ['plain  (CONTROL)', { cites: 0, headings: false, lists: false, refList: false }],
  ['lists  (CONTROL)', { cites: 0, headings: false, lists: true, refList: false }],
  ['citations', { cites: 29, headings: false, lists: false, refList: false }],
  ['math pills', { cites: 0, maths: 24, headings: false, lists: false, refList: false }],
  ['math + citations', { cites: 29, maths: 24, headings: true, lists: true, refList: false }],
]

let fail = 0
for (const [name, o] of CASES) {
  const doc = buildCitationDoc({ words: 2200, id: 'lc-' + name.replace(/\W+/g, '-'), ...o })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 800, null, { timeout: 60000 })
  await page.waitForTimeout(5000)
  const r = await page.evaluate(() => window.__iwTextRenderProbe.lineCountAudit())
  const isControl = name.includes('CONTROL')

  if (!r.gapsLeftFlow) { console.log(`VACUOUS ⚠ ${name} — gaps never left flow; counts are garbage`); fail++; continue }
  if (r.blocks < 5) { console.log(`BLIND   ⚠ ${name} — only ${r.blocks} blocks scanned`); fail++; continue }
  if (!isControl && r.atomBlocks === 0) { console.log(`BLIND   ⚠ ${name} — expected NodeView blocks, found 0`); fail++; continue }

  const ok = r.fixedOverCounted === 0
  console.log(
    `${ok ? 'EXACT ✓' : 'OVER  ✗'}  ${name.padEnd(18)} blocks=${String(r.blocks).padStart(3)} atomBlocks=${String(r.atomBlocks).padStart(3)}` +
    `  OLD over-counted ${String(r.oldOverCounted).padStart(3)} blocks (+${r.oldExtraLines} phantom lines)` +
    `  →  FIXED ${String(r.fixedOverCounted).padStart(3)} blocks (+${r.fixedExtraLines})`,
  )
  for (const w of r.worstOld.slice(0, 2)) console.log(`            e.g. ${w.type} #${w.i}: truth=${w.truth} old=${w.oldLines} fixed=${w.fixedLines} (atoms=${w.atoms})`)

  if (r.fixedOverCounted > 0) fail++
  // CONTROLS: no NodeViews ⇒ the old path was already exact. If it over-counts here, "truth" is wrong.
  if (isControl && r.oldOverCounted > 0) { console.log(`            ⚠ CONTROL over-counted on the OLD path — the truth definition is suspect, not the code`); fail++ }
  // KNOWN-POSITIVE: a NodeView case must show the OLD path over-counting, or this proves nothing.
  if (!isControl && r.oldOverCounted === 0) { console.log(`            ⚠ no phantom lines reproduced on the OLD path — probe blind for this NodeView`); fail++ }
}
await b.close()
process.exit(fail ? 1 : 0)
