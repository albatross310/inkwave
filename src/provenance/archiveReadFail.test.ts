// THE GUARD — a failed read of snapshots.json must never destroy the provenance archive.
//
// ⚠ THIS FILE WAS THE REPRODUCTION AND IS NOW THE KEEPER. It began as an `it.fails` tripwire
// asserting the bug was still live, on the promise that "the moment anyone fixes the archive read
// THIS TEST GOES RED — which is the signal to delete the `.fails` and keep the assertion as the
// guard it was always meant to be". THE TRIPWIRE DID NOT KEEP THAT PROMISE, and the reason is worth
// recording because it is the same class of defect as the bug it was watching:
//
//   `it.fails` passes when the test fails FOR ANY REASON. After the fix, this test still failed —
//   but at the intermediate `expect(listSnapshots(...).length).toBe(0)` line, which now REJECTS
//   with StorageReadError instead of returning the lie. So the tripwire went on passing and would
//   have reported "bug still live" forever. A negative that cannot distinguish its own causes is
//   the house disease in the TEST: an assertion that answers the same thing whatever happened.
//   (PROBED: with the fix in place the old file was still green.)
//
// THE BUG IT PINS. `readSnapshotsFromDisk` ended `catch { return [] }` — so a transient OPFS
// failure, a corrupt gzip, or a worker fault answered "this document has no history".
// `createSnapshotIfChanged` then did:
//
//     const snaps = await readSnapshotsFile(doc.id)          // ← [] on ANY failure
//     await writeSnapshotsFile(doc.id, [...snaps, snapshot]) // ← writes ONE snapshot over the archive
//
// The document's whole Bitcoin-anchored history — every OTS proof, every signed receipt — replaced
// by a single snapshot. No race required; one failed read did it. This is the 2026-07-15 shape
// (`catch { return null }` making "I could not read it" and "there is nothing there" the same
// answer) applied to the provenance spine itself.
//
// The legitimate `[]` — a brand-new document that has no snapshots.json — arrives as an error named
// NotFoundError, which `storage/notFound.ts` already distinguishes. That is the whole fix:
// NotFoundError ⇒ [], everything else ⇒ throw, and the write paths refuse.
//
// BOTH DIRECTIONS ARE PINNED HERE, deliberately. The loss direction (a failed read truncating the
// archive) and the OUTAGE direction (the guard clamped shut, so a new document can never take its
// first snapshot and provenance is silently off) are both failures, and a guard tested in only one
// direction is one edit away from being the other bug. See the `it`s named THE OUTAGE DIRECTION.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// A real-enough OPFS whose archive read can be made to fail the way a transient fault does.
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
// Writes land in our map; this is the path createSnapshotIfChanged uses.
vi.mock('../storage/opfsWrite', () => ({
  writeOpfsFile: async (parts: string[], data: Uint8Array | string) => {
    files.set(parts.join('/'), typeof data === 'string' ? new TextEncoder().encode(data) : data)
  },
}))
vi.mock('./ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

beforeEach(() => { failArchiveRead = false; files.clear(); vi.resetModules() })

const docOf = (text: string) => ({
  id: 'doc-1', title: 't', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
}) as never

const load = async () => await import('./snapshots')

describe('the archive read tells an empty history from a failed one', () => {
  it('the archive survives a HEALTHY read (the known-positive — the harness can build history)', async () => {
    const { createSnapshotIfChanged, listSnapshots, _resetSnapCache } = await load()
    _resetSnapCache()
    await createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    await createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)
    expect((await listSnapshots('doc-1')).length).toBe(2) // history accrues
  })

  it('a failed read REFUSES — it never answers "this document has no history"', async () => {
    const m = await load()
    await m.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    expect((await m.listSnapshots('doc-1')).length).toBe(1)

    vi.resetModules() // a new session ⇒ empty write-through cache ⇒ this really hits the disk
    failArchiveRead = true
    const m2 = await load()
    // THE LIE THAT WAS: `[]`. Now it throws, and StorageReadError is the SAME type the document
    // body's read throws — one concept, one name, one thing to grep for.
    await expect(m2.listSnapshots('doc-1')).rejects.toThrow(/Could not read documents\/doc-1\/snapshots\.json/)
    // The union wrapper answers the same failure without throwing, for callers that must branch.
    const r = await m2.readSnapshotArchive('doc-1')
    expect(r.kind).toBe('error')
  })

  it('THE GUARD: a snapshot taken while the archive is unreadable never truncates it', async () => {
    const m = await load()
    await m.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    await m.createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)
    expect((await m.listSnapshots('doc-1')).length).toBe(2)

    vi.resetModules()
    failArchiveRead = true
    const m2 = await load()
    // THE WRITE PATH REFUSES. On master this wrote [] + itself, leaving ONE snapshot on disk.
    await expect(m2.createSnapshotIfChanged(docOf('three'), 'manual', [], undefined, true)).rejects.toThrow(/Could not read/)

    failArchiveRead = false
    vi.resetModules()
    const m3 = await load()
    // Grow-only held THROUGH the fault: both real snapshots are still there.
    expect((await m3.listSnapshots('doc-1')).length).toBe(2)
  })

  it('the failed read is NOT CACHED — the lie cannot outlive the fault', async () => {
    const m = await load()
    await m.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    await m.createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)

    vi.resetModules()
    failArchiveRead = true
    const m2 = await load()
    await expect(m2.listSnapshots('doc-1')).rejects.toThrow()

    // The fault passes. The SAME module instance must now see the real archive: when the cache held
    // `[]` from the failed read, this read still said "no history" for the rest of the session — and
    // the next snapshot wrote that lie to disk. (Caching the REJECTION would fail here too: it would
    // mean one blip disables provenance until reload. Both mistakes die on this assertion.)
    failArchiveRead = false
    expect((await m2.listSnapshots('doc-1')).length).toBe(2)

    // ...and a snapshot taken after recovery APPENDS to the real archive rather than replacing it.
    await m2.createSnapshotIfChanged(docOf('three'), 'manual', [], undefined, true)
    vi.resetModules()
    expect((await (await load()).listSnapshots('doc-1')).length).toBe(3)
  })

  // ── THE OUTAGE DIRECTION ────────────────────────────────────────────────────
  // Everything above pins the loss direction. These pin the opposite failure: a guard clamped shut
  // is not "safe", it is provenance silently switched off — and on a NEW document it would mean the
  // first snapshot could never be written, forever. An empty archive on a new document is an
  // ESTABLISHED emptiness; a failed read is not. The predicate that separates them is the fix.

  it('THE OUTAGE DIRECTION: a NEW document (no snapshots.json) reads as empty, not as an error', async () => {
    const m = await load()
    // Nothing has ever been written for this id — getFileHandle rejects with NotFoundError.
    expect(await m.listSnapshots('brand-new-doc')).toEqual([])
    const r = await m.readSnapshotArchive('brand-new-doc')
    expect(r).toEqual({ kind: 'found', snapshots: [] })
  })

  it('THE OUTAGE DIRECTION: a new document can still take its FIRST snapshot', async () => {
    const m = await load()
    const first = await m.createSnapshotIfChanged(docOf('first words'), 'manual', [], undefined, true)
    expect(first).not.toBeNull() // a refusal here would make first-save impossible forever
    expect((await m.listSnapshots('doc-1')).length).toBe(1)
  })

  it('a CORRUPT archive is a failure, not an emptiness (it must not be written over)', async () => {
    const m = await load()
    await m.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    // Replace the archive with bytes that are neither gzip nor an array — the shape a partial write
    // or a half-synced file leaves behind. `if (!Array.isArray(parsed)) return []` used to invite
    // the next snapshot to overwrite exactly this.
    files.set('documents/doc-1/snapshots.json', new TextEncoder().encode('{"not":"an array"}'))
    vi.resetModules()
    const m2 = await load()
    await expect(m2.listSnapshots('doc-1')).rejects.toThrow(/Could not read/)
    await expect(m2.createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)).rejects.toThrow()
    // The corrupt bytes are still on disk — recoverable, not replaced.
    expect(new TextDecoder().decode(files.get('documents/doc-1/snapshots.json')!)).toBe('{"not":"an array"}')
  })

  it('a CORRUPT GZIP is a failure, not an emptiness', async () => {
    // The named failure mode from the brief, reached through the REAL codec: vitest has no Worker,
    // so gunzipJsonOffThread degrades to inlineGunzipJson and this is a genuine DecompressionStream
    // round-trip rather than a stub. Gzip magic bytes + garbage is the shape a truncated or
    // half-synced archive actually has on disk — and it used to read as "no history".
    const m = await load()
    await m.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 9, 9, 9, 9, 9, 9, 9, 9])
    files.set('documents/doc-1/snapshots.json', corrupt)
    vi.resetModules()
    const m2 = await load()
    await expect(m2.listSnapshots('doc-1')).rejects.toThrow(/Could not read/)
    await expect(m2.createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)).rejects.toThrow()
    expect(files.get('documents/doc-1/snapshots.json'), 'the bytes stay on disk, recoverable').toEqual(corrupt)
  })

  it('a LEGACY uncompressed archive still reads, and legacy "kick" still normalises', async () => {
    const m = await load()
    // Backward compat: a real user's old plain-UTF-8 archive must not become an "error".
    const legacy = [{ id: 's1', documentId: 'doc-1', createdAt: '2026-07-01T00:00:00Z', trigger: 'kick',
      contentHash: 'h', bundleHash: 'b', ots: { status: 'unstamped' }, contentJson: { type: 'doc', content: [] } }]
    files.set('documents/doc-1/snapshots.json', new TextEncoder().encode(JSON.stringify(legacy)))
    vi.resetModules()
    const snaps = await (await load()).listSnapshots('doc-1')
    expect(snaps.length).toBe(1)
    expect(snaps[0].trigger).toBe('word-nudge')
    void m
  })
})
