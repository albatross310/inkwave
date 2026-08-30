// ─── Are the short lines out of sync with the waves? MEASURE IT. (Peter, live, Firefox + Chrome:
// "the little short lines… often appear out of sync with the waves") ─────────────────────────────
//
// SCOPE: this measures the CSS/WAAPI water — the LOAD animation everyone gets today. The wave video
// is behind `?waveVideo` and DEFAULT OFF, and it cannot be the cause: Peter sees this with the flag
// off, and the video bakes marks and waves into ONE clip where they cannot desync by construction.
//
// THE HYPOTHESIS UNDER TEST, and why it is NOT "WAAPI and CSS run on different clocks": they do not.
// A CSS animation from `getAnimations()` and a WAAPI animation from `element.animate()` BOTH hang
// off `document.timeline`, and `startTime` is ONE coordinate system for both. So `alignTracks`
// (trackT0 = drift.startTime, mod the 1944ms tile loop) is arithmetically sound and a clock
// DIFFERENCE is not available as an explanation. What IS available is a RESOLUTION RACE:
//
//   waveTwinkle.alignTracks  does  drift.ready.then(apply)   → READS  drift.startTime
//   Scroll.tsx sibling-adopt does  a.ready.then(re-assert)   → WRITES drift.startTime
//
// Both hang off the same `ready` promise and their ORDER IS UNSPECIFIED. If `apply` wins, trackT0 is
// stamped from a startTime the drift is about to ABANDON, and every mark is clocked to a phase the
// wave no longer has. That is a race — the shape of Peter's "OFTEN" — and it is consistent with the
// jitter lane's measured 43-60px of mark-vs-wave skew on 4 of 5 clean loads.
//
// WHAT IS MEASURED: the congruence the whole design rests on (waveTwinkle.ts: "trackT0 ≡ the tile
// drift animation's startTime (mod 1944ms) — that congruence is ALL the wave-space maths needs").
// skew = (trackStartTime − driftStartTime) mod 1944 → the distance to the nearest crest. Zero ⇒ the
// mark rides its wave. Non-zero ⇒ it is off by skew × 72px/s, which is what "out of sync" LOOKS like.
//
// THE INSTRUMENT PROVES ITSELF FIRST (this lane's own probe history is the argument — the tile-scale
// probe produced THREE fictions before a measurement): a known-negative de-clocks one track by a
// chosen amount and the reader must report exactly that.
import { chromium, firefox } from '@playwright/test'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BUILD = join(ROOT, 'build', 'client')
const LOOP_MS = 1944 // the tile drift period — waveTwinkle's LOOP_MS
const PX_PER_S = 72  // drift velocity — 140px per 1.944s

const LOADS = Number(process.env.LOADS || 5)
const ENGINE = process.env.PROBE_ENGINE || 'chromium'
const INJECT = 400 // known-negative: 400ms → 28.8px at 72px/s. Unmistakable, well inside the loop.

const freePort = () => new Promise((res) => {
  const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) })
})

