// @vitest-environment jsdom
//
// CHARACTERIZATION of "cloud sync and writer-held files" — the editor's orchestration of the
// document's writer-held destinations (a granted folder, OneDrive, Google Drive): connecting them,
// mirroring the record to them, and the state the sync pill reports. BLAST RADIUS: LIVE, no flag,
// Peter's real thesis; this is THE DATA-LOSS FAMILY's code (CLAUDE.md).
//
// WRITTEN BEFORE THE MOVE (2026-09-15, docs/REFACTOR-QUEUE.md item 3, seam 2) from the unmoved
// TiptapEditor.tsx, and run first against a BYTE-FOR-BYTE extraction of its lines (446 lines, one
// difference: the heartbeat's `[doc.id]` → `[docId]`) while TiptapEditor.tsx was still untouched — so
// every case below is an observation of the shipped behaviour, not a guarantee invented here.
//
// WHY A HARNESS AND NOT THE EDITOR. Rendering TiptapEditor in jsdom was tried by seam 1 and abandoned
// on evidence (eight missing platform APIs across three render layers — docs/RULES.md R5). The hook
// runs here with the storage layer mocked at the module boundary: `readSnapshotArchive` (THE local
// read every mirror must go through), the three writers (`syncToOneDrive`, `syncToGoogleDrive`,
// `writeBundleToFile`), the heartbeats, and the sign-in/handle/info calls. Nothing touches OPFS, IDB
// or the network. `cloudSyncWiring.test.ts` pins that the REAL editor still calls what this returns.
//
// ⚠ THE NAMED RULE (CLAUDE.md, "The cloud mirrors do not re-read"): `syncToOneDrive` takes the array
// it is handed, so a mirror that PUTs after a failed local read pushes a SHORT archive over the
// writer's history. The three "archive unreadable" tests below are that rule; their mutants are the
// ones that matter most.
//
// MUTATION-PROVED 2026-09-15, each applied to useCloudSync.ts (the byte-identical extraction, before
// TiptapEditor.tsx was rewired), the named test(s) observed to fail, then reverted — 10 of 10 die:
//   m1  drop the OneDrive mirror's `r.kind === 'error'` return  → 1 fails (OneDrive: failed local read means NO PUT)
//   m2  drop the Drive mirror's                                 → 1 fails (Drive: never reaches syncToGoogleDrive)
//   m3  drop the folder mirror's                                → 1 fails (folder: skips, does NOT drop the link)
//   m4  ONEDRIVE_MIN_INTERVAL = 0                               → 2 fail  (deferred within 20s; burst lands once)
//   m5  drop the trailing flush (`else` branch)                 → 2 fail  (the same two)
//   m6  heartbeat reads the LOCAL file while OneDrive is active → 2 fail  (remote heartbeat; doc switch)
//   m7  Drive resume re-uploads on load                         → 1 fails (metadata GET only)
//   m8  a failed folder WRITE no longer drops the link          → 1 fails (failed write → reconnect)
//   m9  re-link on load rewrites the bundle                     → 2 fail  (re-link only; Open… re-link)
//   m10 mirrorIfActive skips ensureDocFresh                     → 1 fails (rebuilds the document first)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import type { InkwaveDocument, Snapshot } from '../types/document'

