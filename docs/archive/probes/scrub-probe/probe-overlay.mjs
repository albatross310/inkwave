// Job 1+2+3: does the SWEEP fill the cache from cold, and what does the ?snapThumbs=debug overlay
// report during a fast cold fling? Real in-memory OPFS shim; NO pre-walking (genuinely cold).
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4227, BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26&snapThumbs=debug`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(5000)
const thumbCount = async () => await page.evaluate(() => { let n = 0; for (const [k] of window.__iwOpfsFiles) if (k.includes('/thumbs/') && k.endsWith('.webp')) n++; return n })
const out = { sweep: { atStart: await thumbCount() } }
// ── SWEEP: sit idle and watch the library fill ──
for (const t of [10, 20, 35]) { await page.waitForTimeout(t === 10 ? 10000 : 10000 + (t === 20 ? 0 : 5000)); out.sweep['after' + t + 's'] = await thumbCount() }
out.sweep.docVersionsBaked = await page.evaluate(() => {
  let idx = null; for (const [k, v] of window.__iwOpfsFiles) if (k.endsWith('/thumbs/index.json')) idx = JSON.parse(new TextDecoder().decode(v))
  const s = new Set(); if (idx) for (const key of Object.keys(idx.entries)) if (key.split('|')[1] === 'doc') s.add(key.split('|')[0])
  return s.size
})
// ── FAST COLD FLING: what does the overlay say? ──
out.fling = await page.evaluate(async () => {
  for (let i = 0; i < 12; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 14)) }
  const mid = window.__iwScrub.debugInfo() // sampled DURING the burst
  await new Promise(r => setTimeout(r, 60))
  return { shows: mid.shows, memEntries: mid.entries, panes: mid.panes.map(p => ({ kind: p.kind, hitCapture: p.hitCapture, hitThumb: p.hitThumb, nearest: p.nearest, none: p.none, visible: p.visible, display: p.display, opacity: p.opacity, zIndex: p.zIndex, box: `${p.rectW}x${p.rectH}`, canvas: `${p.canvasW}x${p.canvasH}` })) }
})
out.overlayText = (await page.evaluate(() => {
  const els = [...document.querySelectorAll('div')].filter(d => d.textContent?.startsWith('scrub debug'))
  return els.length ? els[0].innerText : null
}))
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-overlay.json`, JSON.stringify(out, null, 2))
await browser.close()
