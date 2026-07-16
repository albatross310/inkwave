// COLD-RANGE WARM-UP measurement (Peter: "how quickly will it load the new warm window once you
// start scrolling?"). chromium deviceScaleFactor 2. Answers, with real numbers:
//   A) Scrubbing INTO a cold range at speed: how many distinct REAL versions present (exact) vs
//      nearest-fallback, and time-to-first-real during the fling (captures pause during scrub).
//   B) After STOPPING at a cold landing: pause→first-capture delay, and how many versions warm by
//      sitting idle (does it backfill the span, or only current±1?).
//   C) Slow-scroll warm-up throughput: time + captures to warm a 12-version cold span by walking it.
//   D) Per-capture render cost (CPU, measurable): scrub.capture ms distribution at DPR1.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4225, BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const opfsShim = eval('(() => {' + src.slice(src.indexOf('const opfsShim'), src.indexOf('// One paint-gated step')) + '; return opfsShim })()')
const stepFn = eval('(' + src.slice(src.indexOf('async (dir) => {'), src.indexOf('// A trackpad-scrub')).trim().replace(/;\s*$/, '') + ')')
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))
await page.addInitScript(opfsShim, buildSnapshots())
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-30`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(5500) // initial warm of snap-29/30/31

const out = { deviceScaleFactor: 2 }

// ── A) cold fast fling snap-30 → toward snap-14 (only 29/30/31 are warm) ──
out.A_coldFling = await page.evaluate(async () => {
  window.__iwPerf.length = 0
  const t0 = performance.now()
  for (let i = 0; i < 16; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 9)) }
  const tEndScroll = performance.now()
  // watch for the first capture AFTER scroll end + when the landing first has a real bitmap
  await new Promise(r => setTimeout(r, 3000))
  const P = window.__iwPerf
  const shown = P.filter(e => e[0] === 'scrub.shown').map(e => e[1])
  const exact = P.filter(e => e[0] === 'scrub.exact').map(e => e[1])
  const caps = P.filter(e => e[0] === 'scrub.capture')
  const firstCapAfter = caps.find(e => e[2] > tEndScroll)
  return {
    fling_showCalls: P.filter(e => e[0] === 'scrub.want').length,
    fling_distinctPresented: new Set(shown).size,
    fling_realHits: exact.filter(x => x === 1).length,
    fling_nearestHits: exact.filter(x => x === 0).length,
    fling_exactRate: exact.length ? +(exact.filter(x => x === 1).length / exact.length).toFixed(2) : null,
    scrollDurationMs: +(tEndScroll - t0).toFixed(0),
    msFromScrollEndToFirstCapture: firstCapAfter ? +(firstCapAfter[2] - tEndScroll).toFixed(0) : null,
    capturesInFirst3sAfterStop: caps.filter(e => e[2] > tEndScroll).length,
  }
})
await page.waitForTimeout(2500)

// ── B) sit idle at a freshly-navigated COLD position: does warming backfill or only ±1? ──
// jump (single step so it's a live nav, not a scrub) to a cold spot then sit.
await page.evaluate(stepFn, -1); await page.waitForTimeout(300) // one legible step into fresh territory
out.B_sitIdle = await page.evaluate(async () => {
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
  window.__iwPerf.length = 0
  const t0 = performance.now()
  await new Promise(r => setTimeout(r, 4000)) // just sit
  const caps = window.__iwPerf.filter(e => e[0] === 'scrub.capture')
  const stats = window.__iwScrub.stats()
  return {
    capturesWhileSitting4s: caps.length,
    captureMsMedian: med(caps.map(e => e[1])),
    captureMsMax: caps.length ? +Math.max(...caps.map(e => e[1])).toFixed(0) : null,
    cacheEntriesAfter: stats.entries, cacheMB: +(stats.bytes / 1e6).toFixed(1),
    msToFirstCaptureFromIdle: caps.length ? +(caps[0][2] - t0).toFixed(0) : null,
    note: 'entries/3 ≈ versions warm (doc+diff+map each). Expect only current±warm-layers, not a wide span.',
  }
})

// ── C) slow-scroll warm-up throughput: walk a 12-version COLD span, timing captures ──
out.C_slowWarm = await page.evaluate(async () => {
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
  window.__iwPerf.length = 0
  const startEntries = window.__iwScrub.stats().entries
  const t0 = performance.now()
  // step one version at a time with a settle each (so each becomes active/warm → captured)
  for (let i = 0; i < 12; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await new Promise(r => setTimeout(r, 900)) // settle so capture can run off the input path
  }
  await new Promise(r => setTimeout(r, 2500)) // let the tail captures drain
  const caps = window.__iwPerf.filter(e => e[0] === 'scrub.capture')
  const totalMs = performance.now() - t0
  const stats = window.__iwScrub.stats()
  return {
    spanVersionsWalked: 12,
    totalWarmMs: +totalMs.toFixed(0),
    capturesAdded: caps.length,
    entriesAdded: stats.entries - startEntries,
    versionsWarmedApprox: +((stats.entries - startEntries) / 3).toFixed(1),
    capturesPerSec: +(caps.length / (totalMs / 1000)).toFixed(2),
    captureMsMedian: med(caps.map(e => e[1])),
    captureMsMax: caps.length ? +Math.max(...caps.map(e => e[1])).toFixed(0) : null,
  }
})
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-coldwarm.json`, JSON.stringify(out, null, 2))
await browser.close()
