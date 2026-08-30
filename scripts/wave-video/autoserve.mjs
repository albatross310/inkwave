// SELF-SERVING WAVE PROBES — the wave-video/wave-desk half of `textrender-probe/serve.mjs`.
//
// ⚠ WHY THIS EXISTS (2026-08-30). The wave probes were written to be run against a server you had
// already started by hand (`node scripts/wave-video/server.mjs build/client 4311`), and they say so
// in their headers. When 52 unreachable probes were wired into `package.json` so they could be run
// at all, that turned into `pnpm prove:composited` dying at `page.goto` with
// **ERR_CONNECTION_REFUSED** — an error that reads as a broken APP, not as a missing harness.
// Wiring without migration converts "unrunnable" into "accuses the product", which is the direction
// this repo keeps paying for.
//
// It must be THIS server, not the scrub-probe one: that one has no `.mp4` MIME and no Range/206, so
// a probe run against it would fail to decode the video and report the video path broken — proving
// something false about the feature rather than about the transport. See server.mjs's own header.
//
// PROBE_PORT (or an explicit --port) still wins, so an existing workflow and a deliberately-reused
// server both keep working. Otherwise: an OS-assigned port, which cannot collide by construction —
// four of these probes shared hardcoded 4311/4317/4319/4321/4325 on a box that runs many lanes.

import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.on('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})

const waitUntilUp = async (base, timeoutMs = 20000) => {
  const t0 = Date.now()
  for (;;) {
    try { const r = await fetch(base + '/', { signal: AbortSignal.timeout(1000) }); if (r.ok) return } catch { /* not up */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`wave probe server did not come up on ${base}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

/**
 * Returns the base URL, booting a private wave-capable server when no port was supplied.
 *
 * The child is UNREF'd and killed on exit, so a probe that ends by falling off the bottom of the
 * file — which several of these do — neither hangs nor leaks a server. (The first cut of the
 * `textrender-probe` twin omitted the unref and hung a probe for ten minutes with its work already
 * done; do not remove it.)
 */
export async function autoWaveBase(explicitPort) {
  const given = explicitPort || process.env.PROBE_PORT
  if (given) {
    const base = `http://127.0.0.1:${given}`
    await waitUntilUp(base)
    return base
  }
  const port = await freePort()
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), join(ROOT, 'build', 'client'), String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const base = `http://127.0.0.1:${port}`
  try { await waitUntilUp(base) } catch (e) { child.kill('SIGKILL'); throw e }
  child.unref()
  process.once('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  return base
}
