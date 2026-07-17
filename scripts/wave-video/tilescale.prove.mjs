// ─── THE 140px INVARIANT: the video's waves must be the SAME SIZE as the CSS water's ───────────
// Peter, live desktop 2026-07-17: "the video resolution and size of the waves does not match that
// of the background."
//
// WHY THIS IS THE WHOLE BALLGAME. The video is only ever a stand-in for the CSS water during the
// load; at the coast it HANDS BACK and the CSS water draws the same pattern from that moment on. If
// the two disagree about how big a wave is, the hand-off is a visible jump. The CSS tile is 140 CSS
// px at EVERY viewport. So the video's tile must be 140 CSS px at every viewport too — not just at
// the one the clip happened to be captured at.
//
// THE MISTAKE THIS EXISTS NOT TO REPEAT: the SSIM ≈ 0.98 that justified `object-fit: cover` compared
// the video TO ITSELF SCALED. Of course that scored well — a scaled sine wave still looks like a
// sine wave. It never compared the video to the CSS WATER it has to match.
//
// AND THE MISTAKE THIS PROBE ITSELF MADE (v1, 2026-07-17 — kept here because it is the lesson):
// v1 extracted the period from THRESHOLDED PEAKS and doubled the median gap, assuming an even
// thick/thin line pair that NEITHER water has. It reported a tidy 24.2% mismatch at 1920x1080 —
// a perfect confirmation of the hypothesis — and then its control, at the rung's own size where
// cover scale is exactly 1.0 and the two MUST agree, reported 23.8%. A mismatch that does not move
// with the cover factor is not measuring the cover factor. It was a constant EXTRACTOR offset, and
// it read the CSS water at 130 against a KNOWN 140.
//
// SO: read the period from the SIGNAL. Autocorrelation of the detrended luminance column assumes
// nothing about line structure, spacing, or blur — it just finds the length at which the pattern
// repeats. THE CONTROL IS THE POINT: the CSS water's tile is KNOWN to be 140 CSS px, so if this
// instrument cannot recover 140 from the CSS water, nothing it says about the video counts.
//
// MODES:
//   --mode cover  (default) the SHIPPED styling: width:100vw/height:100lvh + object-fit:cover.
//   --mode crop             Peter's proposal: element sized to the clip's DESIGN CSS box, the
//                           viewport crops the overflow. Applied at runtime — this probe changes
//                           no product code, it measures whether the design is sound before anyone
//                           commits to the bytes.
//
// DPI, STATED: today's desk clip is captured at dsf:1, so crop-mode here proves the SCALE invariant
// only. Peter's "preserve dpi" needs the clip authored at design CSS x DPR (tiles at 140xDPR) with
// the element still sized to the design CSS box — same construction, sharper source. That needs a
// regenerated clip (630KB AV1 / 2.8MB H.264 measured), which is his call.
//
// Usage: node scripts/wave-video/tilescale.prove.mjs [--port 4325] [--width 1280] [--height 800]
//                                                    [--mode cover|crop]
import { webkit } from '@playwright/test'

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || 4325
const W = Number(args[args.indexOf('--width') + 1]) || 1280
const H = Number(args[args.indexOf('--height') + 1]) || 800
const MODE = args.indexOf('--mode') >= 0 ? args[args.indexOf('--mode') + 1] : 'cover'
const BASE = `http://127.0.0.1:${port}`

// The desk clip's capture geometry (generate.mjs LADDER) — its DESIGN CSS box.
const DESIGN = { w: 1280, h: 800 }
const CSS_TILE = 140 // the known truth: index.css's wave tile, at every viewport

