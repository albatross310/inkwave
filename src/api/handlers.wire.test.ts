// ─── The wire contract of every api/*.mjs entry point, pinned BEFORE the wrapper existed ──────
//
// These are the LIVE Vercel functions (provenance session/sign, the OTS relay, the source reader,
// PDF export, summarise, billing + webhooks). Each `it` drives the handler's default export with a
// fake Node req/res and pins status + headers + the EXACT end() payload on one path. Written
// against the UNMOVED handlers (CLAUDE.md: characterization before the move; RULES R6) so a wrapper
// that changes one byte on one path goes red here rather than in production, where
// `provenance/ots.ts callRelay` reads a 500 exactly like being offline.
//
// Headers are compared as a lower-cased map: ORDER-insensitive, VALUE-exact, and a header that a
// path never set must stay ABSENT — several error paths (ots, sync-profile, summarise, pdf) answer
// JSON bodies with no content-type. That is PINNED, NOT ENDORSED: it is what the deployed code does.
//
// The cores are stubbed (no keys, no network, no calendars): what is under test is the handler's
// plumbing — method, rate limit, body parse, header, error map — which is exactly the part a
// wrapper would own. `apiFunctionsParse.test.ts` says importing these for real "would execute
// module-scope SDK setup"; here the SDK modules that do that (@sparticuz/chromium, puppeteer-core,
// svix) are mocked, and `stripe`, `@clerk/backend`, `@supabase/supabase-js` construct nothing at
// import, so the handlers themselves load for real.

import { Readable } from 'node:stream'
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── stubs ───────────────────────────────────────────────────────────────────

const m = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  handleSession: vi.fn(async (_body: unknown) => ({ sessionToken: 'tok', setVersion: 0 })),
  handleSign: vi.fn(async (_body: unknown, _auth?: string) => ({ signature: 'sig' })),
  handleOts: vi.fn(async (_body: unknown) => ({ status: 'pending', proofBase64: 'AA==' })),
  readSource: vi.fn(async (_url: string) => ({ url: 'u', title: 't', blocks: [] })),
  checkFramable: vi.fn(async (_url: string) => ({ framable: true })),
  getEntitlement: vi.fn(async (_auth: string) => ({ cadence: false })),
  setSubscription: vi.fn(async () => undefined),
  alreadyProcessed: vi.fn(async (_id: string) => false),
  userFromAuth: vi.fn(async (_auth?: string) => null as null | { userId: string }),
  paypalToken: vi.fn(async () => null as null | string),
  verifyPaypalWebhook: vi.fn(async (_headers: unknown, _raw: string) => false),
  svixVerify: vi.fn((_payload: string, _headers: unknown): unknown => { throw new Error('bad') }),
  launch: vi.fn(async () => ({ close: async () => undefined })),
}))

vi.mock('../../api/_ratelimit.mjs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  rateLimit: m.rateLimit,
}))
vi.mock('../../api/_provenance-core.mjs', () => ({ handleSession: m.handleSession, handleSign: m.handleSign }))
vi.mock('../../api/_ots-core.mjs', () => ({ handleOts: m.handleOts }))
vi.mock('../../api/_reader-core.mjs', () => ({ readSource: m.readSource, checkFramable: m.checkFramable }))
vi.mock('../../api/_billing-core.mjs', () => ({
  getEntitlement: m.getEntitlement, setSubscription: m.setSubscription, alreadyProcessed: m.alreadyProcessed,
}))
vi.mock('../../api/_auth.mjs', () => ({ userFromAuth: m.userFromAuth }))
vi.mock('../../api/_supabase.mjs', () => ({ supabaseAdmin: () => null }))
vi.mock('../../api/_paypal.mjs', () => ({
  paypalBase: () => 'https://paypal.invalid', paypalToken: m.paypalToken, verifyPaypalWebhook: m.verifyPaypalWebhook,
}))
vi.mock('svix', () => ({ Webhook: class { verify(p: string, h: unknown) { return m.svixVerify(p, h) } } }))
vi.mock('@sparticuz/chromium', () => ({ default: { args: [], executablePath: async () => '/x', setGraphicsMode: false } }))
vi.mock('puppeteer-core', () => ({ default: { launch: m.launch } }))

