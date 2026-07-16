// Does the iOS debug script RUN, and can it go RED? Peter is about to run this on his phone; a
// script that silently no-ops, or that cannot fail, is worse than no script.
// Chromium here proves the FLOW + the negative. It cannot prove the iOS worker branch (Chromium has
// createWritable) — that is the whole point of shipping it to his device.
import { chromium } from '@playwright/test'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4295}`
const browser = await chromium.launch({ headless: true })

async function run(label, sabotage) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }) // iPhone-ish
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 120)))
  if (sabotage) await page.addInitScript(sabotage)
  await page.goto(`${BASE}/?btDebug=1`, { waitUntil: 'domcontentloaded' })
  // Phase 1 → auto-reload → phase 2. Wait for a terminal verdict.
  await page.waitForFunction(() => {
    const el = document.querySelector('#iw-btdebug div')
    return el && (el.textContent === 'PASS' || el.textContent === 'FAIL')
  }, null, { timeout: 90000 }).catch(() => {})
  const out = await page.evaluate(() => {
    const root = document.getElementById('iw-btdebug')
    if (!root) return { verdict: 'NO OVERLAY — the script never ran' }
    const verdict = root.querySelector('div')?.textContent
    const rows = [...root.querySelectorAll('div')].map((d) => d.textContent || '').filter((t) => /^[✓✕·]/.test(t.trim()))
    return { verdict, rows }
  })
  console.log(`\n${label}\n  VERDICT: ${out.verdict}`)
  for (const r of out.rows || []) console.log(`    ${r.replace(/\s+/g, ' ').slice(0, 96)}`)
  await ctx.close()
  return out
}

const ok = await run('① NORMAL RUN (must PASS, and prove the flow works)', null)

// ② SABOTAGE: make the signature un-reproducible across the reload — i.e. re-introduce BUG 1.
// The script MUST catch it. If this still says PASS, the script cannot see the very bug it exists
// to detect and it is decoration.
const bad = await run('② SABOTAGED (bug 1 re-introduced: signature made session-dependent) — must FAIL', () => {
  const k = 'inkwave:btDebug:expect'
  const orig = localStorage.getItem.bind(localStorage)
  localStorage.getItem = (n) => {
    const v = orig(n)
    if (n === k && v) { const j = JSON.parse(v); j.sig = j.sig + '|SESSION-DRIFT'; return JSON.stringify(j) }
    return v
  }
})

console.log('\n──────────────────────────────────────────────')
const pass = ok.verdict === 'PASS'
const red = bad.verdict === 'FAIL'
console.log('normal run PASSES        :', pass)
console.log('sabotage turns it RED    :', red, red ? '(the script can fail — its PASS means something)' : '(⚠ THE SCRIPT CANNOT FAIL — it is decoration)')
await browser.close()
process.exit(pass && red ? 0 : 1)
