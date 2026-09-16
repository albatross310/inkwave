// WHAT THE EDITOR ACTUALLY DOWNLOADS (2026-07-17 — the "costs Peter nothing" claim, from outside).
//
// WHY NOT COMPARE CHUNK SIZES. The schema extraction made rollup RE-SPLIT the graph: master ships one
// ~949KB TiptapEditor monolith; the branch ships a smaller TiptapEditor plus a shared editorSchema
// chunk. Comparing "the editor chunk" across those two builds compares different things and can be
// made to say anything — the file that kept the name is not the same file. The only claim that
// matters to Peter is how many bytes his editor pulls to open `/`, so that is what is measured: every
// JS response the REAL page actually fetches, summed, from the network layer rather than from a
// filename.
//
// Usage: pnpm build && node scripts/textrender-probe/editorbytes.prove.mjs   (boots its own server)
//        LABEL=master node ... > /tmp/x   — run once per build, compare the two numbers.

import { chromium } from '@playwright/test'
import { startProbeServer } from './serve.mjs'

const { base: BASE, stop } = await startProbeServer()
const LABEL = process.env.LABEL || 'build'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 1400 } })

const js = new Map() // url -> bytes (dedup: a chunk fetched twice is downloaded once by the browser)
page.on('response', async (r) => {
  const u = r.url()
  if (!/\.m?js(\?|$)/.test(u)) return
  try {
    const buf = await r.body()
    js.set(u, buf.length)
  } catch { /* redirect / no body */ }
})

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { state: 'attached', timeout: 30000 })
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 })
// Let every eager import the editor kicks at module scope actually land.
await page.waitForTimeout(5000)

// VOID rather than report a suspiciously small number: a page that never mounted the editor would
// "download less" and look like a win. Prove the editor is really up before reading the total.
const up = await page.evaluate(() => !!document.querySelector('.ProseMirror[contenteditable="true"]'))
if (!up) { console.log('VOID: the editor never mounted — the byte total would be a fiction'); await b.close(); await stop(); process.exit(2) }

let total = 0
const rows = []
for (const [u, n] of js) { total += n; rows.push([u.split('/').pop(), n]) }
rows.sort((a, b2) => b2[1] - a[1])

console.log(`── ${LABEL}: JS actually downloaded to open / ──`)
for (const [n, s] of rows.slice(0, 8)) console.log(`  ${String(s).padStart(8)}  ${n}`)
console.log(`  files: ${rows.length}`)
console.log(`TOTAL_JS_BYTES ${total}`)
await b.close()
await stop()
