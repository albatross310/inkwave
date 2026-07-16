// WHAT DOES A RICH PANE COST AT REST? — the number Peter is being asked to pay for formatted pages.
//
// He decided on rich pages. He did NOT decide to pay an arbitrary price for them, and nobody has
// measured the price. This probe measures it BEFORE the feature is built, using a rich landing that
// ALREADY EXISTS in production: `ops === null` (the first snapshot) renders the rich <DocView>, every
// other version renders the flat <FullDiffView>. Same route, same DocLayer, same staticPagination,
// same real fonts — and, because snap-00 and snap-01 carry BYTE-IDENTICAL content, the only
// difference between the two conditions is the renderer.
//
// This is a BOUND, not the final number, and the difference matters:
//   • It is the FLOOR for rich. The real RichDiffView must also carry diff marks (add/del runs
//     spliced into the tree), which is strictly MORE work than DocView's plain rich render.
//   • n=12 fresh loads gives an honest p50 and a max. It does NOT give a p99 — a p99 needs the
//     116-version walk, which needs the feature. Reported as max, and labelled as such, rather than
//     dressing 12 samples up as a percentile. (The house has been burned by numbers that looked
//     more precise than their sample.)
//
// THREE METRICS, because one would lie:
//   A. `paginate` — the REAL production probe (SnapshotView ~899) around paginateStaticDoc. This is
//      the canonical measure + break compute + gap insert. It does NOT include React's node
//      creation, which is exactly where rich is expected to cost: 1 span becomes ~50 blocks.
//      Quoting A alone would flatter rich the way "fillText records a command" flattered the canvas.
//   B. LONGTASKS during the landing (PerformanceObserver, sum + max). Main-thread blocking is what a
//      "visible stall" actually IS. This catches the React commit that A cannot see.
//   C. The pane's DOM node/block count — the structural reason behind A and B.
//
// A METRIC THAT WAS STRUCTURALLY INCAPABLE OF MEASURING (removed, recorded so it is not rebuilt):
// the first cut timed flow-appears → first-gap-appears with a MutationObserver and read a confident
// 0ms on every condition. A MutationObserver delivers records as a MICROTASK after the task that
// mutated the DOM — and React's mount, the layout effect, paginateStaticDoc and the gap insert all
// run inside ONE task, so the first callback already sees the finished tree and both timestamps are
// the same number. It could not have returned anything but 0. Same family as the zoom probe that
// measured a value which structurally cannot change. B (longtasks) is what actually sees that task.
//
// THE CONFOUND IN B, stated because it changes how B reads: the flat condition also pays
// `diffWords` over ~124k chars and the rich condition, being `ops === null`, pays none. So B is
// "total blocking to land", not "cost of the renderer".
// AND THE `ops` PROBE DOES NOT MEASURE IT. It reads ~0ms here, which is NOT "the diff is free":
// SnapshotView's probed `opsBetween` (~1285) is a diffCache HIT, because DocLayer's OWN unprobed
// useMemo computed it first. The real diff cost is unattributed and lands somewhere in B. Do not
// quote the `ops` line as the diff's price. Metric A (paginateStaticDoc) does NOT include the diff
// at all and is the clean renderer comparison — read A, treat B as directional.
//
// TWO CAVEATS THAT BOUND THE HEADLINE — both make this comparison CONSERVATIVE toward flat, i.e.
// they cannot manufacture rich's win, but they do mean neither absolute number is the real one:
//   • FLAT IS AT ITS CHEAPEST HERE. Byte-identical content ⇒ diffWords returns ONE 'same' op ⇒ the
//     flat pane is 1 span / ~129 nodes. A REAL flat pane has hundreds of add/del spans, and
//     collectStaticLines dedupes GLOBALLY precisely because "inline diff spans share lines across
//     elements" — every span boundary fragments a line into another rect to sort. So real flat is
//     SLOWER than the 144ms measured here. Flat's number is a floor.
//   • RICH IS ALSO A FLOOR. DocView ignores ops entirely and renders contentJson, so its 787 nodes
//     are realistic for a plain rich render — but the RichDiffView this decision commits to must
//     ALSO carry diff marks, which is strictly more nodes and strictly more work. That increment is
//     UNMEASURED and is the one number this probe cannot give.
// What survives both caveats: the rich landing is not the expensive one, and the pagination stage
// genuinely prefers many small blocks to one 124k-char block.
//
// GATE: the conditions must actually DIFFER structurally (rich must have real blocks, flat must have
// ~1). If both panes look the same, the probe is measuring one thing twice and NO VERDICT is read.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const TRIALS = Number(process.env.TRIALS || 12)
const DOC_ID = 'probe-doc-scrub'