// ── The extractor: autocorrelation of a detrended luminance column ──
// Decoded IN THE PAGE via canvas (pngjs is only a transitive dep; a probe should not reach into
// .pnpm internals to exist).
const EXTRACT = `(dataUrl) => new Promise((res) => {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const MINLAG = 40
    const periods = []
    // EDGE COLUMNS ONLY, and this is not fussiness — it is the difference between measuring water
    // and measuring the document. The two waters are necessarily sampled at different load stages
    // (the video is master early; the CSS water is only visible once the video is gone), and by then
    // the parchment PAGE has revealed across the middle of the viewport. Centre columns then sample
    // paper and text: they read 46.9 / 55.1 / 66 / 244.9 — scatter, not a tile. The page is centred
    // with margins, so the viewport's edges are water at EVERY stage. Median over both edges.
    for (const frac of [0.04, 0.08, 0.92, 0.96]) {
      const x = Math.min(img.width - 1, Math.max(0, Math.floor(img.width * frac)))
      const col = []
      for (let y = 0; y < img.height; y++) {
        const i = (img.width * y + x) << 2
        col.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114)
      }
      // MAXLAG must FIT THE COLUMN. A fixed 400 needs an 800px column, so at 1100x700 every column
      // bailed and the probe reported 'n/a' — it VOIDed, correctly, but only by accident of another
      // guard. Size the lag range to the data.
      const MAXLAG = Math.min(400, Math.floor(col.length / 2) - 1)
      if (MAXLAG < MINLAG + 4) continue
      // DETREND LINEARLY, not with a moving average. The water is a GRADIENT, so the column carries
      // a low-frequency ramp that would dominate the autocorrelation — but the first cut subtracted
      // a 121px MOVING AVERAGE, a window comparable to the 140px period it was trying to measure.
      // That is a high-pass filter sitting on top of the signal: it partially cancelled the true
      // 140 component and left r(280) > r(140), so the extractor read the DOUBLE. A gradient is
      // linear by construction, so fit a straight line and subtract it — the 140 component is
      // untouched and every lag stays comparable.
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      const N = col.length
      for (let y = 0; y < N; y++) { sx += y; sy += col[y]; sxx += y * y; sxy += y * col[y] }
      const slope = (N * sxy - sx * sy) / (N * sxx - sx * sx)
      const icept = (sy - slope * sx) / N
      const det = col.map((v, y) => v - (slope * y + icept))
      const energy = det.reduce((a, v) => a + v * v, 0)
      if (energy / det.length < 1) continue // flat column: no wave lines to measure
      // NORMALISED cross-correlation: divide by the ENERGY OF THE TWO OVERLAPPING WINDOWS, not
      // merely by the overlap count. A plain sum/n lets a long lag win on noise alone (that is the
      // other half of why 280 beat 140). This is bounded [-1,1] and genuinely comparable across lags.
      const r = []
      for (let lag = 0; lag <= MAXLAG; lag++) {
        let num = 0, ea = 0, eb = 0
        const n = det.length - lag
        for (let y = 0; y < n; y++) { num += det[y] * det[y + lag]; ea += det[y] * det[y]; eb += det[y + lag] * det[y + lag] }
        const den = Math.sqrt(ea * eb)
        r.push(den > 0 ? num / den : 0)
      }
      const r0 = 1
      let best = 0, bestV = -Infinity
      for (let lag = MINLAG; lag <= MAXLAG; lag++) {
        if (r[lag] > bestV && r[lag] > r[lag - 1] && r[lag] >= r[lag + 1]) { bestV = r[lag]; best = lag }
      }
      if (!best) continue
      // NO HARMONIC-DESCENT HEURISTIC — the STRONGEST peak IS the period, and the descent that
      // used to sit here was the instrument's last bug. Autocorrelation peaks at multiples too, so
      // a first cut walked down to the smallest lag within 90% of the strongest to find "the
      // fundamental". But the tile's thick and thin lines are similar, and cover-SCALING blurs them
      // together further, so the HALF-period correlates ~0.97 of the true one: at 1920x1080 the
      // columns read [104.9, 105, 105.1, 210] — three half-harmonics and one true 210 — and the
      // median duly reported 105, i.e. a video whose waves are TOO SMALL, when cover makes them
      // exactly 1.5x TOO BIG. It would have sent the next reader after a phantom in the opposite
      // direction. Raising the bar 0.9 -> 0.97 did not fix it; the heuristic itself was wrong.
      // With a NORMALISED r on a LINEARLY detrended column, r(p) and r(2p) are both real peaks and
      // r(p) >= r(2p); take the FIRST peak ESSENTIALLY EQUAL to the strongest (0.995) — that is the
      // fundamental. The bar has to be this tight and the reason is measurable: the tile's HALF
      // period correlates at ~0.97 of the true one (its thick and thin lines are similar, and
      // cover-scaling blurs them closer), so every looser bar admitted the half-harmonic on some
      // columns — 0.9 and 0.92 both produced [70,70,140,140] and were rescued only by the median
      // landing on the right element. A median that happens to pick the truth is not a measurement.
      let fund = best
      for (let lag = MINLAG; lag < best; lag++) {
        if (r[lag] >= bestV * 0.995 && r[lag] > r[lag - 1] && r[lag] >= r[lag + 1]) { fund = lag; break }
      }
      // Parabolic interpolation around the peak for sub-pixel precision.
      const y1 = r[fund - 1], y2 = r[fund], y3 = r[fund + 1]
      const denom = (y1 - 2 * y2 + y3)
      const shift = denom !== 0 ? 0.5 * (y1 - y3) / denom : 0
      periods.push({ p: fund + shift, conf: bestV / r0 })
    }
    if (!periods.length) return res({ period: null, why: 'no column carried a measurable wave signal' })
    periods.sort((a, b) => a.p - b.p)
    // OCTAVE AMBIGUITY MUST VOID, NEVER BE MEDIANED AWAY. Autocorrelation peaks at every multiple of
    // the true period, and this signal's half-period correlates at ~0.97 of its fundamental (thick
    // and thin lines are similar; scaling blurs them closer), so peak-picking suffers classic octave
    // errors: measured column sets [70,70,140,140] and [157.5,315,315,315] — in BOTH the truth is
    // present and the median is a coin toss. Taking the median hid that: it reported the right
    // answer at 1280x800 by luck and 315 (double the true 157.5) at 1440x900 as a confident verdict.
    // If the columns disagree by ~2x, this extractor cannot say which is the fundamental — SAY SO.
    const lo = periods[0].p, hi = periods[periods.length - 1].p
    if (hi / lo > 1.9) {
      return res({ period: null, octave: true, all: periods.map((q) => +q.p.toFixed(1)),
        why: 'octave ambiguity: columns ' + periods.map((q) => +q.p.toFixed(1)).join(', ') + ' span a 2x factor — the peak-picker cannot pick the fundamental' })
    }
    const med = periods[Math.floor(periods.length / 2)]
    res({ period: med.p, conf: med.conf, n: periods.length, all: periods.map((q) => +q.p.toFixed(1)) })
  }
  img.onerror = () => res({ period: null, why: 'decode failed' })
  img.src = dataUrl
})`
const measure = async (page, buf) =>
  page.evaluate(`(${EXTRACT})('data:image/png;base64,${buf.toString('base64')}')`)

