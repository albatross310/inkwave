// Clean flipbook swap-cost + fidelity: warm a contiguous window, QUIESCE captures, then shift-wheel
// through the WARM window (all exact hits, no captures contending) and separate JS show() time
// (scrub.step) from actual presented-frame deltas (GPU/compositor). Answers the Photos bar: does a
// shift-wheel present ~every warmed version at ≤30ms/frame? chromium deviceScaleFactor 2.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4224
const BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const opfsShim = eval('(() => {' + src.slice(src.indexOf('const opfsShim'), src.indexOf('// One paint-gated step')) + '; return opfsShim })()')
const stepFn = eval('(' + src.slice(src.indexOf('async (dir) => {'), src.indexOf('// A trackpad-scrub')).trim().replace(/;\s*$/, '') + ')')
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
const fstat = (f) => f.length ? { p50: median(f), max: +Math.max(...f).toFixed(1), over30ms: f.filter((x) => x > 30).length, over50ms: f.filter((x) => x > 50).length, n: f.length } : null

const quiesce = async (quietMs) => {
  let lastLen = -1, lastChange = performance.now()
  while (performance.now() - lastChange < quietMs) {
    const n = window.__iwPerf.filter((e) => e[0] === 'scrub.capture').length
    if (n !== lastLen) { lastLen = n; lastChange = performance.now() }
    await new Promise((r) => setTimeout(r, 150))
    if (performance.now() - lastChange > 15000) break
  }
}
// Shift-wheel burst; record frames + JS show() time (scrub.step) + fidelity.
const swBurst = async ({ dir, events, interval }) => {
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2) }
  const fs = (f) => f.length ? { p50: med(f), max: +Math.max(...f).toFixed(1), over30ms: f.filter((x) => x > 30).length, over50ms: f.filter((x) => x > 50).length, n: f.length } : null
  window.__iwPerf.length = 0
  const frames = []; let rafOn = true, last = 0
  requestAnimationFrame(function loop(t) { if (last) frames.push(t - last); last = t; if (rafOn) requestAnimationFrame(loop) })
  const cget = () => document.body.textContent.match(/v\d+\.\d+\/\d+\.\d+/)?.[0] ?? null
  const c0 = cget()
  const t0 = performance.now(); let sent = 0
  while (sent < events) {
    const due = Math.min(events, Math.floor((performance.now() - t0) / interval) + 1)
    while (sent < due) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dir > 0 ? 120 : -120, shiftKey: true, bubbles: true, cancelable: true })); sent++ }
    await new Promise((r) => setTimeout(r, interval))
  }
  await new Promise((r) => setTimeout(r, 200)); rafOn = false
  const uniq = (a) => new Set(a).size
  const want = window.__iwPerf.filter((e) => e[0] === 'scrub.want').map((e) => e[1])
  const shown = window.__iwPerf.filter((e) => e[0] === 'scrub.shown').map((e) => e[1])
  const exact = window.__iwPerf.filter((e) => e[0] === 'scrub.exact').map((e) => e[1])
  const stepJs = window.__iwPerf.filter((e) => e[0] === 'scrub.step').map((e) => e[1])
  const cap = window.__iwPerf.filter((e) => e[0] === 'scrub.capture').length
  return {
    dispatched: events, showCalls: want.length,
    commandedDistinct: uniq(want), presentedDistinct: uniq(shown),
    presentedSpan: shown.length ? Math.abs(Math.max(...shown) - Math.min(...shown)) + 1 : 0,
    exactRate: exact.length ? +(exact.filter((x) => x === 1).length / exact.length).toFixed(2) : null,
    showJsMs: fs(stepJs), framesDuringBurst: fs(frames.map((f) => +f.toFixed(1))),
    capturesDuringBurst: cap, counterFrom: c0, counterTo: cget(),
  }
}

const snapsJson = buildSnapshots()
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))
await page.addInitScript(opfsShim, snapsJson)
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(5000)

// Warm a wide contiguous window (snap-26 → snap-8 → back to snap-24) so the flipbook window is cached.
for (let i = 0; i < 18; i++) { await page.evaluate(stepFn, -1); await page.waitForTimeout(1000) }
for (let i = 0; i < 14; i++) { await page.evaluate(stepFn, 1); await page.waitForTimeout(1000) } // land ~snap-22
await page.evaluate(quiesce, 2500) // drain captures fully → frames reflect ONLY the flipbook swap
const statsWarm = await page.evaluate(() => window.__iwScrub && window.__iwScrub.stats())

const out = { deviceScaleFactor: 2, cache: { entries: statsWarm?.entries, MB: statsWarm ? +(statsWarm.bytes / 1e6).toFixed(1) : null } }
// Fast shift-wheel BACK across the warmed window (snap-22 → toward snap-8).
out.warm_fast_back = await page.evaluate(swBurst, { dir: -1, events: 14, interval: 8 })
await page.waitForTimeout(1500)
await page.evaluate(quiesce, 2000)
// Moderate shift-wheel FORWARD across it again.
out.warm_mod_fwd = await page.evaluate(swBurst, { dir: 1, events: 12, interval: 28 })
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-flipbook-clean.json`, JSON.stringify(out, null, 2))
await browser.close()
