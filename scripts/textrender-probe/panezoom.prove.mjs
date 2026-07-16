// DOES THE /snapshot DOC PANE'S FIT-CAPPED CSS `zoom` MOVE THE BREAKS? — probed, on the real pane.
//
// The last attempt was aimed wrong: it zoomed the EDITOR's .iw-magnify-box (where CSS zoom is
// explicitly banned — "it inflates clientWidth and breaks the paginator") and measured with a
// rect-dedup contaminated by the citation NodeView artifact. Both fixed here:
//   • drives /snapshot itself (fallback-faithful static server + OPFS-seeded archive),
//   • zooms the PANE'S OWN PAPER,
//   • reads staticPagination's REAL output — the .inkwave-page-gap widgets — as CHARACTER OFFSETS
//     of the text preceding each gap. Char offsets are zoom-independent by construction, so the
//     metric cannot be fooled by the visual scale (which is what made 7->4 look like a wrap change).
//
// KNOWN-NEGATIVE: narrowing the pane MUST move the offsets. If it doesn't, the metric is blind and
// nothing above it means anything.
import { chromium } from '@playwright/test'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`

function buildSnapshots() {
  let s = 42
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const BASE_W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis ' +
    'chapter section evidence claims analysis synthesis method critique framework ontology epistemology ' +
    'reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
  const WORDS = []
  for (let i = 0; i < 4000; i++) WORDS.push(BASE_W[i % BASE_W.length] + (i >= BASE_W.length ? i.toString(36) : ''))
  const para = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(WORDS[Math.floor(rnd() * WORDS.length)]); return o.join(' ') + '.' }
  const paras = []
  for (let i = 0; i < 200; i++) paras.push(para(30))
  const docId = 'probe-doc-scrub'
  const snaps = []
  const t0 = Date.now() - 8 * 3600 * 1000
  for (let v = 0; v < 8; v++) {
    snaps.push({
      id: `snap-${String(v).padStart(2, '0')}`, documentId: docId,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 6000, contentHash: 'p' + v, bundleHash: 'p' + v, ots: { status: 'unstamped' },
      contentJson: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    })
  }
  return JSON.stringify(snaps)
}

const opfsShim = (json) => {
  const files = new Map()
  files.set('documents/probe-doc-scrub/snapshots.json', new TextEncoder().encode(json))
  const fileHandle = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    getFile: async () => new File([files.get(path)], path.split('/').pop()),
    createWritable: async () => ({ write: async () => {}, truncate: async () => {}, seek: async () => {}, close: async () => {} }),
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
  window.__iwPerf = []
}

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 140)))
await page.addInitScript(opfsShim, buildSnapshots())
await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-04`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 40000 })
await page.waitForTimeout(9000) // veil + staticPagination

// THE METRIC: staticPagination's own gap widgets, located by the CHARACTER COUNT of text before
// each — the same quantity it caches internally (text-node char offsets), and zoom-invariant.
const gapSig = () => page.evaluate(() => {
  const layer = document.querySelector('.iw-snap-layer-active') || document
  const root = layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor')
  if (!root) return { err: 'no pane root' }
  const gaps = [...root.querySelectorAll('.inkwave-page-gap')]
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const offsets = []
  for (const g of gaps) {
    let chars = 0, n
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while ((n = w.nextNode())) {
      if (g.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) chars += n.nodeValue.length
    }
    offsets.push(chars)
  }
  const paper = layer.querySelector('.scroll-paper')
  return { gaps: gaps.length, offsets, paperZoom: paper ? getComputedStyle(paper).zoom : null, paperW: paper ? paper.clientWidth : null }
})

const base = await gapSig()
console.log('pane @ default zoom :', JSON.stringify(base).slice(0, 220))
if (base.err || !base.gaps) { console.log('NO GAPS — cannot probe; handing off'); await browser.close(); process.exit(0) }
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

const setPaperZoom = (z) => page.evaluate((z) => {
  const layer = document.querySelector('.iw-snap-layer-active') || document
  const paper = layer.querySelector('.scroll-paper')
  if (!paper) return false
  paper.style.setProperty('zoom', String(z))
  window.dispatchEvent(new CustomEvent('inkwave:zoom-settled'))
  return true
}, z)

let allSame = true
for (const z of [0.5, 0.75, 1.5]) {
  await setPaperZoom(z)
  await page.waitForTimeout(3000)
  const s = await gapSig()
  const same = eq(base.offsets, s.offsets)
  if (!same) allSame = false
  console.log(`paper zoom ${z} : breaks UNCHANGED = ${same}  (gaps ${s.gaps}, paperW ${s.paperW})${same ? '' : '  ' + JSON.stringify(s.offsets.slice(0, 6))}`)
}
await setPaperZoom(1); await page.waitForTimeout(2000)

// KNOWN-NEGATIVE: a real width change must move the breaks.
await page.evaluate(() => {
  const layer = document.querySelector('.iw-snap-layer-active') || document
  const p = layer.querySelector('.ProseMirror'); if (p) p.style.width = '380px'
  window.dispatchEvent(new CustomEvent('inkwave:zoom-settled'))
})
await page.waitForTimeout(3500)
const narrow = await gapSig()
const moved = !eq(base.offsets, narrow.offsets)
console.log(`\nKNOWN-NEGATIVE (pane column 380px): breaks MOVED = ${moved} ${moved ? '(metric fires)' : '(METRIC BLIND — ignore everything above)'}`)
console.log(`\nVERDICT: pane CSS zoom leaves breaks unchanged = ${allSame}; metric discriminates = ${moved}`)
await browser.close()
