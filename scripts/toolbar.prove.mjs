// The footer toolbar contract, driven in the REAL built app.
//
// The unit tests pin the RULES (toolbarContract.test.ts). They cannot see whether the rules are
// WIRED — the shipped 6→7 migration and the bar-layer exclusion both live in a React component the
// gate never renders. This probe asks the DOM.
//
// Headless, DEDICATED PORT, own PID — never pkill anything, never a window on Peter's screen.
// Usage: node scripts/toolbar.prove.mjs [port]

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

const PORT = process.argv[2] ?? '4947'
const OUT = '/tmp/toolbar-shots'
mkdirSync(OUT, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--outDir', 'build/client', '--port', PORT, '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore', detached: false,
})
const cleanup = () => { try { server.kill('SIGTERM') } catch {} }
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(1) })
// POLL, never guess: a fixed sleep raced vite preview's ~6s boot and the probe reported
// ERR_CONNECTION_REFUSED as though the app were broken.
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break } catch {}
  await new Promise(r => setTimeout(r, 500))
}

const browser = await chromium.launch()
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// A CURATED, REORDERED legacy six — deliberately NOT the default order.
//
// THE FIRST CUT OF THIS PROBE USED THE DEFAULT SIX AND COULD NOT FAIL: DEFAULT_SLOTS is also
// seven, so "the row has 7" scored identically whether the config APPENDED (correct) or RESET to
// defaults (the shipped bug that strands a curated toolbar). It proved the row size and called it
// the migration. A reversed order separates them — append keeps this order as the prefix, reset
// replaces it with 'bib' first.
const STORED_SIX = ['settings', 'style', 'receipt', 'math', 'guide', 'bib']
// What the row's circles read left-to-right if the writer's order SURVIVED. Index 1 = S (style),
// index 2 = R (review); a reset would put the bib glyph '\u201f' at index 0 and S at index 4.
const EXPECT_PREFIX = { 1: 'S', 2: 'R' }

for (const theme of ['day', 'night']) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(([t, six]) => {
    localStorage.setItem('inkwave:theme', t)
    localStorage.setItem('inkwave-toolbar-slots', JSON.stringify(six))
  }, [theme, STORED_SIX])

  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  // An editor is `.ProseMirror[contenteditable=true]` — NOT `.ProseMirror` (CLAUDE.md: a load
  // transiently carries an aria-hidden anti-flash SHELL that also has the class).
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 })
  await page.click('.ProseMirror[contenteditable="true"]')
  await page.waitForTimeout(1200)

  // ── The row ──────────────────────────────────────────────────────────────
  // `.iw-slot` is worn by BOTH the row circles and the ▲ overflow entries — the first cut of this
  // probe counted all ten and reported "the migration is broken" about a working app. Partition
  // them by the popup container instead; the sum is a check on the partition itself.
  const slots = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.iw-slot')]
    const inPopup = (e) => !!e.closest('.absolute.bottom-full')
    const row = all.filter(e => !inPopup(e))
    return {
      row: row.length,
      overflow: all.filter(inPopup).length,
      glyphs: row.map(e => e.textContent?.trim() ?? ''),
    }
  })
  // VOID GUARD: a selector matching nothing reports "0 slots", which reads as a real finding.
  if (slots.row + slots.overflow === 0) { check(`[${theme}] VOID — .iw-slot matched nothing`, false); break }

  check(`[${theme}] the row is the SIX-slot speed dial (Peter: "fits well on phone")`,
    slots.row === 6, `row=${slots.row} overflow=${slots.overflow}`)

  // THE DISCRIMINATING CHECK: did the writer's CURATED order survive, or was it reset?
  const orderHeld = Object.entries(EXPECT_PREFIX).every(([i, g]) => slots.glyphs[+i] === g)
  check(`[${theme}] the curated order SURVIVED the migration (append, never reset)`,
    orderHeld, `row glyphs=${JSON.stringify(slots.glyphs)} — a reset would read ["\u201f",...]`)
  // REGISTERED ≠ BUILT: media/music/clock are registered for their lanes but render nothing yet,
  // so the drawer holds only the live remainder (page). A dead circle would show up here.
  check(`[${theme}] the ▲ drawer holds the live remainder — no dead circles`,
    slots.overflow === 1, `overflow=${slots.overflow}`)

  // ── The bar layers: mutual exclusion, in the DOM ─────────────────────────
  const styleBtn = await page.$('[data-iw-bar="style"]')
  const reviewBtn = await page.$('[data-iw-bar="review"]')
  check(`[${theme}] both bar-layer triggers are in the row`, !!styleBtn && !!reviewBtn)

  if (styleBtn && reviewBtn) {
    await styleBtn.click(); await page.waitForTimeout(500)
    const afterStyle = await page.evaluate(() => document.querySelector('[data-iw-bar="style"]')?.getAttribute('aria-pressed'))
    check(`[${theme}] tapping S opens the style layer`, afterStyle === 'true', `aria-pressed=${afterStyle}`)

    // THE INVARIANT: R while S is open must leave exactly ONE layer owning the bar.
    await reviewBtn.click(); await page.waitForTimeout(700)
    const both = await page.evaluate(() => ({
      style: document.querySelector('[data-iw-bar="style"]')?.getAttribute('aria-pressed'),
      reviewLit: !!document.querySelector('[data-iw-bar="review"]')?.className.match(/5c2d8a/),
    }))
    check(`[${theme}] S closed when R took the bar — never both`,
      both.style === 'false' && both.reviewLit, JSON.stringify(both))

    await reviewBtn.click(); await page.waitForTimeout(400)
  }

  // ── Screenshots, day AND night ───────────────────────────────────────────
  const footer = await page.$('.iw-touch-guard.iw-nightable')
  if (footer) await footer.screenshot({ path: `${OUT}/toolbar-${theme}.png` })
  await page.screenshot({ path: `${OUT}/full-${theme}.png` })
  console.log(`  → ${OUT}/toolbar-${theme}.png`)

  await ctx.close()
}

await browser.close()
cleanup()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
