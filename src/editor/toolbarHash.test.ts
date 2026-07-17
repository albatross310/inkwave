// @vitest-environment jsdom
//
// THE TOOLBAR CONFIG IS OUTSIDE THE PROVENANCE HASH — proved, not asserted.
//
// Peter, 2026-07-17: "we should encode the toolbar configuration into a .studio document" AND "keep
// the toolbar config out of the hash. It doesn't need to be in provenance." Those two pull in
// opposite directions the moment a field lives on the document: everything else the .studio carries
// about the work — the body, the bibliography, the email headers, the attached score — IS anchored,
// and each of those arrived as one line in `createSnapshotIfChanged`. The toolbar must not.
//
// WHY A TEST AND NOT A COMMENT. `toolbarContract.ts` states the property and reasons for it
// correctly (contentHash takes contentJson alone; bundleHash folds four explicit arguments), and
// that is exactly the kind of claim this codebase keeps discovering was true when written and false
// six weeks later — a comment asserting parity is a reason nobody checks parity. The failure would
// be silent and expensive in both directions: rearranging your buttons would either invalidate an
// anchored thesis, or mint provenance snapshots for a drag.
//
// It drives the REAL chain (the music/email roundtrip pattern): createSnapshotIfChanged → the real
// gzip archive → buildExportBundle → verifyBundle. Modules load DYNAMICALLY after the OPFS shim —
// `storage/opfsWrite.ts` decides at MODULE LOAD whether writes use createWritable or the parse
// worker, and node has neither, so a static import makes every write a silent no-op the test would
// read as "nothing was saved".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import { PUBLISHED_SIGNING_PK } from '../provenance/receipts'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import type { ToolbarConfig } from './toolbarContract'

let snapshots: typeof import('../provenance/snapshots')
let bundleMod: typeof import('../provenance/bundle')
let verifyMod: typeof import('../verify/index')

const PROSE: TiptapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The misdiagnosis is a lack of selection.' }] }],
}

const bar = (row: ToolbarConfig['row']): ToolbarConfig => ({ v: 1, row: [...row] })

function doc(over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  const now = '2026-07-17T00:00:00.000Z'
  return {
    id: 'toolbar-doc-1',
    title: 'On selection',
    contentJson: PROSE,
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: 'seed',
    ...over,
  }
}

beforeEach(async () => {
  // resetModules is NOT hygiene theatre: `snapshots.ts` serves from a write-through in-memory
  // `_snapCache`, so a fresh OPFS shim alone leaves the PREVIOUS test's snapshots visible under the
  // same document id — and "createSnapshotIfChanged returned null" would then mean "a test that ran
  // before me wrote this", not what the assertion claims.
  vi.resetModules()
  resetOpfsShim()
  installOpfsShim()
  localStorage.clear()
  snapshots = await import('../provenance/snapshots')
  bundleMod = await import('../provenance/bundle')
  verifyMod = await import('../verify/index')
})

const snapOf = async (d: InkwaveDocument) =>
  (await snapshots.createSnapshotIfChanged(d, 'manual', [], undefined, true))!

