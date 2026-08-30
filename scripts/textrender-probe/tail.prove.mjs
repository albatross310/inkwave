// WHY IS THE LAST PAGE UNREACHABLE BY CONTENT?
//
// `lastPageReachableByContent` is FALSE and it is NOT the probe artifact it was first blamed on, and
// NOT the refList (the breaktable-store agent probed refList:false — identical). It reports lastPos
// landing on page 16 of an 18-page model.
//
// WHAT MAKES THIS ONE AWKWARD, and how this probe is shaped for it: the model's own self-consistency
// checks all PASS — `pagesAgreesWithWalk`, `maxPageOfLine === pages-1`, `pageTopLen === pages`. So
// whatever this is, it survives all three, which means the answer is somewhere none of them can look.
// A check that passes while the thing it guards is broken is this codebase's signature failure, so
// this probe ASSERTS NOTHING and DUMPS THE STRUCTURE instead — the per-page line histogram, the tail
// blocks/lines, monotonicity of `pos` (pageContainingPos BINARY-SEARCHES it), and the page each
// candidate tail position resolves to. Read the shape, then decide what is wrong.
//
// TOOLING (both cost other agents real time today, both now in CLAUDE.md):
//   • ASSERT THE SERVED CHUNK IS OURS before reading a number. Several agents are running servers;
//     a probe confidently reported "the wiring never fires" because another agent's build held its
//     port. This probe checks the build commit it actually loaded.
//   • WARM BEFORE TIMING. JIT tier-up takes 12 identical calls from 291.7ms to 81.8ms. (No timing is
//     read here — this is a structural dump — but the build is warmed so the model is the settled one.)
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
import { autoBase } from './serve.mjs'

