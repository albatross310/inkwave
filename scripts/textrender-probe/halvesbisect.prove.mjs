// WHICH CONTENT KIND MAKES THE TWO HALVES DISAGREE? — the control bisect.
//
// bothhalves.prove.mjs VOIDED on its CONTROL: with NO diff marks, on the document the model models
// exactly, the canvas said 58 pages and the DOM pane said 61. That must be understood before any
// diff question means anything — a 3-page disagreement on plain content is not a rounding error.
//
// A rate over a mixed document cannot say WHICH ingredient diverged (the lesson from isolate/
// linecount: math showed 0 mid-line breaks unfixed because no break happened to land on one). So
// vary ONE kind at a time: prose is the floor both halves must agree on; each addition is a suspect.
//
// THE TWO HALVES:
//   canvas = buildRenderModel(doc, …) on the EDITOR route — the model scrub frames paint from. It is
//     PROVED to match the LIVE EDITOR's own gap widgets byte-for-byte (breaks.prove.mjs).
//   DOM    = the /snapshot pane's DocView (ops === null ⇒ no marks), paginated by staticPagination's
//     own forced-canonical measure.
// So a disagreement here means the PANE renders the document differently from the EDITOR — and the
// model is not wrong, the pane is a different renderer.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const DOC_ID = 'probe-doc-scrub'

const SHAPES = [
  ['prose only',               { words: 6000, cites: 0,  marked: 0, lists: false, refList: false, headings: false }],
  ['+ headings',               { words: 6000, cites: 0,  marked: 0, lists: false, refList: false, headings: true }],
  ['+ lists',                  { words: 6000, cites: 0,  marked: 0, lists: true,  refList: false, headings: true }],
  ['+ citations',              { words: 6000, cites: 80, marked: 1, lists: true,  refList: false, headings: true }],
  ['+ refList (thesis shape)', { words: 6000, cites: 80, marked: 1, lists: true,  refList: true,  headings: true }],
  // THESIS SCALE, no refList — isolates whether the CITATION-WIDTH divergence accumulates. The
  // model uses citeBox (the EDITOR's CitationNodeView: nowrap, margin 0 2px, the ⤵ biblink, real
  // CSL); the pane renders DocView's bare `simpleInText` span. Different elements, different
  // advances. At 80 cites / 6k words it may not cross a page boundary; at 174 / 13k it should.
  ['THESIS 13k, 174 cites, NO refList', { words: 13000, cites: 174, marked: 1, lists: true, refList: false, headings: true }],
  ['THESIS 13k, 174 cites, + refList',  { words: 13000, cites: 174, marked: 1, lists: true, refList: true,  headings: true }],
]

const seed = ({ json, lib }) => {
  const files = new Map()
  const enc = new TextEncoder()
  files.set('documents/probe-doc-scrub/snapshots.json', enc.encode(json))
  files.set('library/citations.json', enc.encode(lib))
  const fh = (path) => ({ kind: 'file', name: path.split('/').pop(), getFile: async () => new File([files.get(path)], 'f'), createWritable: async () => ({ write: async () => {}, truncate: async () => {}, seek: async () => {}, close: async () => {} }) })
  const dh = (prefix) => ({
    kind: 'directory', name: '',
    getDirectoryHandle: async (n) => dh(prefix + n + '/'),
    getFileHandle: async (n, o) => { const path = prefix + n; if (!files.has(path)) { if (o && o.create) files.set(path, new Uint8Array()); else throw new DOMException('missing', 'NotFoundError') } return fh(path) },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = { getDirectory: async () => dh(''), persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }) }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }
}

