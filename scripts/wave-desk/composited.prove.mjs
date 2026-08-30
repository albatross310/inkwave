// ─── DESKTOP OPENING WAVE × COMPOSITOR PROBE ─────────────────────────────────────────────────
// Peter, live on desktop Chrome (2026-07-17): "the opening animation is still css in chrome and
// still jittery on opening. I think that's coz we ripped out all the old optimisation code which
// kind of parallelised it to the gpu."
//
// THE CLAIM UNDER TEST: the load drift is no longer GPU/compositor-parallelised, so a busy main
// thread hitches it. CLAUDE.md asserts the opposite as an invariant: "ZERO per-frame JS during the
// load ... main-thread starvation is physically incapable of touching it."
//
// WHY NOT getComputedStyle: `getComputedStyle(el,'::before').transform` is the MAIN-THREAD style
// value. It advances whether or not cc ever got the animation — it would report a perfect drift on
// a build whose pixels are frozen. That is the house disease (CLAUDE.md: "THE OVERLAY MEASURED THE
// DECODER AND REPORTED IT AS PIXELS"). This probe measures PIXELS UNDER STARVATION instead: block
// the main thread solid for STARVE_MS during the drift and screencast throughout. Compositor-only
// playback keeps presenting NEW frames through a wedged main thread; a main-thread animation
// freezes dead.
//
// THREE THINGS THIS PROBE LEARNED THE HARD WAY (each was a live false-green in an earlier version):
//   1. THE TWINKLES MUST GO. The pool's ~200 WAAPI sprite tracks are independently composited and
//      keep the screen changing while the water sits frozen — v1 scored a fully sabotaged build
//      GREEN because it diffed the whole viewport and saw twinkles moving.
//   2. THE SABOTAGE MUST BE ASSERTED. v1 injected it in an addInitScript that never landed, so it
//      silently tested the healthy build against itself and passed. The computed animation-name is
//      now checked and the probe ABORTS rather than print a number.
//   3. THE DRIFT WINDOW IS ~1.2s AND CDP ROUND-TRIPS EAT IT. v2 aborted with the surface already at
//      iw-wave-coast. Everything now runs IN-PAGE from one `inkwave:twinkles-ready` handler — the
//      app's only timeout-free post-hydration signal (CLAUDE.md; .iw-water-ready's 1500ms timeout
//      can open pre-hydration). The spin itself freezes the class by construction: a blocked main
//      thread cannot run the reveal timers, so the surface CANNOT leave the drift mid-measurement.
//
// Serving: scripts/wave-video/server.mjs (build/client + SPA fallback + prod-like CSP).
// NOT `vite preview` — CLAUDE.md PROBE RULES.
//
// Usage: node scripts/wave-desk/composited.prove.mjs [--sabotage] [--port 4321]
import { chromium } from '@playwright/test'
import { autoWaveBase } from '../wave-video/autoserve.mjs'

const args = process.argv.slice(2)
const sabotage = args.includes('--sabotage')
const port = Number(args[args.indexOf('--port') + 1]) || 4321
const BASE = await autoWaveBase(args.includes('--port') ? port : null)
const STARVE_MS = 900
const VW = 1440, VH = 900

const die = (msg) => { console.error('PROBE ABORTED — ' + msg); process.exit(2) }

// HEADED (under xvfb — scripts/pw-headed.sh). Headless Chrome can single-thread the compositor,
// which would make the starvation test report a freeze on a perfectly composited build — a false
// positive for exactly the bug under test. NB xvfb has no GPU: raster TIMING is not faithful, but
// the compositing DECISION and the main-thread-independence of playback are.
const b = await chromium.launch({ headless: false, args: ['--force-device-scale-factor=1'] })
const ctx = await b.newContext({ viewport: { width: VW, height: VH } })

