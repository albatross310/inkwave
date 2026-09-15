// Vercel serverless function: sign a completed period's receipt and issue the next set (the §8
// one-round-trip flow). POST { sessionToken, docId, counter, prevHash, contentHash, setVersion,
// kicksHash, cadenceDigest? } → { serverTime, signature, lockedSet, lockedSetHash, next }.
// Receives only hashes — never content, the raw set, or kick text. Stateless; logs nothing.
// Per-IP anti-abuse (audit F6): generous ceiling (signing recurs per period); no-op until Upstash
// is configured; fails open so a Redis outage never blocks legitimate signing.

import { handleSign } from './_provenance-core.mjs'
import { jsonPost } from './_handler.mjs'

export default jsonPost({
  rate: { bucket: 'sign', limit: 120, windowSec: 60 },
  call: (body, req) => handleSign(body, req.headers?.authorization),
  fail: (m) => ({
    status: m === 'bad request' ? 400 : m === 'invalid session' ? 401 : m === 'subscription required' ? 402 : 500,
    error: m === 'subscription required' ? 'subscription required' : m === 'invalid session' ? 'invalid session' : 'sign failed',
  }),
})
