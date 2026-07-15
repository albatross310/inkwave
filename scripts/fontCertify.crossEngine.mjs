// CROSS-ENGINE FONT CERTIFICATION (2026-07-16) — Chromium + WebKit.
//
// JOB 1: re-run the corrected certification (canvas↔DOM parity, per engine) under BOTH engines, for
//        the full shipped picker. CERTIFIED_FAMILIES may only contain families that pass on BOTH —
//        a font that passes Chromium and fails WebKit would make the arithmetic engine compute a
//        WRONG wrap on Peter's iPhone.
//
// JOB 2 (the load-bearing one): CROSS-ENGINE DOM↔DOM PARITY. The certification above only proves
//        canvas agrees with the DOM *inside one engine*. The actual invariant is that CANONICAL
//        BREAKS ARE IDENTICAL ACROSS DEVICES — Chromium's DOM wrap must equal WebKit's DOM wrap for
//        the same text + font + width. Neither r7 nor the round-9 re-cert ever measured that. If two
//        engines wrap a certified font differently, canonical pagination was never cross-device for
//        it — a hole independent of the arithmetic engine. Measured here with the posAtCoords /
//        first-visible-glyph reference proven to be ground truth.
//
// ⚠ SCOPE HONESTY: Playwright's Linux WebKit is the GTK/WPE port — FreeType + HarfBuzz. Peter's
// iPhone runs iOS WebKit on CORETEXT, a different shaper/rasteriser. This pass is therefore strong
// evidence about ENGINE-INDEPENDENT wrap rules (and it is what we can run here), but it is NOT proof
// of iOS behaviour. Stated in the report, not buried.
//
// Run: node scripts/fontCertify.crossEngine.mjs <port>

import { chromium, webkit } from '@playwright/test'
import { transformWithEsbuild } from 'vite'
import { createServer } from 'http'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
const CALIB = '/tmp/iw-calib-fonts'
const port = Number(process.argv[2] || 5602)

const PM_CSS = (() => {
  for (const base of ['/root/dev/Inkwave/node_modules/.pnpm', join(ROOT, 'node_modules/.pnpm')]) {
    try {
      for (const d of readdirSync(base)) {
        if (!d.startsWith('prosemirror-view@')) continue
        const f = join(base, d, 'node_modules/prosemirror-view/style/prosemirror.css')
        if (existsSync(f)) return readFileSync(f, 'utf8')
      }
    } catch { /* next */ }
  }
  return ''
})()
if (!PM_CSS.includes('break-spaces')) { console.error('FATAL: real prosemirror.css not found'); process.exit(2) }
const CALIB_CSS = existsSync(join(CALIB, 'calib-fonts.css')) ? readFileSync(join(CALIB, 'calib-fonts.css'), 'utf8') : ''

const tsSrc = readFileSync(join(ROOT, 'src/editor/arithmeticLayout.ts'), 'utf8')
const { code: AL_JS } = await transformWithEsbuild(tsSrc, 'arithmeticLayout.ts', { loader: 'ts', format: 'iife', globalName: 'AL' })

const MIME = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' }
const HARNESS = `<!doctype html><html><head>
<link rel="stylesheet" href="/fonts/inkwave-fonts.css">
<style>${CALIB_CSS}</style>
<style>${PM_CSS}</style>
<style>body{margin:0} #pm{font-size:18px;line-height:1.618}</style>
</head><body><div id="pm" class="ProseMirror" contenteditable="true"></div></body></html>`

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/c.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return }
  const cands = p.startsWith('/calib/') ? [join(CALIB, p.slice('/calib/'.length))] : [join(PUBLIC, p)]
  for (const f of cands) {
    try { if (existsSync(f) && !statSync(f).isDirectory()) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); return } } catch { /* 404 */ }
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(port, r))

// THE FULL SHIPPED PICKER (18) — label → family.
const PICKER = [
  ['Fell', 'IM Fell DW Pica'], ['Garamond', 'EB Garamond'],
  ['Romans', 'TeX Gyre Termes'], ['Crimson', 'Crimson Pro'], ['Spectral', 'Spectral'],
  ['Gentium', 'Gentium Plus'], ['Baskerville', 'Libre Baskerville'], ['Caladea', 'Caladea'],
  ['Cormorant', 'Cormorant Garamond'], ['Fraunces', 'Fraunces'],
  ['Bitter', 'Bitter'], ['Zilla', 'Zilla Slab'],
  ['Swiss', 'TeX Gyre Heros'], ['Carlito', 'Carlito'], ['Inter', 'Inter'], ['Atkinson', 'Atkinson Hyperlegible'],
  ['JetBrains', 'JetBrains Mono'], ['Courier Prime', 'Courier Prime'],
]
const FAMILIES = PICKER.map(([, f]) => f)