// ─── the storage layer, mocked at the module boundary ────────────────────────────────────────
vi.mock('../provenance/snapshots', () => ({ readSnapshotArchive: vi.fn() }))
vi.mock('../storage/folder', () => ({
  pickSaveFile: vi.fn(), getSaveFileHandle: vi.fn(), getSaveFileName: vi.fn(),
  writeBundleToFile: vi.fn(), readLocalHeartbeat: vi.fn(), preMergeSaveFile: vi.fn(),
}))
vi.mock('../storage/onedrive', () => ({
  oneDriveConfigured: vi.fn(), oneDriveAccount: vi.fn(), syncToOneDrive: vi.fn(), startOneDriveSignIn: vi.fn(),
  oneDriveSyncPending: vi.fn(), clearOneDriveSyncPending: vi.fn(), setChosenFolder: vi.fn(), addRecentFolder: vi.fn(),
  renameOneDriveFile: vi.fn(), oneDriveFilename: vi.fn(), downloadOneDriveFile: vi.fn(), getOneDriveItemTag: vi.fn(),
  readRemoteHeartbeat: vi.fn(), getRemoteFileInfo: vi.fn(), preMergeRemote: vi.fn(), fetchMissingSidecars: vi.fn(),
}))
vi.mock('../storage/gdrive', () => ({
  googleDriveConfigured: vi.fn(), startGoogleDriveSignIn: vi.fn(), syncToGoogleDrive: vi.fn(), clearGoogleDriveFile: vi.fn(),
  setChosenGDriveFolder: vi.fn(), renameGoogleDriveFile: vi.fn(), downloadGoogleDriveFileBlob: vi.fn(), getGDriveFileTag: vi.fn(),
  googleDriveFileId: vi.fn(), addRecentGDriveFolder: vi.fn(), getGDriveFileInfo: vi.fn(), preMergeGDrive: vi.fn(),
}))
vi.mock('../sync/presence', () => ({ isOtherDeviceActive: vi.fn() }))
vi.mock('../storage/docSource', () => ({
  getRecognisedSave: vi.fn(), setDocSource: vi.fn(), getDocSource: vi.fn(), recognisedSaveIsLive: vi.fn(),
}))
vi.mock('../storage/openDoc', () => ({ openInkwaveFile: vi.fn() }))
vi.mock('../storage/openCache', () => ({ getCachedOpen: vi.fn(), putCachedOpen: vi.fn(), warmCloudOpen: vi.fn() }))
vi.mock('../storage/openPerf', () => ({ openPerfStart: vi.fn(), openPerfStep: vi.fn(), openPerfAbort: vi.fn() }))
vi.mock('../storage/openError', () => ({ reportOpenError: vi.fn() }))
vi.mock('../citations/library', () => ({ loadLibrary: vi.fn() }))
vi.mock('../citations/bibProvider', () => ({ bibProvider: { getAll: () => [] } }))

import { readSnapshotArchive } from '../provenance/snapshots'
import * as folder from '../storage/folder'
import * as od from '../storage/onedrive'
import * as gd from '../storage/gdrive'
import { isOtherDeviceActive } from '../sync/presence'
import { getDocSource, getRecognisedSave } from '../storage/docSource'
import { useCloudSync } from './useCloudSync'

const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f)
const doc = (id = 'doc-1'): InkwaveDocument => ({
  id, title: 'T', contentJson: { type: 'doc', content: [] }, createdAt: '2026-01-01T00:00:00+10:00', updatedAt: '2026-01-01T00:00:00+10:00',
} as unknown as InkwaveDocument)
const found = (snapshots: Snapshot[] = []) => ({ kind: 'found' as const, snapshots })
const unreadable = () => ({ kind: 'error' as const, error: new Error('OPFS read failed (transient I/O)') as never })

