// THE SOURCE READER, DRIVEN THE WAY PETER DRIVES IT: open it, type a search, follow a result, come
// back, flip the toggle, meet a page that refuses.
//
// ─── WHY THIS EXISTS, AND WHY `prove:reader` DID NOT CATCH ANY OF IT ─────────────────────────────
// On 2026-08-30 Peter reported the reader "broken" SIX times in one evening. Every time I diagnosed
// it by guessing, shipped a fix, and he found it still broken. The six causes were:
//
//   1. a cleanup written for the wrong effect lifetime, so a navigation raced its own install;
//   2. `frameKey` bumped on every install, remounting the iframe mid-video;
//   3. an `isPlayable` early return that ran AFTER the rule had been torn down;
//   4. `liveFrameEnabled()` read in two places with only one updated, so a search routed to a live
//      page that framing had been switched off for;
//   5. the PERSISTED live mode (`inkwave:readerLive`) pinning searches to a refusal card, which
//      made the ⌂/⛶ toggle look dead from the one page a writer starts on;
//   6. the search endpoint being an engine our own server is BLOCKED FROM — so the reader path had
//      never worked in production and could not have.
//
// `pnpm prove:reader` was green throughout. It opens the panel on an ARTICLE and exercises
// selection and citing; it never types a search, never follows a result, never flips the toggle,
// and never asserts that anything a writer would call "results" appeared. Six regressions in the
// most-used path, and the instrument could not see the path.
//
// So this probe measures OUTCOMES a writer would name, not handlers:
//   • results APPEAR (linked anchors painted in our own DOM), not "a request happened";
//   • the CHAIN falls forward when the first engine is starved, and does NOT when it is not;
//   • back/forward move the address bar AND re-render the page;
//   • the toggle really swaps reader DOM for a live frame, and a search under a PERSISTED live mode
//     still lands on results rather than a refusal card;
//   • a page that refuses framing shows the refusal card, and its two actions are real.
//
// ─── WHAT IS STUBBED, AND WHAT THAT COSTS ────────────────────────────────────────────────────────
// The NETWORK is stubbed at `/api/reader`, answered from the REAL extractor (src/reader/extract.mjs)
// over fixture pages. That is deliberate: the reader is under test, not the weather, and a fake
// extractor would let the renderer pass against blocks the shipped code never produces.
//
// The cost is stated rather than hidden: a stubbed engine CANNOT tell you the real engine refuses
// our datacentre IP (failure 6). `cell 7` below closes as much of that as this machine honestly
// can — it fetches the engines in `SEARCH_ENGINES` for real and runs the real extractor over what
// comes back — and it VOIDs rather than fails when there is no network, because "the box is
// offline" and "the engine is gone" are different answers.
//
// ─── HEADLESS IS THE RIGHT INSTRUMENT HERE ───────────────────────────────────────────────────────
// Extensions do not load in any headless mode on this machine (scripts/offscreen.mjs records the
// canary run). Every cell here is the DEFAULT path — no extension, `extState` absent, `canFrame`
// false — which is what most writers have and what five of the six failures happened in. Set
// PROBE_HEADED=1 to watch it; `hideBrowser()` then keeps it off Peter's screen and REPORTS whether
// it took. `--window-position=-32000,-32000` does not work on macOS and is not used.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { hideBrowser, OFFSCREEN_ARGS } from '../offscreen.mjs'
import { extractBlocks } from '../../src/reader/extract.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const BODY = 'div[data-iw-selectable]'
const ADDRESS = 'input[placeholder="address or search"]'

// ── THE ENGINE CHAIN, READ OUT OF THE SHIPPED SOURCE ────────────────────────────────────────────
// NOT retyped. A probe carrying its own copy of the chain goes on passing after the chain changes,
// which is how `readerext.prove.mjs` spent a day accusing a working feature.
const addrSrc = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../../src/reader/address.ts', import.meta.url), 'utf8'))
const ENGINE_URLS = [...addrSrc.matchAll(/\{\s*name:\s*'([^']+)',\s*url:\s*'([^']+)'\s*\}/g)]
  .map((m) => ({ name: m[1], url: m[2] }))
// …and so is the threshold. `searchLooksEmpty` is TypeScript, so node cannot import it; a retyped
// `< 5` would go on agreeing with itself after the rule moved. Parsed, with the parse asserted in
// cell 0 — a regex that quietly matched nothing would make every fixture "rich" by default.
const EMPTY_BELOW = Number(/linkedBlocks\s*<\s*(\d+)/.exec(addrSrc)?.[1] ?? NaN)
const searchLooksEmpty = (n) => n < EMPTY_BELOW

