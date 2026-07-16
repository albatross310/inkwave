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
