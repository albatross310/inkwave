// Per-IP fixed-window rate limiter for the abuse/cost-sensitive endpoints (audit F6). Backed by
// Upstash Redis (REST API — just fetch, no SDK). ENV-GATED: with no Upstash configured it's a no-op
// (allow all), so local dev and un-provisioned deploys behave exactly as before. FAILS OPEN on any
// Redis error — these endpoints are anti-abuse, not correctness (the signer is content- and
// docId-bound, backdating is impossible via OTS), so a Redis outage must never take down signing.
//
// To activate: create a free Upstash Redis DB and set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// in the Vercel project env.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
  const real = req?.headers?.['x-real-ip']
  return (typeof real === 'string' && real) ? real : 'unknown'
}

/**
 * Allow `limit` requests per `windowSec` per (bucket, ip). Returns { ok }.
 * Fixed window via INCR + EXPIRE…NX (TTL set once per window, so the count resets each window — a
 * long legit session signing every few seconds stays well under the ceiling).
 */
export async function rateLimit(ip, bucket, limit, windowSec) {
  if (!REST_URL || !REST_TOKEN) return { ok: true } // not configured → allow
  const key = `rl:${bucket}:${ip}`
  try {
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REST_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSec), 'NX'],
      ]),
    })
    if (!res.ok) return { ok: true } // fail open
    const out = await res.json()
    const count = Number(out?.[0]?.result ?? 0)
    return { ok: count <= limit, count }
  } catch {
    return { ok: true } // fail open
  }
}
