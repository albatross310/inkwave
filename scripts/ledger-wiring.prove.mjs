// PROVE THE WIRING FIRES — the productivity ledger's capture tap, in the real app.
//
// WHY THIS EXISTS: the tap is flag-gated and DEFAULT OFF. That is exactly the shape CLAUDE.md warns
// about — a gate that silently disables a feature, whose absence looks identical to the feature not
// being needed (canvasShapingMatchesEditor returned false for months). The unit tests prove the
// capture ENGINE; only this proves the editor's onTransaction actually reaches it, that the flag
// turns it on, and that a row lands in OPFS with real numbers.
//
// It carries its OWN known-negative: the same typing with the flag OFF must produce NO ledger file.
// A probe that only ever runs the positive case cannot tell "it works" from "it always writes".
//
// Usage: node scripts/ledger-wiring.prove.mjs [port]   (headless; needs `pnpm build` first)
//   Serves build/client on its OWN port and kills only its own PID (shared-box rule).

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] ?? 4736)
const TITLE_LINE = 'Ledger probe title'
const BODY_PROSE = 'kierkegaard on repetition and recollection'
const URL = `http://127.0.0.1:${PORT}/`

// Fallback-faithful static server: /ledger etc. must fall back to the SPA shell.
const server = spawn('npx', ['vite', 'preview', '--outDir', 'build/client', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'ignore', detached: false,
})
const stopServer = () => { try { server.kill('SIGTERM') } catch { /* already gone */ } }
process.on('exit', stopServer)

/**
 * THE SHARED-BOX TRAP, and it cost real time here: several agents run previews on this machine. If
 * our port is already held, `--strictPort` kills OUR server and every request silently lands on
 * SOMEONE ELSE'S Inkwave build — which types fine and has no ledger code, so the probe reports a
 * confident, totally fictional "the wiring never fires". An instrument that cannot tell whose app
 * it is measuring reports fiction. So: assert the server is serving OUR OWN freshly-built asset
 * before reading a single number, and never `pkill -f "vite preview"` (that kills other agents).
 */
async function assertServerIsOurs() {
  // Find OUR chunk by CONTENT, not by filename: the flag module has already been renamed once
  // (flags.ts → ledgerFlag.ts), which silently changes the chunk name. Content is the invariant.
  const dir = 'build/client/assets'
  const mine = readdirSync(dir).filter(
    (f) => f.endsWith('.js') && readFileSync(`${dir}/${f}`, 'utf8').includes('inkwave:prodLedger'),
  )
  if (mine.length !== 1) {
    throw new Error(`expected exactly ONE built chunk containing 'inkwave:prodLedger', found ${mine.length} — run \`pnpm build\``)
  }
  // POLL for readiness — vite preview + the react-router plugin take several seconds to bind, and a
  // fixed sleep that expires early looks exactly like "the server is not ours".
  let res = null
  for (let i = 0; i < 60; i++) {
    res = await fetch(`${URL}assets/${mine[0]}`).catch(() => null)
    if (res && res.ok) break
    await sleep(1000)
  }
  if (!res || !res.ok) {
    throw new Error(
      `port ${PORT} is NOT serving this worktree's build (${mine[0]} → ${res ? res.status : 'no response'}).\n` +
      `Another agent almost certainly holds the port. Re-run with a free one: node scripts/ledger-wiring.prove.mjs <port>`,
    )
  }
  const body = await res.text()
  if (!body.includes('inkwave:prodLedger')) throw new Error('served flags chunk lacks the ledger flag — stale build?')
  console.log(`✓ server on ${PORT} is serving THIS worktree's build (${mine[0]})`)
}

async function typeInEditor(page, chars) {
  for (const c of chars) {
    await page.keyboard.type(c)
    await sleep(12) // a human-ish cadence; well inside one session
  }
}

/** Read the ledger straight out of OPFS — the writer's own storage, where it must actually be. */
async function readLedgerFromOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const out = []
    for await (const [name] of root.entries()) if (name.startsWith('inkwave-ledger-')) out.push(name)
    if (!out.length) return { files: [], ledger: null }
    const fh = await root.getFileHandle(out[0])
    return { files: out, ledger: JSON.parse(await (await fh.getFile()).text()) }
  })
}

