// @vitest-environment jsdom
// THE COMPOSITION — a failed SNAPSHOT-ARCHIVE read must not defeat the blind-overwrite guard.
//
// CLAUDE.md already records that the 2026-07-15 loss was TWO bugs in sequence: a read that answered
// "nothing here" on failure, and an open that overwrote on that answer. The body's read was fixed
// (`readDocument` ⇒ found | absent | error) and `openDoc` treats `error` as 'diverged'. But the
// guard's OTHER input — the local snapshot archive, which is what makes the ancestry question
// answerable at all — was still read as `listSnapshots(fileId).catch(() => [])`.
//
// With `localSnapshotHashes` empty, classifyOpen's `incomingIsPast` is false for EVERY input:
//   · 'incoming-stale' — the verdict that saved Peter's work on 07-15 — becomes UNREACHABLE, and
//   · the ambiguous case it deliberately answers 'diverged' for becomes 'incoming-newer' ⇒ ADOPT.
// So the same class of bug, one layer down, reached in through the guard's own front door. The fix
// is the one the body already has: could not read ⇒ could not compare ⇒ do not overwrite.
//
// These drive the REAL openDoc against the REAL snapshot store on an in-memory OPFS, with the
// archive read made to fail the way a transient fault does (testOpfsShim's failOpfsReads).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installOpfsShim, resetOpfsShim, failOpfsReads } from '../email/testOpfsShim'
import type { ExportBundle } from '../provenance/bundle'

const parsed = vi.hoisted(() => ({ current: null as unknown as ExportBundle }))
// Partial mock: keep the REAL gunzip/gzip off-thread helpers (they degrade inline under vitest,
// which is the path the snapshot write chain now takes), override only the .studio parse.
vi.mock('../workers/parseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workers/parseClient')>()),
  parseStudioOffThread: async () => parsed.current,
}))
vi.mock('./onedrive', () => ({ setOneDriveFilename: () => {}, adoptOneDriveFile: () => {}, fetchPdfSidecars: async () => {} }))
vi.mock('./gdrive', () => ({ adoptGoogleDriveFile: () => {} }))
vi.mock('./folder', () => ({ setSaveFileHandle: async () => {} }))
vi.mock('./indexeddb', () => ({ upsertMeta: async () => {} }))
vi.mock('./tabDoc', () => ({ claimTabDoc: async () => true }))
vi.mock('../citations/library', () => ({ loadLibrary: async () => [], persistLibrary: async () => {} }))
vi.mock('../provenance/ots', () => ({ stampBundle: async () => null, upgradeProof: async () => null }))

let openDoc: typeof import('./openDoc')
let opfs: typeof import('./opfs')
let snapshots: typeof import('../provenance/snapshots')

const DOC_ID = 'thesis-doc'
const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const docWith = (text: string) => ({
  id: DOC_ID, title: 'Honours proposal', schemaVersion: '0.1.0',
  createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  contentJson: para(text),
}) as never

beforeEach(async () => {
  // Let the PREVIOUS test's deferred snapshot writes land first. openDoc restores with
  // `deferDiskWrite: true` (fire-and-forget on the per-doc write chain), and writeOpfsFile resolves
  // its root at WRITE time — so a late write lands in whatever root is installed when it runs. Reset
  // without this and the previous test's forked document materialises inside this test's clean disk.
  // (Cost me a real off-by-one here: a stray uuid doc in a listing that should have held one id.)
  await new Promise((r) => setTimeout(r, 10))
  vi.resetModules(); resetOpfsShim(); installOpfsShim(); localStorage.clear()
  openDoc = await import('./openDoc'); opfs = await import('./opfs')
  snapshots = await import('../provenance/snapshots')
  snapshots._resetSnapCache()
})

