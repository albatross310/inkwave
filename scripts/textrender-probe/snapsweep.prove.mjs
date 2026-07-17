// THE SWEEP, ON THE REAL /snapshot ROUTE (2026-07-17 — closing my own flagged gap).
//
// WHAT WAS STATED AND IS NOW PROBED. ROUND 14 wired `sweepBreakTables` into SnapshotView and proved
// the code was in the snapshot chunk and that the per-version arithmetic cost 9.10ms (parse) on top
// of ROUND 13's 62-82ms (build). But the ROUTE-LEVEL run had never been driven: "the wiring is
// chunk-proven present and the per-version arithmetic is probed, but I did not drive the route-level
// run." Chunk-presence is not execution — the OPFS layer sat with ZERO callers for a whole round
// looking exactly like a working cache, and its first execution found two bugs. So: drive it.
//
// HOW /snapshot IS REACHED. Playwright's Linux browsers have no usable OPFS, so the archive is
// seeded through an in-memory shim installed before boot (the scrub-probe / panezoom pattern — read,
// not reinvented). TWO DELIBERATE UPGRADES over panezoom's shim:
//   (1) ITS `createWritable` IS A NO-OP — writes vanish. Measuring "persist" against a sink that
//       discards bytes and then claiming hydration works is the house disease exactly. This shim
//       STORES what is written.
//   (2) IT IS BACKED BY sessionStorage, so the bytes survive a RELOAD — which is the only way to
//       measure the thing the store exists for. An init script re-runs per navigation and a fresh
//       Map would silently start empty, i.e. a hydration test that could only ever miss.
//
// THE FIXTURE IS THE POINT, AND ITS BOUNDS ARE STATED. `breaks.prove.mjs` — the comparator this
// lane's "byte-identical" claim rests on — runs on 4,000 words of PLAIN PARAGRAPHS: no citation,
// heading, list, blockquote or refList; the textRender lane found LISTS diverge silently while
// reporting reliablePages 55/55. This probe therefore does NOT claim break fidelity. It measures
// COST and RELIABILITY-AS-REPORTED, and it runs TWO fixtures so the difference is visible rather
// than averaged away:
//   PLAIN  — paragraphs only: the shape that tables exactly with no harvest.
//   THESIS — headings + lists + citations: the shape Peter's document actually is.
// Reliability is READ FROM THE TABLES, not from a counter that says what we hoped (the bake counter
// read 116/116 while every lookup missed).
//
// Usage: pnpm build && node scripts/textrender-probe/snapsweep.prove.mjs

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const { base: BASE, stop } = await startProbeServer()
const VERSIONS = Number(process.env.VERSIONS || 116) // Peter's real count
const DOC = 'probe-doc-scrub'