// EVERYTHING IN ONE IN-PAGE HANDLER — see note 3 above. addInitScript only REGISTERS a listener
// here; it writes no DOM before hydration (the 2026-07-17 #418 catastrophe).
await ctx.addInitScript(({ sabotage, STARVE_MS }) => {
  const w = window
  w.__iwProbe = { armed: true }
  window.addEventListener('inkwave:twinkles-ready', () => {
    // Post-hydration from here: React has committed and never touches these nodes again.
    if (sabotage) {
      const s = document.createElement('style')
      s.textContent = `
        @keyframes iw-sab-l { from { background-position: 0 0; } to { background-position: -140px 0; } }
        @keyframes iw-sab-r { from { background-position: 0 0; } to { background-position: 140px 0; } }
        .inkwave-editor-surface.iw-fill:not(.is-phone).iw-wave-anim::before {
          animation: iw-sab-l 1.944s linear infinite !important;
          transform: none !important; will-change: auto !important; contain: none !important; }
        .inkwave-editor-surface.iw-fill:not(.is-phone).iw-wave-anim::after {
          animation: iw-sab-r 1.944s linear infinite !important;
          transform: none !important; will-change: auto !important; contain: none !important; }`
      document.head.appendChild(s)
    }
    // Detach the twinkle pool — note 1.
    w.__iwProbe.twkRemoved = [...document.querySelectorAll('.iw-wave-twinkles')].map((h) => (h.remove(), 1)).length
    // WAIT FOR THE WATER GATE. twinkles-ready can precede .iw-water-ready, and until that class
    // lands every wave layer is display:none — which creates NO CSS animations at all. Reading
    // style here reported `transform: none` / `getAnimations(): 0` on a build whose pixels were
    // provably drifting: a description of the pre-gate frame, not of the animation under test.
    const ready = () => document.documentElement.classList.contains('iw-water-ready')
    const go = () => {
      const el = document.querySelector('.inkwave-editor-surface.iw-fill')
      if (!el) { w.__iwProbe.err = 'no .iw-fill surface'; return }
      void el.offsetWidth // force recalc so the sabotage is live before we read or spin
      const cs = getComputedStyle(el, '::before')
      w.__iwProbe.cls = el.className
      w.__iwProbe.animName = cs.animationName
      w.__iwProbe.willChange = cs.willChange
      w.__iwProbe.transform = cs.transform
      w.__iwProbe.contain = cs.contain
      w.__iwProbe.anims = document.getAnimations().length
      w.__iwProbe.driftAnims = document.getAnimations()
        .filter((a) => /drift|sab/.test(a.animationName || '')).length
      // Let the detach + sabotage actually paint before we wedge the thread, or we would be
      // measuring the frame budget of our own setup.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        w.__iwProbe.spinStart = performance.now()
        const end = performance.now() + STARVE_MS
        while (performance.now() < end) { /* solid spin — no task can interleave */ }
        w.__iwProbe.spinEnd = performance.now()
        w.__iwProbe.clsAfter = document.querySelector('.inkwave-editor-surface.iw-fill')?.className || ''
      }))
    }
    const wait = () => { if (ready()) go(); else requestAnimationFrame(wait) }
    wait()
  }, { once: true })
}, { sabotage, STARVE_MS })

const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const cdp = await ctx.newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: Date.now(), data: f.data })
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* closed */ }
})
// Screencast from BEFORE navigation: the drift window opens within ~1s of load and we cannot
// afford a round-trip to start recording inside it.
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__iwProbe?.spinEnd !== undefined, null, { timeout: 20000 })
  .catch(() => die('the in-page spin never completed — twinkles-ready may never have fired'))
await page.waitForTimeout(300)
await cdp.send('Page.stopScreencast').catch(() => {})

const p = await page.evaluate(() => window.__iwProbe)
if (p.err) die(p.err)

// ── Assertions: prove we measured what we claim ───────────────────────────────────────────────
if (!/iw-wave-anim/.test(p.cls)) die(`surface was not drifting at spin time (class="${p.cls}")`)
if (!/iw-wave-anim/.test(p.clsAfter)) die(`surface left the drift during the spin (class="${p.clsAfter}") — window invalid`)
const expectAnim = sabotage ? 'iw-sab-l' : 'iw-wave-drift-l'
if (p.animName !== expectAnim)
  die(`expected ::before animation-name "${expectAnim}", got "${p.animName}" — the ${sabotage ? 'sabotage never applied' : 'drift is not running'}`)

// Frames presented while the main thread was wedged. Screencast timestamps are browser-side, so
// they keep flowing through the renderer's spin.
const t0 = p.spinStart, t1 = p.spinEnd
const nav = await page.evaluate(() => performance.timeOrigin)
const during = frames.filter((f) => f.t >= nav + t0 && f.t <= nav + t1)
const distinct = new Set(during.map((f) => f.data)).size
const compositorAlive = distinct >= 3

console.log('── DESKTOP OPENING WAVE × COMPOSITOR ──', sabotage ? '[SABOTAGE]' : '[REAL BUILD]')
console.log('surface class at spin   :', p.cls)
console.log('::before animation-name :', p.animName, '(asserted)')
console.log('::before will-change    :', p.willChange, '| transform:', p.transform, '| contain:', p.contain)
console.log('twinkle hosts detached  :', p.twkRemoved, '| anims live at spin:', p.anims, '| drift anims:', p.driftAnims)
console.log('spin window             :', Math.round(t1 - t0), 'ms')
console.log('frames presented DURING the wedge:', during.length, '| DISTINCT:', distinct)
console.log('total screencast frames :', frames.length)
console.log('errors                  :', errors.length ? errors.slice(0, 3) : 'none')
console.log('')
console.log('VERDICT: drift is', compositorAlive
  ? 'COMPOSITOR-DRIVEN (pixels kept advancing through a wedged main thread)'
  : 'MAIN-THREAD-BOUND (pixels froze with the main thread)')

await b.close()

if (sabotage) {
  const fired = !compositorAlive
  console.log('\n--sabotage: instrument', fired
    ? 'FIRED (red, as required) → a green on the real build is evidence'
    : 'FAILED TO FIRE — IT IS NOT EVIDENCE')
  process.exit(fired ? 0 : 1)
}
process.exit(compositorAlive ? 0 : 1)
