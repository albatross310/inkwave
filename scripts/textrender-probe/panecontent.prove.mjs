// WHAT DOES THE /snapshot DOC PANE ACTUALLY RENDER?
//
// WHY THIS PROBE EXISTS. The textRender RenderModel is built by `buildRenderModel(doc: PMNode, …)`
// and validated by textRenderProbe — which drives the LIVE EDITOR. Every number we hold (coverage
// 99.7%, citeBox 667/0, "headings and lists lay out as real text", the break table, the O(window)
// layout) was therefore taken against the EDITOR's rich canonical layout.
//
// The pane the renderer is meant to PAINT is a different surface. This probe asks that surface,
// directly, what it is made of — before any wiring is landed on top of an assumption about it.
//
// THE READING OF THE SOURCE UNDER TEST (falsify it, don't confirm it):
//   DocLayer renders <FullDiffView ops={ops} snapshot={snap}/> (SnapshotView ~966). FullDiffView
//   returns the rich <DocView> ONLY when `ops === null` — i.e. the FIRST snapshot. Otherwise
//   (every other version, the normal case) it returns a flat list of <span>s of
//   `opsBetween(prev,cur)` text under `white-space: pre-wrap`, and those ops are
//   `diffWords(displayTextOf(prev), displayTextOf(cur))` = `pmToText(contentJson, true)` —
//   which FLATTENS heading/paragraph/listItem/blockquote/codeBlock to bare text blocks joined by
//   "\n\n" and resolves each citation to the plain STRING `simpleInText(...)` = "(Family, Year)".
//   If that reading holds, the doc pane has NO headings, NO list structure and NO citation
//   NodeViews — and a RenderModel of the editor's rich layout is not a model of this pane.
//
// THE CONTROL — and why it cannot answer itself. The census below is ONE function run against TWO
// versions of the SAME BYTE-IDENTICAL CONTENT on the SAME route in the SAME pane:
//   • snap-00 → the FIRST snapshot → ops === null → the rich DocView path.   POSITIVE CONTROL.
//   • snap-01 → ops !== null       → the FullDiffView flat path.             THE QUESTION.
// So if the census reported "no headings" because its SELECTORS were broken, snap-00 would report
// no headings too, and NO VERDICT IS READ (exit 1). The positive control must FIRE — headings,
// lists and citation NodeViews all > 0 on snap-00 — before the snap-01 numbers mean anything.
// This is the house rule: a negative that cannot fail is not a negative. Here the DocView path is
// the thing that proves the instrument can see what it claims snap-01 lacks.
//
// This probe reads ONLY the DOM. It builds nothing, wires nothing and mutates no production path.
import { chromium } from '@playwright/test'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const DOC_ID = 'probe-doc-scrub'

// ── Fixture: thesis-SHAPED (headings + lists + citations + prose), synthetic content only.
// THESIS INTEGRITY: every word here is generated. Peter's real document never enters a fixture.
const LIB = [
  { id: 'leibniz1686', type: 'book', title: 'Discourse on Metaphysics', author: [{ family: 'Leibniz', given: 'G' }], issued: { 'date-parts': [[1686]] } },
  { id: 'couturat1901', type: 'book', title: 'La Logique de Leibniz', author: [{ family: 'Couturat', given: 'L' }], issued: { 'date-parts': [[1901]] } },
  { id: 'rescher1954', type: 'article-journal', title: 'Leibniz and the Calculus', author: [{ family: 'Rescher', given: 'N' }], issued: { 'date-parts': [[1954]] } },
]