// SAMPLED IN-PAGE, ACROSS THE WHOLE DRIFT WINDOW — never by a round-trip, and never at one moment.
// TWO instrument bugs are designed out here, both found by running it:
// (1) The first cut asked the page for `.iw-wave-anim` from node after a wait and read `waveAnim: 0`
//     on a perfectly healthy app: the drift window is under a second, so by the time a CDP
//     round-trip lands the load has COASTED and the class is gone. (Blocking
//     `inkwave:reveal-imminent` does not hold it — Scroll.tsx also coasts off its own `revealed`
//     trigger.) So the sampling lives in-page.
// (2) The second cut latched the FIRST complete sample and reported 0.00px — but on a 2-surface load
//     only ONE surface had a drift by then (measured: driftLCount 1 across 2 surfaces). The covered
//     editor's drift is born LATER, and Scroll.tsx's sibling-adopt re-asserts it later still — which
//     is EXACTLY the window the hypothesised race lives in. A probe that stops before the second
//     clock exists cannot see a two-clock bug: it would have reported "aligned" by construction.
//     So it samples EVERY FRAME until the coast and keeps the WORST skew ever seen, plus the widest
//     surface count reached — a sample that never saw 2 surfaces cannot speak about the adopt.
function sampler() {
  const w = window
  w.__skew = null
  w.__worst = null
  const grab = () => {
    // Stop only when the drift is over (the class is dropped at the coast). Until then, keep looking
    // — the interesting moment is the LATE one, when the second surface has joined.
    const live = document.querySelectorAll('.inkwave-editor-surface.iw-wave-anim').length
    const out = { surfaces: [], tracks: [] }
    let si = -1
    for (const surf of document.querySelectorAll('.inkwave-editor-surface.iw-wave-anim')) {
      si++
      const rec = {
        fill: surf.classList.contains('iw-fill'),
        covered: surf.classList.contains('iw-wave-covered'),
        drifts: {},
      }
      for (const a of surf.getAnimations({ subtree: true })) {
        const n = a.animationName || ''
        if (n === 'iw-wave-drift-l' || n === 'iw-wave-drift-r')
          rec.drifts[n] = typeof a.startTime === 'number' ? a.startTime : null
      }
      out.surfaces.push(rec)
      const host = surf.querySelector('.iw-wave-twinkles')
      if (!host) continue
      for (const el of host.querySelectorAll('.iw-twk-blink > *')) {
        for (const a of el.getAnimations()) {
          // A mark track is a WAAPI animation with NO animationName — that is what separates the
          // precomputed blink/transform tracks from the coast's CSS fades on the same subtree.
          if (a.animationName) continue
          if (typeof a.startTime !== 'number') continue
          // `si` is LOAD-BEARING: a mark is drawn over ITS OWN surface's wave, so that is the only
          // wave it can be in or out of sync with. The previous cut compared every track to
          // surfaces[0]'s drift and reported 13.2px of "mark skew" that was really the CROSS-SURFACE
          // difference — it recorded fill/covered per track and then ignored them. The house disease,
          // in the instrument.
          out.tracks.push({ st: a.startTime, si, fill: rec.fill, covered: rec.covered })
        }
      }
    }
    // A COMPLETE sample: a resolved drift-l AND real tracks.
    const haveDrift = out.surfaces.some((s) => typeof s.drifts['iw-wave-drift-l'] === 'number')
    if (haveDrift && out.tracks.length) {
      // KNOWN-NEGATIVE, injected in the SAME frame we read, so the reader is scored against a skew
      // we chose. Injecting from node would race the coast exactly as the first cut's reader did.
      if (w.__injectSkew) out.tracks[0].st += w.__injectSkew
      // Keep the sample with the MOST surfaces (ties → the latest), because the claim under test is
      // about what happens once BOTH surfaces are drifting.
      const better = !w.__worst || out.surfaces.length >= w.__worst.surfaces.length
      if (better) w.__worst = out
      w.__skew = w.__worst
    }
    if (live > 0 || !w.__skew) requestAnimationFrame(grab)
    else w.__done = true
  }
  requestAnimationFrame(grab)
}

async function oneLoad(browser, port, { injectSkewMs = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => { try { localStorage.removeItem('inkwave:waveVideo') } catch { /* private */ } })
  await page.addInitScript((ms) => { window.__injectSkew = ms }, injectSkewMs)
  await page.addInitScript(sampler)
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' })
  // Wait for the DRIFT TO END (__done), so the sample spans the whole window incl. the late second
  // surface + its adopt. Falls back to whatever was latched if the coast never comes.
  await page.waitForFunction(() => !!window.__done, null, { timeout: 20000 }).catch(() => {})
  const r = await page.evaluate(() => window.__skew)
  await ctx.close()
  return r || { surfaces: [], tracks: [] }
}

const mod = (x, m) => ((x % m) + m) % m

function summarise(r) {
  const driftLs = r.surfaces.map((s) => s.drifts['iw-wave-drift-l'])
  const driftRs = r.surfaces.map((s) => s.drifts['iw-wave-drift-r'])
  const present = driftLs.filter((x) => x != null)
  if (!present.length || !r.tracks.length) return null

  // THE CLAIM UNDER TEST: each mark rides the wave IT IS DRAWN OVER. So every track is scored
  // against ITS OWN surface's drift-l, never against a global reference.
  const own = r.tracks.filter((t) => driftLs[t.si] != null)
  const px = own.map((t) => {
    const d = mod(t.st - driftLs[t.si], LOOP_MS)
    return (Math.min(d, LOOP_MS - d) / 1000) * PX_PER_S
  })
  const sorted = [...px].sort((a, b) => a - b)

  // A SEPARATE, DIFFERENT CLAIM: the two drifting surfaces are supposed to be phase-identical
  // (Scroll.tsx's sibling adopt — "pixel-identical copies"). That is the doubled-lines invariant,
  // not the mark-sync one, and conflating them is what the first cut did.
  const ref = present[0]
  const cross = present.map((d) => {
    const x = mod(d - ref, LOOP_MS)
    return +(Math.min(x, LOOP_MS - x)).toFixed(1)
  })
  return {
    tracks: r.tracks.length,
    scored: own.length,
    surfaces: r.surfaces.length,
    driftLCount: present.length,
    driftRCount: driftRs.filter((x) => x != null).length,
    lrSkewMs: r.surfaces.map((s) => {
      const l = s.drifts['iw-wave-drift-l'], rr = s.drifts['iw-wave-drift-r']
      if (l == null || rr == null) return null
      const x = mod(l - rr, LOOP_MS)
      return +(Math.min(x, LOOP_MS - x)).toFixed(1)
    }),
    crossSurfaceMs: cross,
    crossMaxPx: +((Math.max(...cross) / 1000) * PX_PER_S).toFixed(2),
    p50px: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    maxpx: +sorted[sorted.length - 1].toFixed(2),
  }
}

