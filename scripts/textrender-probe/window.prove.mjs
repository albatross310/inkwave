// THE CRUX: can the visible window be laid out WITHOUT paginating from the document start?
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4233}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text','--enable-precise-memory-info'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
for (const [name, words, cites] of [['2k',2200,29],['10k',10000,80],['40k',40000,300]]) {
  const doc = buildCitationDoc({ words, cites, id:'win-'+name })
  await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
  await page.waitForFunction((w)=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>w*0.5, words, {timeout:90000})
  await page.waitForTimeout(6000)
  const st = await page.evaluate(()=>window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(name, 'PROBE BLIND'); continue }
  const w = await page.evaluate(()=>window.__iwTextRenderProbe.windowProof())
  console.log(`\n━━━ ${name} (${w.pages} pages) ━━━`)
  console.log('  PREFIX-FREE WINDOW LAYOUT EXACT:', w.allExact, ' | differ-sees-known-negative:', w.seesKnownNegative)
  for (const r of w.tested) console.log(`    page ${r.pageIdx}: ${r.match}/${r.compared} line starts match  exact=${r.exact}  tailBuild=${r.tailBuildMs}ms`)
  console.log('    known-negative (cut off by 2):', JSON.stringify(w.knownNegative))
  const sp = await page.evaluate(()=>window.__iwTextRenderProbe.storeProof(116, true))
  console.log(`  STORE 116 versions: models kept ${sp.cachedModels}/116, dropped ${sp.droppedCount}, ${sp.mbEst}MB (budget ${(sp.budget/1048576).toFixed(0)}MB touch)`)
  console.log(`    fat ${sp.mbPerVersion}MB/version -> x116 = ${sp.fatMBat116}MB   |   LEAN (geometry only) ${sp.leanMBPerVersion}MB/version -> x116 = ${sp.leanMBat116}MB`)
  console.log(`    whole-doc versions ${sp.wholeDocVersions}/${sp.cachedModels}, pages/version ${sp.pagesPerVersion}, lastPageReachableByContent=${sp.lastPageReachableByContent}, buildMs/version ${sp.buildMsPerVersion}`)
}
await b.close()
