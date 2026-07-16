// DOES THE /snapshot DOC PANE'S FIT-CAPPED CSS `zoom` MOVE THE PAGE BREAKS?
//
// PREDICTION UNDER TEST (falsify it, don't confirm it): breaks will NOT move, because
// paginateStaticDoc measures inside forceCanonicalContext with every inline `zoom` on the path
// from the editor root up to the surface pinned to 1 (staticPagination.ts ~333-340). If that
// holds, the pane zoom is a pure paint scale and ONE break table serves every zoom. If it fails,
// the table needs a per-zoom rebuild.
//
// WHY THE THREE PREVIOUS ATTEMPTS WERE VOID — and what is different here:
//   1. zoomed the EDITOR's .iw-magnify-box, where CSS zoom is BANNED. Measured a fiction.
//   2. wrong-SHAPE signal (7->4 lines IDENTICALLY at 0.5x and 2.0x — a real wrap change moves in
//      OPPOSITE directions).
//   3. aimed right, but MUTATED a live pane and waited. That can never work: paginateStaticDoc
//      computes breaks ONCE and caches them as text-node char offsets; repaint() (the sheet RO)
//      only re-reads BAND GEOMETRY ("the breaks never move, but the rendered bands do"). Offsets
//      are structurally immutable after layer creation, so its 380px known-negative could not
//      fire — and "unchanged" was measuring a constant.
//
// THIS PROBE: one FRESH PAGE LOAD PER CONDITION (fresh module = empty specCache = a real
// paginateStaticDoc measure), with the condition set in localStorage BEFORE the app boots so it
// rides production's own path:
//   • zoom      -> `inkwave:diffZoom`  -> effZoom = min(diffZoom, paneFit) -> DocLayer writes it
//                  on the paper BEFORE run() calls paginateStaticDoc (SnapshotView ~915-917).
//   • NEGATIVE  -> `inkwave:sideMargin` -> getSideMarginPx() -> forceCanonicalContext's canonical
//                  side padding -> a genuinely narrower text column, through the SAME measure.
// METRIC: staticPagination's OWN output — the .inkwave-page-gap widgets, located by the CHARACTER
// COUNT of text preceding each. Char offsets are the quantity it caches internally and are
// zoom-invariant by construction, so the visual scale cannot fool them. NOT rect-dedup (that is
// contaminated by the citation-NodeView artifact under repair on fix/collectlines-nodeview).
//
// GATE: the known-negative MUST move the offsets or NO VERDICT IS READ (exit 1).
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

// Playwright's Linux browsers have no usable OPFS here — seed the archive through an in-memory
// shim (the scrub-probe pattern), and set the CONDITION in localStorage before the app reads it.
const seed = ({ json, prefs }) => {
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
  try { for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v) } catch { /* private */ }
  window.__iwPerf = []

  // INSTRUMENT 1 — did the canonical pin actually engage? collectStaticLines measures with
  // document.createRange(); sample the paper's COMPUTED zoom on the first calls after boot. If
  // the pin works these read exactly "1" even when the live paper is zoomed.
  window.__iwZoomAtRange = []
  const origCR = Document.prototype.createRange
  Document.prototype.createRange = function () {
    if (window.__iwZoomAtRange.length < 60) {
      const p = document.querySelector('.iw-snap-layer-active .scroll-paper')?.parentElement
      if (p) window.__iwZoomAtRange.push(getComputedStyle(p).zoom)
    }
    return origCR.call(this)
  }
  // INSTRUMENT 2 — was the condition live on the paper around that paginate? Record the paper's
  // inline zoom the moment the first gap widget lands (insertGaps, immediately after the measure
  // window restores).
  window.__iwZoomAtGaps = null
  const watchGaps = () => new MutationObserver((recs) => {
    if (window.__iwZoomAtGaps !== null) return
    for (const r of recs) for (const n of r.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('inkwave-page-gap')) {
        const p = document.querySelector('.iw-snap-layer-active .scroll-paper')?.parentElement
        window.__iwZoomAtGaps = p ? (p.style.getPropertyValue('zoom') || '<none>') : '<no paper>'
        return
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
  // An init script runs at document-start — documentElement does not exist yet.
  if (document.documentElement) watchGaps()
  else document.addEventListener('readystatechange', function once() {
    if (document.documentElement) { document.removeEventListener('readystatechange', once); watchGaps() }
  })
}

// THE METRIC — one walk of the active pane: characters of text preceding each gap widget.
const GAP_SIG = () => {
  const layer = document.querySelector('.iw-snap-layer-active')
  const root = layer && (layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor'))
  if (!root) return { err: 'no pane root' }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const offsets = []
  let chars = 0, n
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) chars += n.nodeValue.length
    else if (n.classList && n.classList.contains('inkwave-page-gap')) offsets.push(chars)
  }
  const sheet = layer.querySelector('.scroll-paper')
  const paper = sheet && sheet.parentElement
  return {
    gaps: offsets.length, offsets,
    liveZoom: paper ? getComputedStyle(paper).zoom : null,
    inlineZoom: paper ? (paper.style.getPropertyValue('zoom') || '<none>') : null,
    textCol: root.getBoundingClientRect().width,
    zoomAtRange: [...new Set(window.__iwZoomAtRange.slice(0, 40))],
    zoomAtGaps: window.__iwZoomAtGaps,
  }
}

const json = buildSnapshots()
// One wide viewport for EVERY condition (paneFit = (paneW - water) / 794px must clear 1.5 or the
// zoom-in conditions get fit-capped): only the zoom differs between runs.
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })

