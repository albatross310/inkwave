// feat/music-layer PROBE (2026-07-18) — renders the music BAR + PANEL over the editor, day+night.
// Drives the REAL built app: the ♪ slot opens the music bar; its buttons open MusicPanel /
// MusicStudio as a PANEL over the editor (the /music route is retired). Own port; headless.
//   node scripts/musiclayer.prove.mjs [port]
import { chromium } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { join, extname } from 'path'

const PORT = Number(process.argv[2] || 4947)
const ROOT = new URL('../build/client/', import.meta.url).pathname
const OUT = '/tmp/claude-0/-root/b3be5b00-ed90-4c91-a7a0-16b6ca3a69df/scratchpad'
mkdirSync(OUT, { recursive: true })
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.ico':'image/x-icon','.webmanifest':'application/manifest+json' }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = join(ROOT, decodeURIComponent(url.pathname))
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
  if (!existsSync(p)) p = join(ROOT, 'index.html')
  res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream')
  res.end(readFileSync(p))
})
await new Promise(r => server.listen(PORT, r))
const browser = await chromium.launch()
const results = []
const check = (name, ok, extra='') => { results.push({ name, ok }); console.log(`  ${ok?'PASS':'FAIL'}  ${name}${extra&&!ok?`  ${extra}`:''}`) }

async function openBar(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } })
  await ctx.addInitScript((t) => {
    window.__iwMusic = true               // graduate-independent: force the module on for the probe
    try {
      localStorage.setItem('inkwave:theme', t)
      // Put the ♪ slot directly in the row so the probe clicks it without walking the ▲ drawer.
      localStorage.setItem('inkwave-toolbar-slots', JSON.stringify(['music','page','style','guide','settings','media']))
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 15000 })
  await page.waitForTimeout(800)
  return { ctx, page }
}

try {
  for (const theme of ['day', 'night']) {
    console.log(`\n▸ ${theme}`)
    const { ctx, page } = await openBar(theme)

    // The ♪ slot exists and opens the music bar.
    const slot = await page.$('[data-iw-bar="music"]')
    check(`${theme}: ♪ music slot renders`, !!slot)
    await slot.click()
    // The music BAR body (feat/music-layer) — the "♪ music" label + the two real buttons.
    await page.waitForSelector('text=Import a score', { timeout: 8000 })
    const hasStudioBtn = await page.$('text=Score studio')
    check(`${theme}: music bar shows "Score studio" + "Import a score"`, !!hasStudioBtn)
    check(`${theme}: no dead "Add YouTube / MP3" pill ships`, !(await page.$('text=Add YouTube')))
    await page.screenshot({ path: join(OUT, `musicbar-${theme}.png`) })

    // Open the MusicXML import PANEL over the editor (build item #2). WAIT for the lazy chunk to
    // replace the "Opening your score…" Suspense fallback with the real MusicPanel content.
    await page.click('text=Import a score')
    const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
    check(`${theme}: MusicXML import panel opens over the editor`, !!dialog)
    let xmlOk = false
    try { await page.waitForSelector('text=/Sibelius|MuseScore|Dorico|public-domain/i', { timeout: 15000 }); xmlOk = true } catch {}
    check(`${theme}: panel is the real MusicPanel (lazy chunk loaded)`, xmlOk,
      xmlOk ? '' : (await dialog.innerText()).slice(0, 120))
    await page.screenshot({ path: join(OUT, `musicpanel-xml-${theme}.png`) })

    // Close, then open the STUDIO panel — on a fresh PROSE doc it honestly says "not a score".
    await page.click('[role="dialog"] button[aria-label="Close"]')
    await page.waitForTimeout(300)
    await page.click('text=Score studio')
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
    let studioOk = false
    try { await page.waitForSelector("text=/isn.t a score/i", { timeout: 15000 }); studioOk = true } catch {}
    check(`${theme}: studio panel opens; honest state on a non-score document`, studioOk)
    await page.screenshot({ path: join(OUT, `musicstudio-${theme}.png`) })

    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log(`screenshots → ${OUT}/music{bar,panel-xml,studio}-{day,night}.png`)
process.exit(failed.length ? 1 : 0)
