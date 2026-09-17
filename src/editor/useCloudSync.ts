// ─── Cloud sync + writer-held files — the editor's orchestration ───
// ⚠ THE DATA-LOSS FAMILY LIVES HERE (CLAUDE.md, "⚠ THE DATA-LOSS FAMILY"; docs/archive/
// data-loss-incidents.md). Every write path in this file is a MIRROR of the record to a destination
// the writer holds — a granted folder, OneDrive, Google Drive — and none of them re-reads: each takes
// the array it is handed. So every mirror reads the archive THROUGH `readSnapshotArchive` and REFUSES
// on `{ kind: 'error' }`. A failed read is not an empty archive; a short archive pushed at a cloud
// target truncates the writer's history. Do not collapse a refusal into `.catch(() => [])`.
//
// WHAT THIS FILE IS (2026-09-15, docs/REFACTOR-QUEUE.md item 3, seam 2): the document's writer-held
// destinations — a granted folder (Chromium), OneDrive, Google Drive — connecting them (sign-in,
// pickers, openers, re-link on load), mirroring the record to them at every provenance checkpoint
// (`mirrorIfActive`, with the OneDrive write throttle), and the state the sync pill reports (last
// sync, links, reconnect, the other-device heartbeat). Moved VERBATIM out of TiptapEditor.tsx; the
// pill, the pickers and the ⋮ menu (the JSX) stay there, and `cloudSyncWiring.test.ts` pins that
// they still attach what this hook hands back. Behaviour is pinned in `useCloudSync.test.tsx`.
//
// WHAT STAYS OUT, deliberately. `snapshotsForAction` (the R1 archive-read guard every PUBLISHING
// action shares — export, snapshots, sync) and `ensureDocFresh` (the lazy doc rebuild) are save
// orchestration; both arrive as inputs. The unsynced-work notice is a CONSUMER of this hook's state
// (it READS `fileName` / `needsReconnect` / `oneDriveAcct` / `gdriveActive`, never awaits them) and
// stays with its pure rule's wiring in TiptapEditor.tsx. `ensureDocFresh` writes three of this hook's
// setters (a rebuilt document is, by definition, not yet mirrored) — that is the one two-way coupling,
// and it is exposed as `setLastFileSave` / `setLastSync` / `setLastGdriveSync` rather than hidden.
//
// ⚠ EFFECT ORDER (docs/RULES.md R7). TiptapEditor calls this hook where the sync STATE block stood
// (before the tab-title effect that reads `fileName`), not where the sync effects stood — so its six
// effects now run EARLIER in the component's sequence (positions 5–10, formerly 55–60). That is
// safe because every one of them acts asynchronously (a promise `.then`, `runWhenQuiet`, a 45s
// interval) or through order-free synchronous acts (two `setState(false)` and one listener on an
// event nothing else in the editor listens to); none reads a value another effect sets
// synchronously. The three functions this hook is handed are FUNCTION DECLARATIONS in TiptapEditor
// (hoisted), and the hook never calls any of them during render.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { InkwaveDocument, Snapshot } from '../types/document'
import { readSnapshotArchive } from '../provenance/snapshots'
import { pickSaveFile, getSaveFileHandle, getSaveFileName, writeBundleToFile, readLocalHeartbeat, preMergeSaveFile } from '../storage/folder'
import { oneDriveConfigured, oneDriveAccount, syncToOneDrive, startOneDriveSignIn, oneDriveSyncPending, clearOneDriveSyncPending, setChosenFolder, addRecentFolder, renameOneDriveFile, oneDriveFilename, downloadOneDriveFile, getOneDriveItemTag, readRemoteHeartbeat, getRemoteFileInfo, preMergeRemote, fetchMissingSidecars, type OneDriveFolder } from '../storage/onedrive'
import { googleDriveConfigured, startGoogleDriveSignIn, syncToGoogleDrive, clearGoogleDriveFile, setChosenGDriveFolder, renameGoogleDriveFile, downloadGoogleDriveFileBlob, getGDriveFileTag, googleDriveFileId, addRecentGDriveFolder, getGDriveFileInfo, preMergeGDrive } from '../storage/gdrive'
import { isOtherDeviceActive } from '../sync/presence'
import { getRecognisedSave, setDocSource, getDocSource, recognisedSaveIsLive } from '../storage/docSource'
import { openInkwaveFile } from '../storage/openDoc'
import { getCachedOpen, putCachedOpen, warmCloudOpen, type OpenCacheProvider } from '../storage/openCache'
import { openPerfStart, openPerfStep, openPerfAbort } from '../storage/openPerf'
import { reportOpenError } from '../storage/openError'
import { loadLibrary } from '../citations/library'
import { bibProvider } from '../citations/bibProvider'

