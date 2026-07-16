// ZOOM INVARIANCE — verified, not asserted.
//
// Peter assumed zoom forces every text window to be recalculated. The claim under test is the
// opposite: canonical pagination measures breaks in a FORCED canonical context and applies them as
// document-position widgets ("same text on page N at every zoom, on phone, and in print"), so the
// break table should be zoom-INVARIANT and zoom should collapse to a scale factor on the paint.
//
// This is exactly why zoom/DPR are absent from contextSig, so it must be PROVED, not assumed:
// a cheap zoom that silently paints last-zoom's line breaks is worse than an expensive correct one.
//
// KNOWN-NEGATIVE: a real context change (narrower column) MUST move the breaks — already proved in
// table.prove.mjs, and re-asserted here so this file's comparison can fail.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4240}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'zoom' })
await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
await page.waitForFunction(()=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>1000,null,{timeout:60000})
await page.waitForTimeout(6000)

const snap = async (label) => await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const { model } = p.build()
  return { live: p.liveBreaks(), mine: model.breaks.map(b=>b.at), pages: model.pages }
})

const base = await snap()
console.log(`zoom 1.00 : live ${base.live.length} gaps  mine ${base.mine.length}  first live=${base.live[0]} mine=${base.mine[0]}`)
const eq = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i])
console.log(`  table matches live at zoom 1: ${eq(base.mine, base.live)}`)

for (const z of [1.25, 1.5, 2.0, 0.75]) {
  await page.evaluate((z) => {
    const s = document.querySelector('.inkwave-editor-surface')
    s.style.setProperty('--iw-editor-zoom', String(z))
    window.dispatchEvent(new CustomEvent('inkwave:zoom-settled'))
  }, z)
  await page.waitForTimeout(3500)
  const r = await snap()
  const liveSame = eq(r.live, base.live)
  const mineSame = eq(r.mine, base.mine)
  console.log(`zoom ${z.toFixed(2)} : LIVE breaks unchanged=${liveSame}  MY table unchanged=${mineSame}  table==live=${eq(r.mine,r.live)}  (live ${r.live.length} gaps, first=${r.live[0]})`)
}
// restore + known-negative re-assert
await page.evaluate(() => {
  const s = document.querySelector('.inkwave-editor-surface')
  s.style.removeProperty('--iw-editor-zoom')
  window.dispatchEvent(new CustomEvent('inkwave:zoom-settled'))
})
await page.waitForTimeout(3000)
const tp = await page.evaluate(()=>window.__iwTextRenderProbe.tableProof())
console.log(`\nknown-negative still discriminates (narrower column MOVES the table): ${tp.seesKnownNegative}`)
console.log(`portable across rebuild: ${tp.portableAcrossRebuild}`)
await b.close()