/** Put a real document + a real snapshot archive on the fake disk, exactly as the editor would. */
async function seedLocal(): Promise<void> {
  await snapshots.createSnapshotIfChanged(docWith('the 08 July draft'), 'manual', [], undefined, true)
  await snapshots.createSnapshotIfChanged(docWith("Wednesday's annotations"), 'manual', [], undefined, true)
  await opfs.saveDocument(docWith("Wednesday's annotations"))
}

// THE FILE THAT DOES THE DAMAGE — and getting this shape right is the whole test.
//
// A stale file carrying NO snapshots is NOT enough to prove anything here: with an empty incoming
// archive, classifyOpen reaches its last clause ("no common ancestor ⇒ diverged") and answers
// 'diverged' whether the guard is present or not. A test built on it passes against the BUG, which
// is how a negative that cannot fail gets written. (PROBED: mutants 5 and 6 below survived it.)
//
// The destructive shape is the AMBIGUOUS one — each side's archive claims the other — because that
// is the case classifyOpen deliberately refuses to guess about, and the case a failed local read
// silently converts into 'incoming-newer' ⇒ adopt. It is a REVERT, which is ordinary: Peter took the
// document back to the 08 July draft and exported it, so the file's BODY is the old draft while its
// ARCHIVE still carries Wednesday's work. Open that against the live document and:
//   healthy  → incomingIsPast ✓ (local archive has the draft) AND localIsPast ✓ (file's archive has
//              Wednesday's) ⇒ ambiguous ⇒ 'diverged' ⇒ fork, nothing lost.
//   read fails → localSnapshotHashes is [] ⇒ incomingIsPast ✗, localIsPast ✓ ⇒ 'incoming-newer'
//              ⇒ ADOPT ⇒ Wednesday's annotations overwritten by the 08 July draft. The 07-15 loss.
const revertedBundle = async (): Promise<ExportBundle> => {
  const { contentHash } = await import('../provenance/hash')
  const snap = async (text: string, id: string) => ({
    id, documentId: DOC_ID, createdAt: '2026-07-09T00:00:00.000Z', trigger: 'manual',
    contentHash: await contentHash(para(text)), bundleHash: 'b' + id,
    ots: { status: 'unstamped' }, contentJson: para(text), receipts: [],
  })
  return {
    v: 1, exportedAt: '2026-07-10T00:00:00.000Z',
    document: {
      id: DOC_ID, title: 'Honours proposal', contentJson: para('the 08 July draft'),
      createdAt: '2026-07-08T00:00:00.000Z', schemaVersion: '0.1.0',
    },
    // The file's archive carries BOTH — including the local body's content.
    snapshots: [await snap('the 08 July draft', 's1'), await snap("Wednesday's annotations", 's2')],
    receipts: [],
    signingKey: { keyId: 'inkwave-signing-v1', alg: 'Ed25519', publicKeyHex: '00' },
    poolId: 'p',
  } as unknown as ExportBundle
}

const openStale = async () => {
  parsed.current = await revertedBundle()
  await openDoc.openInkwaveFile(new File(['{}'], 'honours-proposal.studio'))
  return (window as unknown as { __iwLastOpenVerdict?: string }).__iwLastOpenVerdict
}

const localBody = async () => {
  const r = await opfs.readDocument(DOC_ID)
  return r.kind === 'found' ? (r.doc.contentJson as { content: { content: { text: string }[] }[] }).content[0].content[0].text : null
}

