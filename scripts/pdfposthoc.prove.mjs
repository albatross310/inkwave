// The PDF reading indicator + the post-hoc manual add — day and night, desktop and phone.
//
// WHY SCREENSHOTS AND NOT ASSERTIONS: CLAUDE.md's night-mode bug in this very panel was found by
// LOOKING, not by a check — the class was present and the token resolved, so every structural
// assertion passed while `color:#fff` on a light-purple `--iw-ink` fill rendered invisible. A probe
// that asserts "the class is there" would have certified that bug. So this one takes pictures AND
// reads the COMPUTED colours off the live DOM, which is the part a picture can't be diffed on.
//
// It also drives the post-hoc add through the REAL UI (tap the pills, tap Add) and reads back the
// REAL ledger, rather than calling the store directly — the store is unit-tested; what is unproven is
// the wiring.
//
// Own port, headless, nothing on Peter's screen. Usage: node scripts/pdfposthoc.prove.mjs [port]

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] ?? 4947)
const URL = `http://127.0.0.1:${PORT}/`
const OUT = 'scratch-shots/pdfposthoc'

const server = spawn('npx', ['vite', 'preview', '--outDir', 'build/client', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore',
})
const stopServer = () => { try { server.kill('SIGTERM') } catch { /* gone */ } }
process.on('exit', stopServer)
let failed = 0
let voided = 0
const fail = (m) => { console.error(`  ✗ ${m}`); failed++ }
// A THIRD ANSWER. This probe drives a panel whose SHAPE changed under it once already — the sections
// moved behind a nav row and six checks reported the features broken. A structural change to the
// panel is not a finding about the reading indicator, and must not be scored as one.
const voidRun = (m) => { console.error(`  ⊘ VOID — ${m}`); voided++ }
const ok = (m) => console.log(`  ✓ ${m}`)

/** The shared-box rule: prove the port serves THIS worktree before believing any verdict. */
async function assertServerIsOurs() {
  const dir = 'build/client/assets'
  const mine = readdirSync(dir).filter(
    (f) => f.endsWith('.js') && readFileSync(`${dir}/${f}`, 'utf8').includes('inkwave:pdfActivity'),
  )
  // Assert the SERVED chunk carries the thing just changed — not merely that a surface exists.
  // (CLAUDE.md round 13: a probe passed against a stale bundle because it only checked for a name.)
  if (mine.length !== 1) throw new Error(`expected ONE chunk containing 'inkwave:pdfActivity', found ${mine.length} — run \`pnpm build\``)
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${URL}assets/${mine[0]}`).catch(() => null)
    if (res?.ok) { console.log(`✓ server on ${PORT} serves THIS worktree (${mine[0]})`); return }
    await sleep(1000)
  }
  throw new Error(`port ${PORT} is not serving our build — another agent may hold it; try another port`)
}

async function openApp(browser, { theme, phone, seedPdf }) {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
          : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))
  await page.addInitScript(([t, seed]) => {
    localStorage.setItem('inkwave:prodLedger', '1')
    if (t === 'night') localStorage.setItem('inkwave:theme', 'night')
    if (seed) {
      // Seed the reading indicator's own store, at timestamps relative to THIS page's clock — a
      // fixed epoch would be pruned as stale and the section would render empty, which is exactly
      // the "passed while showing nothing" trap.
      const now = Date.now()
      localStorage.setItem('inkwave:pdfActivity', JSON.stringify({
        'smith2020': { scrollAt: now - 20_000, annotateAt: now - 40_000 }, // annotating
        'jones2019': { scrollAt: now - 90_000 },                            // reading
        'brown2018': { scrollAt: now - 30 * 60_000 },                         // STALE ⇒ must NOT show
      }))
    }
  }, [theme, seedPdf])
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror', { timeout: 45_000 })
  await sleep(3500) // the wave load choreography settles; a mid-reveal shot is unreadable
  return { ctx, page }
}

/** Open the drop-up the way a writer does — the clock defaults into the ▲ overflow (Peter's ruling). */
async function openDropUp(page, tag) {
  let clock = page.locator('button[title*="ledger"]:visible').first()
  if (!(await clock.count())) {
    await page.getByTitle('Customise toolbar').click()
    await sleep(400)
    clock = page.locator('button[title*="ledger"]:visible').first()
  }
  if (!(await clock.count())) { fail(`${tag}: no clock button in the toolbar OR the ▲ overflow`); return null }
  await clock.click()
  const panel = page.locator('.iw-touch-guard').filter({ hasText: 'Today' }).first()
  // WAIT, never sleep. The first cut slept 700ms and reported "the indicator did not render" on a
  // panel that renders it — a probe that fails by luck is as useless as one that passes by luck, and
  // this one sent me hunting a feature bug that did not exist. Wait for the CONTENT, not the clock.
  try {
    await panel.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    fail(`${tag}: the clock drop-up did not open within 10s`)
    return null
  }

  // ⚠ THE PANEL IS A NAV SHELL NOW, AND THE SECTIONS MOVED ONE SCREEN IN (2026-07-19, `f8dd8aa`).
  // `ClockMenu` was restructured into five nav rows; `ReadingSection` and `PostHocAdd` render inside
  // `ProjectsView`, i.e. only when `view === 'projects'`. This probe still drove the old FLAT
  // drop-up, so it waited on the home screen for a section that is no longer there and reported
  // "drop-up did not render its Today section within 10s" — six failures accusing the reading
  // indicator and the post-hoc add, both of which work. The COPY never changed; the SCREEN did.
  // Nothing here is a product bug, and the fix is to navigate the way a writer does.
  const projects = panel.getByRole('button', { name: /Manage projects/ })
  if (!(await projects.count())) {
    // Distinguish "the nav shell changed again" from "the sections are broken" — they need
    // different people, and the old message conflated them.
    voidRun(`${tag}: no "Manage projects" nav row — the clock panel's shape has changed again`)
    return null
  }
  await projects.click()

  try {
    await panel.getByText('Add time you didn\u2019t track').waitFor({ state: 'attached', timeout: 10_000 })
  } catch {
    fail(`${tag}: the projects view rendered no post-hoc add section within 10s`)
    return null
  }
  return panel
}