// ── FIXTURES ────────────────────────────────────────────────────────────────────────────────────
// A results page is BLOCKS THAT CARRY LINKS — that is literally what `searchLooksEmpty` counts, so
// the fixture has to be shaped like the thing the rule reads, not like a picture of a search engine.
// ⚠ NONE OF THESE IS THE SEEDED ARTICLE'S URL. A results list that happens to lead back to the page
// already on screen makes cell 4 unable to tell "the panel navigated" from "the panel did nothing" —
// which is precisely the confusion this probe exists to remove.
const RESULT_HOSTS = [
  'https://example-journal.org/persistence',
  'https://notes.example.edu/lecture-4',
  'https://another.example.org/four-dimensionalism',
  'https://openbooks.example/mereology',
  'https://philarchive.example/temporal-parts',
  'https://seminar.example.net/endurantism',
  'https://reviews.example.com/sider',
]
const resultsPage = (engine, q) => `<!doctype html><html><head><title>${engine} — ${q}</title></head><body><main>
  <h1>${engine} results for ${q}</h1>
  ${RESULT_HOSTS.map((u, i) => `<p><a href="${u}">Result ${i + 1}: ${new URL(u).hostname}</a> — a sentence of
     snippet text so the block is prose with a link in it, exactly like a real result row.</p>`).join('\n  ')}
</main></body></html>`

// A CHALLENGE PAGE. This is the case the chain exists for and the case nothing upstream can detect:
// it answers 200, it is well-formed HTML, and it has almost no links. `searchLooksEmpty` counts
// LINKED BLOCKS, so this must have fewer than five — and cell 0 proves it does before any verdict
// downstream is read, rather than assuming the fixture starves.
const CHALLENGE_PAGE = `<!doctype html><html><head><title>Just a moment…</title></head><body><main>
  <h1>Verifying you are human</h1>
  <p>This is taking a moment. <a href="https://help.example/why">Why am I seeing this?</a></p>
  <p>Enable JavaScript and cookies to continue. <a href="https://help.example/js">Learn more</a></p>
</main></body></html>`

const ARTICLE_PAGE = `<!doctype html><html><head><title>Identity Over Time</title></head><body><main>
  <h1>Identity Over Time</h1>
  <p>An opening paragraph long enough to be prose rather than a label, so the reader has something to
     render and something to select. It mentions <a href="https://plato.stanford.edu/entries/change/">change</a>.</p>
  <h2 id="Intr">1. Introduction</h2>
  <p>The first section says something quotable about persistence and the puzzle of change over time.</p>
  <h2 id="Chng">2.1 Identity and Change</h2>
  <p>Consider the property version of Leibniz's Law and the relation of identity it mentions.</p>
</main></body></html>`

const RESULT_ARTICLE = `<!doctype html><html><head><title>Persistence and Its Puzzles</title></head><body><main>
  <h1>Persistence and Its Puzzles</h1>
  <p>The paper a reader lands on after pressing a search result. Its title is DISTINCT from the
     search page's and from the seeded article's, so "did the panel navigate" is answerable by
     reading the screen rather than by trusting a counter.</p>
  <h2 id="One">1. The problem</h2>
  <p>A second paragraph, so the rendered page is unmistakably an article rather than a stub.</p>
</main></body></html>`

const REFUSING_PAGE = `<!doctype html><html><head><title>Walled Garden Review</title></head><body><main>
  <h1>Walled Garden Review</h1>
  <p>This host sends X-Frame-Options in production. Reader view can still read it, which is the whole
     point of the card the panel shows instead of Chrome's grey face.</p>
</main></body></html>`

const REFUSING_URL = 'https://walled.example.org/review'
const ARTICLE_URL = 'https://plato.stanford.edu/entries/identity-time/'

// ── HARNESS ─────────────────────────────────────────────────────────────────────────────────────
let fail = 0
let voids = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}
// The third answer. A cell whose PRECONDITION moved must be able to say so instead of blaming the
// product — every probe in this repo that could only pass or fail has, at some point, sent someone
// to debug a working subsystem.
const cannotTell = (msg, extra = '') => {
  console.log('  ~ ' + 'VOID' + ` — ${msg}${extra ? ' — ' + extra : ''}`)
  voids++
}

const { base, stop } = await startProbeServer()
const headed = process.env.PROBE_HEADED === '1'
const b = await chromium.launch({ headless: !headed, args: headed ? OFFSCREEN_ARGS : [] })
if (headed) {
  const hid = await hideBrowser()
  console.log(hid ? `  (headed, hidden as "${hid}")` : '  (headed, and it could NOT be hidden — a window is visible)')
}

// ⚠ BLOCK THE SERVICE WORKER. public/sw.js answers from its own cache and `page.route` does not
// intercept service-worker-originated requests, so `/api/reader` came back as the app's own
// index.html with status 200 in an earlier probe, and the panel showed "That page couldn't be read
// here" — a harness artefact wearing the exact face of the bug being hunted.
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
const page = await ctx.newPage()

// ── ROUTE STATE ─────────────────────────────────────────────────────────────────────────────────
// `starve` is what makes the chain testable in BOTH directions in one build: an engine that answers
// 200 with a challenge page is indistinguishable, from anything upstream, from one that genuinely
// found nothing. Flipping it is the control.
let starve = false
let framable = true
const engineHits = new Map()      // engine name → how many reads
const resetHits = () => engineHits.clear()
const hitsOf = (name) => engineHits.get(name) ?? 0

