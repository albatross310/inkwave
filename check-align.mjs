import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })

async function measure(label, alignButton) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.goto('http://localhost:5173/')
  await page.waitForLoadState('networkidle')
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.waitForTimeout(100)
  await page.keyboard.press('Alt+Shift+Equal'); await page.waitForTimeout(600)
  await page.keyboard.type('a = bdd')
  await page.keyboard.press('Enter')
  await page.keyboard.type('elementary = dearwatson')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  // Set alignment via sigma button if not default
  if (alignButton) {
    await page.evaluate((btn) => {
      window.dispatchEvent(new CustomEvent('inkwave-math-align', { detail: { align: btn } }))
    }, alignButton)
    await page.waitForTimeout(300)
  }

  const katex = await page.evaluate(() => {
    const grid = document.querySelector('[style*="display: grid"]')
    const gL = grid?.getBoundingClientRect().left ?? 0
    const gW = grid?.getBoundingClientRect().width ?? 0
    const spans = [...document.querySelectorAll('.katex-display span')].filter(s => !s.querySelector('span') && s.getBoundingClientRect().width > 3)
    const lineGroups = {}
    spans.forEach(s => {
      const r = s.getBoundingClientRect()
      const y = Math.round(r.top)
      if (!lineGroups[y]) lineGroups[y] = { left: r.left - gL, right: r.right - gL }
      else { lineGroups[y].left = Math.min(lineGroups[y].left, r.left - gL); lineGroups[y].right = Math.max(lineGroups[y].right, r.right - gL) }
    })
    return { gridW: gW, lines: Object.values(lineGroups).slice(0,4).map(l => ({ left: +l.left.toFixed(1), right: +l.right.toFixed(1), center: +((l.left+l.right)/2).toFixed(1) })) }
  })
  console.log(`\n=== ${label} (align=${alignButton||'aligned'}) ===`)
  console.log('KaTeX gridW:', katex.gridW)
  katex.lines.forEach((l, i) => console.log(`  line${i+1}: left=${l.left} right=${l.right} center=${l.center}`))
  await page.close()
}

await measure('ALIGNED (default)', null)
await measure('CENTER', 'center')
await measure('LEFT', 'left')
await browser.close()
