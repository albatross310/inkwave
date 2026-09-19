// UI SNAPS — one screenshot per panel × viewport × theme, so a style refactor has a BEFORE and an
// AFTER to diff. Lambert, 2026-09-18. Dev-only tooling; never runs in CI.
//
//   node scripts/ui-snaps.mjs [--base http://localhost:5195] [--out DIR] [--only settings,guide]
//
// Each panel is opened by its trigger's title/aria-label. A slot that is not on the toolbar row is
// looked for inside the ▲ drawer. Missing panels are reported, never fatal: the run's value is the
// set of pictures it DID take.
import { chromium, devices } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://localhost:5195')
const OUT = arg('--out', join(process.cwd(), '.ui-snaps', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')))
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean)

// Openers: [id, {title | label | role}] — the trigger's accessible name.
const PANELS = [
  ['settings', { title: 'Settings' }],
  ['options', { label: 'Options' }],
  ['page', { title: 'Page settings' }],
  ['guide', { title: 'Guide' }],
  ['math', { title: 'Insert math' }],
  ['media', { title: /^Import a photo/ }],
  ['citations', { title: /^Bibliography/ }],
  ['receipt', { title: /^Provenance record/ }],
  ['sync', { name: /Save to folder|Sync status/ }],
  ['clock', { title: /^Pomodoro/ }],
  ['style', { title: 'Style' }],
  ['review', { title: /^Review/ }],
  ['music', { title: /^Music/ }],
  ['drawer', { title: 'Customise toolbar' }],
]

const VIEWPORTS = [
  { id: 'd1440', viewport: { width: 1440, height: 900 } },
  { id: 'd1024', viewport: { width: 1024, height: 768 } },
  { id: 't768', viewport: { width: 768, height: 1024 } },
  { id: 'p390', ...devices['iPhone 12'] },
]
const THEMES = ['day', 'night']

function locate(page, o) {
  if (o.title) return page.getByTitle(o.title, { exact: typeof o.title === 'string' }).first()
  if (o.label) return page.getByLabel(o.label, { exact: true }).first()
  return page.getByRole('button', { name: o.name }).first()
}

async function openPanel(page, o) {
  // A drawer slot is in the DOM but folded away, so a plain click times out. Try the row first
  // (short timeout), then open the ▲ drawer and try once more.
  const t = locate(page, o)
  if (await t.click({ timeout: 2500 }).then(() => true, () => false)) { await page.waitForTimeout(450); return true }
  const drawer = page.getByTitle('Customise toolbar').first()
  if (!(await drawer.click({ timeout: 2500 }).then(() => true, () => false))) return false
  await page.waitForTimeout(400)
  if (!(await locate(page, o).click({ timeout: 2500 }).then(() => true, () => false))) return false
  await page.waitForTimeout(450)
  return true
}

async function closeAll(page) {
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)   // tap-away on the water
  await page.waitForTimeout(250)
}

const browser = await chromium.launch()
const report = []
for (const vp of VIEWPORTS) for (const theme of THEMES) {
  const ctx = await browser.newContext({ ...vp, colorScheme: theme === 'night' ? 'dark' : 'light' })
  await ctx.addInitScript(th => { try { localStorage.setItem('inkwave:theme', th) } catch {} }, theme)
  const page = await ctx.newPage()
  page.on('pageerror', e => report.push({ vp: vp.id, theme, panel: '*', err: String(e).slice(0, 120) }))
  await page.goto(`${BASE}/?seed=fresh`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)   // the load reveal
  const dir = join(OUT, `${vp.id}-${theme}`); mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, '00-editor.png') })
  for (const [id, opener] of PANELS) {
    if (ONLY.length && !ONLY.includes(id)) continue
    let ok = false
    try { ok = await openPanel(page, opener) } catch (e) { report.push({ vp: vp.id, theme, panel: id, err: String(e).slice(0, 120) }) }
    if (ok) await page.screenshot({ path: join(dir, `${id}.png`) })
    report.push({ vp: vp.id, theme, panel: id, shot: ok })
    await closeAll(page)
  }
  await ctx.close()
}
await browser.close()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const missed = report.filter(r => r.shot === false).map(r => `${r.vp}/${r.theme}/${r.panel}`)
const errs = report.filter(r => r.err)
console.log(`snaps → ${OUT}`)
console.log(`taken: ${report.filter(r => r.shot).length}  missed: ${missed.length}${missed.length ? '\n  ' + missed.join('\n  ') : ''}`)
if (errs.length) console.log(`page errors: ${errs.length}\n  ` + errs.map(e => `${e.vp}/${e.theme}/${e.panel}: ${e.err}`).join('\n  '))