const BASE = await autoBase()
let failed = false
const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)

  // ── Is the chunk we are about to read OURS? ──
  const build = await page.evaluate(() => ({
    commit: window.__BUILD_COMMIT__ ?? null,
    hasProbe: !!window.__iwTextRenderProbe,
    hasTail: typeof (window.__iwTextRenderProbe && window.__iwTextRenderProbe.tailProof) === "function",
  }))
  console.log(`served build: commit=${build.commit} probe=${build.hasProbe} tailProof=${build.hasTail}`)
  if (!build.hasTail) {
    console.log('VOID — the served bundle has no tailProof(): this is NOT our build (another agent\'s')
    console.log('       server on this port, or a stale build/client). Every number below would be')
    console.log('       from a different Inkwave. Rebuild and use your OWN port.')
    await b.close(); process.exit(1)
  }

  for (const [name, opts] of [
    ['thesis shape (13k words / 174 cites / lists / refList)', { words: 13000, cites: 174, marked: 1, lists: true, refList: true, id: 'tail-ref' }],
    ['SAME, refList:false (the hypothesis already killed)', { words: 13000, cites: 174, marked: 1, lists: true, refList: false, id: 'tail-noref' }],
    ['prose only (no lists, no cites, no refList)', { words: 13000, cites: 0, marked: 0, lists: false, refList: false, id: 'tail-prose' }],
  ]) {
    const d = buildCitationDoc(opts)
    await page.evaluate((dd) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: dd.id, doc: dd } })), d)
    await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 6000, null, { timeout: 90000 })
    await page.waitForTimeout(5000)
    const st = await page.evaluate(() => window.__iwTextRenderProbe.selfTest())
    if (!st.fontsReallyLoaded || !st.seesKnownPositive) { console.log(`\n━━━ ${name}: PROBE BLIND (fonts=${st.fontsReallyLoaded} pos=${st.seesKnownPositive}) — skipped`); continue }
    // THE KNOWN-NEGATIVE FIRST. `__iwAtomPos='legacy'` restores the pre-fix rule (every block gets
    // offset+1). It MUST reproduce the failure — a leaf atom's own position resolving to the page
    // BEFORE it — or this probe cannot see the bug and its pass means nothing.
    await page.evaluate(() => { window.__iwAtomPos = 'legacy' })
    const neg = await page.evaluate(() => window.__iwTextRenderProbe.tailProof())
    await page.evaluate(() => { delete window.__iwAtomPos })
    const r = await page.evaluate(() => window.__iwTextRenderProbe.tailProof())
    console.log(`\n━━━━━━ ${name} ━━━━━━`)
    console.log(`  pages=${r.pages}  maxPageOfLine=${r.maxPageOfLine}  pageTopLen=${r.pageTopLen}  lines=${r.lines}  blocks=${r.blocks}`)
    console.log(`  contentSize=${r.contentSize}  maxLinePos=${r.maxLinePos}  estimatedBlocks=${r.estimatedBlocks}  reliablePages=${r.reliablePages}`)
    console.log(`  THE CHECKS THAT PASS:  maxPageOfLine===pages-1: ${r.maxPageOfLineIsLast}   pageTopLen===pages: ${r.pageTopLenEqualsPages}   pos monotonic: ${r.posIsMonotonic} (${r.nonMonotonic} inversions, first at ${r.firstNonMono})`)
    console.log(`  EMPTY PAGES (no line ⇒ unreachable by ANY position): ${JSON.stringify(r.emptyPages)}  count=${r.emptyPageCount}`)
    console.log(`  lines on last 6 pages: ${JSON.stringify(r.perPageTail)}`)
    console.log(`  candidate tail positions →`)
    for (const c of r.candidates) console.log(`      ${String(c.name).padEnd(40)} pos=${String(c.pos).padStart(7)} → page ${c.page}`)
    console.log(`  tail blocks:`)
    for (const tb of r.tailBlocks) console.log(`      ${String(tb.type).padEnd(16)} kind=${String(tb.kind).padEnd(12)} start=${String(tb.start).padStart(7)} end=${String(tb.end).padStart(7)} top=${String(tb.top).padStart(7)} h=${String(tb.height).padStart(5)} est=${tb.estimated}`)
    console.log(`  tail lines:`)
    for (const tl of r.tailLines) console.log(`      i=${String(tl.i).padStart(5)} pos=${String(tl.pos).padStart(7)} top=${String(tl.top).padStart(7)} blk=${String(tl.blockIdx).padStart(4)} page=${tl.page}`)

    // ── THE INVARIANT: the LAST BLOCK's OWN position must resolve to the LAST page. ──
    // Note this is the last block's position, derived from the tail dump — NOT `content.size - 2`,
    // which lands inside the SECOND-TO-LAST block whenever the doc ends in a leaf atom and is why
    // `lastPageReachableByContent` read false for two different reasons at once.
    const lastBlock = r.tailBlocks[r.tailBlocks.length - 1]
    const posOf = (rr, pos) => { const c = rr.candidates.find((x) => x.pos === pos); return c ? c.page : null }
    const fixedPage = posOf(r, lastBlock.start) ?? r.candidates[1].page   // content.size - 1
    const negPage = posOf(neg, lastBlock.start) ?? neg.candidates[1].page
    const isLeafTail = lastBlock.end - lastBlock.start === 1
    console.log(`  ── INVARIANT: last block (${lastBlock.type}, nodeSize ${lastBlock.end - lastBlock.start}) own position → last page? ──`)
    console.log(`     FIXED   rule: page ${fixedPage} of ${r.pages} (last = ${r.pages - 1})  → ${fixedPage === r.pages - 1 ? 'REACHABLE' : 'UNREACHABLE'}`)
    console.log(`     LEGACY  rule: page ${negPage} of ${neg.pages} (last = ${neg.pages - 1})  → ${negPage === neg.pages - 1 ? 'REACHABLE' : 'UNREACHABLE'}`)
    if (!isLeafTail) {
      console.log('     (this fixture does NOT end in a leaf atom — the rules cannot differ here, so')
      console.log('      no verdict is read from it. That is the point of running all three fixtures.)')
    } else if (negPage === fixedPage) {
      console.log('     VOID — the known-negative did NOT fire: the legacy rule scored the same as the fix,')
      console.log('     so this probe cannot see the bug and its pass would mean nothing.')
      failed = true
    } else if (fixedPage !== r.pages - 1) {
      console.log('     FAIL — the fix does not make the last page reachable.')
      failed = true
    } else {
      console.log('     → negative FIRES (legacy lands a page early) and the fix REACHES the last page.')
    }
  }
  await b.close()
  if (failed) { console.log('\nVERDICT: FAILED'); process.exit(1) }
  console.log('\nVERDICT: leaf-atom position rule holds; known-negative fires where it can.')
}
run().catch((e) => { console.error(e); process.exit(1) })
