// ─── THE 140px INVARIANT: the video's waves must be the SAME SIZE as the CSS water's ───────────
// Peter, live desktop 2026-07-17: "the video resolution and size of the waves does not match that
// of the background."
//
// WHY THIS IS THE WHOLE BALLGAME. The video is only ever a stand-in for the CSS water during the
// load; at the coast it HANDS BACK, and the CSS water draws the same pattern from that moment on.
// If the two disagree about how big a wave is, the hand-off is a visible jump. The CSS tile is
// 140 CSS px, always, at every viewport. So the video's tile must be 140 CSS px too — at every
// viewport, not just at the one the clip happened to be captured at.
//
// THE MISTAKE THIS PROBE EXISTS NOT TO REPEAT: the SSIM ≈ 0.98 that justified `object-fit: cover`
// compared the video TO ITSELF SCALED. Of course that scored well — a scaled sine wave still looks
// like a sine wave. It never once compared the video to the CSS WATER it has to match. This probe
// measures both, in device pixels, off the actual screen, and compares them to each other.
//
// METHOD: the waves are horizontal lines repeating down the viewport with a 140 CSS px period.
// Screenshot a narrow column, walk down it, find the bright wave-line rows, and take the median
// gap. Do it once with the video master and once with the CSS water. The two medians must agree.
//
// ⛔⛔ THIS PROBE IS VOID AS WRITTEN — ITS CONTROL FAILS. READ THIS BEFORE QUOTING A NUMBER FROM IT.
// At the desk rung's OWN size (1280x800) the cover scale is exactly 1.0, so the video and the CSS
// water MUST measure identical. They do not: it reports VIDEO 161.0 vs CSS 130.0 = 23.8% — which is
// the SAME mismatch it reports at 1920x1080 (164.0 vs 132.0 = 24.2%), where cover scale is 1.5.
// A mismatch that does not move with the cover factor is not measuring the cover factor. The video's
// measured period went 161 -> 164 across a viewport where cover predicts 140 -> 210, so this is a
// CONSTANT instrument offset — the two waters' lines are extracted differently (the encoded clip's
// thick/thin line pair blurs, so the luminance threshold picks different runs, and `median gap x 2`
// assumes an even pair it does not have). The CSS reading is itself 130 against a KNOWN 140.
// The cover-scale mechanism is real and unambiguous FROM SOURCE (object-fit:cover + width:100vw/
// height:100lvh + a 1280x800 clip => scale = max(vw/1280, vh/800)); this probe simply cannot
// measure it. It runs its control FIRST and VOIDS rather than reporting the fiction — the numbers
// above are exactly the shape of a verdict that would have been quoted for weeks.
// TO FIX IT: extract the tile period from the SIGNAL, not from thresholded peaks (autocorrelate the
// luminance column, or FFT it, and read the dominant period) — that needs no assumption about the
// line pair's spacing and degrades gracefully on a blurred clip.
//
// Usage: node scripts/wave-video/tilescale.prove.mjs [--port 4323] [--width 1920] [--height 1080]
import { webkit } from '@playwright/test'

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || 4323
const W = Number(args[args.indexOf('--width') + 1]) || 1920
const H = Number(args[args.indexOf('--height') + 1]) || 1080
const BASE = `http://127.0.0.1:${port}`

