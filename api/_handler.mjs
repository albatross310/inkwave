// The one shape shared by the plain JSON-POST functions (session, sign): method check → per-IP
// rate limit → body (Vercel's pre-parsed object, or the JSON string) → content-type → the core →
// a FIXED error body. Every status code, header and byte of every response is pinned by
// src/api/handlers.wire.test.ts, written before this file existed; a change here that moves one
// byte on one path goes red there.
//
// ⚠ A WEBHOOK KEEPS ITS RAW BODY; A WRAPPER NEVER PARSES IT. Stripe, PayPal and Clerk sign the exact
//   bytes they sent, and JSON.parse → JSON.stringify drops whitespace, so a parsed-then-reserialised
//   body fails signature verification silently. The webhooks take `readRawBody` below and nothing
//   else from this file.
// ⚠ NOT EVERY POST HANDLER FITS, AND ONE THAT NEEDS A FLAG TO FIT IS NOT WRAPPED. ots sets its
//   content-type AFTER the core returns (its error bodies carry none), answers 502, and has no rate
//   limit; sync-profile ignores the body; summarise/pdf read the stream and answer without a
//   content-type on 429. Each of those is one wire byte from this shape — leave them as they are
//   until that byte is a decision, not a side effect of a refactor.

import { rateLimit, clientIp } from './_ratelimit.mjs'

/**
 * @param {object} o
 * @param {{ bucket: string, limit: number, windowSec: number }} o.rate  per-IP fixed window
 * @param {(body: any, req: any) => Promise<unknown>} o.call  the core; receives the parsed body
 * @param {(message: string | undefined) => { status: number, error: string }} o.fail
 *   maps a thrown message to the response — the message itself NEVER reaches the wire
 */
export function jsonPost({ rate, call, fail }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
    const rl = await rateLimit(clientIp(req), rate.bucket, rate.limit, rate.windowSec)
    if (!rl.ok) { res.statusCode = 429; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'rate limited' })) }
    try {
      // Vercel pre-parses req.body for a JSON content-type; a string body is parsed here. A parse
      // failure lands in the catch BEFORE the content-type is set — pinned, the deployed behaviour.
      const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await call(body, req)))
    } catch (err) {
      const { status, error } = fail(err?.message)
      res.statusCode = status
      res.end(JSON.stringify({ error }))
    }
  }
}

/** The request body as the exact bytes sent — for signature verification, never for JSON.parse first. */
export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
