// Screenshots of the productivity panel in DAY and NIGHT, at each report window.
//
// Headless (a static SVG panel needs no GPU fidelity) against `vite preview` on a DEDICATED PORT —
// never pkill anything, never pop a window on Peter's screen (CLAUDE.md standing preferences).
//
// Usage: node scripts/prod-graphs-shots.mjs [port]

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.argv[2] ?? '4181'
const OUT = '/tmp/prod-graphs-shots'
mkdirSync(OUT, { recursive: true })

const WINDOWS = [
  ['week', 'This week'],
  ['day', 'Today'],
  ['month', 'This month'],
]

const browser = await chromium.launch()
const results = []

for (const theme of ['day', 'night']) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 })
  // Seed the theme + the sticky feature flag BEFORE any app code runs.
  await ctx.addInitScript(t => {
    localStorage.setItem('inkwave:theme', t)
    localStorage.setItem('inkwave:prodGraphs', '1')
    localStorage.setItem('inkwave:prodGraphsDemo', '1')
  }, theme)

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(`http://localhost:${PORT}/productivity?prodGraphs=demo`, { waitUntil: 'networkidle' })
  // The panel is behind a lazy chunk + an async fixture import.
  await page.waitForSelector('.iw-nightable', { timeout: 15000 })
  await page.waitForTimeout(400)

  // Assert the theme attribute EXPLICITLY, exactly as the Settings toggle does (theme.ts:
  // setNightMode → applyTheme → documentElement.dataset.theme). entry.client's pre-hydration
  // applyTheme() does not survive here: React 18 hydration recovery strips <html> attributes (the
  // failure entry.client.tsx:100 documents), and this build throws hydration errors on EVERY route
  // — /about and /verify included, 28 apiece — so it is pre-existing and not this lane's. Setting
  // the attribute is faithful: the night palette is a pure CSS function of `data-theme`.
  await page.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
  await page.waitForTimeout(250)

  // PROVE THE THEME ACTUALLY APPLIED. A screenshot pair that silently rendered the same theme twice
  // would look like "night mode works" — the exact class of failure this codebase keeps hitting.
  const applied = await page.evaluate(() => document.documentElement.dataset.theme)
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.iw-nightable')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  const ink = await page.evaluate(() => {
    const el = document.querySelector('.iw-nightable')
    return el ? getComputedStyle(el).getPropertyValue('--iw-ink').trim() : null
  })

  for (const [w, label] of WINDOWS) {
    await page.getByRole('tab', { name: label }).click()
    await page.waitForTimeout(250)
    const file = `${OUT}/${theme}-${w}.png`
    await page.locator('.iw-nightable').screenshot({ path: file })
    results.push({ theme, window: w, file })
  }

  results.push({ theme, applied, panelBg: bg, inkToken: ink, errors })
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
