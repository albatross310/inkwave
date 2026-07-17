// The clock drop-up + countdown: does it LOOK right, and does it cost typing?
//
// Two questions, one harness:
//  1. SCREENSHOTS — day + night, desktop + phone. Nobody has ever looked at these panels in night
//     mode; a token that resolves to its day fallback on a dark surface is invisible, not subtly off.
//  2. THE TYPING CLAIM — "a per-second countdown must not move the keystroke cost". Measured as an
//     A/B in the SAME page: type with the Pomodoro idle, then type with it running.
//
// THE INSTRUMENT IS PROVED BEFORE ITS VERDICT IS READ, and the first cut of it WAS BLIND — twice.
//  (1) Its known-positive wrote `--wave-x` on the surface per second, copying CLAUDE.md's 417ms
//      finding. It cost nothing, because that write is exactly what the shipped FIREBREAK prunes
//      (`--wave-x: 0px` on .iw-magnify-box/.scroll-paper) and because this page's document is
//      near-empty — there is no 100-page subtree to invalidate. A known-positive aimed at a fixed
//      bug on a document that cannot express it is decoration.
//  (2) It read the MEDIAN of 50 keystrokes. A PER-SECOND event lands on ~1 of them, so the median
//      is STRUCTURALLY INCAPABLE of seeing it — the statistic answered a different question than
//      the claim. A per-second cost lives in the TAIL.
// So: type long enough to contain several ticks, read p95/max, and prove the harness with a cost it
// genuinely cannot miss (a per-second main-thread block). If that does not move the tail, this
// harness cannot measure what it claims and every number below is VOID.
//
// Usage: node scripts/ledger-ui.prove.mjs [port]   (needs `pnpm build` first)

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] ?? 4741)
const URL = `http://127.0.0.1:${PORT}/`
const OUT = 'scratch-shots'

const server = spawn('npx', ['vite', 'preview', '--outDir', 'build/client', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore',
})
const stopServer = () => { try { server.kill('SIGTERM') } catch { /* gone */ } }
process.on('exit', stopServer)
const fail = (m) => { console.error(`\n✗ ${m}`); stopServer(); process.exit(1) }

