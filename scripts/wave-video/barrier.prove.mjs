// ─── THE HYDRATION BARRIER — one-shot-signal regression probe ─────────────────────────────────
// Round 2 of Peter's iPhone bug (2026-07-17). The wave video may not touch the DOM before React
// hydrates (see waveVideo.ts's ⛔ header), so it waits behind a barrier. The barrier's FIRST cut
// waited on `inkwave:twinkles-ready` — post-hydration, but NOT guaranteed to arrive: the twinkle
// pool announces only if BOTH its sets generate, while the water gate opens anyway on its own
// 1500ms timeout. On a load where the pool never announced, the video hung FOREVER with the water
// gate wide open — `reason` frozen at 'waiting for hydration…', clip/fetch never even set.
//
// THE BUG CLASS THIS GUARDS (named in CLAUDE.md): waiting on a one-shot async signal that (a) may
// never fire, or (b) may have ALREADY fired before you subscribed. The rule: only ever wait on a
// signal that always arrives, and make it ASKABLE — check the state first, subscribe only if the
// answer is no, both in one synchronous block.
//
// THE THREE CASES, and why each must be here:
//   A normal                  — the baseline; if this can't reach master the probe proves nothing.
//   B alreadyHydrated         — the beacon fired BEFORE we subscribed. Must NOT hang (the state
//                               read must catch it). This is case (b).
//   C twinklesNeverAnnounce   — the exact condition that hung the old barrier. Must NOT hang: the
//                               video must reach a real verdict, whatever it is. This is case (a).
//
// A HANG IS THE FAILURE, not a particular outcome. C is allowed to end in CSS water — the fallback
// is correct — but it must never sit in 'waiting for hydration…' forever.
//
// Serving: scripts/wave-video/server.mjs (mp4 MIME + real Range/206). NOT vite preview.
// Usage: node scripts/wave-video/barrier.prove.mjs [--expect-broken] [--port 4317]
import { webkit } from '@playwright/test'

const args = process.argv.slice(2)
const expectBroken = args.includes('--expect-broken')
const port = Number(args[args.indexOf('--port') + 1]) || 4317
const BASE = `http://127.0.0.1:${port}`

const CASES = {
  A_normal: () => {},
  // The beacon has ALREADY fired by the time waveVideo subscribes.
  B_alreadyHydrated: () => { window.__iwHydrated = true },
  // The twinkle pool never announces: suppress both the flag and the event. The water gate still
  // opens on its own 1500ms timeout, which is exactly what made the old hang so confusing —
  // `water-gate OPEN` looked like everything was fine.
  C_twinklesNeverAnnounce: () => {
    Object.defineProperty(window, '__iwTwinklesReady', { get: () => undefined, set: () => {}, configurable: true })
    const orig = window.dispatchEvent.bind(window)
    window.dispatchEvent = (e) => (e && e.type === 'inkwave:twinkles-ready') ? true : orig(e)
  },
}

const results = []
for (const [name, setup] of Object.entries(CASES)) {
  const b = await webkit.launch()
  const ctx = await b.newContext({
    viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  await ctx.addInitScript(`try{localStorage.setItem('inkwave:waveVideo','debug')}catch{};(${setup.toString()})()`)
  const page = await ctx.newPage()
  // NB: this probe deliberately does NOT count clip requests. It tried, and the count was a
  // fiction: `page.route` interception perturbs the very requests it counts, `navigator
  // .serviceWorker.controller` is still NULL on a first load (so the SW's cache-first /wave/
  // handler is not even in the path yet), and WebKit's own Range probing makes several legitimate
  // requests per clip. The number moved between 1 and 4 for reasons that had nothing to do with
  // the code under test. Measuring bytes would need a faithful production cache policy this server
  // does not have. Do not re-add it here without one — an assertion nobody can trust is worse than
  // no assertion, because someone will "fix" real code to satisfy it (I nearly shipped an SW
  // change to satisfy this one).
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(11000) // ≫ every bounded path (2.5s decode budget + 2s coast); ≪ the 30s watchdog

  const r = await page.evaluate(() => {
    const d = window.__iwWaveVideo
    return {
      reason: d?.reason ?? '(no diag)', clip: d?.clip ?? '—', fetch: d?.fetch ?? '—',
      masterEver: !!d?.masterEver,
      hydrated: window.__iwHydrated === true,
      gate: document.documentElement.classList.contains('iw-water-ready'),
      editor: (() => {
        const pm = document.querySelector('.ProseMirror')
        if (!pm) return false
        const bx = pm.getBoundingClientRect()
        return bx.width > 0 && bx.height > 0 && +getComputedStyle(pm).opacity > 0.9
      })(),
    }
  })
  await b.close()

  // THE hang signature: the barrier never released. `reason` is live at every stage now, so this
  // string can only survive if we are still behind it.
  const hung = /waiting for hydration/.test(r.reason)
  results.push({ name, ...r, hung })
  console.log(`\n${name}`)
  console.log(`  hydrated=${r.hydrated} gate=${r.gate ? 'OPEN' : 'CLOSED'} master=${r.masterEver} editor=${r.editor}`)
  console.log(`  fetch  : ${r.fetch}`)
  console.log(`  reason : ${r.reason}${hung ? '   ← STUCK BEHIND THE BARRIER' : ''}`)
}

const problems = []
for (const r of results) {
  if (r.hung) problems.push(`${r.name}: HUNG behind the hydration barrier (reason never left 'waiting for hydration…')`)
  if (!r.hydrated) problems.push(`${r.name}: the hydration beacon never fired — nothing can ever release`)
  if (!r.editor) problems.push(`${r.name}: the editor is not on screen`)
}
// The baseline must actually exercise the feature, or the whole run is vacuous.
if (!results[0].masterEver) problems.push('A_normal never reached master — the video path was not under test')

console.log('\n─── VERDICT ───')
for (const p of problems) console.log('  ✗', p)
if (!problems.length) console.log('  ✓ no case hangs; the beacon always fires; the baseline reaches master')

if (expectBroken) {
  if (!problems.length) { console.log('\nNEGATIVE FAILED TO FIRE: expected a hang, got a healthy run.'); process.exit(1) }
  console.log('\nREPRODUCED (as expected).'); process.exit(0)
}
process.exit(problems.length ? 1 : 0)