// The handlers, imported for real (default export = the deployed function).
type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown
const load = async (name: string): Promise<Handler> =>
  ((await import(/* @vite-ignore */ `../../api/${name}.mjs`)) as { default: Handler }).default
const H = {
  session: await load('session'),
  sign: await load('sign'),
  ots: await load('ots'),
  syncProfile: await load('sync-profile'),
  reader: await load('reader'),
  me: await load('me'),
  summarise: await load('summarise'),
  stripeCheckout: await load('stripe-checkout'),
  paypalSubscribe: await load('paypal-subscribe'),
  stripeWebhook: await load('stripe-webhook'),
  paypalWebhook: await load('paypal-webhook'),
  pdf: await load('pdf'),
}
const clerkWebhook = ((await import('../../api/clerk-webhook.mjs')) as { default: (r: Request) => Promise<Response> }).default

// ─── fake Node req / res ─────────────────────────────────────────────────────

type ReqInit = { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; url?: string }
/** A readable whose stream carries `raw` (what the webhooks/pdf/summarise read) and whose `.body`
 *  is what Vercel's JSON pre-parse would have set (what session/sign/ots read first). */
function req({ method = 'POST', body, raw, headers = {}, url = '/' }: ReqInit = {}) {
  const r = Readable.from(raw === undefined ? [] : [Buffer.from(raw, 'utf8')]) as Readable & Record<string, unknown>
  r.method = method
  r.headers = headers
  r.url = url
  if (body !== undefined) r.body = body
  return r
}

type Wire = { status: number; headers: Record<string, string>; body: unknown }
function res() {
  const headers: Record<string, string> = {}
  const r = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v },
    getHeader(k: string) { return headers[k.toLowerCase()] },
    end(payload?: unknown) { r.body = payload; return r },
    /** status + headers (order-insensitive, value-exact) + the exact end() payload. */
    wire(): Wire { return { status: r.statusCode, headers: { ...headers }, body: r.body } },
  }
  return r
}
async function run(h: Handler, init: ReqInit = {}) {
  const r = res()
  await h(req(init), r)
  return r.wire()
}
const JSON_CT = { 'content-type': 'application/json' }
const j = (o: unknown) => JSON.stringify(o)

const ENV = ['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'PAYPAL_PLAN_ID',
  'CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SECRET', 'CRON_SECRET', 'VERCEL', 'AWS_LAMBDA_FUNCTION_VERSION'] as const
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  vi.clearAllMocks()
  m.rateLimit.mockResolvedValue({ ok: true })
  m.userFromAuth.mockResolvedValue(null)
  m.paypalToken.mockResolvedValue(null)
  m.verifyPaypalWebhook.mockResolvedValue(false)
  m.alreadyProcessed.mockResolvedValue(false)
})
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

// ─── the fake itself must be able to fail (R6) ───────────────────────────────

describe('the harness', () => {
  it('KNOWN-POSITIVE: a header set on one path is visible, and one never set is absent', async () => {
    const r = res()
    r.setHeader('Content-Type', 'x')
    r.statusCode = 418
    r.end('p')
    expect(r.wire()).toEqual({ status: 418, headers: { 'content-type': 'x' }, body: 'p' })
    expect(r.wire().headers['cache-control']).toBeUndefined()
  })
  it('KNOWN-POSITIVE: the raw stream carries the exact bytes, and .body is absent unless given', async () => {
    const r = req({ raw: ' {"a":1} \n' })
    const chunks: Buffer[] = []
    for await (const c of r) chunks.push(c as Buffer)
    expect(Buffer.concat(chunks).toString('utf8')).toBe(' {"a":1} \n')
    expect(r.body).toBeUndefined()
  })
})