export interface CloudSyncInput {
  /** The component's live document mirror — every mirror reads it, this hook never writes it. */
  docRef: MutableRefObject<InkwaveDocument>
  /** The open document's id — the heartbeat effect re-arms (and clears its dismissal) on a switch. */
  docId: string
  /** The lazy doc rebuild: a mirror writes docRef, never a stale one. */
  ensureDocFresh: () => InkwaveDocument
  /** The R1 archive read for any action that PUBLISHES the record — null means "cancelled, told". */
  snapshotsForAction: (action: string) => Promise<Snapshot[] | null>
  /** The quiet scheduler: heavy archive pre-merges run only once the writer is genuinely idle. */
  runWhenQuiet: (fn: () => void, quietMs?: number) => void
}

export interface CloudSync {
  // ── what the pill, the ⋮ menu and the unsynced notice READ ──
  oneDriveAcct: string | null
  lastSync: number | null
  oneDriveUrl: string | null
  gdriveActive: boolean
  lastGdriveSync: number | null
  gdriveUrl: string | null
  fileName: string | null
  needsReconnect: boolean
  lastFileSave: number | null
  otherDevice: boolean
  conflictDismissed: boolean
  setConflictDismissed: Dispatch<SetStateAction<boolean>>
  /** The one two-way coupling: `ensureDocFresh` marks a rebuilt document as not-yet-mirrored. */
  setLastFileSave: Dispatch<SetStateAction<number | null>>
  setLastSync: Dispatch<SetStateAction<number | null>>
  setLastGdriveSync: Dispatch<SetStateAction<number | null>>
  // ── the pickers / openers (mounted by the JSX on these) ──
  folderPickerOpen: boolean
  setFolderPickerOpen: Dispatch<SetStateAction<boolean>>
  gdrivePickerOpen: boolean
  setGdrivePickerOpen: Dispatch<SetStateAction<boolean>>
  odOpenerOpen: boolean
  setOdOpenerOpen: Dispatch<SetStateAction<boolean>>
  gdriveOpenerOpen: boolean
  setGdriveOpenerOpen: Dispatch<SetStateAction<boolean>>
  // ── the actions ──
  /** Mirror the record to whatever is linked — called at every provenance checkpoint. */
  mirrorIfActive: () => void
  syncOneDrive: () => Promise<void>
  syncGoogleDrive: () => Promise<void>
  saveAsGoogleDrive: () => Promise<void>
  chooseGoogleDriveFolder: () => void
  onGdriveFolderPicked: (folderId: string) => Promise<void>
  chooseOneDriveFolder: () => Promise<void>
  onFolderPicked: (folder: OneDriveFolder) => Promise<void>
  renameGdriveFileNow: (name: string) => Promise<void>
  renameOneDriveFileNow: (name: string) => Promise<void>
  uploadFromGoogleDrive: () => Promise<void>
  onGdriveFileOpen: (f: { id: string; name: string; folderId: string; folderName: string; tag?: string; fresh?: boolean }) => Promise<void>
  uploadFromOneDrive: () => Promise<void>
  onOneDriveFileOpen: (f: { itemId: string; name: string; folder: OneDriveFolder; cTag?: string; fresh?: boolean }) => Promise<void>
  saveAsOneDrive: () => Promise<void>
  saveToFile: () => Promise<void>
  showInFolder: () => Promise<void>
  saveAsFile: () => Promise<void>
  reconnectFolder: () => Promise<void>
}