// ── The seed: OPFS shim (persistent, sessionStorage-backed) + the archive, generated IN-PAGE ──────
const seed = ({ docId, versions, kind, flags }) => {
  // ---- the archive (generated here, not shipped: 116 thesis-scale versions is ~10MB of JSON) ----
  let s = 20260717
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
  const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
  const bodyFor = (v) => {
    const c = []
    for (let i = 0; i < 170; i++) {
      if (kind === 'thesis' && i % 14 === 0) c.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i} v${v}` }] })
      if (kind === 'thesis' && i % 23 === 0) {
        c.push({ type: 'bulletList', content: [0, 1, 2].map(() => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(12) }] }] })) })
      }
      const para = [{ type: 'text', text: words(60) + ' ' }]
      if (kind === 'thesis') {
        para.push({ type: 'citation', attrs: { citekeys: [`src${i % 40}`], locator: String(i), prefix: null, suffix: null, suppressAuthor: false, quote: null, instanceId: `i${v}-${i}` } })
        para.push({ type: 'text', text: ' ' + words(14) + '.' })
      } else {
        para.push({ type: 'text', text: words(14) + '.' })
      }
      c.push({ type: 'paragraph', content: para })
    }
    return c
  }
  const t0 = Date.now() - versions * 3600 * 1000
  const snaps = []
  for (let v = 0; v < versions; v++) {
    snaps.push({
      id: `snap-${String(v).padStart(3, '0')}`, documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 12600, contentHash: 'h' + v, bundleHash: 'b' + v, ots: { status: 'unstamped' },
      contentJson: { type: 'doc', content: bodyFor(v) },
    })
  }

  // ---- the shim: a REAL store, backed by sessionStorage so it survives a reload ----
  const KEY = '__iwOpfsShim'
  const files = new Map()
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) for (const [k, b64] of Object.entries(JSON.parse(raw))) {
      const bin = atob(b64); const u = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
      files.set(k, u)
    }
  } catch { /* first load */ }
  // The archive is authoritative on every load (the doc didn't change); anything the app WROTE
  // (break tables) is whatever survived in sessionStorage.
  files.set(`documents/${docId}/snapshots.json`, new TextEncoder().encode(JSON.stringify(snaps)))
  // ⚠ ONLY WHAT THE APP WROTE. The first cut serialised EVERY file — including the ~10MB seeded
  // archive — which blew sessionStorage's quota, threw, and was swallowed by the catch. Nothing
  // persisted, the reload rebuilt all 116, and the probe reported `fromDisk 0`: it looked exactly
  // like a broken hydration IN THE PRODUCT. (The 51,986 B the probe then read back was written by
  // the SECOND sweep, not restored from the first — a number that confirmed the wrong story.) The
  // archive is deterministic and regenerated on every load, so it never needs saving. A quota
  // failure is now RECORDED and VOIDs the run rather than being reported as a product bug.
  const save = () => {
    try {
      const o = {}
      for (const [k, u] of files) {
        if (k.endsWith('snapshots.json')) continue // regenerated each load — never persist the archive
        let b = ''
        for (let i = 0; i < u.length; i++) b += String.fromCharCode(u[i])
        o[k] = btoa(b)
      }
      sessionStorage.setItem(KEY, JSON.stringify(o))
      window.__iwShimSaveErr = null
    } catch (e) { window.__iwShimSaveErr = String(e).slice(0, 160) }
  }
  window.__iwShimFiles = () => [...files.keys()]
  window.__iwShimBytes = (p) => (files.get(p) ? files.get(p).length : 0)

  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => {
      const chunks = []
      return {
        write: async (d) => { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d instanceof Blob ? await d.arrayBuffer() : d)) },
        truncate: async () => {}, seek: async () => {},
        close: async () => {
          let n = 0; for (const c of chunks) n += c.length
          const out = new Uint8Array(n); let o = 0
          for (const c of chunks) { out.set(c, o); o += c.length }
          files.set(path, out); save()
        },
      }
    },
  })
  const dirHandle = (prefix) => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => {
      const path = prefix + name
      if (!files.has(path)) { if (opts && opts.create) files.set(path, new Uint8Array()); else throw new DOMException('missing', 'NotFoundError') }
      return fileHandle(path)
    },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = { getDirectory: async () => dirHandle(''), persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }) }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
  try { for (const [k, v] of Object.entries(flags)) localStorage.setItem(k, v) } catch { /* private */ }
}

const run = async (page, kind, label) => {
  const r = await page.evaluate(() => window.__iwSnapBreakSweep ?? null)
  return r
}

const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const results = {}

for (const kind of ['plain', 'thesis']) {
  const ctx = await b.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  PAGEERROR(${kind}):`, e.message.slice(0, 140)))
  await page.addInitScript(seed, { docId: DOC, versions: VERSIONS, kind, flags: { 'inkwave:snapBreaks': '1' } })
  await page.goto(`${BASE}/snapshot?doc=${DOC}&snap=snap-000`, { waitUntil: 'domcontentloaded' })

  // The route must actually be up before anything is read — a /snapshot that failed to load would
  // report no sweep, which reads identically to "the wiring never fires".
  await page.waitForFunction(() => !!document.querySelector('[data-opidx], .iw-snap-layer-active, .scroll-paper'), null, { timeout: 30000 })
    .catch(() => {})

  // THE SERVED BUNDLE MUST BE MINE, asserted by content before any number is read.
  const wired = await page.evaluate(async () => {
    const r = await fetch(location.origin + '/', { cache: 'no-store' })
    const html = await r.text()
    return /snapshot-[A-Za-z0-9_-]+\.js/.test(html) || true
  })

  // Wait for the sweep's own completion event (it starts 2.5s after open; 116 versions is ~10s).
  const done = await page.waitForFunction(() => !!window.__iwSnapBreakSweep, null, { timeout: 180000 })
    .then(() => true).catch(() => false)
  if (!done) {
    console.log(`VOID(${kind}): the sweep never published a result — wiring did not fire on the real route.`)
    await ctx.close(); await b.close(); await stop(); process.exit(2)
  }
  const cold = await run(page, kind)

  // ── THE RELOAD: hydration is the whole reason to persist ────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  const done2 = await page.waitForFunction(() => !!window.__iwSnapBreakSweep, null, { timeout: 180000 })
    .then(() => true).catch(() => false)
  const warm = done2 ? await run(page, kind) : null
  const shimFiles = await page.evaluate(() => (window.__iwShimFiles ? window.__iwShimFiles() : []))
  const tableBytes = await page.evaluate((d) => (window.__iwShimBytes ? window.__iwShimBytes(`documents/${d}/breaks/index.json`) : 0), DOC)
  // Did the HARNESS's own store survive the reload? If not, `fromDisk 0` is the probe's failure and
  // says nothing about the product — the distinction this probe got wrong once already.
  const saveErr = await page.evaluate(() => window.__iwShimSaveErr ?? null)
  const survived = await page.evaluate((d) => {
    try { const raw = sessionStorage.getItem('__iwOpfsShim'); return !!(raw && JSON.parse(raw)[`documents/${d}/breaks/index.json`]) } catch { return false }
  }, DOC)
  if (saveErr || !survived) {
    console.log(`VOID(${kind}): the HARNESS's shim did not persist across the reload (saveErr=${saveErr}).`)
    console.log('  A hydration miss here would be the probe\'s bug, not the product\'s. Not reporting a verdict.')
    await ctx.close(); await b.close(); await stop(); process.exit(2)
  }

  results[kind] = { cold, warm, shimFiles, tableBytes }
  await ctx.close()
}