// ─── /api/session ────────────────────────────────────────────────────────────

describe('session.mjs', () => {
  it('GET → 405 text, no headers, core and rate limit untouched', async () => {
    expect(await run(H.session, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
    expect(m.rateLimit).not.toHaveBeenCalled()
    expect(m.handleSession).not.toHaveBeenCalled()
  })
  it('rate-limits per IP in bucket session 30/60 → 429 JSON with content-type', async () => {
    m.rateLimit.mockResolvedValueOnce({ ok: false })
    const w = await run(H.session, { body: { docId: 'd' }, headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' } })
    expect(w).toEqual({ status: 429, headers: JSON_CT, body: j({ error: 'rate limited' }) })
    expect(m.rateLimit).toHaveBeenCalledWith('9.9.9.9', 'session', 30, 60)
    expect(m.handleSession).not.toHaveBeenCalled()
  })
  it('happy path: pre-parsed object body → 200 JSON of the core result', async () => {
    const w = await run(H.session, { body: { docId: 'd' } })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ sessionToken: 'tok', setVersion: 0 }) })
    expect(m.handleSession).toHaveBeenCalledWith({ docId: 'd' })
  })
  it('a JSON STRING body is parsed; an absent body is {}', async () => {
    await run(H.session, { body: '{"docId":"s"}' })
    expect(m.handleSession).toHaveBeenLastCalledWith({ docId: 's' })
    await run(H.session, {})
    expect(m.handleSession).toHaveBeenLastCalledWith({})
  })
  it('malformed body → 500 {error:"session failed"} with NO content-type (parse fails before the header)', async () => {
    const w = await run(H.session, { body: '{nope' })
    expect(w).toEqual({ status: 500, headers: {}, body: j({ error: 'session failed' }) })
    expect(m.handleSession).not.toHaveBeenCalled()
  })
  it('core throws "bad request" → 400 JSON, content-type already set', async () => {
    m.handleSession.mockRejectedValueOnce(new Error('bad request'))
    expect(await run(H.session, { body: {} })).toEqual({ status: 400, headers: JSON_CT, body: j({ error: 'session failed' }) })
  })
  it('core throws anything else → 500, same fixed body, message never leaks', async () => {
    m.handleSession.mockRejectedValueOnce(new Error('INKWAVE_MASTER_SECRET unset'))
    expect(await run(H.session, { body: {} })).toEqual({ status: 500, headers: JSON_CT, body: j({ error: 'session failed' }) })
  })
})

// ─── /api/sign ───────────────────────────────────────────────────────────────

describe('sign.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.sign, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
    expect(m.rateLimit).not.toHaveBeenCalled()
  })
  it('rate-limits in bucket sign 120/60 → 429 JSON with content-type', async () => {
    m.rateLimit.mockResolvedValueOnce({ ok: false })
    const w = await run(H.sign, { body: {}, headers: { 'x-real-ip': '2.2.2.2' } })
    expect(w).toEqual({ status: 429, headers: JSON_CT, body: j({ error: 'rate limited' }) })
    expect(m.rateLimit).toHaveBeenCalledWith('2.2.2.2', 'sign', 120, 60)
  })
  it('happy path passes the body AND the authorization header to the core', async () => {
    const w = await run(H.sign, { body: { counter: 1 }, headers: { authorization: 'Bearer t' } })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ signature: 'sig' }) })
    expect(m.handleSign).toHaveBeenCalledWith({ counter: 1 }, 'Bearer t')
  })
  it('no authorization header → the core sees undefined (free tier), not ""', async () => {
    await run(H.sign, { body: {} })
    expect(m.handleSign).toHaveBeenCalledWith({}, undefined)
  })
  it('malformed body → 500 {error:"sign failed"}, no content-type', async () => {
    expect(await run(H.sign, { body: '[' })).toEqual({ status: 500, headers: {}, body: j({ error: 'sign failed' }) })
  })
  it.each([
    ['bad request', 400, 'sign failed'],
    ['invalid session', 401, 'invalid session'],
    ['subscription required', 402, 'subscription required'],
    ['anything else', 500, 'sign failed'],
  ])('core throws %j → %i {error:%j}', async (msg, status, error) => {
    m.handleSign.mockRejectedValueOnce(new Error(msg))
    expect(await run(H.sign, { body: {} })).toEqual({ status, headers: JSON_CT, body: j({ error }) })
  })
})

