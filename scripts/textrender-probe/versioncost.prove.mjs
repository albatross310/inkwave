// WHAT DOES A BREAK-TABLE BUILD ACTUALLY COST PER VERSION? (2026-07-17)
//
// PETER'S QUESTION, and it is the right one: "Wait why does it take 10s to load the 116 versions if
// they're just text?" The 10s comes from 116 × 90ms. This probe asks whether either factor is real,
// because THE 90ms DOES NOT RECONCILE WITH ANYTHING THIS REPO HAS MEASURED:
//   • breakTable.ts's own header says a build is 4/16/62ms at 2k/10k/40k words. Thesis scale is 13k
//     words, which interpolates to ~20ms — not 90.
//   • textRenderStore.ts says 40k words costs cold 129.5ms / warm 82.2ms. That contradicts the 62ms
//     above AT THE SAME SIZE, so at most one of them is the build's cost.
//   • landingcost.prove.mjs measured `paginateStaticDoc` RICH at desktop p50 68.5 / MAX 90.9ms. That
//     is the PANE'S DOM PAGINATION — a different operation, on a different thread of work, from
//     buildRenderModel's canvas layout. 90.9 is suspiciously exactly the "90ms".
// So this probe MEASURES the thing being multiplied instead of inheriting a number whose provenance
// is a guess. A projection built on an unattributed constant is how "10s of idle work" becomes a
// design requirement for work that may not exist.
//
// THE OTHER HALF — WHY 116 COLD BUILDS IS ALSO THE WRONG MODEL. `makeCanvasMeasure()` ALREADY
// memoises per (cssFont, text) (arithmeticLayout.ts ~332-364), and `TextRenderStore` constructs
// exactly ONE measure for its whole lifetime (`private measure: Measure = makeCanvasMeasure()`),
// shared by every version it builds. So versions 2..116 were never going to pay the cold price: the
// word-width cache the design is being asked to add IS ALREADY THERE, warm, by construction. What
// this probe reports is therefore the honest shape of the real work: 1 × cold + 115 × warm.
//
// METRIC: `storeProof(versions)` — the SHIPPED store, its own shared measure, one full
// buildRenderModel per version, timed in aggregate (`buildMsPerVersion`). It is unmodified and
// unmocked; this probe only calls it.
//
// HONEST LIMIT, STATED NOT HIDDEN: storeProof stands the SAME doc in for every version (its own
// comment says so — honest for memory and page-span, which scale with doc SIZE, not with what
// changed). That makes this an exact measurement of the NAIVE FULL-BUILD baseline (every version
// pays a full layout, which is precisely what is being multiplied by 116) and NOT a measurement of
// any incremental scheme's reuse — identical docs would make reuse trivially 100%. This probe
// measures the BASELINE ONLY. Reuse must be proved on genuinely differing versions, elsewhere.
//
// GATE: selfTest() must see a planted +5% advance error before ANY timing is read (probe.mjs's
// rule). A blind instrument reporting "no cost" is this codebase's signature failure.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'

const BASE = await autoBase()
const VERSIONS = Number(process.env.VERSIONS || 116) // Peter's real count

const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)) })

