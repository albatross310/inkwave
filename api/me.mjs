// GET /api/me — the authed caller's cadence entitlement: { cadence: boolean, userId? }. Reads the
// Clerk session token from the Authorization header; returns { cadence: false } when not signed in.
// No content, ever — just the subscription flag.

import { getEntitlement } from './_billing-core.mjs'

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store') // entitlement is polled right after payment — never cache it
  res.end(JSON.stringify(await getEntitlement(req.headers?.authorization || '')))
}
