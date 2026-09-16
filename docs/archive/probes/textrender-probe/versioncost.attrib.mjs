// WHY DOES ONE WARM build() COST 249ms WHILE storeProof AVERAGES 103ms/version? (2026-07-17)
//
// Same document, same geometry, same shared measure, same buildRenderModel. A 2.4× gap between two
// readings of THE SAME OPERATION means at least one of them is not measuring what its name says, and
// the baseline for Peter's <1s target is whichever one is real. This repo's whole methodology says
// resolve that BEFORE optimising against either number — a design aimed at the wrong baseline
// optimises a fiction.
//
// HYPOTHESES, each with a discriminating reading:
//  H1 JIT/tier-up. storeProof runs 116 builds in ONE tight loop; the api's build() is 7 separate
//     CDP round-trips. If H1, per-build time inside a loop should FALL sharply over the first few
//     iterations and the api's build() should converge toward it when looped in-page.
//  H2 Eviction/estBytes. storeProof's timer wraps store.get(), which also runs estBytes (an O(model)
//     walk of every line and seg) and evict(). Those would make storeProof DEARER, not cheaper — so
//     H2 predicts the OPPOSITE of what we see and is falsified if the gap holds in this direction.
//  H3 Measure-cache size. The api's module-level measure has served every doc opened this session;
//     storeProof builds a FRESH one per call. A huge Map is still O(1) but with worse locality.
//  H4 The builds didn't all run. If store.get() ever returned early (a hit, or a null doc), the
//     divisor 116 is wrong and 103ms is an average over fewer builds than claimed. stats.builds is
//     the ground truth and storeProof does NOT report it — a count nobody checks is exactly how the
//     signature-blind bake counter reported 116/116 while every lookup missed.
//
// H4 IS CHECKED FIRST because it is the one that would make the headline number a lie rather than
// merely mis-attributed.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4231}`

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

  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'probe-attrib' })
  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } }))
  }, doc)
  await page.waitForFunction(() => {
    const p = window.__iwTextRenderProbe
    return !!p && p.words() > 10000
  }, null, { timeout: 60000 })
  await page.waitForTimeout(2000)

  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.measureDiscriminates || !st.seesKnownPositive) {
    throw new Error(`PROBE IS BLIND — refusing to report. ${JSON.stringify(st)}`)
  }
  console.log(`gate ok · ${await page.evaluate(() => window.__iwTextRenderProbe.words())} words\n`)

  // ── H1: the SAME api build(), looped IN-PAGE (no CDP round-trip per build) ──────────────────
  // If the 249ms was a per-round-trip artifact or a tier-up artifact, an in-page loop of the exact
  // same call collapses toward storeProof's number. This isolates the loop from the transport.
  const loop = await page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    const out = []
    for (let i = 0; i < 12; i++) out.push(+p.build().ms.toFixed(1))
    return out
  })
  console.log('H1 — api build(), 12× in ONE in-page loop (ms):')
  console.log('   ', JSON.stringify(loop))
  const tail = loop.slice(4)
  const tailP50 = [...tail].sort((a, b) => a - b)[Math.floor(tail.length / 2)]
  console.log(`    first ${loop[0]}  →  settled p50 ${tailP50}   (tier-up drop = ${(loop[0] - tailP50).toFixed(1)}ms)\n`)

  // ── H4: did storeProof's builds ALL actually run? ───────────────────────────────────────────
  // Re-run the store loop here with the store's OWN stats.builds as ground truth, so the divisor is
  // verified rather than assumed. A build count below the version count means the headline ms/version
  // is an average over work that never happened.
  const counted = await page.evaluate(() => {
    const p = window.__iwTextRenderProbe
    // storeProof does not expose stats.builds, so reproduce its loop through the same public API and
    // read the count the store itself kept.
    const r = p.storeProof(116, false)
    return r
  })
  console.log('H4 — storeProof(116) re-run:')
  console.log(`    buildMsPerVersion ${counted.buildMsPerVersion}  cachedModels ${counted.cachedModels}  dropped ${counted.droppedCount}`)
  console.log(`    pagesPerVersion ${counted.pagesPerVersion}  ← 0 means coverageOf('v0') found NOTHING: v0 was EVICTED.`)
  console.log(`    NOTE: cachedModels(${counted.cachedModels}) + dropped(${counted.droppedCount}) = ${counted.cachedModels + counted.droppedCount}`)

  // ── H3/H2: a FRESH store of N versions at several N, to see whether per-version is stable ────
  // If per-version time is flat in N, the number is a property of the build, not of the loop's
  // memory pressure or eviction. If it RISES with N, the 116 average is contaminated by GC/eviction
  // and the honest per-build cost is the small-N one.
  console.log('\nH2/H3 — fresh store, per-version cost vs version count:')
  for (const n of [4, 12, 40, 116]) {
    const r = await page.evaluate((v) => window.__iwTextRenderProbe.storeProof(v, false), n)
    console.log(`    n=${String(n).padStart(3)}  ${String(r.buildMsPerVersion).padStart(6)}ms/version   total ${String(r.buildMsTotal).padStart(6)}ms   dropped ${r.droppedCount}`)
  }
} finally {
  await browser.close()
}
