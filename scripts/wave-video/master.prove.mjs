// ─── THE MASTER INVARIANT: `iw-wave-video-on` ⟺ a video is actually painting ──────────────────
// Peter, live desktop, 2026-07-17: "After I signed in just now the wave background completely went
// away" — flat teal, no waves, document fine. His overlay: `▲ VIDEO IS MASTER BUT NOT PAINTED — no
// video element`, `reason: BRAKE (slow-down) playing`, `water-gate OPEN`.
//
// THE MECHANISM (source, index.css): `html.iw-wave-video-on .inkwave-editor-surface.iw-fill::before
// /::after/.iw-wave-twinkles { visibility: hidden }`. That class SUPPRESSES the CSS water and has
// NO dependency on the video existing. `master` is a LATCH. So if the element goes while the class
// holds — a re-render tearing it out (mounting Clerk at sign-in), a swap that loses its brake —
// nothing draws the water and the surface is left a bare gradient. The overlay was RIGHT; the
// "master with no element is just a benign swap transient" reading (mine, round 3) was wrong, and
// it would have made the instrument blind to exactly this.
//
// THE INVARIANT, and it is one line: the CSS water may only be suppressed while something is
// actually drawing water in its place. Kill the element; the water must come back.
//
// This is deliberately engine-honest: it does NOT need Clerk. It provokes the GENERAL shape (the
// element leaves the DOM while master) by removing it, which is what every cause reduces to.
//
// Usage: node scripts/wave-video/master.prove.mjs [--port 4321] [--expect-broken]
import { webkit } from '@playwright/test'

const args = process.argv.slice(2)
const expectBroken = args.includes('--expect-broken')
const port = Number(args[args.indexOf('--port') + 1]) || 4321
const BASE = `http://127.0.0.1:${port}`

const b = await webkit.launch()
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }) // desk rung, like Peter
await ctx.addInitScript(() => { try { localStorage.setItem('inkwave:waveVideo', 'debug') } catch { /* private */ } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })

// Wait for the video to actually take over (poll the probe seam, not the overlay's text).
let becameMaster = false
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(100)
  if (await page.evaluate(() => !!window.__iwWaveVideo?.master)) { becameMaster = true; break }
}
if (!becameMaster) {
  console.log('INCONCLUSIVE: the video never became master, so there is no suppression to test.')
  await b.close(); process.exit(2)
}

// THE PROVOCATION: the element vanishes while master is latched — what a re-render does to it.
const after = await page.evaluate(() => {
  for (const v of document.querySelectorAll('video.iw-wave-video-el')) v.remove()
  return new Promise((res) => setTimeout(() => {
    // GROUND TRUTH: is ANY surface drawing water? Do NOT single one out with querySelector — during
    // the load there are TWO .iw-fill surfaces (the shell + the covered editor) and the covered
    // one hides its water BY DESIGN (`.iw-wave-covered`, so the two copies can't double-paint). A
    // first-match read scored that legitimate hide as "the water is dead" and made this probe's
    // verdict depend on which frame it landed on. The question is whether the water is on screen
    // AT ALL, and exactly one surface is ever meant to be answering yes.
    const surfaces = [...document.querySelectorAll('.inkwave-editor-surface.iw-fill')].map((s) => ({
      cls: s.className, vis: getComputedStyle(s, '::before').visibility,
    }))
    res({
      videoOn: document.documentElement.classList.contains('iw-wave-video-on'),
      vids: document.querySelectorAll('video.iw-wave-video-el').length,
      surfaces,
      anyWaterDrawing: surfaces.some((s) => s.vis === 'visible'),
      master: !!window.__iwWaveVideo?.master,
      reason: window.__iwWaveVideo?.reason,
    })
  }, 700))
})

console.log('\n─── AFTER THE VIDEO ELEMENT VANISHES (master was latched) ───')
console.log('  videos in DOM      :', after.vids)
console.log('  html.iw-wave-video-on:', after.videoOn, after.videoOn ? '← still suppressing the CSS water' : '')
console.log('  surfaces           :', JSON.stringify(after.surfaces))
console.log('  ANY water drawing  :', after.anyWaterDrawing)
console.log('  diag.master        :', after.master)
console.log('  reason             :', after.reason)

const problems = []
if (after.videoOn) problems.push('iw-wave-video-on is STILL SET with no video — the CSS water stays suppressed')
if (!after.anyWaterDrawing) problems.push('THE WATER IS DEAD: no surface is drawing water and no video exists — Peter\'s flat teal')
if (after.master) problems.push('diag.master is still true with no element — the latch never cleared')

console.log('\n─── VERDICT ───')
for (const p of problems) console.log('  ✗', p)
if (!problems.length) console.log('  ✓ the element vanished and the CSS water came straight back — the invariant holds')

await b.close()
if (expectBroken) {
  if (!problems.length) { console.log('\nNEGATIVE FAILED TO FIRE: expected the water to die, it recovered.'); process.exit(1) }
  console.log('\nREPRODUCED (as expected).'); process.exit(0)
}
process.exit(problems.length ? 1 : 0)
