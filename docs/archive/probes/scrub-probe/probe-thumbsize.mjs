// Thumbnail BYTE-SIZE measurement for the pre-bake assessment: a representative text-page canvas
// at DPR1 doc-pane size (and a 0.75× scrub-thumbnail size), encoded WebP/PNG at several qualities.
// Gives real bytes/thumbnail × snapshot-count so the .studio bundle cost is measured, not guessed.
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const res = await page.evaluate(async () => {
  const draw = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d')
    x.fillStyle = '#f6f3ec'; x.fillRect(0, 0, w, h) // parchment
    x.fillStyle = '#fff'; x.fillRect(w * 0.08, h * 0.04, w * 0.84, h * 0.92) // page sheet
    x.fillStyle = '#2b2b2b'; x.font = '15px Georgia, serif'
    const words = 'philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence analysis synthesis method critique framework ontology'.split(' ')
    let line = 0
    for (let yy = h * 0.09; yy < h * 0.94; yy += 22) { // ~34 lines of justified-ish text
      let xx = w * 0.11, s = ''
      while (xx < w * 0.88) { const wd = words[(line * 7 + s.length) % words.length]; s += wd + ' '; xx += x.measureText(wd + ' ').width }
      x.fillText(s.trim(), w * 0.11, yy); line++
    }
    // a couple of purple "kick" words + a page-number seal
    x.fillStyle = '#5c2d8a'; x.fillRect(w * 0.2, h * 0.3, 60, 14); x.fillRect(w * 0.5, h * 0.55, 48, 14)
    x.fillStyle = '#8a7a5a'; x.beginPath(); x.arc(w * 0.5, h * 0.965, 10, 0, 7); x.fill()
    return c
  }
  const enc = async (c, type, q) => {
    const blob = await new Promise((r) => c.toBlob(r, type, q))
    return blob ? blob.size : null
  }
  const out = {}
  for (const [label, w, h] of [['docPane_DPR1_900x820', 900, 820], ['scrubThumb_0.75x_675x615', 675, 615], ['scrubThumb_0.5x_450x410', 450, 410]]) {
    const c = draw(w, h)
    out[label] = {
      png: await enc(c, 'image/png'),
      webp_q85: await enc(c, 'image/webp', 0.85),
      webp_q70: await enc(c, 'image/webp', 0.70),
      webp_q55: await enc(c, 'image/webp', 0.55),
    }
  }
  return out
})
const kb = (b) => b == null ? null : +(b / 1024).toFixed(1)
const rows = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, kb(vv) + 'KB']))]))
// project bundle cost for a thesis-scale history
const perThumb70 = res['scrubThumb_0.75x_675x615'].webp_q70
const project = (n) => ({ snapshots: n, docOnly_MB: +((perThumb70 * n) / 1e6).toFixed(1), docPlusDiffPlusMap_MB: +((perThumb70 * 3 * n) / 1e6).toFixed(1) })
console.log(JSON.stringify({ encodedSizes: rows, bundleProjection_webpQ70_075x: [project(100), project(300), project(600)] }, null, 2))
await browser.close()
