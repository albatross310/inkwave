// DOES THE DOCUMENT MOVE ON ITS OWN? Peter: "the doc keeps jumping down… it doesn't happen straight
// away… it's either on a timer or when something loads", reported with the editor IDLE while he read
// in the source panel. Scroll into a long paginated document, touch nothing, and watch scrollTop
// across the idle full re-measure.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const CONTROL = process.env.EXPECT_BROKEN === '1'
const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] })
const page = await b.newPage({ viewport: { width: 1500, height: 900 } })
try {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ProseMirror[contenteditable=true]', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const doc = buildCitationDoc({ words: 9000, cites: 60, id: 'jump-probe', headings: true, lists: true, refList: false })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => document.querySelectorAll('.inkwave-page-gap').length > 3, null, { timeout: 60000 })
  await page.waitForTimeout(6000)   // let the first measures settle

  const scroller = '.inkwave-editor-surface.iw-fill'
  // Park deep in the document — where a clamp has room to bite.
  const parked = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.72)
    window.__parked = el.scrollTop
    return el.scrollTop
  }, scroller)

  // A full measure must actually RUN in the window, or this proves nothing. Type one character to
  // schedule the scoped measure + the lazy full re-verify that follows it, then go idle.
  await page.evaluate(() => { window.__jumpSigs = []; const w = window
    setInterval(() => { const s = w.__iwPagSig; if (s && w.__jumpSigs.at(-1) !== s) w.__jumpSigs.push(s) }, 120) })
  await page.click('.ProseMirror[contenteditable=true]', { position: { x: 200, y: 200 } })
  await page.keyboard.type('x')
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = window.__parked }, scroller)
  const samples = []
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(700)
    samples.push(await page.evaluate((sel) => document.querySelector(sel).scrollTop, scroller))
  }
  const measures = await page.evaluate(() => (window.__iwPagChecked ?? 0))
  const sigs = await page.evaluate(() => (window.__jumpSigs || []).length)
  const parked2 = await page.evaluate(() => window.__parked)
  const worst = samples.reduce((m, v) => Math.max(m, Math.abs(v - parked2)), 0)
  console.log(`distinct pagination signatures seen during the idle window: ${sigs} (checked=${measures})`)
  // ⚠ THE VOID USED TO BE OVERWRITTEN BY THE VERDICT TWO LINES DOWN, and it inverted the meaning
  // of a passing run. A window in which NO pagination measure fired also cannot DRIFT — worst is 0,
  // `ok` is true, and the old unconditional `process.exitCode = …` on the last line then scored
  // "nothing ran" as PASS. The precondition this probe declares load-bearing was unenforceable, and
  // the run that proved least looked exactly like the run that proved most. Return instead.
  console.log(`parked at ${parked}px`)
  console.log(`samples : ${samples.join(', ')}`)
  console.log(`worst drift while IDLE: ${worst}px`)
  if (sigs === 0) {
    console.log('\nVOID — no pagination measure ran in the window, so idle drift was never at risk.')
    process.exitCode = 2
  } else {
    const ok = worst <= 2
    console.log(ok ? '\nPASS — the document stayed put.' : `\nFAIL — it moved ${worst}px on its own.`)
    process.exitCode = CONTROL ? (ok ? 1 : 0) : (ok ? 0 : 1)
  }
} finally { await b.close(); await stop() }
