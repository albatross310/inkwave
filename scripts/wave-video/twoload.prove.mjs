// ─── THE SECOND LOAD — the case the wave-video harness structurally could not see ─────────────
// Peter, iPhone 8, 2026-07-17: "The first time the video ran, from then on just the CSS."
//
// WHY THIS PROBE EXISTS. A race gives you *sometimes*. **Works-once-then-never is STATE** — something
// is written on the first load and is wrong on every load after. Every wave-video probe so far did
// ONE load in a FRESH context, so the first load was the only load: `navigator.serviceWorker
// .controller` is NULL on a first load (the SW's cache-first /wave/ handler is not even in the
// path), the Cache Storage is empty, the HTTP cache is empty, and there is no saved document. Every
// one of those is different the second time. A harness whose first load is its only load cannot
// see a single one of them, and it will report green forever.
//
// WHAT IT ASSERTS: the video must behave the SAME on load 2 as on load 1. Not "the video works" —
// SAMENESS. If load 1 reaches master and load 2 does not, that is Peter's sequence, and the
// `reason` field (live at every stage since 2026-07-17) says which of the ~6 exits it took, so the
// failure names itself instead of needing another round of guessing.
//
// Same context throughout (that is the whole point): the SW installs + claims on load 1
// (skipWaiting + clients.claim), so load 2+ are CONTROLLED and served cache-first.
//
// Serving: scripts/wave-video/server.mjs (mp4 MIME + real Range/206). NOT vite preview.
// ⚠️ CODEC FIDELITY — `--h264` is not optional when reasoning about Peter's device. Playwright's
// Linux WebKit reports av01 "probably", so the probe picks the AV1 rung: 58KB. An iPhone 8 is A11 —
// it has NO AV1 decoder at all and takes the H.264 rung: 280KB, ~5x the bytes, a different decoder,
// and a different amount of Range slicing through the SW. Running only the av1 path and calling it
// green is testing a clip Peter's phone will never play. `--h264` stubs canPlayType to refuse av01,
// which is exactly what his hardware does.
//
// Usage: node scripts/wave-video/twoload.prove.mjs [--loads 3] [--port 4319] [--h264] [--expect-broken]
import { webkit } from '@playwright/test'
import { autoWaveBase } from './autoserve.mjs'

const args = process.argv.slice(2)
const expectBroken = args.includes('--expect-broken')
const forceH264 = args.includes('--h264')
const port = Number(args[args.indexOf('--port') + 1]) || 4319
const loads = Number(args[args.indexOf('--loads') + 1]) || 3
const BASE = await autoWaveBase(args.includes('--port') ? port : null)
const b = await webkit.launch()
// ONE context for every load — the SW, Cache Storage, localStorage and OPFS all persist across
// them, exactly as they do on Peter's phone when he reloads.
const ctx = await b.newContext({
  viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
})
if (forceH264) {
  // Model the A11: no AV1 decoder. waveVideo's pickCodec() asks canPlayType for av01 first and
  // falls to avc1 — refuse av01 exactly as the hardware does, and leave every other answer alone.
  await ctx.addInitScript(() => {
    const proto = HTMLMediaElement.prototype
    const orig = proto.canPlayType
    proto.canPlayType = function (t) { return /av01/i.test(t) ? '' : orig.call(this, t) }
  })
}
await ctx.addInitScript(() => {
  try { localStorage.setItem('inkwave:waveVideo', 'debug') } catch { /* private mode */ }
  const w = window
  w.__iwEvents = []
  const t0 = performance.now()
  for (const ev of ['inkwave:hydrated', 'inkwave:twinkles-ready', 'inkwave:water-ready',
    'inkwave:reveal-imminent', 'inkwave:wave-rest', 'inkwave:load-watchdog']) {
    window.addEventListener(ev, () => w.__iwEvents.push({ ev: ev.replace('inkwave:', ''), t: Math.round(performance.now() - t0) }))
  }
  // Sample the video's PAINTED state continuously. Peter's "right before it loads it says master
  // but not painted" cannot be judged from one end-of-run reading: a transient frame on the way to
  // healthy and a terminal stuck state look identical at t=12s. Record every distinct state so the
  // probe can say WHICH, instead of asking him to photograph a moving target.
  w.__iwPaintLog = []
  setInterval(() => {
    const d = w.__iwWaveVideo
    if (!d) return
    const v = document.querySelector('video.iw-wave-video-el')
    let state
    if (!d.master) state = `css(${d.reason})`
    else if (!v) state = 'master/NO-ELEMENT'
    else {
      const r = v.getBoundingClientRect()
      const cs = getComputedStyle(v)
      state = (r.width < 1 || r.height < 1) ? 'master/ZERO-BOX'
        : cs.display === 'none' ? 'master/display:none'
          : cs.visibility !== 'visible' ? `master/${cs.visibility}`
            : +cs.opacity <= 0.01 ? 'master/opacity:0'
              : `master/PAINTED(op=${(+cs.opacity).toFixed(2)})`
    }
    const last = w.__iwPaintLog[w.__iwPaintLog.length - 1]
    if (!last || last.state !== state) w.__iwPaintLog.push({ state, t: Math.round(performance.now() - t0) })
  }, 60)
})

