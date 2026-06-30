// Block math KaTeX↔MathLive: measure block container height, reflow of content
// below, and the math content position. Block uses displaystyle in BOTH engines.
import { chromium } from '@playwright/test'
import fs from 'fs'
const OUT = '/tmp/claude-0/-root/5d71efa8-51b4-40aa-bd9c-b84e1c5f2a59/scratchpad'

const CASES = [
  { name: 'simple',   latex: 'x^2 + y^2 = z^2' },
  { name: 'frac',     latex: '\\frac{a+1}{b}' },
  { name: 'sum',      latex: '\\sum_{i=0}^n i^2' },
  { name: 'integral', latex: '\\int_0^1 x^2\\,dx' },
]
const browser = await chromium.launch({ headless: true })

for (const tc of CASES) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 3 })
  await page.goto('http://localhost:5173/')
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('.ProseMirror')
  await page.click('.ProseMirror'); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.waitForTimeout(120)
  // a marker line above and below the block to detect reflow
  await page.keyboard.type('ABOVE line')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Alt+Shift+Equal')   // insert block math (auto-active/MathLive)
  await page.waitForTimeout(850)
  await page.keyboard.type(tc.latex)
  await page.keyboard.press('Escape')            // commit → KaTeX
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.keyboard.type('BELOW line')
  await page.waitForTimeout(200)

  const measure = () => page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top:+b.top.toFixed(2), bottom:+b.bottom.toFixed(2), left:+b.left.toFixed(2), w:+b.width.toFixed(2), h:+b.height.toFixed(2) } }
    // block container = the NodeViewWrapper div holding katex-display or math-field
    const kd = document.querySelector('.katex-display')
    const mf = document.querySelector('math-field')
    // the block wrapper: nearest ancestor that is a direct child of ProseMirror
    const anchor = (kd || mf)
    let wrap = anchor
    while (wrap && wrap.parentElement && !wrap.parentElement.classList.contains('ProseMirror')) wrap = wrap.parentElement
    // BELOW line position
    let belowTop = null
    const walker = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT)
    let n; while ((n = walker.nextNode())) { if (n.textContent.includes('BELOW')) { const rg = document.createRange(); rg.selectNode(n); belowTop = +rg.getBoundingClientRect().top.toFixed(2); break } }
    let mlBase = null
    if (mf && mf.shadowRoot) { const b = mf.shadowRoot.querySelector('.ML__base'); if (b) mlBase = r(b) }
    return { wrap: r(wrap), katexDisplay: r(kd), mathField: r(mf), mlBase, belowTop }
  })

  const k = await measure()
  const bw = k.wrap
  const clip = { x: Math.max(0, bw.left - 20), y: Math.max(0, bw.top - 40), width: 520, height: bw.h + 90 }
  await page.screenshot({ path: `${OUT}/block-${tc.name}-1-katex.png`, clip })

  // Activate the block: click its center
  await page.evaluate(() => {
    const kd = document.querySelector('.katex-display'); let wrap = kd
    while (wrap && wrap.parentElement && !wrap.parentElement.classList.contains('ProseMirror')) wrap = wrap.parentElement
    wrap.click()
  })
  await page.waitForTimeout(1400)
  const m = await measure()
  await page.screenshot({ path: `${OUT}/block-${tc.name}-2-mathlive.png`, clip })
  await page.close()

  const d = (a,b) => (a!=null&&b!=null) ? +(b-a).toFixed(2) : null
  console.log(`\n=== block ${tc.name} (${tc.latex}) ===`)
  console.log(`  wrap H:     katex=${k.wrap?.h}  ml=${m.wrap?.h}   Δ=${d(k.wrap?.h, m.wrap?.h)}`)
  console.log(`  wrap top:   katex=${k.wrap?.top}  ml=${m.wrap?.top}   Δ=${d(k.wrap?.top, m.wrap?.top)}`)
  console.log(`  BELOW top:  katex=${k.belowTop}  ml=${m.belowTop}   Δ=${d(k.belowTop, m.belowTop)}   <-- REFLOW`)
  console.log(`  content top: katexDisp=${k.katexDisplay?.top}  mlBase=${m.mlBase?.top}   Δ=${d(k.katexDisplay?.top, m.mlBase?.top)}`)
  console.log(`  content left:katexDisp=${k.katexDisplay?.left}  mlBase=${m.mlBase?.left}   Δ=${d(k.katexDisplay?.left, m.mlBase?.left)}`)
}
await browser.close()
console.log('\ndone')
