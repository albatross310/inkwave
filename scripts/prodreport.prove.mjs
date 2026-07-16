// PRODUCTIVITY REPORT PROVER (2026-07-17) — drives the real built app, because a flag-gated
// feature that silently does nothing looks exactly like a feature that works (CLAUDE.md's house
// disease: the gate that returned false for months).
//
// Every assertion below is paired with a KNOWN-NEGATIVE that must reproduce the opposite result
// in the same run — a probe that only ever sees the happy path is an instrument that cannot fail.
//
//   node scripts/prodreport.prove.mjs [port]     (default 4933 — OUR port; never pkill another's)
import { chromium } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'

const PORT = Number(process.argv[2] || 4933)
const ROOT = new URL('../build/client/', import.meta.url).pathname
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}

// Fallback-faithful static server: '/' serves the PRERENDERED editor page, as production does.
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = join(ROOT, decodeURIComponent(url.pathname))
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
  if (!existsSync(p)) p = join(ROOT, 'index.html')
  res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream')
  res.end(readFileSync(p))
})

const results = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ name, ok, got, want })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`)
}

const REPLY = `## Narrative

A week with a centre to it. You spent 92 active minutes on the seminar paper on Monday, and
Wednesday carried the most writing. Thursday you were away from it, and that is fine.

\`\`\`csv
day,phase,effort,momentum,note
2026-07-06,deep,steady,building,"a full morning on the seminar paper"
2026-07-07,shallow,light,easing,"a short evening, mostly cutting"
2026-07-08,deep,intense,building,the week's strongest stretch
2026-07-09,unclear,unclear,holding,a day away from it
2026-07-10,shallow,steady,easing,editing rather than drafting
\`\`\``

async function openPanel(page, flag) {
  await page.goto(`http://localhost:${PORT}/?prodReport=${flag}`, { waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  // Wait out the reveal/coast: the wave surfaces sit over the chrome until wave-rest, so a real
  // .click() lands on the water. Dispatch directly instead — we are probing the report, not the
  // toolbar's hit-testing.
  await page.waitForTimeout(2500)
  const opened = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Options"]')
    if (!b) return false
    b.click()
    return true
  })
  if (!opened) throw new Error('Options button not found')
  await page.waitForTimeout(500)
  const present = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role=menuitem], div, span')]
      .find(e => e.childElementCount === 0 && e.textContent.trim() === 'Work report')
    if (el) el.click()
    return !!el
  })
  await page.waitForTimeout(700)
  return present
}

