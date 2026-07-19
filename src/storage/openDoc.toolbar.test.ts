// @vitest-environment jsdom
//
// "THE TOOLBAR FOLLOWS THE DOC" — the OPEN half, driven through the real `openInkwaveFile`.
//
// Peter, 2026-07-17: "we should encode the toolbar configuration into a .studio document." Half of
// that lived on master and half did not: `doc.toolbar` persisted in local OPFS, so on the machine
// that made the document it looked like a working feature — while `ExportBundle.document` is an
// ALLOW-LIST that never named the field, so every .studio that was ever EMAILED, synced or
// downloaded arrived with the layout stripped, silently. CLAUDE.md meanwhile recorded "a received
// document brings its author's layout, which is the feature" as though it were true. This file is
// the half nobody could see, kept in the gate.
//
// It drives the REAL openInkwaveFile — the conflict guard, the id rules, the save — because the
// question is not "does carryToolbarConfig work" (toolbarContract.test.ts owns that) but "does the
// document that reaches the writer carry the row". Only the boundaries are stubbed: the parse
// WORKER (node has none — the same reason `roundtrip.test.ts` stubs fetch at the network edge) and
// the cloud/registry adapters, none of which have any opinion about a toolbar.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'
import type { ExportBundle } from '../provenance/bundle'
import type { SlotId } from '../editor/toolbarContract'

const parsed = vi.hoisted(() => ({ current: null as unknown as ExportBundle }))

vi.mock('../workers/parseClient', () => ({ parseStudioOffThread: async () => parsed.current }))
vi.mock('./onedrive', () => ({
  setOneDriveFilename: () => {}, adoptOneDriveFile: () => {}, fetchPdfSidecars: async () => {},
}))
vi.mock('./gdrive', () => ({ adoptGoogleDriveFile: () => {} }))
vi.mock('./folder', () => ({ setSaveFileHandle: async () => {} }))
vi.mock('./indexeddb', () => ({ upsertMeta: async () => {} }))
vi.mock('./tabDoc', () => ({ claimTabDoc: async () => true }))
vi.mock('../citations/library', () => ({ loadLibrary: async () => [], persistLibrary: async () => {} }))

let openDoc: typeof import('./openDoc')
let opfs: typeof import('./opfs')

const bundleWith = (toolbar: unknown, id = 'received-doc'): ExportBundle => ({
  v: 1,
  exportedAt: '2026-07-17T00:00:00.000Z',
  document: {
    id,
    title: 'A score to mark up',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bars 12-16.' }] }] },
    createdAt: '2026-07-17T00:00:00.000Z',
    schemaVersion: '0.1.0',
    ...(toolbar === undefined ? {} : { toolbar: toolbar as never }),
  },
  snapshots: [],
  receipts: [],
  signingKey: { keyId: 'inkwave-signing-v1', alg: 'Ed25519', publicKeyHex: '00' },
  poolId: 'p',
})

/** Open a bundle as a .studio and read back what actually landed on disk. */
async function openAndRead(b: ExportBundle) {
  parsed.current = b
  await openDoc.openInkwaveFile(new File(['{}'], 'received.studio'))
  const read = await opfs.readDocument(b.document.id)
  return read.kind === 'found' ? read.doc : null
}

beforeEach(async () => {
  vi.resetModules()
  resetOpfsShim()
  installOpfsShim()
  localStorage.clear()
  openDoc = await import('./openDoc')
  opfs = await import('./opfs')
})

describe('a received .studio brings its author’s layout', () => {
  it('the author’s row lands on the opened document', async () => {
    const row: SlotId[] = ['music', 'media', 'page', 'style', 'guide', 'settings']
    const doc = await openAndRead(bundleWith({ v: 1, row }))

    // Peter's feature, end to end: open a score, get music tools.
    expect(doc?.toolbar).toEqual({ v: 1, row })
  })

  it('KNOWN-POSITIVE for this harness: a document with NO toolbar lands with none', async () => {
    // Without this, the assertion above is satisfiable by an open path that writes whatever it was
    // handed regardless — and, more to the point, this is the case that must never regress: the
    // thousands of existing documents carry no config and must keep using the WRITER's own order
    // (resolveToolbarRow), not a stranger's and not a factory default.
    const doc = await openAndRead(bundleWith(undefined))
    expect(doc).not.toBeNull()
    expect(doc?.toolbar).toBeUndefined()
  })

  it('a flagged-OFF slot survives the open — this device’s flags do not edit the author’s file', async () => {
    // `music` GRADUATED to default-ON (2026-07-18), so to make it a flag-OFF slot again this device
    // must opt out explicitly (`?music=off` ⇒ a sticky '0'). With music off HERE, an author's config
    // that names it must still survive verbatim: migrating on the way IN would delete the flag-off
    // slot from the document permanently at the next save; it is dropped at RENDER time instead,
    // where the decision is reversible. (toolbarContract.test.ts mutation-proves the rule; this
    // proves the real open path takes it.)
    localStorage.setItem('inkwave:music', '0')      // this device has music OFF
    const doc = await openAndRead(bundleWith({ v: 1, row: ['music', 'page'] }))
    expect(doc?.toolbar?.row).toContain('music' as SlotId)
  })

  it('an UNREADABLE config opens a working document carrying none — never a repaired guess', async () => {
    const doc = await openAndRead(bundleWith({ v: 99, row: ['page'] }))
    expect(doc).not.toBeNull()          // the file still opens; a toolbar cannot fail an open
    expect(doc?.toolbar).toBeUndefined()
  })

  it('junk in a hostile file cannot reach the document', async () => {
    const doc = await openAndRead(bundleWith({ v: 1, row: ['page', 'wormhole', 'style'] }))
    expect(doc?.toolbar).toEqual({ v: 1, row: ['page', 'style'] })
  })
})
