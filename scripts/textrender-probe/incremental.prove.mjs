// DOES THE INCREMENTAL BLOCK CACHE PRODUCE THE SAME PAGINATION, AND IS IT FAST ENOUGH? (2026-07-17)
//
// PETER'S TARGET, verbatim: "If we can get it under 1s we can just load it when the snapshots screen
// loads up." ⇒ <1s for 116 versions.
//
// THE THEOREM: `layoutParagraph(block, contentWidthPx, ratio, measure, whiteSpace)` takes ONLY the
// block — no prefix, no preceding state — and emitTextBlock applies top/posBase/blockIdx/marker as
// pure OFFSETS after the layout exists. So reusing an identical block's geometry at new offsets is
// the SAME ARITHMETIC, not an approximation. Keyed on a CONTENT HASH, never a diff: a wrong diff
// silently reuses wrong layout; a content hash cannot.
//
// FOUR THINGS MUST HOLD AT ONCE or the speedup is worthless:
//   1. BYTE-IDENTICAL to the full build, at LINE level (top/pos/startChar/endChar/height/blockIdx),
//      not merely at the table's page starts — a drift inside a page that happens not to move a
//      break would pass a starts-only check.
//   2. THE REUSE RATE BESIDE THE TIMING. 82ms → 8ms at 0% reuse means something else was measured.
//   3. THE POISONED-CACHE NEGATIVE: corrupt a live entry ⇒ the output MUST change. If it doesn't,
//      the hit path never ran and every "identical" is VACUOUS (a silent fall-back to a full build).
//   4. BOTH FIXTURE NEGATIVES: `nothing` (100% reuse) cannot test the DELTA path; `everything`
//      (0% reuse) cannot test REUSE. Only `realistic` exercises both.
//
// WHAT THIS PROOF COVERS, STATED. The fixture is the RICH thesis-scale doc — 13k words, 174
// citations, headings, lists AND a refList — because `breaks.prove.mjs` runs on 4,000 words of PLAIN
// PARAGRAPHS ONLY and the textRender lane found LISTS DIVERGE SILENTLY there. So breaks.prove.mjs is
// a NECESSARY comparator, not a sufficient one, and this fixture is the one that can punish us:
// a paragraphs-only fixture makes the list/heading/citation branches of emitTextBlock a no-op and
// would certify a cache that is wrong on every real document.
//
// PARSE IS REPORTED SEPARATELY AND ADDED IN. /snapshot has no editor: it must parse each version's
// contentJson into a PM Node before any build. A build cache cannot touch that cost, so quoting the
// build alone would understate exactly the number Peter judges.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4297}`
const VERSIONS = Number(process.env.VERSIONS || 116)

const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 150)) })

