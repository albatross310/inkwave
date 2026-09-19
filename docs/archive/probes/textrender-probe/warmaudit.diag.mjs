// THROWAWAY DIAGNOSTIC — is the between-notch warm's cached geometry the same as measuring live?
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const EDITOR = '.ProseMirror[contenteditable="true"]'
const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
try {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(EDITOR, { timeout: 60000 })
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'warmaudit', headings: true, lists: true, refList: false })
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
  await page.waitForFunction(() => document.querySelectorAll('.inkwave-page-gap').length > 5, null, { timeout: 90000 })
  await page.waitForTimeout(8000)
  await page.evaluate(() => { window.__iwWarmAudit = true; window.__iwWarmAuditLog = [] })
  const box = await page.evaluate(() => {
    const r = document.querySelector('.ProseMirror[contenteditable="true"]').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 200) }
  })
  await page.mouse.move(box.x, box.y)
  for (let i = 0; i < 12; i++) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('.inkwave-editor-surface') ?? document.querySelector('.inkwave-editor-surface')
      el?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX: x, clientY: y }))
    }, box)
    await page.waitForTimeout(260)
  }
  await page.waitForTimeout(1500)
  const log = await page.evaluate(() => window.__iwWarmAuditLog || [])
  console.log('\nWARMED-ENTRY AUDIT — each row is a cache HIT compared to a live measure at that instant\n')
  for (const r of log) console.log(`  step ${String(r.step).padStart(3)}  bands ${r.bandsHit}/${r.bandsLive}  maxΔtop ${String(r.maxTopDelta).padStart(9)}px  maxΔheight ${String(r.maxHeightDelta).padStart(9)}px  Δtotal ${String(r.totalDelta).padStart(9)}px`)
  if (!log.length) console.log('  (no hits recorded — the audit saw nothing)')
} finally { await b.close(); await stop() }