try {
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const dpr = await page.evaluate(() => window.devicePixelRatio)

  // Thesis scale, structurally: 13k words / 174 citations — landingcost.prove.mjs's conditions, so
  // the numbers here are comparable to the ones the 90ms may have come from. Synthetic: Peter's real
  // Honours content never enters a fixture (THESIS INTEGRITY).
  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'probe-versioncost' })
  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } }))
  }, doc)
  await page.waitForFunction(() => {
    const p = window.__iwTextRenderProbe
    return !!p && p.words() > 10000
  }, null, { timeout: 60000 })
  await page.waitForTimeout(2000)

  // ── THE GATE ────────────────────────────────────────────────────────────────────────────────
  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  console.log(`selfTest: fontsReallyLoaded=${st.fontsReallyLoaded} measureDiscriminates=${st.measureDiscriminates} ` +
    `seesKnownPositive=${st.seesKnownPositive} (lines ${st.baseLines} → ${st.inflatedLines} under +5% advance)`)
  if (!st.fontsReallyLoaded || !st.measureDiscriminates || !st.seesKnownPositive) {
    throw new Error(`PROBE IS BLIND — refusing to report numbers. selfTest=${JSON.stringify(st)}`)
  }

  const words = await page.evaluate(() => window.__iwTextRenderProbe.words())
  console.log(`\ndevicePixelRatio ${dpr} · document ${words} words (thesis scale, synthetic)\n`)

  // ── COLD vs WARM, the single-build shape ────────────────────────────────────────────────────
  // buildCold() throws away the measure cache; build() reuses it. The gap IS the word-width cache's
  // whole contribution, measured rather than assumed.
  const cold = await page.evaluate(() => window.__iwTextRenderProbe.buildCold())
  const warm = []
  for (let i = 0; i < 7; i++) warm.push(await page.evaluate(() => window.__iwTextRenderProbe.build().ms))
  const srt = [...warm].sort((a, b) => a - b)
  const wp50 = srt[Math.floor(srt.length / 2)]
  console.log(`ONE BUILD @ ${words} words: cold ${cold.ms.toFixed(1)}ms → warm p50 ${wp50.toFixed(1)}ms ` +
    `(${cold.model.pages} pages, ${cold.model.lines.length} lines)`)
  console.log(`  word-width cache contribution: ${(cold.ms - wp50).toFixed(1)}ms (${(100 * (1 - wp50 / cold.ms)).toFixed(0)}% off the cold build)`)
  console.log(`  → it is ALREADY BUILT and ALREADY SHARED across versions by TextRenderStore.\n`)

  // ── THE BASELINE BEING MULTIPLIED BY 116 ────────────────────────────────────────────────────
  const sp = await page.evaluate((v) => window.__iwTextRenderProbe.storeProof(v, false), VERSIONS)
  console.log(`storeProof(${VERSIONS}) — the SHIPPED store, one shared measure, one full build per version:`)
  console.log(`  buildMsTotal        ${sp.buildMsTotal}ms  for ${sp.versions} versions`)
  console.log(`  buildMsPerVersion   ${sp.buildMsPerVersion}ms`)
  console.log(`  pagesPerVersion     ${sp.pagesPerVersion}`)
  console.log(`  cachedModels        ${sp.cachedModels}/${sp.versions}   dropped ${sp.droppedCount} ${sp.droppedCount ? JSON.stringify(sp.droppedSample) : ''}`)
  console.log(`  wholeDocVersions    ${sp.wholeDocVersions}   notWhole ${sp.notWholeVersions}`)

  // EVICTION MUST BE VISIBLE. If the store dropped models to stay in budget, the per-version time is
  // an average over a set that did not all survive — say so rather than let it read as full coverage.
  if (sp.droppedCount > 0) {
    console.log(`  ⚠ ${sp.droppedCount} models EVICTED under the ${(sp.budget / 1048576).toFixed(0)}MB budget — coverage is BOUNDED, not total.`)
  }

  const totalS = sp.buildMsTotal / 1000
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`THE 10s CLAIM: 116 × 90ms = 10.4s`)
  console.log(`MEASURED     : ${VERSIONS} × ${sp.buildMsPerVersion}ms = ${totalS.toFixed(2)}s   (naive full build per version, warm shared measure)`)
  console.log(`RATIO        : the real naive baseline is ${(10.4 / totalS).toFixed(1)}× ${totalS < 10.4 ? 'CHEAPER' : 'DEARER'} than the projection driving the design.`)
  console.log(`TARGET       : <1s for ${VERSIONS} versions ⇒ <${(1000 / VERSIONS).toFixed(1)}ms/version.`)
  console.log(`GAP TO TARGET: ${(sp.buildMsPerVersion / (1000 / VERSIONS)).toFixed(1)}× ${totalS < 1 ? '— ALREADY UNDER. No incremental scheme is needed for the target.' : 'still to find.'}`)
  console.log(JSON.stringify({ words, dpr, cold: +cold.ms.toFixed(1), warmP50: +wp50.toFixed(1), storeProof: sp }))
} finally {
  await browser.close()
}
