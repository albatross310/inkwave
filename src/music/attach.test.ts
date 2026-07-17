// @vitest-environment jsdom
//
// THE PRODUCER — and the test that the §B5 gap is actually closed.
//
// §B5's anchoring shipped complete, proved, and UNREACHABLE: nothing wrote `doc.music`, so no
// document was ever v:4 and the entire path was dead in production. Every test passed, because they
// built the document themselves. The absence looked exactly like the feature being unnecessary.
//
// So the load-bearing test in this file is not the merge rules — it is `the gap is closed`: drive the
// REAL producer (`updateDocumentMusic`) into a REAL document in a REAL store, snapshot it with the
// REAL createSnapshotIfChanged, and demand the result actually be v:4 and actually verify. If the
// producer ever stops producing, that test goes red instead of everything staying green.
//
// Dynamic imports after the shim: `storage/opfsWrite.ts` decides ONCE AT MODULE LOAD whether writes
// use createWritable or the parse worker, and node has neither — a static import makes every write a
// silent no-op the test would read as "nothing was saved".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import type { MasterMeta } from './master'
import {
  EMPTY_MUSIC,
  attachExcerpt,
  attachMaster,
  detachExcerpt,
  detachMaster,
  isEmptyMusic,
  masterRef,
  musicOf,
  unusedMasters,
} from './attach'
import { makeTransclusion } from './transclusion'

const meta = (over: Partial<MasterMeta> = {}): MasterMeta => ({
  id: 'mx_1',
  contentHash: 'a'.repeat(64),
  title: 'Ascending Scale',
  composer: 'Test Suite',
  fileName: 'scale.musicxml',
  measureCount: 4,
  addedAt: '2026-07-17T00:00:00Z',
  updatedAt: '2026-07-17T00:00:00Z',
  origin: 'import',
  ...over,
})


/** Read a document that MUST exist. `readDocument` returns a DocRead union — collapsing it with a
 *  bare `!` would make an 'error' read look identical to a missing field and fail somewhere else. */
async function found(opfs: typeof import('../storage/opfs'), id: string) {
  const r = await opfs.readDocument(id)
  if (r.kind !== 'found') throw new Error(`expected document ${id}, got ${r.kind}`)
  return r.doc
}

const CONTENT: TiptapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bars 2-3 modulate.' }] }],
}

function doc(over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  return {
    id: 'essay-1',
    title: 'On the modulation',
    contentJson: CONTENT,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: 'seed',
    ...over,
  }
}

// ─── pure merge rules ────────────────────────────────────────────────────────────────────────

describe('attachMaster', () => {
  it('attaches a master by reference — id + the hash that pins its notation', () => {
    const m = attachMaster(EMPTY_MUSIC, meta())
    expect(m.masters).toEqual([{
      id: 'mx_1', contentHash: 'a'.repeat(64), title: 'Ascending Scale', composer: 'Test Suite',
    }])
  })

  it('carries NO notation — the bytes stay in OPFS (§B6)', () => {
    const m = attachMaster(EMPTY_MUSIC, meta())
    expect(JSON.stringify(m)).not.toMatch(/<note|<measure|score-partwise/i)
  })

  it('REFRESHES an existing master rather than duplicating it — the §B6 fix arriving', () => {
    // The student corrects the score in MuseScore and re-imports: same stable id, new contentHash.
    // A second entry would leave the OLD hash in the anchored set forever and make the document
    // claim to be about two versions of one score at once.
    const before = attachMaster(EMPTY_MUSIC, meta())
    const after = attachMaster(before, meta({ contentHash: 'b'.repeat(64) }))
    expect(after.masters).toHaveLength(1)
    expect(after.masters[0].contentHash).toBe('b'.repeat(64))
  })

  it('keeps other masters when a second is attached', () => {
    const m = attachMaster(attachMaster(EMPTY_MUSIC, meta()), meta({ id: 'mx_2', contentHash: 'c'.repeat(64) }))
    expect(m.masters.map(x => x.id)).toEqual(['mx_1', 'mx_2'])
  })

  it('carries library attribution, because the licence requires it (§B7)', () => {
    const attribution = { corpus: 'OpenScore Lieder Corpus', licence: 'CC0-1.0', sourceUrl: 'https://raw.githubusercontent.com/x' }
    expect(masterRef(meta({ origin: 'openscore', attribution })).attribution).toEqual(attribution)
  })

  it('omits absent display fields rather than writing undefined into the document', () => {
    const ref = masterRef(meta({ title: '', composer: '' }))
    expect('title' in ref).toBe(false)
    expect('composer' in ref).toBe(false)
  })
})

