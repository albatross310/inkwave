// THE ARCHIVE MUST NOT SHRINK BECAUSE ANOTHER TAB GREW IT.
//
// Peter, 2026-08-20 (live, Chrome/macOS): his Honours Proposal showed all 79 snapshots after a
// refresh, he scrubbed through them for a while, and the count fell back to 4 — with /snapshot then
// answering "That snapshot isn't on this device" about history that had been there minutes earlier.
//
// THE MECHANISM THIS FILE PINS. `_snapCache` is module state, so it is PER TAB, and snapshots.ts
// documents it as "the in-session authority" — every read goes through it and every write writes it
// through. That is sound within one tab. Across two it is not: a tab that loaded while the archive
// held 4 keeps `cache = 4` for its whole life. If another tab (or a re-open that restores a bundle)
// then grows the archive on DISK to 79, the first tab never learns. Its next write — a new snapshot,
// a sync, a folder mirror — unions against its own stale 4 and writes that over the 79.
//
// The existing grow-only guard does not catch this: `mergeSnapshots` protects against a SHORT READ,
// and this read is not short, it is STALE — it succeeds and returns a confidently wrong answer. That
// is the same shape as the 2026-07-15 and archiveReadFail bugs one level up: not "I could not read
// it" vs "there is nothing there", but "what I read is current" vs "what I read is old".
//
// TWO DIRECTIONS, deliberately, for the reason archiveReadFail.test.ts spells out — a guard tested
// only in the loss direction is one edit away from being an outage (an archive that can never be
// written at all is also a broken provenance spine).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, Uint8Array>()

function fileHandle(path: string) {
  return {
    async getFile() {
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
      if (!files.has(path) && !opts?.create) { const e = new Error('no such file'); e.name = 'NotFoundError'; throw e }
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
vi.mock('./ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

beforeEach(() => { files.clear(); vi.resetModules() })

const docOf = (text: string) => ({
  id: 'doc-1', title: 't', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
}) as never

/**
 * A fresh module instance = A FRESH TAB. `vi.resetModules()` gives the next import its own module
 * registry (its own `_snapCache`), while the `files` map above persists — exactly the real shape:
 * separate in-memory caches over one shared disk. Holding a reference to the earlier import keeps
 * that "tab" alive and usable afterwards, which is what lets the interleaving below be written at all.
 */
const openTab = async () => { vi.resetModules(); return await import('./snapshots') }

describe('a stale per-tab cache must not overwrite an archive another tab grew', () => {
  it('KNOWN-POSITIVE: the harness really does model two tabs over one disk', async () => {
    const tabA = await openTab()
    await tabA.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    expect((await tabA.listSnapshots('doc-1')).length).toBe(1)

    const tabB = await openTab() // separate cache, same `files`
    expect((await tabB.listSnapshots('doc-1')).length).toBe(1) // B reads A's write off disk
  })

  it('THE LOSS DIRECTION: tab A writing after tab B grew the archive keeps every snapshot', async () => {
    // Tab A opens and takes one snapshot. Its cache now holds exactly that one.
    const tabA = await openTab()
    await tabA.createSnapshotIfChanged(docOf('one'), 'manual', [], undefined, true)
    expect((await tabA.listSnapshots('doc-1')).length).toBe(1)

    // Tab B opens (fresh cache), reads the archive off disk, and grows it — the real-world analogue
    // is re-opening the .studio and restoring its history, or simply writing in the other window.
    const tabB = await openTab()
    await tabB.createSnapshotIfChanged(docOf('two'), 'manual', [], undefined, true)
    await tabB.createSnapshotIfChanged(docOf('three'), 'manual', [], undefined, true)
    await tabB.createSnapshotIfChanged(docOf('four'), 'manual', [], undefined, true)
    expect((await tabB.listSnapshots('doc-1')).length).toBe(4) // disk holds four

    // Tab A is still open and still believes the archive has one snapshot. It takes another.
    // Its union is computed against its OWN stale view, so without a disk-side merge this write
    // lands 2 snapshots over the 4 that are there — Peter's 79 → 4.
    await tabA.createSnapshotIfChanged(docOf('five'), 'manual', [], undefined, true)

    // Read from a THIRD tab so the assertion sees DISK, not either writer's cache.
    const auditor = await openTab()
    const onDisk = await auditor.listSnapshots('doc-1')
    expect(onDisk.length).toBe(5) // four from B + one from A — nothing dropped
  })

  it('THE OUTAGE DIRECTION: a brand-new document can still take its first snapshot', async () => {
    const tab = await openTab()
    await tab.createSnapshotIfChanged(docOf('first'), 'manual', [], undefined, true)
    expect((await tab.listSnapshots('doc-1')).length).toBe(1)
  })
})
