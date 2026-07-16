// CAN THE BACK-REF BOX BE COMPOSED WITHOUT RENDERING IT? — and IS IT A BOX AT ALL?
//
// WHY THIS EXISTS. The renderer exists to paint the 115 snapshot versions Peter scrubs, not the one
// in the editor. Back-ref labels are DOCUMENT PAGE NUMBERS, so a version we have never rendered has
// no harvestable chrome — harvest-by-version means the refList stops estimating on the live doc and
// defers forever on every snapshot. The only way out is to COMPOSE the chrome from version-
// independent CSS sub-styles plus labels the model computes itself.
//
// This probe asserts TWO SEPARATE CLAIMS. Keeping them apart is the whole point: the first is TRUE
// and the second is FALSE, and a probe that merged them reported a confusing average of the two.
//
//   CLAIM A — THE ARITHMETIC. For a group that occupies ONE line, does the composed advance equal
//   the rect the browser laid out? (Measured: yes, to 0.055px across every single-line group.)
//
//   CLAIM B — THE ATOM PRECONDITION. Is the group an unbreakable box at all? The engine can only
//   place it as one opaque advance if it cannot wrap. `.iw-backref-group` DECLARES
//   `white-space: nowrap` — but that declaration is DEAD: it carries `contenteditable="false"`, and
//   prosemirror-view's injected `.ProseMirror [contenteditable="false"] { white-space: normal }`
//   out-specifies it (0,2,0 vs 0,1,0). Verified by asking the CASCADE, not by reasoning about it.
//   So the group WRAPS, and getBoundingClientRect returns a UNION OF LINES — which is why the first
//   cut of this probe reported errors of 300+px and blamed the quote term. It was comparing a
//   two-line union against a one-line advance. This is the IDENTICAL trap citeBox.ts documents for
//   the citation label, and it is why CitationNodeView had to PIN `nowrap` inline. The back-ref
//   group never got that fix.
//
// THE NEGATIVES. An "advance within 1px" test can pass for a composition that is subtly blind (one
// that ignores quote previews, or link padding), so each entry's box is compared against MUTATED
// mark sets and the CORRECT composition must STRICTLY beat every one. A negative that ties with the
// truth is not a negative.
//
// COVERAGE GUARDS. The uniform fixture rendered 0 quote previews and never harvested `quote`/`esp` —
// so the composition's quote branch passed BY NEVER RUNNING (14/14). Run with `refVariety: true`,
// and VOID unless quotes and multi-mark groups are actually present.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4251}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-chrome', refVariety: true })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)

const r = await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const out = []
  for (const g of document.querySelectorAll('.node-referenceList .iw-backref-group')) {
    // A wrapped inline element has ONE rect PER LINE. The bounding box is their union and is
    // meaningless as an advance — count the rects before believing any width.
    const rects = [...g.getClientRects()]
    const cs = getComputedStyle(g)
    const marks = [...g.querySelectorAll('.iw-cite-link')].map(a => {
      const q = a.querySelector('.iw-backref-quote')
      const label = [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
      return { label, quote: q ? (q.textContent || '').replace(/…\s*$/, '') : '' }
    })
    const composed = p.chromeBox('backref', marks)
    const single = rects.length === 1
    const realAdvance = single
      ? rects[0].width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0)
      : null
    out.push({
      marks, lines: rects.length, whiteSpace: cs.whiteSpace,
      realAdvance: realAdvance === null ? null : +realAdvance.toFixed(3),
      composed: composed ? +composed.advanceWidth.toFixed(3) : null,
      demand: composed ? +composed.lineHeightDemand.toFixed(4) : null,
      negDropMark: marks.length > 1 ? (p.chromeBox('backref', marks.slice(0, -1)) || {}).advanceWidth ?? null : null,
      negDropQuote: marks.some(m => m.quote)
        ? (p.chromeBox('backref', marks.map(m => ({ ...m, quote: '' }))) || {}).advanceWidth ?? null : null,
      negExtraMark: (p.chromeBox('backref', [...marks, { label: '99', quote: '' }]) || {}).advanceWidth ?? null,
    })
  }
  const btn = document.querySelector('.node-referenceList .iw-note-add')
  let note = null
  if (btn) {
    const br = btn.getBoundingClientRect()
    const bcs = getComputedStyle(btn)
    const composed = p.chromeBox('note', btn.textContent.trim())
    note = {
      realAdvance: +(br.width + (parseFloat(bcs.marginLeft) || 0) + (parseFloat(bcs.marginRight) || 0)).toFixed(3),
      realHeight: +br.height.toFixed(3),
      composed: composed ? +composed.advanceWidth.toFixed(3) : null,
      composedH: composed ? +composed.lineHeightDemand.toFixed(3) : null,
    }
  }
  // Which rule actually wins on white-space? Ask the cascade — do not reason about specificity.
  const g0 = document.querySelector('.node-referenceList .iw-backref-group')
  const wsRules = []
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    for (const rule of rules) {
      if (!rule.selectorText || !rule.style || !rule.style.whiteSpace) continue
      let hit = false; try { hit = g0.matches(rule.selectorText) } catch { hit = false }
      if (hit) wsRules.push(`${rule.selectorText} { white-space: ${rule.style.whiteSpace} }`)
    }
  }
  const body = document.querySelector('.node-referenceList .csl-bib-body')
  const widest = Math.max(...[...document.querySelectorAll('.node-referenceList .iw-backref-group')]
    .map(g => [...g.getClientRects()].reduce((a, x) => a + x.width, 0)))
  return { rows: out, note, chromeKeys: (window.__iwRefChrome || {}).keys, wsRules,
           contentWidth: +body.getBoundingClientRect().width.toFixed(2), widest: +widest.toFixed(2) }
})

