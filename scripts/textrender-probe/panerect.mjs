// DIAGNOSTIC + GATE: what LINES does the /snapshot pane's own collector see inside a container?
//
// This is `rectdiag.mjs` pointed at the OTHER surface. rectdiag asked the LIVE EDITOR's collectLines
// what rects it receives for a `<ul>` and found each `<li>`'s BORDER BOX standing in for the item's
// first text line. `staticPagination.collectStaticLines` is the THIRD copy of that rule and its
// comment named the same 80px cut and the same 3px dedup — so ask THIS collector the same question,
// against the DOM it actually measures (DocView's `<ul><li><p>`), before believing either that the
// bug is there or that it is not.
//
// ── WHY NOT JUST READ halvesbisect. It compares the pane's gap offsets against the LIVE EDITOR's on
// one document and prints `+ lists → OFFSETS IDENTICAL`. That is not a verdict, for TWO independent
// reasons, and each one alone would have been enough to certify this bug as absent:
//   1. STRUCTURALLY BLIND FIXTURE (trap #15). Its list items were `sentence(9)` — NINE WORDS, ONE
//      LINE. A container box is admitted as a line only when it is under the 80px cut, so only a
//      ~2-line item (58.2px) reproduces this; a 1-line box is ~29px and its top IS the line's own,
//      a 3-line box is 87.3px and the cut drops it. `listWords` is now a fixture parameter and
//      halvesbisect has a 2-LINE row.
//   2. THE RATE CANNOT SEE IT ANYWAY (trap #9), which is the sharper half. MEASURED with the bug
//      fully restored via `__iwStaticLineRule='range'`: the 2-line row moves NOT ONE of its 25
//      breaks. The artifact is 3.000px on a ~29px line grid, so a break moves only where a boundary
//      lands within 3px of the overflow cliff. Waiting for that is waiting on a coincidence.
// So this probe measures the ARTIFACT — every line's top — and not the rate.
//
// ── THE OUTSIDE QUESTION. The comparison is NOT against a model of what the lines should be; that
// is how three self-consistent copies of one rule stayed green. It is against the DOM's own
// TEXT-NODE rects: a Text node has no border box, so `range.getClientRects()` over one returns only
// line fragments. That is the one line list in this system that cannot contain a container's box.
//
// ── WHY IT READS PRODUCTION'S LINE LIST rather than a replica. The first cut of this probe
// re-implemented collectStaticLines verbatim in the page. That can prove the shipped rule WRONG,
// but it can never prove a fix: a replica agrees with whatever it replicates, and "two copies of one
// rule, each self-consistent" is the disease this entire lane is about. The pane now hands its
// measured line list to `window.__iwStaticLinesHook` and this probe reads THAT.
//
// ── WHY A HOOK AND NOT A BUFFER. The hook fires INSIDE the pane's FORCED CANONICAL WINDOW (paper
// width, side margins, zoom 1). Those tops mean nothing in the pane's live layout, which wraps at a
// different width under a fit-capped CSS zoom — comparing canonical tops to live rects is trap #8,
// "the verdict is unreadable off-canonical". Running the truth pass inside the hook puts both
// numbers in the same coordinate system, by construction rather than by correction.
//
// Run:
//   PROBE_PORT=4231 NODE_PATH="$(pwd)/node_modules" node scripts/textrender-probe/panerect.mjs
import { chromium } from '@playwright/test'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`
const DOC_ID = 'probe-doc-scrub'

// ── Fixture. THESIS INTEGRITY: every word invented; Peter's document never enters a fixture.
// STRUCTURALLY NON-BLIND, deliberately (trap #15): list items at 1, 2 and 3+ lines, and BOTH a
// short and a long blockquote, because the container box's HEIGHT relative to the 80px cut is the
// variable the bug turns on. A uniform fixture scores a confident number on a shape that cannot fail.
const W = ('philosophy universal language calculus ratiocinator characteristica argument thesis chapter section ' +
  'evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception ' +
  'substance monad harmony contingent necessary truth predicate inference demonstration alphabet combinatorial').split(/\s+/)

function buildDoc() {
  let s = 11
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }
  const para = (n) => ({ type: 'paragraph', content: [{ type: 'text', text: words(n) + '.' }] })
  const item = (n) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(n) + '.' }] }] })
  const content = []
  for (let c = 0; c < 8; c++) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Chapter ${c + 1}: ${words(4)}` }] })
    for (let p = 0; p < 4; p++) content.push(para(60))
    content.push({ type: 'bulletList', content: [item(9), item(22), item(40)] })
    content.push(para(50))
    content.push({ type: 'orderedList', content: [item(22), item(9)] })
    // A SHORT blockquote (its `<p>`'s box ~58px, UNDER the 80px cut) and a LONG one (~87px, over).
    // The cut is what accidentally saves the long one; only the short one can show whether the RULE
    // is right or whether a magic constant has been covering for it.
    content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(12) + '.' }] }] })
    content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(24) + '.' }] }] })
    content.push(para(60))
  }
  return { type: 'doc', content }
}

