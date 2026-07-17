// ─── The Piece store, and the fork it retires ────────────────────────────────
//
// This is a DATA-MOVING path: it lifts a Piece out of the parallel container `music/store.ts` used
// to write and into its document, then deletes the original. A migration with no test is how the
// parallel container got here in the first place.
//
// The claims that matter are the ones that lose work if they are wrong:
//   · a failed READ must never read as "absent" and mint an empty document over a real one
//   · the migration must never clobber a live Piece with a stale legacy copy
//   · it must be idempotent, because it runs on every open
//
// HARNESS NOTE (CLAUDE.md, the prod-integrate trap, verbatim): `storage/opfsWrite.ts` decides ONCE
// AT MODULE LOAD whether writes use createWritable or the parse worker, and node has neither. Under
// STATIC imports that constant is already false before any beforeEach can install a shim, so every
// write routes to a worker that does not exist and is swallowed — the test then reads an empty store
// and "proves" the exact fiction it exists to detect. Install the shim, THEN `await import()`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import type { Piece } from './types'

const ID = 'piece-1'

function aPiece(over: Partial<Piece> = {}): Piece {
  return {
    id: ID,
    title: 'Nocturne',
    schema_version: '0.1.0',
    created_at: '2026-07-17T10:00:00.000+10:00',
    updated_at: '2026-07-17T10:00:00.000+10:00',
    source: { type: 'photo', captured_via: 'image' },
    pages: [],
    reference_tracks: [],
    annotations: [],
    heatmap: [],
    lesson_notes: [],
    assignments: [],
    recordings: [],
    practice: { tasks: [], sessions: [], schedule: { planned: {}, shared_with_teacher: false } },
    provenance: { hashes: {}, ots_anchors: [] },
    ...over,
  }
}

async function freshModules() {
  vi.resetModules()
  installOpfsShim()
  return {
    store: await import('./store'),
    opfs: await import('../storage/opfs'),
    write: await import('../storage/opfsWrite'),
  }
}

beforeEach(() => { vi.resetModules(); resetOpfsShim() })

// ─── A Piece IS a document ───────────────────────────────────────────────────

