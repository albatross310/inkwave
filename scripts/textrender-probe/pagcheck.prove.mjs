// SCOPED == FULL, on citation prose, with the NodeView collapse in place.
//
// The collapse lives in collectLines' cache-MISS branch, which BOTH the full canonical measure and
// the scoped/incremental measure run through — so they should stay byte-identical by construction.
// "By construction" is exactly the claim this codebase has been burned believing, so it is checked:
// `inkwave:pagCheck=1` runs BOTH paths on every measure and compares their signatures.
//
// The check is worthless unless edits actually TAKE the scoped path, so the probe asserts
// __iwPagChecked > 0 (comparisons really ran) before reading __iwPagMismatch. Typing near citations
// is what exercises the atom collapse under the incremental cache.
import { chromium } from '@playwright/test'
import { buildCitationDoc } from './fixture.mjs'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT || 4239}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.addInitScript(() => { try { localStorage.setItem('inkwave:pagCheck', '1') } catch { /* private */ } })
page.on('console', (m) => { if (m.text().includes('pagCheck')) console.log('  [page]', m.text()) })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
await page.waitForTimeout(2500)
// EVERY block a paragraph: headings/lists make the scoped path bail (`seam-above`/`region-nonpara`)
// before it ever measures, which would leave this probe permanently inconclusive.
const doc = buildCitationDoc({ words: 2200, id: 'pagcheck-cites', cites: 29, headings: false, lists: false, refList: false })
await page.evaluate((d) => window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id: d.id, doc: d } })), doc)
await page.waitForFunction(() => !!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words() > 800, null, { timeout: 60000 })
await page.waitForTimeout(6000)

// Type INSIDE a citation-bearing paragraph so the scoped measure re-measures blocks with atoms.
// The scoped path only engages when the edited block AND its neighbours are paragraphs
// (`seam-above`/`region-nonpara` bails otherwise), so pick a citation paragraph that is preceded and
// followed by paragraphs — otherwise the probe measures nothing and says so.
await page.evaluate(() => {
  const cites = Array.from(document.querySelectorAll('.iw-cite-link'))
  for (const c of cites) {
    const p = c.closest('p')
    if (!p) continue
    const prev = p.previousElementSibling, next = p.nextElementSibling
    if (prev?.tagName === 'P' && next?.tagName === 'P') {
      const r = p.getBoundingClientRect()
      window.__iwClickAt = { x: r.left + 20, y: r.top + 8 }
      return
    }
  }
})
const at = await page.evaluate(() => window.__iwClickAt)
if (at) await page.mouse.click(at.x, at.y)
for (let i = 0; i < 6; i++) {
  await page.keyboard.type('lorem ipsum dolor ', { delay: 12 })
  await page.waitForTimeout(1400) // past the edit debounce ⇒ a real scoped measure + lazy full re-verify
}
await page.waitForTimeout(6000)

const r = await page.evaluate(() => ({
  checked: window.__iwPagChecked ?? 0,
  mismatch: window.__iwPagMismatch ?? 0,
  reasons: window.__iwPagInc?.reasons ?? null,
  midline: window.__iwTextRenderProbe.midlineAudit().midline,
  canonical: window.__iwTextRenderProbe.midlineAudit().renderingIsCanonical,
}))
console.log(`pagCheck comparisons run: ${r.checked}`)
console.log(`scoped/full MISMATCHES  : ${r.mismatch}`)
console.log(`mid-line after editing  : ${r.midline} (canonicalRendering=${r.canonical})`)
console.log(`scoped bail reasons     : ${JSON.stringify(r.reasons)}`)
let fail = 0
if (r.checked === 0) { console.log('\nINCONCLUSIVE ⚠ — no scoped/full comparison ever ran; this proves nothing.'); fail++ }
else if (r.mismatch > 0) { console.log('\nSCOPED/FULL DRIFT ✗ — the incremental path disagrees with the full measure.'); fail++ }
else console.log('\nSCOPED == FULL ✓ — byte-identical signatures across real edits on citation prose.')
if (r.canonical && r.midline > 0) { console.log('MID-LINE ✗ reappeared after editing.'); fail++ }
else if (r.canonical) console.log('MID-LINE CLEAN ✓ after real edits (the cache bakes the fixed geometry).')
await b.close()
process.exit(fail ? 1 : 0)
