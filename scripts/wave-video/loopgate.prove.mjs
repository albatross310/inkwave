// ─── Peter's two asks, driven in a real browser (2026-07-17) ─────────────────────────────────────
//   "we have to just have blank white screen until the video comes up and play the video every time"
//   "make it show at least one loop before the file comes up. purposefully delay it. (And use that
//    time to warm up the document)"
// Feature: the opening animation / load water. Blast radius: `?waveVideo`, DEFAULT OFF.
//
// WHY THIS EXISTS: the unit tests pin `pickRung`, which is arithmetic. Nothing in the gate can see
// whether the white actually clears, whether the loop gate actually releases, or whether the
// document actually waits — those are facts about a decoder, a class on <html> and an event, in a
// real load. Claiming them from the code would be archaeology.
//
// IT READS `window.__iwWaveVideo`, NEVER the overlay's text (the overlay is a formatted string for
// Peter's phone camera; a probe that parses it measures the formatting).
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, '..', '..', 'build', 'client')
const freePort = () => new Promise((res) => {
  const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) })
})

const port = await freePort()
const srv = spawn('node', [join(HERE, 'server.mjs'), BUILD, String(port)], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 700))
const browser = await chromium.launch({ headless: true })
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`) } else { fail++; console.log(`  ✗ ${m}`) } }

async function load(flag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.addInitScript((f) => {
    try { f ? localStorage.setItem('inkwave:waveVideo', '1') : localStorage.removeItem('inkwave:waveVideo') } catch { /* private */ }
    // TIMELINE, recorded in-page: a CDP round-trip cannot see a class that lives for one frame, and
    // the ORDER of these events is the entire claim. Recorded, not watched (the round-10 lesson).
    const w = window
    w.__t = { waitSeen: false, waitClearedAt: null, loopAt: null, revealAt: null, waitAtReveal: null }
    const t0 = performance.now()
    const tick = () => {
      const has = document.documentElement.classList.contains('iw-wave-video-wait')
      if (has) w.__t.waitSeen = true
      if (!has && w.__t.waitSeen && w.__t.waitClearedAt == null) w.__t.waitClearedAt = performance.now() - t0
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.addEventListener('inkwave:wave-video-loop', () => { if (w.__t.loopAt == null) w.__t.loopAt = performance.now() - t0 })
    window.addEventListener('inkwave:editor-revealed', () => {
      if (w.__t.revealAt != null) return
      w.__t.revealAt = performance.now() - t0
      // The load-bearing one: was the white still up when the document appeared? If so the delay
      // has shipped a WHITE screen rather than a video, which is worse than the bug it fixes.
      w.__t.waitAtReveal = document.documentElement.classList.contains('iw-wave-video-wait')
    })
  }, flag)
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__t?.revealAt != null, null, { timeout: 25000 }).catch(() => {})
  const r = await page.evaluate(() => ({ t: window.__t, v: window.__iwWaveVideo || null }))
  await ctx.close()
  return r
}

try {
  console.log('─── FLAG OFF: the control. Nothing may change for a writer without the feature. ───')
  const off = await load(false)
  ok(off.t.revealAt != null, `the document reveals (at ${off.t.revealAt?.toFixed(0)}ms)`)
  ok(!off.t.waitSeen, 'the white wait NEVER appears with the flag off')
  ok(off.t.loopAt == null, 'no loop gate event with the flag off — the reveal is not delayed')
  const offReveal = off.t.revealAt

  console.log('\n─── FLAG ON ───')
  const on = await load(true)
  const v = on.v
  console.log(`  diag: master=${v?.master} masterEver=${v?.masterEver} rung=${v?.rung}`)
  console.log(`  diag: loop-gate="${v?.loop}"`)
  console.log(`  timeline: waitCleared=${on.t.waitClearedAt?.toFixed(0)}ms loop=${on.t.loopAt?.toFixed(0)}ms reveal=${on.t.revealAt?.toFixed(0)}ms`)

  if (!v?.masterEver) {
    console.log('  VOID: the video never became master in this environment — the two claims below are')
    console.log('        unreadable (a bail releases both gates by design, so they would "pass" for')
    console.log('        the wrong reason). Not scored.')
  } else {
    ok(on.t.waitSeen, 'BLANK WHITE: the wait class is applied on a flag-on load')
    ok(on.t.waitAtReveal === false, 'the white is GONE by the time the document reveals')
    ok(on.t.waitClearedAt != null, `the white clears (at ${on.t.waitClearedAt?.toFixed(0)}ms) — never permanent`)
    // THE DELAY. The boundary must be the video's OWN wrap, and the reveal must follow it.
    ok(/one full loop played/.test(v.loop || ''), `the gate released on a REAL wrap, not the cap: "${v.loop}"`)
    ok(on.t.loopAt != null && on.t.revealAt != null && on.t.revealAt >= on.t.loopAt,
      'THE DELAY: the document reveals AT OR AFTER the loop completed')
    // A delay that does not delay is decoration. The flag-off reveal is the reference.
    ok(on.t.revealAt > offReveal,
      `the reveal is genuinely LATER than flag-off (${on.t.revealAt?.toFixed(0)}ms vs ${offReveal?.toFixed(0)}ms) — the delay is real`)
  }
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`)
} finally {
  await browser.close(); srv.kill()
}
process.exit(fail === 0 ? 0 : 1)
