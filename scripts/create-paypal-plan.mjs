// Create a PayPal subscription PRODUCT + PLAN via the API, since the dashboard UI is hard to find.
//
// Run it yourself so your secret never leaves your machine:
//
//   PAYPAL_ENV=live \
//   PAYPAL_CLIENT_ID=xxxx \
//   PAYPAL_SECRET=xxxx \
//   PLAN_PRICE=5.00 PLAN_CURRENCY=AUD PLAN_INTERVAL=MONTH \
//   node scripts/create-paypal-plan.mjs
//
// It prints the Plan ID (P-...) → set that as PAYPAL_PLAN_ID in Vercel.
// Node 18+ (native fetch). Use PAYPAL_ENV=sandbox first to test, then =live for real.

const ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox'
const BASE = ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
const CID = process.env.PAYPAL_CLIENT_ID
const SECRET = process.env.PAYPAL_SECRET
const PRICE = process.env.PLAN_PRICE || '5.00'
const CURRENCY = process.env.PLAN_CURRENCY || 'AUD'
const INTERVAL = process.env.PLAN_INTERVAL || 'MONTH' // DAY | WEEK | MONTH | YEAR
const PRODUCT_NAME = process.env.PLAN_PRODUCT_NAME || 'Inkwave Cadence'
const PLAN_NAME = process.env.PLAN_NAME || 'Inkwave Cadence — monthly'

if (!CID || !SECRET) { console.error('Set PAYPAL_CLIENT_ID and PAYPAL_SECRET.'); process.exit(1) }

async function api(path, method, body) {
  const auth = Buffer.from(`${CID}:${SECRET}`).toString('base64')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) { console.error(`\n${method} ${path} → ${res.status}\n${text}`); process.exit(1) }
  return text ? JSON.parse(text) : {}
}

// 1) OAuth token (client-credentials) — via the Basic-auth token endpoint.
async function token() {
  const auth = Buffer.from(`${CID}:${SECRET}`).toString('base64')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) { console.error('Token failed:', res.status, await res.text()); process.exit(1) }
}

console.log(`\nPayPal ${ENV.toUpperCase()} — creating "${PRODUCT_NAME}" (${PRICE} ${CURRENCY} / ${INTERVAL})\n`)
await token()

// 2) Create the catalog product.
const product = await api('/v1/catalogs/products', 'POST', {
  name: PRODUCT_NAME,
  type: 'SERVICE',
  category: 'SOFTWARE',
})
console.log('Product ID:', product.id)

// 3) Create the billing plan (a single infinite monthly regular cycle).
const plan = await api('/v1/billing/plans', 'POST', {
  product_id: product.id,
  name: PLAN_NAME,
  status: 'ACTIVE',
  billing_cycles: [{
    frequency: { interval_unit: INTERVAL, interval_count: 1 },
    tenure_type: 'REGULAR',
    sequence: 1,
    total_cycles: 0, // 0 = until cancelled
    pricing_scheme: { fixed_price: { value: PRICE, currency_code: CURRENCY } },
  }],
  payment_preferences: {
    auto_bill_outstanding: true,
    setup_fee_failure_action: 'CONTINUE',
    payment_failure_threshold: 3,
  },
})

console.log('\n────────────────────────────────────────')
console.log('  PAYPAL_PLAN_ID =', plan.id)
console.log('────────────────────────────────────────')
console.log('\nSet that as PAYPAL_PLAN_ID in Vercel. Done.\n')
