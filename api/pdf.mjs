// Server-side PDF export. Renders the document's OWN print HTML + CSS in headless Chromium and
// returns a real, selectable-text A4 PDF — the same output as the browser's "Save as PDF", but with
// no print dialog, so "Export PDF" can drop the finished file straight into a new tab. Works for any
// visitor browser (Firefox/Safari/mobile) because the render happens here, not client-side.
//
// Content-free in spirit (mirrors the OTS relay): the posted HTML lives only for the request, and we
// log nothing and store nothing.
//
// Chromium binary: @sparticuz/chromium on Vercel; a locally-installed Chrome in dev (the dev caller
// falls back to the browser print dialog if none is found).

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = { maxDuration: 60, api: { bodyParser: false } }

// We don't need GPU/WebGL for a text+SVG document — disabling it makes the Lambda Chromium start
// faster and more reliably.
chromium.setGraphicsMode = false

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const onVercel = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION)

// Dev-only local Chrome locations; override with PUPPETEER_EXECUTABLE_PATH.
const LOCAL_CHROME = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

async function launch() {
  if (onVercel()) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  const fs = await import('node:fs')
  const exe = LOCAL_CHROME.find((p) => { try { return fs.existsSync(p) } catch { return false } })
  if (!exe) throw new Error('no local Chrome for dev PDF (set PUPPETEER_EXECUTABLE_PATH) — use Print instead')
  return puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
}

// Render the supplied self-contained HTML to an A4 PDF (Buffer). preferCSSPageSize honours the
// document's own `@page { size: A4; margin: 0 }`; print media (Puppeteer's default for page.pdf) so
// the @media print rules — page-gap breaks, hidden chrome, the seal — all apply, matching the editor.
export async function generatePdf({ html }) {
  if (!html || typeof html !== 'string') throw new Error('missing html')
  const browser = await launch()
  try {
    const page = await browser.newPage()
    // Lay out in PRINT media (matches page.pdf and the @media print width rules) before we measure.
    await page.emulateMediaType('print')
    // 'load' (NOT domcontentloaded): we MUST wait for the stylesheet to load, otherwise the @font-face
    // rules aren't even known yet and document.fonts.ready resolves instantly → the page renders in a
    // fallback font (wrong metrics → wrong wrapping). 'load' also avoids networkidle0's idle-timeout
    // stall. Then force-load the families the document uses and await fonts.ready, capped so a slow
    // font never hangs the request.
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })
    await Promise.race([
      page.evaluate(async () => {
        if (!document.fonts) return
        try {
          await Promise.all([
            document.fonts.load("400 16px 'EB Garamond'"),
            document.fonts.load("italic 400 16px 'EB Garamond'"),
            document.fonts.load("500 16px 'EB Garamond'"),
            document.fonts.load("400 16px 'IM Fell DW Pica'"),
            document.fonts.load("italic 400 16px 'IM Fell DW Pica'"),
          ])
          await document.fonts.ready
        } catch { /* ignore */ }
      }).catch(() => {}),
      sleep(8000),
    ])
    return await page.pdf({ printBackground: true, preferCSSPageSize: true })
  } finally {
    await browser.close()
  }
}

async function readRaw(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method not allowed') }
  let body
  try { body = JSON.parse(await readRaw(req)) } catch { res.statusCode = 400; return res.end('bad request') }
  try {
    const pdf = await generatePdf(body)
    const name = (String(body?.title || 'inkwave').replace(/[^\w.-]+/g, '_').slice(0, 80)) || 'inkwave'
    res.statusCode = 200
    res.setHeader('content-type', 'application/pdf')
    res.setHeader('content-disposition', `inline; filename="${name}.pdf"`)
    res.setHeader('cache-control', 'no-store')
    res.end(pdf)
  } catch (e) {
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain')
    res.end('pdf generation failed: ' + (e && e.message ? e.message : 'error'))
  }
}
