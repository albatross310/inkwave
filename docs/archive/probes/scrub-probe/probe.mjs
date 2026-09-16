// /snapshot scrub-bitmap probe: seeds a thesis-scale doc (36 snapshots, ~20k words) through an
// OPFS shim (Playwright's Linux WebKit has NO navigator.storage; the shim serves the read path
// the app uses — getDirectory → dir chain → getFileHandle('snapshots.json').getFile()), walks
// history to warm the raster cache, then drives a 20-step scrub with FIXED-INTERVAL inputs
// (70ms — like real wheel notches/touchmoves; the first probe gated each input on paint, so
// inputs never came <250ms apart and bitmap mode never engaged) — bitmaps ON vs OFF
// (window.__iwScrub.show stubbed) — plus isolated single flips (the no-regression check) and
// at-rest swap screenshots for seamlessness evidence.
import { chromium, webkit, devices } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const PORT = process.env.PROBE_PORT || 4211
const BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname

// ── Seed data (generated in Node, injected via init script) ──────────────────────────────────
function buildSnapshots() {
  let s = 42
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  // Diverse vocabulary + ONE localised edit cluster per snapshot. The first probe used ~60
  // words on repeat with edits scattered across the whole doc — diffWords' prefix/suffix trim
  // left a >2k-token middle, blowing the LCS cell cap into a coarse whole-middle del+add
  // (+11.7k "changed" words per adjacent pair — nothing like a real snapshot, and it made the
  // live panes pathologically heavy). Real snapshots are one resolved kick: ~10 words, local.
  const BASE_W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis ' +
    'chapter section evidence claims analysis synthesis method critique framework ontology epistemology ' +
    'reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
  const WORDS = []
  for (let i = 0; i < 4000; i++) WORDS.push(BASE_W[i % BASE_W.length] + (i >= BASE_W.length ? i.toString(36) : ''))
  const para = (n) => {
    const out = []
    for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rnd() * WORDS.length)])
    return out.join(' ') + '.'
  }
  const paras = []
  for (let i = 0; i < 660; i++) paras.push(para(30)) // ~20k words
  const docId = 'probe-doc-scrub'
  const snaps = []
  const t0 = Date.now() - 36 * 3600 * 1000
  for (let v = 0; v < 36; v++) {
    const pi = Math.floor(rnd() * paras.length)
    const ws = paras[pi].split(' ')
    const at = Math.floor(rnd() * Math.max(1, ws.length - 10))
    for (let e = 0; e < 8; e++) ws[Math.min(ws.length - 1, at + e)] = WORDS[Math.floor(rnd() * WORDS.length)]
    paras[pi] = ws.join(' ')
    if (v % 3 === 0) paras[pi] += ' ' + para(8)
    snaps.push({
      id: `snap-${String(v).padStart(2, '0')}`,
      documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(),
      trigger: v % 12 === 0 ? 'manual' : 'word-nudge',
      wordCount: paras.join(' ').split(/\s+/).length,
      contentHash: 'probe-' + v,
      bundleHash: 'probe-' + v,
      ots: { status: 'unstamped' },
      contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    })
  }
  return JSON.stringify(snaps)
}

// Runs BEFORE app scripts in every frame: installs a minimal OPFS with the seeded archive.
const opfsShim = (json) => {
  const files = new Map()
  files.set('documents/probe-doc-scrub/snapshots.json', new TextEncoder().encode(json))
  const fileHandle = (path) => ({
    kind: 'file',
    name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => ({ write: async () => {}, truncate: async () => {}, seek: async () => {}, close: async () => {} }),
  })
  const dirHandle = (prefix) => ({
    kind: 'directory',
    name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => {
      const path = prefix + name
      if (!files.has(path)) {
        if (opts && opts.create) files.set(path, new Uint8Array())
        else throw new DOMException('missing', 'NotFoundError')
      }
      return fileHandle(path)
    },
    removeEntry: async () => {},
    values: async function* () {},
    keys: async function* () {},
  })
  const shim = {
    getDirectory: async () => dirHandle(''),
    persist: async () => true,
    persisted: async () => true,
    estimate: async () => ({ quota: 1e9, usage: 0 }),
  }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) }
  catch { navigator.storage = shim }
  window.__iwPerf = []
}

// One paint-gated step (for the slow walk + isolated-flip latency).
const stepFn = async (dir) => {
  const t0 = performance.now()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: dir > 0 ? 'ArrowRight' : 'ArrowLeft' }))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return performance.now() - t0
}

