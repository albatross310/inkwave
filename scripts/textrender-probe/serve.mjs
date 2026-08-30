// SELF-SERVING PROBES — one command, and NO PORT COLLISION (2026-07-17).
//
// WHY. Every probe here took `PROBE_PORT` and assumed a server was already up on it. That is a real
// hazard on this box, where many agents run at once: tonight an agent's probe confidently reported
// "the wiring never fires" because its port collided and EVERY request went to a DIFFERENT agent's
// Inkwave build. The probe was reading someone else's app and could not tell. A fixed default port
// is a shared mutable global between processes that do not know about each other.
//
// So: if PROBE_PORT is set, honour it (existing workflows, and a running server you want to reuse).
// If it is NOT set, take an EPHEMERAL port from the OS and boot a private server on it — which
// cannot collide by construction, rather than by convention.
//
// The probes ALSO assert the served bundle is theirs by content before reading any number. This
// helper removes the collision; that assertion catches it if it ever happens anyway. Both, because
// the failure is silent.

import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/** An OS-assigned free port. */
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.on('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})

const waitUntilUp = async (base, timeoutMs = 15000) => {
  const t0 = Date.now()
  for (;;) {
    try {
      const r = await fetch(base + '/', { signal: AbortSignal.timeout(1000) })
      if (r.ok) return
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`probe server did not come up on ${base}`)
    await new Promise(r => setTimeout(r, 150))
  }
}

/**
 * Returns { base, stop }. With PROBE_PORT set, assumes a server is already there and stop() is a
 * no-op — this helper never kills a server it did not start (another agent's `vite preview` is
 * exactly what must not be torn down).
 */
export async function startProbeServer() {
  if (process.env.PROBE_PORT) {
    const base = `http://127.0.0.1:${process.env.PROBE_PORT}`
    await waitUntilUp(base)
    return { base, stop: async () => {}, owned: false }
  }
  const port = await freePort()
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'scrub-probe', 'server.mjs'), join(ROOT, 'build', 'client'), String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const base = `http://127.0.0.1:${port}`
  try {
    await waitUntilUp(base)
  } catch (e) {
    child.kill('SIGKILL')
    throw e
  }
  // Only ever kills the child THIS process spawned — never a pkill by name.
  return { base, stop: async () => { child.kill('SIGKILL') }, owned: true, child }
}

/**
 * THE ONE-LINE FORM, for probes that were written against an externally-started server.
 *
 * ⚠ WHY THIS EXISTS (2026-08-30). 52 `.prove.mjs` files were wired into `package.json` so they could
 * be run at all — but 27 of them opened with `const BASE = http://127.0.0.1:${PROBE_PORT || 4242}`
 * and booted NOTHING. `pnpm prove:isolate` therefore died at `page.goto` with
 * ERR_CONNECTION_REFUSED, which reads as a broken APP rather than a missing harness. Wiring without
 * migration turned "unrunnable" into "accuses the product" — the exact direction this repo keeps
 * paying for.
 *
 * Honours PROBE_PORT when set (an existing workflow, or a server you deliberately want to reuse).
 * Otherwise boots a private server on an OS-assigned port, which cannot collide by construction.
 * The child is UNREF'd and killed on exit, so a probe that never calls `stop()` neither hangs nor
 * leaks — that is what makes this a one-line change at each call site rather than a two-line one
 * that someone forgets the second half of.
 *
 * The legacy default port is deliberately NOT honoured: a fixed default is a shared mutable global
 * between processes that do not know about each other, which is the hazard this file was written to
 * remove.
 */
export async function autoBase() {
  const { base, stop, owned, child } = await startProbeServer()
  if (owned) {
    // ⚠ UNREF, AND IT IS NOT AN OPTIMISATION. A spawned child keeps the parent's event loop
    // referenced, so a probe that ends by falling off the bottom of the file — which most of these
    // do, having no `process.exit` — would HANG FOREVER instead of finishing. I introduced exactly
    // that hang on the first cut of this helper and watched `pnpm prove:isolate` run past ten
    // minutes with its work already done. Unref lets the process exit naturally; the exit hook then
    // kills the server.
    child?.unref()
    process.once('exit', () => { try { void stop() } catch { /* already gone */ } })
  }
  return base
}
