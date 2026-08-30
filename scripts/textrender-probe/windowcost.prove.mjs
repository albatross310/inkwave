import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'
const BASE = await autoBase()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text','--enable-precise-memory-info'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
for (const [name, words, cites] of [['2k',2200,29],['10k',10000,80],['40k',40000,300]]) {
  const doc = buildCitationDoc({ words, cites, id:'wc-'+name })
  await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
  await page.waitForFunction((w)=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>w*0.5, words, {timeout:90000})
  await page.waitForTimeout(6000)
  const st = await page.evaluate(()=>window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(name,'PROBE BLIND'); continue }
  const r = await page.evaluate(()=>window.__iwTextRenderProbe.windowCost())
  console.log(`\n━━━ ${name} — ${r.docPages} pages | full build ${r.fullBuildMs}ms ━━━`)
  console.log(`  WINDOW EXACT: ${r.allExact}   STRICTLY BEATS NEGATIVES: ${r.allStrictlyBeatNegatives}`)
  console.log(`  WINDOW LAYOUT p50 ${r.windowP50}ms  max ${r.windowMax}ms   <-- must NOT scale with doc size`)
  for (const x of r.rows) console.log(`    page ${x.page}: ${x.windowMs}ms  lines ${x.linesLaidOut}/${x.pageLines}  ${x.match}/${x.compared} exact=${x.exact}  negs ${x.negs.map(n=>`+${n.off}:${n.match}`).join(' ')}`)
}
await b.close()