// The three functions the hook is HANDED (save orchestration, which stays in the editor).
interface Given { snaps: Snapshot[] | null }
function harness(given: Given = { snaps: [] }, id = 'doc-1') {
  const log = { ensureDocFresh: 0, snapshotsForAction: [] as string[], quiet: [] as { fn: () => void; ms: number | undefined }[] }
  const hook = renderHook(({ docId }) => {
    const docRef = useRef(doc(docId))
    return useCloudSync({
      docRef, docId,
      ensureDocFresh: () => { log.ensureDocFresh++; return docRef.current },
      snapshotsForAction: async (a) => { log.snapshotsForAction.push(a); return given.snaps },
      runWhenQuiet: (fn, ms) => { log.quiet.push({ fn, ms }) },
    })
  }, { initialProps: { docId: id } })
  return { hook, log }
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  // A quiet baseline: nothing configured, nothing linked, every read finds an empty archive.
  m(od.oneDriveConfigured).mockReturnValue(false)
  m(gd.googleDriveConfigured).mockReturnValue(false)
  m(od.oneDriveAccount).mockResolvedValue(null)
  m(od.oneDriveSyncPending).mockReturnValue(false)
  m(od.oneDriveFilename).mockReturnValue(null)
  m(gd.googleDriveFileId).mockReturnValue(null)
  m(getDocSource).mockReturnValue(null)
  m(folder.getSaveFileHandle).mockResolvedValue(null)
  m(folder.getSaveFileName).mockResolvedValue(null)
  m(readSnapshotArchive).mockResolvedValue(found())
  m(od.syncToOneDrive).mockResolvedValue({ ok: true, webUrl: 'https://od/x' })
  m(gd.syncToGoogleDrive).mockResolvedValue({ ok: true, webUrl: 'https://gd/x' })
  m(folder.writeBundleToFile).mockResolvedValue(true)
  m(isOtherDeviceActive).mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

// Link OneDrive the way the writer does: "Sync to OneDrive" with a signed-in account.
async function linkOneDrive(h: ReturnType<typeof harness>) {
  m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
  await act(async () => { await h.hook.result.current.syncOneDrive() })
}
async function linkDrive(h: ReturnType<typeof harness>) {
  m(gd.startGoogleDriveSignIn).mockResolvedValue(true)
  await act(async () => { await h.hook.result.current.syncGoogleDrive() })
}
async function linkFolder(h: ReturnType<typeof harness>) {
  m(folder.pickSaveFile).mockResolvedValue({ name: 'thesis.studio' } as FileSystemFileHandle)
  await act(async () => { await h.hook.result.current.saveToFile() })
}

// ─── mirrorIfActive: the provenance checkpoint's mirror ──────────────────────────────────────
describe('mirrorIfActive', () => {
  it('rebuilds the document first and does nothing else while nothing is linked', async () => {
    const h = harness()
    await flush()
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(h.log.ensureDocFresh).toBe(1)
    expect(readSnapshotArchive).not.toHaveBeenCalled()
    expect(od.syncToOneDrive).not.toHaveBeenCalled()
    expect(gd.syncToGoogleDrive).not.toHaveBeenCalled()
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
  })

  // THE RULE. `syncToOneDrive` writes the array it is handed; a mirror after a failed local read
  // would hand it a short one. The read is `readSnapshotArchive`, and 'error' means NO PUT.
  it('OneDrive: a failed local archive read means NO PUT (the load-bearing local-read check)', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1) // the explicit "Sync to OneDrive" itself
    await tick(20_000) // past the throttle, so the mirror below would write IMMEDIATELY
    m(readSnapshotArchive).mockResolvedValue(unreadable())
    const before = h.hook.result.current.lastSync
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(readSnapshotArchive).toHaveBeenCalledWith('doc-1')
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1) // no second PUT
    expect(h.hook.result.current.lastSync).toBe(before)
    // and the same mirror, with a readable archive, DOES write — the guard is not clamped shut
    m(readSnapshotArchive).mockResolvedValue(found())
    await tick(20_000)
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(2)
  })

  it('Google Drive: a failed local archive read never reaches syncToGoogleDrive', async () => {
    const h = harness()
    await flush()
    await linkDrive(h)
    expect(gd.syncToGoogleDrive).toHaveBeenCalledTimes(1)
    m(readSnapshotArchive).mockResolvedValue(unreadable())
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(gd.syncToGoogleDrive).toHaveBeenCalledTimes(1)
    m(readSnapshotArchive).mockResolvedValue(found())
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(gd.syncToGoogleDrive).toHaveBeenCalledTimes(2) // Drive has no throttle
  })

  // The folder mirror's read and write are SEPARATE: a failed READ skips this mirror and keeps the
  // link; a failed WRITE is a lapsed permission and drops it (reconnect state).
  it('folder: a failed archive read skips the mirror and does NOT drop the link', async () => {
    const h = harness()
    await flush()
    await linkFolder(h)
    expect(folder.writeBundleToFile).toHaveBeenCalledTimes(1)
    m(readSnapshotArchive).mockResolvedValue(unreadable())
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(folder.writeBundleToFile).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.needsReconnect).toBe(false)
    expect(h.hook.result.current.fileName).toBe('thesis.studio')
  })
  it('folder: a failed WRITE drops the link and asks for a reconnect; the next mirror skips the folder', async () => {
    const h = harness()
    await flush()
    await linkFolder(h)
    m(folder.writeBundleToFile).mockResolvedValue(false)
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(h.hook.result.current.needsReconnect).toBe(true)
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(folder.writeBundleToFile).toHaveBeenCalledTimes(2) // the link + the failed one; not a third
  })
})