// THE COMMON AXIS: characters of RENDERED TEXT preceding each page-gap widget. Both the editor and
// the pane emit `.inkwave-page-gap` into their own DOM, so one walk answers both — and a char offset
// is what a page break IS to a reader ("the page turns after this word"), which a page COUNT is not.
//
// WHY THIS EXISTS (2026-07-18): this probe compared page COUNTS. That is the exact defect it was
// built to hunt — measured elsewhere on this lane, a lists fixture read model 55p / live 55p while
// the break POSITIONS diverged from break 23 onward. So every Δ0 row this probe ever printed
// established "the same NUMBER of pages", never "the same words on them", and the snap fix's own
// verification inherited that. Counts agreeing while positions diverge is precisely how wrong words
// sit on a right-numbered page.
// (Inlined below rather than shared: page.evaluate serialises ONE function and cannot reach module
// scope — a helper here throws ReferenceError in the page, which is a loud failure, not a silent one.)
const PANE = () => {
  const layer = document.querySelector('.iw-snap-layer-active') || document.querySelector('.iw-snap-layer')
  const root = layer && (layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor'))
  if (!root) return { err: 'no pane root' }
  const g = (() => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    const offs = []
    let chars = 0, n
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) chars += n.nodeValue.length
      else if (n.classList && n.classList.contains('inkwave-page-gap')) offs.push(chars)
    }
    return { offs, chars }
  })()
  const rd = (sel) => { const e = root.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return `${c.fontSize}/${c.fontWeight}/mt${c.marginTop}/mb${c.marginBottom}/lh${c.lineHeight}/pl${c.paddingInlineStart}` }
  return {
    gapOffsets: g.offs, textChars: g.chars,
    pages: root.querySelectorAll('.inkwave-page-gap').length + 1,
    chars: (root.textContent || '').length,
    height: Math.round(root.getBoundingClientRect().height),
    uls: root.querySelectorAll('ul,ol').length,
    lis: root.querySelectorAll('li').length,
    refLists: root.querySelectorAll('.node-referenceList,[data-mode]').length,
    hStyle: rd('h1,h2,h3'), pStyle: rd('p'), ulStyle: rd('ul'), liStyle: rd('li'),
  }
}

