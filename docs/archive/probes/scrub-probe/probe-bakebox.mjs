// PROVE THE BOX GUARD. The bake/lookup key now has ONE source (the surface). The guard that
// catches a divergence is the shape that silently disabled arithLayout for months — it never
// fires in a healthy tree, and never-fires is indistinguishable from not-needed. So:
//   NEGATIVE: healthy tree -> guard silent, all three panes bake.
//   POSITIVE: inject a KNOWN 6px divergence -> guard MUST fire and refuse.
// If the positive cell does not fire, the guard is decorative and the "loud" claim is false.
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4291, BASE = `http://127.0.0.1:${PORT}`
const IDLE_S = Number(process.env.PROBE_IDLE_S || 40)
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const tsrc = await readFile(new URL('./probe-thumbs.mjs', import.meta.url), 'utf8')
const realOpfsShim = eval('(' + tsrc.slice(tsrc.indexOf('(json) => {'), tsrc.indexOf('const med =')).trim().replace(/;\s*$/, '') + ')')

const cell = async (label, nudge) => {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage()
  await page.addInitScript(realOpfsShim, buildSnapshots())
  await page.addInitScript((n) => { window.__iwPerf = []; window.__iwThumbTrace = []; if (n) window.__iwBakeBoxNudge = n }, nudge)
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26&snapThumbs=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(IDLE_S * 1000)
  const r = await page.evaluate(() => {
    const fired = {}, refused = {}
    for (const [l] of window.__iwPerf) {
      if (l.startsWith('scrub.bake.boxMismatch.')) fired[l.split('.').pop()] = (fired[l.split('.').pop()] || 0) + 1
      if (l.startsWith('scrub.bake.refused.')) refused[l.split('.').pop()] = (refused[l.split('.').pop()] || 0) + 1
    }
    let idx = null
    for (const [k, v] of window.__iwOpfsFiles) if (k.endsWith('/thumbs/index.json')) idx = JSON.parse(new TextDecoder().decode(v))
    const baked = { doc: new Set(), diff: new Set(), map: new Set() }
    if (idx) for (const key of Object.keys(idx.entries)) { const [id, pane] = key.split('|'); if (baked[pane]) baked[pane].add(id) }
    return { mismatchFired: fired, refused, baked: { doc: baked.doc.size, diff: baked.diff.size, map: baked.map.size },
      traceSample: (window.__iwThumbTrace || []).filter((t) => String(t).includes('boxMismatch')).slice(0, 2) }
  })
  await browser.close()
  return { label, nudge, ...r }
}
const neg = await cell('NEGATIVE — healthy tree', 0)
const pos = await cell('POSITIVE — injected 6px divergence', 6)
console.log(JSON.stringify(neg)); console.log(JSON.stringify(pos))
const negSilent = Object.keys(neg.mismatchFired).length === 0 && neg.baked.map > 0
const posFired = Object.keys(pos.mismatchFired).length > 0 && Object.keys(pos.refused).length > 0
console.log('\nNEGATIVE:', negSilent ? `✅ guard silent, panes bake (doc ${neg.baked.doc} diff ${neg.baked.diff} map ${neg.baked.map})` : `❌ guard fires on a healthy tree — it would refuse real bakes`)
console.log('POSITIVE:', posFired ? `✅ guard SEES an injected 6px divergence and refuses (${JSON.stringify(pos.refused)}) — map baked ${pos.baked.map}` : `❌ guard is DECORATIVE — a known divergence did not fire it`)
console.log('VERDICT :', negSilent && posFired ? 'guard is real and discriminating' : 'guard cannot be trusted')
