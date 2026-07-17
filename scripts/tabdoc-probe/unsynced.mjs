// THE UNSYNCED-WORK NOTICE — does the wiring actually fire?
//
// The RULE is unit-pinned (src/editor/unsyncedWatch.test.ts, mutation-tested). This probe answers a
// different and unfalsifiable-by-unit-test question: is the rule CONNECTED to anything? A feature
// whose only evidence is a green unit test is a feature nobody has ever seen fire — and this
// codebase's signature failure is exactly that (a gate that always returned false and silently
// disabled a feature for MONTHS; six green lines on a broken screen).
//
// The threshold is shortened via `window.__iwUnsyncedWarnMs` so five real minutes fit in seconds.
//
// CELLS
//   1  QUIET BEFORE   the notice is NOT showing before the threshold        (the negative)
//   2  FIRES          it appears after the threshold, once the writer types (the positive)
//   3  NOT ON LOAD    it never appears without a single edit                (the negative)
//   4  DISMISS STICKS "Not now" silences it and it does not come back       (the anti-nag clause)
//
// Cells 1/3 are the controls that make cell 2 mean something: if the notice were simply always
// rendered, 2 would pass and this probe would be worthless. Every cell must land as expected or the
// script exits nonzero.
//
// HONEST GAP, stated rather than faked: "never fires while sync IS active" is NOT probed here. It
// needs a live OneDrive/Drive account or a Chromium file-system grant (a real user gesture), which
// headless cannot give. It is unit-pinned instead, and it is the FIRST clause of shouldWarnUnsynced.
//
// Usage: node scripts/tabdoc-probe/unsynced.mjs [--port=5219]

import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]
const PORT = Number(arg('port', '5219'))
const BASE = `http://localhost:${PORT}`
const WARN_MS = 4000
const EDITOR = '.ProseMirror'

const results = []
const record = (cell, name, pass, detail) => {
  results.push({ cell, name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${cell}  ${name}\n        ${detail}`)
}

// Identify the notice by its TEXT, the way the writer does — not by a test id the app could render
// while the feature is broken.
const NOTICE = 'text=Only on this device'
const visible = async (page) => (await page.locator(NOTICE).count()) > 0 && (await page.locator(NOTICE).first().isVisible())

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.addInitScript((ms) => { window.__iwUnsyncedWarnMs = ms }, WARN_MS)
  const page = await ctx.newPage()
  console.log(`\n=== UNSYNCED NOTICE — threshold shortened to ${WARN_MS}ms ===\n`)

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 120000 })
  await page.waitForTimeout(1200)

  // ── CELL 3 — never on load alone. Sit well past the threshold WITHOUT typing. ──
  await page.waitForTimeout(WARN_MS + 2000)
  record('3', 'no notice without a single edit — an untouched page is not unsynced work',
    !(await visible(page)),
    `waited ${WARN_MS + 2000}ms on a freshly loaded, untyped page; notice ${await visible(page) ? 'APPEARED (wrong)' : 'stayed away'}`)

  // ── CELL 1 — quiet before the threshold. ──
  await page.click(EDITOR)
  await page.keyboard.type('ALPHA', { delay: 15 })
  await page.waitForTimeout(800) // well inside WARN_MS
  const early = await visible(page)
  record('1', 'quiet before the threshold',
    !early,
    `typed, then checked 800ms in (threshold ${WARN_MS}ms); notice ${early ? 'APPEARED EARLY (wrong)' : 'stayed away'}`)

  // ── CELL 2 — it fires. ──
  await page.waitForTimeout(WARN_MS + 2500)
  const fired = await visible(page)
  const text = fired ? (await page.locator(NOTICE).first().locator('..').innerText()).replace(/\s+/g, ' ').trim() : ''
  record('2', 'the notice appears after the threshold',
    fired,
    fired ? `showing: "${text.slice(0, 110)}"` : 'NOTICE NEVER APPEARED — the rule is not wired to anything')

  // Theming: it must be legible in night mode, not white-on-white (CLAUDE.md's mandatory rule).
  if (fired) {
    const dayBg = await page.locator(NOTICE).first().locator('..').evaluate((e) => getComputedStyle(e).backgroundColor)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'))
    await page.waitForTimeout(300)
    const nightBg = await page.locator(NOTICE).first().locator('..').evaluate((e) => getComputedStyle(e).backgroundColor)
    record('T', 'themed — the panel is a different surface in night mode',
      dayBg !== nightBg,
      `day ${dayBg} → night ${nightBg}` + (dayBg === nightBg ? ' — IDENTICAL: iw-nightable is not taking effect' : ''))
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
    await page.waitForTimeout(200)
  }

  // ── CELL 4 — dismiss sticks (the anti-nag clause Peter asked for). ──
  if (fired) {
    await page.click('text=Not now')
    await page.waitForTimeout(500)
    const goneNow = !(await visible(page))
    await page.click(EDITOR)
    await page.keyboard.type(' BRAVO', { delay: 15 }) // keep working, well past the threshold again
    await page.waitForTimeout(WARN_MS + 2500)
    const stayedGone = !(await visible(page))
    record('4', '"Not now" silences it, and it does not come back while they keep working',
      goneNow && stayedGone,
      goneNow
        ? (stayedGone ? 'dismissed, and still away after more typing past the threshold' : 'IT CAME BACK — this is the nag Peter asked us not to build')
        : 'dismiss did not hide it')
  } else {
    record('4', '"Not now" silences it', false, 'VOID — the notice never appeared, so dismissal could not be tested')
  }

  await browser.close()

  const failed = results.filter((r) => !r.pass)
  console.log(`\n=== ${results.length - failed.length}/${results.length} cells pass ===`)
  if (failed.length) {
    console.error(`\n✗ ${failed.map((f) => f.cell).join(', ')} failed.`)
    process.exit(1)
  }
  console.log('\n✓ the unsynced notice fires, only when it should, and does not nag.')
  process.exit(0)
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(3) })