function buildDoc() {
  let s = 7
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const W = ('philosophy universal language calculus ratiocinator characteristica argument thesis chapter ' +
    'section evidence claims analysis synthesis method critique framework ontology epistemology reason ' +
    'judgment perception substance monad harmony contingent necessary truth predicate inference').split(/\s+/)
  const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
  const cite = (key) => ({ type: 'citation', attrs: { citekeys: [key], locator: '', prefix: '', suffix: '', quote: '', instanceId: 'i' + Math.floor(rnd() * 1e6) } })
  const content = []
  for (let c = 0; c < 6; c++) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Chapter ${c + 1}: ${words(4)}` }] })
    for (let p = 0; p < 5; p++) {
      // Citations land MID-paragraph in MULTI-line paragraphs (the structurally-blind-fixture rule).
      content.push({ type: 'paragraph', content: [
        { type: 'text', text: words(28) + ' ' },
        cite(LIB[(c + p) % LIB.length].id),
        { type: 'text', text: ' ' + words(30) + '.' },
      ] })
    }
    content.push({ type: 'bulletList', content: [0, 1, 2].map(() => ({
      type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(12) }] }],
    })) })
  }
  // The BIBLIOGRAPHY — the block behind the `refList = 120px guess vs ~880px real` known gap that
  // caps reliablePages. It is a top-level ATOM (ReferenceListNode: atom:true, group:'block', no
  // content), so this fixture asks the pane directly whether it survives to the flat path at all.
  content.push({ type: 'referenceList', attrs: { mode: 'cited' } })
  return { type: 'doc', content }
}

function buildSnapshots() {
  const doc = buildDoc()
  const t0 = Date.now() - 4 * 3600 * 1000
  const snaps = []
  for (let v = 0; v < 3; v++) {
    // snap-00 and snap-01 carry BYTE-IDENTICAL content: the ONLY difference between them is that
    // snap-00 is first (ops === null → DocView) and snap-01 is not (ops !== null → FullDiffView).
    // Any census difference is therefore the RENDERER PATH and nothing else.
    snaps.push({
      id: `snap-${String(v).padStart(2, '0')}`, documentId: DOC_ID,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 2000, contentHash: 'p' + v, bundleHash: 'p' + v, ots: { status: 'unstamped' },
      contentJson: JSON.parse(JSON.stringify(doc)),
    })
  }
  return JSON.stringify(snaps)
}

const seed = ({ json, lib }) => {
  const files = new Map()
  const enc = new TextEncoder()
  files.set('documents/probe-doc-scrub/snapshots.json', enc.encode(json))
  files.set('library/citations.json', enc.encode(lib))
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
}

// ── THE CENSUS. One function, run identically against whatever pane root it is handed. ──────────
const CENSUS = () => {
  const layer = document.querySelector('.iw-snap-layer-active') || document.querySelector('.iw-snap-layer')
  if (!layer) return { err: 'no snap layer' }
  const root = layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor')
  if (!root) return { err: 'no pane root' }
  const q = (sel) => root.querySelectorAll(sel).length
  // Distinct rendered font sizes over elements that actually carry text — a rich layout sets
  // headings apart from body; a flat one cannot.
  const sizes = new Set()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n, chars = 0
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim()) continue
    chars += n.nodeValue.length
    const el = n.parentElement
    if (el) sizes.add(getComputedStyle(el).fontSize)
  }
  return {
    headings: q('h1,h2,h3,h4,h5,h6'),
    lists: q('ul,ol'),
    listItems: q('li'),
    paragraphs: q('p'),
    citeNodeViews: q('.iw-cite-biblink, [data-citekeys], .iw-citation'),
    citeSpansPurple: Array.from(root.querySelectorAll('span')).filter((s) => getComputedStyle(s).color === 'rgb(92, 45, 138)').length,
    opIdxSpans: q('[data-opidx]'),
    topLevelChildren: root.children.length,
    whiteSpace: getComputedStyle(root).whiteSpace,
    distinctFontSizes: [...sizes].sort(),
    // Report heading STYLING explicitly rather than inferring it from font-size. This app ships
    // Tailwind preflight with no typography plugin and NO `.ProseMirror h2` rule anywhere, so a
    // heading is NOT set apart by size — the first cut of this probe gated on
    // `distinctFontSizes > 1` and correctly VOIDED itself against the rich path. Font size is not
    // a structural signal here; the ELEMENTS are.
    headingStyle: (() => {
      const h = root.querySelector('h1,h2,h3')
      const p = root.querySelector('p')
      const rd = (el) => { if (!el) return null; const c = getComputedStyle(el); return { fontSize: c.fontSize, fontWeight: c.fontWeight, marginTop: c.marginTop, marginBottom: c.marginBottom, lineHeight: c.lineHeight } }
      return { heading: rd(h), para: rd(p) }
    })(),
    textChars: chars,
    // THE PAGINATION THE PANE ITSELF COMPUTED. staticPagination measures whatever the pane
    // rendered, canonically, and emits .inkwave-page-gap widgets. snap-00 and snap-01 carry
    // BYTE-IDENTICAL content, so a difference here is the RENDERER PATH alone — and it bounds how
    // far a RICH model's pagination sits from the FLAT pane the scrub actually lands on.
    gaps: root.querySelectorAll('.inkwave-page-gap').length,
    gapOffsets: (() => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      const offs = []; let c = 0, nn
      while ((nn = w.nextNode())) {
        if (nn.nodeType === 3) c += nn.nodeValue.length
        else if (nn.classList && nn.classList.contains('inkwave-page-gap')) offs.push(c)
      }
      return offs
    })(),
    flowHeight: Math.round(root.getBoundingClientRect().height),
    // THE BIBLIOGRAPHY. Does the reference list reach this pane at all?
    refListNodes: root.querySelectorAll('.node-referenceList, [data-mode]').length,
    hasReferencesHeader: /References/.test(root.textContent || ''),
    // Does the flat text carry the RESOLVED citation string? pmToText(…, true) → "(Family, Year)".
    hasResolvedCiteText: /\((Leibniz|Couturat|Rescher), \d{4}\)/.test(root.textContent || ''),
  }
}

async function censusAt(page, snapId) {
  await page.goto(`${BASE}/snapshot?doc=${DOC_ID}&snap=${snapId}`, { waitUntil: 'load' })
  await page.waitForSelector('.iw-snap-layer-active .ProseMirror, .iw-snap-layer .ProseMirror', { timeout: 20000 });
  // let the library hydrate + the layer paginate
  await page.waitForTimeout(2500)
  return page.evaluate(CENSUS)
}

const run = async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] })
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
  await ctx.addInitScript(seed, { json: buildSnapshots(), lib: JSON.stringify(LIB) })
  const page = await ctx.newPage()

  const docView = await censusAt(page, 'snap-00')   // POSITIVE CONTROL — the rich path
  const diffView = await censusAt(page, 'snap-01')  // THE QUESTION      — the normal path

  console.log('\n=== snap-00 — ops===null → DocView (POSITIVE CONTROL, rich path) ===')
  console.log(JSON.stringify(docView, null, 2))
  console.log('\n=== snap-01 — ops!==null → FullDiffView (THE NORMAL PATH, byte-identical content) ===')
  console.log(JSON.stringify(diffView, null, 2))

  await browser.close()

  if (docView.err || diffView.err) { console.log(`\nVOID — census could not reach a pane root: ${docView.err || diffView.err}`); process.exit(1) }

  // ── THE GATE. The positive control must FIRE, or the instrument is blind and no verdict is read.
  // STRUCTURAL signals only — see headingStyle above for why font-size is not one of them.
  const controlFired = docView.headings > 0 && docView.lists > 0 && docView.listItems > 0
    && docView.paragraphs > 0 && docView.topLevelChildren > 1
  console.log('\n=== GATE — can the census see a rich layout at all? ===')
  console.log(`  snap-00 headings=${docView.headings} lists=${docView.lists} listItems=${docView.listItems} paragraphs=${docView.paragraphs} topLevelChildren=${docView.topLevelChildren}`)
  if (!controlFired) {
    console.log('\nVOID — the POSITIVE CONTROL DID NOT FIRE. The rich DocView path reported no headings/lists/sizes,')
    console.log('       so the census cannot see structure and its report of snap-01 is meaningless. NO VERDICT.')
    process.exit(1)
  }
  console.log('  → control FIRED: the census can see headings, lists and multiple font sizes.')

  console.log('\n=== VERDICT — what the /snapshot doc pane renders on the NORMAL path ===')
  const flat = diffView.headings === 0 && diffView.lists === 0 && diffView.listItems === 0
    && diffView.paragraphs === 0 && diffView.topLevelChildren <= 2
  console.log(`  headings          ${docView.headings} → ${diffView.headings}`)
  console.log(`  lists / items     ${docView.lists}/${docView.listItems} → ${diffView.lists}/${diffView.listItems}`)
  console.log(`  paragraphs        ${docView.paragraphs} → ${diffView.paragraphs}`)
  console.log(`  citation NodeViews ${docView.citeNodeViews} → ${diffView.citeNodeViews}`)
  console.log(`  distinct font sizes ${JSON.stringify(docView.distinctFontSizes)} → ${JSON.stringify(diffView.distinctFontSizes)}`)
  console.log(`  heading style (rich path): ${JSON.stringify(docView.headingStyle)}`)
  console.log(`  white-space       ${docView.whiteSpace} → ${diffView.whiteSpace}`)
  console.log(`  top-level children ${docView.topLevelChildren} → ${diffView.topLevelChildren}`)
  console.log(`  resolved "(Family, Year)" text present: ${diffView.hasResolvedCiteText}`)
  console.log('')
  console.log('=== THE BIBLIOGRAPHY — does the refList reach the pane? ===')
  console.log(`  refList nodes   rich ${docView.refListNodes} → flat ${diffView.refListNodes}`)
  console.log(`  "References" text present   rich ${docView.hasReferencesHeader} → flat ${diffView.hasReferencesHeader}`)
  console.log('')
  console.log('=== THE PAGINATION CONSEQUENCE — byte-identical content, two renderers, one pane ===')
  console.log(`  rich DocView  (snap-00): ${docView.gaps} gaps → ${docView.gaps + 1} pages, flow ${docView.flowHeight}px`)
  console.log(`  flat DiffView (snap-01): ${diffView.gaps} gaps → ${diffView.gaps + 1} pages, flow ${diffView.flowHeight}px`)
  console.log(`  first 8 gap char-offsets  rich ${JSON.stringify(docView.gapOffsets.slice(0, 8))}`)
  console.log(`                            flat ${JSON.stringify(diffView.gapOffsets.slice(0, 8))}`)
  const dPages = Math.abs(docView.gaps - diffView.gaps)
  const dHeight = Math.abs(docView.flowHeight - diffView.flowHeight)
  console.log(`  Δ pages ${dPages}   Δ flow height ${dHeight}px`)
  if (docView.gaps === 0 && diffView.gaps === 0) {
    console.log('  (no gaps on either path — pagination did not run; this comparison is VOID)')
  } else if (dPages > 0 || dHeight > 8) {
    console.log('  ⇒ THE TWO RENDERINGS OF THE SAME BYTES PAGINATE DIFFERENTLY. A rich model\'s pages are')
    console.log('    NOT the flat pane\'s pages, so scrub frames drawn from a rich model would not')
    console.log('    register against the live pane they settle onto.')
  } else {
    console.log('  ⇒ the two paths agree — a rich model would land on the flat pane\'s own pages.')
  }
  if (flat) {
    console.log('  CONFIRMED: on the normal path the doc pane is FLAT TEXT — no headings, no lists,')
    console.log('  no paragraphs, pre-wrap, one flow. The rich structure exists ONLY on the first snapshot.')
    console.log('  ⇒ A RenderModel of the EDITOR\'s rich canonical layout is NOT a model of this pane.')
  } else {
    console.log('  REFUTED (or partial): the flat path retains structure. The reading of the source was wrong —')
    console.log('  re-read before trusting any of this.')
  }
}

run().catch((e) => { console.error(e); process.exit(1) })
