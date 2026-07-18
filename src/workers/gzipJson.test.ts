// THE FEATURE (Peter's words): "the snapshots" / provenance checkpoints — "we should be able to make
// snapshots while continuing to type in the background". BLAST RADIUS: LIVE, no flag, on the real
// typing path of his real thesis.
//
// This pins the WRITE-side off-thread compress that gunzipJsonOffThread never had a sibling for.
// Two independent things, because they fail differently:
//   1. CORRECTNESS — gzipJsonOffThread → gunzipJsonOffThread round-trips byte-for-byte (both run
//      INLINE here: vitest has no Worker, which is the fallback path the app takes on iOS/prerender
//      too, so this is the fallback's only unit-level exercise).
//   2. DISPATCH — when a Worker IS present, gzipJsonOffThread hands the payload to the worker and
//      returns the WORKER's bytes, never the inline path's. MUTATION-PROVED below: force the inline
//      path and the dispatch assertion dies, while correctness stays green.

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('gzipJsonOffThread — the off-thread compress on the snapshot write path', () => {
  // ── CORRECTNESS (inline fallback: no Worker in node — the iOS/prerender path) ────────────────
  it('round-trips a snapshot-shaped archive byte-for-byte (compress inline, gunzip inline)', async () => {
    const { gzipJsonOffThread, gunzipJsonOffThread } = await import('./parseClient')
    // A realistic archive: several snapshots each embedding a whole document body — the O(N×doc)
    // shape whose main-thread compress was the lag.
    const archive = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, documentId: 'doc-1', createdAt: `2026-07-0${i + 1}T00:00:00Z`, trigger: 'manual',
      contentHash: 'h'.repeat(64), bundleHash: 'b'.repeat(64), ots: { status: 'unstamped' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${i}. `.repeat(200) }] }] },
      receipts: [], wordCount: 200,
    }))
    const gz = await gzipJsonOffThread(archive)
    expect(gz).toBeInstanceOf(Uint8Array)
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b]) // it is really gzip (magic bytes), not a passthrough

    // The buffer must be copied for gunzip (which TRANSFERS/detaches it).
    const back = await gunzipJsonOffThread(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength))
    expect(back).toEqual(archive)
  })

  it('round-trips an empty archive', async () => {
    const { gzipJsonOffThread, gunzipJsonOffThread } = await import('./parseClient')
    const gz = await gzipJsonOffThread([])
    const back = await gunzipJsonOffThread(gz.buffer.slice(0))
    expect(back).toEqual([])
  })

  // ── DISPATCH (a Worker IS present) ──────────────────────────────────────────────────────────
  // A fake Worker that answers gzipJson with a recognisable MARKER buffer — bytes the inline gzip
  // could NEVER produce for this payload — so the returned bytes PROVE which path ran. Every
  // postMessage is recorded to assert the payload actually crossed to the worker.
  const MARKER = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
  function installFakeWorker() {
    const posted: Array<{ kind: string; payload?: unknown; id: number }> = []
    class FakeWorker {
      onmessage: ((e: { data: { id: number; ok?: unknown; err?: string } }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(_url: unknown, _opts: unknown) { /* ignore the real worker URL */ }
      postMessage(msg: { kind: string; id: number; payload?: unknown }) {
        posted.push({ kind: msg.kind, payload: msg.payload, id: msg.id })
        if (msg.kind === 'gzipJson') {
          // Respond asynchronously, exactly as a real worker would, with the marker bytes.
          queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: MARKER.buffer.slice(0) } }))
        }
      }
      terminate() { /* no-op */ }
    }
    vi.stubGlobal('window', {})            // getWorker() bails without a window (the browser gate)
    vi.stubGlobal('Worker', FakeWorker)    // …and without a Worker constructor
    return posted
  }

  it('hands the payload to the Worker and returns the WORKER\'s bytes, not the inline path\'s', async () => {
    const posted = installFakeWorker()
    const { gzipJsonOffThread } = await import('./parseClient')

    const payload = [{ id: 's0', contentJson: { type: 'doc' } }]
    const out = await gzipJsonOffThread(payload)

    // It went off-thread: the worker received the exact payload under the gzipJson op…
    const gz = posted.find((m) => m.kind === 'gzipJson')
    expect(gz, 'the worker never received a gzipJson message — compress did NOT go off-thread').toBeTruthy()
    expect(gz!.payload).toEqual(payload)
    // …and the bytes returned are the WORKER's marker, so the inline gzip did NOT run. If
    // gzipJsonOffThread is mutated to always take the inline path, `out` becomes real gzip
    // (starting 0x1f 0x8b) and this assertion fails — that is the mutation proof.
    expect(Array.from(out)).toEqual(Array.from(MARKER))
  })

  it('the mutation control: with NO worker the inline path runs and yields real gzip (not the marker)', async () => {
    // Same call, worker absent (node default). This is the exact state a mutation to "always inline"
    // would force in the dispatch test — and here it produces gzip magic, never the marker.
    const { gzipJsonOffThread } = await import('./parseClient')
    const out = await gzipJsonOffThread([{ id: 's0', contentJson: { type: 'doc' } }])
    expect([out[0], out[1]]).toEqual([0x1f, 0x8b])
    expect(Array.from(out)).not.toEqual(Array.from(MARKER))
  })

  it('falls back inline when the Worker DIES mid-flight (payload survives — it was cloned, not transferred)', async () => {
    // A worker that rejects every request (onerror-style death). gunzipJsonOffThread cannot retry
    // because it transfers the buffer; gzipJsonOffThread can, because the payload is an object.
    class DyingWorker {
      onmessage: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      constructor() { /* */ }
      postMessage(msg: { id: number }) {
        // Fail this request the way parseClient's onerror path does.
        queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, err: 'worker exploded' } }))
      }
      terminate() { /* */ }
    }
    vi.stubGlobal('window', {})
    vi.stubGlobal('Worker', DyingWorker)
    const { gzipJsonOffThread } = await import('./parseClient')
    const payload = [{ id: 's0', contentJson: { type: 'doc' } }]
    const out = await gzipJsonOffThread(payload) // must NOT throw — retries inline
    // Real gzip from the inline retry proves the fallback ran (gunzipJsonOffThread by contrast
    // CANNOT retry after a worker death — it transfers its buffer — so it would have thrown here).
    // Content round-trip is covered by the correctness test above; this test is about survival.
    expect([out[0], out[1]]).toEqual([0x1f, 0x8b])
    expect(out.length).toBeGreaterThan(2)
  })
})
