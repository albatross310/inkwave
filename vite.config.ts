import { reactRouter } from '@react-router/dev/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig, type PluginOption } from 'vite'

// In production the OpenTimestamps relay is a Vercel serverless function (api/ots.mjs). The dev
// server (react-router dev) doesn't run /api functions, so mirror it here: a tiny middleware that
// handles POST /api/ots by calling the same Node core. Keeps OTS entirely in Node — no browser
// bundling of the Node library — in both dev and prod.
const devOtsApi: PluginOption = {
  name: 'dev-ots-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/ots', async (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          // @ts-expect-error - untyped Node-only ESM module (lives in api/, outside the src TS project)
          const { handleOts } = await import('./api/_ots-core.mjs')
          const result = await handleOts(JSON.parse(raw || '{}'))
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (err) {
          res.statusCode = (err as Error)?.message === 'bad request' ? 400 : 502
          res.end(JSON.stringify({ error: 'ots relay failed' }))
        }
      })
    })
  },
}

export default defineConfig({
  plugins: [devOtsApi, reactRouter(), tsconfigPaths()],
  server: {
    host: true, // bind 0.0.0.0 so the WSL2 dev server is reachable from the Windows browser
  },
})
