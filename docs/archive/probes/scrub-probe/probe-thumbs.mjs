// Pre-baked snapshot thumbnail proof. Uses a REAL in-memory OPFS shim (the base probe shim
// discards writes) so thumbnails round-trip. Flow: enable inkwave:snapThumbs → slow-walk a range
// so the presenter captures + BAKES doc/diff/map thumbnails to OPFS → measure combined bytes/snap
// (per pane, from the index) → DISPOSE the presenter (cold in-memory bitmap cache; OPFS persists) →
// FAST-FLING the same range and measure per-pane exactRate + frames: real versions must now HYDRATE
// from the ~KB WebP store instead of rendering. chromium deviceScaleFactor 2.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const PORT = process.env.PROBE_PORT || 4226, BASE = `http://127.0.0.1:${PORT}`
const OUT = new URL('.', import.meta.url).pathname
const src = await readFile(new URL('./probe.mjs', import.meta.url), 'utf8')
const buildSnapshots = new Function(src.slice(src.indexOf('function buildSnapshots'), src.indexOf('// Runs BEFORE app scripts')) + '; return buildSnapshots()')
const stepFn = eval('(' + src.slice(src.indexOf('async (dir) => {'), src.indexOf('// A trackpad-scrub')).trim().replace(/;\s*$/, '') + ')')

