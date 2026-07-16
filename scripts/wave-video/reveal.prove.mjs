// ─── WAVE VIDEO × REVEAL CHOREOGRAPHY PROBE ──────────────────────────────────────────────────
// Peter's live iPhone-8 bug (2026-07-16): "The video works but it never loads." The video half is
// fixed (his overlay: readyState 4, advancing YES, `VIDEO is master`) — the water renders and
// animates and the editor NEVER appears.
//
// WHAT THIS ASKS, AND WHY FROM OUTSIDE: the debug overlay is an instrument pointed at the VIDEO,
// and it says everything is fine while the app is unusable — so it cannot see this bug (the house
// disease: a check that measures in a fiction). This probe therefore queries the CHOREOGRAPHY from
// outside the video module: the load's four events with their timestamps, the html classes, and —
// the ground truth Peter actually reports — WHETHER THE EDITOR IS ON SCREEN AT THE END.
//
// THE NEGATIVE MUST BE ABLE TO FIRE: `--expect-broken` asserts the bug REPRODUCES. Run it on the
// pre-fix build before trusting any green on the fixed one.
//
// Serving: scripts/wave-video/server.mjs (build/client, SPA fallback, mp4 MIME + REAL Range/206).
// NOT `vite preview` — CLAUDE.md PROBE RULES.
//
// Usage: node scripts/wave-video/reveal.prove.mjs [--expect-broken] [--port 4311] [--slow-video MS]
import { webkit } from '@playwright/test'

const args = process.argv.slice(2)
const expectBroken = args.includes('--expect-broken')
const port = Number(args[args.indexOf('--port') + 1]) || 4311
const slowVideo = args.includes('--slow-video') ? Number(args[args.indexOf('--slow-video') + 1]) : 0
const BASE = `http://127.0.0.1:${port}`

const b = await webkit.launch()
const ctx = await b.newContext({
  viewport: { width: 375, height: 667 }, // iPhone 8
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
})

// The flag, exactly as Peter sets it. Plus an event recorder armed BEFORE any app code runs, so
// no event can fire before we listen (the race that makes in-app instruments lie).
await ctx.addInitScript(() => {
  try { localStorage.setItem('inkwave:waveVideo', 'debug') } catch { /* private mode */ }
  const w = window
  w.__iwEvents = []
  const t0 = performance.now()
  for (const ev of [
    'inkwave:water-ready', 'inkwave:twinkles-ready', 'inkwave:reveal-imminent',
    'inkwave:editor-revealed', 'inkwave:wave-rest', 'inkwave:load-watchdog', 'inkwave:open-begin',
  ]) window.addEventListener(ev, () => w.__iwEvents.push({ ev, t: Math.round(performance.now() - t0) }))
  // <html> IDENTITY. React's hydration-recovery does not strip the stamps off <html> — it REPLACES
  // the element (probed 2026-07-17), which is why the entry.client stamp-guard could re-assert
  // forever on a node nobody could see. Tag the original as early as possible: if this tag is gone
  // at the end, the document was re-rendered from scratch and the water is dead whatever else the
  // instruments claim.
  const tag = () => { if (document.documentElement) { document.documentElement.__iwOrigHtml = true; return true } return false }
  if (!tag()) document.addEventListener('readystatechange', tag, { once: true })
})

// OPTIONAL: delay ONLY the video bytes, to model an iPhone 8 on a cold/slow network fetching a
// 280KB clip. Everything else loads at full speed — this widens the window under test without
// touching app code.
if (slowVideo) {
  await ctx.route('**/wave/*.mp4', async (route) => {
    await new Promise((r) => setTimeout(r, slowVideo))
    await route.continue()
  })
}

const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })

// Watch the load for 12s — well past every healthy path (reveal gate caps at 1.2s; the phone
// choreography completes by ~3.2s) and well short of the 30s watchdog, so a PASS here is the
// real chain completing and NOT the backstop.
await page.waitForTimeout(12000)

