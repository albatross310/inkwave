// @vitest-environment jsdom
//
// THE LOCAL-READ HALF OF THE CLOUD WRITE-BACK — "can a failed LOCAL read still push a short archive
// at OneDrive/Drive?" BLAST RADIUS: LIVE on master, no flag, Peter's real thesis.
//
// ─── THE CLAIM UNDER TEST, VERBATIM ───────────────────────────────────────────────────────────────
// > `syncToOneDrive` takes the array it is handed and never re-reads, so `oneDriveWriteNow`'s
// > local-read check in `TiptapEditor.tsx` IS load-bearing.
//
// The first half is TRUE and is pinned below: `syncToOneDrive(doc, snapshots)` writes what it is
// given. The remote half is guarded by `planWriteback` (pure, tested) — but `planWriteback` unions
// the remote with the LOCAL ARRAY IT WAS HANDED, and a union with a lie is still a lie. Nothing
// inside storage/ can tell a short-because-new local set from a short-because-broken one. So the
// question is entirely about the CALLER.
//
// ─── WHAT THIS FILE IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────
// It drives the REAL `readSnapshotArchive` (through a REAL faulting OPFS shim, the REAL gzip write
// chain, the REAL write-through cache) into the REAL `syncToOneDrive`, composed EXACTLY as
// TiptapEditor.tsx composes them — and it drives the PRE-FIX composition the same way, in the same
// build, to see what each does with the same fault.
//
// ⚠ IT IS A MODEL OF THE CALL SITE, NOT THE CALL SITE. It cannot fail if someone deletes
// `oneDriveWriteNow`'s guard tomorrow — no test in this repo renders TiptapEditor. That is stated
// here rather than left for a reader to discover, because a cell that quietly certifies a line it
// cannot reach is the exact trap this lane was warned about. What it CAN establish is the thing the
// claim actually turns on: WHICH line refuses, and what happens if you take each one away.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InkwaveDocument, Snapshot } from '../types/document'

// ── A real-enough OPFS whose archive read can be made to fail the way a transient fault does.
// The same shim shape as archiveReadFail.test.ts — the fault is INJECTED at the handle, and the
// SEAM decides what to make of it. Fault and seam are different things and this needs both.
let failArchiveRead = false
const files = new Map<string, Uint8Array>()

function fileHandle(path: string) {
  return {
    async getFile() {
      if (failArchiveRead && path.endsWith('snapshots.json')) throw new Error('OPFS read failed (transient I/O)')
      const b = files.get(path)
      if (!b) { const e = new Error('no such file'); e.name = 'NotFoundError'; throw e }
      return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), size: b.byteLength }
    },
  }
}
function dirHandle(prefix: string) {
  const self: Record<string, unknown> = {
    async getDirectoryHandle(name: string) { return dirHandle(`${prefix}${name}/`) },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const path = `${prefix}${name}`
      if (!files.has(path) && !opts?.create && !(failArchiveRead && name === 'snapshots.json')) {
        const e = new Error('no such file'); e.name = 'NotFoundError'; throw e
      }
      return fileHandle(path)
    },
  }
  return self as unknown as FileSystemDirectoryHandle
}
vi.stubGlobal('navigator', { storage: { getDirectory: async () => dirHandle(''), persist: async () => true } })
vi.mock('../storage/opfsWrite', () => ({
  writeOpfsFile: async (parts: string[], data: Uint8Array | string) => {
    files.set(parts.join('/'), typeof data === 'string' ? new TextEncoder().encode(data) : data)
  },
}))
vi.mock('../provenance/ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

// MSAL: the one thing a Microsoft account would supply. Everything past the token is real code.
vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    async initialize() {}
    async handleRedirectPromise() {}
    getAllAccounts() { return [{ username: 'peter@example.com' }] }
    async acquireTokenSilent() { return { accessToken: 'test-access-token' } }
    async loginRedirect() {}
  },
}))

// ── The wire ──────────────────────────────────────────────────────────────────
let calls: { url: string; method: string; body: string | null }[] = []
const isRead = (u: string, m: string) => m === 'GET' && u.includes('/content')
function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url); const method = init?.method ?? 'GET'
  calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null })
  // The REMOTE is healthy and holds the full archive. This is the point: the ONLY thing wrong in
  // these cells is the LOCAL read, so anything that reaches the wire is the local read's doing.
  if (isRead(u, method)) return Promise.resolve(new Response(remoteBody, { status: 200 }))
  return Promise.resolve(new Response('{}', { status: 200 }))
}
let remoteBody = ''
const puts = () => calls.filter((c) => c.method === 'PUT')

async function putSnapshotIds(): Promise<string[]> {
  const body = puts()[0]?.body
  if (!body) return []
  const { parseTraceFile } = await import('../provenance/traceParse')
  return ((parseTraceFile(body).snapshots ?? []) as Snapshot[]).map((s) => s.id)
}

