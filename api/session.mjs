// Vercel serverless function: open an anonymous live-composition session (free, account-free).
// POST { docId } → { sessionToken, setVersion:0, lockedSet, lockedSetHash }. Stateless; logs nothing.
// Per-IP rate limited (audit F6) — no-op until Upstash is configured.

import { handleSession } from './_provenance-core.mjs'
import { jsonPost } from './_handler.mjs'

export default jsonPost({
  rate: { bucket: 'session', limit: 30, windowSec: 60 },
  call: (body) => handleSession(body),
  fail: (m) => ({ status: m === 'bad request' ? 400 : 500, error: 'session failed' }),
})