// ─── the OneDrive write throttle ─────────────────────────────────────────────────────────────
describe('the OneDrive write throttle (20s, trailing flush)', () => {
  it('the first mirror after a quiet interval writes immediately', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    await tick(20_000)
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(2)
  })
  it('a second write within 20s is deferred to the interval boundary', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h) // sets the clock: lastWrite = now
    act(() => h.hook.result.current.mirrorIfActive())
    await tick(19_990)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
    await tick(10)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(2)
  })
  it('a burst of mirrors inside the window lands exactly ONE trailing PUT, and it lands', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    for (let i = 0; i < 6; i++) { act(() => h.hook.result.current.mirrorIfActive()); await tick(1_000) }
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
    await tick(20_000)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(2)
    await tick(60_000)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(2) // nothing re-arms on its own
  })
  it('a successful PUT records the time and the link', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    await tick(20_000)
    m(od.syncToOneDrive).mockResolvedValue({ ok: true, webUrl: 'https://od/after' })
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(h.hook.result.current.lastSync).toBe(Date.now())
    expect(h.hook.result.current.oneDriveUrl).toBe('https://od/after')
  })
})

// ─── connecting: the explicit sync actions ───────────────────────────────────────────────────
describe('the explicit sync actions', () => {
  it('Sync to OneDrive with no account starts sign-in and writes nothing', async () => {
    const h = harness()
    await flush()
    await act(async () => { await h.hook.result.current.syncOneDrive() })
    expect(od.startOneDriveSignIn).toHaveBeenCalledTimes(1)
    expect(od.syncToOneDrive).not.toHaveBeenCalled()
  })
  it('Sync to OneDrive reads the archive through snapshotsForAction and refuses on null', async () => {
    const h = harness({ snaps: null })
    await flush()
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    await act(async () => { await h.hook.result.current.syncOneDrive() })
    expect(h.log.snapshotsForAction).toEqual(['the sync to OneDrive'])
    expect(od.syncToOneDrive).not.toHaveBeenCalled()
    expect(h.hook.result.current.oneDriveAcct).toBeNull()
  })
  it('a successful OneDrive sync reports the account, time and link', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    expect(h.hook.result.current.oneDriveAcct).toBe('writer@example.test')
    expect(h.hook.result.current.lastSync).toBe(Date.now())
    expect(h.hook.result.current.oneDriveUrl).toBe('https://od/x')
  })
  it('a signed-in sync that the service refuses re-runs sign-in (re-consent)', async () => {
    const h = harness()
    await flush()
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    m(od.syncToOneDrive).mockResolvedValue({ ok: false, webUrl: null })
    await act(async () => { await h.hook.result.current.syncOneDrive() })
    expect(od.startOneDriveSignIn).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.oneDriveAcct).toBeNull()
  })
  it('ONE cloud destination at a time: linking Drive after OneDrive, and back', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    await linkDrive(h)
    expect(h.hook.result.current.gdriveActive).toBe(true)
    // a mirror now goes to Drive, not OneDrive
    await tick(20_000)
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(gd.syncToGoogleDrive).toHaveBeenCalledTimes(2)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
    await linkOneDrive(h)
    expect(h.hook.result.current.gdriveActive).toBe(false)
  })
  it('a FRESH Drive connect opens the folder picker; a re-sync of an active link does not', async () => {
    const h = harness()
    await flush()
    await linkDrive(h)
    expect(h.hook.result.current.gdrivePickerOpen).toBe(true)
    act(() => h.hook.result.current.setGdrivePickerOpen(false))
    await linkDrive(h)
    expect(h.hook.result.current.gdrivePickerOpen).toBe(false)
  })
  it('a Drive sign-in the writer cancels writes nothing', async () => {
    const h = harness()
    await flush()
    m(gd.startGoogleDriveSignIn).mockResolvedValue(false)
    await act(async () => { await h.hook.result.current.syncGoogleDrive() })
    expect(gd.syncToGoogleDrive).not.toHaveBeenCalled()
    expect(h.hook.result.current.gdriveActive).toBe(false)
  })
  it('picking a Drive folder forgets the current file, then syncs into the folder', async () => {
    const h = harness()
    await flush()
    await act(async () => { await h.hook.result.current.onGdriveFolderPicked('') })
    expect(gd.setChosenGDriveFolder).toHaveBeenCalledWith(null) // '' = My Drive root
    expect(gd.clearGoogleDriveFile).toHaveBeenCalledWith('doc-1')
    expect(gd.syncToGoogleDrive).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.gdriveActive).toBe(true)
  })
  it('picking a OneDrive folder remembers it and syncs there', async () => {
    const h = harness()
    await flush()
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    const f = { id: 'f1', path: '/Documents/Thesis' }
    await act(async () => { await h.hook.result.current.onFolderPicked(f) })
    expect(od.setChosenFolder).toHaveBeenCalledWith(f)
    expect(od.addRecentFolder).toHaveBeenCalledWith(f)
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
  })
})

