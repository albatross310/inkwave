// Round 10: does the sweep now bake ALL THREE panes, so a fast fling into a COLD range presents
// real versions for doc + diff + map (not just doc)? Reads the ?snapThumbs=debug overlay's
// per-pane hit/thumb/nearest/none counters after an idle sweep. Real in-memory OPFS shim; NO
// pre-walking (genuinely cold). Env: PROBE_PORT, PROBE_IDLE_S (default 60).
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4227, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 60)
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

// Distinct snapshots baked per pane, straight out of the OPFS index (the source of truth).
const baked = async () => await page.evaluate(() => {
  let idx = null
  for (const [k, v] of window.__iwOpfsFiles) if (k.endsWith('/thumbs/index.json')) idx = JSON.parse(new TextDecoder().decode(v))
  const s = { doc: new Set(), diff: new Set(), map: new Set() }
  let bytes = 0
  if (idx) for (const [key, e] of Object.entries(idx.entries)) {
    const [snapId, pane] = key.split('|')
    if (s[pane]) s[pane].add(snapId)
    bytes += e.bytes
  }
  return { doc: s.doc.size, diff: s.diff.size, map: s.map.size, bytes }
})

const out = { idleSeconds: IDLE_S, sweep: { atStart: await baked() }, timeline: [] }
for (let t = 0; t < IDLE_S; t += 15) {
  await page.waitForTimeout(15000)
  out.timeline.push({ atSeconds: t + 15, ...(await baked()) })
}
out.sweep.after = out.timeline[out.timeline.length - 1]

// ── FAST COLD FLING into the swept range: what does each pane present? ──
const fling = async (label) => {
  const r = await page.evaluate(async () => {
    window.__iwScrub.resetBurst()
    for (let i = 0; i < 12; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 14))
    }
    const mid = window.__iwScrub.debugInfo() // sampled DURING the burst
    return {
      shows: mid.shows,
      panes: mid.panes.map((p) => ({ kind: p.kind, hit: p.hitCapture, thumb: p.hitThumb, nearest: p.nearest, none: p.none, painted: p.visible })),
    }
  })
  return { label, ...r }
}
out.flingCold = await fling('cold')
await page.waitForTimeout(3000)
out.flingSecond = await fling('second')

// The overlay Peter actually reads.
out.overlayText = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div')].filter((d) => d.textContent?.startsWith('scrub debug'))
  return els.length ? els[0].innerText : null
})
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-sweep-panes.json`, JSON.stringify(out, null, 2))
await browser.close()