const run = async () => {
  const b = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  console.log('\n╔══ WHICH INGREDIENT MAKES THE CANVAS AND THE DOM PANE DISAGREE? (no diff marks on either side)')
  console.log('║  canvas = buildRenderModel — PROVED byte-identical to the LIVE EDITOR (breaks.prove.mjs)')
  console.log('╚══ DOM    = the /snapshot pane (DocView + staticPagination). A gap ⇒ the PANE ≠ the EDITOR.\n')
  console.log(`  ${'shape'.padEnd(26)} ${'canvas'.padStart(6)} ${'EDITOR'.padStart(6)} ${'pane'.padStart(5)} ${'Δ'.padStart(4)}   detail`)

  for (const [name, opts] of SHAPES) {
    const FIX = buildCitationDoc({ ...opts, id: 'bisect' })
    const snaps = JSON.stringify([{ id: 'snap-00', documentId: DOC_ID, createdAt: new Date().toISOString(), trigger: 'word-nudge', wordCount: opts.words, contentHash: 'a', bundleHash: 'a', ots: { status: 'unstamped' }, contentJson: FIX.contentJson }])
    const ctx = await b.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
    await ctx.addInitScript(seed, { json: snaps, lib: JSON.stringify(FIX.bibliography.entries) })

    // DOM half — snap-00 ⇒ ops === null ⇒ DocView ⇒ no marks.
    const pg = await ctx.newPage()
    await pg.goto(`${BASE}/snapshot?doc=${DOC_ID}&snap=snap-00`, { waitUntil: 'load' })
    await pg.waitForSelector('.iw-snap-layer-active .tiptap-editor, .iw-snap-layer .tiptap-editor', { timeout: 30000 })
    await pg.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
    await pg.waitForTimeout(4500)
    const dom = await pg.evaluate(PANE)
    await pg.close()

    // Canvas half — the model, on the editor route.
    const pg2 = await ctx.newPage()
    await pg2.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
    await pg2.waitForSelector('.tiptap-editor', { timeout: 30000 })
    await pg2.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
    await pg2.waitForTimeout(2500)
    const has = await pg2.evaluate(() => typeof window.__iwTextRenderProbe?.build === 'function')
    if (!has) { console.log('  VOID — served bundle has no __iwTextRenderProbe.build; NOT our build.'); await b.close(); process.exit(1) }
    await pg2.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), FIX)
    await pg2.waitForFunction((w) => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > w * 0.5, opts.words, { timeout: 90000 })
    await pg2.waitForTimeout(4000)
    const st = await pg2.evaluate(() => window.__iwTextRenderProbe.selfTest())
    // THE THIRD CORNER. The model is PROVED byte-identical to the live editor — but that proof was
    // taken on a different fixture, so leaning on it here would be trusting a number from somewhere
    // else. Read the LIVE EDITOR's own gap widgets on THIS fixture, so all three come from one
    // document: model / editor / pane. If model === editor and pane differs, the PANE is the outlier.
    const editor = await pg2.evaluate(() => {
      const pm = document.querySelector('.tiptap-editor')
      if (!pm) return { gaps: -1, gapOffsets: [], textChars: 0 }
      // THE SAME WALK the pane gets — one instrument, two surfaces, so a difference is the surface
      // and not the measurement.
      const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      const offs = []
      let chars = 0, n
      while ((n = w.nextNode())) {
        if (n.nodeType === 3) chars += n.nodeValue.length
        else if (n.classList && n.classList.contains('inkwave-page-gap')) offs.push(chars)
      }
      return { gaps: pm.querySelectorAll('.inkwave-page-gap').length, gapOffsets: offs, textChars: chars }
    })
    const editorGaps = editor.gaps
    const model = await pg2.evaluate(() => {
      for (let i = 0; i < 3; i++) window.__iwTextRenderProbe.build()
      const { model } = window.__iwTextRenderProbe.build()
      const kinds = {}
      for (const bl of model.blocks) { const k = `${bl.kind}:${bl.type}`; kinds[k] = (kinds[k] || 0) + 1 }
      return { pages: model.pages, height: Math.round(model.contentHeight), blocks: model.blocks.length, est: model.estimatedBlocks, kinds }
    })
    await pg2.close()
    await ctx.close()

    if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(`  ${name.padEnd(26)} PROBE BLIND — skipped`); continue }
    const d = model.pages - dom.pages
    const ed = editorGaps >= 0 ? editorGaps + 1 : -1
    const est = Object.entries(model.kinds).filter(([k]) => k.startsWith('placeholder')).map(([k, v]) => `${k.replace('placeholder:', '')}×${v}`).join(' ')

    // ── THE POSITION COMPARISON — the claim counts could never make. ──
    // The pane's rendered text must be the SAME STREAM as the editor's for offsets to be comparable.
    // DocView resolves citations with `simpleInText` (not real CSL) and renders NO refList, so on
    // those fixtures the streams genuinely differ and an offset comparison is meaningless rather
    // than failing. Say so, don't score it.
    const eo = editor.gapOffsets, po = dom.gapOffsets
    const streamsMatch = Math.abs(editor.textChars - dom.textChars) <= 1
    let posVerdict
    if (!streamsMatch) {
      posVerdict = `offsets N/A — pane text ${dom.textChars} vs editor ${editor.textChars} chars (DocView drops the refList / re-formats citations); different streams, not a divergence`
    } else {
      let firstDiv = -1
      for (let i = 0; i < Math.max(eo.length, po.length); i++) if (eo[i] !== po[i]) { firstDiv = i; break }
      posVerdict = firstDiv === -1 && eo.length === po.length
        ? `✓ OFFSETS IDENTICAL (${eo.length} breaks)`
        : `✗ OFFSETS DIVERGE @${firstDiv}/${eo.length}: editor ${eo[firstDiv]} vs pane ${po[firstDiv]} (Δ${(po[firstDiv] ?? 0) - (eo[firstDiv] ?? 0)} chars)`
    }
    console.log(`  ${name.padEnd(26)} ${String(model.pages).padStart(6)} ${String(ed).padStart(6)} ${String(dom.pages).padStart(5)} ${String(d).padStart(4)}   est ${model.est}${est ? ' (' + est + ')' : ''} · ${model.pages === ed ? 'model==EDITOR' : 'model!=EDITOR'}`)
    console.log(`  ${''.padEnd(26)}   ${posVerdict}`)
  }
  console.log('\n  Δ = canvas − pane (PAGE COUNTS — the weak claim, kept only for continuity).')
  console.log('  READ THE OFFSET LINE INSTEAD: chars-of-text before each gap, editor vs pane, one walk,')
  console.log('  two surfaces. A page count can agree while the words on those pages differ.')
  console.log('\n  THREE numbers from ONE document: the canvas model, the LIVE EDITOR\'s')
  console.log('  own gap widgets, and the /snapshot pane\'s. If canvas === EDITOR on every row, the model is')
  console.log('  not the outlier and the PANE paginates the same document differently from the editor —')
  console.log('  which would be a pre-existing /snapshot bug, older than anything on this branch, and the')
  console.log('  real reason the two halves cannot be made identical yet.')
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
