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
  // REGISTERED ≠ LIVE: music/clock are registered for their lanes but render nothing yet, so the
  // drawer holds only the live remainder. A dead circle would show up here.
  check(`[${theme}] the ▲ drawer holds the live remainder — no dead circles`,
    slots.overflow === 2, `overflow=${slots.overflow} (page + media)`)

  // ── HOTKEYS: Alt+N must BE the tap, not a second road ────────────────────
  // The row here is the CURATED order (settings, style, review, …), which is what makes this
  // discriminating: Alt+2 must hit `style` because style is SECOND — not because style is style.
  // Position is identity on a homescreen; a per-slot binding would pass a fixed-order check and
  // fail this one.
  {
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(400)
    const s2 = await page.evaluate(() => document.querySelector('[data-iw-bar="style"]')?.getAttribute('aria-pressed'))
    check(`[${theme}] Alt+2 toggled the SECOND circle (style) — position, not identity`,
      s2 === 'true', `style aria-pressed=${s2}`)

    // ...and the same key closes it: the hotkey dispatches the button's real click, so it inherits
    // toggle semantics for free rather than reimplementing them.
    await page.keyboard.press('Alt+2'); await page.waitForTimeout(400)
    const s3 = await page.evaluate(() => document.querySelector('[data-iw-bar="style"]')?.getAttribute('aria-pressed'))
    check(`[${theme}] Alt+2 again closed it — the hotkey IS the tap`, s3 === 'false', `aria-pressed=${s3}`)

    // Alt+7 is past a 6-slot row. A no-op is the RULE; the void guard is that Alt+2 above proves
    // the mechanism works at all, so "nothing happened" here cannot be silent breakage.
    await page.keyboard.press('Alt+7'); await page.waitForTimeout(250)
    const s4 = await page.evaluate(() => document.querySelector('[data-iw-bar="style"]')?.getAttribute('aria-pressed'))
    check(`[${theme}] Alt+7 addresses nothing on a six-slot row`, s4 === 'false', `aria-pressed=${s4}`)

    // The hints appear only while Alt is HELD — the moment of intent, and nothing on a phone.
    await page.keyboard.down('Alt'); await page.waitForTimeout(250)
    const hints = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.iw-slot')].filter(e => !e.closest('.absolute.bottom-full'))
      return row.map(e => e.querySelector('span[aria-hidden="true"][class*="absolute"]')?.textContent ?? null)
    })
    check(`[${theme}] holding Alt reveals 1…6 on the row, in order`,
      JSON.stringify(hints) === JSON.stringify(['1','2','3','4','5','6']), JSON.stringify(hints))
    const shotAlt = await page.$('.iw-touch-guard.iw-nightable')
    if (shotAlt) await shotAlt.screenshot({ path: `${OUT}/hotkeys-${theme}.png` })
    await page.keyboard.up('Alt'); await page.waitForTimeout(250)
    const after = await page.evaluate(() => [...document.querySelectorAll('.iw-slot span[aria-hidden="true"][class*="absolute"]')].length)
    check(`[${theme}] releasing Alt hides them again — calm, not loud`, after === 0, `badges=${after}`)
  }

  // ── Screenshots, day AND night ───────────────────────────────────────────
  const footer = await page.$('.iw-touch-guard.iw-nightable')
  if (footer) await footer.screenshot({ path: `${OUT}/toolbar-${theme}.png` })
  await page.screenshot({ path: `${OUT}/full-${theme}.png` })
  console.log(`  → ${OUT}/toolbar-${theme}.png`)

  await ctx.close()
}

// ── RECONCILIATION WITH feat/prod-ledger, in the real app ────────────────────
// The ledger lane landed a row of 6-or-SEVEN (7 only with ?prodLedger). Peter has since re-settled
// the row at SIX — "it fits well on phone. And we want to keep the phone and desktop experience
// continuous". So the flag must add the clock to the POPULATION without widening the ROW.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => {
    localStorage.setItem('inkwave:theme', 'day')
    localStorage.setItem('inkwave:prodLedger', '1')
    localStorage.removeItem('inkwave-toolbar-slots')   // a first-run writer, with the flag on
  })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/?prodLedger=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 })
  await page.waitForTimeout(1200)

  const s = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.iw-slot')]
    const inPopup = (e) => !!e.closest('.absolute.bottom-full')
    return { row: all.filter(e => !inPopup(e)).length, overflow: all.filter(inPopup).length }
  })
  if (s.row + s.overflow === 0) check('[ledger] VOID — .iw-slot matched nothing', false)
  else {
    // The ledger lane PROBED that 7 + ▲ + ⋮ fit at 390px. They do — but Peter's ruling is that the
    // row does not widen for a feature, so the clock competes for a slot like everything else.
    check('[ledger] ?prodLedger does NOT widen the row — still six at 390px',
      s.row === 6, `row=${s.row} overflow=${s.overflow}`)
    check('[ledger] the clock joined the ▲ drawer instead of the row',
      s.overflow === 3, `overflow=${s.overflow} (page + clock + media)`)
  }
  await page.screenshot({ path: `${OUT}/ledger-390.png` })
  await ctx.close()
}


// ── MEDIA IMPORT, day and night ──────────────────────────────────────────────
// A FIRST-RUN writer (no stored row), because that is who has media in the row: Peter's first-run
// six names it. The curated-row cases above deliberately do NOT — the first cut of this block ran
// there, found the button in the CLOSED ▲ drawer, and failed as though the feature were missing.
for (const theme of ['day', 'night']) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(t => {
    localStorage.setItem('inkwave:theme', t)
    localStorage.removeItem('inkwave-toolbar-slots')
  }, theme)
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 })
  await page.waitForTimeout(1200)

  // MEDIA IMPORT — the lane landed, so the button must actually be there and open a real drop-up.
  const mediaBtn = await page.$('[title="Import a photo, audio or video"]')
  check(`[${theme}] the media-import button renders`, !!mediaBtn)
  if (mediaBtn) {
    await mediaBtn.click(); await page.waitForTimeout(350)
    const menu = await page.evaluate(() => {
      // It is PORTALED to body, so it must carry the guard classes itself — a nested panel
      // inherits them via closest(), a portaled one cannot.
      const p = [...document.querySelectorAll('.iw-touch-guard.iw-nightable')]
        .find(e => e.textContent?.includes('Photo') && e.textContent?.includes('Audio'))
      if (!p) return null
      const cs = getComputedStyle(p)
      const smallest = Math.min(...[...p.querySelectorAll('button, div')]
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(n => n > 0))
      return { guard: p.classList.contains('iw-touch-guard'), night: p.classList.contains('iw-nightable'), bg: cs.backgroundColor, smallest }
    })
    check(`[${theme}] the drop-up carries iw-touch-guard (iOS keyboard) + iw-nightable`,
      !!menu && menu.guard && menu.night, JSON.stringify(menu))
    // iOS auto-zooms (and STAYS zoomed) on controls under 16px. Going up is free; below is a trap.
    check(`[${theme}] nothing in the drop-up drops below the 16px iOS floor`,
      !!menu && menu.smallest >= 16, `smallest=${menu?.smallest}px`)
    const shot = await page.$('.iw-touch-guard.iw-nightable.fixed')
    if (shot) await shot.screenshot({ path: `${OUT}/media-${theme}.png` })
    await page.keyboard.press('Escape').catch(() => {})
    await page.mouse.click(5, 5)
    await page.waitForTimeout(250)
  }

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


  await ctx.close()
}

await browser.close()
cleanup()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
