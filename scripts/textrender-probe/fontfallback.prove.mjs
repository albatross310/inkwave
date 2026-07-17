// WHY DOES A **CERTIFIED** FONT MARK DIVERGE? — textStyle:fontFamily, Δ76, matched 0/50, SILENT.
//
// This is the highest-value unexplained row on the lane: Peter's real thesis carries a
// textStyle{fontFamily} mark on ~all 174 of its citations, so whatever this is, it is live on his
// document. The model reported estimatedBlocks 0 and FULL reliability while every single break
// position was wrong.
//
// ⚠ THE HYPOTHESIS BELOW WAS REFUTED — kept because the refutation is the finding, and because the
// next person will have the same idea. RESULT: canvas and the DOM agree EXACTLY on every certified
// stack once the face is loaded (Crimson 632.64 vs 632.64, Δ0). The model is NOT measuring a
// fallback, so textStyle:fontFamily's Δ76 is NOT a font problem. `document.fonts.check` also
// returns FALSE for a stack whose primary family is missing (contrary to the trap this predicted),
// so `makeFontLoaded` correctly refuses an unloaded face and its block DEFERS.
// ALSO EXONERATED, separately: line-height is `var(--inkwave-lh, 1.618)` — UNITLESS, so the line
// box is font-INDEPENDENT and a different family cannot change it.
// STILL UNEXPLAINED: textStyle:fontFamily Δ76 at break 0, matched 0/50, estimatedBlocks 0.
//
// THE HYPOTHESIS UNDER TEST (falsify it): `makeFontLoaded` cannot see a fallback that is not
// monospace.
//     ok = document.fonts.check(`${sizePx}px ${stack}`)
//     if (ok) { const w = measure(PROBE, stack); const mono = measure(PROBE, 'monospace')
//               if (Math.abs(w - mono) < 0.01) ok = false }   // "we are measuring the fallback"
// Two holes, both structural:
//   1. `document.fonts.check` on a STACK returns TRUE whenever ANY family in it is renderable — and
//      every stack ends in `serif`, which always is. selfTest's own comment says so: "document.fonts
//      .check alone is the TRAP". So the check passes for a face that never loaded.
//   2. The mono comparison only catches a fallback to MONOSPACE. `'Crimson Pro', 'Times New Roman',
//      serif` falls back to Times New Roman — PROPORTIONAL — so `w !== mono` and the guard is happy.
// If that is right, the model measures Times New Roman while the editor renders Crimson Pro, and it
// reports full confidence the whole time.
//
// THE INSTRUMENT: compare the CANVAS advance (what the model wraps on) against the DOM's OWN
// rendered width (what the editor wraps on) for the SAME string in the SAME stack. That is the only
// comparison that cannot be fooled by either API's opinion about what is "available".
//
// CONTROL: the DEFAULT stack ('EB Garamond', …) must AGREE — the whole matrix's 17 identical rows
// depend on it. If the control diverges the harness is wrong and no verdict may be read.
import { chromium } from '@playwright/test'
import { buildTypeDoc } from './typefixtures.mjs'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`

const STACKS = [
  ['DEFAULT (control)', "'EB Garamond', Georgia, serif"],
  ['Fell', "'IM Fell DW Pica', 'EB Garamond', Georgia, serif"],
  ['Crimson', "'Crimson Pro', 'Times New Roman', serif"],
  ['Romans', "'TeX Gyre Termes', 'Times New Roman', Times, serif"],
  ['Spectral', "'Spectral', 'Times New Roman', Times, serif"],
  ['Gentium', "'Gentium Plus', 'Palatino Linotype', serif"],
  ['UNSHIPPED (Georgia)', 'Georgia, serif'],
]

const MEASURE = (stacks) => {
  const out = []
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const S = 'The quick brown fox jumps over the lazy dog, philosophy and characteristica universalis.'
  // A DOM span in the SAME conditions the editor wraps in: inside .ProseMirror, inline, no wrap.
  const pm = document.querySelector('.ProseMirror') || document.body
  for (const [label, stack] of stacks) {
    const span = document.createElement('span')
    span.style.cssText = `font: 400 18px ${stack}; white-space: pre; position: absolute; visibility: hidden; left: -99999px;`
    span.textContent = S
    pm.appendChild(span)
    const domW = span.getBoundingClientRect().width
    span.remove()

    ctx.font = `400 18px ${stack}`
    const canvasW = ctx.measureText(S).width

    // The primary family ALONE — the honest availability question the stack check cannot ask.
    const primary = stack.split(',')[0].trim()
    let checkStack = null, checkPrimary = null
    try { checkStack = document.fonts.check(`18px ${stack}`) } catch { /* */ }
    try { checkPrimary = document.fonts.check(`18px ${primary}`) } catch { /* */ }

    // What makeFontLoaded actually concludes, reproduced exactly.
    const PROBE = 'iiiiiiiiiiWWWWWWWWWW'
    ctx.font = `400 18px ${stack}`; const w = ctx.measureText(PROBE).width
    ctx.font = '400 18px monospace'; const mono = ctx.measureText(PROBE).width
    const fontLoadedSays = checkStack && Math.abs(w - mono) >= 0.01

    out.push({ label, stack, primary, domW: +domW.toFixed(2), canvasW: +canvasW.toFixed(2), delta: +(canvasW - domW).toFixed(2), checkStack, checkPrimary, fontLoadedSays })
  }
  return out
}

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  await p.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.tiptap-editor', { timeout: 30000 })
  await p.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await p.waitForTimeout(3000)
  if (!await p.evaluate(() => typeof window.__iwTextRenderProbe?.build === 'function')) {
    console.log('VOID — served bundle has no __iwTextRenderProbe: NOT our build.'); await b.close(); process.exit(1)
  }

  // LOAD A DOCUMENT THAT ACTUALLY USES THE MARK FIRST. The self-hosted faces are fetched ON DEMAND:
  // a page with no Crimson text never fetches Crimson, so measuring there reports the fallback for
  // every certified family and proves nothing about the matrix, where the document DOES render them.
  // (First cut of this probe measured cold and had Crimson/Romans/Spectral/Gentium ALL reading
  // Georgia's exact 643.83 — a perfectly consistent, perfectly irrelevant answer.)
  const doc = buildTypeDoc({ types: ['textStyle:fontFamily'], words: 2000, id: 'ffload' })
  await p.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await p.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 500, null, { timeout: 60000 })
  await p.waitForFunction(() => document.fonts.status === 'loaded', { timeout: 30000 })
  await p.waitForTimeout(4000)
  const used = await p.evaluate(() => {
    const el = document.querySelector('.ProseMirror span[style*="font-family"], .ProseMirror [style*="Crimson"]')
    return { found: !!el, css: el ? getComputedStyle(el).fontFamily : null, check: document.fonts.check('18px "Crimson Pro"') }
  })
  console.log(`\n  after loading a Crimson-marked doc: check("Crimson Pro") = ${used.check} · marked span found = ${used.found}`)
  console.log(`  its computed font-family = ${used.css}`)

  console.log('\n╔══ DOES THE MODEL MEASURE THE FONT THE EDITOR RENDERS?')
  console.log('║  canvas advance (what the model wraps on) vs the DOM\'s own rendered width (what the editor')
  console.log('╚══ wraps on), same string, same stack, inside the real .ProseMirror.\n')
  console.log(`  ${'stack'.padEnd(20)} ${'DOM px'.padStart(9)} ${'canvas'.padStart(9)} ${'Δ'.padStart(8)}   check(stack) check(primary) fontLoaded()`)
  const rows = await p.evaluate(MEASURE, STACKS)
  for (const r of rows) {
    const flag = Math.abs(r.delta) > 0.5 ? '  ← DIVERGES' : ''
    console.log(`  ${r.label.padEnd(20)} ${String(r.domW).padStart(9)} ${String(r.canvasW).padStart(9)} ${String(r.delta).padStart(8)}   ${String(r.checkStack).padEnd(12)} ${String(r.checkPrimary).padEnd(14)} ${r.fontLoadedSays}${flag}`)
  }
  await b.close()

  const control = rows[0]
  console.log('\n══ VERDICT ══')
  if (Math.abs(control.delta) > 0.5) {
    console.log('  VOID — the DEFAULT stack diverges too. The harness is comparing two different things')
    console.log('         (canvas and DOM disagree even where the matrix proves 17 rows identical), so no')
    console.log('         row below can be attributed to a font. Fix this first.')
    process.exit(1)
  }
  console.log('  ✓ control holds: on the default stack, canvas and the DOM agree — the comparison is sound.')
  const bad = rows.slice(1).filter((r) => Math.abs(r.delta) > 0.5)
  if (!bad.length) {
    console.log('  Every certified stack agrees. The textStyle:fontFamily divergence is NOT a font fallback;')
    console.log('  re-attribute (line-height? the mark\'s own CSS? something in the block, not the run).')
  } else {
    for (const r of bad) {
      const lying = r.fontLoadedSays
      console.log(`  ✗ ${r.label}: canvas is ${r.delta > 0 ? 'WIDER' : 'NARROWER'} than the DOM by ${Math.abs(r.delta)}px over one line`)
      console.log(`      check("${r.primary}") = ${r.checkPrimary}   check(full stack) = ${r.checkStack}   makeFontLoaded says loaded = ${lying}`)
      if (lying && r.checkPrimary === false) {
        console.log('      ⇒ THE FACE IS NOT LOADED and makeFontLoaded says it is: the stack check passes because')
        console.log('        every stack ends in `serif`, and the mono guard cannot see a PROPORTIONAL fallback.')
        console.log('        The model wraps on the fallback while the editor renders the real face — silently.')
      }
    }
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
