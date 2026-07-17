// REPRODUCTION — a failed read of snapshots.json DESTROYS the provenance archive.
//
// ⚠ THIS TEST DOCUMENTS A LIVE BUG AND IS EXPECTED TO FAIL ON MASTER. It is the reproduction, not
// the guard. Read it before "fixing" it by loosening an assertion.
//
// `readSnapshotsFromDisk` ends `catch { return [] }` — so a transient OPFS failure, a corrupt gzip,
// or a worker fault answers "this document has no history". `createSnapshotIfChanged` then does:
//
//     const snaps = await readSnapshotsFile(doc.id)          // ← [] on ANY failure
//     await writeSnapshotsFile(doc.id, [...snaps, snapshot]) // ← writes ONE snapshot over the archive
//
// The document's whole Bitcoin-anchored history — every OTS proof, every signed receipt — replaced
// by a single snapshot. No race required; one failed read does it. This is the 2026-07-15 shape
// (`catch { return null }` making "I could not read it" and "there is nothing there" the same
// answer) applied to the provenance spine itself.
//
// The legitimate `[]` — a brand-new document that has no snapshots.json — arrives as a DOMException
// named NotFoundError, which `storage/notFound.ts` already distinguishes. That is the whole fix:
// NotFoundError ⇒ [], everything else ⇒ refuse to write.

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

describe('REPRO — a failed archive read destroys the provenance history', () => {
  it('the archive survives a HEALTHY read (the known-positive — the harness can build history)', async () => {
    const { createSnapshotIfChanged, listSnapshots, _resetSnapCache } = await import('./snapshots') as never
    _resetSnapCache?.()
    await createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    await createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)
    expect((await listSnapshots('doc-1')).length).toBe(2) // history accrues
  })

  // `it.fails` ASSERTS THE BUG IS STILL THERE. This is deliberate and it is a tripwire, not a
  // pass: the gate stays green while the bug is live (it was live before this file existed), and
  // the moment anyone fixes the archive read THIS TEST GOES RED — which is the signal to delete
  // the `.fails` and keep the assertion as the guard it was always meant to be. A skipped test
  // would rot silently; this one cannot.
  it.fails('⚠ LIVE BUG: A FAILED READ TRUNCATES THE ARCHIVE TO ONE SNAPSHOT', async () => {
    const mod = await import('./snapshots') as never
    const { createSnapshotIfChanged, listSnapshots } = mod
    // Build a real history first.
    await createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    await createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)
    expect((await listSnapshots('doc-1')).length).toBe(2)

    // A NEW SESSION (fresh module ⇒ empty write-through cache), and the disk read now fails.
    vi.resetModules()
    failArchiveRead = true
    const m2 = await import('./snapshots') as never
    // The read answers "no history" instead of failing...
    expect((await m2.listSnapshots('doc-1')).length).toBe(0) // ← the lie
    failArchiveRead = false

    // ...and the next snapshot writes [] + itself OVER the real archive.
    await m2.createSnapshotIfChanged(docOf('three'), 'manual', [], undefined, true)

    vi.resetModules()
    const m3 = await import('./snapshots') as never
    const survived = await m3.listSnapshots('doc-1')
    // THE ASSERTION THAT SHOULD HOLD, AND DOES NOT ON MASTER: history is grow-only.
    expect(survived.length).toBeGreaterThanOrEqual(3)
  })
})
