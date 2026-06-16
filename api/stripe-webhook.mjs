// POST /api/stripe-webhook — Stripe → Supabase subscription sync. Node (req,res) handler (like every
// other /api function) so it runs correctly on Vercel's Node runtime. We read the RAW request body
// ourselves (Stripe signature verification needs the exact bytes), then flip the user's
// `subscription_active` flag. Content never touches this.

import Stripe from 'stripe'
import { setSubscription } from './_billing-core.mjs'

// Disable platform body parsing — signature verification must see the raw bytes, not a re-serialized
// object. (Honored by Vercel's Node runtime; ignored harmlessly by the dev middleware.)
export const config = { api: { bodyParser: false } }

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
  const key = process.env.STRIPE_SECRET_KEY
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!key || !whsec) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'not configured' })) }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' })
  const raw = await readRawBody(req)
  const sig = req.headers['stripe-signature'] || ''
  let event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whsec)
  } catch {
    res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad signature' }))
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object
      const userId = s.client_reference_id || s.metadata?.clerk_user_id
      if (userId) await setSubscription(userId, {
        active: true, provider: 'stripe',
        subscriptionId: typeof s.subscription === 'string' ? s.subscription : undefined,
        stripeCustomerId: typeof s.customer === 'string' ? s.customer : undefined,
        email: s.customer_details?.email ?? undefined,
      })
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      const userId = sub.metadata?.clerk_user_id
      const active = event.type !== 'customer.subscription.deleted'
        && ['active', 'trialing', 'past_due'].includes(sub.status)
      if (userId) await setSubscription(userId, {
        active, provider: 'stripe', subscriptionId: sub.id,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : undefined,
      })
    }
  } catch {
    // A genuine sync failure (Supabase unreachable / misconfigured / schema) → 500 so Stripe RETRIES
    // and the Dashboard delivery log shows it, instead of silently 200-ing and never flipping the flag.
    res.statusCode = 500; return res.end(JSON.stringify({ error: 'sync failed' }))
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ received: true }))
}
