// THE EVICTION RULE — does the mem budget actually hold, and is every bound NAMED?
// Peter's device: `mem bitmaps 163 · 62.9MB` and CLIMBING (57.3MB the burst before) against a
// DESKTOP_BUDGET of 60MB. Over budget is either (a) a real leak, (b) eviction that cannot free
// enough, or (c) a shortfall nobody logs. `planEviction` can fall through with freed < over and
// say nothing, and `enforceBudget` never re-checks — so a silently-exceeded budget reads exactly
// like a budget that holds. Sample from INSIDE the page (an interval sampler records into an
// array; the debug overlay repaints on the thread the scrub saturates and cannot see a burst).
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 45)
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')
const FORCE = Number(process.env.FORCE_BUDGET || 0) // POSITIVE cell: shrink the cap to force a shortfall
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage()
if (FORCE) await page.addInitScript((b) => { window.__iwMemBudget = b }, FORCE)
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 160)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.addInitScript(() => {
  window.__iwPerf = []
  window.__iwMemSamples = []
  const tick = () => {
    const s = window.__iwScrub && window.__iwScrub.stats && window.__iwScrub.stats()
    if (s) window.__iwMemSamples.push({ t: Math.round(performance.now()), entries: s.entries, bytes: s.bytes })
  }
  setInterval(tick, 120) // records into an array — never a DOM read, so a burst cannot hide it
})
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-35&snapThumbs=1`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(3000)
const env = await page.evaluate(() => ({ dpr: window.devicePixelRatio, touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0 }))
console.log('ENV:', JSON.stringify(env), '→ budget', env.touch ? '24MB (touch)' : '60MB (desktop)')
const BUDGET = FORCE || (env.touch ? 24 : 60) * 1024 * 1024
if (FORCE) console.log(`FORCED BUDGET: ${(FORCE / 1e6).toFixed(2)}MB — the guard must NAME the shortfall it cannot evict away`)

console.log(`(sweeping ${IDLE_S}s to bake the library…)`)
await page.waitForTimeout(IDLE_S * 1000)
// Drive the WHOLE library repeatedly: hydration + capture both add bytes; this is the pressure.
for (let round = 0; round < 3; round++) {
  await page.evaluate(async () => {
    for (let i = 0; i < 34; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 22))
    }
    await new Promise((r) => setTimeout(r, 500))
    for (let i = 0; i < 34; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 22))
    }
    await new Promise((r) => setTimeout(r, 900))
  })
}
await page.waitForTimeout(2500)
const r = await page.evaluate((budget) => {
  const s = window.__iwMemSamples
  const peak = s.reduce((a, b) => (b.bytes > a.bytes ? b : a), s[0] || { bytes: 0, entries: 0 })
  const over = s.filter((x) => x.bytes > budget)
  const now = window.__iwScrub.stats()
  const mem = window.__iwPerf.filter(([l]) => l === 'scrub.mem').map(([, v]) => v)
  const named = {}
  for (const [l] of window.__iwPerf) if (l.startsWith('scrub.mem.') || l.startsWith('scrub.evict')) named[l] = (named[l] || 0) + 1
  return {
    samples: s.length,
    peakMB: +(peak.bytes / 1e6).toFixed(1), peakEntries: peak.entries,
    atRestMB: +(now.bytes / 1e6).toFixed(1), atRestEntries: now.entries,
    budgetMB: +(budget / 1e6).toFixed(1),
    samplesOverBudget: over.length, worstOvershootMB: over.length ? +((Math.max(...over.map((x) => x.bytes)) - budget) / 1e6).toFixed(2) : 0,
    scrubMemProbePeakMB: mem.length ? +Math.max(...mem).toFixed(1) : null,
    namedBoundProbes: named, // any bound that LOGS itself by name — today: none expected
  }
}, BUDGET)
console.log(JSON.stringify(r, null, 1))
console.log('\nBUDGET HELD:', r.samplesOverBudget === 0 ? `✅ never exceeded ${r.budgetMB}MB (peak ${r.peakMB}MB / ${r.peakEntries} entries)` : `❌ EXCEEDED on ${r.samplesOverBudget}/${r.samples} samples — peak ${r.peakMB}MB vs budget ${r.budgetMB}MB (worst overshoot ${r.worstOvershootMB}MB)`)
console.log('BOUND NAMED:', Object.keys(r.namedBoundProbes).length ? `✅ ${JSON.stringify(r.namedBoundProbes)}` : '❌ NO bound logs itself — an exceeded budget is indistinguishable from a held one')
await browser.close()
