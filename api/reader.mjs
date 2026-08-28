// GET /api/reader?url=… → { url, title, blocks } — the source reader's fetch.
//
// LOGS NOTHING (no url, no ip, no timing) and STORES NOTHING — see api/_reader-core.mjs for why
// that is the whole design of this endpoint and not a courtesy. Errors are returned as a short
// CODE, never as the upstream's message: an upstream error string can echo the URL and internal
// hostnames back to the caller, which is the one thing an SSRF guard exists to prevent leaking.

import { readSource } from './_reader-core.mjs'
import { clientIp, rateLimit } from './_ratelimit.mjs'

const CODES = new Set(['bad url', 'blocked host', 'unreachable', 'not html', 'too large',
  'too many redirects', 'bad redirect', 'no readable text'])

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method' })) }
  const url = new URL(req.url, 'http://x').searchParams.get('url') || ''
  // Anti-abuse only: this endpoint makes an outbound request per call, so it is the one surface here
  // that can be turned into someone else's traffic. Fails OPEN with no Upstash configured, like the
  // signer — a Redis outage must not take the reader down.
  const { ok } = await rateLimit(clientIp(req), 'reader', 60, 60)
  if (!ok) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate' })) }
  try {
    res.end(JSON.stringify(await readSource(url)))
  } catch (err) {
    const code = CODES.has(err?.message) ? err.message : 'fetch failed'
    res.statusCode = code === 'bad url' || code === 'blocked host' ? 400 : 502
    res.end(JSON.stringify({ error: code }))
  }
}
