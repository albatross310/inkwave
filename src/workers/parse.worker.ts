// Off-main-thread heavy parsing. A thesis-scale snapshot archive or .studio file is ~1s of
// unbreakable gunzip + JSON.parse — enough to freeze typing/scroll whenever it runs on the main
// thread (the post-load "lags in the first seconds" report). Here the main thread pays only the
// structured-clone of the parsed result.

import { parseTraceFile } from '../provenance/traceParse'

type Req =
  | { id: number; kind: 'gunzipJson'; buf: ArrayBuffer }
  | { id: number; kind: 'parseTrace'; text: string }
type Res = { id: number; ok?: unknown; err?: string }

async function gunzipJson(buf: ArrayBuffer): Promise<unknown> {
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter()
  void w.write(buf)
  void w.close()
  return JSON.parse(await new Response(ds.readable).text())
}

self.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data
  void (async () => {
    try {
      const ok = m.kind === 'gunzipJson' ? await gunzipJson(m.buf) : parseTraceFile(m.text)
      ;(self as unknown as Worker).postMessage({ id: m.id, ok } satisfies Res)
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ id: m.id, err: String((err as Error)?.message ?? err) } satisfies Res)
    }
  })()
}
