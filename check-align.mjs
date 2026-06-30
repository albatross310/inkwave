import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
await page.goto('http://localhost:5173/')
await page.waitForLoadState('networkidle')
await page.waitForSelector('.ProseMirror')
await page.click('.ProseMirror')
await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
await page.waitForTimeout(100)
await page.keyboard.press('Alt+Shift+Equal')
await page.waitForTimeout(800)
await page.keyboard.type('a = bdd')
await page.keyboard.press('Enter')
await page.keyboard.type('elementary = dearwatson')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// Activate MathLive  
const blockBox = await page.locator('.katex-display').boundingBox()
if (blockBox) await page.mouse.click(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2)
await page.waitForTimeout(2000)

const mlCheck = await page.evaluate(() => {
  const mf = document.querySelector('math-field')
  if (!mf || !mf.shadowRoot) return { error: 'no mf' }
  const mfR = mf.getBoundingClientRect()
  
  // Walk up to find the grid
  let el = mf.parentElement
  while (el && !el.style.display.includes('grid')) el = el.parentElement
  const gL = el ? el.getBoundingClientRect().left : 0
  
  const injectedStyle = mf.shadowRoot.querySelector('#iw-align')
  
  // Measure each vlist cell
  const vlists = [...mf.shadowRoot.querySelectorAll('.ML__vlist')]
  const rowData = vlists.map(function(v) {
    const vR = v.getBoundingClientRect()
    const textAlign = getComputedStyle(v).textAlign
    const contentSpans = [...v.querySelectorAll('span[style*="inline-block"]')]
    return {
      vlistW: +(vR.width).toFixed(1),
      textAlign: textAlign,
      spans: contentSpans.slice(0,3).map(function(s) {
        const r = s.getBoundingClientRect()
        return {
          w: +r.width.toFixed(1),
          left: +(r.left - gL).toFixed(1),
          center: +(((r.left + r.right)/2) - gL).toFixed(1),
        }
      }),
    }
  })
  
  return {
    mfLeft: +(mfR.left - gL).toFixed(1),
    mfW: +mfR.width.toFixed(1),
    gridW: el ? +el.getBoundingClientRect().width.toFixed(1) : 'n/a',
    styleInjected: !!injectedStyle,
    styleContent: injectedStyle ? injectedStyle.textContent.slice(0, 80) : null,
    rowData: rowData,
  }
})
console.log(JSON.stringify(mlCheck, null, 2))
await browser.close()
