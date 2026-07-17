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

const NARRATIVE = `## Narrative

A week with a centre to it. You spent 92 active minutes on the seminar paper on Monday, and
Wednesday carried the most writing. Thursday you were away from it, and that is fine.`

const CSV = `day,phase,effort,momentum,character,note
2026-07-06,deep,steady,building,steady,"a full morning on the seminar paper"
2026-07-07,shallow,light,easing,grind,"a short evening, mostly cutting"
2026-07-08,deep,intense,building,breakthrough,the week's strongest stretch
2026-07-09,unclear,unclear,holding,away,a day away from it
2026-07-10,shallow,steady,easing,scattered,editing rather than drafting`

const REPLY = NARRATIVE + '\n\n\`\`\`csv\n' + CSV + '\n\`\`\`'

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

    // Every consent tick default OFF, read off the REAL checkboxes. FIVE rows now (Peter split
    // notes from places, and §A5b added goals) — assert the COUNT too, or a row that silently
    // vanished would leave this passing.
    const boxes = await panel.locator('input[type=checkbox]').count()
    check('five consent rows exist (notes | places | goals | 2 docs)', boxes >= 5, true)
    const ticked = await panel.locator('input[type=checkbox]:checked').count()
    check('EVERY consent tick starts OFF', ticked, 0)

    // The prompt is VISIBLE before anything is copied (§A7.1.2).
    await panel.locator('text=Show the fixed prompt').click()
    await page.waitForTimeout(250)
    const shown = await panel.locator('pre').first().innerText()
    // §A5 REVERSED (2026-07-17): honest first, funny second, kind third.
    check('fixed prompt carries the REVERSED tone rule',
      shown.includes('TONE — honest first, funny second, kind third'), true)
    check('...and the superseded kind/non-shaming rule is GONE',
      shown.includes('a hard rule, not a preference'), false)
    check('fixed prompt states the imposed-vs-set distinction (§A5\'s whole safety argument)',
      shown.includes('Accountability is measuring the writer against a goal THEY SET'), true)
    check('§A5b: with no goals ticked, the prompt says DESCRIBE, DO NOT PUSH',
      shown.includes('NO GOALS WERE SHARED'), true)
    // §A6.2 RELAXED (Peter, 2026-07-17): hazard guesses, don't commit. The hedge is the line.
    check('weekly prompt invites hunches, tethered to the window\'s evidence',
      shown.includes('Guess out loud here too, and suggest things'), true)
    check('...and refuses a suggestion it cannot ground (a hedge does not launder a standard)',
      shown.includes('A suggestion you cannot ground is a standard the writer never set'), true)
    check('fixed prompt states the weekly pattern-claim licence',
      shown.includes('genuine pattern claims'), true)
    check('fixed prompt asks for the exact header',
      shown.includes('day,phase,effort,momentum,character,note'), true)

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

    // ── The tier-2 SPLIT, in the real UI (Peter: "separate session notes from places") ──
    const boxAt = i => panel.locator('input[type=checkbox]').nth(i)   // 0 notes, 1 places, 2 goals
    await boxAt(0).check()
    await page.waitForTimeout(200)
    const withNotes = await readPayload()
    check('notes ticked → the diary note travels', withNotes.includes('Finally got the third step'), true)
    check('notes ticked → the place does NOT (the boxes are independent)',
      /\blibrary\b/.test(withNotes), false)
    check('notes ticked → the payload SAYS the places are absent',
      withNotes.includes('did NOT share their place labels'), true)
    check('notes ticked → document text still does NOT', withNotes.includes('The argument so far runs'), false)

    await boxAt(0).uncheck()
    await boxAt(1).check()
    await page.waitForTimeout(200)
    const withPlaces = await readPayload()
    check('places ticked → the place travels', /\blibrary\b/.test(withPlaces), true)
    check('places ticked → the diary note does NOT',
      withPlaces.includes('Finally got the third step'), false)

    // ── §A5b goals, in the real UI ──
    await boxAt(2).check()
    await page.waitForTimeout(200)
    const withGoals = await readPayload()
    check('goals ticked → the writer\'s goal travels',
      withGoals.includes('publishable 6,000-word seminar paper'), true)
    check('goals ticked → the prompt now says to hold them to it',
      withGoals.includes('THIS is what you hold them to'), true)
    check('goals ticked → the no-goal branch is GONE (no self-contradiction)',
      withGoals.includes('NO GOALS WERE SHARED'), false)
    await boxAt(2).uncheck()
    await boxAt(1).uncheck()
    await page.waitForTimeout(200)

    // ── THE TYPE RAMP (Peter: "the entire text font of the panel needs to be increased…
    //    Every font proportionally up"). Read the COMPUTED sizes off the live DOM: a class
    //    that looks bigger in the source proves nothing about what renders. ──
    const fonts = await page.evaluate(() => {
      const p = document.querySelector('[aria-label="Work report"]')
      const px = el => el ? parseFloat(getComputedStyle(el).fontSize) : 0
      const bodyP = [...p.querySelectorAll('p')].find(e => e.textContent.includes('Inkwave compiles'))
      return {
        root: px(p),
        body: px(bodyP),
        minInput: Math.min(...[...p.querySelectorAll('textarea, input[type=text]')].map(px)),
        title: px([...p.querySelectorAll('div')].find(e => e.textContent === 'How you worked')),
      }
    })
    check('panel root is the 18px ramp anchor', fonts.root, 18)
    check('body copy scaled up from the old 14px', fonts.body >= 17, true)
    check('title scaled proportionally, not left behind', fonts.title >= 22, true)
    // iOS auto-zooms — and STAYS zoomed — on a focused control under 16px.
    check('every text input clears the 16px iOS floor', fonts.minInput >= 16, true)

    // ── THE LEDGER+DOC COMBO: session → the prose it produced (daily + content ticked) ──
    await panel.locator('text=Day').first().click()
    await page.waitForTimeout(700)
    const docBox = panel.locator('input[type=checkbox]').nth(3)   // first document row
    await docBox.check()
    await page.waitForTimeout(250)
    const daily = await readPayload()
    // SCOPE TO THE DATA, NOT THE PAYLOAD. Every heading here appears TWICE — the fixed prompt
    // explains each section and the data carries it — so `payload.includes('WHAT EACH SESSION
    // PRODUCED')` is true whenever the PROMPT mentions it, feature working or not. Proved: with
    // the section suppressed, the unscoped checks stayed green and only the scoped ones fired.
    const dailyData = daily.split('DATA — measured by Inkwave').pop() ?? ''
    check('daily+content → the payload pairs each session with what it produced',
      dailyData.includes('WHAT EACH SESSION PRODUCED'), true)
    // SCOPED to the excerpts section, deliberately: the same sentence also appears in the
    // DOCUMENT TEXT section, so an unscoped `daily.includes(...)` would pass with the pairing
    // completely broken — a check that cannot fail. Read only what sits after the section head.
    // NB the phrase appears TWICE — the fixed PROMPT explains the section, and the DATA carries
    // it. Splitting on the first occurrence reads the prompt's copy and finds none of the prose;
    // take the LAST. (Caught by this check failing once it was scoped correctly.)
    const exSection = dailyData.split('WHAT EACH SESSION PRODUCED')[1] ?? ''
    check('...carrying the prose the snapshot record says appeared in that session',
      exSection.includes('the middle case is genuinely excluded'), true)
    check('...and NOT the text that predates the session (the baseline rule holds live)',
      exSection.includes('--- s-1') && !exSection.split('--- s-1')[1].split('\n---')[0]
        .includes('The argument so far runs in three steps.'), true)
    check('...and a session the record cannot speak for says so, rather than reading as "nothing"',
      exSection.includes('That is a gap in the record, NOT the writer doing nothing'), true)
    check('§A6.1 daily+content asks for the quality columns',
      daily.includes('session_id,phase,effort,insight,quality,note'), true)
    await docBox.uncheck()
    await page.waitForTimeout(250)
    const dailyNoContent = await readPayload()
    check('§A6.1 daily WITHOUT content does NOT ask for a quality verdict',
      dailyNoContent.includes('insight,quality'), false)
    check('...and no excerpt travels without the content tick (§A7.3 gates every word)',
      (dailyNoContent.split('DATA — measured by Inkwave').pop() ?? '')
        .includes('WHAT EACH SESSION PRODUCED'), false)
    await panel.locator('text=Week').first().click()
    await page.waitForTimeout(700)
    // A window change RESETS every tick and the compiled payload (consent is given for a payload,
    // and a new window is a new payload), so the paste boxes only exist once it is recompiled.
    await readPayload()

    // ── Paste-back → parse → merge → graph ──
    // TWO paste boxes now: [0] the user prompt, [1] the report, [2] the table.
    const reportBox = () => panel.locator('textarea').nth(1)
    const tableBox = () => panel.locator('textarea').nth(2)
    await reportBox().fill(REPLY)
    await page.waitForTimeout(150)
    await panel.locator('text=Read it back').click()
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

    // ── §A6.2, THE MOVED LINE, in the real UI. The pair is the point: the same claim hedged and
    //    unhedged must come out differently on the DAILY window, or the hedge is doing nothing. ──
    await panel.locator('text=Day').first().click()
    await page.waitForTimeout(700)
    await readPayload()
    const dailyCsv = 'session_id,phase,effort,note\ns-1,deep,steady,a settled opening stretch\n'
      + 's-2,mixed,steady,slower\ns-4,unclear,unclear,no record\ns-3,shallow,light,a few lines'
    const dailyReply = h => `## Narrative\n\nA steady morning. ${h}\n\n\`\`\`csv\n${dailyCsv}\n\`\`\``
    const readDaily = async h => {
      await panel.locator('textarea').nth(1).fill(dailyReply(h))
      await panel.locator('text=Read it back').click()
      await page.waitForTimeout(500)
      return panel.innerText()
    }
    const hedged = await readDaily('The break maybe helped, and you could have taken more breaks.')
    check('a HEDGED guess is NOT flagged — it is what Peter asked for',
      hedged.includes('stating a cause as fact'), false)
    const bare = await readDaily('The break helped.')
    check('...and the SAME claim unhedged IS flagged', bare.includes('stating a cause as fact'), true)
    check('...with copy that says hunches are welcome, not that causes are banned',
      bare.includes('Hunches are welcome'), true)
    await panel.locator('text=Week').first().click()
    await page.waitForTimeout(700)
    await readPayload()
    await reportBox().fill(REPLY)
    await panel.locator('text=Read it back').click()
    await page.waitForTimeout(500)

    // ── The SPLIT paste: narrative in one box, bare CSV in the other (the copy-code button) ──
    await reportBox().fill(NARRATIVE)
    await tableBox().fill(CSV)
    await panel.locator('text=Read it back').click()
    await page.waitForTimeout(600)
    const split = await panel.innerText()
    check('a bare, UNFENCED csv pasted into the table box is read',
      split.includes("Couldn't read the table"), false)
    check('...and the split paste still renders the narrative',
      split.includes('A week with a centre to it'), true)
    check('...and still merges the judged rows',
      await panel.locator('[title^="AI assessment:"]').count(), 5)

    // ── KNOWN-NEGATIVE: a lying reply must be caught in the real UI ──
    await tableBox().fill('')
    await reportBox().fill(REPLY.replace('92 active minutes', '900 active minutes'))
    await panel.locator('text=Read it back').click()
    await page.waitForTimeout(500)
    const lying = await panel.innerText()
    check('an invented number IS flagged', lying.includes("Numbers Inkwave can't confirm") && lying.includes('900'), true)
    const bars = await panel.locator('[title$="active minutes (measured)"]').first().getAttribute('title')
    check('...and the measured bar is UNMOVED by the lie (§A6.4)', bars, '92 active minutes (measured)')

    // ── KNOWN-NEGATIVE: a wrong-header table must be refused in the real UI ──
    await reportBox().fill(
      REPLY.replace('day,phase,effort,momentum,character,note', 'day,active_minutes,vibe'))
    await panel.locator('text=Read it back').click()
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