// A trackpad-scrub burst through the REAL production path: horizontal wheel events on the doc
// pane → the position-scrubber → scrubBy (virtualIdx handles renders lagging inputs) → goTo.
// CATCH-UP dispatch models real hardware event queues (when a render blocks, pending events
// deliver back-to-back; their timeStamps carry the original cadence). rAF frame recorder rides
// along. deltaX sign: positive = previous, negative = next (the scrubber reverses it).
const burstFn = async ({ dir, events, interval }) => {
  const frames = []
  let rafOn = true, last = 0
  requestAnimationFrame(function loop(t) {
    if (last) frames.push(t - last)
    last = t
    if (rafOn) requestAnimationFrame(loop)
  })
  // Re-query per dispatch: the scrub listener rides the ACTIVE layer's scroller, which changes
  // on every landing — a real trackpad targets whatever is under the cursor (always the active
  // layer, same screen position).
  const paneOf = () => document.querySelector('.iw-snap-layer-active .iw-snap-scroll') || document.querySelector('.iw-snap-scroll')
  const t0 = performance.now()
  let sent = 0
  while (sent < events) {
    const due = Math.min(events, Math.floor((performance.now() - t0) / interval) + 1)
    while (sent < due) {
      paneOf().dispatchEvent(new WheelEvent('wheel', { deltaX: dir > 0 ? -9 : 9, deltaY: 0, bubbles: true, cancelable: true }))
      sent++
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  await new Promise((r) => setTimeout(r, 60))
  rafOn = false
  return { frames: frames.map((f) => +f.toFixed(1)) }
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
const summarize = (a) => a.length ? { p50: median(a), max: +Math.max(...a).toFixed(1), all: a.map((v) => +v.toFixed(1)) } : null
const frameStats = (frames) => frames.length ? { p50: median(frames), max: +Math.max(...frames).toFixed(1), over50ms: frames.filter((f) => f > 50).length } : null

async function runScenario(browserType, name, contextOpts, snapsJson) {
  const browser = await browserType.launch({ headless: true })
  const ctx = await browser.newContext(contextOpts)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, String(e).slice(0, 300)))
  await page.addInitScript(opfsShim, snapsJson)

  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-30`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
  await page.waitForTimeout(5000) // veil + pagination + first idle captures

  const res = { name }
  const perfOf = (label) => page.evaluate((l) => window.__iwPerf.filter((e) => e[0] === l).map((e) => e[1]), label)

  // ── Phase 1: slow walk (each visited snapshot captures doc+diff+map in idle) ──
  for (let i = 0; i < 5; i++) { await page.evaluate(stepFn, 1); await page.waitForTimeout(1300) }
  for (let i = 0; i < 21; i++) { await page.evaluate(stepFn, -1); await page.waitForTimeout(1300) }
  await page.waitForTimeout(3000)
  const captures = await perfOf('scrub.capture')
  const stats1 = await page.evaluate(() => window.__iwScrub && window.__iwScrub.stats())

  // ── Phase 2: ~22-step fast scrub FORWARD over the walked region (bitmaps ON) ──
  await page.evaluate(() => { window.__iwPerf.length = 0 })
  const burstOn = await page.evaluate(burstFn, { dir: 1, events: 26, interval: 60 })
  const shot = async () => { try { return await page.screenshot({ timeout: 45000 }) } catch { return null } }
  const shotA = await shot() // overlay still up (landing render is slower than rest+paint)
  const counterA = await page.evaluate(() => document.body.textContent.match(/v\d+\.\d+\/\d+\.\d+/)?.[0] ?? null)
  await page.waitForTimeout(2000)
  const shotB = await shot() // settled live frame
  const counterB = await page.evaluate(() => document.body.textContent.match(/v\d+\.\d+\/\d+\.\d+/)?.[0] ?? null)
  if (shotA) await writeFile(`${OUT}/${name}-swap-before.png`, shotA)
  if (shotB) await writeFile(`${OUT}/${name}-swap-after.png`, shotB)
  const bmpSteps = await perfOf('scrub.step')
  const bmpMiss = await perfOf('scrub.step.miss')

  // ── Phase 3: same scrub BACK, presenter stubbed = the "before" behaviour ──
  await page.waitForTimeout(1000)
  await page.evaluate(() => {
    window.__iwPerf.length = 0
    window.__iwScrubShow = window.__iwScrub.show
    window.__iwScrub.show = () => {}
  })
  const burstOff = await page.evaluate(burstFn, { dir: -1, events: 26, interval: 60 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => { window.__iwScrub.show = window.__iwScrubShow })

  // ── Phase 4: isolated single flips (>250ms apart — must stay the LIVE path, no overlay) ──
  await page.evaluate(() => { window.__iwPerf.length = 0 })
  const singles = []
  for (let i = 0; i < 5; i++) { singles.push(await page.evaluate(stepFn, 1)); await page.waitForTimeout(800) }
  const singleBmp = await perfOf('scrub.step')

  // Pixel-diff the swap screenshots in-page
  const swapDiff = (!shotA || !shotB) ? null : await page.evaluate(async ([a, b]) => {
    const load = (buf) => new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.src = 'data:image/png;base64,' + buf })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height)
    const cv = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data }
    const da = cv(ia), db = cv(ib)
    let diff = 0
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) diff++
    }
    return { diffPct: +(100 * diff / (w * h)).toFixed(2), w, h }
  }, [shotA.toString('base64'), shotB.toString('base64')])

  const stats2 = await page.evaluate(() => window.__iwScrub && window.__iwScrub.stats())
  res.captures = { count: captures.length, msMedian: median(captures), msMax: captures.length ? +Math.max(...captures).toFixed(1) : null }
  res.cache = { afterWalk: stats1, final: stats2 }
  res.scrubOn = {
    framesDuringBurst: frameStats(burstOn.frames),
    bitmapShown: bmpSteps.length, bitmapMiss: bmpMiss.length, showMs: summarize(bmpSteps),
    counterAtBurstEnd: counterA, counterSettled: counterB,
  }
  res.scrubOff = { framesDuringBurst: frameStats(burstOff.frames) }
  res.singles = { toPaintMs: summarize(singles), bitmapStepsFired: singleBmp.length }
  res.swapDiff = swapDiff
  await browser.close()
  return res
}

const snapsJson = buildSnapshots()
const results = []
for (const [bt, name, opts] of [
  [chromium, 'chromium-desktop', { viewport: { width: 1600, height: 900 } }],
  [webkit, 'webkit-iphone', { ...devices['iPhone 13'] }],
]) {
  try {
    const r = await runScenario(bt, name, opts, snapsJson)
    results.push(r)
    console.log(`\n=== ${name} ===\n` + JSON.stringify(r, null, 2))
  } catch (e) {
    results.push({ name, error: String(e).slice(0, 500) })
    console.log(`\n=== ${name} FAILED ===\n` + String(e).slice(0, 800))
  }
}
await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2))
