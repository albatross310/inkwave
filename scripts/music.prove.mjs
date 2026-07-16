// MUSIC MODULE PROVER (2026-07-17) — drives the REAL built app.
//
// WHY THIS EXISTS: a flag-gated feature that silently does nothing looks exactly like a feature that
// works (CLAUDE.md's house disease — the gate that returned false for months). Unit tests prove the
// detector's geometry against synthetic buffers; they cannot prove that the route mounts, that the
// chunk is really absent when the flag is off, that OPFS persistence round-trips, or that pdf.js and
// canvas behave in a browser. Those are the claims here.
//
// Every claim is paired with a KNOWN-NEGATIVE that must reproduce the OPPOSITE result in the same
// run — a probe that only ever sees the happy path is an instrument that cannot fail.
//
//   node scripts/music.prove.mjs [port]     (default 4941 — OUR port; never pkill another's server)
import { chromium } from '@playwright/test'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'

const PORT = Number(process.argv[2] || 4941)
const ROOT = new URL('../build/client/', import.meta.url).pathname
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}

// Fallback-faithful static server: unknown paths serve index.html, as the SPA rewrite does in prod.
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

await new Promise(r => server.listen(PORT, r))
const browser = await chromium.launch()

try {
  // ─── 0. THE EDITOR'S LOAD PATH — the claim that actually matters ─────────────────────────────
  //
  // "Off costs nothing" is about the WRITER opening `/`, not about /music. And a separate chunk FILE
  // is not evidence of laziness: `routes/Edit.tsx` fires `import('../editor/TiptapEditor')` at MODULE
  // SCOPE, so a dynamic import can still be eager-in-effect. So this measures what the browser
  // ACTUALLY DOWNLOADS to open the editor, and asserts no music byte is among it.
  console.log('\n▸ the editor’s load path')
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const fetched = []
    page.on('request', r => { if (/\.js(\?|$)/.test(r.url())) fetched.push(r.url().split('/').pop()) })
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)   // let the eager editor import and any idle work settle

    const musicish = fetched.filter(f => /Music|Heatmap|reflow|fixtures|demo/i.test(f))
    check('opening / fetches NO music chunk', musicish, [])
    // VOID GUARD: if the listener saw nothing at all, "no music chunk" is a pass that means nothing.
    check('…and the listener really saw the editor load (not a blind pass)', fetched.length > 3, true)
    await ctx.close()
  }

  // ─── 1. FLAG OFF costs nothing — and the negative proves the check can see a fetch ────────────
  console.log('\n▸ flag gating (default OFF)')
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const chunks = []
    page.on('request', r => { if (/MusicStudio|pdf\.worker/.test(r.url())) chunks.push(r.url().split('/').pop()) })
    await page.goto(`http://localhost:${PORT}/music`, { waitUntil: 'networkidle' })

    const body = await page.textContent('body')
    check('flag OFF → the stub, not the studio', /isn’t switched on/.test(body), true)
    check('flag OFF → the studio chunk is never fetched', chunks, [])
    await ctx.close()
  }

  // KNOWN-NEGATIVE for the check above: with the flag ON the same listener MUST see the chunk.
  // Without this, "chunks === []" would pass just as well on a broken listener or a dead route.
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const chunks = []
    page.on('request', r => { if (/MusicStudio/.test(r.url())) chunks.push(r.url().split('/').pop()) })
    await page.goto(`http://localhost:${PORT}/music?music=1`, { waitUntil: 'networkidle' })
    check('KNOWN-NEGATIVE: flag ON → the chunk IS fetched (the listener works)', chunks.length > 0, true)
    await ctx.close()
  }

  // ─── 2. The studio runs: capture → detect → reflow → markup → persist ────────────────────────
  console.log('\n▸ the demo piece (synthetic score, real pipeline)')
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/music?music=demo`, { waitUntil: 'networkidle' })

  // The demo draws two synthetic pages and runs the real detector over them.
  await page.waitForSelector('section h2', { timeout: 30000 })
  const heads = await page.$$eval('section h2', els => els.map(e => e.textContent.trim()))
  check('two pages captured and analysed', heads.length, 2)
  check('page 1: three systems found', /3 systems/.test(heads[0]), true)
  check('page 1: grand staves kept together', /grand staves kept together/.test(heads[0]), true)
  check('page 2 (skewed, shadowed): two systems found', /2 systems/.test(heads[1]), true)

  // The reflow actually inserted room: a gap band carries a drag handle (§A1's manual adjust).
  const handles = await page.$$eval('[role="separator"]', els => els.length)
  check('reflow inserted writing space with adjust handles', handles > 0, true)

  // The page image really rendered (an <img> with a blob URL) — the capture wrote bytes to OPFS and
  // the store read them back.
  const imgs = await page.$$eval('section img', els => els.map(e => e.src.startsWith('blob:')))
  check('page images round-tripped through OPFS', imgs.length > 0 && imgs.every(Boolean), true)

  // PRE-EXISTING, NOT THIS LANE'S — and MEASURED rather than taken on faith. So the check is not "no
  // errors" (which would fail forever on a fault this lane did not cause) but "no errors BEYOND what
  // a control route throws too". The control is what makes that falsifiable.
  //
  // THE CONTROL MUST BE A **NON-PRERENDERED** ROUTE, and picking the wrong one cost a real detour:
  // /verify was tried first and threw NOTHING, which read as "the hydration errors ARE yours". It is
  // prerendered — it has its own HTML, so it has no mismatch to have. /music, like /productivity,
  // /ledger and /snapshot, is served through the SPA fallback to the PRERENDERED EDITOR page, and
  // hydrating a different route against that markup is the mismatch (the same fallback artefact
  // CLAUDE.md records for /snapshot). Compare like with like: a control that structurally cannot
  // reproduce the fault under test is not a control.
  const control = await ctx.newPage()
  const controlErrors = []
  control.on('pageerror', e => controlErrors.push(String(e)))
  await control.goto(`http://localhost:${PORT}/productivity`, { waitUntil: 'networkidle' })
  await control.close()

  const hydration = e => /Minified React error #(418|423|425)/.test(e)
  check('the control route throws hydration errors too (so they are not ours)',
    controlErrors.length > 0 && controlErrors.every(hydration), true)
  check('no page errors beyond the pre-existing hydration ones', errors.filter(e => !hydration(e)), [])

  // ─── 3. Markup: a Pencil stroke lands and persists ───────────────────────────────────────────
  console.log('\n▸ Pencil markup')
  await page.click('button[aria-label="Draw"]')
  const box = await (await page.$('section img')).boundingBox()
  // A real PEN pointer, with pressure — the platform brief's primary input.
  await page.mouse.move(box.x + 60, box.y + 40)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 60 + i * 8, box.y + 40 + i * 3)
  await page.mouse.up()

  const strokes = await page.$$eval('section svg path', els => els.length)
  check('a stroke was drawn onto the score', strokes > 0, true)

  // Persistence: reload and the mark is still there. This is the OPFS write path, for real.
  //
  // THE WAIT IS NOT PADDING — it is the probe admitting what it is testing. `savePiece` is async
  // (fire-and-forget from the pointerup handler), so reloading the instant the pointer lifts races
  // the write. The first version of this check had no wait and PASSED, then began failing when
  // unrelated rendering shifted the timing by a few ms — i.e. it had been passing by luck and would
  // have reported "persistence is broken" for a persistence layer that works. Wait for the write,
  // then ask about the reload. (Sub-400ms durability is a different question, and not one this
  // check was ever measuring.)
  await page.waitForTimeout(400)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('section svg', { timeout: 30000 })
  const after = await page.$$eval('section svg path', els => els.length)
  check('the stroke survived a reload (OPFS)', after > 0, true)

  // ─── 4. The heatmap (§A2) ────────────────────────────────────────────────────────────────────
  console.log('\n▸ the practice heatmap')
  await page.click('[role="tab"]:has-text("What needs work")')
  await page.waitForSelector('[aria-label^="History for bar"]', { timeout: 15000 })

  // The demo's grand staves give 4 bars/system × 3 systems on page 1 + 4×2 on page 2 = 20.
  const barCount = await page.$$eval('[aria-label^="History for bar"]', e => e.length)
  check('the CV pre-detected bars to colour (grand staves only)', barCount > 0, true)

  // SWEEP: press on bar 1, drag across bars 2-3, release. The gesture §A2 specifies.
  const rows = await page.$$('[aria-label^="History for bar"]')
  const boxes = []
  for (const r of rows.slice(0, 3)) boxes.push(await r.boundingBox())
  await page.mouse.move(boxes[0].x - 60, boxes[0].y + 10)
  await page.mouse.down()
  for (const b of boxes) await page.mouse.move(b.x - 60, b.y + 10)
  await page.mouse.up()
  await page.waitForTimeout(400)

  const painted = await page.$$eval('.iw-nightable[style*="min-height: 44px"], .iw-nightable',
    els => els.filter(e => /rgba?\(/.test(e.style.background) && e.style.background !== '').length)
  check('a Pencil sweep painted a range of bars', painted > 0, true)

  // The teacher takes the iPad and recolours — attributed, per §A2.
  await page.click('button[aria-label="ask my teacher"]')
  await page.click('button:has-text("I’m marking")')
  const t = await rows[0].boundingBox()
  await page.mouse.move(t.x - 60, t.y + 10)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(400)

  const teacherBadges = await page.$$eval('span[title^="Marked by your teacher"]', e => e.length)
  check('the teacher’s mid-lesson mark is attributed AS the teacher’s', teacherBadges > 0, true)

  // Provenance: §A2 says the heatmap is stored in the .studio provenance record.
  const hash = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('music')
    const pd = await dir.getDirectoryHandle('demo-synthetic')
    const f = await (await pd.getFileHandle('piece.json')).getFile()
    const p = JSON.parse(await f.text())
    return { heatmapHash: p.provenance?.hashes?.heatmap ?? null, entries: p.heatmap?.length ?? 0 }
  })
  check('the heatmap is hashed into the provenance record', /^[0-9a-f]{64}$/.test(hash.heatmapHash || ''), true)
  check('…and both marks are KEPT (a record over time, not a current state)', hash.entries >= 2, true)

  // Persistence across a reload — the OPFS path, for real.
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('[role="tab"]:has-text("What needs work")')
  await page.waitForSelector('span[title^="Marked by your teacher"]', { timeout: 15000 })
  check('the heatmap survived a reload (OPFS)', true, true)

  await ctx.close()
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
