import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InkwaveDocument, Snapshot, TiptapJSON } from '../types/document'
import { installOpfsShim, resetOpfsShim } from './testOpfsShim'
import { PUBLISHED_SIGNING_PK } from '../provenance/receipts'

// ─── THE ROUND-TRIP PROBE ────────────────────────────────────────────────────
//
// The brief's instruction, and the house rule behind it: PROVE the OTS anchoring actually happens
// for an email — do not assume it inherits. Fourteen times this codebase has been burned by a check
// that measured in a fiction.
//
// So this test drives the REAL production functions end to end:
//
//   createSnapshotIfChanged   (provenance/snapshots.ts — the real one, over a real gzip archive)
//   stampSnapshot → stampBundle → the OTS relay   (provenance/ots.ts — fetch stubbed at the network
//                                                  boundary ONLY; the code path is production's)
//   buildExportBundle          (provenance/bundle.ts — the real export)
//   verifyBundle               (verify/index.ts — the real verifier, the one /verify runs)
//
// What is NOT faked: the snapshot record, its hashing, the v:3 bundle form, the gzip archive, the
// export bundle, and every verifier check. What IS faked: OPFS (an in-memory shim — this is node)
// and the network (the calendar relay and the block explorers). Both are named honestly in the
// report; neither stands between the email headers and the anchored hash.
//
// The negatives below are the point of the file. A round-trip that only ever passes proves nothing:
// if tampering with a recipient still verified, the anchor would not be binding the headers and the
// in-product copy would be a lie.

let snapshots: typeof import('../provenance/snapshots')
let bundleMod: typeof import('../provenance/bundle')
let verifyMod: typeof import('../verify/index')

const BODY: TiptapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear Ada, the proposal is attached. Regards, Peter' }] }],
}

function emailDoc(over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  const now = '2026-07-16T00:00:00.000Z'
  return {
    id: 'email-doc-1',
    title: 'Re: the proposal',
    contentJson: BODY,
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: 'seed',
    docType: 'email',
    email: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'Re: the proposal' },
    ...over,
  }
}

// The OTS relay's real wire contract (api/_ots-core.mjs): { action:'stamp', bundleHash } → a proof.
// Stubbing fetch keeps the WHOLE client path — stampSnapshot → stampBundle → callRelay → the
// snapshot patch — in production code, and lets us assert WHICH digest was submitted.
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

describe('an email snapshots through the EXISTING global spine (probed, not assumed)', () => {
  it('the real createSnapshotIfChanged freezes the headers and hashes them', async () => {
    const doc = emailDoc()
    const snap = await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    expect(snap).not.toBeNull()
    // The headers are FROZEN into the snapshot, canonicalised...
    expect(snap!.email).toEqual({ to: ['ada@example.com'], cc: [], bcc: [], subject: 'Re: the proposal' })
    // ...and hashed. If this were undefined the bundle would silently fall back to v:1 and the
    // headers would be anchored by nothing at all — the exact silent-disable failure mode.
    expect(snap!.emailHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the snapshot survives a COLD read of the real gzip archive with its headers intact', async () => {
    const doc = emailDoc()
    const created = await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)

    // THE POINT OF THE MODULE RESET, and it is not incidental. snapshots.ts serves listSnapshots
    // from a write-through in-memory cache (_snapCache) that is populated SYNCHRONOUSLY at create
    // time — so reading back through the same module instance never touches the archive at all.
    // The first cut of this test did exactly that and passed while proving nothing about
    // persistence. A fresh module = empty cache = a genuine gunzip of the bytes on disk.
    vi.resetModules()
    const cold = await import('../provenance/snapshots')
    const listed = await cold.listSnapshots(doc.id)

    expect(listed).toHaveLength(1)
    expect(listed[0].emailHash).toBe(created!.emailHash)
    expect(listed[0].email).toEqual(created!.email)
    expect(listed[0].bundleHash).toBe(created!.bundleHash)
  })

  it('a NON-email document takes the byte-identical v:1 path (no email fields appear)', async () => {
    const doc = emailDoc({ id: 'plain-doc', docType: undefined, email: undefined })
    const snap = await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    expect(snap!.email).toBeUndefined()
    expect(snap!.emailHash).toBeUndefined()
    // And its bundleHash is exactly what the pre-email v:1 code computed.
    const { bundleHash, contentHash } = await import('../provenance/hash')
    expect(snap!.bundleHash).toBe(await bundleHash(await contentHash(BODY), []))
  })

  it('OTS stamps the EMAIL bundleHash — the v:3 digest, not the bare content hash', async () => {
    const doc = emailDoc()
    const snap = await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    const stamped = await snapshots.stampSnapshot(doc.id, snap!.id)

    expect(stamped!.ots.status).toBe('pending')
    // THE ASSERTION THAT MATTERS: the digest submitted to the calendar is the bundle hash that
    // commits to the headers. Anchoring the wrong digest is how "it's anchored!" becomes a lie that
    // still passes every green check.
    expect(submitted).toEqual([snap!.bundleHash])
    expect(submitted[0]).not.toBe(snap!.contentHash)
  })

  it('an offline snapshot still RECORDS the draft (unstamped), never discards it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const doc = emailDoc()
    const snap = await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    expect(snap!.emailHash).toBeTruthy()
    const stamped = await snapshots.stampSnapshot(doc.id, snap!.id)
    expect(stamped).toBeNull() // relay unreachable
    // The record persists regardless — the sweep stamps it later.
    const listed = await snapshots.listSnapshots(doc.id)
    expect(listed[0].ots.status).toBe('unstamped')
    expect(listed[0].emailHash).toBe(snap!.emailHash)
  })
})

