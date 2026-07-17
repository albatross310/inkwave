// @vitest-environment jsdom
// AUDITOR A — the .studio allow-list's OTHER half. Drop in as src/storage/openDoc.fields.test.ts.
// Harness adapted from openDoc.toolbar.test.ts (the lane that found the toolbar drop).
//
// THE FINDING (PROBED, pass 3): `ExportBundle.document` is an allow-list, and the toolbar owner
// fixed the EXPORT half for `toolbar`. But the IMPORT half — `openDoc.ts`'s reconstruction literal —
// names only { id, title, contentJson, createdAt, schemaVersion, scasReceipts, toolbar, bibliography }.
// FIVE fields the export deliberately carries are never read back:
//     docType · email · scasMode · scasSetSize · scasPoolId
//
// docType/email is an objective contradiction, not a design question. `bundle.ts` says they are
// "Carried so a recipient of the .studio sees what the draft was addressed to", and
// `roundtrip.test.ts` asserts it under the title "the export carries the headers, SO A RECIPIENT
// CAN SEE what was addressed" — while asserting only `b.document.docType`, the BUNDLE field. The
// recipient gets undefined. The test measures the half that works; the sentence describes the half
// that does not. That is the toolbar bug exactly: "the local path looked fine, so nothing could
// see it."
//
// scasMode/scasSetSize/scasPoolId drop by the SAME mechanism, but their intent is UNSTATED — no
// comment says they should travel, and it is arguable the recipient's own SCAS settings should win.
// `/verify` never reads poolId and `scasPoolId` has no consumer outside the export. Peter's call.
// NOT asserted here; only docType/email are, because only those have a stated purpose to defeat.
//
// WHY IT MATTERS FORWARD even though email ships dark (`emailEnabled()` DEFAULT OFF): the music
// lane sets `docType: 'music'` and keys `isPieceDocument()` on it, so an emailed Piece arrives not
// knowing it is a Piece. The next lane walks into this unless the import half is closed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import type { ExportBundle } from '../provenance/bundle'

const parsed = vi.hoisted(() => ({ current: null as unknown as ExportBundle }))
vi.mock('../workers/parseClient', () => ({ parseStudioOffThread: async () => parsed.current }))
vi.mock('./onedrive', () => ({ setOneDriveFilename: () => {}, adoptOneDriveFile: () => {}, fetchPdfSidecars: async () => {} }))
vi.mock('./gdrive', () => ({ adoptGoogleDriveFile: () => {} }))
vi.mock('./folder', () => ({ setSaveFileHandle: async () => {} }))
vi.mock('./indexeddb', () => ({ upsertMeta: async () => {} }))
vi.mock('./tabDoc', () => ({ claimTabDoc: async () => true }))
vi.mock('../citations/library', () => ({ loadLibrary: async () => [], persistLibrary: async () => {} }))

let openDoc: typeof import('./openDoc')
let opfs: typeof import('./opfs')

beforeEach(async () => {
  vi.resetModules(); resetOpfsShim(); installOpfsShim(); localStorage.clear()
  openDoc = await import('./openDoc'); opfs = await import('./opfs')
})

const emailBundle = (): ExportBundle => ({
  v: 1,
  exportedAt: '2026-07-17T00:00:00.000Z',
  document: {
    id: 'received-email',
    title: 'Re: supervision',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear Sam,' }] }] },
    createdAt: '2026-07-17T00:00:00.000Z',
    schemaVersion: '0.1.0',
    docType: 'email',
    email: { to: ['sam@uni.edu'], subject: 'Re: supervision' } as never,
  },
  snapshots: [], receipts: [],
  signingKey: { keyId: 'inkwave-signing-v1', alg: 'Ed25519', publicKeyHex: '00' },
  poolId: 'p',
})

async function openAndRead(b: ExportBundle) {
  parsed.current = b
  await openDoc.openInkwaveFile(new File(['{}'], 'received.studio'))
  const read = await opfs.readDocument(b.document.id)
  return read.kind === 'found' ? read.doc : null
}

describe('a received .studio keeps the identity the export carried', () => {
  it('an emailed email draft arrives still knowing it is an email', async () => {
    const doc = await openAndRead(emailBundle())
    expect(doc?.docType, 'the recipient must see this is an email').toBe('email')
    expect(doc?.email, 'the recipient must see what it was addressed to').toBeTruthy()
  })

  it('KNOWN-POSITIVE for this harness: a plain document arrives with NO docType', async () => {
    // Without this, the assertion above is satisfiable by an open path that stamps 'email' on
    // everything — and this is the case that must never regress: the thousands of existing
    // documents carry no docType and must keep arriving that way.
    const b = emailBundle()
    delete (b.document as { docType?: unknown }).docType
    delete (b.document as { email?: unknown }).email
    const doc = await openAndRead(b)
    expect(doc?.docType).toBeUndefined()
    expect(doc?.email).toBeUndefined()
  })
})
