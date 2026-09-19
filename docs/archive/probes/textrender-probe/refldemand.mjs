// WHAT LINE-BOX HEIGHT DOES THE `+` BUTTON ACTUALLY FORCE?
//
// The engine models an inline atom by `box.lineHeightDemand` = "the line-box height this element
// forces on its line". harvestRefChrome's first cut harvested the button's OWN rect (17.73px) — but
// the entry's last line measures 26.28px, so 17.73 is NOT the demand. The button is an inline-block
// on `vertical-align: baseline`: its box sits ON the baseline, so the line must fit the button
// ABOVE the baseline plus the strut's DESCENT below it.
//
// Rather than hand-derive that (the exact move blockStyles.ts warns is how a height becomes a
// guess), measure it: read the entry's REAL line boxes, and test the candidate rule against them.
// A rule that reproduces the observed last line is a rule; anything else is a guess.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4247}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl-demand' })
await page.evaluate(d => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => document.querySelectorAll('.node-referenceList .iw-bib-entry').length > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)

const out = await page.evaluate(() => {
  const entries = [...document.querySelectorAll('.node-referenceList .iw-bib-entry')]
  const body = document.querySelector('.node-referenceList .csl-bib-body')
  const bodyFs = parseFloat(getComputedStyle(body).fontSize)
  const bodyLh = parseFloat(getComputedStyle(body).lineHeight)

  // The strut's font metrics, from the SAME canvas configuration the renderer measures with.
  const cv = document.createElement('canvas').getContext('2d')
  cv.textRendering = 'optimizeSpeed'; cv.fontKerning = 'normal'
  const fam = getComputedStyle(body).fontFamily
  cv.font = `400 ${bodyFs}px ${fam}`
  const m = cv.measureText('Hxg')
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent

  const rows = entries.slice(0, 6).map(e => {
    // The entry's REAL line boxes — from TEXT NODES ONLY.
    // The first cut ranged over `selectNodeContents(entry)`, which DESCENDS INTO THE SUBTREE and
    // returns the inner block div's own 49.13px rect as if it were a line. That is precisely the
    // artifact the collectLines NodeView fix (f01850b) exists to kill, reproduced in the
    // instrument. Ranging each TEXT NODE separately yields inline rects only.
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
    const rects = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent || '').trim()) continue
      // The chrome's own text is not part of the entry's prose flow — tag it so we can see which
      // rects belong to the button/back-refs rather than silently blending them into a line.
      const inChrome = !!(n.parentElement && n.parentElement.closest('.iw-note-add, .iw-backref-group, .iw-esp'))
      const r = document.createRange(); r.selectNodeContents(n)
      for (const x of r.getClientRects()) {
        if (x.width > 0 && x.height > 0) rects.push({ top: x.top, h: x.height, right: x.right, inChrome })
      }
    }
    const lines = []
    for (const x of rects) {
      const hit = lines.find(l => Math.abs(l.top - x.top) < 3)
      if (hit) { hit.h = Math.max(hit.h, x.h); hit.right = Math.max(hit.right, x.right); hit.chrome = hit.chrome || x.inChrome }
      else lines.push({ top: x.top, h: x.h, right: x.right, chrome: x.inChrome })
    }
    lines.sort((a, b) => a.top - b.top)
    const btn = e.querySelector('.iw-note-add')
    const br = btn ? btn.getBoundingClientRect() : null
    const bcs = btn ? getComputedStyle(btn) : null
    const er = e.getBoundingClientRect()
    return {
      id: (e.querySelector('[id^="iwbib-"]') || {}).id,
      entryH: +er.height.toFixed(2),
      lines: lines.map(l => ({ h: +l.h.toFixed(2), top: +(l.top - er.top).toFixed(2), chrome: !!l.chrome })),
      btnH: br ? +br.height.toFixed(2) : null,
      btnValign: bcs ? bcs.verticalAlign : null,
      btnDisplay: bcs ? bcs.display : null,
    }
  })
  return { bodyFs, bodyLh: +bodyLh.toFixed(4), asc: +asc.toFixed(3), desc: +desc.toFixed(3), rows }
})

console.log(JSON.stringify(out, null, 2))

// THE RULE UNDER TEST, checked against the measured last line.
const { bodyLh, asc, desc, rows } = out
const r0 = rows[0]
const lastLine = r0.lines[r0.lines.length - 1]
const halfLead = (bodyLh - (asc + desc)) / 2
const baselineFromTop = halfLead + asc
const cand = {
  'btnH alone (what we harvested)': r0.btnH,
  'btnH + fontBoundingBoxDescent': r0.btnH + desc,
  'btnH + (lineHeight - baselineFromTop)': r0.btnH + (bodyLh - baselineFromTop),
}
console.log('\nmeasured last line =', lastLine, ' strut lineHeight =', bodyLh)
console.log('asc', asc, 'desc', desc, 'halfLeading', +halfLead.toFixed(3), 'baselineFromTop', +baselineFromTop.toFixed(3))
for (const [k, v] of Object.entries(cand)) {
  console.log(`  ${k.padEnd(40)} = ${(+v).toFixed(2)}  delta ${(v - lastLine).toFixed(2)}${Math.abs(v - lastLine) < 0.5 ? '   <== MATCHES' : ''}`)
}
await b.close()
