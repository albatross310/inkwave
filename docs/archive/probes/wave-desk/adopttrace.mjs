// WHY does the adopt fail? Timestamp each surface's arrival vs the water gate, and watch whether
// the first surface's drift startTime is RESOLVED at the moment the second surface mounts —
// Scroll.tsx reads it synchronously and gives up forever if it is null.
import { chromium } from '@playwright/test'
const port = Number(process.argv[2] || 4321)
const b = await chromium.launch({ headless: false, args: ['--force-device-scale-factor=1'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => {
  const w = window
  w.__iwA = { log: [] }
  const t = () => Math.round(performance.now())
  const driftOf = (s) => {
    try { return s.getAnimations({ subtree: true }).find((x) => x.animationName === 'iw-wave-drift-l') } catch { return undefined }
  }
  const snap = (why) => {
    const surfaces = [...document.querySelectorAll('.inkwave-editor-surface')]
    w.__iwA.log.push({
      t: t(), why,
      gate: document.documentElement.classList.contains('iw-water-ready'),
      surfaces: surfaces.map((s) => {
        const a = driftOf(s)
        return {
          cls: s.className.replace('inkwave-editor-surface ', ''),
          hasAnim: !!a,
          // THE QUESTION: null here at a sibling's mount ⇒ Scroll.tsx's adopt finds no sibling.
          startTime: a ? (typeof a.startTime === 'number' ? Math.round(a.startTime * 10) / 10 : null) : undefined,
          pending: a ? a.pending : undefined,
        }
      }),
    })
  }
  for (const ev of ['inkwave:twinkles-ready', 'inkwave:reveal-imminent'])
    window.addEventListener(ev, () => snap(ev))
  // addInitScript runs BEFORE <html> exists — observing document.documentElement here throws and
  // the whole recorder dies silently, leaving an empty log that reads as "nothing happened".
  const arm = () => {
    if (!document.documentElement) return false
    new MutationObserver(() => snap('mutation'))
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    return true
  }
  if (!arm()) document.addEventListener('readystatechange', arm, { once: true })
  const poll = () => { try { snap('poll') } catch { /* pre-DOM */ } if (performance.now() < 12000) setTimeout(poll, 120) }
  setTimeout(poll, 0)
})
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(11000)
const r = await page.evaluate(() => window.__iwA.log)
// Print only the transitions that matter: surface-count changes and startTime resolutions.
let prevKey = ''
for (const e of r) {
  const key = JSON.stringify(e.surfaces.map((s) => [s.cls, s.hasAnim, s.startTime, s.pending])) + e.gate
  if (key === prevKey) continue
  prevKey = key
  console.log(`t=${String(e.t).padStart(5)} gate=${e.gate ? 'OPEN' : 'shut'} (${e.why})`)
  for (const s of e.surfaces)
    console.log(`      ${s.hasAnim ? 'anim' : 'NO-ANIM'} startTime=${s.startTime === undefined ? '—' : s.startTime} pending=${s.pending} | ${s.cls}`)
}
const last = r[r.length - 1]
const sts = last.surfaces.map((s) => s.startTime).filter((x) => typeof x === 'number')
if (sts.length > 1) {
  const norm = (x) => { const m = ((x % 1944) + 1944) % 1944; return m > 972 ? m - 1944 : m }
  console.log('\nFINAL skew:', Math.round(norm(sts[1] - sts[0]) * 10) / 10, 'ms =',
    Math.round(Math.abs(norm(sts[1] - sts[0])) * (140 / 1944) * 10) / 10, 'px')
}
await b.close()