describe('attachExcerpt / detach', () => {
  const tx = makeTransclusion('mx_1', '2', '3')

  it('stores the excerpt as an ADDRESS, never a copy (§B6)', () => {
    const m = attachExcerpt(EMPTY_MUSIC, tx)
    expect(m.excerpts[0]).toEqual({
      id: tx.id, masterId: 'mx_1', barStart: '2', barEnd: '3', partIndex: 0, createdAt: tx.createdAt,
    })
  })

  it('is idempotent on id — a double-click cannot double-anchor', () => {
    const once = attachExcerpt(EMPTY_MUSIC, tx)
    expect(attachExcerpt(once, tx).excerpts).toHaveLength(1)
  })

  it('keeps the master attached when one excerpt goes — others may still use it', () => {
    const m = detachExcerpt(attachExcerpt(attachMaster(EMPTY_MUSIC, meta()), tx), tx.id)
    expect(m.excerpts).toEqual([])
    expect(m.masters).toHaveLength(1)
  })

  it('detaching a master takes its excerpts with it', () => {
    // Orphaned excerpts would anchor addresses into a score the document no longer carries — the
    // record would assert bars of a master that isn't there.
    const m = attachExcerpt(attachExcerpt(attachMaster(EMPTY_MUSIC, meta()), tx), makeTransclusion('mx_1', '1', '1'))
    const after = detachMaster(m, 'mx_1')
    expect(after.masters).toEqual([])
    expect(after.excerpts).toEqual([])
  })

  it('detaching one master leaves another’s excerpts alone (the negative fires)', () => {
    const m = attachExcerpt(attachExcerpt(EMPTY_MUSIC, tx), makeTransclusion('mx_2', '5', '6'))
    expect(detachMaster(m, 'mx_1').excerpts.map(e => e.masterId)).toEqual(['mx_2'])
  })

  it('reports masters no excerpt uses', () => {
    const m = attachExcerpt(attachMaster(attachMaster(EMPTY_MUSIC, meta()), meta({ id: 'mx_2' })), tx)
    expect(unusedMasters(m).map(x => x.id)).toEqual(['mx_2'])
  })
})

describe('musicOf / isEmptyMusic', () => {
  it('reads an absent attachment as empty without mutating the document', () => {
    const d = doc()
    expect(musicOf(d)).toEqual(EMPTY_MUSIC)
    expect(d.music).toBeUndefined()
  })

  it('knows empty from non-empty', () => {
    expect(isEmptyMusic(EMPTY_MUSIC)).toBe(true)
    expect(isEmptyMusic(attachMaster(EMPTY_MUSIC, meta()))).toBe(false)
    expect(isEmptyMusic(attachExcerpt(EMPTY_MUSIC, makeTransclusion('mx_1', '1', '1')))).toBe(false)
  })
})

// ─── THE CLOSURE: producer → document → anchored record ──────────────────────────────────────

