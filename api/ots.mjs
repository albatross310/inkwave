// Vercel serverless function: OpenTimestamps relay (stateless, logs nothing). POST a JSON body:
//   { action: 'stamp',   bundleHash }                → { status:'pending', proofBase64 }
//   { action: 'upgrade', proofBase64, bundleHash }   → pending | confirmed (+ block/time)
// The browser holds the proofs; this only submits/queries a hash to the public calendars.

import { handleOts } from './_ots-core.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  try {
    // req.body is pre-parsed by Vercel when content-type is JSON; fall back to manual parse.
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    const result = await handleOts(body)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (err) {
    res.statusCode = err?.message === 'bad request' ? 400 : 502
    res.end(JSON.stringify({ error: 'ots relay failed' }))
  }
}