try {
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'probe-incremental' })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => { const p = window.__iwTextRenderProbe; return !!p && p.words() > 10000 }, null, { timeout: 60000 })
  await page.waitForTimeout(2000)

  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.measureDiscriminates || !st.seesKnownPositive) {
    throw new Error(`PROBE IS BLIND — refusing to report. ${JSON.stringify(st)}`)
  }
  const words = await page.evaluate(() => window.__iwTextRenderProbe.words())
  console.log(`gate ok · ${words} words · rich fixture (citations + headings + lists + refList)\n`)

  let failed = false
  const check = (ok, label, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`); if (!ok) failed = true }

  const run = (mode, poison) => page.evaluate((o) => window.__iwTextRenderProbe.incProof(o), { versions: VERSIONS, mode, poison })

  // ── THE REAL CASE ───────────────────────────────────────────────────────────────────────────
  console.log(`── realistic: 2 mid-paragraph edits per version, rotating (a real snapshot diff) ──`)
  const r = await run('realistic', true)
  console.log(`  blocks ${r.blocks} · reuse ${(r.reuseMean * 100).toFixed(1)}% · cache ${r.cacheEntries} entries, ${r.cacheEvicted} evicted`)
  console.log(`  per version:  parse ${r.parseMsPerVersion}ms · full ${r.fullMsPerVersion}ms · incremental ${r.incMsPerVersion}ms   (${r.speedup}× on the build)`)
  console.log(`  sample: ${JSON.stringify(r.rows.slice(0, 3))}`)
  check(r.byteIdentical, `incremental == full, BYTE-IDENTICAL at line level (${r.identical}/${VERSIONS})`,
    r.byteIdentical ? '' : `differing=${r.differing} ${JSON.stringify(r.firstDiff)}`)
  check(r.reuseMean > 0.8, `reuse rate is real (${(r.reuseMean * 100).toFixed(1)}%)`, 'a speedup at ~0% reuse would mean something else was measured')

  // ── THE POISONED-CACHE NEGATIVE — trace the pass ────────────────────────────────────────────
  console.log(`\n── POISONED-CACHE NEGATIVE: did the reuse path actually RUN? ──`)
  const p = r.poison
  check(!!p && p.poisonedEntryFound, 'a live cache entry was found to poison')
  check(!!p && p.changedOutput, 'poisoning a cached entry CHANGED the output',
    p && p.changedOutput ? '⇒ the hit path really ran; the identical results above are real' : '⇒ THE CACHE IS NEVER READ. Every "identical" above is VACUOUS.')
  check(!!p && p.restoredMatches, 'un-poisoning restores the original output', '⇒ the negative is reversible, not destructive')

  // ── THE TWO FIXTURE NEGATIVES ───────────────────────────────────────────────────────────────
  console.log(`\n── FIXTURE NEGATIVES: the metric must move in both directions ──`)
  const nothing = await run('nothing', false)
  const every = await run('everything', false)
  console.log(`  nothing-changed  : reuse ${(nothing.reuseMean * 100).toFixed(1)}%  inc ${nothing.incMsPerVersion}ms  (vs full ${nothing.fullMsPerVersion}ms)`)
  console.log(`  changes-everywhere: reuse ${(every.reuseMean * 100).toFixed(1)}%  inc ${every.incMsPerVersion}ms  (vs full ${every.fullMsPerVersion}ms)`)
  check(nothing.reuseMean > 0.99, 'nothing-changed ⇒ ~100% reuse', 'this fixture CANNOT test the delta path — it only proves reuse works')
  check(every.reuseMean < 0.2, 'changes-everywhere ⇒ ~0% reuse', 'this fixture CANNOT test reuse — it only proves the cache does not falsely hit')
  check(nothing.byteIdentical && every.byteIdentical, 'both extremes stay byte-identical')
  check(every.reuseMean < r.reuseMean && r.reuseMean < nothing.reuseMean,
    'reuse ORDERS correctly: everything < realistic < nothing', 'a constant reuse rate would mean the metric is blind')

  // ── THE VERDICT PETER JUDGES ────────────────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────────────────────`)
  console.log(`THE WIRED COST OF ${VERSIONS} VERSIONS ON /snapshot OPEN (parse + build):`)
  console.log(`  naive (full build)  : parse ${r.parseSec}s + build ${(r.fullMsPerVersion * VERSIONS / 1000).toFixed(2)}s = ${r.wiredSecFull}s`)
  console.log(`  incremental         : parse ${r.parseSec}s + build ${r.buildOnlySecInc}s = ${r.wiredSecInc}s`)
  console.log(`  TARGET              : <1.00s`)
  console.log(`  build alone         : ${r.buildOnlySecInc}s  ${r.buildOnlySecInc < 1 ? '✓ under' : '✗ over'}`)
  console.log(`  PARSE FLOOR         : ${r.parseSec}s — a build cache CANNOT touch this.`)
  console.log(r.wiredSecInc < 1
    ? `  VERDICT: ${r.wiredSecInc}s — UNDER TARGET. Load it on snapshot-screen open.`
    : `  VERDICT: ${r.wiredSecInc}s — OVER TARGET. Remaining cost is ${r.parseSec >= r.buildOnlySecInc ? 'dominated by PARSE' : 'dominated by BUILD'}.`)
  console.log(`  NB this box is contended — trust the RATIO (${r.speedup}× on the build), not the absolutes.`)
  process.exitCode = failed ? 1 : 0
} finally {
  await browser.close()
}