const pageFor = (target) => {
  const eng = ENGINE_URLS.find((e) => target.startsWith(e.url))
  if (eng) {
    engineHits.set(eng.name, hitsOf(eng.name) + 1)
    const q = new URL(target).searchParams.get('q') ?? new URL(target).searchParams.get('query') ?? ''
    // Only the FIRST engine is ever starved: a chain that starves everywhere proves nothing about
    // falling forward, it only proves the reader gives up.
    if (starve && eng === ENGINE_URLS[0]) return CHALLENGE_PAGE
    return resultsPage(eng.name, q)
  }
  if (target.startsWith(REFUSING_URL)) return REFUSING_PAGE
  if (target.startsWith(ARTICLE_URL)) return ARTICLE_PAGE
  return RESULT_ARTICLE
}

await page.route((u) => u.pathname === '/api/reader', (route) => {
  const u = new URL(route.request().url())
  // The framing question is answered by the SERVER in production (`checkFramable` reads the
  // headers) — so the refusal card is reachable here without a real cross-origin refusal, which is
  // the only way to make that cell deterministic.
  if (u.searchParams.get('probe') === '1') {
    const target = u.searchParams.get('url') || ''
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ framable: target.startsWith(REFUSING_URL) ? false : framable }) })
  }
  const target = u.searchParams.get('url') || ''
  try {
    const { title, blocks } = extractBlocks(pageFor(target), target)
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: target, title, blocks }) })
  } catch (e) {
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'probe route threw: ' + e.message }) })
  }
})

// The LIVE frame's src is cross-origin, so `page.route` does not reach it — a cross-origin iframe is
// an out-of-process frame in Chromium. `ctx.route` does. Without this the frame would reach for the
// real internet and the toggle cells would pass or fail by connectivity.
await ctx.route((u) => u.protocol === 'https:', (route) => {
  route.fulfill({ status: 200, contentType: 'text/html', body: pageFor(route.request().url()) })
})

// ── HELPERS THAT READ THE SCREEN ────────────────────────────────────────────────────────────────
/** Linked anchors painted in OUR OWN reader DOM. Null — never 0 — when the reader body is not on
 *  screen at all: "no results" and "there is nothing to show results in" are different answers, and
 *  collapsing them is how a probe reports a missing panel as a broken feature. */
const linkCount = () => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  return [...el.querySelectorAll('a[href]')].filter((a) => /^https?:/i.test(a.getAttribute('href') || '')).length
}, BODY)

const readerTitle = () => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  return el ? (el.querySelector('h1')?.textContent || '').trim() : null
}, BODY)

const frameCount = () => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  return el ? el.querySelectorAll('iframe').length : null
}, BODY)

const addrValue = () => page.locator(ADDRESS).inputValue()

const panelText = () => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : null
}, BODY)

// ⚠ THE TOGGLE IS ONE BUTTON WEARING TWO TITLES, so a probe that clicks `button[title^="Live page"]`
// has ASSUMED the panel is in reader view. Under a mutant that left it framed, that assumption made
// the probe TIME OUT — reporting itself broken about a product change it was written to catch. Ask
// which state the panel is in; act only if it needs to move.
const READER_BTN = 'button[title^="Reader view"]'   // present WHILE LIVE (it offers reader view)
const LIVE_BTN = 'button[title^="Live page"]'       // present WHILE IN READER (it offers live)
/** Put the panel in live mode. Returns false if the toggle is not on screen at all. */
async function goLive() {
  if (await page.locator(READER_BTN).count()) return true      // already live
  if (!(await page.locator(LIVE_BTN).count())) return false
  await page.locator(LIVE_BTN).click(); await page.waitForTimeout(1200); return true
}
/** Put the panel in reader mode. Returns false if the toggle is not on screen at all. */
async function goReader() {
  if (await page.locator(LIVE_BTN).count()) return true        // already reader
  if (!(await page.locator(READER_BTN).count())) return false
  await page.locator(READER_BTN).click(); await page.waitForTimeout(1200); return true
}

/** Type into the address bar and press Enter — the exact gesture, not a call into `go`. */
async function typeAddress(text) {
  await page.locator(ADDRESS).click()
  await page.locator(ADDRESS).fill(text)
  await page.keyboard.press('Enter')
}

/** Wait for the reader to settle on a page whose link count satisfies `pred`. Returns the count, or
 *  null on timeout so the caller can VOID rather than assert a number it never saw. */
async function waitForLinks(pred, timeout = 15000) {
  const t0 = Date.now()
  for (;;) {
    const n = await linkCount()
    if (n !== null && pred(n)) return n
    if (Date.now() - t0 > timeout) return null
    await page.waitForTimeout(120)
  }
}

