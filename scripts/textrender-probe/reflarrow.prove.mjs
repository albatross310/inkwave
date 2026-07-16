// WHAT RAISES THE ENTRY'S LAST LINE? — a CAUSAL test, not an arithmetic coincidence.
//
// CLAIM: a bibliography entry is 49.13px, not the 45.71px its 2 x 22.8528 line-height implies,
// because `.iw-backref-arrow` sets `font-size: 1.15em` while `.csl-bib-body` sets a UNITLESS
// `line-height: 1.38`. A unitless line-height inherits as a RATIO, so the arrow's line box is
// 16.56 x 1.15 x 1.38 = 26.2807 — taller than the 22.8528 strut. The `+` note button (17.73px)
// does NOT bind and is NOT the cause.
//
// WHY THIS PROBE EXISTS. The arithmetic agrees to 0.0035px, which is exactly the kind of agreement
// this codebase has been burned by (a crux test whose known-negative scored identically BY
// CONSTRUCTION). Numbers that add up are a hypothesis, not a mechanism. So: REMOVE the arrow from
// the live DOM and see whether the height actually falls to the strut prediction, and remove the
// BUTTON as a KNOWN-NEGATIVE that must NOT move the height. If the negative moves it, my causal
// story is wrong and the verdict is void.
//
// Exits nonzero unless: (1) removing the arrow lands the entry within 0.5px of 2 x strut, AND
// (2) removing the button alone leaves the height unchanged.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4247}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-arrow' })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)

const r = await page.evaluate(() => {
  const body = document.querySelector('.node-referenceList .csl-bib-body')
  const fs = parseFloat(getComputedStyle(body).fontSize)
  const lhRatio = parseFloat(getComputedStyle(body).lineHeight) / fs
  const entries = [...document.querySelectorAll('.node-referenceList .iw-bib-entry')]
  const h = e => +e.getBoundingClientRect().height.toFixed(3)

  // Pick entries that are 2 lines with an arrow — the shape the claim is about.
  const subjects = entries.filter(e => e.querySelector('.iw-backref-arrow')).slice(0, 6)
  const before = subjects.map(h)

  // KNOWN-NEGATIVE FIRST: remove ONLY the note button. If the button were what raises the line,
  // this moves the height. The claim says it must not.
  const btnHeights = subjects.map(e => {
    const btn = e.querySelector('.iw-note-add')
    if (!btn) return null
    btn.style.display = 'none'
    return h(e)
  })
  subjects.forEach(e => { const btn = e.querySelector('.iw-note-add'); if (btn) btn.style.display = '' })

  // THE POSITIVE: shrink the arrow to the body font size, so its line box == the strut.
  const arrowHeights = subjects.map(e => {
    const a = e.querySelector('.iw-backref-arrow')
    a.style.fontSize = '1em'
    return h(e)
  })

  return { fs, lhRatio, before, btnHeights, arrowHeights, strut: fs * lhRatio, n: subjects.length }
})

const strut = r.strut
const predictTwoStrut = 2 * strut
const predictWithArrow = strut + strut * 1.15
console.log(`body ${r.fs}px  lineHeight ratio ${r.lhRatio.toFixed(4)}  strut ${strut.toFixed(4)}`)
console.log(`subjects: ${r.n}`)
console.log(`\nbefore (arrow at 1.15em):  ${r.before.join(', ')}`)
console.log(`  predicted strut + arrow  = ${predictWithArrow.toFixed(4)}`)
console.log(`\nKNOWN-NEGATIVE  remove the + button: ${r.btnHeights.join(', ')}`)
console.log(`  must be UNCHANGED from before`)
console.log(`\nPOSITIVE  arrow -> 1em:    ${r.arrowHeights.join(', ')}`)
console.log(`  predicted 2 x strut      = ${predictTwoStrut.toFixed(4)}`)

let fail = 0
// (1) the negative must NOT move the height
for (let i = 0; i < r.before.length; i++) {
  if (r.btnHeights[i] === null) continue
  if (Math.abs(r.btnHeights[i] - r.before[i]) > 0.5) {
    console.log(`FAIL negative fired: entry ${i} moved ${r.before[i]} -> ${r.btnHeights[i]} when only the BUTTON was removed`)
    fail++
  }
}
// (2) the positive must land on the strut prediction
for (let i = 0; i < r.arrowHeights.length; i++) {
  if (Math.abs(r.arrowHeights[i] - predictTwoStrut) > 0.5) {
    console.log(`FAIL positive: entry ${i} = ${r.arrowHeights[i]}, predicted ${predictTwoStrut.toFixed(3)}`)
    fail++
  }
}
// (3) GUARD: the test is vacuous unless the arrow removal actually CHANGED something.
const moved = r.arrowHeights.filter((x, i) => Math.abs(x - r.before[i]) > 0.5).length
if (moved === 0) {
  console.log('VOID: shrinking the arrow changed NO entry height — the probe cannot see its own effect')
  fail++
}
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — the arrow's 1.15em x unitless 1.38 line-height is what raises the entry's last line` +
  `${fail === 0 ? `; the + button does not (${moved}/${r.n} entries moved when the arrow shrank)` : ''}`)
await b.close()
process.exit(fail === 0 ? 0 : 1)
