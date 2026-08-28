// IS THE MID-LINE BREAK A ZOOM ARTEFACT? Page breaks are CANONICAL — measured in a forced context
// (desktop margins, --iw-editor-zoom:1, 1.125rem) so the same words land on page N on every device.
// The rendered layout at any OTHER font zoom wraps differently, so a canonical break position is
// NOT a rendered line start there. midline.prove.mjs runs at defaults and reports 0/194; Peter has
// been pinch-zooming all session. This asks the same question at his condition.
import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'
import { buildCitationDoc } from './fixture.mjs'

const { base, stop } = await startProbeServer()
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } })
try {
  for (const zoom of [1, 1.08, 1.26, 0.86]) {
    await page.addInitScript((z) => { try { localStorage.setItem('inkwave:editorZoom', String(z)) } catch {} }, zoom)
    await page.goto(`${base}/?textRender`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ProseMirror[contenteditable=true]', { timeout: 30000 })
    await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
    await page.waitForTimeout(2500)
    const doc = buildCitationDoc({ words: 2600, cites: 12, id: 'zb-' + zoom, headings: true, lists: false, refList: false })
    await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
    await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 900, null, { timeout: 60000 })
    await page.waitForTimeout(5000)
    const live = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--iw-editor-zoom')) || 1)
    const r = await page.evaluate(() => window.__iwTextRenderProbe.midlineAudit())
    console.log(`zoom ${String(zoom).padEnd(5)} (live ${live})  canonicalRendering=${r.renderingIsCanonical}  ` +
      `midline ${r.midline}/${r.breaks}  base=${r.baseFont}px  gapsLeftFlow=${r.gapsLeftFlow}`)
    for (const f of (r.offenders || []).slice(0, 2)) console.log(`     at=${f.at} between line starts ${f.prevLineStart} and ${f.nextLineStart}`)
  }
} finally { await b.close(); await stop() }
