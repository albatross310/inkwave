// Webhook-free Clerk → Supabase email capture. On sign-in the client pings this with its verified
// Clerk session token; we take the identity from the VERIFIED token (never a client-supplied id —
// audit F1), fetch the AUTHORITATIVE email from Clerk's Backend API (secret key; client never
// trusted for the email) and upsert the minimal {clerk_user_id, email} row. Content never touches
// this. No-ops gracefully if the Clerk secret or Supabase aren't configured.

import { supabaseAdmin } from './_supabase.mjs'
import { userFromAuth } from './_auth.mjs'

// `userId` MUST be a verified Clerk id (from userFromAuth), not a client-supplied value.
export async function syncProfile(userId) {
  if (!userId) return { ok: false, error: 'missing userId' }
  const secret = process.env.CLERK_SECRET_KEY
  const sb = supabaseAdmin()
  if (!secret || !sb) return { ok: false, skipped: true } // not configured → no-op

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (!res.ok) return { ok: false, error: 'profile sync failed' } // don't leak the upstream status
    const u = await res.json()
    const email =
      u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ??
      u.email_addresses?.[0]?.email_address ??
      null
    await sb.from('profiles').upsert({ clerk_user_id: userId, email }, { onConflict: 'clerk_user_id' })
    return { ok: true }
  } catch {
    return { ok: false, error: 'sync failed' }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  try {
    // Identity comes from the verified session token — the request body is ignored (audit F1).
    const user = await userFromAuth(req.headers?.authorization)
    if (!user) {
      res.statusCode = 401
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ ok: false }))
    }
    const result = await syncProfile(user.userId)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result))
  } catch {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false }))
  }
}