// ─── the local (Chromium) file ───────────────────────────────────────────────────────────────
describe('the linked local file', () => {
  it('first Save picks a file INSIDE the gesture, links it, and writes through the guarded read', async () => {
    const h = harness()
    await flush()
    await linkFolder(h)
    expect(folder.pickSaveFile).toHaveBeenCalledTimes(1)
    expect(h.log.snapshotsForAction).toContain('the save')
    expect(folder.writeBundleToFile).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.fileName).toBe('thesis.studio')
    expect(h.hook.result.current.lastFileSave).toBe(Date.now())
  })
  it('a cancelled picker links nothing', async () => {
    const h = harness()
    await flush()
    m(folder.pickSaveFile).mockResolvedValue(null)
    await act(async () => { await h.hook.result.current.saveToFile() })
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
    expect(h.hook.result.current.fileName).toBeNull()
  })
  it('a save whose archive read was cancelled writes nothing', async () => {
    const h = harness({ snaps: null })
    await flush()
    m(folder.pickSaveFile).mockResolvedValue({ name: 'thesis.studio' } as FileSystemFileHandle)
    await act(async () => { await h.hook.result.current.saveToFile() })
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
  })
  // LOAD-PATH RULE: re-link only — never rebuild and rewrite a possibly-20MB file before anything
  // has changed. The "last saved" time comes from the recognised-save record, not from a write.
  it('on load, a still-granted handle RE-LINKS without writing; the recognised save supplies the time', async () => {
    m(folder.getSaveFileHandle).mockResolvedValue({ name: 'thesis.studio' } as never)
    m(getRecognisedSave).mockReturnValue({ destination: 'local', at: 1234 } as never)
    const { recognisedSaveIsLive } = await import('../storage/docSource')
    m(recognisedSaveIsLive).mockReturnValue(true)
    const h = harness()
    await flush()
    expect(folder.getSaveFileHandle).toHaveBeenCalledWith('doc-1', false) // never interactive on load
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
    expect(h.hook.result.current.fileName).toBe('thesis.studio')
    expect(h.hook.result.current.needsReconnect).toBe(false)
    expect(h.hook.result.current.lastFileSave).toBe(1234)
  })
  it('on load, a linked file whose permission lapsed shows RECONNECT, never "synced"', async () => {
    m(folder.getSaveFileName).mockResolvedValue('thesis.studio')
    const h = harness()
    await flush()
    expect(h.hook.result.current.fileName).toBe('thesis.studio')
    expect(h.hook.result.current.needsReconnect).toBe(true)
    // a mirror now writes nothing — the link is not live
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
  })
  it('reconnect re-requests the handle INTERACTIVELY and writes once', async () => {
    m(folder.getSaveFileName).mockResolvedValue('thesis.studio')
    const h = harness()
    await flush()
    m(folder.getSaveFileHandle).mockResolvedValue({ name: 'thesis.studio' } as never)
    await act(async () => { await h.hook.result.current.reconnectFolder() })
    expect(folder.getSaveFileHandle).toHaveBeenLastCalledWith('doc-1', true)
    expect(folder.writeBundleToFile).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.needsReconnect).toBe(false)
  })
  it('"Open…" re-links live through inkwave:save-file-linked', async () => {
    const h = harness()
    await flush()
    m(folder.getSaveFileHandle).mockResolvedValue({ name: 'opened.studio' } as never)
    act(() => { window.dispatchEvent(new Event('inkwave:save-file-linked')) })
    await flush()
    expect(h.hook.result.current.fileName).toBe('opened.studio')
    expect(folder.writeBundleToFile).not.toHaveBeenCalled()
  })
})

