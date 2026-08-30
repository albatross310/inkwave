// ─── MARK-vs-WAVE PHASE PROBE (the two-clock seam) ───────────────────────────────────────────
// Peter, desktop, 2026-07-17: "I suspect the problem is with the little short lines as on both FF
// and chrome they often appear out of sync with the waves anyway." CLAUDE.md carries the same
// thing as an unfixed residual: "white lines briefly lagging their wave".
//
// THE SEAM, EXACTLY. Two systems, two clocks:
//   • waves = CSS background drift (iw-wave-drift-l/r), 140px per 1944ms = 72px/s;
//   • marks = WAAPI transform tracks that bake that same velocity in, so a mark rides its crest
//     ONLY IF its clock agrees with the tile's.
// waveTwinkle.alignTracks() reconciles them ONCE per load:
//     trackT0 = drift.startTime - LOOP_MS * floor(random * CYCLE_LOOPS)
// so the invariant is a CONGRUENCE: every track.startTime ≡ drift.startTime (mod 1944ms).
// Any deviation is literally visible lag: skew_ms * 0.072 = px off the crest.
//
// WHY CLOCKS AND NOT PIXELS: the claim under test is a statement ABOUT the clocks, and the clocks
// are the ground truth the pixels are derived from — a mark whose startTime is congruent cannot
// ride off its crest, and one whose startTime is not congruent must. This does not repeat the
// "measured the decoder" error: that instrument reported a DIFFERENT quantity (decode) than the
// one claimed (paint). Here the measured quantity IS the claimed one. The px conversion is exact
// (72px/s), not a proxy. NB it is GPU-independent, which is why it is trustworthy on WSL.
//
// THE SECOND SUSPECT, and the reason this probe reads EVERY surface: findDrift() returns the FIRST
// surface's drift, but a load has TWO drifting surfaces (the shell and the editor). CLAUDE.md:
// "the covered editor ran 33-500ms out of phase -> doubled lines through the reveal fade + marks
// off their crests". 33-500ms is 2.4-36px of lag. If the surfaces' drifts are not congruent to
// each other, the marks are aligned to one surface's wave and painted over the other's.
//
// THE NEGATIVE MUST FIRE: --perturb MS shifts one track's startTime by a known amount; the probe
// must report that mark at MS*0.072 px of lag, or it cannot see lag at all.
//
// Serving: scripts/wave-video/server.mjs. NOT `vite preview` (CLAUDE.md PROBE RULES).
// Usage: node scripts/wave-desk/markphase.prove.mjs [--spike MS] [--perturb MS] [--port 4321]
import { chromium } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const args = process.argv.slice(2)
const num = (f, d) => (args.includes(f) ? Number(args[args.indexOf(f) + 1]) : d)
const port = num('--port', 4321)
const spike = num('--spike', 0)
const perturb = num('--perturb', 0)
const BASE = await autoWaveBase(args.includes('--port') ? port : null)
const LOOP_MS = 1944
const PX_PER_MS = 140 / 1944 // 72px/s — the drift's exact velocity