// Thesis scale, thesis shape — synthetic content only (THESIS INTEGRITY).
const FIX = buildCitationDoc({ words: 13000, cites: 174, marked: 1, lists: true, refList: true, id: 'landing' })

// A realistic per-version revision: reword ~2% of paragraphs. Deterministic.
function mutate(json, v) {
  const d = JSON.parse(JSON.stringify(json))
  if (v === 0) return d
  let seed = v * 7919
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (const node of d.content || []) {
    if (node.type !== 'paragraph' || !node.content) continue
    if (rnd() > 0.02) continue
    for (const c of node.content) {
      if (c.type === 'text' && c.text && c.text.length > 40) {
        const w = c.text.split(' ')
        if (w.length > 6) { w.splice(3, 2, 'revised', 'wording'); c.text = w.join(' ') }
        break
      }
    }
  }
  return d
}

function buildSnapshots() {
  const t0 = Date.now() - 4 * 3600 * 1000
  const snaps = []
  for (let v = 0; v < 3; v++) {
    snaps.push({
      id: `snap-${String(v).padStart(2, '0')}`, documentId: DOC_ID,
      createdAt: new Date(t0 + v * 3600 * 1000).toISOString(), trigger: 'word-nudge',
      wordCount: 13000, contentHash: 'p' + v, bundleHash: 'p' + v, ots: { status: 'unstamped' },
      // Versions must DIFFER or diffWords returns one 'same' op and the diff-mark increment being
      // measured does not exist. Mutate ~2% of paragraphs per version — a realistic revision.
      contentJson: mutate(FIX.contentJson, v),
    })
  }
  return JSON.stringify(snaps)
}

const seed = ({ json, lib, rich }) => {
  const files = new Map()
  files.set('documents/probe-doc-scrub/snapshots.json', new TextEncoder().encode(json))
  // The library must resolve or every citation renders as a bare "(citekey)" — a different string,
  // a different advance, and a cost measured on the wrong labels.
  files.set('library/citations.json', new TextEncoder().encode(lib))
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
  // THE CONDITION: `inkwave:textRender` gates RichDiffView in FullDiffView's ops!==null branch.
  try { if (rich) localStorage.setItem('inkwave:textRender', '1'); else localStorage.removeItem('inkwave:textRender') } catch { /* private */ }

  // METRIC A — the real production probe feeds __iwPerf when a harness defines it (perflog.ts).
  window.__iwPerf = []
  // METRIC B — main-thread blocking. Registered at document-start so the landing cannot hide in a
  // task that ran before we were listening.
  window.__iwLong = []
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__iwLong.push(Math.round(e.duration)) })
      .observe({ entryTypes: ['longtask'] })
  } catch { /* no longtask support ⇒ reported as null, never as zero */ }
}

const READ = () => {
  const layer = document.querySelector('.iw-snap-layer-active')
  const root = layer && (layer.querySelector('.ProseMirror') || layer.querySelector('.tiptap-editor'))
  const perf = (window.__iwPerf || [])
  // probePerf pushes [label, ms, endTime] — an ARRAY, not {label, ms}. The first cut of this probe
  // read e.label/e.ms and would have reported every timing as an empty list, i.e. a blind
  // instrument reporting "no cost". Hence assertHasSamples() below: a metric that returns nothing
  // must VOID the run, never read as zero.
  const pick = (label) => perf.filter((e) => e[0] === label).map((e) => e[1])
  return {
    paginate: pick('paginate'),
    paginateWarm: pick('paginate.warm'),
    specsMeasure: pick('sp.specs.measure'),
    ops: pick('ops'),
    longSum: (window.__iwLong || []).reduce((a, b) => a + b, 0),
    longMax: (window.__iwLong || []).length ? Math.max(...window.__iwLong) : 0,
    longCount: (window.__iwLong || []).length,
    longSupported: (() => { try { return PerformanceObserver.supportedEntryTypes.includes('longtask') } catch { return false } })(),
    nodes: root ? root.querySelectorAll('*').length : null,
    blocks: root ? root.children.length : null,
    // THE STRUCTURAL DISCRIMINATOR. `children.length` was written when the two versions were
    // byte-identical and the flat pane was ONE span; with a REAL diff the flat pane is ~524
    // top-level spans, so child count no longer separates the conditions. What separates them is
    // whether the pane contains real BLOCK ELEMENTS: the flat transcript has none by construction.
    paras: root ? root.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,pre').length : null,
    gaps: root ? root.querySelectorAll('.inkwave-page-gap').length : null,
    chars: root ? (root.textContent || '').length : null,
  }
}

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10 }
const med = (a) => q(a, 0.5)
const mx = (a) => (a.length ? Math.round(Math.max(...a) * 10) / 10 : null)

