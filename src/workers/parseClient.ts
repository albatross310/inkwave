// Main-thread client for parse.worker.ts — lazy singleton, promise-per-request, and a transparent
// inline fallback (node/vitest, prerender, or any environment without Worker). Callers keep plain
// async signatures; whether the parse ran off-thread is an implementation detail.

import { parseTraceFile, parseStudioBuffer } from '../provenance/traceParse'
import type { ExportBundle } from '../provenance/bundle'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return null
  try {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: unknown; err?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.err !== undefined) p.reject(new Error(e.data.err))
      else p.resolve(e.data.ok)
    }
    worker.onerror = () => {
      // Worker died (CSP, load failure) → fail everything in flight; callers fall back inline.
      for (const [, p] of pending) p.reject(new Error('parse worker error'))
      pending.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    worker = null
    return null
  }
}

function call(msg: { kind: 'gunzipJson'; buf: ArrayBuffer } | { kind: 'parseTrace'; text: string } | { kind: 'parseStudio'; buf: ArrayBuffer } | { kind: 'opfsWrite'; path: string[]; bytes: ArrayBuffer }, transfer: Transferable[]): Promise<unknown> | null {
  const w = getWorker()
  if (!w) return null
  const id = ++seq
  const p = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
  w.postMessage({ id, ...msg }, transfer)
  return p
}

async function inlineGunzipJson(buf: ArrayBuffer): Promise<unknown> {
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter()
  // MUST be a view, not the raw ArrayBuffer: a stream chunk has to be a TypedArray/DataView. Writing
  // the ArrayBuffer REJECTS the write — and because both promises were `void`ed the rejection
  // surfaced nowhere and `Response(...).text()` simply never settled. A HANG, not a throw, so the
  // caller's try/catch could never catch it (readSnapshotsFromDisk returns [] on error — it would
  // have waited forever instead). Found 2026-07-17 by the first test that ever read a cold archive:
  // this fallback (the no-Worker path — node/vitest/prerender) had never once been exercised.
  // ...and MUST NOT be `void`ed either, for the mirror-image reason. On a CORRUPT gzip the writer's
  // own promises REJECT, and a `void`ed rejection has no handler: it escapes as an unhandled
  // rejection (vitest fails the run on it; a browser reports it as an uncaught error) even though
  // the caller's try/catch works perfectly. The readable side is what carries the real failure —
  // `Response(...).text()` throws the genuine Z_BUF_ERROR/"unexpected end of file" and that is the
  // error callers must see — so the writer's rejections are the SAME fault arriving twice. Attach a
  // handler so the duplicate is observed, and let the readable side throw. Swallowing here hides
  // nothing: a write/close that fails without the readable also failing is not constructible.
  // Found 2026-07-17 by the first tests that ever read a CORRUPT archive.
  const wrote = w.write(new Uint8Array(buf)).catch(() => {})
  const closed = w.close().catch(() => {})
  const text = await new Response(ds.readable).text()
  await wrote
  await closed
  return JSON.parse(text)
}

/** gunzip + JSON.parse, off-thread when possible. The buffer is TRANSFERRED (detached). */
export async function gunzipJsonOffThread(buf: ArrayBuffer): Promise<unknown> {
  const p = call({ kind: 'gunzipJson', buf }, [buf])
  if (p) { try { return await p } catch { /* worker died mid-flight; buf is gone — rethrow below */ } }
  if (!p) return inlineGunzipJson(buf)
  throw new Error('parse worker failed')
}

/** Raw .studio bytes → bundle, off-thread when possible: gunzip-sniff + decode + JSON.parse all in
 *  the worker, so opening a 20 MB doc never stalls the main thread.
 *
 *  Takes the BLOB (not a buffer): the worker copy is transferred (detached), so when the worker
 *  DIES — chunk fetch failure on a flaky mobile network, an iOS memory-pressure kill, CSP — the
 *  Blob is the still-readable source for the inline retry. The 2026-07-09 version took the buffer
 *  and RETHREW on worker death; on an iPhone that turned every cloud open into a silent failure
 *  ("blank page", 2026-07-10), where every other worker op had always degraded inline. */
export async function parseStudioOffThread(file: Blob): Promise<ExportBundle> {
  const buf = await file.arrayBuffer()
  const p = call({ kind: 'parseStudio', buf }, [buf])
  if (!p) return parseStudioBuffer(buf) // no Worker (node/vitest, prerender) → same logic inline
  try {
    return (await p) as ExportBundle
  } catch {
    // Worker rejected — a genuine parse error OR a dead worker; the inline pass distinguishes:
    // it throws the same error for a genuinely-bad file, and succeeds when only the worker died.
    return parseStudioBuffer(await file.arrayBuffer())
  }
}

/** .studio/.trace text → bundle, off-thread when possible. */
export async function parseTraceOffThread(text: string): Promise<ExportBundle> {
  const p = call({ kind: 'parseTrace', text }, [])
  if (p) { try { return (await p) as ExportBundle } catch { /* fall through to inline */ } }
  return parseTraceFile(text)
}

/** OPFS write via the worker's sync access handle — the ONLY write path iOS Safari allows.
 *  No inline fallback: callers (storage/opfsWrite.ts) only come here when createWritable is absent. */
export async function opfsWriteOffThread(path: string[], bytes: Uint8Array): Promise<void> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const p = call({ kind: 'opfsWrite', path, bytes: buf }, [buf])
  if (!p) throw new Error('OPFS write unavailable (no worker and no createWritable)')
  await p
}
