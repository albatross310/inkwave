// Open an .inkwave (or legacy .trace.json) file as the active document and resume syncing to it.
// Shared by "Open…" (the ⋮ menu) and PWA file-handling (double-click an .inkwave file → launchQueue).
// Switches IN PLACE (no reload) so a just-granted file-write permission survives; falls back to the
// active-doc pointer so it also works when the editor isn't mounted yet (cold launch).

import { v4 as uuidv4 } from 'uuid'
import type { ExportBundle } from '../provenance/bundle'
import { parseStudioOffThread } from '../workers/parseClient'
import { openPerfStart, openPerfStep, openPerfAbort, openPerfDispatched } from './openPerf'
import { reportOpenError, reportOpenNotice } from './openError'
import { saveDocument, loadDocument } from './opfs'
import { classifyOpen, type OpenVerdict } from './openConflict'
import { contentHash } from '../provenance/hash'
import { upsertMeta } from './indexeddb'
import { withScasDefaults } from '../scas/state'
import { setOneDriveFilename, adoptOneDriveFile, fetchPdfSidecars, type OneDriveFolder } from './onedrive'
import { adoptGoogleDriveFile } from './gdrive'
import { setSaveFileHandle } from './folder'
import { restoreSnapshotsFromBundle, listSnapshots } from '../provenance/snapshots'
import { applyViewSettings } from '../editor/viewSettings'
import { bibProvider } from '../citations/bibProvider'
import { loadLibrary, persistLibrary } from '../citations/library'
import { savePdf, base64ToBlob } from '../citations/pdfStore'
import { claimTabDoc } from './tabDoc'

// opts.handle = a writable FSA handle (local file / mounted-cloud folder) → resume local write-back.
// opts.googleFileId = the Drive file id this came from → adopt it so gdrive sync resumes (no Save).
// opts.oneDriveFile = the OneDrive folder + name → adopt so onedrive sync resumes (no Save).
export async function openInkwaveFile(
  file: File,
  opts: { handle?: FileSystemFileHandle; googleFileId?: string; oneDriveFile?: { folder: OneDriveFolder; name: string } } = {},
): Promise<void> {
  // OPEN CHOREOGRAPHY (Peter's spec): the moment an open starts, the current page hides and the
  // waves drift (Edit.tsx listens for open-begin → setDoc(null) → the loading shell); on success
  // the new page + text reveal atomically; on ANY failure open-failed restores the previous doc
  // so a bad file never strands a blank shell. Cloud handlers fire open-begin even earlier
  // (before the download); this one covers the local-file path and is idempotent.
  window.dispatchEvent(new Event('inkwave:open-begin'))
  openPerfStart('local') // no-op when a cloud handler already started this open's marks
  try {
    await openInkwaveFileInner(file, opts)
  } catch (err) {
    openPerfAbort()
    window.dispatchEvent(new Event('inkwave:open-failed'))
    throw err
  }
}

