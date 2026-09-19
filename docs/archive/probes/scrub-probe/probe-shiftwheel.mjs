// Shift-wheel ROOT-CAUSE probe (Apple-Photos bar): why don't intermediate versions flicker past
// during a fast shift+wheel scrub? chromium deviceScaleFactor 2 (Peter's desktop). Dispatches
// shift+wheel on window (the capture listener), COLD range vs WARM range, at fast + moderate
// cadence. Distinguishes the three candidate causes:
//   (A) commit-rate limiting / stale idxRef: dispatched events ≫ distinct COMMANDED versions
//       (scrub.want) → the handler can't run ahead of React commits.
//   (B) cold range / no residency: commanded ≈ traversed but PRESENTED (scrub.shown) low + exact
//       rate ~0 → no bitmap to show.
//   (C) swap cost: presented ok but frames > 30ms.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4222
const BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const opfsShim = eval('(() => {' + src.slice(src.indexOf('const opfsShim'), src.indexOf('// One paint-gated step')) + '; return opfsShim })()')
const stepFn = eval('(' + src.slice(src.indexOf('async (dir) => {'), src.indexOf('// A trackpad-scrub')).trim().replace(/;\s*$/, '') + ')')
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
const fstat = (f) => f.length ? { p50: median(f), max: +Math.max(...f).toFixed(1), over30ms: f.filter((x) => x > 30).length, over50ms: f.filter((x) => x > 50).length, n: f.length } : null

// Fire N shift+wheel events at `interval` on window; record frames + fidelity probes + counter.
const shiftWheelBurst = async ({ dir, events, interval }) => {
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
  const fstat = (f) => f.length ? { p50: median(f), max: +Math.max(...f).toFixed(1), over30ms: f.filter((x) => x > 30).length, over50ms: f.filter((x) => x > 50).length, n: f.length } : null
  window.__iwPerf.length = 0
  const frames = []; let rafOn = true, last = 0
  requestAnimationFrame(function loop(t) { if (last) frames.push(t - last); last = t; if (rafOn) requestAnimationFrame(loop) })
  const counterAt = () => document.body.textContent.match(/v\d+\.\d+\/\d+\.\d+/)?.[0] ?? null
  const c0 = counterAt()
  const t0 = performance.now(); let sent = 0
  while (sent < events) {
    const due = Math.min(events, Math.floor((performance.now() - t0) / interval) + 1)
    while (sent < due) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dir > 0 ? 120 : -120, shiftKey: true, bubbles: true, cancelable: true })); sent++ }
    await new Promise((r) => setTimeout(r, interval))
  }
  await new Promise((r) => setTimeout(r, 150)); rafOn = false
  const uniq = (a) => new Set(a).size
  const want = window.__iwPerf.filter((e) => e[0] === 'scrub.want').map((e) => e[1])
  const shown = window.__iwPerf.filter((e) => e[0] === 'scrub.shown').map((e) => e[1])
  const exact = window.__iwPerf.filter((e) => e[0] === 'scrub.exact').map((e) => e[1])
  return {
    dispatched: events,
    goToCalls: want.length,               // how many times show() ran (≈ goTo in rapid mode)
    commandedDistinct: uniq(want),        // distinct versions the handler actually TARGETED
    presentedDistinct: uniq(shown),       // distinct doc versions actually shown as bitmaps
    traversedSpan: want.length ? Math.abs(Math.max(...want) - Math.min(...want)) + 1 : 0,
    exactRate: exact.length ? +(exact.filter((x) => x === 1).length / exact.length).toFixed(2) : null,
    framesDuringBurst: fstat(frames.map((f) => +f.toFixed(1))),
    counterFrom: c0, counterTo: counterAt(),
  }
}

const snapsJson = buildSnapshots()
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))
await page.addInitScript(opfsShim, snapsJson)
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-30`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(5000)

const out = { deviceScaleFactor: 2 }
// COLD: from a fresh position, shift-wheel BACK (toward lower idx) fast — no pre-warming.
out.cold_fast = await page.evaluate(shiftWheelBurst, { dir: -1, events: 30, interval: 8 })
await page.waitForTimeout(2500)
// WARM the range snap-30..snap-12 by a slow walk, then shift-wheel over it.
await page.evaluate(stepFn, 1); await page.waitForTimeout(400)
for (let i = 0; i < 18; i++) { await page.evaluate(stepFn, -1); await page.waitForTimeout(1100) }
for (let i = 0; i < 6; i++) { await page.evaluate(stepFn, 1); await page.waitForTimeout(1100) } // land ~snap-24
await page.waitForTimeout(2500)
out.warm_fast = await page.evaluate(shiftWheelBurst, { dir: -1, events: 30, interval: 8 })
await page.waitForTimeout(2000)
out.warm_moderate = await page.evaluate(shiftWheelBurst, { dir: 1, events: 20, interval: 30 })
out.cacheFinal = await page.evaluate(() => window.__iwScrub && window.__iwScrub.stats())
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-shiftwheel.json`, JSON.stringify(out, null, 2))
await browser.close()