const b = await chromium.launch({ headless: false, args: ['--force-device-scale-factor=1'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })

await ctx.addInitScript(({ spike, perturb, LOOP_MS }) => {
  const w = window
  w.__iwPhase = { samples: [], events: [] }
  for (const ev of ['inkwave:twinkles-ready', 'inkwave:reveal-imminent', 'inkwave:editor-revealed', 'inkwave:wave-rest'])
    window.addEventListener(ev, () => w.__iwPhase.events.push({ ev, t: Math.round(performance.now()) }))

  // Model Peter's "keeps getting interrupted by different things loading": a solid CPU spike at
  // the settle, which is where the brake is armed and where a late re-clock would land.
  if (spike) window.addEventListener('inkwave:reveal-imminent', () => {
    const end = performance.now() + spike
    while (performance.now() < end) { /* solid spin */ }
  }, { once: true })

  // Congruence sampler. Reads the SAME quantities alignTracks() writes.
  const norm = (x) => { const m = ((x % LOOP_MS) + LOOP_MS) % LOOP_MS; return m > LOOP_MS / 2 ? m - LOOP_MS : m }
  w.__iwSample = (tag) => {
    const surfaces = [...document.querySelectorAll('.inkwave-editor-surface')]
    const drifts = []
    for (const s of surfaces) {
      let a
      try { a = s.getAnimations({ subtree: true }).find((x) => x.animationName === 'iw-wave-drift-l') } catch { /* */ }
      if (a && typeof a.startTime === 'number')
        drifts.push({ cls: s.className, startTime: a.startTime, playState: a.playState })
    }
    // Mark tracks = WAAPI animations on .iw-twk-i sprites (no animationName: they are script-made).
    const marks = []
    for (const el of document.querySelectorAll('.iw-twk-i')) {
      for (const a of el.getAnimations()) {
        if (a.animationName) continue // CSS animation, not a script track
        if (typeof a.startTime === 'number') marks.push(a.startTime)
      }
    }
    if (!drifts.length) return
    const ref = drifts[0].startTime
    const skews = marks.map((st) => norm(st - ref))
    const absPx = skews.map((s) => Math.abs(s) * (140 / LOOP_MS))
    w.__iwPhase.samples.push({
      tag, t: Math.round(performance.now()),
      surfaces: surfaces.length,
      drifts: drifts.map((d) => ({ cls: d.cls, st: Math.round(d.startTime * 10) / 10, play: d.playState })),
      // Are the SURFACES congruent to each other? (the covered-editor seam)
      driftSkewMs: drifts.map((d) => Math.round(norm(d.startTime - ref) * 10) / 10),
      driftSkewPx: drifts.map((d) => Math.round(Math.abs(norm(d.startTime - ref)) * (140 / LOOP_MS) * 10) / 10),
      markCount: marks.length,
      markMaxPx: absPx.length ? Math.round(Math.max(...absPx) * 10) / 10 : null,
      markOver1px: absPx.filter((p) => p > 1).length,
    })
  }
  // Perturb one track by a known amount — the fire test.
  if (perturb) window.addEventListener('inkwave:reveal-imminent', () => {
    const el = document.querySelector('.iw-twk-i')
    const a = el && el.getAnimations().find((x) => !x.animationName)
    if (a && typeof a.startTime === 'number') { a.startTime = a.startTime - perturb; w.__iwPhase.perturbed = true }
  }, { once: true })
}, { spike, perturb, LOOP_MS })

const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.documentElement.classList.contains('iw-water-ready'), null, { timeout: 15000 })
  .catch(() => { console.error('PROBE ABORTED — water-ready never opened'); process.exit(2) })

// Sample across the whole load: drift, settle, coast, rest.
for (const [tag, wait] of [['drift', 0], ['drift+300', 300], ['drift+700', 400], ['coast', 900], ['coast+800', 800], ['rest', 1500]]) {
  await page.waitForTimeout(wait)
  await page.evaluate((t) => window.__iwSample(t), tag).catch(() => {})
}
const r = await page.evaluate(() => window.__iwPhase)

console.log('── MARK vs WAVE PHASE (two-clock seam) ──', spike ? `[SPIKE ${spike}ms @settle]` : '', perturb ? `[PERTURB ${perturb}ms]` : '')
console.log('events:', r.events.map((e) => `${e.ev.replace('inkwave:', '')}@${e.t}`).join('  '))
if (perturb) console.log('perturb applied:', r.perturbed === true, '→ expect one mark at', (perturb * PX_PER_MS).toFixed(1), 'px')
console.log('')
for (const s of r.samples) {
  console.log(`[${s.tag}] t=${s.t}ms  surfaces=${s.surfaces}  marks=${s.markCount}`)
  console.log(`    drift startTimes : ${s.drifts.map((d) => d.st + '(' + d.play + ')').join('  ')}`)
  console.log(`    SURFACE-vs-SURFACE drift skew: ${s.driftSkewMs.join(', ')} ms  =  ${s.driftSkewPx.join(', ')} px`)
  console.log(`    MARK-vs-WAVE skew: max ${s.markMaxPx} px   | marks >1px off crest: ${s.markOver1px}/${s.markCount}`)
}
const worstSurf = Math.max(0, ...r.samples.flatMap((s) => s.driftSkewPx))
const worstMark = Math.max(0, ...r.samples.map((s) => s.markMaxPx || 0))
console.log('\nWORST surface-vs-surface wave skew:', worstSurf.toFixed(1), 'px')
console.log('WORST mark-vs-wave skew           :', worstMark.toFixed(1), 'px')
await b.close()

if (perturb) {
  const want = perturb * PX_PER_MS
  const fired = Math.abs(worstMark - want) < 1.5
  console.log('\n--perturb: instrument', fired ? `FIRED (saw ${worstMark.toFixed(1)}px, expected ${want.toFixed(1)}px) → it can see lag`
    : `FAILED TO FIRE (saw ${worstMark.toFixed(1)}px, expected ${want.toFixed(1)}px) — IT IS NOT EVIDENCE`)
  process.exit(fired ? 0 : 1)
}
process.exit(0)
