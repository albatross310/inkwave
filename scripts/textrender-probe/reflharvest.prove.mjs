// DO THE HARVEST SELECTORS SELECT THE ELEMENT THAT CARRIES THE BOX?
//
// blockStyles harvested `refList:wrap` from `.node-referenceList` and `refList:headerRow` from
// `.node-referenceList h2`. MEASURED: the first is the react-renderer DIV (margin/padding/border all
// 0 — the real 45px/18px/1px live on the `<section>` INSIDE it) and the second is the heading (margin
// 0 — the row's own 0.6em margin-bottom belongs to its flex PARENT). Both read zeros and called them
// the refList's geometry. This probe asserts the fixed selectors resolve to elements whose boxes are
// NON-ZERO and equal to the measured truth, and it carries the OLD selectors as live KNOWN-NEGATIVES
// that must still reproduce the zeros — a selector fix whose old form also "passes" would mean the
// probe is not reading what it thinks it is.
//
// Also asserts the corrected chrome line-demand rule (font-size x computed line-height, per
// descendant) reproduces the arrow's real 26.2807 — the rect-height rule reads 22 and is the 3.42px
// -per-entry bug reflarrow.prove.mjs established.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'

const BASE = await autoBase()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-harvest' })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)

const r = await page.evaluate(() => {
  const num = v => parseFloat(v) || 0
  const box = sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    return { mt: num(cs.marginTop), pt: num(cs.paddingTop), bt: num(cs.borderTopWidth), mb: num(cs.marginBottom), tag: el.tagName.toLowerCase() }
  }
  // The corrected demand rule, mirrored from refChrome.lineDemandOf.
  const demand = el => {
    let max = 0
    const visit = n => {
      const cs = getComputedStyle(n)
      if (cs.display === 'inline-block' || cs.display === 'inline-flex') { max = Math.max(max, n.getBoundingClientRect().height); return }
      const lh = parseFloat(cs.lineHeight)
      max = Math.max(max, Number.isFinite(lh) ? lh : n.getBoundingClientRect().height)
      for (const c of n.children) visit(c)
    }
    visit(el)
    return max
  }
  const group = document.querySelector('.node-referenceList .iw-backref-group')
  return {
    newWrap: box('.node-referenceList > section'),
    oldWrap: box('.node-referenceList'),
    newHeader: box('.node-referenceList .iw-bib-header'),
    oldHeader: box('.node-referenceList h2'),
    groupRectH: group ? +group.getBoundingClientRect().height.toFixed(4) : null,
    groupDemand: group ? +demand(group).toFixed(4) : null,
  }
})

console.log(JSON.stringify(r, null, 2))
let fail = 0
const chk = (name, cond, detail) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) fail++ }

console.log('\nPOSITIVE — the fixed selectors carry the real box:')
chk('refList:wrap is the <section>', r.newWrap && r.newWrap.tag === 'section', `tag=${r.newWrap?.tag}`)
chk('wrap marginTop 45', r.newWrap && Math.abs(r.newWrap.mt - 45) < 0.5, `${r.newWrap?.mt}`)
chk('wrap paddingTop 18', r.newWrap && Math.abs(r.newWrap.pt - 18) < 0.5, `${r.newWrap?.pt}`)
chk('wrap borderTop 1', r.newWrap && Math.abs(r.newWrap.bt - 1) < 0.5, `${r.newWrap?.bt}`)
chk('headerRow marginBottom 10.8', r.newHeader && Math.abs(r.newHeader.mb - 10.8) < 0.5, `${r.newHeader?.mb}`)

console.log('\nKNOWN-NEGATIVE — the OLD selectors must still read the zeros that made this a guess:')
chk('old wrap reads pt/bt/mt = 0', r.oldWrap && r.oldWrap.pt === 0 && r.oldWrap.bt === 0 && r.oldWrap.mt === 0,
  `pt=${r.oldWrap?.pt} bt=${r.oldWrap?.bt} mt=${r.oldWrap?.mt}`)
chk('old header reads mb = 0', r.oldHeader && r.oldHeader.mb === 0, `mb=${r.oldHeader?.mb}`)
if (r.oldWrap && (r.oldWrap.pt !== 0 || r.oldWrap.mt !== 0)) {
  console.log('  VOID: the old selector did NOT reproduce the bug — this probe is not reading what it claims')
}

console.log('\nCHROME DEMAND — rect height vs the computed line-height rule:')
chk('the group RECT is 22 (what the wrong rule read)', Math.abs(r.groupRectH - 22) < 0.6, `${r.groupRectH}`)
chk('the DEMAND is the arrow line box 26.2807', Math.abs(r.groupDemand - 26.2807) < 0.05, `${r.groupDemand}`)
chk('the two DIFFER (the bug is real, not cosmetic)', Math.abs(r.groupDemand - r.groupRectH) > 3, `delta ${(r.groupDemand - r.groupRectH).toFixed(2)}px per entry`)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} check(s) failed`)
await b.close()
process.exit(fail === 0 ? 0 : 1)