// ─── /api/ots ────────────────────────────────────────────────────────────────

describe('ots.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.ots, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('has NO rate limit', async () => {
    await run(H.ots, { body: { action: 'stamp' } })
    expect(m.rateLimit).not.toHaveBeenCalled()
  })
  it('happy path → 200 JSON; content-type is set AFTER the core returns', async () => {
    const w = await run(H.ots, { body: { action: 'stamp', bundleHash: 'ab' } })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ status: 'pending', proofBase64: 'AA==' }) })
    expect(m.handleOts).toHaveBeenCalledWith({ action: 'stamp', bundleHash: 'ab' })
  })
  it('malformed body → 502 {error:"ots relay failed"}, no content-type (PINNED, NOT ENDORSED: 502 not 500)', async () => {
    expect(await run(H.ots, { body: 'x' })).toEqual({ status: 502, headers: {}, body: j({ error: 'ots relay failed' }) })
  })
  it('core throws "bad request" → 400 with NO content-type (the header comes after the call here)', async () => {
    m.handleOts.mockRejectedValueOnce(new Error('bad request'))
    expect(await run(H.ots, { body: {} })).toEqual({ status: 400, headers: {}, body: j({ error: 'ots relay failed' }) })
  })
  it('core throws anything else → 502, no content-type', async () => {
    m.handleOts.mockRejectedValueOnce(new Error('calendar down'))
    expect(await run(H.ots, { body: {} })).toEqual({ status: 502, headers: {}, body: j({ error: 'ots relay failed' }) })
  })
})

// ─── /api/sync-profile ───────────────────────────────────────────────────────

describe('sync-profile.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.syncProfile, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('no verified identity → 401 {ok:false} JSON; the body is never read', async () => {
    const w = await run(H.syncProfile, { body: '{not json', headers: { authorization: 'Bearer x' } })
    expect(w).toEqual({ status: 401, headers: JSON_CT, body: j({ ok: false }) })
    expect(m.userFromAuth).toHaveBeenCalledWith('Bearer x')
  })
  it('verified identity, Clerk/Supabase unconfigured → 200 {ok:false,skipped:true}', async () => {
    m.userFromAuth.mockResolvedValueOnce({ userId: 'user_1' })
    expect(await run(H.syncProfile, { headers: { authorization: 'Bearer x' } }))
      .toEqual({ status: 200, headers: JSON_CT, body: j({ ok: false, skipped: true }) })
  })
  it('auth verifier throws → 500 {ok:false}, no content-type', async () => {
    m.userFromAuth.mockRejectedValueOnce(new Error('jwks down'))
    expect(await run(H.syncProfile, {})).toEqual({ status: 500, headers: {}, body: j({ ok: false }) })
  })
})

// ─── /api/reader ─────────────────────────────────────────────────────────────