// REAL in-memory OPFS + enable the thumbnail flag, injected before the app in every frame.
const realOpfsShim = (json) => {
  const files = new Map()
  files.set('documents/probe-doc-scrub/snapshots.json', new TextEncoder().encode(json))
  const toU8 = async (d) => d instanceof Blob ? new Uint8Array(await d.arrayBuffer())
    : d && d.buffer ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
    : new Uint8Array(d)
  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path) ?? new Uint8Array()], path.split('/').pop()),
    createWritable: async () => { let chunks = []; return {
      write: async (d) => { chunks.push(await toU8(d)) },
      truncate: async () => { chunks = [] }, seek: async () => {},
      close: async () => { let n = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(n), o = 0; for (const c of chunks) { out.set(c, o); o += c.length } files.set(path, out) },
    } },
  })
  const dirHandle = (prefix) => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || '',
    getDirectoryHandle: async (name) => dirHandle(prefix + name + '/'),
    getFileHandle: async (name, opts) => { const path = prefix + name; if (!files.has(path)) { if (opts && opts.create) files.set(path, new Uint8Array()); else throw new DOMException('missing', 'NotFoundError') } return fileHandle(path) },
    removeEntry: async (name) => { files.delete(prefix + name) },
    values: async function* () {}, keys: async function* () {}, entries: async function* () {},
  })
  const shim = { getDirectory: async () => dirHandle(''), persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }) }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
  window.__iwPerf = []
  window.__iwSnapThumbs = true
  window.__iwOpfsFiles = files
}

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1) }
const rate = (a) => a.length ? +(a.filter((x) => x === 1).length / a.length).toFixed(2) : null

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))
await page.addInitScript(realOpfsShim, buildSnapshots())
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-26`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 30000 })
await page.waitForTimeout(5500)

// ── BAKE: slow-walk snap-26 → snap-12, settling so each version captures + bakes all 3 panes ──
for (let i = 0; i < 14; i++) { await page.evaluate(stepFn, -1); await page.waitForTimeout(1200) }
for (let i = 0; i < 6; i++) { await page.evaluate(stepFn, 1); await page.waitForTimeout(1200) } // land ~snap-20
await page.waitForTimeout(4000) // let encodes + OPFS writes drain

// Read the thumbnail index straight from OPFS to report per-pane bytes.
const store = await page.evaluate(async () => {
  const files = window.__iwOpfsFiles
  let idx = null
  for (const [k, v] of files) if (k.endsWith('/thumbs/index.json')) idx = JSON.parse(new TextDecoder().decode(v))
  const byPane = { doc: { n: 0, bytes: 0 }, diff: { n: 0, bytes: 0 }, map: { n: 0, bytes: 0 } }
  let totalFiles = 0, totalBytes = 0
  for (const [k, v] of files) { if (k.includes('/thumbs/') && k.endsWith('.webp')) { totalFiles++; totalBytes += v.length } }
  const snaps = new Set()
  if (idx) for (const key of Object.keys(idx.entries)) { const [snap, pane] = key.split('|'); snaps.add(snap); if (byPane[pane]) { byPane[pane].n++; byPane[pane].bytes += idx.entries[key].bytes } }
  const avg = (p) => byPane[p].n ? Math.round(byPane[p].bytes / byPane[p].n) : 0
  return {
    thumbFiles: totalFiles, thumbBytesTotal: totalBytes, versionsBaked: snaps.size,
    perPaneAvgBytes: { doc: avg('doc'), diff: avg('diff'), map: avg('map') },
    combinedBytesPerSnapshot: snaps.size ? Math.round(totalBytes / snaps.size) : 0,
    memCacheEntries: window.__iwScrub?.stats?.().entries ?? null,
  }
})

// ── COLD: dispose the presenter (drops in-memory bitmaps; OPFS persists) then re-wire it ──
// Landing after the bake walk is ~snap-18; keep the flings INSIDE the baked span (snap-12..26).
await page.evaluate(() => window.__iwScrub?.dispose?.())
await page.evaluate(stepFn, 1); await page.waitForTimeout(700)
await page.evaluate(stepFn, -1); await page.waitForTimeout(900) // re-render mounts a fresh presenter + surfaces
const coldStats = await page.evaluate(() => window.__iwScrub?.stats?.())

const flingRun = async (dir, events, gap) => await page.evaluate(async ({ dir, events, gap }) => {
  window.__iwPerf.length = 0
  const frames = []; let rafOn = true, last = 0
  requestAnimationFrame(function loop(t) { if (last) frames.push(t - last); last = t; if (rafOn) requestAnimationFrame(loop) })
  for (let i = 0; i < events; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dir > 0 ? 120 : -120, shiftKey: true, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, gap)) }
  await new Promise(r => setTimeout(r, 450)) // let async hydrations land
  rafOn = false
  const ex = (k) => window.__iwPerf.filter(e => e[0] === 'scrub.exact.' + k).map(e => e[1])
  const shownDoc = window.__iwPerf.filter(e => e[0] === 'scrub.shown').map(e => e[1])
  return {
    _d: ex('doc'), _f: ex('diff'), _m: ex('map'),
    presentsPerPane: { doc: ex('doc').length, diff: ex('diff').length, map: ex('map').length },
    docDistinctPresented: new Set(shownDoc).size,
    frames: frames.map(f => +f.toFixed(1)),
    memEntries: window.__iwScrub?.stats?.().entries ?? null,
    counter: document.body.textContent.match(/v\d+\.\d+\/\d+\.\d+/)?.[0] ?? null,
  }
}, { dir, events, gap })
// fling1 = genuinely cold first pass (hydration races the fast fling). Forward snap-18→~24 (baked).
const fling = await flingRun(1, 6, 12)
// fling2 = same span again after hydration has landed — the steady "loads from store" result.
await page.waitForTimeout(700)
const fling2 = await flingRun(-1, 6, 20)

const out = {
  deviceScaleFactor: 2,
  store,
  coldMemCacheEntries_afterDispose: coldStats?.entries ?? null,
  cold_fling1_firstPass: {
    exactRate: { doc: rate(fling._d), diff: rate(fling._f), map: rate(fling._m) },
    presentsPerPane: fling.presentsPerPane, docDistinctPresented: fling.docDistinctPresented,
    memEntriesAfter: fling.memEntries, // hydrations from OPFS populate the in-memory cache
    frames: { p50: med(fling.frames), max: fling.frames.length ? +Math.max(...fling.frames).toFixed(1) : null, n: fling.frames.length },
    counter: fling.counter,
  },
  warm_fling2_fromStore: {
    exactRate: { doc: rate(fling2._d), diff: rate(fling2._f), map: rate(fling2._m) },
    presentsPerPane: fling2.presentsPerPane, docDistinctPresented: fling2.docDistinctPresented,
    memEntriesAfter: fling2.memEntries,
    frames: { p50: med(fling2.frames), max: fling2.frames.length ? +Math.max(...fling2.frames).toFixed(1) : null, n: fling2.frames.length },
    counter: fling2.counter,
  },
}
console.log(JSON.stringify(out, null, 2))
await writeFile(`${OUT}/results-thumbs.json`, JSON.stringify(out, null, 2))
await browser.close()