/**
 * ⚠ COUNTING LINKS RIGHT AFTER A NAVIGATION READS THE PAGE YOU LEFT.
 * The reader keeps the previous article painted until the new fetch resolves, so a probe that types
 * a query and immediately counts anchors sees the LAST results page and reports success — which is
 * exactly what this one did on its first run: it "proved" a starved engine served seven results.
 * The results page's own <h1> carries the query, so waiting for THIS query is the only way to know
 * which page is being measured. Returns null on timeout, so a caller can VOID.
 */
async function waitForResultsOf(q, timeout = 20000) {
  const t0 = Date.now()
  const want = q.toLowerCase()
  for (;;) {
    const t = (await readerTitle()) || ''
    if (/results for/i.test(t) && t.toLowerCase().includes(want)) {
      const n = await linkCount()
      if (n !== null && !searchLooksEmpty(n)) return n
    }
    if (Date.now() - t0 > timeout) return null
    await page.waitForTimeout(120)
  }
}

let voided = false          // set once a precondition fails; later cells then VOID instead of blame

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 0 — ARM THE INSTRUMENT BEFORE READING ANY VERDICT OFF IT
  // Two properties, and both were bugs in earlier probes here: the chain must have been READ (an
  // empty list makes every later cell vacuous), and the fixtures must actually DISCRIMINATE — a
  // "starved" page that the shipped rule does not consider starved would make cell 3 pass while
  // reproducing nothing.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 0 — the instrument')
  check(ENGINE_URLS.length >= 2, 'the shipped search chain has at least two engines',
    ENGINE_URLS.map((e) => e.name).join(' → ') || 'NONE PARSED')
  if (ENGINE_URLS.length < 2) {
    cannotTell('the chain could not be read out of address.ts — every search cell below is unreadable')
    voided = true
  }

  const richLinked = extractBlocks(resultsPage('X', 'q'), 'https://x/').blocks
    .filter((bl) => 'runs' in bl && (bl.runs ?? []).some((r) => r.href)).length
  const starvedLinked = extractBlocks(CHALLENGE_PAGE, 'https://x/').blocks
    .filter((bl) => 'runs' in bl && (bl.runs ?? []).some((r) => r.href)).length
  const articleLinked = extractBlocks(ARTICLE_PAGE, ARTICLE_URL).blocks
    .filter((bl) => 'runs' in bl && (bl.runs ?? []).some((r) => r.href)).length
  check(Number.isFinite(EMPTY_BELOW), 'the shipped "no results" threshold was read out of address.ts', `< ${EMPTY_BELOW}`)
  if (!Number.isFinite(EMPTY_BELOW)) {
    cannotTell('the threshold could not be parsed — the fixtures cannot be checked against the real rule')
    voided = true
  }
  check(!searchLooksEmpty(richLinked), 'the RICH fixture is a page the shipped rule calls "has results"', `${richLinked} linked blocks`)
  check(searchLooksEmpty(starvedLinked), 'the STARVED fixture is a page the shipped rule calls EMPTY', `${starvedLinked} linked blocks`)
  check(searchLooksEmpty(articleLinked), 'an ARTICLE is NOT a results page — so "≥5 links" cannot be met by any page here',
    `${articleLinked} linked block(s)`)
  if (!(richLinked > starvedLinked)) {
    cannotTell('the fixtures do not discriminate — cells 2 and 3 would pass for the wrong reason')
    voided = true
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 1 — OPEN THE PANEL THE WAY THE APP DOES
  // My first attempt at this failed here and it is worth recording why: a FRESH document has no
  // citation to click, and the probe grabbed a file input instead and reported the panel missing.
  // There is exactly one thing that renders SourceBrowser (CitationNodeView), so a resolvable
  // citation with a web URL has to exist before the panel can be opened at all.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 1 — the entry point')
  const docId = 'readerflow-' + Math.random().toString(36).slice(2, 8)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  const seeded = await page.evaluate(async (id) => {
    const item = { id: 'sider2001', type: 'article-journal', title: 'Identity Over Time',
      author: [{ family: 'Sider', given: 'T' }], issued: { 'date-parts': [[2001]] },
      URL: 'https://plato.stanford.edu/entries/identity-time/' }
    const doc = { id, title: 'Reader flow probe', createdAt: new Date().toISOString(), schemaVersion: '1',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'As argued ' },
        { type: 'citation', attrs: { citekeys: ['sider2001'], prefix: '', suffix: '', locator: '', suppressAuthor: false } },
        { type: 'text', text: ' the puzzle persists.' }] }] } }
    try {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('documents', { create: true })
      const dir = await docs.getDirectoryHandle(id, { create: true })
      const dh = await dir.getFileHandle('current.json', { create: true })
      const dw = await dh.createWritable(); await dw.write(JSON.stringify(doc)); await dw.close()
      const lib = await root.getDirectoryHandle('library', { create: true })
      const per = await lib.getDirectoryHandle(id, { create: true })
      const fh = await per.getFileHandle('citations.json', { create: true })
      const w = await fh.createWritable(); await w.write(JSON.stringify([item])); await w.close()
    } catch (e) { return 'opfs: ' + e.message }
    return 'ok'
  }, docId)
  if (seeded !== 'ok') {
    cannotTell('OPFS refused the seed, so no citation can exist and no cell below can run', String(seeded))
    voided = true
  }

  // The library is stored PER DOCUMENT, so the tab must own its identity BEFORE anything loads —
  // arriving via ?doc= is what makes `loadLibrary` resolve the file that was just written.
  await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForTimeout(2200)

  const opened = await page.evaluate(() => {
    const link = document.querySelector('.iw-cite-link')
    if (!link) return 'no citation rendered'
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    link.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 'clicked'
  })
  check(opened === 'clicked', 'the citation renders and takes a plain click', String(opened))
  const t1 = await (async () => {
    const t0 = Date.now()
    for (;;) {
      const t = await readerTitle()
      if (t) return t
      if (Date.now() - t0 > 20000) return null
      await page.waitForTimeout(150)
    }
  })()
  check(t1 === 'Identity Over Time', 'the panel opened on the citation and rendered the article', String(t1))
  if (!t1) {
    cannotTell('the reader never opened, so nothing below is a statement about search')
    voided = true
  }
  // The KNOWN-NEGATIVE that makes "results appeared" mean something: this article, on this screen,
  // right now, has fewer than five links. So the assertion in cell 2 is not satisfiable by "the
  // panel rendered anything at all".
  const articleLinksOnScreen = await linkCount()
  check(articleLinksOnScreen !== null && articleLinksOnScreen < 5,
    'the ARTICLE on screen has <5 links — "results appeared" is a discriminating claim',
    `${articleLinksOnScreen} link(s)`)

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 2 — TYPE A QUERY AND SEE RESULTS
  // The cell `prove:reader` does not have. It asserts PAINTED RESULT LINKS, not that a request left
  // — a request leaving is exactly what was true on every one of the six nights.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 2 — type a search, get results')
  if (voided) cannotTell('skipped: a precondition above failed')
  else {
    starve = false; resetHits()
    await typeAddress('identity over time')
    const n = await waitForResultsOf('identity over time')
    check(n !== null, `results APPEARED as linked blocks in our own DOM`, n === null ? 'never reached 5 links' : `${n} result links`)
    const addr = await addrValue()
    check(addr.startsWith(ENGINE_URLS[0].url), `the query became the FIRST engine (${ENGINE_URLS[0].name})`, addr.slice(0, 70))
    check(hitsOf(ENGINE_URLS[0].name) >= 1, 'the first engine was actually read', `${hitsOf(ENGINE_URLS[0].name)} read(s)`)
    check((await frameCount()) === 0, 'a search with no extension stays in READER view, not a live frame')
    if (n === null) { cannotTell('no results rendered, so the navigation cells below cannot be read'); voided = true }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 3 — THE CHAIN, PROVED IN BOTH DIRECTIONS
  // MEASURED in production and recorded in address.ts: one engine answered 170 / 170 / 3 / 3 blocks
  // for the same query. A challenge page answers 200, so nothing upstream can tell it from "no
  // results" — the chain is the difference between a search box and a coin toss.
  //
  // The CONTROL is the half that makes this readable: with a healthy first engine the second must
  // NOT be touched. Without it, "engine 2 was read" is satisfied by a reader that always reads both.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 3 — the fallback chain')
  if (voided) cannotTell('skipped: a precondition above failed')
  else {
    // CONTROL first — a rich engine 1 must not reach engine 2.
    starve = false; resetHits()
    await typeAddress('temporal parts control')
    const ctlLinks = await waitForResultsOf('temporal parts control')
    check(ctlLinks !== null, 'CONTROL: a healthy first engine serves results by itself', ctlLinks === null ? 'no results' : `${ctlLinks} links`)
    check(hitsOf(ENGINE_URLS[1].name) === 0, `CONTROL: the second engine (${ENGINE_URLS[1].name}) was NOT consulted`,
      `${hitsOf(ENGINE_URLS[1].name)} read(s)`)

    // Now starve engine 1 and require the chain to fall forward.
    starve = true; resetHits()
    await typeAddress('endurantism starved')
    const fellLinks = await waitForResultsOf('endurantism starved')
    check(fellLinks !== null, 'a STARVED first engine falls forward and results still appear',
      fellLinks === null ? 'the reader gave up on the challenge page' : `${fellLinks} links`)
    check(hitsOf(ENGINE_URLS[0].name) >= 1, `the starved first engine (${ENGINE_URLS[0].name}) was tried`, `${hitsOf(ENGINE_URLS[0].name)}`)
    check(hitsOf(ENGINE_URLS[1].name) >= 1, `the second engine (${ENGINE_URLS[1].name}) served the results`, `${hitsOf(ENGINE_URLS[1].name)} read(s)`)
    const fellAddr = await addrValue()
    check(fellAddr.startsWith(ENGINE_URLS[1].url), 'the address bar tells the writer which engine answered', fellAddr.slice(0, 70))
    starve = false
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 4 — SEARCH → OPEN A RESULT → BACK
  // A browser is judged on this. Every assertion reads the SCREEN: the result article's own <h1>,
  // and the address bar. "Back fired" is not the claim; "the previous page is on screen" is.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 4 — navigate: search → result → back')
  if (voided) cannotTell('skipped: a precondition above failed')
  else {
    starve = false; resetHits()
    await typeAddress('persistence puzzles')
    const searchLinks = await waitForResultsOf('persistence puzzles')
    if (searchLinks === null) cannotTell('no results to click, so navigation cannot be exercised')
    else {
      const searchAddr = await addrValue()
      const target = await page.evaluate((sel) => {
        const a = [...document.querySelector(sel).querySelectorAll('a[href]')]
          .find((x) => /^https?:/i.test(x.getAttribute('href') || ''))
        if (!a) return null
        const href = a.getAttribute('href')
        a.click()
        return href
      }, BODY)
      check(!!target, 'a result row is a real link', String(target))
      // The result page's <h1> is DELIBERATELY different from both the search page's and the seeded
      // article's, so this cannot be satisfied by "the panel still shows something".
      let landed = null
      for (let i = 0; i < 100 && landed !== 'Persistence and Its Puzzles'; i++) { landed = await readerTitle(); await page.waitForTimeout(120) }
      check(landed === 'Persistence and Its Puzzles', 'the result OPENED and its article rendered', String(landed))
      const landedAddr = await addrValue()
      check(landedAddr === target, 'the address bar followed the navigation', landedAddr.slice(0, 70))

      await page.locator('button[title="Back"]').click()
      let backTitle = null
      for (let i = 0; i < 100; i++) { backTitle = await readerTitle(); if (backTitle && /results for/i.test(backTitle)) break; await page.waitForTimeout(120) }
      const backLinks = await waitForResultsOf('persistence puzzles')
      check((await addrValue()) === searchAddr, 'Back returned the address bar to the search', (await addrValue()).slice(0, 70))
      check(backLinks !== null, 'Back re-rendered the RESULTS, not an empty page',
        backLinks === null ? 'results did not come back' : `${backLinks} links`)
      // ⚠ A DISABLED FORWARD IS A FINDING, NOT A TIMEOUT. Playwright waits 30s on a disabled button
      // and then throws — which reads as "the probe is broken" for something that is a real report
      // about the product: `go` slices the stack at the current index, so anything that navigates
      // after a Back silently destroys the forward history. (It did, until the search chain stopped
      // advancing on the previous page's blocks.) Ask, then judge.
      const fwdEnabled = await page.locator('button[title="Forward"]').isEnabled()
      if (!fwdEnabled) {
        check(false, 'Forward is available after a Back — the forward history survived',
          'the button is disabled: something navigated after the Back and truncated the stack')
      } else {
        await page.locator('button[title="Forward"]').click()
        let fwd = null
        for (let i = 0; i < 100 && fwd !== 'Persistence and Its Puzzles'; i++) { fwd = await readerTitle(); await page.waitForTimeout(120) }
        check(fwd === 'Persistence and Its Puzzles', 'Forward returns to the result', String(fwd))
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 5 — THE LIVE / READER TOGGLE, AND THE PERSISTED MODE THAT BROKE SEARCH
  // Failure 5 of six: `inkwave:readerLive` is remembered per browser, so a writer who once chose
  // Live opened every later session in Live — and a SEARCH cannot be framed without the extension,
  // so it landed on a refusal card and the ⌂/⛶ button looked dead from the first page they saw.
  //
  // THE PAIR IS THE POINT. The article cell is the KNOWN-POSITIVE: it proves the persisted flag
  // really took effect this run. Without it, "the search opened in reader view" is satisfied by a
  // build where the persisted mode never applied to anything.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 5 — the toggle, and a persisted live mode')
  if (voided) cannotTell('skipped: a precondition above failed')
  else {
    // (a) the toggle really swaps the DOM, on an ordinary article.
    framable = true
    await goReader()
    await typeAddress(ARTICLE_URL)
    await page.waitForTimeout(900)
    const beforeFrames = await frameCount()
    await goLive()
    const liveFrames = await frameCount()
    check(beforeFrames === 0 && liveFrames === 1, 'the toggle swapped reader DOM for a real live frame',
      `frames ${beforeFrames} → ${liveFrames}`)
    const liveParas = await page.evaluate((sel) => document.querySelector(sel)?.querySelectorAll('p').length ?? null, BODY)
    check(liveParas === 0, 'and the extracted article is GONE while live — not both at once', `${liveParas} <p>`)
    await goReader()
    check((await frameCount()) === 0 && (await readerTitle()) === 'Identity Over Time',
      'and back again — the toggle is not one-way', String(await readerTitle()))

    // (b) the regression. Persist Live, reload the whole app, and search.
    await page.evaluate(() => localStorage.setItem('inkwave:readerLive', '1'))
    await page.goto(`${base}/?doc=${docId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(EDITOR, { timeout: 60000 })
    await page.waitForTimeout(2200)
    await page.evaluate(() => {
      const link = document.querySelector('.iw-cite-link')
      link?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      link?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(1600)
    const persistedFrames = await frameCount()
    if (persistedFrames === null) {
      cannotTell('the panel did not reopen after the reload, so the persisted-mode cell has no subject')
    } else {
      // KNOWN-POSITIVE: the persisted flag DID take effect — the article opened live by itself.
      check(persistedFrames === 1, 'KNOWN-POSITIVE: the persisted Live mode really applied (article opened framed)',
        `${persistedFrames} frame(s)`)
      if (persistedFrames !== 1) {
        cannotTell('persisted Live never engaged, so "the search escaped it" proves nothing')
      } else {
        starve = false; resetHits()
        await typeAddress('a search under persisted live mode')
        const n = await waitForResultsOf('a search under persisted live mode')
        check(n !== null, 'a SEARCH under persisted Live still lands on RESULTS, not a refusal card',
          n === null ? 'results never appeared: ' + String(await panelText()).slice(0, 120) : `${n} links`)
        check((await frameCount()) === 0, 'the search was pinned to reader view rather than a frame it cannot use')
        // ⚠ AN EMPTY PANEL SATISFIES "no refusal card" AND PROVES NOTHING. Under a mutant that
        // left the search framed, `panelText` was '' and this check went green beside two that had
        // just failed — the decoration this repo keeps finding. It must SEE a page to judge one.
        const txt = (await panelText()) || ''
        if (txt.length < 20) cannotTell('the panel rendered no text, so "no refusal card" is not an observation', JSON.stringify(txt.slice(0, 40)))
        else check(!/can’t be shown in its original form|can't be shown in its original form/.test(txt),
          'the refusal card is NOT what a writer meets on their first search')
      }
    }
    await page.evaluate(() => localStorage.setItem('inkwave:readerLive', '0'))
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 6 — A PAGE THAT REFUSES FRAMING, WITHOUT THE EXTENSION (the default case)
  // The card is not the claim — its ACTIONS are. "Read it here instead" must actually produce the
  // article, and "Open in a tab" must point at the page you are on. A card with two dead buttons is
  // the shape this panel has shipped twice.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 6 — the framing refusal card')
  if (voided) cannotTell('skipped: a precondition above failed')
  else {
    framable = true
    await goReader()
    await typeAddress(REFUSING_URL)          // `/api/reader?probe=1` answers framable:false for it
    await page.waitForTimeout(900)
    await goLive()
    let txt = ''
    for (let i = 0; i < 100; i++) { txt = (await panelText()) || ''; if (/original form/.test(txt)) break; await page.waitForTimeout(120) }
    const shown = /can’t be shown in its original form|can't be shown in its original form/.test(txt)
    check(shown, 'a refused page shows the refusal card, not Chrome’s grey face', shown ? '' : txt.slice(0, 140))
    if (!shown) {
      cannotTell('no refusal card appeared, so its actions cannot be judged')
    } else {
      const readHere = page.locator('button', { hasText: 'Read it here instead' })
      const openTab = page.locator(`${BODY} a[target="_blank"]`).last()
      check(await readHere.count() === 1, 'it offers "Read it here instead"')
      const href = await openTab.getAttribute('href').catch(() => null)
      check(href === REFUSING_URL, 'and "Open in a tab" points at the page you are on', String(href))
      // THE ACTION IS REAL, not merely present.
      await readHere.click()
      let t = null
      for (let i = 0; i < 100 && t !== 'Walled Garden Review'; i++) { t = await readerTitle(); await page.waitForTimeout(120) }
      check(t === 'Walled Garden Review', '"Read it here instead" actually produces the article', String(t))
      check((await frameCount()) === 0, 'and drops out of live mode while doing it')
    }
    // CONTROL: the same toggle on a page that does NOT refuse must show a frame, not a card. Without
    // it, "the card appeared" is satisfied by a build that shows the card on everything.
    await goReader()
    await typeAddress(ARTICLE_URL)
    await page.waitForTimeout(900)
    await goLive()
    await page.waitForTimeout(600)
    const ctlTxt = (await panelText()) || ''
    check((await frameCount()) === 1 && !/original form/.test(ctlTxt),
      'CONTROL: a framable page frames — the card is a verdict, not the default', `frames=${await frameCount()}`)
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CELL 7 — THE ENGINES THEMSELVES, FOR REAL
  // The one thing a stubbed network cannot say. Failure 6 was that the shipped search endpoint was
  // an engine our own server is BLOCKED FROM — no amount of fixture discipline sees that.
  //
  // ⚠ AND THIS CELL DOES NOT SEE IT EITHER, IN THE FORM PETER HIT. It fetches from THIS MACHINE'S
  // address; the production failure was specific to Vercel's datacentre IP (docs/SEARCH-AND-THE-
  // EXTENSION.md measured it: 200 from a laptop, 502 from the deployed function, same minute, with
  // a healthy control). What it DOES catch is an engine that has gone away, changed its markup, or
  // started challenging everyone — which is the shape "170 / 170 / 3 / 3" had.
  //
  // It VOIDs on a network error rather than failing: "this box is offline" and "the engine refuses
  // us" are different answers, and reporting the first as the second is the expensive direction.
  //
  // ⚠ AND IT IS INFORMATIONAL BY DEFAULT, WHICH WAS NOT THE FIRST DESIGN. It began as a plain
  // assertion per engine and went red on its second run — both engines had served 75 and 66 linked
  // blocks twenty minutes earlier and came back with 1 and 0. MEASURED afterwards, by hand, from
  // the same address:
  //   • Marginalia — 200, 59,505 bytes, 170 blocks / 75 linked. Healthy; the probe's `1` was a
  //     transient soft-block after ~6 requests in 20 minutes. This is address.ts's "170/170/3/3".
  //   • SearXNG — 200, **6,486 bytes, its own INDEX page**, 0 linked, on both the bot UA and a real
  //     Chrome one. Not a 429, not a challenge: a landing page wearing a success code.
  // So from any single address these engines are a coin toss, and a gate that fails on a coin toss
  // trains the one person whose eyes are ground truth to distrust the instrument — which is the
  // disease this probe exists to treat, not to spread. Each engine RETRIES once and is then
  // REPORTED; `PROBE_ENGINES=1` turns the aggregate ("at least one engine still serves") into a
  // verdict, for when someone is investigating search specifically and wants an exit code.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('')
  console.log('CELL 7 — the real engines (from THIS machine, not from production)')
  if (process.env.PROBE_OFFLINE === '1') cannotTell('PROBE_OFFLINE=1 — the live-engine cell was asked not to run')
  else {
    // A CONTROL FIRST: if a page we know serves everyone cannot be fetched, this box has no network
    // and every engine verdict below is unreadable.
    let online = false
    try {
      const r = await fetch('https://en.wikipedia.org/wiki/Ship_of_Theseus', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; InkwaveReader/1.0; +https://inkwave.studio)' },
        signal: AbortSignal.timeout(15000),
      })
      const html = await r.text()
      online = r.ok && extractBlocks(html, 'https://en.wikipedia.org/').blocks.length > 5
    } catch { online = false }
    if (!online) cannotTell('the network control (wikipedia) did not come back — no engine verdict can be read here')
    else {
      console.log('  · CONTROL: this box can fetch and extract a known-good page, so a refusal below is the engine’s')
      const askEngine = async (eng) => {
        const url = eng.url + encodeURIComponent('identity over time philosophy')
        try {
          const r = await fetch(url, {
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; InkwaveReader/1.0; +https://inkwave.studio)' },
            signal: AbortSignal.timeout(20000),
          })
          const html = await r.text()
          const linked = extractBlocks(html, url).blocks.filter((bl) => 'runs' in bl && (bl.runs ?? []).some((x) => x.href)).length
          return { verdict: r.ok ? 'ok' : `HTTP ${r.status}`, linked }
        } catch (e) { return { verdict: 'fetch failed: ' + String(e).slice(0, 60), linked: 0 } }
      }
      let anyServed = false
      for (const eng of ENGINE_URLS) {
        let { verdict, linked } = await askEngine(eng)
        if (verdict !== 'ok' || searchLooksEmpty(linked)) {
          await new Promise((r) => setTimeout(r, 2500))
          ;({ verdict, linked } = await askEngine(eng))       // one retry — a rate limit is not a verdict
        }
        if (verdict !== 'ok') cannotTell(`${eng.name} did not answer this box`, verdict)
        else if (searchLooksEmpty(linked)) cannotTell(`${eng.name} answered 200 with no results — a challenge page, or a bad minute`, `${linked} linked blocks`)
        else { anyServed = true; console.log(`  · ${eng.name} served ${linked} linked blocks to a plain fetch`) }
      }
      // Not "this engine works" — that flaps — but "the chain has a floor". A verdict only when
      // asked for, so a bad minute upstream cannot turn this probe red.
      if (process.env.PROBE_ENGINES === '1') {
        check(anyServed, 'at least one engine in the shipped chain still serves results to a plain fetch',
          anyServed ? '' : 'every engine came back empty or refused: search has nowhere to fall')
      } else if (!anyServed) {
        cannotTell('NO engine in the chain served this box just now — re-run with PROBE_ENGINES=1 for a verdict, '
          + 'and read it as a report about the engines, not about our code')
      }
    }
  }
} catch (e) {
  console.log('  ✗ the probe itself threw — this is the PROBE, not the product, until shown otherwise')
  console.log('    ' + (e?.stack || String(e)).split('\n').slice(0, 6).join('\n    '))
  fail++
} finally {
  await ctx.close().catch(() => {})
  await b.close().catch(() => {})
  await stop()
}

console.log('')
console.log(`readerflow: ${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} failed, ${voids} inconclusive`)
process.exit(fail === 0 ? 0 : 1)