// ── The hook. Installed before any script runs; fires inside the pane's canonical measure window.
// `rule` arms the LIVE KNOWN-NEGATIVE (`__iwStaticLineRule='range'` ⇒ the pre-fix rule, verbatim).
const install = ({ json, rule }) => {
  const files = new Map()
  files.set('documents/probe-doc-scrub/snapshots.json', new TextEncoder().encode(json))
  files.set('library/citations.json', new TextEncoder().encode('[]'))
  const fh = (p) => ({ kind: 'file', name: 'f', getFile: async () => new File([files.get(p)], 'f'), createWritable: async () => ({ write: async () => {}, truncate: async () => {}, seek: async () => {}, close: async () => {} }) })
  const dh = (prefix) => ({
    kind: 'directory', name: '',
    getDirectoryHandle: async (n) => dh(prefix + n + '/'),
    getFileHandle: async (n, o) => { const path = prefix + n; if (!files.has(path)) { if (o && o.create) files.set(path, new Uint8Array()); else throw new DOMException('missing', 'NotFoundError') } return fh(path) },
    removeEntry: async () => {}, values: async function* () {}, keys: async function* () {},
  })
  const shim = { getDirectory: async () => dh(''), persist: async () => true, persisted: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }) }
  try { Object.defineProperty(navigator, 'storage', { value: shim, configurable: true }) } catch { navigator.storage = shim }

  if (rule) window.__iwStaticLineRule = rule

  window.__iwPaneRect = null
  window.__iwStaticLinesHook = (root, lines) => {
    // ── THE OUTSIDE ANSWER, taken HERE — inside the same forced canonical layout the pane just
    // measured, so both lists are in one coordinate system by construction.
    const truth = []
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) {
      if (!n.nodeValue.length) continue
      const r = document.createRange(); r.selectNodeContents(n)
      for (const x of r.getClientRects()) { if (x.width < 1 || x.height < 1) continue; truth.push(x.top) }
    }
    truth.sort((a, b) => a - b)
    // The SAME 3px dedup the pane applies — one instrument, two sources, so a difference is the
    // source and not the measurement.
    const trueLines = []
    let lt = -1e9
    for (const t of truth) { if (t - lt <= 3) continue; lt = t; trueLines.push(t) }

    // Per-line drift: match each shipped line to the nearest true line.
    let exact = 0, drifted = 0
    const driftedTags = {}
    const driftedDeltas = {}
    const samples = []
    const tagOf = (i) => { const el = root.children[i]; return el ? el.tagName : '?' }
    for (const s of lines) {
      let best = Infinity
      for (const t of trueLines) { const d = Math.abs(t - s.absTop); if (d < best) best = d; if (t > s.absTop + 10) break }
      if (best < 0.001) exact++
      else {
        drifted++
        const tag = tagOf(s.blockIdx)
        driftedTags[tag] = (driftedTags[tag] || 0) + 1
        driftedDeltas[best.toFixed(3)] = (driftedDeltas[best.toFixed(3)] || 0) + 1
        if (samples.length < 6) samples.push({ shippedTop: +s.absTop.toFixed(3), nearestTrueDelta: +best.toFixed(3), tag })
      }
    }

    // The raw rects the collector was HANDED, for the rectdiag view. A replica of the PRE-FIX call
    // on purpose — it prints evidence and never scores the verdict.
    const rectView = (pred) => {
      const el = Array.from(root.children).find(pred)
      if (!el) return null
      const top = el.getBoundingClientRect().top
      const r = document.createRange(); r.selectNodeContents(el)
      return { tag: el.tagName, boxH: +el.getBoundingClientRect().height.toFixed(3), rawRects: Array.from(r.getClientRects()).map((x) => ({ relTop: +(x.top - top).toFixed(3), h: +x.height.toFixed(3) })) }
    }

    window.__iwPaneRect = {
      shippedLines: lines.length, trueLines: trueLines.length,
      exact, drifted, driftedTags, driftedDeltas, samples,
      firstUl: rectView((e) => e.tagName === 'UL'),
      shortBlockquote: rectView((e) => e.tagName === 'BLOCKQUOTE' && e.getBoundingClientRect().height < 80),
      longBlockquote: rectView((e) => e.tagName === 'BLOCKQUOTE' && e.getBoundingClientRect().height >= 80),
      uls: root.querySelectorAll('ul,ol').length,
      lis: root.querySelectorAll('li').length,
      blockquotes: root.querySelectorAll('blockquote').length,
    }
  }
}

