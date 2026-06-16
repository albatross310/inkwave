// POST /api/paypal-webhook — PayPal → Supabase subscription sync. Node (req,res) handler (like every
// other /api function) so it runs correctly on Vercel's Node runtime. We read the RAW body ourselves
// (signature verification needs it), verify with PayPal, then flip the user's `subscription_active`
// flag (custom_id = Clerk user id, set at subscription creation). Content never touches this.

import { verifyPaypalWebhook } from './_paypal.mjs'
import { setSubscription } from './_billing-core.mjs'

export const config = { api: { bodyParser: false } }

const ACTIVATE = new Set(['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED'])
const DEACTIVATE = new Set(['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.SUSPENDED'])

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
  const raw = (await readRawBody(req)).toString('utf8')
  const ok = await verifyPaypalWebhook(req.headers, raw)
  if (!ok) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad signature' })) }
  try {
    const event = JSON.parse(raw)
    const resource = event.resource || {}
    const userId = resource.custom_id
    if (userId) {
      if (ACTIVATE.has(event.event_type)) {
        await setSubscription(userId, { active: true, provider: 'paypal', subscriptionId: resource.id })
      } else if (DEACTIVATE.has(event.event_type)) {
        await setSubscription(userId, { active: false, provider: 'paypal', subscriptionId: resource.id })
      }
    }
  } catch {
    // Genuine sync failure → 500 so PayPal RETRIES and it's visible, instead of a phantom 200.
    res.statusCode = 500; return res.end(JSON.stringify({ error: 'sync failed' }))
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ received: true }))
}