/** The shared-box rule: prove the port is serving THIS worktree before believing anything. */
async function assertServerIsOurs() {
  const dir = 'build/client/assets'
  const mine = readdirSync(dir).filter(
    (f) => f.endsWith('.js') && readFileSync(`${dir}/${f}`, 'utf8').includes('inkwave:prodLedger'),
  )
  if (mine.length !== 1) throw new Error(`expected ONE chunk with 'inkwave:prodLedger', found ${mine.length} — run \`pnpm build\``)
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${URL}assets/${mine[0]}`).catch(() => null)
    if (res?.ok) { console.log(`✓ server on ${PORT} serves THIS worktree (${mine[0]})`); return }
    await sleep(1000)
  }
  throw new Error(`port ${PORT} is not serving our build — another agent may hold it; try another port`)
}

async function openApp(browser, { theme, phone }) {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
          : { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))
  await page.addInitScript((t) => {
    localStorage.setItem('inkwave:prodLedger', '1')
    localStorage.setItem('inkwave:ledgerPlace', 'library')
    if (t === 'night') localStorage.setItem('inkwave:theme', 'night')
  }, theme)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror', { timeout: 45_000 })
  // The wave load choreography settles; shots taken mid-reveal are unreadable.
  await sleep(3500)
  return { ctx, page }
}

/**
 * keydown→rAF latency over `n` keystrokes. 220 at ~22ms ≈ 5 seconds of typing, so a per-second
 * event lands in ~5 samples — enough to move p95/max, which is where a per-second cost lives.
 */
async function typeLatency(page, n = 220) {
  await page.click('.ProseMirror')
  return page.evaluate(async (count) => {
    const el = document.querySelector('.ProseMirror')
    const samples = []
    for (let i = 0; i < count; i++) {
      const t0 = performance.now()
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
      document.execCommand?.('insertText', false, 'a')
      await new Promise((r) => requestAnimationFrame(() => r()))
      samples.push(performance.now() - t0)
      await new Promise((r) => setTimeout(r, 12))
    }
    samples.sort((a, b) => a - b)
    const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))]
    return { p50: at(0.5), p95: at(0.95), max: samples[samples.length - 1] }
  }, n)
}

await assertServerIsOurs()
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })

// ─── 1. Screenshots ──────────────────────────────────────────────────────────
for (const theme of ['day', 'night']) {
  for (const phone of [false, true]) {
    const { ctx, page } = await openApp(browser, { theme, phone })
    const tag = `${theme}-${phone ? 'phone' : 'desktop'}`

    // Open the drop-up from the toolbar's clock button — the real path, not a synthetic mount.
    // PETER'S RULING: the row stays SIX, so `clock` competes for a slot and lands in the ▲ OVERFLOW
    // by default. That is why the trigger cannot own the panel's state (it is usually unmounted) —
    // and why this probe must open ▲ first, exactly as a writer would.
    let clock = page.locator('button[title*="ledger"]:visible').first()
    if (!(await clock.count())) {
      await page.getByTitle('Customise toolbar').click()
      await sleep(400)
      clock = page.locator('button[title*="ledger"]:visible').first()
    }
    if (!(await clock.count())) fail(`${tag}: no clock button in the toolbar OR the ▲ overflow`)
    await clock.click()
    await sleep(600)
    if (!(await page.locator('.iw-touch-guard').filter({ hasText: 'Today' }).count())) fail(`${tag}: drop-up did not open`)
    await page.screenshot({ path: `${OUT}/ledger-${tag}.png` })

    // §A5b: add a goal with a DATE through the real UI, plus one already overdue, so the
    // timeline's wry status line is in the shot rather than an empty state.
    const goalInput = page.getByPlaceholder('finish the lit review…')
    if (await goalInput.count()) {
      const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
      for (const [text, due] of [['finish the lit review', iso(-3)], ['draft chapter 3', iso(4)]]) {
        await goalInput.fill(text)
        await page.locator('input[type="date"]').first().fill(due)
        await page.getByTitle('Add goal').click()
        await sleep(250)
      }
      // Tick the overdue one off so 'done — fashionably late' renders too.
      const done = page.getByTitle('Done').first()
      if (await done.count()) { await done.click().catch(() => {}); await sleep(250) }
      await page.getByPlaceholder(/Roughly how this gets done/).fill('lit review, then draft, then panic')
      await page.getByPlaceholder(/Roughly how this gets done/).blur()
      await sleep(300)
      await page.screenshot({ path: `${OUT}/goals-${tag}.png` })
    }

    // ...and with Settings expanded (lengths / chime / place / titles).
    const settings = page.getByText(/Settings — lengths, chime/).first()
    if (await settings.count()) { await settings.click(); await sleep(400) }
    await page.screenshot({ path: `${OUT}/ledger-${tag}-settings.png` })

    // The countdown only exists while a block runs — start one, then shoot the corner.
    if (!phone) {
      await page.getByRole('button', { name: 'Start' }).first().click()
      await sleep(1200)
      await page.keyboard.press('Escape')
      await sleep(400)
      await page.screenshot({ path: `${OUT}/countdown-${tag}.png`, clip: { x: 880, y: 0, width: 400, height: 120 } })
    }
    console.log(`✓ shots: ${tag}`)
    await ctx.close()
  }
}

// ─── 2. The typing claim, with its instrument proved ─────────────────────────
{
  const { ctx, page } = await openApp(browser, { theme: 'day', phone: false })
  await typeLatency(page, 20) // warm

  const idle = await typeLatency(page)
  // Start a REAL Pomodoro through the REAL UI — the drop-up must be open for Start to exist.
  await page.locator('button[title*="ledger"]').first().click()
  await page.getByRole('button', { name: 'Start' }).first().click()
  await page.keyboard.press('Escape') // close the panel: measure typing with only the OVERLAY ticking
  await sleep(1500)
  const running = await typeLatency(page)

  // KNOWN-POSITIVE: a per-second 40ms main-thread block — a ticking clock that does real work on
  // the writer's thread. This is the cost class the claim denies, and the harness MUST see it.
  await page.evaluate(() => {
    window.__iwBadClock = setInterval(() => {
      const end = performance.now() + 40
      while (performance.now() < end) { /* block the writer's thread, once a second */ }
    }, 1000)
  })
  await sleep(1200)
  const badClock = await typeLatency(page)
  await page.evaluate(() => clearInterval(window.__iwBadClock))

  const f = (x) => x.toFixed(2).padStart(6)
  console.log('\n[typing] keydown→rAF over 220 keystrokes (~5s ⇒ ~5 ticks). Chromium headless, WSL software raster.')
  console.log(`  pomodoro IDLE      p50 ${f(idle.p50)}  p95 ${f(idle.p95)}  max ${f(idle.max)}`)
  console.log(`  pomodoro RUNNING   p50 ${f(running.p50)}  p95 ${f(running.p95)}  max ${f(running.max)}`)
  console.log(`  known-positive     p50 ${f(badClock.p50)}  p95 ${f(badClock.p95)}  max ${f(badClock.max)}   (per-second 40ms block)`)
  console.log(`  running vs idle:        p95 ${(running.p95 / idle.p95).toFixed(2)}×`)
  console.log(`  known-positive vs idle: p95 ${(badClock.p95 / idle.p95).toFixed(2)}×  ← must be >>1 or every number here is VOID`)
  if (badClock.p95 <= idle.p95 * 1.5) {
    // VOID, not FAIL — and not a pass either. This box runs several agents' probes concurrently, so
    // the noise floor swallows a per-second signal (observed: idle p50 wandering 4.8 → 9.2ms between
    // runs, and RUNNING scoring *noisier* than the deliberate 40ms block). Reporting "0.90×, no
    // change" off an instrument that cannot see its own known-positive is exactly the fiction this
    // repo keeps getting burned by. THE CLAIM IS KEPT IN THE GATE INSTEAD, where it is decidable:
    // src/components/TimeFace.test.tsx asserts the tick re-renders NOTHING (mutation-proved: a
    // setState-per-second TimeFace kills 2 tests). Re-run this on a quiet box for a real number.
    console.log('\n⚠ TYPING CELL VOID — the instrument could not see its own known-positive')
    console.log('  (CPU contention on this shared box). The numbers above are UNREADABLE; do not quote them.')
    console.log('  The claim is asserted in src/components/TimeFace.test.tsx instead.')
  } else {
    console.log('✓ instrument proved: it sees a per-second cost — the RUNNING row above is readable')
  }
  await ctx.close()
}

await browser.close()
console.log(`\n✓ shots in ${OUT}/`)
stopServer()
process.exit(0)