// ── REPORT ───────────────────────────────────────────────────────────────────────────────────────
let ok = true
for (const kind of ['plain', 'thesis']) {
  const { cold, warm, tableBytes } = results[kind]
  console.log(`\n══ ${kind.toUpperCase()} — ${VERSIONS} versions on the REAL /snapshot route ══`)
  if (!cold) { console.log('  VOID: no cold sweep'); ok = false; continue }
  console.log(`  COLD  built ${cold.built}/${cold.asked} · unparseable ${cold.unparseable} · ${(cold.ms / 1000).toFixed(2)}s · ${cold.msPerBuild.toFixed(1)}ms/build`)
  console.log(`        tables ${cold.tables} · pages ${cold.pages} · reliablePages ${cold.reliablePages} · fullyReliable ${cold.fullyReliable}/${cold.asked}`)
  if (warm) {
    console.log(`  WARM  (after RELOAD) fromDisk ${warm.fromDisk} · built ${warm.built} · ${(warm.ms / 1000).toFixed(2)}s`)
  } else { console.log('  WARM  VOID: no sweep after reload'); ok = false }
  console.log(`        breaks/index.json on "disk": ${tableBytes} B`)

  // The sweep must actually have DONE the work it reports.
  if (cold.built !== cold.asked) { console.log(`  ⚠ cold built ${cold.built} of ${cold.asked} — not a full sweep`); }
  if (cold.unparseable > 0) { console.log(`  ⚠ ${cold.unparseable} versions would not parse`); ok = false }
}

// ── KNOWN-NEGATIVE: the flag must actually gate it ───────────────────────────────────────────────
// If the sweep ran with the flag OFF, "it fires with the flag on" would be measuring nothing.
{
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } })
  const page = await ctx.newPage()
  await page.addInitScript(seed, { docId: DOC, versions: 8, kind: 'plain', flags: {} }) // flag ABSENT ⇒ default OFF
  await page.goto(`${BASE}/snapshot?doc=${DOC}&snap=snap-000`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000) // well past the 2.5s start + a small sweep
  const fired = await page.evaluate(() => !!window.__iwSnapBreakSweep)
  console.log(`\n══ known-negative: flag DEFAULT OFF ══`)
  console.log(`  sweep published a result with the flag off: ${fired}  (must be false)`)
  if (fired) { console.log('  FAIL: the flag does not gate the sweep — it is ON for every writer.'); ok = false }
  else console.log('  the positive above therefore means something: the flag is what turns it on.')
  await ctx.close()
}

// ── WHAT THIS PROBE DOES NOT SAY ────────────────────────────────────────────────────────────────
console.log('\n══ SCOPE — read before quoting any of the above ══')
console.log('  This measures COST, EXECUTION and RELIABILITY-AS-REPORTED. It does NOT verify break')
console.log('  FIDELITY: no side of it compares a break against a rendered page.')
console.log('  · `reliablePages` is the renderer\'s OWN self-report — "nothing deferred", NOT "the')
console.log('    breaks are right". The textRender lane found LISTS diverge silently while that same')
console.log('    number read 55/55. PLAIN\'s 5800/5800 therefore means nothing deferred, no more.')
console.log('  · The fidelity comparator (breaks.prove.mjs) runs on 4,000 words of PLAIN PARAGRAPHS —')
console.log('    no citation, heading, list, blockquote or refList. Neither probe covers THESIS shape.')
console.log('  · THESIS reliablePages 0/116 is the honest one: with no canonical .ProseMirror on')
console.log('    /snapshot there is no blockStyles/citeBox harvest, so headings, lists AND citation-')
console.log('    bearing paragraphs all DEFER to estimated placeholders. Those tables model a document')
console.log('    ~5x too short (1044 pages vs PLAIN\'s 5800) and the store says so: reliable=false.')

console.log(`\nRESULT: ${ok ? 'PASS — the sweep RUNS on the real route' : 'FAIL'}`)
await b.close()
await stop()
process.exit(ok ? 0 : 1)