export function useCloudSync({ docRef, docId, ensureDocFresh, snapshotsForAction, runWhenQuiet }: CloudSyncInput): CloudSync {
  // Writer-held folder mirror (M4, Chromium only). Tracked in a ref read by the (non-React)
  // snapshot/period callbacks (saving/sync UI lives in the ⋮ menu, not the snapshots panel).
  const folderActiveRef = useRef(false)
  // OneDrive sync (Microsoft Graph) — cross-browser cloud storage for non-Chromium writers.
  const [oneDriveAcct, setOneDriveAcct] = useState<string | null>(null)
  const oneDriveActiveRef = useRef(false)
  // OneDrive write throttle: rapid PUTs to the same file race the OneDrive DESKTOP client (which
  // then makes "<name>-MACHINE.json" conflict copies). Local folder writes are instant; OneDrive is
  // throttled to one write per interval with a trailing flush.
  const oneDriveLastWriteRef = useRef(0)
  const oneDriveTrailingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastSync, setLastSync] = useState<number | null>(null) // ms epoch of last successful OneDrive sync
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [gdrivePickerOpen, setGdrivePickerOpen] = useState(false)
  const [odOpenerOpen, setOdOpenerOpen] = useState(false)
  const [gdriveOpenerOpen, setGdriveOpenerOpen] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null) // linked local save file name (Chromium)
  const [lastFileSave, setLastFileSave] = useState<number | null>(null)
  const [oneDriveUrl, setOneDriveUrl] = useState<string | null>(null) // synced file's webUrl (open in folder)
  // Google Drive sync (Firefox/Safari alternative to OneDrive).
  const gdriveActiveRef = useRef(false)
  const [gdriveActive, setGdriveActive] = useState(false)
  const [lastGdriveSync, setLastGdriveSync] = useState<number | null>(null)
  const [gdriveUrl, setGdriveUrl] = useState<string | null>(null)
  const [otherDevice, setOtherDevice] = useState(false) // another device looks active on this doc
  const [conflictDismissed, setConflictDismissed] = useState(false)
  const [needsReconnect, setNeedsReconnect] = useState(false) // linked file exists but write permission lapsed

  // Mirror the record to whatever the writer linked — a granted folder (Chromium) and/or OneDrive
  // (any browser). No-op if neither is active. OneDrive auto-sync is silent (no popup); if the
  // token has expired it simply skips until the next explicit sync.
  function mirrorIfActive() {
    ensureDocFresh() // mirrors write docRef — never a stale one
    if (folderActiveRef.current) {
      // ⚠ The archive READ is separated from the WRITE deliberately: sharing a `.catch` reports a
      // transient archive fault as "your folder permission lapsed" and drops the link. A failed
      // read means only "skip THIS mirror" — the next kick mirrors the full archive.
      void readSnapshotArchive(docRef.current.id)
        .then((r) => {
          if (r.kind === 'error') { console.warn('[inkwave] folder mirror skipped — archive unreadable:', r.error); return }
          return writeBundleToFile(docRef.current, r.snapshots)
            // A failed write means permission lapsed — stop claiming "synced" and prompt a reconnect.
            .then((ok) => { if (ok) { setLastFileSave(Date.now()); setDocSource(docRef.current.id, 'local') } else { folderActiveRef.current = false; setNeedsReconnect(true) } })
            .catch(() => { folderActiveRef.current = false; setNeedsReconnect(true) })
        })
    }
    if (oneDriveActiveRef.current) scheduleOneDriveSync()
    if (gdriveActiveRef.current) {
      // Silent auto-mirror: a failed archive read skips this cycle rather than pushing a SHORT
      // archive at Drive. It must never reach `syncToGoogleDrive`.
      void readSnapshotArchive(docRef.current.id)
        .then((r) => {
          if (r.kind === 'error') { console.warn('[inkwave] Drive mirror skipped — archive unreadable:', r.error); return }
          return syncToGoogleDrive(docRef.current, r.snapshots)
            .then((res) => { if (res.ok) { setLastGdriveSync(Date.now()); setGdriveUrl(res.webUrl) } })
        })
        .catch(() => {})
    }
  }

  // Throttled OneDrive write: at most one PUT per interval, with a trailing flush so the final state
  // always lands. Fewer writes ⇒ fewer races with the OneDrive desktop client ⇒ no machine-name copies.
  const ONEDRIVE_MIN_INTERVAL = 20_000
  function oneDriveWriteNow() {
    oneDriveLastWriteRef.current = Date.now()
    // Same rule as the other silent mirrors: never PUT an archive derived from a failed read.
    // ⚠ THIS CHECK IS DEFENCE IN DEPTH, NOT THE LOAD-BEARING GUARD — recorded because it was once
    // claimed to be the latter, and a lane trusting the wrong line stops guarding the right one.
    // What stands between a failed local read and the archive is `readSnapshotsFromDisk`'s THROW
    // (mutation-proved in `storage/cloudLocalRead.test.ts`). This earns its place by making the
    // refusal VISIBLE, and because the `SnapshotRead` union is what stops the next edit here
    // writing `.catch(() => [])`. → docs/archive/editor-surface.md#editor-archive-reads
    void readSnapshotArchive(docRef.current.id)
      .then((r) => {
        if (r.kind === 'error') { console.warn('[inkwave] OneDrive mirror skipped — archive unreadable:', r.error); return }
        return syncToOneDrive(docRef.current, r.snapshots)
          .then((res) => { if (res.ok) { setLastSync(Date.now()); setOneDriveUrl(res.webUrl) } })
      })
      .catch(() => {})
  }
  function scheduleOneDriveSync() {
    if (oneDriveTrailingRef.current) clearTimeout(oneDriveTrailingRef.current)
    const since = Date.now() - oneDriveLastWriteRef.current
    if (since >= ONEDRIVE_MIN_INTERVAL) oneDriveWriteNow()
    else oneDriveTrailingRef.current = setTimeout(oneDriveWriteNow, ONEDRIVE_MIN_INTERVAL - since)
  }

  // "Sync to OneDrive". If signed in → sync silently now. If not → start the same-window sign-in
  // redirect (sets a pending flag); on return we sync automatically (see the reconnect effect).
  async function syncOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return } // navigates away, comes back signed in
    const snaps = await snapshotsForAction('the sync to OneDrive')
    if (!snaps) return
    const r = await syncToOneDrive(docRef.current, snaps)
    if (r.ok) {
      oneDriveActiveRef.current = true
      gdriveActiveRef.current = false // one cloud destination at a time
      setGdriveActive(false)
      setOneDriveAcct(acct)
      setLastSync(Date.now())
      setOneDriveUrl(r.webUrl)
      oneDriveLastWriteRef.current = Date.now()
    } else {
      // Signed in but the token/scope isn't valid (e.g. the new Files.ReadWrite consent) → re-consent.
      await startOneDriveSignIn()
    }
  }

  // Google Drive: sign in (interactive popup — must be from a click) then sync. Once active,
  // mirrorIfActive() keeps it updated as you write.
  async function syncGoogleDrive() {
    const wasActive = gdriveActiveRef.current
    const ok = await startGoogleDriveSignIn()
    if (!ok) return
    const snaps = await snapshotsForAction('the sync to Google Drive')
    if (!snaps) return
    const r = await syncToGoogleDrive(docRef.current, snaps)
    if (r.ok) {
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false // one cloud destination at a time
      setGdriveActive(true)
      setLastGdriveSync(Date.now())
      setGdriveUrl(r.webUrl)
      // Fresh connect (from "Sync to Google Drive") → open the Google picker straight away so the
      // writer can pick a folder, instead of having to reopen the menu + Save again.
      if (!wasActive) setGdrivePickerOpen(true)
    }
  }

  // "Save a copy" to Google Drive: forget the current Drive file so a fresh one is created, then sync.
  // "Save a copy" to Google Drive: forget the current file, then open the picker to choose a folder +
  // name for the NEW copy. The picker's "Sync here" creates a fresh file there (the old one is left
  // as-is). Same UI as choosing a sync folder — just preceded by clearing the file id.
  async function saveAsGoogleDrive() {
    if (!(await startGoogleDriveSignIn())) return
    clearGoogleDriveFile(docRef.current.id) // ensure the picker creates a NEW file
    setGdriveUrl(null)
    setGdrivePickerOpen(true)
  }

  // Pick a Google Drive folder — our OWN picker (lists the folders Inkwave created on drive.file,
  // make new ones, rename the file). Opens in-page; on pick we target the folder and sync into it.
  function chooseGoogleDriveFolder() { setGdrivePickerOpen(true) }
  async function onGdriveFolderPicked(folderId: string) {
    // The picker shows "Syncing…" while this runs and closes itself when the promise resolves.
    setChosenGDriveFolder(folderId || null) // '' = My Drive root
    clearGoogleDriveFile(docRef.current.id)
    setGdriveUrl(null)
    const snaps = await snapshotsForAction('the sync to Google Drive')
    if (!snaps) return
    const r = await syncToGoogleDrive(docRef.current, snaps)
    if (r.ok) {
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false
      setGdriveActive(true)
      setLastGdriveSync(Date.now())
      setGdriveUrl(r.webUrl)
    }
  }

  // Choose which OneDrive folder to sync into. Needs a signed-in session; otherwise start sign-in
  // (we resume on return). On pick, remember the folder and sync there now.
  async function chooseOneDriveFolder() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setFolderPickerOpen(true)
  }
  async function onFolderPicked(folder: OneDriveFolder) {
    setChosenFolder(folder)
    void addRecentFolder(folder) // remember the choice (OPFS) for the picker's "Recent folders"
    await syncOneDrive() // picker shows "Syncing…" until this resolves, then closes itself
  }

  // Inline rename from the pickers' file-name field: rename the live synced file, then re-sync.
  async function renameGdriveFileNow(name: string) {
    if (await renameGoogleDriveFile(docRef.current.id, name)) await syncGoogleDrive()
  }
  async function renameOneDriveFileNow(name: string) {
    if (await renameOneDriveFile(docRef.current, name)) await syncOneDrive()
  }

  // Upload: open a file FROM Google Drive (incl. shared with you) and adopt it as the sync target, so
  // it keeps syncing there with no Save. openInkwaveFile reloads; the resume effect below re-links it.
  async function uploadFromGoogleDrive() {
    // Get the token INSIDE the click (interactive sign-in if needed) so the opener can list silently —
    // an interactive request from the opener's effect isn't a user gesture and hangs.
    if (!(await startGoogleDriveSignIn())) return
    setGdriveOpenerOpen(true)
  }

  // Fetch a cloud file's bytes THROUGH the OPFS open cache: tag match → cached bytes; mismatch →
  // download + refill; download failed but bytes cached → the stale copy (airplane-mode opens keep
  // working). ⚠ A cache HIT may only ever compare a TRUSTED tag (a fresh listing, or a live
  // metadata GET) — a stale listing tag can FALSE-HIT and open outdated content that the next sync
  // writes back over the newer remote. A wrong STORED tag can only cause a miss, which is safe.
  async function fetchCloudBytes(
    provider: OpenCacheProvider,
    itemId: string,
    listingTag: string | undefined,
    listingFresh: boolean,
    fetchTag: (id: string) => Promise<string | null>,
    download: (id: string) => Promise<Blob | null>,
  ): Promise<{ blob: Blob; how: string } | null> {
    const cached = await getCachedOpen(provider, itemId)
    let tag = listingTag
    if (cached && !listingFresh) tag = (await fetchTag(itemId)) ?? undefined // verify before trusting a hit
    if (cached && tag && cached.tag === tag) return { blob: cached.blob, how: listingFresh ? 'cache hit' : 'cache hit, tag verified' }
    const blob = await download(itemId)
    if (blob) {
      if (tag) void putCachedOpen(provider, itemId, tag, blob) // refill behind the open
      return { blob, how: cached ? 'cache stale, re-downloaded' : 'cache miss' }
    }
    if (cached) return { blob: cached.blob, how: 'offline — stale cached copy' }
    return null
  }

  async function onGdriveFileOpen(f: { id: string; name: string; folderId: string; folderName: string; tag?: string; fresh?: boolean }) {
    window.dispatchEvent(new Event('inkwave:open-begin')) // see OneDrive note
    openPerfStart('gdrive')
    // Bytes, not text — the opener can pick a .studio.gz; readStudioFile gunzips by magic bytes.
    const got = await fetchCloudBytes('gdrive', f.id, f.tag, !!f.fresh, getGDriveFileTag, downloadGoogleDriveFileBlob)
    if (!got) { openPerfAbort(); window.dispatchEvent(new Event('inkwave:open-failed')); reportOpenError(`Couldn't download "${f.name}" from Google Drive — check the connection and try again.`); return }
    openPerfStep('download', got.how)
    void addRecentGDriveFolder({ id: f.folderId === 'root' ? '' : f.folderId, name: f.folderName })
    try {
      await openInkwaveFile(new File([got.blob], f.name), { googleFileId: f.id })
      setGdriveOpenerOpen(false) // see OneDrive note — same-id opens don't remount the editor
    } catch (err) {
      reportOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
    }
  }
  // Upload from OneDrive (esp. phone). Open the file browser; on pick, download + adopt + resume.
  async function uploadFromOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setOdOpenerOpen(true)
  }
  async function onOneDriveFileOpen(f: { itemId: string; name: string; folder: OneDriveFolder; cTag?: string; fresh?: boolean }) {
    // Choreography: page hides + waves drift for the WHOLE load, download included.
    window.dispatchEvent(new Event('inkwave:open-begin'))
    openPerfStart('onedrive')
    // Bytes, not text — the opener can pick a .studio.gz; readStudioFile gunzips by magic bytes.
    const got = await fetchCloudBytes('onedrive', f.itemId, f.cTag, !!f.fresh, getOneDriveItemTag, downloadOneDriveFile)
    // NEVER fail silently ("tapped the file, nothing happened" on phone): every exit is visible.
    if (!got) { openPerfAbort(); window.dispatchEvent(new Event('inkwave:open-failed')); reportOpenError(`Couldn't download "${f.name}" from OneDrive — check the connection and try again.`); return }
    openPerfStep('download', got.how)
    void addRecentFolder(f.folder)
    try {
      await openInkwaveFile(new File([got.blob], f.name), { oneDriveFile: { folder: f.folder, name: f.name } })
      // Close the opener explicitly: opening a doc with the SAME id as the active one doesn't
      // remount the editor (key unchanged), so nothing else would dismiss the panel.
      setOdOpenerOpen(false)
    } catch (err) {
      reportOpenError(err instanceof Error ? err.message : `Could not open "${f.name}"`)
    }
  }

  // "Save a copy" for OneDrive (Firefox/Safari): name a NEW file, point future syncs at it (the old
  // file stays as it was). Mirrors the Chromium "Save a copy".
  // "Save a copy" to OneDrive: open the folder picker (choose folder + name) — picking a new
  // folder/name writes a new file there, leaving the old one. Same UI as choosing a sync folder.
  async function saveAsOneDrive() {
    const acct = await oneDriveAccount()
    if (!acct) { await startOneDriveSignIn(); return }
    setFolderPickerOpen(true)
  }

  // Resume Google Drive sync when a gdrive-synced doc loads (e.g. opened via Upload) — so it keeps
  // syncing without the writer hitting Save. Silent: uses the cached/silent token; no token → no-op.
  useEffect(() => {
    if (!googleDriveConfigured() || getDocSource(docRef.current.id) !== 'gdrive' || !googleDriveFileId(docRef.current.id)) return
    // LOAD-PATH RULE: resume must NOT rebuild + re-upload the bundle (that cost ~1s of parse/encode/
    // network on every open of a big doc, for a byte-identical file). A metadata GET validates the
    // token and fetches the link; the next provenance checkpoint mirrors as usual (mirrorIfActive).
    void getGDriveFileInfo(docRef.current.id).then((info) => {
      if (!info) return // no silent token → stay inactive until the writer clicks sync
      gdriveActiveRef.current = true
      oneDriveActiveRef.current = false
      setGdriveActive(true)
      setLastGdriveSync(Date.now()) // link verified + nothing changed locally since load ⇒ in sync
      setGdriveUrl(info.webUrl)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect a prior OneDrive session on load (also completes a sign-in we returned from).
  useEffect(() => {
    if (!oneDriveConfigured()) return
    void oneDriveAccount().then((acc) => {
      oneDriveActiveRef.current = !!acc
      setOneDriveAcct(acc)
      if (acc && oneDriveSyncPending()) {
        clearOneDriveSyncPending()
        // The post-sign-in resume sync. Guarded like every other write-back — and this one had no
        // `.catch` at all, so a throw here would surface only as an unhandled rejection.
        void snapshotsForAction('the sync to OneDrive')
          .then((s) => {
            if (!s) return
            return syncToOneDrive(docRef.current, s).then((r) => {
              if (r.ok) {
                setLastSync(Date.now()); setOneDriveUrl(r.webUrl)
                oneDriveActiveRef.current = true
                // We just returned from the Microsoft sign-in redirect → open the OneDrive folder picker.
                setFolderPickerOpen(true)
              }
            })
          })
      } else if (acc && getDocSource(docRef.current.id) === 'onedrive' && oneDriveFilename(docRef.current.id)) {
        // A OneDrive-synced doc loaded (e.g. opened via Upload) → resume syncing it (no Save needed).
        // LOAD-PATH RULE: metadata GET only — no bundle rebuild/upload on open (see gdrive resume).
        void getRemoteFileInfo(docRef.current)
          .then((info) => { if (info) { oneDriveActiveRef.current = true; setLastSync(Date.now()); setOneDriveUrl(info.webUrl) } })
      }
    })
  }, [])

  // "Save" — on first use, open the save-file picker so the writer names + places their single
  // .trace.json; after that, write back to the same file. The picker must run inside the click's
  // gesture, so on first save we call it FIRST (no await before it).
  async function saveToFile() {
    if (!folderActiveRef.current) {
      const handle = await pickSaveFile(docRef.current) // picker is the first call inside → in-gesture
      if (!handle) return
      folderActiveRef.current = true
      setFileName(handle.name)
    } else {
      const handle = await getSaveFileHandle(docRef.current.id, true)
      if (!handle) { folderActiveRef.current = false; setFileName(null); return }
      setFileName(handle.name)
    }
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    if (await writeBundleToFile(docRef.current, snaps)) setLastFileSave(Date.now())
  }

  // "Show in folder" — open a native picker started IN the saved file's folder, so the writer can
  // see where it lives (the File System Access API has no direct "reveal in Explorer"). Cancelling
  // is fine — they've seen the folder.
  async function showInFolder() {
    const handle = await getSaveFileHandle(docRef.current.id, false)
    if (!handle) return
    try {
      await (window as unknown as { showOpenFilePicker: (o: unknown) => Promise<unknown> })
        .showOpenFilePicker({ startIn: handle, multiple: false })
    } catch { /* cancelled — the folder was shown */ }
  }

  // "Save a copy" — always prompt for a NEW file, then keep that one updated as you write.
  async function saveAsFile() {
    const handle = await pickSaveFile(docRef.current)
    if (!handle) return
    folderActiveRef.current = true
    setFileName(handle.name)
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    if (await writeBundleToFile(docRef.current, snaps)) setLastFileSave(Date.now())
  }

  // Link THIS document's save file (if any) and sync to it immediately — on load and after "Open…".
  // Silent re-link only works while the browser still grants write permission (same session, or an
  // installed PWA); otherwise the writer re-grants on the next manual Save.
  async function linkSaveFileNow() {
    const h = await getSaveFileHandle(docRef.current.id, false)
    if (h) {
      folderActiveRef.current = true
      setNeedsReconnect(false)
      setFileName(h.name)
      // ⚠ LOAD-PATH RULE: RE-LINK ONLY — never rebuild and rewrite the bundle here. That write
      // re-read, re-encoded and rewrote a possibly-20MB file before anything had changed, and was
      // most of the ~1.5s open block. The next provenance checkpoint mirrors as usual.
      const saved = getRecognisedSave(docRef.current.id)
      setLastFileSave(saved?.destination === 'local' && recognisedSaveIsLive(docRef.current.id) ? saved.at : null)
      return
    }
    // A linked file exists but we don't currently have write permission → show a clear "reconnect"
    // state (never a false "synced"), so the writer knows it ISN'T saving until they re-allow it.
    const name = await getSaveFileName(docRef.current.id)
    folderActiveRef.current = false
    if (name) { setFileName(name); setNeedsReconnect(true) } else { setNeedsReconnect(false) }
  }
  // Re-grant write access (shows the browser's permission popup) and resume saving.
  async function reconnectFolder() {
    const h = await getSaveFileHandle(docRef.current.id, true)
    if (!h) return
    folderActiveRef.current = true
    setNeedsReconnect(false)
    setFileName(h.name)
    const snaps = await snapshotsForAction('the save')
    if (!snaps) return
    if (await writeBundleToFile(docRef.current, snaps)) setLastFileSave(Date.now())
  }
  useEffect(() => {
    void linkSaveFileNow()
    const onLinked = () => void linkSaveFileNow() // fired by "Open…" so a same-id open re-links live
    window.addEventListener('inkwave:save-file-linked', onLinked)
    return () => window.removeEventListener('inkwave:save-file-linked', onLinked)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the once-per-session grow-only merges at IDLE. The first mirror to a linked target fires on
  // a provenance checkpoint MID-TYPING, so paying the whole-archive read+parse there was an
  // inconsistent typing spike. Doing it here heals OPFS while the writer is idle; if the idle pass
  // doesn't run (no permission yet / offline), the first sync still merges as before.
  useEffect(() => {
    let cancelled = false
    runWhenQuiet(() => {
      if (cancelled) return
      void preMergeSaveFile(docRef.current.id)
      if (oneDriveActiveRef.current) void preMergeRemote(docRef.current)
      if (gdriveActiveRef.current) void preMergeGDrive(docRef.current.id)
      // Heal missing PDF sidecars (idempotent — skips bytes already local). iOS trap: savePdf threw
      // on WebKit until the OPFS write shim, so earlier sidecar passes could complete with nothing
      // stored; this quiet-pass refetch restores them for the cited items.
      if (oneDriveActiveRef.current) {
        void loadLibrary().then(() => fetchMissingSidecars(docRef.current.id, bibProvider.getAll())).catch(() => {})
      }
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the cloud OPEN paths at idle: silent tokens (MSAL chunk / GIS script), the pickers' folder
  // listings (so "Open from OneDrive/Drive" paints instantly), and the bytes of the most recent
  // .studio files (so even a first open after sign-in skips the download). Entirely silent — no
  // auth UI can ever appear from here, and every failure is swallowed (see warmCloudOpen).
  useEffect(() => {
    runWhenQuiet(() => warmCloudOpen(), 3000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Advisory multi-device guard: read the synced file's heartbeat (on load + every 45s) and warn if
  // ANOTHER device wrote it recently — i.e. it looks open on another computer. Never locks: the doc
  // stays editable and saved locally. Resets the dismissal when the document switches.
  useEffect(() => {
    setOtherDevice(false)
    setConflictDismissed(false)
    let cancelled = false
    const check = async () => {
      const hb = oneDriveActiveRef.current
        ? await readRemoteHeartbeat(docRef.current)
        : folderActiveRef.current
          ? await readLocalHeartbeat(docRef.current.id)
          : null
      if (!cancelled) setOtherDevice(!!hb && isOtherDeviceActive(hb.session, hb.exportedAt))
    }
    void check()
    const id = setInterval(() => void check(), 45_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [docId])

  return {
    oneDriveAcct, lastSync, oneDriveUrl, gdriveActive, lastGdriveSync, gdriveUrl,
    fileName, needsReconnect, lastFileSave, otherDevice, conflictDismissed, setConflictDismissed,
    setLastFileSave, setLastSync, setLastGdriveSync,
    folderPickerOpen, setFolderPickerOpen, gdrivePickerOpen, setGdrivePickerOpen,
    odOpenerOpen, setOdOpenerOpen, gdriveOpenerOpen, setGdriveOpenerOpen,
    mirrorIfActive, syncOneDrive, syncGoogleDrive, saveAsGoogleDrive, chooseGoogleDriveFolder,
    onGdriveFolderPicked, chooseOneDriveFolder, onFolderPicked, renameGdriveFileNow, renameOneDriveFileNow,
    uploadFromGoogleDrive, onGdriveFileOpen, uploadFromOneDrive, onOneDriveFileOpen, saveAsOneDrive,
    saveToFile, showInFolder, saveAsFile, reconnectFolder,
  }
}
