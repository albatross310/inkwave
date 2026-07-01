import { reactRouter } from '@react-router/dev/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig, type PluginOption } from 'vite'
import type { InlineConfig } from 'vitest'

// The /api/* serverless functions (OTS relay, signing service) are Node-only and don't bundle into
// the browser/SSR build — they run in Vercel functions in prod. `react-router dev` doesn't serve
// /api, so mirror each endpoint here by calling the same Node core (POST → JSON). One middleware,
// dispatched by path, keeps dev and prod behaviour identical.
const devApi: PluginOption = {
  name: 'dev-api',
  apply: 'serve',
  configureServer(server) {
    const route = async (raw: string, path: string, authorization?: string) => {
      const body = JSON.parse(raw || '{}')
      // @ts-expect-error - untyped Node-only ESM modules (live in api/, outside the src TS project)
      const ots = () => import('./api/_ots-core.mjs')
      // @ts-expect-error - untyped Node-only ESM module
      const prov = () => import('./api/_provenance-core.mjs')
      // @ts-expect-error - untyped Node-only ESM module
      const profile = () => import('./api/sync-profile.mjs')
      // @ts-expect-error - untyped Node-only ESM module
      const auth = () => import('./api/_auth.mjs')
      if (path === '/api/ots') return (await ots()).handleOts(body)
      if (path === '/api/session') return (await prov()).handleSession(body)
      if (path === '/api/sign') return (await prov()).handleSign(body, authorization)
      if (path === '/api/sync-profile') {
        // Identity from the verified token, mirroring prod (audit F1).
        const u = await (await auth()).userFromAuth(authorization)
        if (!u) throw new Error('invalid session')
        return (await profile()).syncProfile(u.userId)
      }
      throw new Error('not found')
    }
    // GET /api/me — the authed caller's cadence entitlement (reads the Clerk token header).
    server.middlewares.use('/api/me', async (req, res) => {
      // @ts-expect-error - untyped Node-only ESM module
      const { getEntitlement } = await import('./api/_billing-core.mjs')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await getEntitlement(req.headers.authorization || '')))
    })
    // POST /api/stripe-checkout & /api/paypal-subscribe — authed (Clerk Bearer) → { url } to redirect to.
    const authedUrl = (importer: () => Promise<{ [k: string]: (a: string, o: string) => Promise<{ status: number; body: unknown }> }>, fn: string) =>
      (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
        void (async () => {
          const mod = await importer()
          const origin = (req.headers.origin as string) || `http://${req.headers.host}`
          const r = await mod[fn](String(req.headers.authorization || ''), origin)
          res.statusCode = r.status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(r.body))
        })().catch(() => { res.statusCode = 500; res.end(JSON.stringify({ error: 'failed' })) })
      }
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/stripe-checkout', authedUrl(() => import('./api/stripe-checkout.mjs'), 'createStripeCheckout'))
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/paypal-subscribe', authedUrl(() => import('./api/paypal-subscribe.mjs'), 'createPaypalSubscription'))
    // POST webhooks — Node (req,res) handlers that read the RAW body themselves (for signature
    // verification). Same signature as the deployed Vercel functions, so dev mirrors prod exactly.
    type NodeHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> | void
    const webhook = (importer: () => Promise<{ default: NodeHandler }>) =>
      async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        try { await (await importer()).default(req, res) }
        catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'webhook failed' })) }
      }
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/stripe-webhook', webhook(() => import('./api/stripe-webhook.mjs')))
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/paypal-webhook', webhook(() => import('./api/paypal-webhook.mjs')))
    // POST /api/pdf — headless-Chromium PDF render (same (req,res) handler as prod). In dev this
    // needs a local Chrome; without one it returns 500 and the client falls back to the print dialog.
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/pdf', webhook(() => import('./api/pdf.mjs')))
    // GET /api/pubkey — the signing service's actual public key.
    server.middlewares.use('/api/pubkey', async (_req, res) => {
      // @ts-expect-error - untyped Node-only ESM module
      const { publicKeyHex } = await import('./api/_provenance-core.mjs')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ alg: 'Ed25519', keyId: 'inkwave-signing-v1', publicKeyHex: await publicKeyHex() }))
    })
    // POST /api/summarise — Anthropic paragraph-summary relay (key stays server-side).
    // @ts-expect-error - untyped Node-only ESM module
    server.middlewares.use('/api/summarise', webhook(() => import('./api/summarise.mjs')))
    for (const path of ['/api/ots', '/api/session', '/api/sign', '/api/sync-profile']) {
      server.middlewares.use(path, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
        let raw = ''
        req.on('data', (c) => { raw += c })
        req.on('end', async () => {
          try {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(await route(raw, path, req.headers.authorization as string | undefined)))
          } catch (err) {
            const msg = (err as Error)?.message
            res.statusCode = msg === 'bad request' ? 400 : msg === 'invalid session' ? 401 : msg === 'subscription required' ? 402 : 502
            res.end(JSON.stringify({ error: msg === 'subscription required' ? 'subscription required' : msg === 'invalid session' ? 'invalid session' : 'api failed' }))
          }
        })
      })
    }
  },
}

export default defineConfig({
  // Vitest config. Only scan src/ to avoid git worktrees Claude Code creates under .claude/.
  test: { include: ['src/**/*.test.{ts,tsx}'] } as InlineConfig,
  plugins: [devApi, reactRouter(), tsconfigPaths()],
  // A unique id per build. The service worker is registered as /sw.js?v=<id> and names its cache
  // after it, so EVERY deploy looks like an SW update → old caches purged + tabs reloaded once →
  // changes always show up, with no manual "unregister".
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: {
    host: true, // bind 0.0.0.0 so the WSL2 dev server is reachable from the Windows browser
  },
})