// ─── resuming a cloud link on load ───────────────────────────────────────────────────────────
describe('resuming on load', () => {
  // LOAD-PATH RULE: a metadata GET validates the token and fetches the link; no bundle rebuild, no
  // upload, on open. The next provenance checkpoint mirrors as usual.
  it('a Drive-sourced document resumes with a metadata GET only — no upload', async () => {
    m(gd.googleDriveConfigured).mockReturnValue(true)
    m(getDocSource).mockReturnValue('gdrive')
    m(gd.googleDriveFileId).mockReturnValue('file-1')
    m(gd.getGDriveFileInfo).mockResolvedValue({ webUrl: 'https://gd/resumed', modifiedAt: 1 })
    const h = harness()
    await flush()
    expect(gd.getGDriveFileInfo).toHaveBeenCalledWith('doc-1')
    expect(gd.syncToGoogleDrive).not.toHaveBeenCalled()
    expect(h.hook.result.current.gdriveActive).toBe(true)
    expect(h.hook.result.current.gdriveUrl).toBe('https://gd/resumed')
  })
  it('a Drive-sourced document with no silent token stays inactive', async () => {
    m(gd.googleDriveConfigured).mockReturnValue(true)
    m(getDocSource).mockReturnValue('gdrive')
    m(gd.googleDriveFileId).mockReturnValue('file-1')
    m(gd.getGDriveFileInfo).mockResolvedValue(null)
    const h = harness()
    await flush()
    expect(h.hook.result.current.gdriveActive).toBe(false)
  })
  it('a OneDrive-sourced document resumes with a metadata GET only — no upload', async () => {
    m(od.oneDriveConfigured).mockReturnValue(true)
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    m(getDocSource).mockReturnValue('onedrive')
    m(od.oneDriveFilename).mockReturnValue('thesis.studio')
    m(od.getRemoteFileInfo).mockResolvedValue({ webUrl: 'https://od/resumed', modifiedAt: 1 })
    const h = harness()
    await flush()
    expect(od.syncToOneDrive).not.toHaveBeenCalled()
    expect(h.hook.result.current.oneDriveAcct).toBe('writer@example.test')
    expect(h.hook.result.current.oneDriveUrl).toBe('https://od/resumed')
    // and the resumed link is LIVE: the next checkpoint mirrors to it
    act(() => h.hook.result.current.mirrorIfActive())
    await flush()
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
  })
  it('returning from the Microsoft sign-in redirect syncs once and opens the folder picker', async () => {
    m(od.oneDriveConfigured).mockReturnValue(true)
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    m(od.oneDriveSyncPending).mockReturnValue(true)
    const h = harness()
    await flush()
    expect(od.clearOneDriveSyncPending).toHaveBeenCalledTimes(1)
    expect(h.log.snapshotsForAction).toEqual(['the sync to OneDrive'])
    expect(od.syncToOneDrive).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.folderPickerOpen).toBe(true)
    expect(h.hook.result.current.lastSync).toBe(Date.now())
  })
  it('the post-sign-in sync refuses when the archive read was cancelled', async () => {
    m(od.oneDriveConfigured).mockReturnValue(true)
    m(od.oneDriveAccount).mockResolvedValue('writer@example.test')
    m(od.oneDriveSyncPending).mockReturnValue(true)
    const h = harness({ snaps: null })
    await flush()
    expect(od.syncToOneDrive).not.toHaveBeenCalled()
    expect(h.hook.result.current.folderPickerOpen).toBe(false)
  })
  it('an unconfigured provider is never asked anything', async () => {
    harness()
    await flush()
    expect(od.oneDriveAccount).not.toHaveBeenCalled()
    expect(gd.getGDriveFileInfo).not.toHaveBeenCalled()
  })
})