describe('reader.mjs', () => {
  it('POST → 405 JSON {error:"method"} — content-type is set before anything else', async () => {
    expect(await run(H.reader, { method: 'POST', url: '/api/reader?url=x' }))
      .toEqual({ status: 405, headers: JSON_CT, body: j({ error: 'method' }) })
  })
  it('rate-limits in bucket reader 60/60 → 429 {error:"rate"}', async () => {
    m.rateLimit.mockResolvedValueOnce({ ok: false })
    const w = await run(H.reader, { method: 'GET', url: '/api/reader?url=https%3A%2F%2Fa.example%2F', headers: { 'x-forwarded-for': '3.3.3.3' } })
    expect(w).toEqual({ status: 429, headers: JSON_CT, body: j({ error: 'rate' }) })
    expect(m.rateLimit).toHaveBeenCalledWith('3.3.3.3', 'reader', 60, 60)
  })
  it('GET ?url= → 200 JSON of readSource(url)', async () => {
    const w = await run(H.reader, { method: 'GET', url: '/api/reader?url=https%3A%2F%2Fa.example%2Fp' })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ url: 'u', title: 't', blocks: [] }) })
    expect(m.readSource).toHaveBeenCalledWith('https://a.example/p')
  })
  it('?probe=1 → checkFramable(url) instead', async () => {
    const w = await run(H.reader, { method: 'GET', url: '/api/reader?url=https%3A%2F%2Fa.example%2F&probe=1' })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ framable: true }) })
    expect(m.checkFramable).toHaveBeenCalledWith('https://a.example/')
    expect(m.readSource).not.toHaveBeenCalled()
  })
  it('a missing url is passed as "" (the core decides it is a bad url)', async () => {
    await run(H.reader, { method: 'GET', url: '/api/reader' })
    expect(m.readSource).toHaveBeenCalledWith('')
  })
  it.each([
    ['bad url', 400, 'bad url'],
    ['blocked host', 400, 'blocked host'],
    ['not html', 502, 'not html'],
    ['no readable text', 502, 'no readable text'],
    ['ECONNRESET upstream at http://10.0.0.1/', 502, 'fetch failed'],
  ])('core throws %j → %i {error:%j} — a non-code message is never echoed', async (msg, status, error) => {
    m.readSource.mockRejectedValueOnce(new Error(msg))
    expect(await run(H.reader, { method: 'GET', url: '/api/reader?url=x' })).toEqual({ status, headers: JSON_CT, body: j({ error }) })
  })
})

// ─── /api/me ─────────────────────────────────────────────────────────────────

describe('me.mjs', () => {
  it('any method → 200 JSON + cache-control: no-store; authorization forwarded, "" when absent', async () => {
    const hdrs = { ...JSON_CT, 'cache-control': 'no-store' }
    expect(await run(H.me, { method: 'GET', headers: { authorization: 'Bearer q' } })).toEqual({ status: 200, headers: hdrs, body: j({ cadence: false }) })
    expect(m.getEntitlement).toHaveBeenLastCalledWith('Bearer q')
    expect(await run(H.me, { method: 'POST' })).toEqual({ status: 200, headers: hdrs, body: j({ cadence: false }) })
    expect(m.getEntitlement).toHaveBeenLastCalledWith('')
  })
})

// ─── /api/summarise ──────────────────────────────────────────────────────────

describe('summarise.mjs', () => {
  const anthropicOk = (text: string) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ text }] }) })))
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.summarise, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('no ANTHROPIC_API_KEY → 503 JSON body with NO content-type, before the rate limit', async () => {
    expect(await run(H.summarise, { body: { text: 'x' } })).toEqual({ status: 503, headers: {}, body: j({ error: 'summarise unavailable' }) })
    expect(m.rateLimit).not.toHaveBeenCalled()
  })
  it('rate-limits in bucket summarise 60/60 → 429 JSON with NO content-type', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    m.rateLimit.mockResolvedValueOnce({ ok: false })
    const w = await run(H.summarise, { body: { text: 'x' }, headers: { 'x-forwarded-for': '4.4.4.4' } })
    expect(w).toEqual({ status: 429, headers: {}, body: j({ error: 'rate limited' }) })
    expect(m.rateLimit).toHaveBeenCalledWith('4.4.4.4', 'summarise', 60, 60)
  })
  it('reads the body from the STREAM when Vercel has not pre-parsed it', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    anthropicOk(' - opening rewritten ')
    const w = await run(H.summarise, { raw: j({ before: 'a', after: 'b' }) })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ bullets: '- opening rewritten' }) })
  })
  it('an EMPTY stream body is read as {} → the plain summary path', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    anthropicOk('Short summary')
    expect(await run(H.summarise, { raw: '' })).toEqual({ status: 200, headers: JSON_CT, body: j({ summary: 'Short summary' }) })
  })
  it('a MALFORMED stream body → 502 {error:"summarise failed"} (PINNED, NOT ENDORSED: the .catch guards only the read, not the parse)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    anthropicOk('never reached')
    expect(await run(H.summarise, { raw: '{{' })).toEqual({ status: 502, headers: {}, body: j({ error: 'summarise failed' }) })
  })
  it('extract without a url → 400 JSON, no content-type', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    expect(await run(H.summarise, { body: { extract: { url: 'ftp://x' } } })).toEqual({ status: 400, headers: {}, body: j({ error: 'extract needs a url' }) })
  })
  it('upstream failure → 502 {error:"summarise failed"}, no content-type', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 529 })))
    expect(await run(H.summarise, { body: { text: 'x' } })).toEqual({ status: 502, headers: {}, body: j({ error: 'summarise failed' }) })
  })
})