const b = await webkit.launch()
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { localStorage.setItem('inkwave:waveVideo', 'debug') } catch { /* private */ } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })

if (MODE === 'crop') {
  // PETER'S PROPOSAL, applied at runtime: size the element to the clip's DESIGN CSS box and let the
  // viewport crop the overflow. object-fit:fill maps the clip's pixels 1:1 onto that box, so the
  // tiles land at exactly the CSS px they were authored at — at ANY viewport, which is the point.
  // (`none` would do the same HERE only because this clip is dsf:1 and intrinsic == design; with a
  // dsf:2 clip `none` would render 1 video px per CSS px = 2x too big. Hence `fill` + explicit box.)
  await page.addStyleTag({ content: `.iw-wave-video-el{width:${DESIGN.w}px!important;height:${DESIGN.h}px!important;object-fit:fill!important;}` })
}

let master = false
for (let i = 0; i < 100; i++) {
  await page.waitForTimeout(100)
  if (await page.evaluate(() => !!window.__iwWaveVideo?.master)) { master = true; break }
}
if (!master) {
  // SAY WHY. "Inconclusive" with no reason is how a probe hides a bug in itself: `reason` is live at
  // every stage of run(), so it names the exact exit the video took.
  const d = await page.evaluate(() => ({ ...(window.__iwWaveVideo ?? {}) }))
  console.log('INCONCLUSIVE: the video never became master — nothing to compare.')
  console.log(`  masterEver=${d.masterEver} codec=${d.codec} rung=${d.rung} readyState=${d.ready}`)
  console.log(`  fetch="${d.fetch}"`)
  console.log(`  reason="${d.reason}"`)
  await b.close(); process.exit(2)
}