const port = await freePort()
const srv = spawn('node', [join(HERE, 'server.mjs'), BUILD, String(port)], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 700))
const browser = await ({ chromium, firefox })[ENGINE].launch({ headless: true })
let bad = false
try {
  // ── ARM THE INSTRUMENT FIRST ──
  const neg = summarise(await oneLoad(browser, port, { injectSkewMs: INJECT }))
  if (!neg) {
    console.log('VOID: no tracks/drift sampled — nothing can be read')
    bad = true
  } else {
    const wantPx = (INJECT / 1000) * PX_PER_S
    const saw = neg.maxpx >= wantPx - 2
    console.log(`KNOWN-NEGATIVE  inject ${INJECT}ms (${wantPx.toFixed(1)}px) → max ${neg.maxpx}px  ${saw ? 'SEEN ✓ the reader works' : 'NOT SEEN ✗ INSTRUMENT BLIND — every number below is meaningless'}`)
    if (!saw) bad = true
  }

  if (!bad) {
    console.log(`\n─── ${ENGINE}: mark-vs-wave skew, ${LOADS} clean loads (1280x800, CSS water) ───`)
    console.log('load  trk/scored  surf  L/R  L-vs-R ms  cross-surf ms   cross px   MARK p50   MARK max')
    const maxes = [], crosses = []
    for (let i = 0; i < LOADS; i++) {
      const s = summarise(await oneLoad(browser, port))
      if (!s) { console.log(`${i}     VOID — no sample`); continue }
      maxes.push(s.maxpx); crosses.push(s.crossMaxPx)
      console.log(`${i}     ${String(s.tracks + '/' + s.scored).padEnd(11)} ${String(s.surfaces).padEnd(5)} ${s.driftLCount}/${s.driftRCount}  ${JSON.stringify(s.lrSkewMs).padEnd(10)} ${JSON.stringify(s.crossSurfaceMs).padEnd(15)} ${String(s.crossMaxPx).padEnd(10)} ${String(s.p50px).padEnd(10)} ${s.maxpx}`)
    }
    if (!maxes.length) { console.log('VOID: every load failed to sample'); bad = true }
    else {
      // ⚠ THE MEASUREMENT NOW SETS `bad`, AND IT DID NOT BEFORE. Both branches below printed and
      // neither touched the exit code, so `bad` was written only by the VOID paths — meaning a
      // measured 25px mark-vs-wave skew printed "REPRODUCED" and exited 0. This probe is cited in
      // `docs/archive/wave-system-rounds.md` as the KEEPER for `a11bd94` ("before, surface-vs-surface
      // drift up to 25px; after, 0.00px across 10/10 loads"). Reverting that fix would have left it
      // green — a guard that cannot fail on the exact regression it exists to catch.
      const SKEW_TOL_PX = 1 // a mark within 1px of its crest is aligned; 25px was the live bug
      const worst = Math.max(...maxes), xworst = Math.max(...crosses)
      console.log(`\nMARK-vs-ITS-OWN-WAVE, worst over ${LOADS} loads: ${worst.toFixed(2)}px`)
      console.log(worst <= SKEW_TOL_PX
        ? "  → marks ARE clocked to the wave they are drawn over. The alignment is NOT the desync."
        : `  → REPRODUCED: marks off their crest by up to ${worst.toFixed(1)}px.`)
      console.log(`SURFACE-vs-SURFACE drift phase, worst over ${LOADS} loads: ${xworst.toFixed(2)}px`)
      console.log(xworst <= SKEW_TOL_PX
        ? '  → the two drifting surfaces are phase-identical (the sibling adopt holds).'
        : `  → the two surfaces' WAVES differ by up to ${xworst.toFixed(1)}px — the sibling adopt is NOT holding.`)
      if (worst > SKEW_TOL_PX || xworst > SKEW_TOL_PX) bad = true
    }
  }
} finally {
  await browser.close(); srv.kill()
}
process.exit(bad ? 1 : 0)
