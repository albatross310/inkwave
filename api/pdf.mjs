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
import { rateLimit, clientIp } from './_ratelimit.mjs'

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
    // domcontentloaded keeps this FAST and unhangable ('load' blocks on the 1.4MB seal + every font
    // file and can stall to its timeout). The font correctness instead comes from an EXPLICIT,
    // bounded wait below: wait for the stylesheets to actually apply (so the @font-face rules exist),
    // then force-load the families the document uses and await fonts.ready. The whole wait is capped,
    // so a slow/unreachable resource degrades to a fallback render rather than hanging the request.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await Promise.race([
      page.evaluate(async () => {
        // Wait until every <link rel=stylesheet> has applied (cross-origin Google Fonts included —
        // link.sheet is set + the load event fires even cross-origin), so the @font-face rules exist
        // before we try to load them.
        await new Promise((res) => {
          const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          let pending = links.filter((l) => !l.sheet).length
          if (!pending) return res()
          let done = false
          const finish = () => { if (!done) { done = true; res() } }
          links.forEach((l) => { if (!l.sheet) l.addEventListener('load', () => { if (--pending <= 0) finish() }, { once: true }) })
          setTimeout(finish, 4000)
        })
        try {
          if (document.fonts) {
            await Promise.all([
              document.fonts.load("400 16px 'EB Garamond'"),
              document.fonts.load("italic 400 16px 'EB Garamond'"),
              document.fonts.load("500 16px 'EB Garamond'"),
              document.fonts.load("400 16px 'IM Fell DW Pica'"),
              document.fonts.load("italic 400 16px 'IM Fell DW Pica'"),
            ])
            await document.fonts.ready
          }
          // Wait for images (the seal) to finish so they render on the PDF — bounded by the outer race.
          await Promise.all(Array.from(document.images).map((img) =>
            img.complete ? null : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }) }),
          ))
        } catch { /* ignore */ }
      }).catch(() => {}),
      sleep(9000),
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
  // GET = warm-up (hit by the Vercel cron in vercel.json). Launch + close Chromium so a real export
  // lands on a warm container and skips the cold-start cost (binary extract + browser launch). If
  // CRON_SECRET is set, require it — Vercel's cron sends it automatically; keeps randoms from
  // triggering launches.
  if (req.method === 'GET') {
    // (The ?proxy= branch for URL-referenced PDFs was removed 2026-07-08 — URL-linked PDFs are gone
    // from the product; sources embed their PDF file instead, which never touches this server.)
    const secret = process.env.CRON_SECRET
    if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('unauthorized') }
    try {
      const browser = await launch()
      await browser.close()
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      return res.end(JSON.stringify({ warm: true }))
    } catch (e) {
      res.statusCode = 500
      return res.end('warm failed: ' + (e && e.message ? e.message : 'error'))
    }
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method not allowed') }
  // PDF generation is memory- and time-expensive: 10 exports per minute per IP is generous for any
  // legitimate writer but limits cost from accidental loops or targeted abuse.
  const rl = await rateLimit(clientIp(req), 'pdf', 10, 60)
  if (!rl.ok) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate limited' })) }
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
