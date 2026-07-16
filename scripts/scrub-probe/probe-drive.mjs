// THE DRIVER'S INPUT SIDE — events IN vs versions OUT.
// "flips 1.08x commanded" measures presents against COMMANDS, so it is blind to commands never
// issued. Peter: 232 steps -> 71 distinct, 5/s. This counts the thing that invariant cannot see:
// wheel events dispatched (known, we dispatch them) vs versions actually commanded/presented.
//
// KNOWN-POSITIVE first: the recorder must see a commanded show() count it cannot have inferred.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.addInitScript(() => { window.__iwPerf = [] })
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-35&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(4000)
const kp = await page.evaluate(() => {
  const p = window.__iwScrub; p.resetRecord()
  for (let i = 0; i < 13; i++) p.show('snap-' + (5 + i))
  const rec = p.record(); const panes = new Set(rec.map((r) => r.pane))
  return { presents: rec.length / panes.size, PASS: rec.length / panes.size === 13 }
})
console.log('KNOWN-POSITIVE recorder:', JSON.stringify(kp))
if (!kp.PASS) { console.log('❌ instrument blind — abort'); await browser.close(); process.exit(1) }

// One cell = N shift-wheel events of a given delta at a given interval. We KNOW events in.
const drive = async (label, { n, delta, gapMs }) => {
  await page.evaluate(() => { window.__iwScrub.hide(); window.__iwScrub.resetRecord() })
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-35&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const t0 = Date.now()
  const r = await page.evaluate(async ([n, delta, gapMs]) => {
    window.__iwScrub.resetRecord()
    const t = performance.now()
    for (let i = 0; i < n; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, gapMs))
    }
    const inputSpan = performance.now() - t
    await new Promise((r) => setTimeout(r, 900)) // let the rAF driver drain + land
    const rec = window.__iwScrub.record()
    return { rec, inputSpan }
  }, [n, delta, gapMs])
  const sum = await page.evaluate((rec) => window.__iwSummarise(rec), r.rec)
  const wallMs = Date.now() - t0
  return {
    label, eventsIn: n, deltaPerEvent: delta, gapMs,
    commandedDistinct: sum.commandedDistinct, presents: sum.presents,
    versionsPerEvent: +(sum.commandedDistinct / n).toFixed(2),
    presentsPerSec: +(sum.presents / (r.inputSpan / 1000)).toFixed(1),
    inputRatePerSec: +(n / (r.inputSpan / 1000)).toFixed(1), wallMs,
  }
}
const rows = []
rows.push(await drive('1 notch-rate 60ms, delta 120', { n: 30, delta: 120, gapMs: 60 }))
rows.push(await drive('2 FAST fling 16ms, delta 120', { n: 30, delta: 120, gapMs: 16 }))
rows.push(await drive('3 FAST fling 16ms, delta 480 (4x)', { n: 30, delta: 480, gapMs: 16 }))
rows.push(await drive('4 trackpad-ish 16ms, delta 12', { n: 30, delta: 12, gapMs: 16 }))
for (const r of rows) console.log(JSON.stringify(r))
console.log('\nDELTA TEST — does scrolling HARDER move more versions?')
console.log(`  delta 120 -> ${rows[1].commandedDistinct} versions | delta 480 (4x) -> ${rows[2].commandedDistinct} versions`)
console.log(rows[2].commandedDistinct <= rows[1].commandedDistinct + 2
  ? '  ❌ 4x the delta buys NOTHING — the driver discards it: hard-capped at 1 version per EVENT.'
  : '  ✅ delta scales versions.')
await browser.close()
