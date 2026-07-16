// Round 10 — PROVE THE INSTRUMENT, THEN READ IT.
//
// Peter's mid-scrub overlay capture came back byte-identical to his idle one: the overlay is a DOM
// node repainting on the thread the scrub saturates, so every number we had was an AT-REST sample.
// The recorder (a preallocated ring buffer in the presenter) is meant to fix that — but an
// instrument nobody proved is exactly how this codebase lost arithLayout for months. So:
//
//   STEP 1  KNOWN-POSITIVE: drive show() a KNOWN number of times and assert the buffer holds
//           exactly that many presents. If it can't see a known-positive it is worthless.
//   STEP 2  KNOWN-NEGATIVE: reset and assert it reads zero (it isn't just always-on noise).
//   STEP 3  Only then: read a REAL burst — is thumb actually 0? is the content REGISTERED?
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 45)
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.addInitScript(() => { window.__iwThumbTrace = []; window.__iwPerf = [] })
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(4000)

const out = {}

// ── STEP 1: KNOWN-POSITIVE ────────────────────────────────────────────────────────────────────
// Call show() N times directly with known ids. The buffer must hold exactly N presents.
out.knownPositive = await page.evaluate(() => {
  const N = 17
  const p = window.__iwScrub
  p.resetRecord()
  const ids = []
  for (let i = 0; i < N; i++) ids.push('snap-' + (10 + (i % 20)))
  for (const id of ids) p.show(id)
  const rec = p.record()
  const panes = new Set(rec.map((r) => r.pane))
  return {
    commandedShows: N,
    recordedRows: rec.length,
    panesSeen: [...panes],
    recordedPresents: rec.length / panes.size,
    PASS: rec.length / panes.size === N,
    sampleRow: rec[0],
  }
})
console.log('STEP 1 — known-positive:', JSON.stringify(out.knownPositive, null, 1))
if (!out.knownPositive.PASS) { console.log('\n❌ INSTRUMENT CANNOT SEE A KNOWN-POSITIVE — every number below is worthless.'); await browser.close(); process.exit(1) }

// ── STEP 2: KNOWN-NEGATIVE ────────────────────────────────────────────────────────────────────
out.knownNegative = await page.evaluate(() => {
  window.__iwScrub.resetRecord()
  const n = window.__iwScrub.record().length
  return { recordedRows: n, PASS: n === 0 }
})
console.log('STEP 2 — known-negative:', JSON.stringify(out.knownNegative))
if (!out.knownNegative.PASS) { console.log('\n❌ recorder reads non-zero when nothing happened.'); await browser.close(); process.exit(1) }
await page.evaluate(() => { window.__iwScrub.hide() })
await page.waitForTimeout(1500)

// ── Let the sweep bake, then read a REAL burst ─────────────────────────────────────────────────
console.log(`\n(sweeping ${IDLE_S}s…)`)
await page.waitForTimeout(IDLE_S * 1000)
out.baked = await page.evaluate(() => {
  let idx = null
  for (const [k, v] of window.__iwOpfsFiles) if (k.endsWith('/thumbs/index.json')) idx = JSON.parse(new TextDecoder().decode(v))
  const s = { doc: new Set(), diff: new Set(), map: new Set() }
  let bytes = 0
  if (idx) for (const [key, e] of Object.entries(idx.entries)) { const [id, pane] = key.split('|'); if (s[pane]) s[pane].add(id); bytes += e.bytes }
  return { doc: s.doc.size, diff: s.diff.size, map: s.map.size, kb: Math.round(bytes / 1024), perVersionKB: s.doc.size ? +(bytes / 1024 / s.doc.size).toFixed(1) : 0 }
})
console.log('\nBAKED after sweep:', JSON.stringify(out.baked))

const realBurst = async (label) => {
  const r = await page.evaluate(async () => {
    window.__iwScrub.resetRecord()
    for (let i = 0; i < 12; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 14))
    }
    await new Promise((r) => setTimeout(r, 600)) // let it settle, THEN serialise
    const rec = window.__iwScrub.record()
    return { rows: rec.length, rec }
  })
  const sum = await page.evaluate((rec) => window.__iwSummarise(rec), r.rec)
  return { label, rows: r.rows, ...sum }
}
out.burstCold = await realBurst('cold')
await page.waitForTimeout(3000)
out.burstSecond = await realBurst('second')
console.log('\n── REAL BURSTS ──')
console.log(JSON.stringify({ cold: out.burstCold, second: out.burstSecond }, null, 1))
await writeFile(`${OUT}/results-recorder.json`, JSON.stringify(out, null, 2))
await browser.close()
