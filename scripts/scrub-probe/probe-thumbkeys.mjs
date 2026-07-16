// Round 10: WHY is the thumb column zero? The store is a two-sided key contract — bake writes a
// render-signature, hydrate recomputes one. This records BOTH sides verbatim (window.__iwThumbTrace)
// and diffs them, rather than reasoning about which side drifted.
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
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.addInitScript(() => { window.__iwThumbTrace = []; window.__iwPerf = [] })
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(Number(process.env.PROBE_IDLE_S || 45) * 1000) // let the sweep bake

const bakes = await page.evaluate(() => window.__iwThumbTrace.filter((t) => t.startsWith('BAKE')))
console.log('── BAKE keys (' + bakes.length + ') ──')
for (const b of bakes.slice(0, 8)) console.log('  ' + b)

// A fling drives show() → preloadThumbs → hydrate → LOOK.hit/miss for the surrounding window.
await page.evaluate(async () => {
  window.__iwThumbTrace.length = 0
  window.__iwScrub.resetBurst()
  for (let i = 0; i < 12; i++) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 14))
  }
})
const looks = await page.evaluate(() => [...new Set(window.__iwThumbTrace)])
console.log('\n── LOOKUPS during fling (' + looks.length + ' distinct) ──')
const miss = looks.filter((l) => l.startsWith('LOOK.miss')), hit = looks.filter((l) => l.startsWith('LOOK.hit'))
const hyd = looks.filter((l) => l.startsWith('HYDRATED')), thr = looks.filter((l) => l.startsWith('HYDRATE.throw'))
console.log(`  LOOK.hit ${hit.length}  LOOK.miss ${miss.length}  HYDRATED ${hyd.length}  throw ${thr.length}`)
for (const m of miss.slice(0, 6)) console.log('  ' + m)
for (const h of hyd.slice(0, 4)) console.log('  ' + h)
for (const t of thr.slice(0, 4)) console.log('  ' + t)

// The verdict: do the two sides' signature strings agree at all?
const bakeSigs = new Set(bakes.map((b) => b.slice(5)))
const missSigs = miss.map((m) => m.slice(10))
console.log('\n── DIFF ──')
console.log('  miss keys that DO exist in BAKE set:', missSigs.filter((s) => bakeSigs.has(s)).length, '/', missSigs.length)
const anyBake = [...bakeSigs][0], anyMiss = missSigs[0]
console.log('  sample BAKE:', anyBake)
console.log('  sample MISS:', anyMiss)

// Settled state: after the fling, did anything actually hydrate?
await page.waitForTimeout(2500)
const post = await page.evaluate(() => {
  const info = window.__iwScrub.debugInfo()
  return { panes: info.panes.map((p) => `${p.kind} ${p.hitCapture}/${p.hitThumb}/${p.nearest}/${p.none}`), entries: info.entries, hydrated: window.__iwThumbTrace.filter((t) => t.startsWith('HYDRATED')).length }
})
console.log('\n── AFTER fling ──', JSON.stringify(post, null, 1))
await browser.close()