await page.addStyleTag({ content: 'div[aria-hidden="true"][style*="2147483647"]{display:none!important}' })
const videoShot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } })
const vid = await measure(page, videoShot)

// The CSS water, same page, same viewport: drop the video and let the DOM water draw.
await page.evaluate(() => {
  for (const v of document.querySelectorAll('video.iw-wave-video-el')) v.remove()
  document.documentElement.classList.remove('iw-wave-video-on')
})
await page.waitForTimeout(400)
const cssShot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } })
const css = await measure(page, cssShot)

const coverScale = Math.max(W / DESIGN.w, H / DESIGN.h)
const predicted = MODE === 'crop' ? CSS_TILE : CSS_TILE * coverScale

console.log(`\n─── WAVE TILE PERIOD @ ${W}x${H} · mode=${MODE} ───`)
console.log(`  CSS water   : ${css.period ? css.period.toFixed(1) + ' CSS px' : 'n/a'}  (known truth: ${CSS_TILE})  cols=${css.all ?? '-'}`)
console.log(`  VIDEO water : ${vid.period ? vid.period.toFixed(1) + ' CSS px' : 'n/a'}  cols=${vid.all ?? '-'}`)
console.log(`  predicted   : ${predicted.toFixed(1)} CSS px  ${MODE === 'cover' ? `(cover scale ${coverScale.toFixed(3)} x ${CSS_TILE})` : '(crop: 1:1, viewport-independent)'}`)

// ── THE CONTROL, and it gates everything ──
// If the instrument cannot recover the CSS water's KNOWN 140 CSS px, it is not measuring tiles and
// nothing it says about the video is admissible. v1 died here and reported a verdict anyway.
const problems = []
if (!css.period || !vid.period) {
  console.log('\n⊘ VOID: could not measure one of the two waters.')
  await b.close(); process.exit(2)
}
const cssErr = Math.abs(css.period - CSS_TILE)
if (cssErr > 6) {
  console.log(`\n⊘ VOID — CONTROL FAILED: the CSS water measured ${css.period.toFixed(1)} against a KNOWN ${CSS_TILE}`)
  console.log('   (off by ' + cssErr.toFixed(1) + 'px). The extractor is not measuring the tile; no verdict on the video.')
  await b.close(); process.exit(2)
}
console.log(`  ✓ CONTROL: the extractor recovers the CSS water's known ${CSS_TILE}px (read ${css.period.toFixed(1)}, err ${cssErr.toFixed(1)}px) — it is measuring tiles.`)

const drift = Math.abs(vid.period - css.period)
const pct = (drift / css.period) * 100
console.log(`  MISMATCH    : ${drift.toFixed(1)} CSS px (${pct.toFixed(1)}%)`)
if (drift > 6) problems.push(`THE VIDEO'S WAVES ARE THE WRONG SIZE: ${vid.period.toFixed(1)}px vs the CSS water's ${css.period.toFixed(1)}px (${pct.toFixed(1)}% off) — the hand-off jumps`)
// Does the measurement match the MECHANISM's prediction? This is what turns "cover scales the clip"
// from STATED-from-source into PROBED: the mismatch must track the cover factor, not be a constant.
const predErr = Math.abs(vid.period - predicted)
console.log(`  vs predicted: ${predErr.toFixed(1)} CSS px off the ${MODE} model`)

console.log('\n─── VERDICT ───')
for (const p of problems) console.log('  ✗', p)
if (!problems.length) console.log(`  ✓ the video and the CSS water agree on the tile size (${vid.period.toFixed(1)} vs ${css.period.toFixed(1)}) — the hand-off is seamless`)
await b.close()
process.exit(problems.length ? 1 : 0)
