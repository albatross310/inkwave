// Why does the audit consider 6789 a line start on the UNFIXED build? Trace the votes.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4239}`
const NEAR = Number(process.env.NEAR || 6789)
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2500)
const doc = buildCitationDoc({ words: 2200, id: 'ml-citations--THE-BUG-', cites: 29, headings: false, lists: false, refList: false })
await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 800, null, { timeout: 60000 })
await page.waitForTimeout(5000)
const r = await page.evaluate((n) => {
  const a = window.__iwTextRenderProbe.midlineAudit(n)
  return { breaks: window.__iwTextRenderProbe.liveBreaks(), midline: a.midline, trace: a.trace }
}, NEAR)
console.log('live breaks:', r.breaks.join(', '))
console.log('midline:', r.midline)
console.log(`\nVOTE TRACE near ${NEAR}:`)
for (const t of r.trace) {
  console.log(`  pos=${String(t.pos).padStart(6)} ${String(t.kind).padEnd(4)} ${String(t.txt).padEnd(18)} top=${String(t.top).padStart(8)} h=${String(t.h).padStart(6)} left=${String(t.left).padStart(7)} lastTop=${String(t.lastTop).padStart(8)} ${t.votedNewLine ? '<<< VOTED NEW LINE' : ''}`)
}
await b.close()