async function run(flagOn) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))
  page.on('request', (r) => { if (/flags-|TiptapEditor-/.test(r.url())) console.log('  [req]', r.url().split('/').pop()) })
  page.on('requestfailed', (r) => console.log('  [reqfail]', r.url().split('/').pop(), r.failure()?.errorText))
  page.on('console', (m) => { if (/ledger|error|fail/i.test(m.text())) console.log('  [console]', m.text().slice(0, 200)) })
  // Set the flag BEFORE any app code runs — it is cached in a module variable on first read.
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('inkwave:prodLedger', '1')
    else localStorage.removeItem('inkwave:prodLedger')
    localStorage.setItem('inkwave:ledgerPlace', 'library')
  }, flagOn)

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  // Focus the editor ONCE — a click between the two typing runs would move the caret and scramble
  // which line is the title.
  await page.waitForSelector('.ProseMirror', { timeout: 45_000 })
  await page.click('.ProseMirror')
  // A TITLE LINE, then BODY PROSE on its own paragraph. They must be different strings: the title
  // legitimately becomes `doc_label` (specced, and suppressible), so a probe that types one blob
  // cannot tell "the title was recorded" from "the prose leaked". Only distinct lines can.
  await typeInEditor(page, TITLE_LINE.split(''))
  await page.keyboard.press('Enter')
  await typeInEditor(page, BODY_PROSE.split(''))

  // Did the typing actually land in the editor? If not, everything downstream is unreadable.
  const typed = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '')
  console.log(`  [typed] ${JSON.stringify(typed.slice(0, 60))}`)
  console.log(`  [flag]  ${await page.evaluate(() => localStorage.getItem('inkwave:prodLedger'))}`)

  // Did the tap SEE the edit stream? This is the wiring question, asked directly.
  const tap = await page.evaluate(() => {
    const l = window.__iwLedger
    return l ? { openSessionId: l.openSessionId, editEvents: l.editEvents } : null
  })
  console.log(`  [tap]   ${JSON.stringify(tap)}`)

  // Close at a real boundary + flush the debounced write.
  await page.evaluate(async () => { await window.__iwLedger?.close('exit') })
  await sleep(1500)

  const res = await readLedgerFromOpfs(page)
  await browser.close()
  return res
}

const fail = (msg) => { console.error(`\n✗ ${msg}`); stopServer(); process.exit(1) }

// readiness is polled inside assertServerIsOurs — no fixed sleep (it expired before vite bound)
try {
  await assertServerIsOurs()
} catch (e) {
  fail(String(e.message ?? e))
}

// ── THE KNOWN-NEGATIVE, run FIRST: flag OFF must write nothing at all ────────
const off = await run(false)
console.log(`[flag OFF] ledger files: ${JSON.stringify(off.files)}`)
if (off.files.length !== 0) fail(`flag OFF wrote a ledger (${off.files}) — capture is not gated`)
console.log('✓ known-negative fires: default OFF captures nothing')

// ── THE POSITIVE: flag ON must write a real row ──────────────────────────────
const on = await run(true)
console.log(`[flag ON ] ledger files: ${JSON.stringify(on.files)}`)
if (!on.ledger) fail('flag ON wrote NO ledger — the onTransaction wiring never reached the capture')

const rows = on.ledger.rows ?? []
if (rows.length !== 1) fail(`expected exactly 1 session row, got ${rows.length}`)
const r = rows[0]
console.log('[row]', JSON.stringify(r, null, 2))

const checks = [
  ['edit_events > 0 (the edit stream was seen)', r.edit_events > 0],
  ['words_end > 0 (the close measured the doc)', r.words_end > 0],
  ['words_added > 0 (the word diff ran)', r.words_added > 0],
  ['start carries a local offset, not Z', /[+-]\d{2}:\d{2}$/.test(r.start)],
  ['place is the typed label', r.place === 'library'],
  ['doc_label is the TITLE (specced, suppressible)', r.doc_label === TITLE_LINE],
  ['NO document prose leaked into the row', !/kierkegaard|repetition|recollection/i.test(JSON.stringify(r))],
  ['NO prose leaked into the ledger FILE at all', !/kierkegaard|repetition|recollection/i.test(JSON.stringify(on.ledger))],
  ['session_id present', typeof r.session_id === 'string' && r.session_id.length > 0],
  ['attested: one daily block with a hash', (on.ledger.attestations ?? []).length === 1 && !!on.ledger.attestations[0].blockHash],
  ['block rowHashes match row count', on.ledger.attestations?.[0]?.rowHashes?.length === rows.length],
]
let bad = 0
for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) bad++ }
if (bad) fail(`${bad} check(s) failed`)

console.log('\n✓ WIRING PROVED: default OFF writes nothing; flag ON captures the real edit stream into an attested ledger row.')
stopServer()
process.exit(0)