describe('the toolbar config is NOT in the anchored hash', () => {
  it('two documents differing ONLY in their toolbar hash IDENTICALLY — content and bundle', async () => {
    const a = await snapOf(doc({ id: 'row-a', toolbar: bar(['page', 'style', 'guide', 'settings', 'media', 'receipt']) }))
    const b = await snapOf(doc({ id: 'row-b', toolbar: bar(['receipt', 'media', 'settings', 'guide', 'style', 'page']) }))

    expect(a.contentHash).toBe(b.contentHash)
    // The one that matters: bundleHash is what OTS submits, so this is the sentence "rearranging
    // your buttons cannot read as tampering with your thesis", measured.
    expect(a.bundleHash).toBe(b.bundleHash)
  })

  it('a document with NO toolbar hashes identically to one WITH — every existing anchor survives', async () => {
    const plain = await snapOf(doc({ id: 'plain' }))
    const dressed = await snapOf(doc({ id: 'dressed', toolbar: bar(['music', 'clock', 'math']) }))

    expect(dressed.contentHash).toBe(plain.contentHash)
    expect(dressed.bundleHash).toBe(plain.bundleHash)
  })

  it('KNOWN-POSITIVE: the same comparison DOES see a real change — so "identical" is an observation', async () => {
    // Without this, every assertion above is satisfiable by a harness that hashes nothing at all.
    // The toolbars are identical here and the PROSE differs by one word.
    const t = bar(['page', 'style'])
    const a = await snapOf(doc({ id: 'pos-a', toolbar: t }))
    const b = await snapOf(doc({
      id: 'pos-b',
      toolbar: t,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A different sentence.' }] }] },
    }))

    expect(a.contentHash).not.toBe(b.contentHash)
    expect(a.bundleHash).not.toBe(b.bundleHash)
  })

  it('the snapshot record carries no toolbar at all — nothing can ride in later', async () => {
    // Structural, not numeric: `bibliography`/`email`/`music` are each frozen ONTO the snapshot and
    // then hashed. A toolbar that got frozen here would be one careless spread from being anchored.
    const snap = await snapOf(doc({ id: 'no-ride', toolbar: bar(['page', 'style', 'clock']) }))
    expect('toolbar' in snap).toBe(false)
    // Recursive, and it asks about KEYS: an earlier cut scanned JSON.stringify for the substring
    // and failed on the fixture's own document id ('toolbar-doc-1') — a matcher that cannot tell
    // its subject from its subject's name.
    const keys = (v: unknown): string[] =>
      v && typeof v === 'object'
        ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keys(x)])
        : []
    expect(keys(snap)).not.toContain('toolbar')
  })

  it('REARRANGING THE TOOLBAR MINTS NO SNAPSHOT — a drag is not a provenance event', async () => {
    const first = await snapshots.createSnapshotIfChanged(doc({ id: 'no-mint', toolbar: bar(['page', 'style']) }), 'manual')
    expect(first).not.toBeNull()

    // Same prose, buttons moved. The snapshot trigger keys on contentHash, so this is the behaviour
    // the exclusion BUYS: a writer who rearranges their homescreen ten times does not accrue ten
    // versions of a document they did not touch.
    const after = await snapshots.createSnapshotIfChanged(doc({ id: 'no-mint', toolbar: bar(['receipt', 'media', 'guide']) }), 'manual')
    expect(after).toBeNull()
    expect(await snapshots.listSnapshots('no-mint')).toHaveLength(1)
  })
})

describe('the real verifier is indifferent to the toolbar', () => {
  const exported = async (d: InkwaveDocument) => {
    await snapOf(d)
    return bundleMod.buildExportBundle(d, await snapshots.listSnapshots(d.id))
  }
  const verify = (b: import('../provenance/bundle').ExportBundle) =>
    verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)

  it('verifies a document that carries a toolbar', async () => {
    const r = await verify(await exported(doc({ toolbar: bar(['page', 'style', 'guide']) })))
    expect(r.contentIntegrity.ok).toBe(true)
  })

  it('STILL verifies after the toolbar is tampered with — because it is not evidence', async () => {
    // The inverse of every other tamper test in this repo, and deliberately so. For the email
    // headers and the attached score, "tamper ⇒ verify fails" IS the claim. Here the claim is the
    // opposite: a recipient who rearranges the buttons of a document they were sent must not be
    // told the writing was altered.
    const b = await exported(doc({ toolbar: bar(['page', 'style', 'guide']) }))
    b.document.toolbar = bar(['clock', 'music', 'math'])

    const r = await verify(b)
    expect(r.contentIntegrity.ok).toBe(true)
  })
})

describe('the .studio carries the layout — the half that made the field real', () => {
  it('buildExportBundle emits the author’s row through a JSON round-trip', async () => {
    // `bundle.document` is an ALLOW-LIST: a field it does not NAME does not travel. Until the field
    // was named, `doc.toolbar` persisted in local OPFS and vanished from every emailed .studio —
    // "the toolbar follows the doc" would have been true only for documents that never moved.
    const row: ToolbarConfig['row'] = ['music', 'page', 'receipt']
    const b = bundleMod.buildExportBundle(doc({ toolbar: bar(row) }), [])
    const wire = JSON.parse(JSON.stringify(b)) as typeof b

    expect(wire.document.toolbar).toEqual({ v: 1, row })
  })

  it('a document with no toolbar emits none — the recipient keeps THEIR order', async () => {
    const b = bundleMod.buildExportBundle(doc(), [])
    expect(b.document.toolbar).toBeUndefined()
  })
})