// Median vertical distance between wave lines in a 1px-wide column, in CSS px.
// Decoded IN THE PAGE via canvas — pngjs is only a transitive dep here, and a probe should not
// reach into .pnpm internals to exist.
const TILE_FN = `(dataUrl) => new Promise((res) => {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const x = Math.floor(img.width / 2)
    const lum = []
    for (let y = 0; y < img.height; y++) {
      const i = (img.width * y + x) << 2
      lum.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114)
    }
    const lo = Math.min.apply(null, lum), hi = Math.max.apply(null, lum)
    if (hi - lo < 12) return res({ period: null, why: 'flat column (contrast ' + (hi - lo).toFixed(1) + ') — no wave lines' })
    const thr = lo + (hi - lo) * 0.62
    const peaks = []; let run = null
    for (let y = 0; y < lum.length; y++) {
      if (lum[y] >= thr) { if (run === null) run = y }
      else if (run !== null) { peaks.push((run + y - 1) / 2); run = null }
    }
    if (peaks.length < 3) return res({ period: null, why: 'only ' + peaks.length + ' wave lines found' })
    const gaps = []
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1])
    gaps.sort((a, b) => a - b)
    const med = gaps[Math.floor(gaps.length / 2)]
    res({ period: med * 2, why: peaks.length + ' lines, median gap ' + med.toFixed(1) + 'px' })
  }
  img.onerror = () => res({ period: null, why: 'decode failed' })
  img.src = dataUrl
})`
const measure = async (page, buf) =>
  page.evaluate(`(${TILE_FN})('data:image/png;base64,${buf.toString('base64')}')`)

const b = await webkit.launch()
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { localStorage.setItem('inkwave:waveVideo', 'debug') } catch { /* private */ } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })

let master = false
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(100)
  if (await page.evaluate(() => !!window.__iwWaveVideo?.master)) { master = true; break }
}
if (!master) { console.log('INCONCLUSIVE: the video never became master — nothing to compare.'); await b.close(); process.exit(2) }

// Hide the debug overlay so it cannot pollute the sampled column.
await page.addStyleTag({ content: 'div[aria-hidden="true"][style*="2147483647"]{display:none!important}' })
const videoShot = await page.screenshot({ clip: { x: W / 2 - 1, y: 0, width: 2, height: H } })
const vid = await measure(page, videoShot)

// Now the CSS water, same page, same viewport: drop the video and let the DOM water draw.
await page.evaluate(() => {
  for (const v of document.querySelectorAll('video.iw-wave-video-el')) v.remove()
  document.documentElement.classList.remove('iw-wave-video-on')
})
await page.waitForTimeout(400)
const cssShot = await page.screenshot({ clip: { x: W / 2 - 1, y: 0, width: 2, height: H } })
const css = await measure(page, cssShot)

// THE CONTROL, FIRST. At the rung's own size cover scale is 1.0 and the two waters must agree; if
// they do not, nothing this probe says about any other viewport can be read.
const CONTROL_OK = false // set true only when the control below actually passes
console.log(`\n─── WAVE TILE PERIOD @ ${W}x${H} ───`)
console.log(`  VIDEO water : ${vid.period ? vid.period.toFixed(1) + ' CSS px' : 'n/a'}   (${vid.why})`)
console.log(`  CSS water   : ${css.period ? css.period.toFixed(1) + ' CSS px' : 'n/a'}   (${css.why})`)

const problems = []
if (!vid.period || !css.period) problems.push('could not measure one of the two waters — no verdict')
else {
  const drift = Math.abs(vid.period - css.period)
  const pct = (drift / css.period) * 100
  console.log(`  MISMATCH    : ${drift.toFixed(1)} CSS px (${pct.toFixed(1)}%)`)
  // Sub-pixel-ish agreement is the bar: the hand-off swaps one for the other in a single frame.
  if (drift > 4) problems.push(`THE VIDEO'S WAVES ARE THE WRONG SIZE: ${vid.period.toFixed(1)}px vs the CSS water's ${css.period.toFixed(1)}px (${pct.toFixed(1)}% off) — the hand-off jumps`)
}

console.log('\n─── VERDICT ───')
if (!CONTROL_OK) {
  console.log('  ⊘ VOID — this probe\'s control fails (see the header): at the rung\'s own size, where')
  console.log('    cover scale is 1.0, it still reports ~24% mismatch. The offset is the instrument,')
  console.log('    not the video. Do not quote these numbers. Fix the extractor (autocorrelation)')
  console.log('    before reading a verdict from this file.')
  await b.close()
  process.exit(2)
}
for (const p of problems) console.log('  ✗', p)
if (!problems.length) console.log('  ✓ the video and the CSS water agree on the tile size — the hand-off is seamless')
await b.close()
process.exit(problems.length ? 1 : 0)