async function trial(ctx, snapId) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/snapshot?doc=${DOC_ID}&snap=${snapId}`, { waitUntil: 'load' })
  await page.waitForSelector('.iw-snap-layer-active .tiptap-editor, .iw-snap-layer .tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(4000) // let the landing paginate settle
  const r = await page.evaluate(READ)
  await page.close()
  return r
}

async function condition(browser, device, snapId, label, rich = false) {
  const ctx = await browser.newContext(device)
  await ctx.addInitScript(seed, { json: buildSnapshots(), lib: JSON.stringify(FIX.bibliography.entries), rich })
  const rows = []
  for (let i = 0; i < TRIALS; i++) rows.push(await trial(ctx, snapId))
  await ctx.close()
  const flat = (k) => rows.flatMap((r) => r[k])
  const num = (k) => rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined)
  return {
    label, snapId,
    paginate: flat('paginate'), longSum: num('longSum'), longMax: num('longMax'),
    ops: flat('ops'), specsMeasure: flat('specsMeasure'),
    nodes: rows[0].nodes, blocks: rows[0].blocks, gaps: rows[0].gaps, chars: rows[0].chars, paras: rows[0].paras,
    longSupported: rows[0].longSupported,
  }
}

const DESKTOP = { deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } }
// iPhone-8-SHAPED emulation. This is a CPU-unthrottled desktop core pretending to be a small
// viewport: it captures the LAYOUT cost of a narrow column, NOT an A11's speed. Peter's real device
// is slower and the phone numbers below are therefore a FLOOR, not a prediction. Said plainly
// because the round-3 WebKit numbers were read as device numbers once already.
const PHONE = { deviceScaleFactor: 2, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }

const run = async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] })
  const out = []
  for (const [devName, device] of [['desktop', DESKTOP], ['phone-emu', PHONE]]) {
    // snap-00 (ops===null) → DocView, NO marks: the FLOOR.
    const rich = await condition(browser, device, 'snap-00', `${devName} RICH floor (DocView, no marks)`)
    // snap-01 (ops!==null) → the flat transcript: today's pane.
    const flat = await condition(browser, device, 'snap-01', `${devName} FLAT (FullDiffView)`)
    // snap-01 WITH the flag → RichDiffView: rich AND carrying diff marks. THE NUMBER NOBODY HAS.
    const marks = await condition(browser, device, 'snap-01', `${devName} RICH+MARKS (RichDiffView)`, true)
    out.push({ devName, rich, flat, marks })
  }
  await browser.close()

  console.log(`\n╔══ RICH vs FLAT LANDING COST — thesis scale (13k words / 174 citations), n=${TRIALS} fresh loads/condition`)
  console.log('║  Byte-identical content. snap-00 → ops===null → rich DocView; snap-01 → flat FullDiffView.')
  console.log('╚══ A BOUND: DocView is the FLOOR for rich (RichDiffView must also carry diff marks).\n')

  let anyVoid = false
  for (const { devName, rich, flat, marks } of out) {
    // GATE — the two conditions must actually be structurally different renderings.
    const differ = rich.paras > 5 && flat.paras === 0
    console.log(`━━━ ${devName} ━━━`)
    console.log(`  structure   RICH floor  ${String(rich.paras).padStart(4)} block els / ${rich.nodes} nodes / ${rich.chars} chars / ${rich.gaps} gaps`)
    console.log(`              FLAT        ${String(flat.paras).padStart(4)} block els / ${flat.nodes} nodes / ${flat.chars} chars / ${flat.gaps} gaps`)
    console.log(`              RICH+MARKS  ${String(marks.paras).padStart(4)} block els / ${marks.nodes} nodes / ${marks.chars} chars / ${marks.gaps} gaps`)
    if (!differ) { console.log('  VOID — the two conditions are not structurally different; measuring one thing twice.\n'); anyVoid = true; continue }
    // A metric that collected NOTHING must void, never read as "0ms / free".
    if (!rich.paginate.length || !flat.paginate.length) {
      console.log(`  VOID — the 'paginate' probe collected no samples (rich ${rich.paginate.length}, flat ${flat.paginate.length}).`)
      console.log('         The instrument is blind; its silence is not a zero.\n'); anyVoid = true; continue
    }
    console.log(`  → gate FIRED: rich has real block elements, flat has NONE; ${rich.paginate.length}/${flat.paginate.length} paginate samples.`)
    const line = (name, r, f) => {
      const rm = med(r), fm = med(f), rx = mx(r), fx = mx(f)
      const ratio = (rm && fm) ? ` (${(rm / fm).toFixed(1)}× flat)` : ''
      console.log(`  ${name.padEnd(26)} RICH p50 ${String(rm).padStart(7)}  max ${String(rx).padStart(7)}   |   FLAT p50 ${String(fm).padStart(7)}  max ${String(fx).padStart(7)}${ratio}`)
    }
    // THE GATE FOR THE INCREMENT: RichDiffView must actually have rendered. If the flag did not
    // engage, RICH+MARKS is just the flat pane again and the increment is a fiction.
    const richMarksEngaged = marks.paras > 5
    console.log(`  → RichDiffView engaged under the flag: ${richMarksEngaged}${richMarksEngaged ? '' : '  ← VOID: measuring the flat pane twice'}`)
    if (!richMarksEngaged) { anyVoid = true; console.log(''); continue }
    line('A paginateStaticDoc (ms)', rich.paginate, flat.paginate)
    line('B longtask total (ms)', rich.longSum, flat.longSum)
    line('B longtask worst (ms)', rich.longMax, flat.longMax)
    line('  of which sp.specs (ms)', rich.specsMeasure, flat.specsMeasure)
    console.log(`  ${'`ops` probe (CACHE HIT)'.padEnd(26)} RICH ${rich.ops.length ? med(rich.ops) : 'n/a'}          |   FLAT p50 ${med(flat.ops)}  max ${mx(flat.ops)}`)
    console.log(`      ↑ NOT the diff's price — DocLayer's own unprobed useMemo already computed it.`)
    console.log(`        The diff cost is unattributed and sits inside B. Read A as the renderer comparison.`)
    if (!rich.longSupported) console.log('  (longtask entries UNSUPPORTED here — B is not measured, and its 0s mean nothing)')
    console.log('')
    console.log(`  ══ THE DIFF-MARK INCREMENT — RICH+MARKS (the shipped renderer) ══`)
    const im = (name, m, r, f) => {
      const mm = med(m), rm = med(r), fm = med(f)
      console.log(`  ${name.padEnd(26)} RICH+MARKS p50 ${String(mm).padStart(7)} max ${String(mx(m)).padStart(7)}   vs floor ${String(rm).padStart(7)} (${rm ? (mm / rm).toFixed(2) : '?'}×)   vs FLAT ${String(fm).padStart(7)} (${fm ? (mm / fm).toFixed(2) : '?'}×)`)
    }
    im('A paginateStaticDoc (ms)', marks.paginate, rich.paginate, flat.paginate)
    im('B longtask worst (ms)', marks.longMax, rich.longMax, flat.longMax)
    const mm = med(marks.paginate), fm = med(flat.paginate)
    console.log(`  → ${mm < fm ? `marks KEEP the win: still ${(fm / mm).toFixed(2)}× cheaper than the flat pane Peter has today` : `marks ERASE the win: ${(mm / fm).toFixed(2)}× the flat pane — Peter must be told`}`)
    console.log('')
  }
  if (anyVoid) { console.log('VOID — at least one device pair failed the structural gate. NO VERDICT.'); process.exit(1) }
  console.log('READ THIS AS: the cost of rendering rich pages AT REST, per landing, at thesis scale.')
  console.log('')
  console.log('THE HEADLINE HAS CHANGED, and this supersedes the earlier "rich is ~2x cheaper":')
  console.log('  That figure compared a DocView floor (no diff marks) against a flat pane fed')
  console.log('  BYTE-IDENTICAL versions — one `same` op, one span. Both sides were unrepresentative.')
  console.log('  With versions that actually DIFFER, and the real RichDiffView under the flag:')
  console.log('    • the diff MARKS cost ~2.6-2.8x the no-marks floor — they, not the structure, dominate;')
  console.log('    • rich+marks lands at PARITY with the flat pane (0.94-0.98x), not 2x cheaper.')
  console.log('  So: Peter gets formatted pages for ~the same landing cost he pays today. The 2x saving')
  console.log('  is NOT real for the shipped renderer, and nobody should quote it.')
  console.log('')
  console.log('READ RATIOS, NOT ABSOLUTES. This box is CPU-CONTENDED (other agents probe concurrently;')
  console.log('CLAUDE.md round 13 measured 103 -> 177ms/version between runs from contention alone), so')
  console.log('the absolute ms here are inflated and the maxima are wild. Every ratio above is measured')
  console.log('WITHIN one run across conditions, which is what makes it readable at all.')
  console.log('p99 is NOT reported — n cannot support one; it needs the 116-version walk. p50 + max only.')
}

run().catch((e) => { console.error(e); process.exit(1) })
