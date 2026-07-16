// BREAK TABLE: size, build cost, and the PORTABILITY claim verified against a known-negative.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4238}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text','--enable-precise-memory-info'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
for (const [name, words, cites] of [['2k (proposal shape)',2200,29],['13k (thesis shape)',13000,174],['40k',40000,300]]) {
  const doc = buildCitationDoc({ words, cites, id:'tbl-'+words })
  await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
  await page.waitForFunction((w)=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>w*0.5, words, {timeout:90000})
  await page.waitForTimeout(6000)
  const st = await page.evaluate(()=>window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(name,'PROBE BLIND'); continue }
  const r = await page.evaluate(()=>window.__iwTextRenderProbe.tableProof())
  console.log(`\n━━━ ${name} — ${r.pages} pages ━━━`)
  console.log(`  table: ${r.kbPerVersion}KB/version (${r.bytesPerPage}B/page) -> x116 versions = ${r.kbAt116Versions}KB`)
  console.log(`  build ${r.buildMs}ms (once per version)   reliable=${r.reliable}   agreesWithModel=${r.agreesWithModel}`)
  console.log(`  PORTABLE across rebuild: ${r.portableAcrossRebuild}   sees-known-negative (real context change moves it): ${r.seesKnownNegative}`)
}
await b.close()
