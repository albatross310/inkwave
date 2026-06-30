// Proof of the real fix: screenshot KaTeX state vs actual MathLive activation
// (source now has inline-math mode + 1.21em). Also measure box-relative glyph deltas.
import { chromium } from '@playwright/test'
import fs from 'fs'
const OUT = '/tmp/claude-0/-root/5d71efa8-51b4-40aa-bd9c-b84e1c5f2a59/scratchpad'

const CASES = [
  { name: 'plain-x',  latex: 'x' },
  { name: 'super',    latex: 'x^2' },
  { name: 'subsup',   latex: 'A_i^2' },
  { name: 'frac',     latex: '\\frac{a+1}{b}' },
  { name: 'sqrt',     latex: '\\sqrt{x+y}' },
  { name: 'sum',      latex: '\\sum_{i=0}^n i' },
  { name: 'integral', latex: '\\int_0^1 x\\,dx' },
  { name: 'limit',    latex: '\\lim_{x\\to0} f(x)' },
  { name: 'vec',      latex: '\\vec{v}\\cdot\\hat{n}' },
  { name: 'greek',    latex: '\\alpha\\beta\\gamma' },
]
const browser = await chromium.launch({ headless: true })

for (const tc of CASES) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 }, deviceScaleFactor: 3 })
  await page.goto('http://localhost:5173/')
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('.ProseMirror')
  await page.click('.ProseMirror'); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.waitForTimeout(120)
  await page.keyboard.type('text A ')
  await page.keyboard.press('Alt+Equal'); await page.waitForTimeout(850)
  await page.keyboard.type(tc.latex)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.keyboard.type(' B text'); await page.waitForTimeout(180)

  const bb = await page.evaluate(() => { const b = document.querySelector('[data-math-inline-box]').getBoundingClientRect(); return { left: b.left, top: b.top, h: b.height } })
  const clip = { x: Math.max(0, bb.left - 60), y: Math.max(0, bb.top - 18), width: 320, height: bb.h + 36 }

  const katex = await page.evaluate(() => {
    const box = document.querySelector('[data-math-inline-box]'); const br = box.getBoundingClientRect()
    const k = box.querySelector('.katex-html') || box.querySelector('.katex'); const r = k.getBoundingClientRect()
    return { L:+(r.left-br.left).toFixed(2), W:+r.width.toFixed(2), H:+r.height.toFixed(2), midY:+(((r.top+r.bottom)/2)-br.top).toFixed(2) }
  })
  await page.screenshot({ path: `${OUT}/proof-${tc.name}-1-katex.png`, clip })

  await page.locator('[data-math-inline-box]').last().click({ position: { x: 8, y: 10 } })
  await page.waitForTimeout(1400)
  const ml = await page.evaluate(() => {
    const box = document.querySelector('[data-math-inline-box]'); const br = box.getBoundingClientRect()
    const mf = box.querySelector('math-field'); if (!mf || !mf.shadowRoot) return null
    const base = mf.shadowRoot.querySelector('.ML__base'); if (!base) return null
    const r = base.getBoundingClientRect()
    return { L:+(r.left-br.left).toFixed(2), W:+r.width.toFixed(2), H:+r.height.toFixed(2), midY:+(((r.top+r.bottom)/2)-br.top).toFixed(2), fs: getComputedStyle(mf).fontSize }
  })
  await page.screenshot({ path: `${OUT}/proof-${tc.name}-2-mathlive.png`, clip })
  await page.close()

  if (ml) console.log(`${tc.name.padEnd(9)} fs=${ml.fs}  ΔW=${(ml.W-katex.W).toFixed(2)} ΔL=${(ml.L-katex.L).toFixed(2)} ΔmidY=${(ml.midY-katex.midY).toFixed(2)} ΔH=${(ml.H-katex.H).toFixed(2)}`)
  else console.log(`${tc.name.padEnd(9)} ML not found`)
}
await browser.close()
console.log('done')