describe('/verify accepts a genuine email bundle and REJECTS a tampered one', () => {
  async function exportedBundle(doc: InkwaveDocument) {
    await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    const snaps = await snapshots.listSnapshots(doc.id)
    return bundleMod.buildExportBundle(doc, snaps)
  }

  // Only the content-integrity leg is asserted: it is the leg that recomputes contentHash, the
  // email headers, and the bundleHash. The chain/anchor legs need the signing service and live
  // block explorers and are covered by verify/index.test.ts — quoting their result here would be
  // quoting a network stub, not a verification.
  it('a genuine email bundle passes content integrity', async () => {
    const b = await exportedBundle(emailDoc())
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(true)
    expect(r.contentIntegrity.checked).toBe(1)
  })

  it('textIntegrity still holds for an email — pmToText is NOT perturbed by the headers', async () => {
    // The bundle's readable `text` is pinned to pmToText(contentJson) byte-for-byte by verify. An
    // email body IS an ordinary contentJson, and the headers deliberately do NOT enter that text —
    // prepending them would have broken this for every email. The provenance boundary the brief
    // named: pmToText stays byte-deterministic at resolveCitations=false.
    const b = await exportedBundle(emailDoc())
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.textIntegrity.ok).toBe(true)
    expect(b.text).toBe(bundleMod.pmToText(b.document.contentJson))
  })

  it('the export carries the headers, so a recipient can see what was addressed', async () => {
    const b = await exportedBundle(emailDoc())
    expect(b.document.docType).toBe('email')
    expect(b.document.email?.to).toEqual(['ada@example.com'])
    expect(b.snapshots[0].email?.subject).toBe('Re: the proposal')
  })

  // ── THE NEGATIVES. Each must FIRE, or the anchor is not binding what the copy says it binds.
  it('REJECTS a swapped RECIPIENT', async () => {
    const b = await exportedBundle(emailDoc())
    b.snapshots[0].email!.to = ['mallory@example.com']
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/emailHash mismatch/)
  })

  it('REJECTS a swapped SUBJECT', async () => {
    const b = await exportedBundle(emailDoc())
    b.snapshots[0].email!.subject = 'Something else entirely'
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/emailHash mismatch/)
  })

  it('REJECTS an added BCC', async () => {
    const b = await exportedBundle(emailDoc())
    b.snapshots[0].email!.bcc = ['secret@example.com']
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
  })

  it('REJECTS a tampered BODY (the ordinary content check still applies to an email)', async () => {
    const b = await exportedBundle(emailDoc())
    b.snapshots[0].contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'I never said this' }] }] }
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/contentHash mismatch/)
  })

  it('REJECTS headers STRIPPED to make an email look like a plain document', async () => {
    // The downgrade attack: delete the headers and the emailHash, hoping the verifier falls back to
    // the v:1 recompute and passes. It must not — the bundleHash still commits to v:3.
    const b = await exportedBundle(emailDoc())
    delete (b.snapshots[0] as Partial<Snapshot>).email
    delete (b.snapshots[0] as Partial<Snapshot>).emailHash
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/bundleHash mismatch/)
  })

  it('REJECTS a recomputed emailHash that does not match the anchored bundleHash', async () => {
    // The sophisticated version: tamper the headers AND fix up emailHash so the two agree. The
    // bundleHash — the thing OTS actually anchored — still catches it.
    const b = await exportedBundle(emailDoc())
    const { emailHeadersHash } = await import('../provenance/hash')
    b.snapshots[0].email!.to = ['mallory@example.com']
    b.snapshots[0].emailHash = await emailHeadersHash(b.snapshots[0].email!)
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/bundleHash mismatch/)
  })
})

describe('the displayed headers cannot diverge from the anchored ones', () => {
  async function exported(doc: InkwaveDocument) {
    await snapshots.createSnapshotIfChanged(doc, 'manual', [], undefined, true)
    return bundleMod.buildExportBundle(doc, await snapshots.listSnapshots(doc.id))
  }

  it('REJECTS headers stored in a NON-CANONICAL form that re-normalises to the anchored hash', async () => {
    // Probed 2026-07-17: verify re-normalises before hashing, so without the canonical-form check a
    // tamperer could show a reader "ADA@X.COM" while the Bitcoin anchor commits to "ada@x.com". The
    // recipient IDENTITY cannot be changed this way — but displayed bytes and anchored bytes must
    // not diverge at all on a provenance surface.
    const b = await exported(emailDoc())
    b.snapshots[0].email!.to = ['ADA@EXAMPLE.COM'] // same address, non-canonical spelling
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
    expect(r.contentIntegrity.reason).toMatch(/not in canonical form/)
  })

  it('a DISPLAY-NAME change is caught (it is part of what was committed to)', async () => {
    const b = await exported(emailDoc({ email: { to: ['Ada Lovelace <ada@example.com>'], cc: [], bcc: [], subject: 'S' } }))
    b.snapshots[0].email!.to = ['Mallory Evil <ada@example.com>']
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(false)
  })

  it('the genuine canonical form still PASSES (the check is not just always-false)', async () => {
    const b = await exported(emailDoc())
    const r = await verifyMod.verifyBundle(b, PUBLISHED_SIGNING_PK, async () => null)
    expect(r.contentIntegrity.ok).toBe(true)
  })
})
