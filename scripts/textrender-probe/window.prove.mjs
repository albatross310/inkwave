// THE CRUX: can a page be laid out EXACTLY without laying out the pages before it?
//
// A break `at` IS a line start, and greedy wrap restarts deterministically at a line start — so
// GIVEN the break position, the page's own layout should be prefix-independent. That is the claim.
//
// THE TEST MUST DISCRIMINATE. The first version scored a deliberately-wrong cut at 29/30, identical
// to the correct cut, and still reported a verdict. Two reasons it was blind:
//   (a) an off-by-one (cut at `at-1`, want `pos-cutAt+1`) mismatched line 0 ALWAYS;
//   (b) a 2-char-off cut is not a real negative — dropping 2 chars from the first word leaves every
//       LATER line starting at the same original position, so it scores the same by construction.
// So: cut at `at`, rebase to ORIGINAL positions, and use MID-LINE negatives (which force the wrap to
// cascade). Gate: the correct cut must STRICTLY beat every negative.
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
  const doc = buildCitationDoc({ words, cites, id:'win2-'+name })
  await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
  await page.waitForFunction((w)=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>w*0.5, words, {timeout:90000})
  await page.waitForTimeout(6000)
  const st = await page.evaluate(()=>window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(name,'PROBE BLIND'); continue }
  const w = await page.evaluate(()=>window.__iwTextRenderProbe.windowProof())
  console.log(`\n━━━ ${name} — ${w.pages} pages ━━━`)
  console.log(`  PREFIX-FREE LAYOUT EXACT: ${w.allExact}   STRICTLY BEATS ALL NEGATIVES: ${w.allStrictlyBeatNegatives}`)
  for (const r of w.tested) {
    console.log(`    page ${r.pageIdx} @${r.at}: good ${r.good.match}/${r.good.compared} exact=${r.good.exact} (tail build ${r.good.tailBuildMs}ms, first got=${r.good.firstGot} want=${r.good.firstWant})`)
    console.log(`       negatives: ${r.negs.map(n=>`+${n.cutAt-r.at}:${n.match}/${n.compared}`).join('  ')}   strictlyBeats=${r.strictlyBeatsAllNegatives}`)
  }
  console.log('  anchorProbe:', JSON.stringify(w.anchorProbe))
}
await b.close()