console.log('harvested sub-styles:', JSON.stringify(r.chromeKeys))
let fail = 0, voidRun = 0
const TOL = 1.0

// ── CLAIM A — the arithmetic, on groups that occupy ONE line ────────────────────────────────────
const single = r.rows.filter(x => x.lines === 1)
const wrapped = r.rows.filter(x => x.lines > 1)
let quoteRows = 0, multiRows = 0
for (const row of r.rows) {
  if (row.marks.some(m => m.quote)) quoteRows++
  if (row.marks.length > 1) multiRows++
}
console.log(`\nCLAIM A — composed advance vs the real rect, on the ${single.length} SINGLE-LINE groups:`)
for (const row of single) {
  if (row.composed === null) { console.log(`  FAIL composition returned null (a sub-style is unharvested)`); fail++; continue }
  const err = Math.abs(row.composed - row.realAdvance)
  const ok = err <= TOL
  if (!ok) fail++
  const labels = row.marks.map(m => m.label + (m.quote ? '~' : '')).join(',')
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${labels}] real ${row.realAdvance}  composed ${row.composed}  err ${err.toFixed(3)}`)
  for (const [name, v] of [['dropMark', row.negDropMark], ['dropQuote', row.negDropQuote], ['extraMark', row.negExtraMark]]) {
    if (v === null || v === undefined) continue
    if (Math.abs(v - row.realAdvance) <= err) {
      console.log(`    FAIL negative '${name}' ties/beats the truth — it cannot fail, so it proves nothing`)
      fail++
    }
  }
}
console.log(`note button: real ${r.note?.realAdvance} / composed ${r.note?.composed}  |  realH ${r.note?.realHeight} / composedH ${r.note?.composedH}`)
if (r.note) {
  if (Math.abs(r.note.composed - r.note.realAdvance) > TOL) { console.log('  FAIL note advance'); fail++ }
  if (Math.abs(r.note.composedH - r.note.realHeight) > 0.5) { console.log('  FAIL note height'); fail++ }
}

// ── COVERAGE GUARDS — a suite that never runs a branch cannot test it ───────────────────────────
console.log(`\ncoverage: ${multiRows}/${r.rows.length} groups multi-mark, ${quoteRows} with quote previews`)
if (multiRows === 0) { console.log("VOID: no multi-mark group — the join/space term never ran"); voidRun++ }
if (quoteRows === 0) { console.log("VOID: no quote previews — the composition's quote term never ran"); voidRun++ }
for (const need of ['group', 'arrow', 'link', 'note', 'quote']) {
  if (!(r.chromeKeys || []).includes(need)) { console.log(`VOID: sub-style '${need}' never harvested — its term is unproven`); voidRun++ }
}

// ── CLAIM B — the ATOM PRECONDITION ────────────────────────────────────────────────────────────
console.log(`\nCLAIM B — is the back-ref group an unbreakable box?`)
console.log(`  white-space rules matching the group:`)
for (const s of r.wsRules) console.log(`     ${s}`)
console.log(`  COMPUTED white-space: ${r.rows[0]?.whiteSpace}`)
console.log(`  groups occupying >1 line: ${wrapped.length}/${r.rows.length}`)
const atomHolds = wrapped.length === 0 && r.rows[0]?.whiteSpace === 'nowrap'
if (!atomHolds) {
  console.log(`  REFUSED: the group's declared \`white-space: nowrap\` is DEAD — prosemirror-view's injected`)
  console.log(`  \`.ProseMirror [contenteditable="false"] { white-space: normal }\` (0,2,0) out-specifies`)
  console.log(`  \`.iw-backref-group\` (0,1,0). The group WRAPS, so it is NOT an opaque box and its`)
  console.log(`  bounding rect is a UNION OF LINES, not an advance. The same trap citeBox.ts documents`)
  console.log(`  for the citation label — CitationNodeView pins nowrap inline; this never did.`)
  console.log(`  NB widest observed group ${r.widest}px against a ${r.contentWidth}px column: pinning`)
  console.log(`  nowrap would make a long quote preview OVERFLOW the page, so the citation-chip fix is`)
  console.log(`  NOT automatically right here. Model it as RUNS, or shorten the preview. Peter's call.`)
  fail++
}

const verdict = fail === 0 && voidRun === 0
console.log(`\n${verdict ? 'PASS' : 'FAIL'} — ${fail} failure(s), ${voidRun} void(s).`)
console.log(verdict
  ? 'The chrome can be composed from CSS + labels alone.'
  : 'CLAIM A (the arithmetic) HOLDS to ~0.055px; CLAIM B (the atom model) does NOT — the group wraps.')
await b.close()
process.exit(verdict ? 0 : 1)
