// Main-thread client for parse.worker.ts — lazy singleton, promise-per-request, and a transparent
// inline fallback (node/vitest, prerender, or any environment without Worker). Callers keep plain
// async signatures; whether the parse ran off-thread is an implementation detail.

import { parseTraceFile } from '../provenance/traceParse'
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

function call(msg: { kind: 'gunzipJson'; buf: ArrayBuffer } | { kind: 'parseTrace'; text: string } | { kind: 'opfsWrite'; path: string[]; bytes: ArrayBuffer }, transfer: Transferable[]): Promise<unknown> | null {
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
  void w.write(buf)
  void w.close()
  return JSON.parse(await new Response(ds.readable).text())
}

/** gunzip + JSON.parse, off-thread when possible. The buffer is TRANSFERRED (detached). */
export async function gunzipJsonOffThread(buf: ArrayBuffer): Promise<unknown> {
  const p = call({ kind: 'gunzipJson', buf }, [buf])
  if (p) { try { return await p } catch { /* worker died mid-flight; buf is gone — rethrow below */ } }
  if (!p) return inlineGunzipJson(buf)
  throw new Error('parse worker failed')
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