// ─── /api/stripe-checkout + /api/paypal-subscribe ────────────────────────────

describe('stripe-checkout.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.stripeCheckout, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('not signed in → 401 JSON', async () => {
    expect(await run(H.stripeCheckout, {})).toEqual({ status: 401, headers: JSON_CT, body: j({ error: 'sign in required' }) })
    expect(m.userFromAuth).toHaveBeenCalledWith('')
  })
  it('signed in, Stripe unconfigured → 500 JSON', async () => {
    m.userFromAuth.mockResolvedValueOnce({ userId: 'user_1' })
    expect(await run(H.stripeCheckout, { headers: { authorization: 'Bearer t' } }))
      .toEqual({ status: 500, headers: JSON_CT, body: j({ error: 'stripe not configured' }) })
  })
})

describe('paypal-subscribe.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.paypalSubscribe, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('not signed in → 401 JSON', async () => {
    expect(await run(H.paypalSubscribe, {})).toEqual({ status: 401, headers: JSON_CT, body: j({ error: 'sign in required' }) })
  })
  it('signed in, PayPal unconfigured → 500 JSON', async () => {
    m.userFromAuth.mockResolvedValueOnce({ userId: 'user_1' })
    expect(await run(H.paypalSubscribe, { headers: { authorization: 'Bearer t', host: 'h' } }))
      .toEqual({ status: 500, headers: JSON_CT, body: j({ error: 'paypal not configured' }) })
  })
})

// ─── webhooks: the RAW body reaches the verifier byte-for-byte ───────────────

