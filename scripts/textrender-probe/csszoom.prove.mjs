// Does CSS `zoom` on the PAPER preserve the wrap? — the /snapshot doc pane's convention, probed.
//
// The pane applies a fit-capped CSS `zoom` to the paper, and staticPagination FORCES every inline
// zoom on that path to 1 before measuring ("or the measured line grid would scale with the pane
// zoom"). So the pane's canonical breaks are measured at zoom 1 and the zoom is purely visual —
// which is what licenses treating zoom as a SCALE FACTOR ON THE PAINT and reusing one canonical
// break table at every zoom. I stated that last round instead of probing it. This probes it.
//
// KNOWN-POSITIVE/NEGATIVE: CSS zoom scales font AND width together, so the wrap must NOT move.
// A real WIDTH change (same visual scale, narrower column) MUST move it — if the metric can't see
// that, it can't see anything.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4241}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'cssz' })
await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
await page.waitForFunction(()=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>1000,null,{timeout:60000})
await page.waitForTimeout(6000)

// Per-paragraph LINE COUNT from deduped rect tops — zoom-independent by construction (a ratio),
// which is exactly why it can detect a wrap change without being fooled by the visual scale.
const lineSig = () => page.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const out = []
  const kids = [...pm.children].slice(0, 14)
  for (const el of kids) {
    if (!el.textContent.trim()) continue
    const r = document.createRange(); r.selectNodeContents(el)
    const rects = [...r.getClientRects()].filter(x => x.height > 1)
    const tops = []
    // dedupe in LOCAL px: divide by the visual scale so the 3px tolerance means the same thing
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1
    for (const rc of rects) { const t = rc.top / scale; if (!tops.some(v => Math.abs(v - t) < 3)) tops.push(t) }
    out.push(tops.length)
  }
  return out
})
const setZoom = (z) => page.evaluate((z) => {
  const p = document.querySelector('.iw-magnify-box')
  if (z === null) p.style.removeProperty('zoom'); else p.style.setProperty('zoom', String(z))
}, z)

const base = await lineSig()
console.log('paper CSS zoom 1.00 : line counts', JSON.stringify(base))
const eq = (a, x) => a.length === x.length && a.every((v, i) => v === x[i])
let allSame = true
for (const z of [0.5, 0.75, 1.5, 2]) {
  await setZoom(z); await page.waitForTimeout(700)
  const s = await lineSig()
  const same = eq(base, s)
  if (!same) allSame = false
  console.log(`paper CSS zoom ${z.toFixed(2)} : wrap UNCHANGED = ${same}  ${same ? '' : JSON.stringify(s)}`)
}
await setZoom(null); await page.waitForTimeout(500)
// KNOWN-NEGATIVE: a real column-width change MUST move the wrap.
await page.evaluate(() => { document.querySelector('.ProseMirror').style.width = '380px' })
await page.waitForTimeout(700)
const narrow = await lineSig()
const moved = !eq(base, narrow)
console.log(`\nKNOWN-NEGATIVE (column 380px, no zoom): wrap MOVED = ${moved} ${moved ? '(metric can see a real wrap change)' : '(METRIC IS BLIND — ignore everything above)'}`)
console.log(`\nVERDICT: CSS zoom on the paper preserves the wrap at every step = ${allSame}; metric discriminates = ${moved}`)
await b.close()
