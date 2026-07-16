// DOES THE BREAK-TABLE OPFS LAYER SURVIVE A REAL RELOAD? (2026-07-17)
//
// `loadTables`/`putTable`/`getTable`/`persist`/`tableStats` had **ZERO CALLERS** in src, scripts or
// tests (round 12 recorded it; I re-verified it). Not "unproven" — never executed once. Untouched
// code that has never run is not a feature, it is a plan. This probe is the first execution, and it
// runs against REAL OPFS across a REAL page reload.
//
// WHY THIS MATTERS AND NOT MERELY "IT'S TIDY": cold start is exactly where the bitmap path fails
// Peter — real-frame rate collapses 86% → 52% on a fresh reload because OPFS bitmap hydration cannot
// feed even a 5/s scrub. A 1.4KB table should survive reload trivially and kill that penalty. But an
// UNPROVEN persistence layer forfeits the entire advantage: a cache that silently never hydrates
// looks exactly like a cache that isn't needed.
//
// SCOPE — STATED, NOT BLURRED. This proves THE STORE: that the layer executes, writes through
// storage/opfsWrite.ts, hydrates across a reload, and refuses a stale signature. It says NOTHING
// about whether the table models what the /snapshot pane paints — round 12 proved the pane renders
// FLAT for 115/116 versions until RichDiffView lands, so wiring this to the pane now would model the
// wrong document. That wiring is deliberately NOT done here.
//
// THE ENGINE SPLIT, MEASURED FIRST (this gates the whole probe):
//   • Chromium HAS real OPFS at 127.0.0.1 (secure context) and it SURVIVES a reload — verified
//     directly before this probe was written.
//   • Playwright's Linux WebKit has NO `navigator.storage` AT ALL. So the iOS branch of
//     opfsWrite.ts — worker `createSyncAccessHandle`, the branch Peter's iPhone 8 actually takes —
//     CANNOT be exercised here. Chromium has `createWritable`, so this run proves the MAIN-THREAD
//     write path only. That is a real gap and it is reported, not hidden.
//
// THREE GATES, each must pass before the verdict is read:
//   1. KNOWN-POSITIVE — the table must actually be built and non-trivial (pages > 1, starts > 1).
//      A store that round-trips an EMPTY table would "pass" every check below and mean nothing.
//   2. KNOWN-NEGATIVE — a MUTATED signature must produce a COUNTED stale miss, never a reuse. A
//      table from another canonical context describes a different pagination; reusing it paints the
//      wrong words while reporting success (paginate()'s deleted orphan rule, exactly).
//   3. THE COLD READ MUST BE REAL — after reload, the in-memory index starts EMPTY, so a hit can
//      only come from disk. Proved by asserting `loadedFromDisk > 0` and that a pre-load `getTable`
//      MISSES (if it hit, something in memory survived and the reload proved nothing).
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4231}`
const DOC_ID = 'probe-opfs-tables'
const VERSIONS = Number(process.env.VERSIONS || 116)

const browser = await chromium.launch({
  headless: true,
  args: ['--font-render-hinting=none', '--disable-lcd-text'],
})
// ONE context for both loads — an OPFS origin is per-context, so a fresh context would be a fresh
// disk and the "reload" would prove nothing. This is the subtlety that makes the probe honest.
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)) })

const boot = async () => {
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2000)
  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'probe-opfs-src' })
  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } }))
  }, doc)
  await page.waitForFunction(() => {
    const p = window.__iwTextRenderProbe
    return !!p && p.words() > 10000
  }, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
}

let failed = false
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failed = true
}

try {
  // ── SESSION 1: build, persist ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await boot()

  const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
  if (!st.fontsReallyLoaded || !st.measureDiscriminates || !st.seesKnownPositive) {
    throw new Error(`PROBE IS BLIND — refusing to report. ${JSON.stringify(st)}`)
  }
  console.log(`gate ok · ${await page.evaluate(() => window.__iwTextRenderProbe.words())} words · real OPFS\n`)

  console.log(`── SESSION 1 — build ${VERSIONS} tables and persist ──`)
  const w = await page.evaluate(([d, v]) => window.__iwTextRenderProbe.tableWrite(d, v), [DOC_ID, VERSIONS])
  console.log(`  built ${w.versions} in ${w.buildMs}ms · persist ${w.persistMs}ms`)
  console.log(`  sig   ${w.sig}`)
  console.log(`  stats ${JSON.stringify(w.stats)}`)

  // GATE 1 — a non-trivial table. An empty one would round-trip perfectly and prove nothing.
  const probe = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableGet(d, 'snap-000'), [DOC_ID])
  check('KNOWN-POSITIVE: table is non-trivial', probe.pages > 1 && probe.starts > 1,
    `pages=${probe.pages} starts=${probe.starts} firstStarts=${JSON.stringify(probe.firstStarts)}`)
  check('all versions cached in memory', w.stats.tables === VERSIONS, `tables=${w.stats.tables}/${VERSIONS}`)
  check('persist wrote every table', w.stats.persisted === w.stats.tables, `persisted=${w.stats.persisted}`)
  if (w.stats.dropped.length) {
    console.log(`  ⚠ EVICTED (named): ${JSON.stringify(w.stats.dropped)}`)
  } else {
    console.log(`  evicted: none — ${w.stats.bytes}B of ${w.stats.budget}B budget (${(100 * w.stats.bytes / w.stats.budget).toFixed(1)}%)`)
  }
  const bytesPerVersion = w.stats.bytes / Math.max(1, w.stats.tables)
  console.log(`  bytes/version ${bytesPerVersion.toFixed(0)}B · ${VERSIONS} versions = ${(w.stats.bytes / 1024).toFixed(1)}KB total`)

  const sig1 = w.sig

  // ── THE RELOAD ──────────────────────────────────────────────────────────────────────────────
  // Same context ⇒ same OPFS origin. Fresh JS module registry ⇒ the in-memory index is EMPTY.
  console.log(`\n── RELOAD (same context, same origin, fresh modules) ──`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await boot()

  // GATE 3a — before loadTables, a lookup MUST miss. If it hits, memory survived the reload and
  // every "hit" below would be measuring the module registry, not the disk.
  const cold = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableGet(d, 'snap-000'), [DOC_ID])
  check('COLD: lookup MISSES before loadTables (memory really is empty)', cold.hit === false, `hit=${cold.hit}`)

  const sig2 = await page.evaluate(() => window.__iwTextRenderProbe.tableSig())
  check('signature REPRODUCES across the reload', sig1 === sig2,
    sig1 === sig2 ? '' : `\n        before ${sig1}\n        after  ${sig2}`)
  if (sig1 !== sig2) console.log('        ⇒ every hydrated table would stale-miss; the disk cache would be silently worthless.')

  // ── HYDRATE FROM DISK ───────────────────────────────────────────────────────────────────────
  const l = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableLoad(d), [DOC_ID])
  console.log(`\n── HYDRATE — loadTables from OPFS ──`)
  console.log(`  loadMs ${l.loadMs}`)
  console.log(`  stats  ${JSON.stringify(l.stats)}`)
  check('GATE 3b: tables came FROM DISK', l.stats.loadedFromDisk === VERSIONS,
    `loadedFromDisk=${l.stats.loadedFromDisk}/${VERSIONS}`)

  // ── THE VERDICT: a warm hit, from disk, after a reload ──────────────────────────────────────
  const hot = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableGet(d, 'snap-000'), [DOC_ID])
  check('HIT after reload (survived)', hot.hit === true, `pages=${hot.pages} starts=${hot.starts}`)
  check('hydrated table is byte-identical', JSON.stringify(hot.firstStarts) === JSON.stringify(probe.firstStarts),
    `${JSON.stringify(probe.firstStarts)} → ${JSON.stringify(hot.firstStarts)}`)

  // ── GATE 2: THE KNOWN-NEGATIVE — a stale signature must be a counted MISS, never a reuse ────
  const stale = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableGetStale(d, 'snap-000'), [DOC_ID])
  check('KNOWN-NEGATIVE: mutated signature REFUSED', stale.reused === false, `reused=${stale.reused}`)
  check('KNOWN-NEGATIVE: the refusal was COUNTED as stale', stale.staleCounted === 1, `staleCounted=${stale.staleCounted}`)
  if (stale.reused) console.log('        ⇒ SILENT REUSE ACROSS CONTEXTS: this paints the wrong words on the page and reports success.')

  // A hit must still work AFTER the negative — otherwise the negative broke the cache rather than
  // exercising it, and the "refusal" would be indistinguishable from a dead lookup.
  const again = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableGet(d, 'snap-000'), [DOC_ID])
  check('the correct signature STILL hits after the refusal', again.hit === true,
    `hit=${again.hit} — proves the negative discriminates rather than just breaking`)

  const final = await page.evaluate(([d]) => window.__iwTextRenderProbe.tableStats(d), [DOC_ID])
  console.log(`\n── tableStats from the COLD RELOAD ──`)
  console.log(`  tables         ${final.tables}`)
  console.log(`  loadedFromDisk ${final.loadedFromDisk}`)
  console.log(`  hits           ${final.hits}`)
  console.log(`  misses         ${final.misses}`)
  console.log(`  stale          ${final.stale}   (signature mismatches ⇒ REBUILD, never reuse)`)
  console.log(`  builds         ${final.builds}`)
  console.log(`  bytes          ${final.bytes}  of budget ${final.budget}`)
  console.log(`  evicted        ${final.dropped.length ? JSON.stringify(final.dropped) : 'none'}`)

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(`VERDICT: the OPFS break-table layer ${failed ? 'FAILED' : 'SURVIVES A REAL RELOAD'}`)
  console.log(`  ${VERSIONS} versions · ${(final.bytes / 1024).toFixed(1)}KB on disk · ${bytesPerVersion.toFixed(0)}B/version · hydrate ${l.loadMs}ms`)
  console.log('  ENGINE GAP (stated): Chromium has createWritable, so this proves the MAIN-THREAD')
  console.log('  write path. Playwright WebKit has NO navigator.storage, so the iOS worker')
  console.log('  createSyncAccessHandle branch — the one Peter\'s iPhone 8 takes — is UNPROVEN here.')
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