describe('stripe-webhook.mjs', () => {
  const SECRET = 'whsec_test_not_real'
  const signed = (payload: string) =>
    new Stripe('sk_test_not_real').webhooks.generateTestHeaderString({ payload, secret: SECRET })
  const configured = () => { process.env.STRIPE_SECRET_KEY = 'sk_test_not_real'; process.env.STRIPE_WEBHOOK_SECRET = SECRET }

  it('GET → 405 text, no headers', async () => {
    expect(await run(H.stripeWebhook, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('unconfigured → 500 JSON, no content-type', async () => {
    expect(await run(H.stripeWebhook, { raw: '{}' })).toEqual({ status: 500, headers: {}, body: j({ error: 'not configured' }) })
  })
  it('bad signature → 400 JSON, no content-type', async () => {
    configured()
    expect(await run(H.stripeWebhook, { raw: '{}', headers: { 'stripe-signature': 't=1,v1=00' } }))
      .toEqual({ status: 400, headers: {}, body: j({ error: 'bad signature' }) })
  })
  it('a payload signed over the EXACT raw bytes (whitespace and all) verifies → 200 {received:true}', async () => {
    configured()
    const payload = '{\n  "id": "evt_1",\n  "type": "ping",\n  "created": 1700000000,\n  "data": {"object": {}}\n}'
    const w = await run(H.stripeWebhook, { raw: payload, headers: { 'stripe-signature': signed(payload) } })
    expect(w).toEqual({ status: 200, headers: JSON_CT, body: j({ received: true }) })
    expect(m.alreadyProcessed).toHaveBeenCalledWith('evt_1')
  })
  it('KNOWN-NEGATIVE: the same payload re-serialised (whitespace dropped) no longer verifies — this is why a webhook must never be body-parsed', async () => {
    configured()
    const payload = '{ "id": "evt_2", "type": "ping" }'
    const reserialised = JSON.stringify(JSON.parse(payload))
    expect(reserialised).not.toBe(payload)
    const w = await run(H.stripeWebhook, { raw: reserialised, headers: { 'stripe-signature': signed(payload) } })
    expect(w).toEqual({ status: 400, headers: {}, body: j({ error: 'bad signature' }) })
  })
  it('replayed event id → 200 {received:true,duplicate:true}', async () => {
    configured()
    m.alreadyProcessed.mockResolvedValueOnce(true)
    const payload = '{"id":"evt_3","type":"ping"}'
    expect(await run(H.stripeWebhook, { raw: payload, headers: { 'stripe-signature': signed(payload) } }))
      .toEqual({ status: 200, headers: JSON_CT, body: j({ received: true, duplicate: true }) })
  })
  it('sync failure → 500 {error:"sync failed"}, no content-type (Stripe retries)', async () => {
    configured()
    m.alreadyProcessed.mockRejectedValueOnce(new Error('supabase down'))
    const payload = '{"id":"evt_4","type":"ping"}'
    expect(await run(H.stripeWebhook, { raw: payload, headers: { 'stripe-signature': signed(payload) } }))
      .toEqual({ status: 500, headers: {}, body: j({ error: 'sync failed' }) })
  })
})

describe('paypal-webhook.mjs', () => {
  it('GET → 405 text, no headers', async () => {
    expect(await run(H.paypalWebhook, { method: 'GET' })).toEqual({ status: 405, headers: {}, body: 'Method Not Allowed' })
  })
  it('the verifier receives the request headers and the raw body VERBATIM', async () => {
    const raw = ' {"id":"WH-1",\n "event_type":"PING"} '
    const w = await run(H.paypalWebhook, { raw, headers: { 'paypal-transmission-id': 'tid' } })
    expect(w).toEqual({ status: 400, headers: {}, body: j({ error: 'bad signature' }) })
    expect(m.verifyPaypalWebhook).toHaveBeenCalledWith({ 'paypal-transmission-id': 'tid' }, raw)
  })
  it('verified, new event → 200 {received:true}', async () => {
    m.verifyPaypalWebhook.mockResolvedValueOnce(true)
    expect(await run(H.paypalWebhook, { raw: '{"id":"WH-2","event_type":"PING"}' }))
      .toEqual({ status: 200, headers: JSON_CT, body: j({ received: true }) })
    expect(m.alreadyProcessed).toHaveBeenCalledWith('WH-2')
  })
  it('verified, replayed → 200 {received:true,duplicate:true}', async () => {
    m.verifyPaypalWebhook.mockResolvedValueOnce(true)
    m.alreadyProcessed.mockResolvedValueOnce(true)
    expect(await run(H.paypalWebhook, { raw: '{"id":"WH-3"}' }))
      .toEqual({ status: 200, headers: JSON_CT, body: j({ received: true, duplicate: true }) })
  })
  it('verified but unparseable → 500 {error:"sync failed"}, no content-type', async () => {
    m.verifyPaypalWebhook.mockResolvedValueOnce(true)
    expect(await run(H.paypalWebhook, { raw: 'not json' })).toEqual({ status: 500, headers: {}, body: j({ error: 'sync failed' }) })
  })
})

describe('clerk-webhook.mjs (Web Request/Response)', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('http://x/api/clerk-webhook', { method: 'POST', body, headers })
  const wire = async (r: Response) => ({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.text() })
  it('GET → 405 text', async () => {
    const r = await clerkWebhook(new Request('http://x/api/clerk-webhook', { method: 'GET' }))
    expect(await wire(r)).toEqual({ status: 405, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: 'Method Not Allowed' })
  })
  it('unconfigured → 500 (Response default text/plain content-type, PINNED)', async () => {
    const r = await clerkWebhook(post('{}'))
    expect(await wire(r)).toEqual({ status: 500, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: j({ error: 'not configured' }) })
  })
  it('bad svix signature → 400; the verifier saw the raw text and the three svix headers', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_not_real'
    const r = await clerkWebhook(post(' {"type":"user.created"} ', { 'svix-id': 'i', 'svix-timestamp': '1' }))
    expect(await wire(r)).toEqual({ status: 400, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: j({ error: 'bad signature' }) })
    expect(m.svixVerify).toHaveBeenCalledWith(' {"type":"user.created"} ', { 'svix-id': 'i', 'svix-timestamp': '1', 'svix-signature': '' })
  })
  it('verified user.created with no Supabase → 200 {ok:true} application/json', async () => {
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_not_real'
    m.svixVerify.mockReturnValueOnce({ type: 'user.created', data: { id: 'user_1', email_addresses: [] } })
    const r = await clerkWebhook(post('{}'))
    expect(await wire(r)).toEqual({ status: 200, headers: JSON_CT, body: j({ ok: true }) })
  })
})

// ─── /api/pdf ────────────────────────────────────────────────────────────────

describe('pdf.mjs', () => {
  it('PUT → 405 lower-case text (PINNED: differs from every other 405 here)', async () => {
    expect(await run(H.pdf, { method: 'PUT' })).toEqual({ status: 405, headers: {}, body: 'method not allowed' })
  })
  // launch() only reaches puppeteer on the Vercel branch; off it, it hunts for a local Chrome first.
  it('GET warm-up (on Vercel) → 200 JSON + no-store after a launch/close', async () => {
    process.env.VERCEL = '1'
    expect(await run(H.pdf, { method: 'GET', headers: {} }))
      .toEqual({ status: 200, headers: { ...JSON_CT, 'cache-control': 'no-store' }, body: j({ warm: true }) })
    expect(m.launch).toHaveBeenCalledTimes(1)
  })
  it('GET with CRON_SECRET set and a wrong bearer → 401 text, no launch', async () => {
    process.env.CRON_SECRET = 'cron-not-real'
    expect(await run(H.pdf, { method: 'GET', headers: { authorization: 'Bearer nope' } })).toEqual({ status: 401, headers: {}, body: 'unauthorized' })
    expect(m.launch).not.toHaveBeenCalled()
  })
  it('GET warm-up launch failure → 500 text carrying the message', async () => {
    process.env.VERCEL = '1'
    m.launch.mockRejectedValueOnce(new Error('no chrome'))
    expect(await run(H.pdf, { method: 'GET', headers: {} })).toEqual({ status: 500, headers: {}, body: 'warm failed: no chrome' })
  })
  it('rate-limits in bucket pdf 10/60 → 429 JSON with NO content-type', async () => {
    m.rateLimit.mockResolvedValueOnce({ ok: false })
    expect(await run(H.pdf, { raw: '{}', headers: { 'x-forwarded-for': '5.5.5.5' } })).toEqual({ status: 429, headers: {}, body: j({ error: 'rate limited' }) })
    expect(m.rateLimit).toHaveBeenCalledWith('5.5.5.5', 'pdf', 10, 60)
  })
  it('unparseable raw body → 400 plain "bad request"', async () => {
    expect(await run(H.pdf, { raw: '<html>', headers: {} })).toEqual({ status: 400, headers: {}, body: 'bad request' })
  })
  it('parseable body with no html → 500 text/plain "pdf generation failed: missing html"', async () => {
    expect(await run(H.pdf, { raw: '{"title":"t"}', headers: {} }))
      .toEqual({ status: 500, headers: { 'content-type': 'text/plain' }, body: 'pdf generation failed: missing html' })
    expect(m.launch).not.toHaveBeenCalled()
  })
})