describe('savePiece / loadPiece go through the DOCUMENT store', () => {
  it('round-trips a Piece', async () => {
    const { store } = await freshModules()
    await store.savePiece(aPiece())
    expect((await store.loadPiece(ID))?.title).toBe('Nocturne')
  })

  it('writes a real document — docType music, and the Piece on it', async () => {
    // The whole point of the migration: it must land in `documents/<id>/current.json`, where edit
    // history, provenance hashing and sync can see it — not in a private container beside them.
    const { store, opfs } = await freshModules()
    await store.savePiece(aPiece())
    const read = await opfs.readDocument(ID)
    expect(read.kind).toBe('found')
    if (read.kind !== 'found') return
    expect(read.doc.docType).toBe('music')
    expect(read.doc.piece?.id).toBe(ID)
    expect(read.doc.id).toBe(ID)          // piece.id === doc.id — one identity
    expect(read.doc.title).toBe('Nocturne')
  })

  it('preserves the document when a Piece is re-saved — never a fresh one', async () => {
    const { store, opfs } = await freshModules()
    await store.savePiece(aPiece())
    const before = await opfs.readDocument(ID)
    if (before.kind !== 'found') throw new Error('setup')
    // Something else on the document (prose the student wrote about the piece — §A6).
    await opfs.saveDocument({ ...before.doc, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my notes' }] }] } })

    await store.savePiece(aPiece({ title: 'Nocturne, revised' }))
    const after = await opfs.readDocument(ID)
    if (after.kind !== 'found') throw new Error('reread')
    expect(after.doc.piece?.title).toBe('Nocturne, revised')
    expect(JSON.stringify(after.doc.contentJson)).toContain('my notes')   // NOT clobbered
  })

  it('loadPiece returns null for a document that is not a Piece', async () => {
    const { store, opfs } = await freshModules()
    await opfs.saveDocument({
      id: 'essay-1', title: 'An essay', contentJson: { type: 'doc', content: [] },
      createdAt: 'x', updatedAt: 'x', schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: 's',
      docType: 'essay',
    })
    expect(await store.loadPiece('essay-1')).toBeNull()
  })

  it('loadPiece returns null when the document is genuinely absent', async () => {
    const { store } = await freshModules()
    expect(await store.loadPiece('never-existed')).toBeNull()
  })
})

// ─── Absence vs ignorance — the rule DocRead exists for ──────────────────────

describe('a failed read is NOT an absent one', () => {
  it('KNOWN-NEGATIVE: savePiece REFUSES to write when it could not read the target', async () => {
    // THE BUG THIS PINS, and it was live in the first version of savePiece: it read
    // `loadDocument(id) ?? newPieceDocument()`, so an ERRORED read collapsed to "absent", minted a
    // fresh empty document and blind-overwrote the student's real Piece. Eleven characters.
    const { store } = await freshModules()
    await store.savePiece(aPiece({ title: 'The real one' }))

    // Now make the READ fail (a private window / quota fault / transient OPFS failure).
    const dir = await navigator.storage.getDirectory()
    const spy = vi.spyOn(navigator.storage, 'getDirectory').mockRejectedValue(new Error('opfs is angry'))

    await expect(store.savePiece(aPiece({ title: 'The replacement' }))).rejects.toThrow()

    // …and the real Piece is untouched.
    spy.mockRestore()
    void dir
    expect((await store.loadPiece(ID))?.title).toBe('The real one')
  })

  it('KNOWN-NEGATIVE: loadPiece THROWS on a failed read rather than reporting "no piece"', async () => {
    // If a read error read as null, the studio would open an EMPTY piece over a real one and the
    // student would annotate into the replacement. Absence and ignorance are different answers.
    const { store } = await freshModules()
    await store.savePiece(aPiece())
    const spy = vi.spyOn(navigator.storage, 'getDirectory').mockRejectedValue(new Error('opfs is angry'))
    await expect(store.loadPiece(ID)).rejects.toThrow()
    spy.mockRestore()
    expect(await store.loadPiece(ID)).not.toBeNull()   // the mock really was the only reason
  })
})

// ─── The legacy migration ────────────────────────────────────────────────────

describe('migrating out of the parallel container', () => {
  /** Write a Piece where the OLD store used to put it. */
  async function writeLegacy(id: string, piece: Piece) {
    const { write } = await freshModules()
    await write.writeOpfsFile(['music', id, 'piece.json'], JSON.stringify(piece))
  }

  it('lifts a legacy Piece onto its document and deletes the original', async () => {
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    await write.writeOpfsFile(['music', ID, 'piece.json'], JSON.stringify(aPiece({ title: 'Old home' })))
    const store = await import('./store')

    expect(await store.legacyPieceIds()).toEqual([ID])
    expect(await store.migrateLegacyPiece(ID)).toBe(true)

    expect((await store.loadPiece(ID))?.title).toBe('Old home')   // it arrived
    expect(await store.legacyPieceIds()).toEqual([])              // and the original is gone
  })

  it('is idempotent — it runs on every open and must do nothing once empty', async () => {
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    await write.writeOpfsFile(['music', ID, 'piece.json'], JSON.stringify(aPiece()))
    const store = await import('./store')

    expect(await store.migrateLegacyPieces()).toEqual([ID])
    expect(await store.migrateLegacyPieces()).toEqual([])   // second run: nothing to do
    expect(await store.migrateLegacyPieces()).toEqual([])
  })

  it('NEVER clobbers a live Piece with a stale legacy copy', async () => {
    // The 2026-07-05 truncation incident's shape. The document's copy is what every write since has
    // gone to; the legacy file can only be older.
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    const store = await import('./store')

    await store.savePiece(aPiece({ title: 'Live, edited today' }))
    await write.writeOpfsFile(['music', ID, 'piece.json'], JSON.stringify(aPiece({ title: 'Stale from last week' })))

    expect(await store.migrateLegacyPiece(ID)).toBe(false)
    expect((await store.loadPiece(ID))?.title).toBe('Live, edited today')
    expect(await store.legacyPieceIds()).toEqual([])   // the stale copy is dropped, not applied
  })

  it('survives a corrupt legacy file rather than throwing on open', async () => {
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    await write.writeOpfsFile(['music', ID, 'piece.json'], '{ not json')
    const store = await import('./store')
    expect(await store.migrateLegacyPiece(ID)).toBe(false)
    expect(await store.legacyPieceIds()).toEqual([])
  })

  it('leaves the legacy file ALONE when the document read fails', async () => {
    // Deleting it would destroy the only copy we have while being unable to confirm the other exists.
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    await write.writeOpfsFile(['music', ID, 'piece.json'], JSON.stringify(aPiece()))
    const store = await import('./store')

    const real = navigator.storage.getDirectory.bind(navigator.storage)
    let calls = 0
    const spy = vi.spyOn(navigator.storage, 'getDirectory').mockImplementation(async () => {
      // Call 1 is the LEGACY read (it must succeed — there has to be something to migrate).
      // Everything after it fails: the document read cannot find out what is there.
      calls++
      if (calls > 1) throw new Error('opfs is angry')
      return real()
    })
    expect(await store.migrateLegacyPiece(ID)).toBe(false)
    spy.mockRestore()
    expect(await store.legacyPieceIds()).toEqual([ID])   // still there — nothing was destroyed
  })

  it('keeps the legacy file when the WRITE fails — the only copy is not deleted on a guess', async () => {
    // Traced rather than assumed: `migrateLegacyPiece` awaits `savePiece` BEFORE `removeFile`, so a
    // failed write propagates and the delete never runs. That ordering is the whole safety property
    // — swap the two lines and a failed migration destroys the only copy of the Piece.
    installOpfsShim()
    const write = await import('../storage/opfsWrite')
    await write.writeOpfsFile(['music', ID, 'piece.json'], JSON.stringify(aPiece()))
    const store = await import('./store')

    const real = navigator.storage.getDirectory.bind(navigator.storage)
    let calls = 0
    const spy = vi.spyOn(navigator.storage, 'getDirectory').mockImplementation(async () => {
      calls++
      if (calls > 2) throw new Error('opfs is angry')   // legacy read + doc read ok; the WRITE fails
      return real()
    })
    await expect(store.migrateLegacyPiece(ID)).rejects.toThrow()
    spy.mockRestore()
    expect(await store.legacyPieceIds()).toEqual([ID])   // the only copy survives
  })

  void writeLegacy
})