async function openInkwaveFileInner(
  file: File,
  opts: { handle?: FileSystemFileHandle; googleFileId?: string; oneDriveFile?: { folder: OneDriveFolder; name: string } } = {},
): Promise<void> {
  const { handle, googleFileId, oneDriveFile } = opts
  let data: ExportBundle
  try {
    // Bytes → worker: gunzip-sniff (.studio.gz) + decode + JSON.parse all OFF the main thread —
    // parsing a 20 MB .studio inline here was the biggest single open-path stall (~0.5-1s frozen).
    // Takes the Blob so a dead worker degrades to an inline parse (the transferred copy is gone).
    data = await parseStudioOffThread(file)
  } catch {
    throw new Error(`"${file.name}" doesn't look like an Inkwave file — it may be a plain-text document that was renamed to .studio`)
  }
  openPerfStep('parse')
  // Accept an export bundle (content under .document) OR a raw saved document (top-level contentJson).
  const contentJson = (data as { contentJson?: typeof data.document.contentJson }).contentJson ?? data.document?.contentJson
  if (!contentJson) throw new Error('not an Inkwave file')
  // Strip a trailing .gz FIRST: our own "🗜 Zipped" exports are .studio.gz, and both regexes below
  // only match an extension at the END — so foo.studio.gz titled as "foo.studio.gz" and normalised
  // to "foo.studio.studio". The cloud sync target is the canonical plain .studio either way; only a
  // local writable handle keeps the .gz (folder.ts re-gzips it on write).
  const baseName = file.name.replace(/\.gz$/i, '')
  const title =
    data.document?.title ??
    (data as { title?: string }).title ??
    baseName.replace(/\.(studio|inkwave|trace\.json|insig\.json|json)$/i, '')
  const fileId = (data.document?.id as string | undefined) ?? uuidv4()

  // ─── THE BLIND-OVERWRITE GUARD ──────────────────────────────────────────────
  // Everything below this block used to run against `id` unconditionally, ending in
  // `saveDocument(doc)` — a whole-file replace of `documents/<id>/current.json`. On 2026-07-15 that
  // let a STALE export destroy Peter's current honours-proposal work (see storage/openConflict.ts
  // for the forensic detail). The snapshots on line ~91 were already protected by the grow-only
  // union; the document body was not. This is that missing half.
  //
  // Decided by ANCESTRY, never by `updatedAt` — this very path stamps `updatedAt: now`, so a stale
  // file arrives looking brand new. See classifyOpen.
  // THE TWO BUGS COMPOSE — and they did, in sequence, on 2026-07-15. If a failed read answered
  // `null` here, `localHash` would be null, classifyOpen would say 'incoming-newer', and the file
  // would blind-overwrite a document that is sitting on disk perfectly intact. The swallowed read
  // would defeat this guard. So a read FAILURE is explicitly not an absence: `readFailed` means
  // "there may well be work here" and it is treated as the most cautious verdict below.
  let localBefore: Awaited<ReturnType<typeof loadDocument>> = null
  let readFailed = false
  try {
    localBefore = await loadDocument(fileId)
  } catch (err) {
    readFailed = true
    console.error('[inkwave] open: could not read the local copy — refusing to overwrite it:', err)
  }
  // THE LIVE KNOWN-NEGATIVE. `window.__iwOpenGuard = 'off'` restores the pre-fix behaviour: adopt
  // the incoming file unconditionally. It exists so the reproduction can re-create the 2026-07-15
  // destruction in the SAME build it then proves fixed — a probe that only ever runs against the
  // fixed build cannot tell "the guard works" from "the probe cannot see the bug"
  // (scripts/openguard-probe/repro.mjs requires this cell to destroy data before reading a verdict).
  const guardOff = (window as unknown as { __iwOpenGuard?: string }).__iwOpenGuard === 'off'
  const verdict: OpenVerdict = guardOff
    ? 'incoming-newer'
    // Could not read the local copy ⇒ we cannot compare, so we do not get to overwrite. 'diverged'
    // opens the file as a separate document and leaves whatever is on disk untouched.
    : readFailed ? 'diverged'
    : classifyOpen({
        localHash: localBefore ? await contentHash(localBefore.contentJson) : null,
        incomingHash: await contentHash(contentJson),
        localSnapshotHashes: (await listSnapshots(fileId).catch(() => [])).map((s) => s.contentHash),
        incomingSnapshotHashes: (data.snapshots ?? []).map((s) => s.contentHash),
      })
  // Instrument, not logic (the `__iwPerf` pattern): which branch this open took. Without it a probe
  // can only see the OUTCOME ("nothing was destroyed") and must GUESS the path — and "kept the local
  // copy" vs "forked a second document" are very different answers that look identical from outside.
  ;(window as unknown as { __iwLastOpenVerdict?: string }).__iwLastOpenVerdict = verdict
  openPerfStep('conflict')

  // A file that is a PAST STATE of the document in hand has nothing to give it. Keep the local
  // document exactly as it is — and still adopt the sync bindings below, because the right repair
  // for a stale remote file is for this newer document to sync OVER it, which is what happens next.
  if (verdict === 'incoming-stale') {
    reportOpenNotice(
      `"${title}" is an older copy of a document you already have — your newer version was kept, ` +
      `so nothing was overwritten. Its history was merged in.`,
    )
  }
  // Neither side contains the other: both hold real work. Never choose. The incoming file opens as
  // a SEPARATE document under a fresh id, and the local one is untouched. No cloud binding for the
  // copy: two documents syncing to one file would recreate this bug from the other end.
  // `readFailed` counts as "there is something here": localBefore is null precisely BECAUSE we
  // could not read it, and forking on `!!localBefore` alone would let that null overwrite the file
  // we failed to read — the swallowed-read bug walking straight back in through this door.
  const forked = verdict === 'diverged' && (!!localBefore || readFailed)
  const id = forked ? uuidv4() : fileId

  // Normalise the filename: always store the .studio extension so the next sync uses it correctly.
  const studioName = baseName.toLowerCase().match(/\.(studio|inkwave|trace\.json)$/)
    ? baseName
    : baseName.replace(/\.[^.]*$/, '') + '.studio'
  if (forked) {
    reportOpenNotice(
      `"${title}" and the copy on this device have both been edited separately, so it opened as a ` +
      `separate copy. Nothing was overwritten — both versions are in Storage (⋮ menu).`,
    )
  } else if (googleFileId) adoptGoogleDriveFile(id, googleFileId)    // resume Google Drive sync
  else if (oneDriveFile) adoptOneDriveFile(id, oneDriveFile.folder, oneDriveFile.name) // resume OneDrive sync
  else setOneDriveFilename(id, studioName)                           // resume OneDrive sync (by name)
  if (handle && !forked) await setSaveFileHandle(id, handle)         // resume local file sync (writable handle)

  // Restore provenance history from the bundle when OPFS has fewer snapshots (device transfer).
  // Local OPFS wins if it already has all snapshots. deferDiskWrite: the union lands in the
  // write-through snapshot cache SYNCHRONOUSLY (so the editor's eager snapshot list right after
  // open-doc sees the full history — grow-only holds), while the heavy stringify+gzip+OPFS write
  // runs behind the reveal on the per-doc write chain. See restoreSnapshotsFromBundle.
  if (data.snapshots?.length) await restoreSnapshotsFromBundle(id, data.snapshots, { deferDiskWrite: true })
  openPerfStep('snapshots')

  // Restore the view settings that travelled with the doc (theme, gapped pages, paper/margins, zoom).
  applyViewSettings((data as { viewSettings?: Record<string, string> }).viewSettings)

  const now = new Date().toISOString()
  // The bundle's cited library entries (portability extra) — restored into bibProvider below, and
  // ALSO embedded as doc.bibliography so the OPFS copy is SELF-CONTAINED: doc.bibliography is the
  // documented offline-resolution source for in-text citations (resolve.ts), and a device whose
  // library write fails (the iOS dead-worker history) must still resolve them at the next boot.
  const bib = (data as { bibliography?: import('../types/document').CSLItem[] }).bibliography
  // THE STALE CASE — the one that ate his thesis. The file is a past state of this document, so the
  // document to open is the one ALREADY ON DISK, untouched: same id, same body, same receipts. The
  // file was not useless — its snapshots were merged in above, grow-only, which is pure gain — but
  // its BODY never reaches current.json. Nothing is written here at all.
  const keepLocal = verdict === 'incoming-stale' && !!localBefore
  const doc = keepLocal
    ? localBefore!
    : withScasDefaults({
        id, title, contentJson, createdAt: now, updatedAt: now,
        schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: uuidv4(),
        // Restore the signed receipt chain from the bundle so the ReceiptPanel shows history.
        ...(data.receipts?.length ? { scasReceipts: data.receipts } : {}),
        ...(bib?.length ? { bibliography: { source: 'library' as const, entries: bib, generatedAt: now } } : {}),
      })
  // Persist — but a persistence failure must NOT abort the open. The parsed doc is in hand and
  // travels in the open-doc event, so the writer can still read/work with it; failing here used to
  // throw → open-failed → the PREVIOUS doc silently restored ("tapped the file, got a blank page").
  // The two real ways this fires: OPFS unavailable (private windows) and, on iOS, a DEAD parse
  // worker (all WebKit OPFS writes go through it — the same death that used to kill the parse).
  // Loud, not fatal: the save-failed event (autosave's channel) + a visible parked banner.
  try {
    // keepLocal ⇒ current.json ALREADY holds exactly this document. The whole point is not to
    // write it: `saveDocument` is the unconditional replace that caused the incident.
    if (!keepLocal) await saveDocument(doc)
    await upsertMeta({ id, title: doc.title, updatedAt: doc.updatedAt })
  } catch (err) {
    console.error('[inkwave] open: initial save failed (opening anyway):', err)
    window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error: String((err as Error)?.message ?? err) } }))
    reportOpenError(`"${title}" opened, but this device couldn't store it (storage unavailable) — changes may not persist here.`)
  }
  // THIS TAB now owns the opened document (and it becomes the new-tab hint). Opening a file in one
  // tab must never re-point another tab that has a document of its own — see storage/tabDoc.ts.
  claimTabDoc(id)
  openPerfStep('save')

  // Switch IN PLACE for every open (Edit.tsx listens for inkwave:open-doc and remounts the editor
  // via key={doc.id}). The old non-handle path did window.location.reload() — the file was parsed,
  // written to OPFS, then the WHOLE APP re-booted and re-parsed it from OPFS: double the work and
  // most of the 2-3s first-open. The in-place path also keeps a just-granted file permission alive.
  // The event carries the parsed doc so Edit.tsx doesn't re-read + JSON.parse the (possibly
  // multi-MB) file we JUST wrote to OPFS — that second parse was pure duplicated main-thread work.
  window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id, doc } }))
  openPerfDispatched()
  if (handle) window.dispatchEvent(new Event('inkwave:save-file-linked'))

  // Restore the embedded citation library (+ any embedded PDFs) AFTER the document is showing —
  // this used to run before the reveal and was most of the wait on PDF-heavy bundles. bibProvider
  // is reactive, so citations resolve the moment the library lands; PDFs/sidecars stream in behind.
  const pdfs = (data as { pdfs?: Record<string, { name: string; data: string }> }).pdfs
  if (bib?.length || pdfs) {
    void (async () => {
      try {
        await loadLibrary()
        for (const it of bib ?? []) bibProvider.upsert(it, 'library')
        await persistLibrary()
        // Embedded PDFs (explicit-download bundles) restore directly...
        for (const [key, p] of Object.entries(pdfs ?? {})) {
          try { await savePdf(key, await base64ToBlob(p.data)) } catch { /* storage full / unavailable */ }
        }
        // ...OneDrive-synced docs keep PDFs as sidecars — fetch them for the cited sources.
        if (oneDriveFile && bib?.length) {
          await fetchPdfSidecars(oneDriveFile.folder, oneDriveFile.name, bib)
        }
      } catch { /* library restore is best-effort; the document itself is already open */ }
    })()
  }
}