;(async () => {
  await new Promise(r => server.listen(PORT, r))
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  page.on('pageerror', e => console.log('  [pageerror]', e.message))

  try {
    // ── KNOWN-NEGATIVE FIRST: with the flag OFF the feature must not exist at all ──
    const offHasItem = await openPanel(page, 'off')
    check('flag OFF (default): no "Work report" menu item', offHasItem, false)
    check('flag OFF: no panel in the DOM', await page.locator('[aria-label="Work report"]').count(), 0)

    // ── The real drive ──
    const onHasItem = await openPanel(page, 'demo')
    check('flag=demo: the menu item exists (the gate DISCRIMINATES)', onHasItem, true)
    const panel = page.locator('[aria-label="Work report"]')
    check('flag=demo: the panel opened', await panel.count(), 1)
    check('demo banner is shown (synthetic data can never pass as measured)',
      (await panel.innerText()).includes('synthetic sample data'), true)

    // Tier 1 baseline + tier 2/3 default OFF, read off the REAL checkboxes.
    const ticked = await panel.locator('input[type=checkbox]:checked').count()
    check('every consent tick starts OFF (tiers 2 and 3)', ticked, 0)

    // The prompt is VISIBLE before anything is copied (§A7.1.2).
    await panel.locator('text=Show the fixed prompt').click()
    await page.waitForTimeout(250)
    const shown = await panel.locator('pre').first().innerText()
    check('fixed prompt is shown verbatim, incl. the non-shaming rule',
      shown.includes('a hard rule, not a preference'), true)
    check('fixed prompt states the weekly pattern-claim licence',
      shown.includes('genuine pattern claims'), true)
    check('fixed prompt asks for the exact header', shown.includes('day,phase,effort,momentum,note'), true)

    // ── THE LEAK CHECK, in the real UI ──
    await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {}))
    const readPayload = async () => {
      await panel.locator('text=Copy the prompt').click()
      await page.waitForTimeout(400)
      return page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
    }
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const noTicks = await readPayload()
    check('default payload carries the MEASURED rollups', noTicks.includes('active_minutes'), true)
    check('default payload carries NO diary note', noTicks.includes('Finally got the third step'), false)
    check('default payload carries NO place label', /\blibrary\b/.test(noTicks), false)
    check('default payload carries NO document text', noTicks.includes('The argument so far runs'), false)

    // Tick tier 2 only.
    await panel.locator('input[type=checkbox]').first().check()
    await page.waitForTimeout(200)
    const withNotes = await readPayload()
    check('tier 2 ticked → the diary note travels', withNotes.includes('Finally got the third step'), true)
    check('tier 2 ticked → the place label travels', withNotes.includes('library'), true)
    check('tier 2 ticked → document text still does NOT', withNotes.includes('The argument so far runs'), false)

    // ── Paste-back → parse → merge → graph ──
    await panel.locator('textarea').last().fill(REPLY)
    await page.waitForTimeout(150)
    await panel.locator('text=Read the reply').click()
    await page.waitForTimeout(600)
    const txt = await panel.innerText()
    check('narrative rendered and labelled as an assessment',
      txt.includes('AI assessment') && txt.includes('A week with a centre to it'), true)
    check('measured/judged legend is present (§A6.1)',
      txt.includes('Measured by Inkwave') && txt.includes('interpretation, not measurement'), true)
    check('no parse failure on a good reply', txt.includes("Couldn't read the table"), false)
    check('judged overlay bars rendered, one per judged day',
      await panel.locator('[title^="AI assessment:"]').count(), 5)
    check('measured bars rendered from Inkwave\'s own numbers',
      await panel.locator('[title$="active minutes (measured)"]').count(), 5)
    check('the 92 in the narrative is NOT flagged (Inkwave sent it)',
      txt.includes("Numbers Inkwave can't confirm"), false)

    // ── KNOWN-NEGATIVE: a lying reply must be caught in the real UI ──
    await panel.locator('textarea').last().fill(REPLY.replace('92 active minutes', '900 active minutes'))
    await panel.locator('text=Read the reply').click()
    await page.waitForTimeout(500)
    const lying = await panel.innerText()
    check('an invented number IS flagged', lying.includes("Numbers Inkwave can't confirm") && lying.includes('900'), true)
    const bars = await panel.locator('[title$="active minutes (measured)"]').first().getAttribute('title')
    check('...and the measured bar is UNMOVED by the lie (§A6.4)', bars, '92 active minutes (measured)')

    // ── KNOWN-NEGATIVE: a wrong-header table must be refused in the real UI ──
    await panel.locator('textarea').last().fill(REPLY.replace('day,phase,effort,momentum,note', 'day,active_minutes,vibe'))
    await panel.locator('text=Read the reply').click()
    await page.waitForTimeout(500)
    const bad = await panel.innerText()
    check('wrong-header table is REFUSED, with the format shown', bad.includes("Couldn't read the table"), true)
    check('...naming the measured-column reason (§A6.4)', bad.includes('never takes them back'), true)
    check('...and the narrative is NOT thrown away (§A9)', bad.includes('A week with a centre to it'), true)
  } catch (e) {
    console.log('\n  PROBE THREW:', e.message)
    results.push({ name: 'probe completed', ok: false })
  }

  await browser.close()
  server.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
})()
