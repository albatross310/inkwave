// Open an .inkwave (or legacy .trace.json) file as the active document and resume syncing to it.
// Shared by "Open…" (the ⋮ menu) and PWA file-handling (double-click an .inkwave file → launchQueue).
// Switches IN PLACE (no reload) so a just-granted file-write permission survives; falls back to the
// active-doc pointer so it also works when the editor isn't mounted yet (cold launch).

import { v4 as uuidv4 } from 'uuid'
import { parseTraceFile, readStudioFile } from '../provenance/bundle'
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
  const { handle, googleFileId, oneDriveFile } = opts
  let data: ReturnType<typeof parseTraceFile>
  try {
    data = parseTraceFile(await readStudioFile(file)) // transparently gunzips .studio.gz
  } catch {
    throw new Error(`"${file.name}" doesn't look like an Inkwave file — it may be a plain-text document that was renamed to .studio`)
  }
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
  // Local OPFS wins if it already has all snapshots.
  if (data.snapshots?.length) await restoreSnapshotsFromBundle(id, data.snapshots)

  // Restore the view settings that travelled with the doc (theme, gapped pages, paper/margins, zoom).
  applyViewSettings((data as { viewSettings?: Record<string, string> }).viewSettings)

  // Restore the embedded citation library (+ any embedded PDFs) so citations resolve and their
  // sources/annotations travel with the doc. Merge with any existing local library, then persist.
  const bib = (data as { bibliography?: import('../types/document').CSLItem[] }).bibliography
  const pdfs = (data as { pdfs?: Record<string, { name: string; data: string }> }).pdfs
  if (bib?.length || pdfs) {
    await loadLibrary()
    for (const it of bib ?? []) bibProvider.upsert(it, 'library')
    await persistLibrary()
    // Embedded PDFs (explicit-download bundles) restore directly...
    for (const [key, p] of Object.entries(pdfs ?? {})) {
      try { await savePdf(key, base64ToBlob(p.data)) } catch { /* storage full / unavailable */ }
    }
    // ...OneDrive-synced docs keep PDFs as sidecars — fetch them for the cited sources.
    if (oneDriveFile && bib?.length) {
      await fetchPdfSidecars(oneDriveFile.folder, oneDriveFile.name, bib)
    }
  }

  const now = new Date().toISOString()
  const doc = withScasDefaults({
    id, title, contentJson, createdAt: now, updatedAt: now,
    schemaVersion: '0.1.0', scasLimitN: 'infinite', scasSessionSeed: uuidv4(),
    // Restore the signed receipt chain from the bundle so the ReceiptPanel shows history.
    ...(data.receipts?.length ? { scasReceipts: data.receipts } : {}),
  })
  await saveDocument(doc)
  await upsertMeta({ id, title: doc.title, updatedAt: doc.updatedAt })
  try { localStorage.setItem(ACTIVE_DOC_KEY, id) } catch { /* private mode */ }

  // With a writable handle, switch IN PLACE (no reload) so the just-granted file permission survives.
  // Without one, reload so the editor loads the doc cleanly (also covers PWA cold launch).
  if (handle) {
    window.dispatchEvent(new CustomEvent('inkwave:open-doc', { detail: { id } }))
    window.dispatchEvent(new Event('inkwave:save-file-linked'))
  } else {
    window.location.reload()
  }
}
