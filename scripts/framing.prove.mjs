// DOES THE SCOPED RULE ACTUALLY FIRE? (2026-08-30)
//
// ⚠ THE GAP THIS EXISTS TO CLOSE. The mechanism was proved headed earlier today with an UNSCOPED
// rule, from example.com — which is not an Inkwave origin. The shipped rule adds
// `initiatorDomains: APP_INITIATORS`, and if that does not match the page creating the frame the
// rule silently does not fire and live view is exactly as broken as before, with nothing in the
// UI to say so. So the earlier proof does NOT cover the thing we shipped; this does.
//
// Headed, because HEADLESS DOES NOT LOAD EXTENSIONS on this machine — measured with a canary rule
// across `headless:true`, `--headless=new` and `channel:'chrome'`; silent in all three.
//
// ⚠ AND `--window-position=-32000,-32000` DOES NOT HIDE IT ON macOS. That is the Linux/X11 trick;
// macOS clamps a window onto a visible display, so it appeared anyway and this comment used to
// claim otherwise. `hideBrowser()` (scripts/offscreen.mjs) hides the PROCESS the way macOS does,
// and RETURNS whether it took — so a run that could not hide says so instead of assuming.
import { chromium } from '@playwright/test'
import { hideBrowser, OFFSCREEN_ARGS } from './offscreen.mjs'
import { frameRuleFor } from '../src/reader/framingRule.ts'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REFUSER = 'https://www.abc.net.au/news'          // measured: sends X-Frame-Options
// ⚠ A SIBLING SUBDOMAIN, and it is the case that broke in the field. Peter: "if I click shows in
// abc it won't work either." The rule used to carry requestDomains:[host]; Chrome matches that
// against a domain and its SUBdomains, so a rule for www.abc.net.au never covered iview.abc.net.au.
// One click inside the framed page and the panel was back at the refusal card.
const SIBLING = 'https://iview.abc.net.au/'
const ok = []; const bad = []
const check = (c, label, detail = '') => (c ? ok : bad).push(`${c ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)

// A throwaway extension carrying THE SHIPPED RULE plus a canary, so we test the real shape.
// ⚠ THE PROFILE MUST NOT LIVE INSIDE THE EXTENSION DIRECTORY. Chrome loads the whole folder as
// the extension; a browser profile written into it is not an extension, and the load fails
// silently — which reads exactly like 'the scoping is wrong'. Two separate temp dirs.
const root = mkdtempSync(join(tmpdir(), 'iw-framing-'))
const dir = join(root, 'ext'); mkdirSync(dir, { recursive: true })
// ⚠ TAB 1 IS A GUESS THE PROBE MUST NOT MAKE. A static ruleset cannot know the tab id, so this
// harness installs the rule for "any tab" by omitting tabIds — which means it proves the HEADER
// STRIPPING and the CLICK-THROUGH, not the tab scoping. The tab scoping is proved by the unit
// guard (framingRule.test.ts) and by the shape below being byte-identical to the shipped one
// apart from that single condition. Stated rather than implied, because a probe that quietly
// tests a different rule than the one that ships is worse than no probe.
const shipped = frameRuleFor(1)
const rule = { ...shipped, condition: { resourceTypes: shipped.condition.resourceTypes } }
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'framing probe', version: '1.0',
  permissions: ['declarativeNetRequest'], host_permissions: ['<all_urls>'],
  declarative_net_request: { rule_resources: [{ id: 'r', enabled: true, path: 'rules.json' }] },
}))
// CANARY: proves the ruleset loaded at all. Without it a "did not fire" reading is unreadable —
// it means either the scoping is wrong or extensions simply are not loading, and those need
// opposite fixes.
const canary = { id: 2, priority: 2, action: { type: 'block' },
  condition: { urlFilter: '||example.org', resourceTypes: ['sub_frame'] } }
writeFileSync(join(dir, 'rules.json'), JSON.stringify([rule, canary]))

// The page that creates the frame must be an Inkwave origin, or the shipped rule cannot match.
// `localhost` is in APP_INITIATORS precisely so `pnpm dev` works.
// ⚠ NOT startProbeServer: it sends a production-like CSP, and OUR OWN `frame-src` then blocks the
// frame before the target's headers matter at all — the extension strips the TARGET's headers, not
// ours, so that harness can only ever report failure. A bare origin isolates the thing under test.
const http = await import('node:http')
const srv = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><body>') })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://localhost:${srv.address().port}`
const stop = async () => new Promise((r) => srv.close(r))
check(new URL(base).hostname === 'localhost', 'the probe page is served from an APP_INITIATOR origin', base)

async function run(withExt) {
  const ctx = await chromium.launchPersistentContext(join(root, withExt ? 'p-on' : 'p-off'), {
    headless: false,
    args: [...OFFSCREEN_ARGS,
      ...(withExt ? [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] : [])],
  })
  const hid = await hideBrowser()
  if (!hid) console.log('  ⚠ could not hide the browser window — it is on screen for this run')
  const pg = await ctx.newPage()
  const refusals = []; const blocked = []
  pg.on('console', (m) => { if (/Refused to (display|frame)/i.test(m.text())) refusals.push(1) })
  pg.on('requestfailed', (r) => { if (/ERR_BLOCKED_BY_CLIENT/.test(r.failure()?.errorText || '')) blocked.push(1) })
  await pg.goto(base + '/', { waitUntil: 'domcontentloaded' })
  const probe = async (url) => {
    refusals.length = 0; blocked.length = 0
    await pg.evaluate(async (u) => {
      document.querySelectorAll('iframe.__probe').forEach((f) => f.remove())
      const f = document.createElement('iframe'); f.className = '__probe'; f.src = u
      document.body.appendChild(f)
      await new Promise((res) => { f.onload = () => setTimeout(res, 1500); setTimeout(res, 15000) })
    }, url)
    await pg.waitForTimeout(400)
    return blocked.length ? 'BLOCKED' : refusals.length ? 'REFUSED' : 'framed'
  }
  const out = { canary: await probe('https://example.org/'), refuser: await probe(REFUSER), sibling: await probe(SIBLING) }
  // ⚠ THE CASE THE OLD PROBE COULD NOT SEE. Every check above creates a frame FROM THE TOP PAGE,
  // where the request's initiator is this page — so an initiator-scoped rule passed them all and
  // still broke on the writer's first click, because a navigation started INSIDE the frame is
  // initiated by the framed page instead. Navigating the frame itself is the real gesture.
  refusals.length = 0
  await pg.evaluate(async () => {
    const f = document.querySelector('iframe')
    if (!f) return
    f.src = 'https://www.abc.net.au/news/politics'      // the frame navigating itself
    await new Promise((r) => { f.onload = () => setTimeout(r, 2500); setTimeout(r, 15000) })
  })
  await pg.waitForTimeout(500)
  out.clicked = refusals.length ? 'REFUSED' : 'framed'
  await ctx.close(); return out
}

const off = await run(false)
const on = await run(true)
console.log('WITHOUT ext:', JSON.stringify(off))
console.log('WITH ext   :', JSON.stringify(on))

// VOID GUARDS FIRST — a verdict read off a dead instrument is worse than no verdict.
if (on.canary !== 'BLOCKED') {
  console.log('\n!! VOID — the canary was not blocked, so the ruleset never loaded. Nothing readable here.')
  await stop(); process.exit(1)
}
if (off.refuser !== 'REFUSED') {
  console.log('\n!! VOID — the control did not refuse, so this run cannot show the rule doing anything.')
  await stop(); process.exit(1)
}
check(true, 'canary blocked ⇒ the shipped ruleset is live')
check(off.refuser === 'REFUSED', 'control: the site refuses framing without the extension')
check(on.refuser === 'framed', 'THE SCOPED RULE FIRES from an Inkwave origin', `${off.refuser} → ${on.refuser}`)
// The regression this rule shape exists to fix: a sibling subdomain, one click away inside the
// framed page, must be covered too.
check(on.sibling === 'framed', 'a SIBLING SUBDOMAIN is covered', `${off.sibling} → ${on.sibling}`)
check(on.clicked === 'framed', 'CLICKING A LINK INSIDE THE FRAME still works',
  `${off.clicked} → ${on.clicked}`)

console.log('')
for (const l of ok) console.log('  ' + l)
for (const l of bad) console.log('  ' + l)
console.log(bad.length ? `\nFAIL (${bad.length})` : '\nPASS')
await stop()
process.exit(bad.length ? 1 : 0)