const r = await page.evaluate(() => {
  const root = document.documentElement
  const surfaces = [...document.querySelectorAll('.inkwave-editor-surface')].map((el) => ({
    cls: el.className,
    z: getComputedStyle(el).zIndex,
  }))
  const vids = [...document.querySelectorAll('video.iw-wave-video-el')].map((v) => {
    const cs = getComputedStyle(v)
    return {
      src: (v.src || '').split('/').pop(),
      opacity: cs.opacity, visibility: cs.visibility, zIndex: cs.zIndex,
      currentTime: +v.currentTime.toFixed(2), readyState: v.readyState,
      going: v.hasAttribute('data-going'),
      parent: v.parentElement ? v.parentElement.className : '(detached)',
      rect: (() => { const b = v.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}` })(),
    }
  })
  // Peter's own instrument, read verbatim — the text he photographs.
  const ov = [...document.body.querySelectorAll('div')].find((d) => /VIDEO ON SCREEN|CSS WATER/.test(d.innerHTML) && d.style.zIndex === '2147483647')
  // GROUND TRUTH: is the document on screen? The ProseMirror editor is what Peter came for.
  const pm = document.querySelector('.ProseMirror')
  let editorVisible = false
  let editorWhy = 'no .ProseMirror in DOM'
  if (pm) {
    const box = pm.getBoundingClientRect()
    const cs = getComputedStyle(pm)
    // What does the USER see at the editor's own centre point? If anything else is hit-tested
    // there, something is covering the document.
    const cx = Math.min(Math.max(box.left + box.width / 2, 1), window.innerWidth - 1)
    const cy = Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1)
    const top = document.elementFromPoint(cx, cy)
    const covered = top && !pm.contains(top) && top !== pm
    editorVisible = box.width > 0 && box.height > 0 && cs.visibility === 'visible' && +cs.opacity > 0.9 && !covered
    editorWhy = `box=${Math.round(box.width)}x${Math.round(box.height)} vis=${cs.visibility} op=${cs.opacity} topEl=${top ? top.className || top.tagName : 'none'} covered=${covered}`
  }
  return {
    events: window.__iwEvents,
    htmlClass: root.className,
    theme: root.dataset.theme ?? '(none)',
    origHtml: !!root.__iwOrigHtml, // false ⇒ React replaced <html> ⇒ hydration was discarded
    waterReady: root.classList.contains('iw-water-ready'),
    videoOn: root.classList.contains('iw-wave-video-on'),
    surfaces, vids,
    diag: window.__iwWaveVideo ?? null, // the probe seam — never scrape the overlay's HTML
    overlay: ov ? ov.innerText.replace(/\n+/g, ' | ') : '(no overlay)',
    editorVisible, editorWhy,
  }
})

const names = r.events.map((e) => e.ev.replace('inkwave:', ''))
const has = (n) => names.includes(n)

console.log('\n─── EVENTS ───')
for (const e of r.events) console.log(`  ${String(e.t).padStart(6)}ms  ${e.ev}`)
const react = errors.filter((e) => /error #4(18|23|25)/.test(e))

console.log('\n─── STATE @12s ───')
console.log('  <html> is ORIGINAL node :', r.origHtml, r.origHtml ? '' : '← REACT RE-RENDERED THE DOCUMENT')
console.log('  html class              :', JSON.stringify(r.htmlClass))
console.log('  data-theme              :', r.theme)
console.log('  iw-wave-video-on        :', r.videoOn)
console.log('  React hydration errors  :', react.length ? react.join(' | ') : 'none')
console.log('  surfaces                :', JSON.stringify(r.surfaces))
console.log('  videos                  :', JSON.stringify(r.vids))
console.log('  diag (probe seam)       :', JSON.stringify(r.diag))
console.log('  overlay (Peter reads)   :', r.overlay)
console.log('  EDITOR VISIBLE          :', r.editorVisible, '—', r.editorWhy)
if (errors.length) console.log('\n─── CONSOLE ERRORS ───\n  ' + errors.join('\n  '))

// ── The verdict ──
// Keyed on the DETERMINISTIC invariants, not on the master race. Whether the video wins the decode
// race before SETTLE varies run to run (probed both ways on the broken build); whether hydration
// survives does NOT. The water dying is the bug — it happened on every broken run regardless of
// which way the race fell.
const wasMaster = !!r.diag?.masterEver
const problems = []
if (react.length) problems.push(`REACT HYDRATION FAILED (${react.join(', ')}) — the server HTML was discarded`)
if (!r.origHtml) problems.push('<html> was REPLACED — a client re-render of the whole document')
if (!r.waterReady) problems.push('.iw-water-ready is GONE from <html> — every wave layer is display:none: THE WATER IS DEAD')
if (r.theme === '(none)') problems.push('data-theme is GONE from <html> — a night client silently falls back to day')
if (!has('reveal-imminent')) problems.push('SETTLE never fired (inkwave:reveal-imminent)')
if (!has('wave-rest')) problems.push('wave-rest never fired — the coast never handed off')
if (has('load-watchdog')) problems.push('THE 30s WATCHDOG FIRED — the chain was forced, not healthy')
if (r.videoOn) problems.push('html.iw-wave-video-on STILL SET at 12s — the video never handed back to the CSS water')
if (r.vids.some((v) => !v.going && +v.opacity > 0.5)) problems.push('a wave video is STILL VISIBLE (opacity>0.5) at 12s')
if (!r.editorVisible) problems.push(`THE EDITOR IS NOT ON SCREEN — ${r.editorWhy}`)
// The overlay's own honesty: it must never claim master while painting nothing.
if (r.diag?.master && r.vids.some((v) => v.rect === '0x0')) problems.push('diag.master is TRUE while the video has a ZERO BOX — the overlay is lying')

console.log('\n─── VERDICT ───')
console.log('  video became master at some point:', wasMaster)
for (const p of problems) console.log('  ✗', p)
if (!problems.length) console.log('  ✓ hydration intact, water alive, chain completed, editor on screen')

await b.close()

if (expectBroken) {
  if (!problems.length) { console.log('\nNEGATIVE FAILED TO FIRE: expected the broken load, got a healthy one.'); process.exit(1) }
  console.log('\nREPRODUCED (as expected).'); process.exit(0)
}
if (problems.length) process.exit(1)
// A clean run that never exercised the video proves only that the CSS path is unharmed. Say so
// rather than bank it as a pass for the feature.
if (!wasMaster) { console.log('\nPARTIAL: the CSS-water path is intact, but the video never became master in this run — it proves the fallback, not the feature.'); process.exit(2) }
process.exit(0)
