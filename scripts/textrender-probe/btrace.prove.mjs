// DOES THE LIBRARY-HYDRATION RACE REPRODUCE, AND DOES THE FIX CLOSE IT? (2026-07-17)
//
// PETER'S iPHONE 8 FOUND THIS, not CI. `?btDebug=1` FAILED once with:
//     BEFORE  …|capa@0:w7k42t|…      (built with an EMPTY library)
//     AFTER   …|capa@20:12qxw1k|…    (read back with 20 entries hydrated)
// The signature was RIGHT — it hashes the bibliography's CONTENT, and the content genuinely
// differed. The CALLER was wrong: it built before the async OPFS library hydration landed, baking
// `capa@0` into the key, so every later lookup misses FOREVER, silently. Bug 1's ghost wearing a
// correct signature.
//
// THE PROBE MUST BE ABLE TO REPRODUCE IT. A fix you cannot make fail first is a guess.
//   ① `?btDebug=race`  → skip the libraryReady() await when BUILDING → must FAIL on the sig check
//   ② `?btDebug=1`     → await libraryReady() → must PASS
//
// THE SUBTLETY THAT WOULD HAVE MADE THIS PROBE A FICTION: with an EMPTY library, both phases sign
// `capa@0:<hash-of-nothing>` and the signatures MATCH — race mode would go GREEN while reproducing
// nothing at all, and the "fix" would be certified by a test that cannot see the bug. So the probe
// SEEDS A REAL LIBRARY into OPFS first (20 entries, as on Peter's device) and asserts the seed is
// actually there before reading any verdict. The race only exists where there is something to
// hydrate.
import { chromium } from '@playwright/test'
import { autoBase } from './serve.mjs'
const BASE = await autoBase()
const browser = await chromium.launch({ headless: true })

const ENTRIES = Array.from({ length: 20 }, (_, i) => ({
  id: `author${1990 + i}`, type: 'book', title: `Work number ${i}`,
  author: [{ family: `Author${i}`, given: 'A' }], issued: { 'date-parts': [[1990 + i]] },
}))

async function run(label, flagValue) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 110)))

  // SEED A REAL LIBRARY into real OPFS (Chromium has it; verified). Without this the race cannot
  // reproduce: an empty library signs identically on both sides of the reload.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const seeded = await page.evaluate(async (items) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('library', { create: true })
    const fh = await dir.getFileHandle('citations.json', { create: true })
    const w = await fh.createWritable(); await w.write(JSON.stringify(items)); await w.close()
    const back = JSON.parse(await (await fh.getFile()).text())
    return back.length
  }, ENTRIES)
  if (seeded !== ENTRIES.length) { console.log(`  SEED FAILED (${seeded}) — verdict void`); await ctx.close(); return { verdict: 'VOID' } }

  await page.goto(`${BASE}/?btDebug=${flagValue}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const el = document.querySelector('#iw-btdebug div')
    return el && (el.textContent === 'PASS' || el.textContent === 'FAIL')
  }, null, { timeout: 90000 }).catch(() => {})
  const out = await page.evaluate(() => {
    const root = document.getElementById('iw-btdebug')
    if (!root) return { verdict: 'NO OVERLAY' }
    return {
      verdict: root.querySelector('div')?.textContent,
      rows: [...root.querySelectorAll('div')].map((d) => d.textContent || '').filter((t) => /^[✓✕·]/.test(t.trim())),
    }
  })
  console.log(`\n${label}\n  VERDICT: ${out.verdict}  (library seeded: ${seeded} entries)`)
  for (const r of out.rows || []) console.log(`    ${r.replace(/\s+/g, ' ').slice(0, 104)}`)
  await ctx.close()
  return out
}

const raced = await run('① ?btDebug=race — build BEFORE hydration (the bug). MUST FAIL.', 'race')
const fixed = await run('② ?btDebug=1 — await libraryReady() (the fix). MUST PASS.', '1')

console.log('\n──────────────────────────────────────────────')
const reproduced = raced.verdict === 'FAIL'
const closed = fixed.verdict === 'PASS'
console.log('race REPRODUCES the bug :', reproduced, reproduced ? '(the probe can see it)' : '(⚠ CANNOT SEE THE BUG — verdict below is worthless)')
console.log('fix CLOSES it           :', closed)
await browser.close()
process.exit(reproduced && closed ? 0 : 1)
