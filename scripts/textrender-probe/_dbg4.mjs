// Compare the model built from editor.state.doc vs from nodeFromContentJson(editor.state.doc.toJSON()).
// Same bytes in, same model out — or the parse is losing content.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4297}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts?.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2000)
const doc = buildCitationDoc({ words: 13000, cites: 174, id: 'dbg4' })
await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => window.__iwTextRenderProbe?.words() > 10000, null, { timeout: 60000 })
await page.waitForTimeout(1500)
console.log(await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const live = p.build().model
  const rt = p.roundTripCensus ? p.roundTripCensus() : null
  return JSON.stringify({ live_blocks: live.blocks.length, live_lines: live.lines.length, roundTrip: rt }, null, 1)
}))
await b.close()
