// THE /snapshot SCHEMA SEAM — proved against the LIVE editor, from outside (2026-07-17).
//
// THE CLAIM: `getEditorSchema()` — built by `getSchema(buildEditorExtensions())`, with NO editor and
// NO plugin closures — is the same schema the live editor constructs. If it is not, /snapshot's
// break tables model a different document than the editor paginates, which is CLAUDE.md ROUND 11's
// disease (two rules, one pane) reintroduced at the schema level.
//
// WHY IN-PAGE AND NOT A UNIT TEST. Both sides now derive from ONE list, so anything that compares
// them in isolation is a self-consistency check — the exact thing CLAUDE.md says to stop adding.
// This queries the OTHER side: the schema an actual `useEditor` actually built in an actual browser,
// with the real NodeViews mounted and `getSchema`'s optional `editor` argument in play (the one real
// asymmetry between the two constructions).
//
// THE FIXTURE IS THE POINT. It carries CITATIONS, INLINE MATH, BLOCK MATH, a REFERENCE LIST, marks
// and headings. "The schema matches" passing on bare paragraphs proves nothing — the NodeView- and
// attribute-bearing nodes are exactly what could differ. The probe REPORTS its census and this
// script VOIDS if the census is empty, so a green result on an empty document cannot be read as a
// pass. (CLAUDE.md: a metric that collects nothing must VOID, never read as zero.)
//
// Usage: pnpm build && pnpm prove:schema      (boots its own server on an ephemeral port)
//    or: PROBE_PORT=<port> node scripts/textrender-probe/schemaIdentity.prove.mjs   (reuse a server)

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const { base: BASE, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
page.on('pageerror', e => console.log('PAGEERROR:', e.message))

await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)

// ── THE SERVED-BUNDLE ASSERTION, BEFORE ANY NUMBER IS READ ───────────────────────────────────────
// Two agents were burned tonight: one read a probe surface that existed in a STALE bundle; another's
// port collided and every request went to a DIFFERENT agent's Inkwave build. So: prove the code
// under test is actually the code being served, by CONTENT, before believing anything it says.
const surface = await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  return { present: !!p, hasSchemaIdentity: !!(p && typeof p.schemaIdentity === 'function') }
})
if (!surface.present) { console.log('VOID: no __iwTextRenderProbe — wrong build or flag off'); await b.close(); await stop(); process.exit(2) }
if (!surface.hasSchemaIdentity) {
  console.log('VOID: probe surface has no schemaIdentity() — THE SERVED BUNDLE IS NOT YOURS (stale build?). Rebuild.')
  await b.close(); await stop(); process.exit(2)
}
console.log('served bundle carries schemaIdentity(): OK')

// ── The fixture: citations + math + refList + marks, not bare paragraphs ─────────────────────────
let s = 1337; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
const W = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate').split(/\s+/)
const words = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(W[Math.floor(rnd() * W.length)]); return o.join(' ') }

const content = []
content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chapter One' }] })
for (let i = 0; i < 40; i++) {
  const para = [{ type: 'text', text: words(30) + ' ' }]
  // A citation every paragraph — the NodeView-bearing inline atom.
  para.push({ type: 'citation', attrs: { citekeys: [`src${i % 7}`], locator: String(10 + i), prefix: i % 3 ? null : 'see', suffix: null, suppressAuthor: false, quote: null, instanceId: `i${i}` } })
  para.push({ type: 'text', text: ' ' + words(20) + ' ' })
  para.push({ type: 'text', marks: [{ type: 'bold' }], text: 'emphasis' })
  para.push({ type: 'text', text: ' ' + words(10) + ' ' })
  para.push({ type: 'mathInline', attrs: { latex: 'x^{2} + y_{i}' } })
  para.push({ type: 'text', text: ' ' + words(25) + '.' })
  content.push({ type: 'paragraph', content: para })
  if (i % 10 === 5) content.push({ type: 'mathBlock', attrs: { latex: '\\int_0^1 f(x)\\,dx = \\alpha', align: 'aligned' } })
}
content.push({ type: 'referenceList', attrs: { mode: 'cited', manualKeys: [] } })