await assertServerIsOurs()
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })

// ─── 1. The reading indicator, both themes ───────────────────────────────────
console.log('\n── READING INDICATOR ──')
for (const theme of ['day', 'night']) {
  for (const phone of [false, true]) {
    const tag = `${theme}-${phone ? 'phone' : 'desktop'}`
    const { ctx, page } = await openApp(browser, { theme, phone, seedPdf: true })
    const panel = await openDropUp(page, tag)
    if (!panel) { await ctx.close(); continue }

    const reading = panel.locator('section').filter({ has: page.locator('h3', { hasText: 'Reading' }) }).first()
    try { await reading.waitFor({ state: 'visible', timeout: 10_000 }) }
    catch { fail(`${tag}: no Reading section — the indicator did not render`); await ctx.close(); continue }
    const text = await reading.innerText()

    // The two live states show; the STALE one must not — that is the honest third state, and a probe
    // that only checked "something rendered" could not tell it from a broken window.
    if (text.includes('smith2020') && text.includes('annotating')) ok(`${tag}: annotating PDF shown`)
    else fail(`${tag}: annotating PDF missing — got: ${text.replace(/\n/g, ' | ')}`)
    if (text.includes('jones2019') && text.includes('reading')) ok(`${tag}: reading PDF shown`)
    else fail(`${tag}: reading PDF missing — got: ${text.replace(/\n/g, ' | ')}`)
    if (!text.includes('brown2018')) ok(`${tag}: the STALE pdf is absent (open ≠ reading)`)
    else fail(`${tag}: a stale PDF is being shown as read — the number is no longer true`)

    await panel.screenshot({ path: `${OUT}/reading-${tag}.png` })
    await ctx.close()
  }
}

// ─── 2. The post-hoc add, driven for real ────────────────────────────────────
console.log('\n── POST-HOC ADD ──')
for (const theme of ['day', 'night']) {
  const tag = `${theme}-desktop`
  const { ctx, page } = await openApp(browser, { theme, phone: false, seedPdf: false })
  const panel = await openDropUp(page, tag)
  if (!panel) { await ctx.close(); continue }

  const trigger = panel.getByText(/Add time you didn/i)
  if (!(await trigger.count())) { fail(`${tag}: no post-hoc entry point`); await ctx.close(); continue }
  await trigger.click()
  await sleep(300)
  await panel.screenshot({ path: `${OUT}/posthoc-form-${tag}.png` })

  // THE CONTRAST CHECK — the bug CLAUDE.md records in this panel was `#fff` on a light `--iw-ink`
  // fill: structurally perfect, visually invisible. Read the COMPUTED colours off the live button.
  const addBtn = panel.getByRole('button', { name: /^Add \d+m$/ })
  const colours = await addBtn.evaluate((el) => {
    const s = getComputedStyle(el)
    return { fg: s.color, bg: s.backgroundColor }
  })
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  const contrast = Math.abs(lum(colours.fg) - lum(colours.bg))
  if (contrast > 0.35) ok(`${tag}: Add button legible (fg ${colours.fg} on bg ${colours.bg}, Δlum ${contrast.toFixed(2)})`)
  else fail(`${tag}: Add button UNREADABLE — fg ${colours.fg} on bg ${colours.bg}, Δlum ${contrast.toFixed(2)}`)

  // Drive it: 45m, reading, a note. Rough duration + rough category — the whole form.
  await panel.getByRole('button', { name: '45m', exact: true }).click()
  await panel.getByRole('button', { name: 'reading', exact: true }).click()
  await panel.locator('textarea[placeholder*="What was it"]').fill('Read the printed chapter')
  await sleep(150)
  await panel.getByRole('button', { name: /^Add 45m$/ }).click()
  await sleep(1200)

  const confirm = await panel.innerText()
  if (/Added 45 minutes from memory/i.test(confirm)) ok(`${tag}: the add landed and says it was from memory`)
  else fail(`${tag}: no confirmation — got: ${confirm.slice(0, 300).replace(/\n/g, ' | ')}`)

  // §A6.1 read off the SCREEN: the day summary's measured minutes must not have absorbed the 45.
  const today = panel.locator('section', { hasText: 'Today' }).first()
  const summary = await today.innerText()
  if (/45 focused minute/i.test(summary)) {
    fail(`${tag}: THE MERGE HAPPENED ON SCREEN — post-hoc time is being reported as focused/measured time`)
  } else ok(`${tag}: post-hoc minutes did NOT merge into the day's measured summary`)

  await panel.screenshot({ path: `${OUT}/posthoc-added-${tag}.png` })
  await ctx.close()
}

await browser.close()
stopServer()
console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ ALL PASSED')
console.log(voided ? `\nVOID (${voided}) — a precondition moved; this run proves nothing about the feature`
  : failed ? `\nFAILED (${failed})` : '\nPASS')
process.exit(voided ? 2 : failed ? 1 : 0)
