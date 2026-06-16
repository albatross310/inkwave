// Vercel serverless function: open an anonymous live-composition session (free, account-free).
// POST { docId } → { sessionToken, setVersion:0, lockedSet, lockedSetHash }. Stateless; logs nothing.
// Per-IP rate limited (audit F6) — no-op until Upstash is configured.

import { handleSession } from './_provenance-core.mjs'
import { rateLimit, clientIp } from './_ratelimit.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
  const rl = await rateLimit(clientIp(req), 'session', 30, 60)
  if (!rl.ok) { res.statusCode = 429; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'rate limited' })) }
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(await handleSession(body)))
  } catch (err) {
    res.statusCode = err?.message === 'bad request' ? 400 : 500
    res.end(JSON.stringify({ error: 'session failed' }))
  }
}
