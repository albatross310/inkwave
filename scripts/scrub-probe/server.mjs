// Fallback-faithful static server for /snapshot probes (NOT vite preview — that serves the
// prerendered editor page and the hydration mismatch kills the water). Serves build/client with
// the SPA fallback, plus a production-like CSP (script nonces relaxed; img/font/connect faithful)
// so the data:-URI SVG raster path is exercised under the real image policy.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3] || 4211)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:", // probe relaxation (prod uses nonces via edge middleware)
  "connect-src 'self' https://api.datamuse.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "worker-src 'self' blob:",
  // ⚠ WITHOUT THIS THE READER'S LIVE VIEW CANNOT LOAD ANYTHING, AND IT FAILS SILENTLY.
  // There was no `frame-src` here, so framing fell back to `default-src 'self'` and every
  // cross-origin frame was refused BEFORE any network request existed — no request event, no
  // requestfailed, just a frame sitting at `chrome-error://chromewebdata/`. `page.route` and
  // `context.route` are both powerless against that, because there is nothing to intercept.
  // MEASURED 2026-08-30: `prove:reader`'s new live-view cells all passed against that error page,
  // because they measure OUR element — including the PAN cell, which was scoring a scroll chained
  // out of a page with no content of its own to consume the gesture, i.e. the easiest possible
  // case wearing the costume of the real one. The header now mirrors production's
  // (`middleware.ts`: `frame-src 'self' blob: https: …`), which is strictly more faithful.
  "frame-src 'self' blob: https:",
].join('; ')

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
    if (path.includes('..')) { res.writeHead(400).end(); return }
    let file = join(ROOT, path || 'index.html')
    let body
    try {
      body = await readFile(file)
      if (!extname(file)) throw new Error('dir')
    } catch {
      file = join(ROOT, '__spa-fallback.html')
      body = await readFile(file)
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'content-security-policy': CSP,
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500)
    res.end(String(e))
  }
}).listen(PORT, () => console.log(`probe server on :${PORT} serving ${ROOT}`))
