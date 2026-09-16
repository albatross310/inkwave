// DIAGNOSTIC: score the candidate ELIGIBILITY RULE for the mixed-family line-box growth.
//
// GROUND TRUTH = the DOM's own line gap for a span inside the real .ProseMirror (grows or not).
// CANDIDATE RULE = "the run renders in the same FACE as the strut", tested from canvas alone:
// identical fontBoundingBox ints AND an identical advance for a long probe string.
//
// A rule that says SAFE where the DOM grows is the fatal direction (wrong words, reported reliable).
// A rule that says DEFER where the DOM does not grow only costs coverage. Both are counted.
import { chromium } from '@playwright/test'

const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4242}`

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
  page.on('pageerror', () => {})
  await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tiptap-editor', { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(3000)

  const out = await page.evaluate(async () => {
    const DEFAULT_STACK = "'EB Garamond', Georgia, serif" // what the MODEL uses for an unmarked run
    const CASES = [
      { label: 'default stack (model default)', fam: DEFAULT_STACK },
      { label: 'default stack BOLD', fam: DEFAULT_STACK, weight: 700 },
      { label: 'default stack ITALIC', fam: DEFAULT_STACK, italic: true },
      { label: 'Crimson Pro', fam: "'Crimson Pro', 'Times New Roman', serif" },
      { label: 'IM Fell DW Pica', fam: "'IM Fell DW Pica', 'EB Garamond', Georgia, serif" },
      { label: 'Spectral', fam: "'Spectral', Georgia, serif" },
      { label: 'Lora', fam: "'Lora', Georgia, serif" },
      { label: 'JetBrains Mono', fam: "'JetBrains Mono', ui-monospace, monospace" },
      { label: 'Atkinson Hyperlegible', fam: "'Atkinson Hyperlegible', system-ui, sans-serif" },
      { label: 'Bitter', fam: "'Bitter', Georgia, serif" },
      { label: 'Gelasio', fam: "'Gelasio', Georgia, serif" },
      { label: 'Fraunces', fam: "'Fraunces', Georgia, serif" },
      { label: 'Carlito', fam: "'Carlito', Calibri, sans-serif" },
      { label: 'Cormorant Garamond', fam: "'Cormorant Garamond', Garamond, serif" },
      { label: 'Gentium Plus', fam: "'Gentium Plus', Georgia, serif" },
      { label: 'Crimson Pro BOLD', fam: "'Crimson Pro', 'Times New Roman', serif", weight: 700 },
    ]
    for (const c of CASES) { try { await document.fonts.load(`${c.italic ? 'italic ' : ''}${c.weight ?? 400} 18px ${c.fam}`) } catch { /* ignore */ } }

    const pm = document.querySelector('.ProseMirror')
    const strutStack = getComputedStyle(pm).fontFamily
    const ctx = document.createElement('canvas').getContext('2d')
    try { ctx.textRendering = 'optimizeSpeed' } catch { /* older */ }
    try { ctx.fontKerning = 'normal' } catch { /* older */ }
    const PROBE = 'office affluent finds difficult waffles fi fl ffi ffl AV To Wa philosophy leibniz'
    const face = (font) => { ctx.font = font; const m = ctx.measureText('Hxg'); return { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent, w: ctx.measureText(PROBE).width } }
    // The MODEL's strut, as the model would build it: DEFAULT_STACK at the base size, weight 400.
    const strut = face(`400 18px ${DEFAULT_STACK}`)

    const TXT = 'philosophy leibniz universal language calculus ratiocinator characteristica argument thesis '.repeat(6)
    const rows = []
    for (const c of CASES) {
      const p = document.createElement('p')
      const s = document.createElement('span')
      s.style.fontFamily = c.fam
      if (c.weight) s.style.fontWeight = String(c.weight)
      if (c.italic) s.style.fontStyle = 'italic'
      s.textContent = TXT
      p.appendChild(s)
      pm.appendChild(p)
      const rng = document.createRange()
      rng.selectNodeContents(s.firstChild)
      const tops = []
      for (const r of rng.getClientRects()) if (!tops.some((t) => Math.abs(t - r.top) <= 3)) tops.push(r.top)
      tops.sort((a, z) => a - z)
      const gap = tops.length > 2 ? +(tops[2] - tops[1]).toFixed(6) : null
      p.remove()

      const f = face(`${c.italic ? 'italic ' : ''}${c.weight ?? 400} 18px ${c.fam}`)
      // CANDIDATE: compare the run's family AT THE STRUT'S OWN WEIGHT/STYLE — a line box is decided
      // by FONT METRICS, and bold/italic of one family share them (scored below, not assumed).
      const fam = face(`400 18px ${c.fam}`)
      const ruleSafe = fam.a === strut.a && fam.d === strut.d && Math.abs(fam.w - strut.w) < 0.01
      const domGrows = gap !== null && Math.abs(gap - 29.109375) > 0.0001
      rows.push({
        case: c.label, domGap: gap, domGrows,
        canvasA: f.a, canvasD: f.d, ruleSaysSafe: ruleSafe,
        verdict: domGrows && ruleSafe ? '!! UNSAFE (rule blind)' : (!domGrows && !ruleSafe ? 'over-defer (safe, costs coverage)' : 'agrees'),
      })
    }
    return { strutStack, strut, rows }
  })
  console.log('.ProseMirror stack:', out.strutStack, ' model-strut metrics:', JSON.stringify(out.strut))
  console.table(out.rows)
  const unsafe = out.rows.filter((r) => r.verdict.startsWith('!!'))
  const over = out.rows.filter((r) => r.verdict.startsWith('over'))
  console.log(`\nUNSAFE (rule says safe, DOM grows): ${unsafe.length}   over-defer: ${over.length}   agrees: ${out.rows.length - unsafe.length - over.length} / ${out.rows.length}`)
  await b.close()
  if (unsafe.length) process.exit(1)
}
run().catch((e) => { console.error(e); process.exit(1) })
