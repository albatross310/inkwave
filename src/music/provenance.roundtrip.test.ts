// @vitest-environment jsdom
//
// §B5 END TO END — "MusicXML source + annotations + the written analysis are hashed and
// OTS-anchored, same as everything else."
//
// This drives the REAL chain, not an imitation of it: createSnapshotIfChanged → the real gzip
// archive → stampSnapshot → the OTS relay (fetch stubbed at the NETWORK boundary only, so the whole
// client path stays production code) → buildExportBundle → verifyBundle, the verifier /verify runs.
// Hand-building the record under test is how a suite comes to verify a fiction.
//
// A ROUND-TRIP THAT ONLY EVER PASSES PROVES NOTHING. So every positive is paired with a tamper that
// must FAIL — including the one that matters most for §B5: swapping the notation under an anchored
// analysis. If that ever verifies, "the MusicXML source is anchored" is false.
//
// Modules are imported DYNAMICALLY after the shim is installed: `storage/opfsWrite.ts` decides ONCE
// AT MODULE LOAD whether writes use createWritable or the parse worker, and node has neither — a
// static import makes every write a silent no-op the test would read as "nothing was saved".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import { PUBLISHED_SIGNING_PK } from '../provenance/receipts'
import type { InkwaveDocument, MusicAttachments, TiptapJSON } from '../types/document'

let snapshots: typeof import('../provenance/snapshots')
let bundleMod: typeof import('../provenance/bundle')
let verifyMod: typeof import('../verify/index')

const ANALYSIS: TiptapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bars 12-16 modulate to the relative minor.' }] }],
}

// A FUNCTION, not a shared const — and that is load-bearing, not style. The tamper tests mutate the
// music they are handed (`b.snapshots[0].music.masters[0].contentHash = …`), and a module-level
// object would be passed BY REFERENCE into every document, so the first tamper would silently
// rewrite the fixture for every later test. It did: the tamper-and-recompute case then "tampered"
// with a value that was already tampered, changed nothing, and VERIFIED — reading exactly like the
// anchor failing to bind. A shared mutable fixture is a test measuring the tests before it.
const music = (): MusicAttachments => ({
  masters: [{ id: 'mx_1', contentHash: 'a'.repeat(64), title: 'Ascending Scale' }],
  excerpts: [{ id: 'tx_1', masterId: 'mx_1', barStart: '12', barEnd: '16', partIndex: 0, createdAt: '2026-07-17T00:00:00Z' }],
  annotations: [],
})

function musicDoc(over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  const now = '2026-07-17T00:00:00.000Z'
  return {
    id: 'music-doc-1',
    title: 'On the modulation',
    contentJson: ANALYSIS,
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: 'seed',
    music: music(),
    ...over,
  }
}

const submitted: string[] = []
function stubRelay() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (body.action === 'stamp') {
      submitted.push(body.bundleHash)
      return new Response(JSON.stringify({ status: 'pending', proofBase64: 'AA==' }), { status: 200 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  }))
}

beforeEach(async () => {
  vi.resetModules()
  resetOpfsShim()
  installOpfsShim()
  submitted.length = 0
  stubRelay()
  snapshots = await import('../provenance/snapshots')
  bundleMod = await import('../provenance/bundle')
  verifyMod = await import('../verify/index')
})

const snapOf = async (doc: InkwaveDocument) =>
  (await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true))!

/** Snapshot the doc, then build the REAL export bundle from the REAL archive. */
async function exported(doc: InkwaveDocument) {
  await snapOf(doc)
  return bundleMod.buildExportBundle(doc, await snapshots.listSnapshots(doc.id))
}