const page = await ctx.newPage()
const rows = []
for (let i = 1; i <= loads; i++) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12000) // ≫ every bounded path; ≪ the 30s watchdog
  const r = await page.evaluate(() => {
    const d = window.__iwWaveVideo
    const pm = document.querySelector('.ProseMirror')
    const bx = pm && pm.getBoundingClientRect()
    return {
      swControlling: !!navigator.serviceWorker?.controller,
      master: !!d?.masterEver, reason: d?.reason ?? '(no diag)', fetch: d?.fetch ?? '—',
      ready: d?.ready ?? -1, codec: d?.codec ?? '?',
      gate: document.documentElement.classList.contains('iw-water-ready'),
      hydrated: window.__iwHydrated === true,
      events: window.__iwEvents, paint: window.__iwPaintLog,
      // The tell for the dead-page case below: no surface at all means the app never rendered.
      surfaces: document.querySelectorAll('.inkwave-editor-surface').length,
      editor: !!(pm && bx.width > 0 && bx.height > 0 && +getComputedStyle(pm).opacity > 0.9),
    }
  })
  rows.push(r)
  const ev = Object.fromEntries(r.events.map((e) => [e.ev, e.t]))
  console.log(`\n─── LOAD ${i} ${i === 1 ? '(cold: no SW controller, empty caches)' : '(warm: SW CONTROLLING, caches populated)'} ───`)
  console.log(`  swControlling=${r.swControlling}  gate=${r.gate ? 'OPEN' : 'CLOSED'}  hydrated=${r.hydrated}  editor=${r.editor}`)
  console.log(`  codec=${r.codec} readyState=${r.ready}  fetch="${r.fetch}"`)
  console.log(`  MASTER=${r.master}   reason="${r.reason}"`)
  console.log(`  timings: hydrated=${ev.hydrated ?? '-'} water-ready=${ev['water-ready'] ?? '-'} settle=${ev['reveal-imminent'] ?? '-'} rest=${ev['wave-rest'] ?? '-'} watchdog=${ev['load-watchdog'] ?? 'no'}`)
  console.log(`  paint states: ${r.paint.map((p) => `${p.t}ms ${p.state}`).join('  →  ') || '(none sampled)'}`)
}

// ── Verdict ──
// ⛔ THE HARNESS LIMIT THAT ALMOST BECAME A FINDING. Playwright's Linux WebKit has NO
// `navigator.storage` (CLAUDE.md, iOS/WebKit section), so the SECOND load — which reads back the
// document load 1 created — hits the app's own "this device couldn't open your storage" safety
// page and renders NO editor surface at all. The video then bails 'load already past drift' for the
// trivial reason that there is no `.iw-wave-anim` surface anywhere on the page, and the probe
// cheerfully reported "PETER'S SEQUENCE REPRODUCED". It was a fiction: right symptom, wrong cause,
// and a control run with the flag OFF showed the identical dead page. A reproduction that fires
// because the page failed to render proves nothing about the video. Detect it and say INCONCLUSIVE.
const dead = rows.findIndex((r) => r.surfaces === 0)
const problems = []
if (!rows[0].master) problems.push('LOAD 1 never reached master — the video path was not under test, so this run proves nothing')
if (dead > 0) {
  console.log(`\n⛔ INCONCLUSIVE from load ${dead + 1}: no editor surface on the page — this engine could not`)
  console.log('   render the warm load at all (Linux WebKit has no navigator.storage → the app shows its')
  console.log('   storage-error page). The warm-load video path is NOT under test here. Use Chromium')
  console.log('   (which has OPFS) to measure the warm-load choreography, and Peter for decode timing.')
} else {
  for (let i = 1; i < rows.length; i++) {
    if (rows[0].master && !rows[i].master) {
      problems.push(`PETER'S SEQUENCE: load 1 reached master, load ${i + 1} did NOT — reason="${rows[i].reason}" (swControlling=${rows[i].swControlling})`)
    }
  }
}
for (const [i, r] of rows.entries()) {
  if (r.surfaces === 0) continue // dead page (see above) — nothing on it is evidence
  if (!r.gate) problems.push(`load ${i + 1}: water gate CLOSED — the hydration wipe is back`)
  if (!r.editor) problems.push(`load ${i + 1}: the editor is not on screen`)
  if (r.events.some((e) => e.ev === 'load-watchdog')) problems.push(`load ${i + 1}: THE 30s WATCHDOG FIRED`)
  // A terminal unpainted master is the round-1 bug's signature surviving; a transient one during
  // the 0.3s CSS fade-in is not. Judge only the LAST sampled state.
  const last = r.paint[r.paint.length - 1]
  if (last && /master\/(ZERO-BOX|display:none|hidden)/.test(last.state)) {
    problems.push(`load ${i + 1}: TERMINAL unpainted master (${last.state}) — the video is master and painting nothing`)
  }
}

console.log('\n─── VERDICT ───')
for (const p of problems) console.log('  ✗', p)
// An inconclusive run must NOT print a tick. "Every load behaves the same" is a claim about loads
// that rendered; loads 2+ here did not render at all, so there is nothing to compare and a green
// would be the same fiction one level up.
if (dead > 0) console.log('  ⊘ INCONCLUSIVE — the warm loads did not render in this engine; no verdict on the video.')
else if (!problems.length) console.log('  ✓ every load behaves the same: master reached, water alive, editor on screen')

await b.close()
if (expectBroken) {
  if (dead > 0) { console.log('\nINCONCLUSIVE: cannot reproduce anything in an engine that will not render the warm load.'); process.exit(2) }
  if (!problems.length) { console.log('\nNEGATIVE FAILED TO FIRE: expected the works-once-then-never sequence, got consistent loads.'); process.exit(1) }
  console.log('\nREPRODUCED (as expected).'); process.exit(0)
}
if (dead > 0) process.exit(2) // inconclusive is not a pass
process.exit(problems.length ? 1 : 0)