async function run(label, prefs) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 2600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 120)))
  await page.addInitScript(seed, { json, prefs })
  await page.goto(`${BASE}/snapshot?doc=probe-doc-scrub&snap=snap-04`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor', { timeout: 40000 })
  await page.waitForFunction(() => {
    const l = document.querySelector('.iw-snap-layer-active')
    return !!l && l.querySelectorAll('.inkwave-page-gap').length > 0
  }, { timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(6000) // fonts.ready re-run + settle
  const sig = await page.evaluate(GAP_SIG)
  await ctx.close()
  console.log(`${label.padEnd(26)} gaps ${String(sig.gaps).padStart(3)}  liveZoom ${String(sig.liveZoom).padEnd(7)}` +
    ` inlineAtGaps ${String(sig.zoomAtGaps).padEnd(8)} zoomSeenByMeasure ${JSON.stringify(sig.zoomAtRange)}` +
    `  col ${sig.textCol?.toFixed(0)}px`)
  return sig
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

console.log('PREDICTION: breaks do NOT move — paginateStaticDoc pins every inline zoom to 1 inside')
console.log('its canonical window. Testing to FALSIFY.\n')

// ── KNOWN-POSITIVE: offsets non-empty and stable across two independent fresh loads at zoom 1 ──
const a1 = await run('baseline #1 (zoom 1)', {})
if (a1.err || !a1.gaps) { console.log('\nNO GAPS — cannot probe.'); await browser.close(); process.exit(1) }
const a2 = await run('baseline #2 (zoom 1)', {})
const stable = eq(a1.offsets, a2.offsets)
console.log(`KNOWN-POSITIVE: two fresh loads agree = ${stable}${stable ? '' : ' — NON-DETERMINISTIC, verdict void'}`)
if (!stable) { await browser.close(); process.exit(1) }

// ── KNOWN-NEGATIVE: a genuinely narrower canonical text column MUST move the offsets ──────────
const neg = await run('NEGATIVE sideMargin 220', { 'inkwave:sideMargin': '220' })
const fired = !eq(a1.offsets, neg.offsets)
console.log(`KNOWN-NEGATIVE (canonical side margin 96 -> 220px): breaks MOVED = ${fired}` +
  `${fired ? `  (${a1.gaps} gaps -> ${neg.gaps}; first offsets ${JSON.stringify(a1.offsets.slice(0, 3))} -> ${JSON.stringify(neg.offsets.slice(0, 3))})`
           : '  — METRIC BLIND / NOTHING RE-RAN. NO VERDICT.'}`)
if (!fired) { console.log('\nVERDICT: NONE. The negative did not fire.'); await browser.close(); process.exit(1) }

// ── THE QUESTION ──────────────────────────────────────────────────────────────────────────────
console.log('')
let allSame = true
const results = []
for (const z of [0.5, 0.75, 1.5, 2.0]) {
  const s = await run(`pane zoom ${z}`, { 'inkwave:diffZoom': String(z) })
  const same = eq(a1.offsets, s.offsets)
  if (!same) allSame = false
  results.push({ z, same, applied: s.liveZoom, gaps: s.gaps })
  console.log(`  -> breaks UNCHANGED vs zoom 1 = ${same}` +
    `${same ? '' : `   MOVED: ${JSON.stringify(a1.offsets.slice(0, 4))} -> ${JSON.stringify(s.offsets.slice(0, 4))}`}`)
}

console.log('\n──────────────────────────────────────────────────────────────')
console.log('negative fired      :', fired, '(verdict readable)')
console.log('known-positive      :', stable, '(offsets deterministic across fresh loads)')
console.log('conditions          :', JSON.stringify(results))
console.log('VERDICT: pane CSS zoom leaves the break table UNCHANGED =', allSame)
console.log(allSame
  ? '  => zoom is a pure PAINT SCALE. One break table is reusable across zooms.'
  : '  => the break table needs a PER-ZOOM REBUILD. The free-zoom claim dies.')
await browser.close()
process.exit(0)