describe('THE GAP IS CLOSED — the producer really makes a document v:4', () => {
  let attachMod: typeof import('./attach')
  let opfs: typeof import('../storage/opfs')
  let snapshots: typeof import('../provenance/snapshots')

  beforeEach(async () => {
    // resetModules FIRST, and it is not ceremony: this file statically imports `makeTransclusion`,
    // whose chain (transclusion → master → storage/opfsWrite) evaluates `hasCreateWritable` AT
    // MODULE LOAD — before the shim exists. Latched false, every write routes to a parse worker node
    // does not have. Re-loading the graph after the shim is installed is what makes the store real.
    vi.resetModules()
    resetOpfsShim()
    installOpfsShim()
    attachMod = await import('./attach')
    opfs = await import('../storage/opfs')
    snapshots = await import('../provenance/snapshots')
  })

  it('writes the attachment onto the REAL stored document', async () => {
    await opfs.saveDocument(doc())
    await attachMod.updateDocumentMusic('essay-1', m => attachMaster(m, meta()))

    const reloaded = await found(opfs, 'essay-1')
    expect(reloaded.music!.masters[0]).toMatchObject({ id: 'mx_1', contentHash: 'a'.repeat(64) })
    expect(reloaded.music!.annotations).toEqual([]) // §B4's slot, hashed from day one
  })

  it('an attached document snapshots as v:4 and ANCHORS the notation', async () => {
    // THE TEST THAT WOULD HAVE CAUGHT THE GAP. It runs the producer, then the real snapshot path,
    // and demands the anchored bundle actually commit to the score. Nothing here constructs
    // `doc.music` by hand — that is exactly what let the dead path look alive.
    const { bundleHash, musicAttachmentsHash } = await import('../provenance/hash')
    await opfs.saveDocument(doc())

    const tx = makeTransclusion('mx_1', '2', '3')
    await attachMod.updateDocumentMusic('essay-1', m => attachExcerpt(attachMaster(m, meta()), tx))
    const updated = await found(opfs, 'essay-1')

    const snap = (await snapshots.createSnapshotIfChanged(updated, 'manual', [], undefined, true))!
    expect(snap.musicHash).toMatch(/^[0-9a-f]{64}$/)
    expect(snap.bundleHash).toBe(
      await bundleHash(snap.contentHash, [], undefined, undefined, await musicAttachmentsHash(updated.music!)))
    // ...and it is NOT the form the same essay would take with no score attached — which is exactly
    // what it WAS before this producer existed.
    expect(snap.bundleHash).not.toBe(await bundleHash(snap.contentHash, []))
  })

  it('a document with no score attached still snapshots as v:1 (no regression)', async () => {
    const { bundleHash } = await import('../provenance/hash')
    await opfs.saveDocument(doc({ id: 'plain' }))
    const snap = (await snapshots.createSnapshotIfChanged(await found(opfs, 'plain'), 'manual', [], undefined, true))!
    expect(snap.musicHash).toBeUndefined()
    expect(snap.bundleHash).toBe(await bundleHash(snap.contentHash, []))
  })

  it('REMOVES the music key when the last excerpt and master go', async () => {
    // An empty-but-present `music: {masters:[],…}` would be a silent schema change to the JSON of
    // every document that ever touched a score, and would leave them one refactor away from a
    // spurious v:4.
    await opfs.saveDocument(doc())
    await attachMod.updateDocumentMusic('essay-1', m => attachMaster(m, meta()))
    await attachMod.updateDocumentMusic('essay-1', m => detachMaster(m, 'mx_1'))

    const reloaded = await found(opfs, 'essay-1')
    expect('music' in reloaded).toBe(false)
  })

  it('touches ONLY music — it never clobbers what the writer typed', async () => {
    // Read-modify-write against the store, because the editor owns contentJson and may be saving it
    // while the score panel is open. Holding a stale copy and writing it back whole is the snapshot
    // truncation incident's exact shape (CLAUDE.md: a write-back must not assume it holds the newest).
    await opfs.saveDocument(doc())

    // The writer keeps typing while the score panel is open.
    const typed: TiptapJSON = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A later thought.' }] }] }
    await opfs.saveDocument(doc({ contentJson: typed, title: 'Renamed' }))

    await attachMod.updateDocumentMusic('essay-1', m => attachMaster(m, meta()))

    const reloaded = await found(opfs, 'essay-1')
    expect(reloaded.contentJson).toEqual(typed)   // the later text survived
    expect(reloaded.title).toBe('Renamed')
    expect(reloaded.music!.masters).toHaveLength(1)
  })

  it('reports a missing document rather than dropping the attachment silently', async () => {
    // 'absent' — genuinely no such document. Distinct from 'error' (could not find out), which must
    // never be reported as absence: telling a student their essay doesn't exist when the read merely
    // failed is how they conclude their work is gone.
    expect(await attachMod.updateDocumentMusic('no-such-doc', m => attachMaster(m, meta())))
      .toEqual({ kind: 'absent' })
  })

  it('activeDocumentId reads the editor’s key, and is null when there is none', () => {
    localStorage.removeItem('inkwave:activeDocumentId')
    expect(attachMod.activeDocumentId()).toBeNull()
    localStorage.setItem('inkwave:activeDocumentId', 'essay-1')
    expect(attachMod.activeDocumentId()).toBe('essay-1')
  })
})
