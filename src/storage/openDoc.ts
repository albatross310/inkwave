// Open an .inkwave (or legacy .trace.json) file as the active document and resume syncing to it.
// Shared by "Open…" (the ⋮ menu) and PWA file-handling (double-click an .inkwave file → launchQueue).
// Switches IN PLACE (no reload) so a just-granted file-write permission survives; falls back to the
// active-doc pointer so it also works when the editor isn't mounted yet (cold launch).

import { v4 as uuidv4 } from 'uuid'
import type { ExportBundle } from '../provenance/bundle'
import { parseStudioOffThread } from '../workers/parseClient'
import { openPerfStart, openPerfStep, openPerfAbort, openPerfDispatched } from './openPerf'
import { reportOpenError } from './openError'
import { saveDocument } from './opfs'
import { upsertMeta } from './indexeddb'
import { withScasDefaults } from '../scas/state'
import { setOneDriveFilename, adoptOneDriveFile, fetchPdfSidecars, type OneDriveFolder } from './onedrive'
import { adoptGoogleDriveFile } from './gdrive'
import { setSaveFileHandle } from './folder'
import { restoreSnapshotsFromBundle } from '../provenance/snapshots'
import { applyViewSettings } from '../editor/viewSettings'
import { bibProvider } from '../citations/bibProvider'
import { loadLibrary, persistLibrary } from '../citations/library'
import { savePdf, base64ToBlob } from '../citations/pdfStore'

const ACTIVE_DOC_KEY = 'inkwave:activeDocumentId'

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
  const title =
    data.document?.title ??
    (data as { title?: string }).title ??
    file.name.replace(/\.(studio|inkwave|trace\.json|insig\.json|json)$/i, '')
  const id = (data.document?.id as string | undefined) ?? uuidv4()

  // Normalise the filename: always store the .studio extension so the next sync uses it correctly.
  const studioName = file.name.toLowerCase().match(/\.(studio|inkwave|trace\.json)$/)
    ? file.name
    : file.name.replace(/\.[^.]*$/, '') + '.studio'
  if (googleFileId) adoptGoogleDriveFile(id, googleFileId)            // resume Google Drive sync
  else if (oneDriveFile) adoptOneDriveFile(id, oneDriveFile.folder, oneDriveFile.name) // resume OneDrive sync
  else setOneDriveFilename(id, studioName)                           // resume OneDrive sync (by name)
  if (handle) await setSaveFileHandle(id, handle)                    // resume local file sync (writable handle)

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
  const doc = withScasDefaults({
    id, title, contentJson, createdAt: now, updatedAt: now,
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: uuidv4(),
    // Restore the signed receipt chain from the bundle so the ReceiptPanel shows history.
    ...(data.receipts?.length ? { scasReceipts: data.receipts } : {}),
  })
  // Persist — but a persistence failure must NOT abort the open. The parsed doc is in hand and
  // travels in the open-doc event, so the writer can still read/work with it; failing here used to
  // throw → open-failed → the PREVIOUS doc silently restored ("tapped the file, got a blank page").
  // The two real ways this fires: OPFS unavailable (private windows) and, on iOS, a DEAD parse
  // worker (all WebKit OPFS writes go through it — the same death that used to kill the parse).
  // Loud, not fatal: the save-failed event (autosave's channel) + a visible parked banner.
  try {
    await saveDocument(doc)
    await upsertMeta({ id, title: doc.title, updatedAt: doc.updatedAt })
  } catch (err) {
    console.error('[inkwave] open: initial save failed (opening anyway):', err)
    window.dispatchEvent(new CustomEvent('inkwave:save-failed', { detail: { error: String((err as Error)?.message ?? err) } }))
    reportOpenError(`"${title}" opened, but this device couldn't store it (storage unavailable) — changes may not persist here.`)
  }
  try { localStorage.setItem(ACTIVE_DOC_KEY, id) } catch { /* private mode */ }
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
  const bib = (data as { bibliography?: import('../types/document').CSLItem[] }).bibliography
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