const measure = async (b, snaps, rule) => {
  const ctx = await b.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
  await ctx.addInitScript(install, { json: snaps, rule })
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}/snapshot?doc=${DOC_ID}&snap=snap-00`, { waitUntil: 'load' })
  await pg.waitForSelector('.iw-snap-layer-active .tiptap-editor, .iw-snap-layer .tiptap-editor', { timeout: 30000 })
  await pg.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await pg.waitForFunction(() => window.__iwPaneRect !== null, { timeout: 30000 })
  const r = await pg.evaluate(() => window.__iwPaneRect)
  await pg.close(); await ctx.close()
  return r
}

const show = (name, r) => {
  console.log(`\n── ${name}`)
  console.log(`   shipped lines ${r.shippedLines} · true lines ${r.trueLines} · exact ${r.exact} · DRIFTED ${r.drifted}`)
  console.log(`   drifted by tag: ${JSON.stringify(r.driftedTags)} · by delta: ${JSON.stringify(r.driftedDeltas)}`)
  for (const v of [r.firstUl, r.shortBlockquote, r.longBlockquote]) {
    if (!v) continue
    console.log(`   ${v.tag} (box ${v.boxH}px) raw rects handed to the collector:`)
    console.log(`     ${v.rawRects.map((x) => `${x.relTop}/h${x.h}`).join('  ')}`)
  }
}

const run = async () => {
  const snaps = JSON.stringify([{
    id: 'snap-00', documentId: DOC_ID, createdAt: new Date().toISOString(), trigger: 'word-nudge',
    wordCount: 3000, contentHash: 'a', bundleHash: 'a', ots: { status: 'unstamped' }, contentJson: buildDoc(),
  }])
  const b = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] })

  // THE KNOWN-NEGATIVE FIRST. If the pre-fix rule does not reproduce the drift on THIS fixture, the
  // instrument is blind and no "0 drifted" from the shipped rule means anything. Read the verdict
  // only after the negative has fired — the house rule, and the one that would have caught the
  // `+ lists` row years earlier.
  const bug = await measure(b, snaps, 'range')
  show('KNOWN-NEGATIVE — __iwStaticLineRule=\'range\' (the PRE-FIX rule, verbatim)', bug)

  const fixed = await measure(b, snaps, null)
  show('SHIPPED — the container rule', fixed)

  const fail = (m) => { console.log(`\n✗ ${m}`); process.exit(1) }
  console.log('')
  if (!bug || !fixed) fail('VOID — no pane measurement')
  // The fixture must contain the shapes it claims to test, or every number below is about prose.
  if (!fixed.uls || !fixed.lis || !fixed.blockquotes) fail(`VOID — pane rendered uls=${fixed.uls} lis=${fixed.lis} blockquotes=${fixed.blockquotes}; this fixture cannot see the bug`)
  if (!fixed.shortBlockquote) fail('VOID — no blockquote UNDER the 80px cut; the only shape that tests the RULE rather than the constant')
  if (bug.drifted === 0) fail('VOID — the KNOWN-NEGATIVE did not fire: the pre-fix rule shows no drift, so this probe cannot see the bug it exists to catch')
  // The counts TELESCOPE — that is why every count/height check in staticPagination.ts passed
  // through this bug. Assert it, so the reason the old checks were blind stays on the record.
  if (bug.shippedLines !== bug.trueLines) fail(`the known-negative's line COUNT differs (${bug.shippedLines} vs ${bug.trueLines}) — expected them to telescope; the fixture has changed shape`)

  console.log(`✓ KNOWN-NEGATIVE FIRES: the pre-fix rule drifts ${bug.drifted} lines ${JSON.stringify(bug.driftedDeltas)} on ${JSON.stringify(bug.driftedTags)}`)
  console.log(`  …and its line COUNT is identical (${bug.shippedLines} = ${bug.trueLines}) — the totals telescope, which is why every count- and height-based check in staticPagination.ts passed straight through it.`)

  if (fixed.drifted !== 0) fail(`the SHIPPED rule still drifts ${fixed.drifted} lines: ${JSON.stringify(fixed.driftedTags)} ${JSON.stringify(fixed.driftedDeltas)}`)
  console.log(`✓ SHIPPED RULE: ${fixed.exact}/${fixed.shippedLines} lines sit exactly on a real text line — 0 drifted.`)
  await b.close()
}
run().catch((e) => { console.error(e); process.exit(1) })
