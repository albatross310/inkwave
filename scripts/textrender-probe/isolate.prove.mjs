import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'
const BASE = await autoBase()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
const CASES = [
  ['plain (no cites, no headings, no lists, no refs)', { cites:0, headings:false, lists:false, refList:false }],
  ['headings only',                                    { cites:0, headings:true,  lists:false, refList:false }],
  ['lists only',                                       { cites:0, headings:false, lists:true,  refList:false }],
  ['citations only',                                   { cites:29, headings:false, lists:false, refList:false }],
  ['citations UNMARKED only',                          { cites:29, marked:0, headings:false, lists:false, refList:false }],
  ['refList only',                                     { cites:0, headings:false, lists:false, refList:true }],
]
for (const [name, o] of CASES) {
  const doc = buildCitationDoc({ words: 2200, id: 'iso-'+name.replace(/\W+/g,'-'), ...o })
  await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
  await page.waitForFunction(()=>!!window.__iwTextRenderProbe&&window.__iwTextRenderProbe.words()>800,null,{timeout:60000})
  await page.waitForTimeout(5000)
  const r = await page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    const { model } = p.build()
    return { mine: model.breaks.map(x=>x.at), live: p.liveBreaks(), rel: model.breaksReliable, est: model.estimatedBlocks }
  })
  const same = r.mine.length===r.live.length && r.mine.every((v,i)=>v===r.live[i])
  console.log(`${same?'IDENTICAL ✓':'DIVERGE   ✗'}  ${name.padEnd(46)} mine[0]=${r.mine[0]??'-'} live[0]=${r.live[0]??'-'} (gaps ${r.mine.length}/${r.live.length}) reliable=${r.rel}`)
}
await b.close()
