// Fallback-faithful static server for the wave-desk probes (the LIVE CSS/SVG water). Same contract
// as scripts/scrub-probe/server.mjs (build/client + SPA fallback + production-like CSP), plus real
// Range/206 responses, which WebKit uses and that server lacks. It served the wave video's probes
// too until that feature was removed (2026-09-16, docs/REFACTOR-QUEUE.md decision 2).
// Deliberately NOT `vite preview` — see CLAUDE.md PROBE RULES.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3] || 4311)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "connect-src 'self' https://api.datamuse.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "worker-src 'self' blob:",
].join('; ')

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
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
    const type = MIME[extname(file)] || 'application/octet-stream'
    // `no-store` throughout so the app under test is never stale.
    const base = {
      'content-type': type,
      'content-security-policy': CSP,
      'cache-control': 'no-store',
    }

    // Range: the media path. WebKit asks for bytes=0- first, then ranges around the moov atom.
    const range = req.headers.range
    if (range && /^bytes=/.test(range)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m) {
        const total = body.length
        let start = m[1] === '' ? total - Number(m[2]) : Number(m[1])
        let end = m[2] === '' || m[1] === '' ? total - 1 : Number(m[2])
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          res.writeHead(416, { ...base, 'content-range': `bytes */${total}` }).end(); return
        }
        end = Math.min(end, total - 1)
        const slice = body.subarray(start, end + 1)
        res.writeHead(206, {
          ...base,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${total}`,
          'content-length': String(slice.length),
        })
        res.end(slice); return
      }
    }
    res.writeHead(200, { ...base, 'accept-ranges': 'bytes', 'content-length': String(body.length) })
    res.end(body)
  } catch (e) {
    res.writeHead(500)
    res.end(String(e))
  }
}).listen(PORT, () => console.log(`wave-desk probe server on :${PORT} serving ${ROOT}`))