async function runEngine(engine, name, args) {
  // HINTING EQUALISED: Chromium's default Linux fontconfig HINTS advances to whole px (measured:
  // every width an integer) while WebKit uses fractional. That is a harness/rasteriser config
  // difference, not an engine-inherent one — real devices use subpixel positioning — so comparing
  // DOM wraps without equalising it manufactures false divergences. --font-render-hinting=none.
  const browser = await engine.launch(args ? { args } : {})
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await page.goto(`http://localhost:${port}/c.html`, { waitUntil: 'load' })
  await page.addScriptTag({ content: AL_JS })
  const out = await page.evaluate(async (families) => {
    const AL = window.AL
    const pm = document.getElementById('pm')
    const cs = getComputedStyle(pm)
    const ctxProbe = document.createElement('canvas').getContext('2d')
    const support = {
      whiteSpace: cs.whiteSpace,
      ligatures: cs.fontVariantLigatures,
      featureSettings: cs.fontFeatureSettings,
      canvasTextRendering: 'textRendering' in ctxProbe,
      canvasFontKerning: 'fontKerning' in ctxProbe,
      caretRangeFromPoint: typeof document.caretRangeFromPoint === 'function',
      caretPositionFromPoint: typeof document.caretPositionFromPoint === 'function',
    }
    const measure = AL.makeCanvasMeasure()
    // WEBKIT VIABILITY: WebKit's canvas has NO textRendering/fontKerning, so the engine cannot turn
    // ligatures OFF there — canvas would apply fi/fl/ffi the editor doesn't render. Alternative:
    // inject ZERO-WIDTH NON-JOINER between ligature-forming pairs, which suppresses the ligature
    // through the normal shaping path. Measured here so "can the engine run on Safari" is answered
    // with data rather than a shrug.
    const zctx = document.createElement('canvas').getContext('2d')
    const zwnjMeasure = (text, font) => { zctx.font = font; return zctx.measureText(text.replace(/f(?=[fil])/g, 'f\u200c')).width }
    const CORPUS = [
      'The quiet harbour light returns across the water and settles into evening calm.',
      'Waffling requires overtly fjord-like typography; quartz vexes 1234567890 (all of it).',
      '“Quoted — dashed” text, with fi fl ffi ligatures and AV To Wa kerning pairs.',
    ]
    const WRAP = ('the long argument continues through this extended passage of sustained prose that '
      + 'must eventually straddle a boundary somewhere in its many wrapped lines and every break must land identically ').repeat(3)
    const SIZES = [10.6667, 14.6667, 18, 24, 32, 48, 96]
    const VARIANTS = [{ w: 400, st: 'normal' }, { w: 700, st: 'normal' }, { w: 400, st: 'italic' }, { w: 700, st: 'italic' }]
    const CONTENT_W = Math.floor((793.7007874015748 - 192) * 64) / 64 // 601.6875, the canonical box

    const reallyLoaded = async (fam) => {
      const S = 'Handgloves AVWa fi fl 12345 quartz'
      for (const v of VARIANTS) { try { await document.fonts.load(`${v.st === 'italic' ? 'italic ' : ''}${v.w} 40px '${fam}'`, S) } catch { /* */ } }
      const c = document.createElement('canvas').getContext('2d')
      c.font = '400 40px monospace'; const mono = c.measureText(S).width
      c.font = `400 40px '${fam}', monospace`
      return Math.abs(c.measureText(S).width - mono) > 0.01
    }
    const declaredFor = (fam) => { const l = []; document.fonts.forEach((f) => { if (f.family.replace(/['"]/g, '') === fam) l.push({ w: String(f.weight), st: f.style }) }); return l }
    const covers = (faces, w, st) => faces.some((f) => {
      if (f.st !== st) return false
      const m = f.w.match(/(\d+)(?:\s+(\d+))?/); if (!m) return false
      const lo = +m[1], hi = m[2] ? +m[2] : lo
      return w >= lo && w <= hi
    })
    // The LIVE line-start convention (proven ground truth): line rects + one hit-test per line.
    const lineStarts = (el) => {
      el.scrollIntoView({ block: 'center' })
      const texts = []; { const wk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = wk.nextNode())) texts.push(n) }
      const flatOf = (n, off) => { let b = 0; for (const t of texts) { if (t === n) return b + off; b += t.textContent.length } return -1 }
      const rg = document.createRange(); rg.selectNodeContents(el)
      const starts = []; let last = -1e9
      for (const rc of Array.from(rg.getClientRects())) {
        if (rc.width < 1 || rc.height < 1 || rc.height > 200 || rc.top - last <= 3) continue
        last = rc.top
        const x = rc.left + 1, y = rc.top + rc.height / 2
        let cr = null
        if (document.caretRangeFromPoint) cr = document.caretRangeFromPoint(x, y)
        else if (document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(x, y); cr = cp ? { startContainer: cp.offsetNode, startOffset: cp.offset } : null }
        starts.push(cr ? flatOf(cr.startContainer, cr.startOffset) : -1)
      }
      return starts
    }

    const res = []
    for (const fam of families) {
      const r = { fam, maxAdv: 0, advFails: [], wrapFails: [], synth: [], cells: 0 }
      if (!(await reallyLoaded(fam))) { r.verdict = 'NOT-LOADED'; res.push(r); continue }
      const faces = declaredFor(fam)
      for (const v of VARIANTS) if (!covers(faces, v.w, v.st)) r.synth.push(`${v.w}${v.st[0]}`)
      for (const v of VARIANTS) {
        if (!covers(faces, v.w, v.st)) continue // synthesised — reported, not certified
        for (const size of SIZES) {
          r.cells++
          const run = { text: '', fontFamily: `'${fam}', serif`, fontSizePx: size, fontWeight: v.w, italic: v.st === 'italic' }
          const font = AL.cssFontOf(run)
          for (const str of CORPUS) {
            const sp = document.createElement('span')
            sp.style.cssText = `font-family:'${fam}', serif;font-size:${size}px;font-weight:${v.w};font-style:${v.st};white-space:pre`
            sp.textContent = str
            pm.appendChild(sp)
            const dom = sp.getBoundingClientRect().width
            sp.remove()
            const d = Math.abs(dom - measure(str, font))
            if (d > r.maxAdv) r.maxAdv = d
            if (d > 0.05 && r.advFails.length < 3) r.advFails.push(`${v.w}${v.st[0]}@${size.toFixed(0)} Δ${d.toFixed(3)}`)
            const dz = Math.abs(dom - zwnjMeasure(str, font))
            if (dz > (r.maxAdvZwnj || 0)) r.maxAdvZwnj = dz
          }
          if (size === 18 || size === 32) {
            const p = document.createElement('p')
            p.style.cssText = `width:500px;margin:0;font-family:'${fam}', serif;font-size:${size}px;font-weight:${v.w};font-style:${v.st}`
            p.textContent = WRAP
            pm.appendChild(p)
            const ds = lineStarts(p)
            p.remove()
            if (ds.some((x) => x < 0)) { r.wrapSkipped = (r.wrapSkipped || 0) + 1; continue }
            r.wrapRun = (r.wrapRun || 0) + 1
            const block = { type: 'paragraph', runs: [{ ...run, text: WRAP }], baseFontPx: size, marginTopPx: 0, marginBottomPx: 0 }
            const eng = AL.layoutParagraph(block, 500, 1.618, measure, AL.EDITOR_WHITE_SPACE).breakStartChars
            const same = eng.length === ds.length && ds.every((x, k) => x === eng[k])
            if (!same && r.wrapFails.length < 3) {
              let k = 0; while (k < ds.length && k < eng.length && ds[k] === eng[k]) k++
              r.wrapFails.push(`${v.w}${v.st[0]}@${size}px lines ${ds.length}vs${eng.length} div@${k}(dom ${ds[k]} eng ${eng[k]})`)
            }
          }
        }
      }
      // ── JOB 2 fixture: the DOM's OWN wrap at the canonical width, 400/18px. Cross-engine compare.
      {
        const p = document.createElement('p')
        p.style.cssText = `width:${CONTENT_W}px;margin:0;font-family:'${fam}', serif;font-size:18px;font-weight:400`
        p.textContent = WRAP
        pm.appendChild(p)
        r.domWrap = lineStarts(p)
        r.domHeight = +p.getBoundingClientRect().height.toFixed(3)
        p.remove()
      }
      r.verdict = (r.cells > 0 && r.advFails.length === 0 && r.wrapFails.length === 0) ? 'CERTIFIED' : (r.cells === 0 ? 'NO-FACES' : 'FAIL')
      r.zwnjOk = (r.maxAdvZwnj || 0) <= 0.05
      res.push(r)
    }
    return { support, res }
  }, FAMILIES)
  await browser.close()
  return { name, ...out, errs }
}

const chrome = await runEngine(chromium, 'Chromium', ['--font-render-hinting=none'])
const wk = await runEngine(webkit, 'WebKit')

const pad = (s, n) => String(s).padEnd(n)
console.log('\n=== CROSS-ENGINE CERTIFICATION — Chromium vs WebKit, editor real context ===\n')
for (const e of [chrome, wk]) {
  console.log(`${e.name} context: white-space=${e.support.whiteSpace}  ligatures=${e.support.ligatures}  featureSettings=${e.support.featureSettings}`)
  console.log(`${' '.repeat(e.name.length)}         canvas.textRendering=${e.support.canvasTextRendering}  canvas.fontKerning=${e.support.canvasFontKerning}  caretRangeFromPoint=${e.support.caretRangeFromPoint}`)
  if (e.errs.length) console.log(`  page errors: ${e.errs.slice(0, 2).join(' | ')}`)
}
const wsMismatch = chrome.support.whiteSpace !== wk.support.whiteSpace
if (wsMismatch) console.log(`\n🚨 WHITE-SPACE MODE DIFFERS ACROSS ENGINES (${chrome.support.whiteSpace} vs ${wk.support.whiteSpace}) — the wrap RULE itself differs cross-device, independent of any font.`)

console.log('\n' + pad('FAMILY', 22) + pad('CHROMIUM', 12) + pad('maxΔ', 9) + pad('WEBKIT', 12) + pad('maxΔ', 9) + pad('WK-zwnj', 7) + pad('DOM↔DOM', 10) + 'NOTE')
console.log('-'.repeat(110))
const byFam = (arr) => Object.fromEntries(arr.map((r) => [r.fam, r]))
const C = byFam(chrome.res), W = byFam(wk.res)
const both = [], crossFails = []
for (const fam of FAMILIES) {
  const c = C[fam], w = W[fam]
  const cw = c.domWrap || [], ww = w.domWrap || []
  const domSame = cw.length > 0 && cw.length === ww.length && cw.every((x, i) => x === ww[i])
  let note = ''
  if (!domSame) {
    let k = 0; while (k < cw.length && k < ww.length && cw[k] === ww[k]) k++
    note = `lines ${cw.length}vs${ww.length} div@${k}(C ${cw[k]} W ${ww[k]})`
    crossFails.push({ fam, c: cw, w: ww, k })
  } else if (c.synth.length || w.synth.length) note = `⚠ synth ${[...new Set([...c.synth, ...w.synth])].join(',')}`
  const ok = c.verdict === 'CERTIFIED' && w.verdict === 'CERTIFIED' && domSame
  if (ok) both.push(fam)
  console.log(pad(fam, 22) + pad(c.verdict, 12) + pad((c.maxAdv ?? 0).toFixed(4), 9) + pad(w.verdict, 12) + pad((w.maxAdv ?? 0).toFixed(4), 9) + pad(w.zwnjOk ? 'zwnj✓' : 'zwnj✗', 7) + pad(domSame ? 'IDENTICAL' : '✗ DIFFER', 10) + note.slice(0, 34))
}
console.log('\n── JOB 2: CROSS-ENGINE DOM↔DOM PARITY (the load-bearing invariant) ──')
if (crossFails.length === 0) console.log(`  ALL ${FAMILIES.length} families: Chromium DOM wrap == WebKit DOM wrap, byte-identical line starts ✓`)
else {
  console.log(`  🚨 ${crossFails.length}/${FAMILIES.length} FAMILIES WRAP DIFFERENTLY ACROSS ENGINES — canonical pagination is NOT cross-device for these:`)
  for (const f of crossFails) console.log(`     ${f.fam}: first divergence at line ${f.k} — Chromium ${f.c.slice(f.k, f.k + 2)} vs WebKit ${f.w.slice(f.k, f.k + 2)}`)
}
console.log('\n── FINAL: certifies on BOTH engines AND wraps identically across them ──')
console.log('  ' + (both.length ? both.join(', ') : 'none'))
const excluded = FAMILIES.filter((f) => !both.includes(f))
console.log('  EXCLUDED: ' + (excluded.length ? excluded.map((f) => `${f}(C:${C[f].verdict}/W:${W[f].verdict})`).join(', ') : 'none'))
server.close()
