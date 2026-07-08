// Off-main-thread heavy parsing. A thesis-scale snapshot archive or .studio file is ~1s of
// unbreakable gunzip + JSON.parse — enough to freeze typing/scroll whenever it runs on the main
// thread (the post-load "lags in the first seconds" report). Here the main thread pays only the
// structured-clone of the parsed result.

import { parseTraceFile } from '../provenance/traceParse'

type Req =
  | { id: number; kind: 'gunzipJson'; buf: ArrayBuffer }
  | { id: number; kind: 'parseTrace'; text: string }
  | { id: number; kind: 'opfsWrite'; path: string[]; bytes: ArrayBuffer }
type Res = { id: number; ok?: unknown; err?: string }

async function gunzipJson(buf: ArrayBuffer): Promise<unknown> {
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter()
  void w.write(buf)
  void w.close()
  return JSON.parse(await new Response(ds.readable).text())
}

// iOS Safari has no createWritable on OPFS handles — writes must go through a (worker-only)
// sync access handle. This op is the write path for the whole app on iPhone.
// WebKit allows ONE open sync access handle per file — concurrent writes throw. All opfsWrite ops
// serialize through this chain (a per-path map would allow more parallelism, but writes here are
// small and rare enough that a single queue is simpler and provably safe).
let writeQueue: Promise<unknown> = Promise.resolve()

async function opfsWrite(path: string[], bytes: ArrayBuffer): Promise<true> {
  const run = async () => {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const handle = await dir.getFileHandle(path[path.length - 1], { create: true })
    const access = await (handle as unknown as { createSyncAccessHandle: () => Promise<{ truncate(n: number): unknown; write(b: Uint8Array, o?: { at: number }): number; flush(): unknown; close(): unknown }> }).createSyncAccessHandle()
    try {
      // Safari ≤16.3 made truncate/flush/close ASYNC (spec made them sync in 17) — awaiting a
      // plain value is free, so await all three for compatibility. close() especially: the next
      // write's createSyncAccessHandle throws if the previous handle isn't fully closed.
      await access.truncate(0)
      access.write(new Uint8Array(bytes), { at: 0 })
      await access.flush()
    } finally {
      await access.close()
    }
  }
  const p = writeQueue.then(run, run) // keep the chain alive after a failed predecessor
  writeQueue = p.catch(() => {})
  await p
  return true
}

self.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data
  void (async () => {
    try {
      const ok = m.kind === 'gunzipJson' ? await gunzipJson(m.buf)
        : m.kind === 'opfsWrite' ? await opfsWrite(m.path, m.bytes)
        : parseTraceFile(m.text)
      ;(self as unknown as Worker).postMessage({ id: m.id, ok } satisfies Res)
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ id: m.id, err: String((err as Error)?.message ?? err) } satisfies Res)
    }
  })()
}