const docOf = (text: string): InkwaveDocument => ({
  id: 'doc-1', title: 't', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
}) as never

beforeEach(() => {
  failArchiveRead = false
  files.clear()
  calls = []
  localStorage.clear()
  sessionStorage.clear()
  vi.resetModules()
  vi.stubGlobal('fetch', fakeFetch)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

/** Build a real 3-snapshot archive in the shim OPFS, and a matching healthy remote. */
async function seedArchive(): Promise<string[]> {
  const { createSnapshotIfChanged, listSnapshots, _resetSnapCache } = await import('../provenance/snapshots')
  _resetSnapCache()
  for (const t of ['one', 'two', 'three']) await createSnapshotIfChanged(docOf(t), 'manual', [], undefined, true)
  const snaps = await listSnapshots('doc-1')
  const { buildExportBundle, composeTraceFile } = await import('../provenance/bundle')
  remoteBody = composeTraceFile(buildExportBundle(docOf('three'), snaps))
  return snaps.map((s) => s.id)
}

describe('syncToOneDrive writes WHAT IT IS HANDED — the premise the whole claim rests on', () => {
  it('never re-reads the local archive: hand it one snapshot and one snapshot is what unions', async () => {
    const ids = await seedArchive()
    expect(ids).toHaveLength(3)
    const { syncToOneDrive } = await import('./onedrive')
    const { listSnapshots } = await import('../provenance/snapshots')
    const all = await listSnapshots('doc-1')

    // Hand it a deliberately SHORT set while the local archive holds three. It unions with the
    // REMOTE (grow-only, so nothing is lost here) but it never once consults the local archive —
    // which is why the caller's read is the only thing that can hand it a lie.
    const r = await syncToOneDrive(docOf('three'), [all[0]])
    expect(r.ok).toBe(true)
    expect(calls.filter((c) => isRead(c.url, c.method))).toHaveLength(1) // the REMOTE read, not a local one
  })
})

describe('THE VECTOR: a failed LOCAL read must never reach the wire', () => {
  // THE GUARDED COMPOSITION — exactly TiptapEditor.tsx's `oneDriveWriteNow`:
  //   readSnapshotArchive(id).then(r => { if (r.kind === 'error') return; syncToOneDrive(doc, r.snapshots) })
  it('the GUARDED composition (oneDriveWriteNow) refuses: nothing reaches the wire', async () => {
    await seedArchive()
    vi.resetModules() // a new session ⇒ empty write-through cache ⇒ this really hits the disk
    failArchiveRead = true
    calls = []
    const { readSnapshotArchive } = await import('../provenance/snapshots')
    const { syncToOneDrive } = await import('./onedrive')

    const r = await readSnapshotArchive('doc-1')
    expect(r.kind).toBe('error') // the union makes the failure a value the caller has to look at
    if (r.kind === 'error') { /* the guard's `return` */ } else await syncToOneDrive(docOf('three'), r.snapshots)
    expect(puts()).toHaveLength(0)
  })

  // ⚠ THE RESULT THIS LANE WAS SENT TO GET, AND IT IS NOT THE EXPECTED ONE.
  //
  // Restore the PRE-FIX composition — no union, no `kind === 'error'` check, the shape that shipped
  // before today: `listSnapshots(id).then(snaps => syncToOneDrive(doc, snaps)).catch(() => {})`.
  // It ALSO refuses. Not because of anything in TiptapEditor.tsx — because `listSnapshots` now
  // THROWS on a failed read (`readSnapshotsFromDisk`'s `catch { return [] }` is gone), and the
  // fire-and-forget `.catch` that was there all along swallows the throw before the sync is called.
  //
  // SO THE CLAIM IS OVERSTATED. `oneDriveWriteNow`'s local-read check is NOT what stands between a
  // failed local read and Peter's archive; the ARCHIVE READ'S OWN THROW is (mutation-proved: M13
  // restores `catch { return [] }` and cells die). The check is defence in depth and worth keeping —
  // it is what makes the refusal VISIBLE (a `console.warn` naming the fault, versus a swallowed
  // rejection), and it is what stops the next `.catch(() => [])` walking the bug back in. But a
  // guard whose removal changes no behaviour must be described as what it is, or the next lane
  // trusts a line that is not holding the weight.
  it('the PRE-FIX composition ALSO refuses — the archive read throws, so the outer guard survives its own mutant honestly', async () => {
    await seedArchive()
    vi.resetModules()
    failArchiveRead = true
    calls = []
    const { listSnapshots } = await import('../provenance/snapshots')
    const { syncToOneDrive } = await import('./onedrive')

    let reached = false
    await listSnapshots('doc-1')
      .then((snaps) => { reached = true; return syncToOneDrive(docOf('three'), snaps) })
      .catch(() => { /* the pre-fix fire-and-forget swallow */ })

    expect(reached).toBe(false) // syncToOneDrive was never called at all
    expect(puts()).toHaveLength(0)
  })

  // ⚠ FOUND BY THE CELL BELOW BEFORE IT WAS WRITTEN — the known-negative leaked it. `syncToOneDrive`
  // ends with a best-effort OPFS heal, and it was `void restoreSnapshotsFromBundle(doc.id, merged)`.
  // That function READS the local archive, and that read THROWS now (it used to lie `[]`) — so the
  // `void` was an unhandled rejection escaping a fire-and-forget shortcut, fired precisely when
  // storage is already faulting. In a browser that is an uncaught error, not a log line.
  //
  // AN UNHANDLED REJECTION IS INVISIBLE TO A NORMAL ASSERTION — the sync returns ok:true and every
  // other expectation passes — so it is pinned by LISTENING, or it is not pinned at all.
  it('the post-sync heal HANDLES its rejection — a `void`ed promise that can reject is an uncaught error', async () => {
    const ids = await seedArchive()
    vi.resetModules()
    const rejections: unknown[] = []
    const onRejection = (e: unknown) => rejections.push(e)
    process.on('unhandledRejection', onRejection)
    try {
      failArchiveRead = true // the heal's own read of the local archive will throw
      calls = []
      const { listSnapshots } = await import('../provenance/snapshots')
      const { syncToOneDrive } = await import('./onedrive')

      // merged (3, from the healthy remote) > snapshots (0) ⇒ the heal fires ⇒ it reads ⇒ it throws.
      const snaps = await listSnapshots('doc-1').catch(() => [] as Snapshot[])
      const r = await syncToOneDrive(docOf('three'), snaps)
      expect(r.ok).toBe(true) // the sync itself succeeded — which is exactly why this hides
      expect((await putSnapshotIds()).sort()).toEqual([...ids].sort())

      await new Promise((res) => setTimeout(res, 50)) // let the heal settle and any rejection fire
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  // THE ONE COMPOSITION THAT STILL LOSES THE ARCHIVE, and it is the reason the union exists at all.
  // `.catch(() => [])` — a caller "helpfully" defaulting the failure to an empty history. This is
  // the 2026-07-15 shape exactly, and NOTHING downstream can catch it: storage/ cannot tell a
  // short-because-new set from a short-because-broken one, so planWriteback unions the lie and PUTs
  // it. It is pinned here as a KNOWN-NEGATIVE: it proves the harness can see the loss, which is what
  // makes the two green cells above readable.
  it('KNOWN-NEGATIVE: a caller that defaults the failure to [] DOES push a truncated archive', async () => {
    const ids = await seedArchive()
    vi.resetModules()
    failArchiveRead = true
    calls = []
    const { listSnapshots } = await import('../provenance/snapshots')
    const { syncToOneDrive } = await import('./onedrive')

    const snaps = await listSnapshots('doc-1').catch(() => [] as Snapshot[]) // ← the bug, restored
    await syncToOneDrive(docOf('three'), snaps)

    expect(puts()).toHaveLength(1) // it wrote
    // The remote's grow-only union is the ONLY reason the history survives this — and it survives
    // ONLY because the remote read happened to succeed. Had the merge gate been closed (a warm pass
    // that ran earlier this session), `merged = snapshots` = `[]` and the archive would be gone.
    expect((await putSnapshotIds()).sort()).toEqual([...ids].sort())
  })

  // ...and here is that sentence, PROBED rather than asserted: the same `.catch(() => [])` caller
  // with the merge gate already closed. This is the composition that actually destroys the archive,
  // and it is one careless `.catch` away at every call site. It is why the union type is the fix and
  // a call-site check is not.
  it('KNOWN-NEGATIVE: `.catch(() => [])` + a closed merge gate PUTS AN EMPTY ARCHIVE', async () => {
    await seedArchive()
    vi.resetModules()
    const { markWritebackMerged } = await import('../provenance/snapshots')
    markWritebackMerged('onedrive:doc-1') // an earlier warm pass this session already merged
    failArchiveRead = true
    calls = []
    const { listSnapshots } = await import('../provenance/snapshots')
    const { syncToOneDrive } = await import('./onedrive')

    const snaps = await listSnapshots('doc-1').catch(() => [] as Snapshot[])
    await syncToOneDrive(docOf('three'), snaps)

    expect(puts()).toHaveLength(1)
    expect(await putSnapshotIds()).toEqual([]) // every snapshot, every OTS proof, every receipt — gone
    expect(calls.filter((c) => isRead(c.url, c.method))).toHaveLength(0) // it never even looked
  })
})