// ─── the idle pre-merge + cloud-open warm ────────────────────────────────────────────────────
describe('the idle work', () => {
  it('pre-merges the local file at idle; the cloud targets only while active; warms cloud open at 3s', async () => {
    const h = harness()
    await flush()
    const warm = h.log.quiet.find((q) => q.ms === 3000)
    expect(warm).toBeDefined()
    const { warmCloudOpen } = await import('../storage/openCache')
    warm!.fn()
    expect(warmCloudOpen).toHaveBeenCalledTimes(1)
    const pre = h.log.quiet.find((q) => q.ms === undefined)
    expect(pre).toBeDefined()
    pre!.fn()
    expect(folder.preMergeSaveFile).toHaveBeenCalledWith('doc-1')
    expect(od.preMergeRemote).not.toHaveBeenCalled()
    expect(gd.preMergeGDrive).not.toHaveBeenCalled()
    expect(od.fetchMissingSidecars).not.toHaveBeenCalled()
  })
  it('with OneDrive active the idle pass pre-merges the remote and heals sidecars', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    const { loadLibrary } = await import('../citations/library')
    m(loadLibrary).mockResolvedValue(undefined)
    const pre = h.log.quiet.find((q) => q.ms === undefined)!
    pre.fn()
    await flush()
    expect(od.preMergeRemote).toHaveBeenCalledTimes(1)
    expect(od.fetchMissingSidecars).toHaveBeenCalledWith('doc-1', [])
    expect(gd.preMergeGDrive).not.toHaveBeenCalled()
  })
})

// ─── the other-device heartbeat ──────────────────────────────────────────────────────────────
describe('the other-device heartbeat', () => {
  it('reads nothing while nothing is linked, and polls every 45s', async () => {
    harness()
    await flush()
    await tick(45_000)
    expect(od.readRemoteHeartbeat).not.toHaveBeenCalled()
    expect(folder.readLocalHeartbeat).not.toHaveBeenCalled()
  })
  it('reads the REMOTE heartbeat while OneDrive is active, and flags another device', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    m(od.readRemoteHeartbeat).mockResolvedValue({ session: 'other', exportedAt: '2026-01-01T00:00:00+10:00' })
    m(isOtherDeviceActive).mockReturnValue(true)
    await tick(45_000)
    expect(od.readRemoteHeartbeat).toHaveBeenCalled()
    expect(folder.readLocalHeartbeat).not.toHaveBeenCalled()
    expect(isOtherDeviceActive).toHaveBeenCalledWith('other', '2026-01-01T00:00:00+10:00')
    expect(h.hook.result.current.otherDevice).toBe(true)
    // metadata only: the heartbeat never downloads the file
    expect(od.downloadOneDriveFile).not.toHaveBeenCalled()
  })
  it('reads the LOCAL heartbeat while only the folder is linked', async () => {
    const h = harness()
    await flush()
    await linkFolder(h)
    m(folder.readLocalHeartbeat).mockResolvedValue(null)
    await tick(45_000)
    expect(folder.readLocalHeartbeat).toHaveBeenCalledWith('doc-1')
    expect(od.readRemoteHeartbeat).not.toHaveBeenCalled()
    expect(h.hook.result.current.otherDevice).toBe(false)
  })
  it('a document switch clears the verdict and the dismissal', async () => {
    const h = harness()
    await flush()
    await linkOneDrive(h)
    m(od.readRemoteHeartbeat).mockResolvedValue({ session: 'other', exportedAt: 'x' })
    m(isOtherDeviceActive).mockReturnValue(true)
    await tick(45_000)
    expect(h.hook.result.current.otherDevice).toBe(true)
    act(() => h.hook.result.current.setConflictDismissed(true))
    expect(h.hook.result.current.conflictDismissed).toBe(true)
    m(isOtherDeviceActive).mockReturnValue(false)
    h.hook.rerender({ docId: 'doc-2' })
    await flush()
    expect(h.hook.result.current.otherDevice).toBe(false)
    expect(h.hook.result.current.conflictDismissed).toBe(false)
  })
})
