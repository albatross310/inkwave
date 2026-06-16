// Shared billing/entitlement core (paid cadence tier, M6). Stateless; the only thing stored is the
// per-user subscription flag in Supabase `profiles` (clerk_user_id, subscription_active, …). Never
// touches document content. Reused by /api/me, the Stripe/PayPal webhooks, and the sign-time gate.

import { userFromAuth } from './_auth.mjs'
import { supabaseAdmin } from './_supabase.mjs'

/** Is this user's cadence subscription active? Reads the flag; honours current_period_end if set. */
export async function isSubscribed(userId) {
  const sb = supabaseAdmin()
  if (!sb || !userId) return false
  const { data } = await sb
    .from('profiles')
    .select('subscription_active,current_period_end')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!data?.subscription_active) return false
  if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now()) return false
  return true
}

/** Entitlement for the authed caller → { cadence, userId? }. cadence=false when not signed in. */
export async function getEntitlement(authorization) {
  const user = await userFromAuth(authorization)
  if (!user) return { cadence: false }
  return { cadence: await isSubscribed(user.userId), userId: user.userId }
}

/** Upsert a subscription state for a user (called by the provider webhooks). THROWS on a real
 *  failure (Supabase unconfigured / upsert rejected) so the webhook returns non-200 — the provider
 *  retries and the failure shows in its delivery log, instead of silently never flipping the flag. */
export async function setSubscription(userId, { active, provider, subscriptionId, stripeCustomerId, currentPeriodEnd, email, eventAt }) {
  const sb = supabaseAdmin()
  if (!sb) throw new Error('supabase not configured')
  if (!userId) return
  // Ordering guard (audit F4): ignore an event older than the last one applied for this user, so a
  // delayed redelivery of a stale "active" can't resurrect a since-cancelled subscription. Degrades
  // gracefully if last_event_at isn't migrated yet (select errors → skip the guard, don't write it).
  let canOrder = false
  if (eventAt) {
    const { data: cur, error } = await sb.from('profiles').select('last_event_at').eq('clerk_user_id', userId).maybeSingle()
    if (!error) {
      canOrder = true
      if (cur?.last_event_at && new Date(eventAt).getTime() <= new Date(cur.last_event_at).getTime()) return
    }
  }
  const row = {
    clerk_user_id: userId,
    subscription_active: !!active,
    subscription_provider: provider ?? null,
    subscription_id: subscriptionId ?? null,
    updated_at: new Date().toISOString(),
  }
  if (eventAt && canOrder) row.last_event_at = new Date(eventAt).toISOString()
  if (stripeCustomerId !== undefined) row.stripe_customer_id = stripeCustomerId
  if (currentPeriodEnd !== undefined) row.current_period_end = currentPeriodEnd
  if (email !== undefined) row.email = email
  const { error } = await sb.from('profiles').upsert(row, { onConflict: 'clerk_user_id' })
  if (error) throw new Error(`profiles upsert failed: ${error.message}`)
}

/** Idempotency (audit F4): record a processed provider event id. Returns true if it was ALREADY
 *  processed (a replay/redelivery) so the caller can short-circuit. Throws on a real DB error so the
 *  provider retries. No-op (false) when Supabase isn't configured. */
export async function alreadyProcessed(eventId) {
  const sb = supabaseAdmin()
  if (!sb || !eventId) return false
  const { error } = await sb.from('webhook_events').insert({ id: String(eventId) })
  if (!error) return false // first time we've seen it
  if (error.code === '23505') return true // unique-violation = duplicate delivery
  if (error.code === '42P01') return false // table not migrated yet → skip dedupe (best-effort, don't break)
  throw new Error(`webhook_events insert failed: ${error.message}`)
}
