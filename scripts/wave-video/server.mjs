// Fallback-faithful static server for the WAVE VIDEO probes. Same contract as
// scripts/scrub-probe/server.mjs (build/client + SPA fallback + production-like CSP), plus the two
// things the video path actually needs and that server lacks:
//   1. `.mp4` in the MIME table (it would otherwise serve application/octet-stream and no engine
//      would decode it — a probe that "proves" the video fails for the wrong reason);
//   2. REAL Range/206 responses. The 2026-07-16 iPhone-8 fix turns on Range-ability (the SW serves
//      /wave/ cache-first WITH 206); a probe server answering 200-only would be testing a
//      transport iOS never uses.
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
  '.mp4': 'video/mp4',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "connect-src 'self' https://api.datamuse.com",
  "img-src 'self' data: https:",
  "media-src 'self' blob:",
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
    // CACHE POLICY, and it MATTERS for the video (2026-07-17). `no-store` everywhere is faithful to
    // NOTHING: it made waveVideo's pre-hydration warm fetch warm precisely nothing, so the <video>
    // re-downloaded the whole 280KB h264 clip and blew its 2.5s decode budget — a "decode timeout"
    // that was purely my server. In production /wave/ is served cache-first from the SW's Cache
    // Storage (permanent for the build id), so the clip is fetched once and every later read is
    // local. Immutable caching is the behavioural equivalent for a probe. Everything else stays
    // no-store so the app itself is never stale.
    const wave = path.startsWith('wave/')
    const base = {
      'content-type': type,
      'content-security-policy': CSP,
      'cache-control': wave ? 'public, max-age=31536000, immutable' : 'no-store',
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
}).listen(PORT, () => console.log(`wave-video probe server on :${PORT} serving ${ROOT}`))