const doc = {
  id: 'schemaid', title: 'schemaid', contentJson: { type: 'doc', content },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'sid',
}
await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 2000, null, { timeout: 60000 })
await page.waitForTimeout(3000)

const r = await page.evaluate(() => window.__iwTextRenderProbe.schemaIdentity())

console.log('\n── census actually exercised (VOIDs the run if empty) ──')
console.log(JSON.stringify(r.census))
const exercised = r.census.citation > 0 && r.census.mathInline > 0 && r.census.mathBlock > 0 && r.census.referenceList > 0 && r.census.marks > 0
if (!exercised) {
  console.log('VOID: the fixture did not reach the editor with citations/math/refList/marks.')
  console.log('A schema comparison over bare paragraphs proves nothing. Not reporting a verdict.')
  await b.close(); await stop(); process.exit(2)
}

console.log('\n── verdict ──')
console.log('nodes:', r.nodeCount, ' marks:', r.markCount)
console.log('SPEC IDENTICAL (standalone vs live editor.schema):', r.identical)
if (!r.identical) { console.log('divergences:'); for (const d of r.diffs.slice(0, 20)) console.log('  ', d) }
console.log('live doc re-parsed by standalone schema :', r.reparsed)
// STRUCTURAL equality, deliberately NOT PM's `Node.eq`: PM compares NodeType by REFERENCE, so eq
// is false across two Schema instances no matter what — it reported false for the UNTOUCHED doc.
console.log('re-parsed doc == live doc (structural)   :', r.docEq)

// ── THE KNOWN-NEGATIVE: prove this comparison CAN fail ───────────────────────────────────────────
// Everything above passing is worthless unless the instrument can say NO. `docEqOf` is the SAME
// path `docEq` takes (standalone parse → PM eq against the live doc), driven to the opposite answer
// by mutating a REAL attribute. Both arms are read: the negative must FIRE (mutated ⇒ false) AND
// the positive must still HOLD afterwards (clean ⇒ true) — a negative that fires because the
// comparison is simply broken proves nothing. It must DISCRIMINATE. (CLAUDE.md ROUND 13's rule,
// where a mutated sig had to be refused AND the correct sig still hit.)
const neg = await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const clean = p.schemaIdentity()
  return {
    // arm 1: the live doc, untouched, must compare EQUAL through docEqOf
    cleanEq: p.docEqOf(clean.liveJson),
    // arm 2: one citation's citekeys corrupted — must compare UNEQUAL
    mutatedEq: p.docEqOf(clean.mutatedJson),
    // arm 3: structurally unparseable — must be refused (null), not silently "equal"
    junkEq: p.docEqOf({ type: 'doc', content: [{ type: 'noSuchNodeType' }] }),
    mutationApplied: clean.mutationApplied,
  }
})
console.log('\n── known-negative (same path, opposite answers) ──')
if (!neg.mutationApplied) {
  console.log('VOID: no citation found to mutate — the negative could not be constructed,')
  console.log('so it cannot have fired. Refusing to report a pass. (A negative that cannot fail is not a negative.)')
  await b.close(); await stop(); process.exit(2)
}
console.log('clean doc   → docEqOf =', neg.cleanEq,   '(must be true — the positive still holds)')
console.log('mutated cite→ docEqOf =', neg.mutatedEq, '(must be FALSE — the negative fires)')
console.log('junk node   → docEqOf =', neg.junkEq,    '(must be null — refused, not "equal")')
const negOk = neg.cleanEq === true && neg.mutatedEq === false && neg.junkEq === null
console.log('NEGATIVE DISCRIMINATES:', negOk)

const pass = r.identical && r.reparsed && r.docEq && r.diffs.length === 0 && negOk
console.log('\nRESULT:', pass ? 'PASS — standalone schema IS the editor\'s schema' : 'FAIL')
await b.close()
await stop()
process.exit(pass ? 0 : 1)