describe('a stale .studio cannot overwrite through a failed archive read', () => {
  it('KNOWN-POSITIVE: with a healthy archive the ancestry question is ANSWERED, not refused', async () => {
    // Without this the test below is satisfiable by an open path that refuses EVERYTHING — the
    // outage bug wearing the guard's clothes. This proves the harness really does build a local
    // archive, and that the archive is what makes 'incoming-stale' reachable at all.
    await seedLocal()
    const { classifyOpen } = await import('./openConflict')
    const { contentHash } = await import('../provenance/hash')
    const local = await snapshots.listSnapshots(DOC_ID)
    expect(local.length).toBe(2)
    // The local archive really does contain the incoming file's content ⇒ 'incoming-stale' is live.
    expect(classifyOpen({
      localHash: await contentHash(para("Wednesday's annotations")),
      incomingHash: await contentHash(para('the 08 July draft')),
      localSnapshotHashes: local.map((s) => s.contentHash),
      incomingSnapshotHashes: [],
    })).toBe('incoming-stale')
  })

  it('KNOWN-POSITIVE: with a healthy archive the reverted file is ambiguous ⇒ diverged', async () => {
    await seedLocal()
    expect(await openStale()).toBe('diverged') // each archive claims the other — never guess
    expect(await localBody()).toBe("Wednesday's annotations") // the work survives
  })

  it('THE GUARD: a failed archive read must not turn ambiguity into "adopt the old file"', async () => {
    await seedLocal()
    vi.resetModules() // a new session: the write-through cache is empty, so this hits the disk
    openDoc = await import('./openDoc'); opfs = await import('./opfs')
    failOpfsReads((name) => name === 'snapshots.json')

    const verdict = await openStale()
    // On the bug this is 'incoming-newer' and the line below finds 'the 08 July draft'.
    expect(verdict, 'we could not compare, so we do not get to overwrite').toBe('diverged')
    // AND THE POINT OF ALL OF IT: Wednesday's work is still on disk, untouched.
    expect(await localBody()).toBe("Wednesday's annotations")
  })

  it('THE OUTAGE DIRECTION: a failed archive read still OPENS the file (as a separate copy)', async () => {
    // Forking is what keeps the refusal from becoming "this file cannot be opened". A guard that
    // protects the archive by making Peter's own file un-openable has cost him the document instead
    // of the history. Nothing is overwritten AND nothing is unreachable.
    await seedLocal()
    vi.resetModules()
    openDoc = await import('./openDoc'); opfs = await import('./opfs')
    failOpfsReads((name) => name === 'snapshots.json')

    await openStale()
    failOpfsReads(null)
    const docs = await (await import('./opfs')).listDocumentIds()
    expect(docs.length, 'the incoming file opened alongside the local one').toBe(2)
  })

  it('THE OUTAGE DIRECTION: an unreadable archive with NO local body still opens the file', async () => {
    // The narrow case `forked`'s `archiveReadFailed` clause exists for: an archive on disk that
    // won't read, with no current.json beside it. Without that clause the open is NOT forked, so it
    // keeps the file's id, and restoreSnapshotsFromBundle then re-reads the archive that just
    // failed and THROWS out of openDoc — the file simply will not open, forever. Forking gives the
    // incoming snapshots a clean id to land on and leaves the unreadable archive alone.
    await snapshots.createSnapshotIfChanged(docWith('the 08 July draft'), 'manual', [], undefined, true)
    // NB no saveDocument — the archive exists, the body does not.
    vi.resetModules()
    openDoc = await import('./openDoc'); opfs = await import('./opfs')
    failOpfsReads((name) => name === 'snapshots.json')

    await expect(openStale(), 'the file must still open').resolves.not.toThrow()
    failOpfsReads(null)
    expect((await (await import('./opfs')).listDocumentIds()).length).toBe(2)
  })

  it('THE OUTAGE DIRECTION: a brand-new document (no archive at all) still opens normally', async () => {
    // The critical non-regression. A missing snapshots.json is a NotFoundError ⇒ an EMPTY archive,
    // never an 'error' — so a first open on a fresh device must adopt the file under its own id and
    // must NOT fork a spurious copy. If this ever fails, the predicate has been clamped shut.
    const verdict = await openStale()
    expect(verdict).toBe('incoming-newer') // nothing local to lose ⇒ adopt
    const docs = await opfs.listDocumentIds()
    expect(docs.length).toBe(1)
    expect(docs[0], 'adopted under the file id — no spurious fork').toBe(DOC_ID)
  })
})