describe('§B5 — the snapshot freezes the attached music', () => {
  it('freezes the master refs and excerpts, and hashes them', async () => {
    const snap = await snapOf(musicDoc())
    expect(snap.music).toEqual(music())
    expect(snap.musicHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('takes the v:4 bundle form — the musicHash is IN the anchored hash', async () => {
    const { bundleHash, musicAttachmentsHash } = await import('../provenance/hash')
    const snap = await snapOf(musicDoc())
    const expected = await bundleHash(snap.contentHash, [], undefined, undefined, await musicAttachmentsHash(music()))
    expect(snap.bundleHash).toBe(expected)
    // ...and it is NOT the form a music-less document would take. Without this, a musicHash could be
    // computed, stored, and silently left out of what Bitcoin actually commits to.
    expect(snap.bundleHash).not.toBe(await bundleHash(snap.contentHash, []))
  })

  it('stamps the v:4 bundleHash to the calendar — not the contentHash', async () => {
    const snap = await snapOf(musicDoc())
    await snapshots.stampSnapshot('music-doc-1', snap.id)
    expect(submitted).toContain(snap.bundleHash)
    expect(submitted).not.toContain(snap.contentHash)
  })

  it('leaves a document with NO music at v:1 — every existing anchor is untouched', async () => {
    // The compatibility claim, on the real snapshot path rather than on hash.ts alone.
    const { bundleHash } = await import('../provenance/hash')
    const snap = await snapOf(musicDoc({ music: undefined, id: 'plain-doc' }))
    expect(snap.music).toBeUndefined()
    expect(snap.musicHash).toBeUndefined()
    expect(snap.bundleHash).toBe(await bundleHash(snap.contentHash, []))
  })

  it('treats an EMPTY music attachment as no music (no spurious v:4)', async () => {
    const { bundleHash } = await import('../provenance/hash')
    const snap = await snapOf(musicDoc({ id: 'empty-music', music: { masters: [], excerpts: [], annotations: [] } }))
    expect(snap.musicHash).toBeUndefined()
    expect(snap.bundleHash).toBe(await bundleHash(snap.contentHash, []))
  })
})

describe('§B5 — the real verifier', () => {
  const verify = async (doc: InkwaveDocument) =>
    verifyMod.verifyBundle(await exported(doc), PUBLISHED_SIGNING_PK, async () => null)

  it('verifies an untampered music document', async () => {
    const r = await verify(musicDoc())
    expect(r.contentIntegrity.ok).toBe(true)
  })

  it('FAILS when the notation is swapped under the anchored analysis', async () => {
    // THE §B5 CLAIM, and the only test that can falsify it. The essay still says "bars 12-16
    // modulate"; the score it points at has been replaced. Nothing about the prose changed — only
    // the master's contentHash — so a bundle that still verified would mean the anchor never bound
    // the notation at all.
    const b = await exported(musicDoc())
    b.snapshots[0].music!.masters[0].contentHash = 'b'.repeat(64)

    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/musicHash mismatch/)
  })

  it('FAILS when an excerpt’s bar range is edited (§B6)', async () => {
    // "bars 12-16" is the claim; quietly making it "bars 12-20" after anchoring must not verify.
    const b = await exported(musicDoc())
    b.snapshots[0].music!.excerpts[0].barEnd = '20'

    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/musicHash mismatch/)
  })

  it('FAILS on a tamper-and-recompute — the musicHash is bound to the BUNDLE', async () => {
    // The sophisticated attempt: swap the notation AND fix up musicHash so the two agree. It must
    // still fail, because bundleHash commits to musicHash and the OTS proof commits to bundleHash.
    const { musicAttachmentsHash } = await import('../provenance/hash')
    const b = await exported(musicDoc())
    b.snapshots[0].music!.masters[0].contentHash = 'b'.repeat(64)
    b.snapshots[0].musicHash = await musicAttachmentsHash(b.snapshots[0].music!)

    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/bundleHash mismatch/)
  })

  it('FAILS when the music is STRIPPED — a downgrade to v:1 is not a valid document', async () => {
    // Delete the attachment and the analysis stops being about anything. The bundleHash still
    // commits to a musicHash, so the recompute cannot reach it.
    const b = await exported(musicDoc())
    delete b.snapshots[0].music
    delete b.snapshots[0].musicHash

    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/bundleHash mismatch/)
  })

  it('still verifies a document with NO music (no regression for everything else)', async () => {
    const r = await verify(musicDoc({ music: undefined, id: 'plain-doc-2' }))
    expect(r.contentIntegrity.ok).toBe(true)
  })
})
