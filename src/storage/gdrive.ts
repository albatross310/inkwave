// Google Drive sync — the cross-platform cloud destination for Firefox/Safari writers (mirrors the
// OneDrive module's shape). Auth is Google Identity Services (GIS) token flow with the per-file
// `drive.file` scope: Inkwave can only ever see files IT creates — never the rest of your Drive.
// One self-contained .inkwave file per document; its Drive file id is remembered so we update (not
// duplicate) on every sync. Gated on VITE_GOOGLE_CLIENT_ID — inert until that's set.

import type { InkwaveDocument, Snapshot } from '../types/document'
import { composeTraceFile, buildExportBundle, bundleFilename, TRACE_EXTENSION } from '../provenance/bundle'
import { parseTraceOffThread } from '../workers/parseClient'
import { mergeSnapshots, restoreSnapshotsFromBundle, needsWritebackMerge, markWritebackMerged } from '../provenance/snapshots'
import { setDocSource } from './docSource'
import { readAppJson, writeAppJson } from './opfs'

const CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

export function googleDriveConfigured(): boolean {
  return !!CLIENT_ID
}

// ─── GIS token flow (browser-only, loaded on demand) ───────────────────────────

type TokenResponse = { access_token?: string; expires_in?: number; error?: string }
type TokenClient = { callback: (r: TokenResponse) => void; requestAccessToken: (o?: { prompt?: string }) => void }
type Gis = { accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: TokenResponse) => void }) => TokenClient } } }

let gisLoad: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (gisLoad) return gisLoad
  gisLoad = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: Gis }).google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    // Un-cache on failure so a flaky preload (offline menu-open) doesn't poison every later click.
    s.onerror = () => { gisLoad = null; reject(new Error('Google Identity Services failed to load')) }
    document.head.appendChild(s)
  })
  return gisLoad
}

let tokenClient: TokenClient | null = null
let cached: { token: string; expiry: number } | null = null

async function ensureClient(): Promise<TokenClient> {
  await loadGis()
  const gis = (window as unknown as { google: Gis }).google
  if (!tokenClient) {
    tokenClient = gis.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID!, scope: SCOPE, callback: () => {} })
  }
  return tokenClient
}

/** Warm the GIS script + token client OFF the click path. iOS Safari revokes a tap's transient
 *  activation while ensureClient() awaits the network script load, so requestAccessToken then runs
 *  WITHOUT a gesture and the consent popup is silently blocked (getDriveToken resolves null with no
 *  hint why). Fire this when the sync UI opens; by the time the writer taps "Google Drive",
 *  ensureClient() resolves from cache and the popup opens inside the tap's activation window. */
export function preloadGis(): void {
  if (!CLIENT_ID) return
  void ensureClient().catch(() => { /* offline / blocked — the click path retries the load */ })
}

/**
 * Get a Drive access token. interactive=true shows the Google consent popup (MUST be called from a
 * user gesture); interactive=false attempts a silent grant (only works once consented). null = no token.
 */
export async function getDriveToken(interactive: boolean): Promise<string | null> {
  if (!CLIENT_ID) return null
  if (cached && cached.expiry > Date.now() + 60_000) return cached.token
  const client = await ensureClient()
  return new Promise((resolve) => {
    client.callback = (resp) => {
      if (resp.access_token) {
        cached = { token: resp.access_token, expiry: Date.now() + (resp.expires_in ?? 3600) * 1000 }
        resolve(resp.access_token)
      } else {
        resolve(null)
      }
    }
    try {
      // 'select_account' on interactive sign-in: always show the account chooser. Without it Google
      // silently auto-picks the browser's default account, so anyone signed into multiple Google
      // accounts gets routed to the wrong one (→ 401) with no way to choose. 'none' stays silent for
      // the background token refresh.
      client.requestAccessToken({ prompt: interactive ? 'select_account' : 'none' })
    } catch {
      resolve(null)
    }
  })
}

// ─── Per-document Drive file id (so we UPDATE, never duplicate) ─────────────────

const fileKey = (docId: string) => `inkwave:gdrive-file:${docId}`
function driveFileId(docId: string): string | null {
  try { return localStorage.getItem(fileKey(docId)) } catch { return null }
}
function setDriveFileId(docId: string, id: string): void {
  try { localStorage.setItem(fileKey(docId), id) } catch { /* private mode */ }
}

// Per-document custom file name (overrides the title-derived bundleFilename). Always ends .inkwave.
const ensureExt = (name: string) => (name.toLowerCase().endsWith(`.${TRACE_EXTENSION}`) ? name : `${name}.${TRACE_EXTENSION}`)
const nameKey = (docId: string) => `inkwave:gdrive-name:${docId}`
export function gDriveFilename(docId: string): string | null {
  try { return localStorage.getItem(nameKey(docId)) } catch { return null }
}
function setGDriveFilename(docId: string, name: string): void {
  try { localStorage.setItem(nameKey(docId), name) } catch { /* private mode */ }
}

/** Rename the synced Drive file in place (and remember the name for future syncs). The Drive file id
 *  is stored, so this PATCHes that exact file; if nothing's synced yet, the name just applies next sync. */
export async function renameGoogleDriveFile(docId: string, name: string): Promise<boolean> {
  const clean = ensureExt(name.trim())
  if (!clean || clean === `.${TRACE_EXTENSION}`) return false
  setGDriveFilename(docId, clean)
  const id = driveFileId(docId)
  if (!id) return true // not synced yet — the next sync creates it with this name
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return false
  const res = await fetch(`${FILES_API}/${id}?fields=id,name`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean }),
  })
  return res.ok
}

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

/** Forget the doc's Drive file id so the next sync creates a NEW file (used by "Save a copy"). */
export function clearGoogleDriveFile(docId: string): void {
  try { localStorage.removeItem(fileKey(docId)) } catch { /* private mode */ }
}

// The CONTAINING folder's URL (so "show in folder" reveals the surrounding files), or the file link
// as a fallback. drive.file lets us read the parents of files we created.
function folderUrl(data: { webViewLink?: string; parents?: string[] }): string | null {
  const parent = data?.parents?.[0]
  return parent ? `https://drive.google.com/drive/folders/${parent}` : (data?.webViewLink ?? null)
}

// Update the existing Drive file, or create a new one (multipart: metadata + media). Returns the
// CONTAINING folder's URL (for "show in folder"). drive.file: we only ever touch files we created.
async function uploadDrive(token: string, docId: string, name: string, content: string): Promise<string | null> {
  const existing = driveFileId(docId)
  if (existing) {
    const res = await fetch(`${UPLOAD}/${existing}?uploadType=media&fields=id,webViewLink,parents`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: content,
    })
    if (res.ok) return folderUrl(await res.json())
    if (res.status !== 404) throw new Error(`Drive update failed (${res.status})`)
    // 404 → the file was deleted in Drive; fall through and create a fresh one.
  }
  const boundary = `inkwave${Math.random().toString(36).slice(2)}`
  const folder = getChosenGDriveFolder()
  const metadata = folder ? { name, parents: [folder] } : { name }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`
  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink,parents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new Error(`Drive create failed (${res.status})`)
  const data = (await res.json()) as { id?: string; webViewLink?: string; parents?: string[] }
  if (data.id) setDriveFileId(docId, data.id)
  return folderUrl(data)
}

// ─── Chosen sync folder (global, like OneDrive) ────────────────────────────────
const FOLDER_KEY = 'inkwave:gdrive-folder'
export function getChosenGDriveFolder(): string | null {
  try { return localStorage.getItem(FOLDER_KEY) } catch { return null }
}
export function setChosenGDriveFolder(id: string | null): void {
  try { id ? localStorage.setItem(FOLDER_KEY, id) : localStorage.removeItem(FOLDER_KEY) } catch { /* private mode */ }
}

// Recently-chosen Drive folders (OPFS), surfaced at the top of the picker — parity with OneDrive.
// Most-recent first, deduped by id. id '' = My Drive root.
export interface GDriveRecent { id: string; name: string }
const GDRIVE_RECENTS_FILE = 'gdrive-recent-folders.json'
const GDRIVE_MAX_RECENTS = 6
export async function getRecentGDriveFolders(): Promise<GDriveRecent[]> {
  return (await readAppJson<GDriveRecent[]>(GDRIVE_RECENTS_FILE)) ?? []
}
export async function addRecentGDriveFolder(folder: GDriveRecent): Promise<void> {
  const list = await getRecentGDriveFolders()
  const next = [folder, ...list.filter((f) => f.id !== folder.id)].slice(0, GDRIVE_MAX_RECENTS)
  await writeAppJson(GDRIVE_RECENTS_FILE, next)
}

// Create a Drive folder (at the writer's root) and return it. drive.file lets us create + then touch
// folders WE created — so the new folder becomes a valid sync target. Used by the Save-menu "New
// folder" action (the hosted Picker has no create-folder of its own).
const FILES_API = 'https://www.googleapis.com/drive/v3/files'
export async function createGoogleDriveFolder(name: string, parentId?: string): Promise<{ id: string; name: string } | null> {
  if (!CLIENT_ID) return null
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return null
  const body: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' }
  if (parentId) body.parents = [parentId] // create inside the browsed folder ('root' = My Drive root)
  const res = await fetch(`${FILES_API}?fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const d = (await res.json()) as { id: string; name: string }
  return { id: d.id, name: d.name }
}

// List the folders this app can see under drive.file — i.e. the folders Inkwave CREATED (or was
// granted). Flat list (we create folders at the Drive root). Powers the custom Google picker; the
// privacy-preserving drive.file scope can't enumerate folders the app didn't make.
// List app-created folders. With `parentId` ('root' for My Drive root, or a folder id) it lists only
// that folder's sub-folders — for the folder-navigable opener. Without it, all app folders (flat) —
// used by the folder picker.
export async function listGoogleDriveFolders(parentId?: string): Promise<Array<{ id: string; name: string }>> {
  if (!CLIENT_ID) return []
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return []
  let q = "mimeType='application/vnd.google-apps.folder' and trashed=false"
  if (parentId) q += ` and '${parentId}' in parents`
  const res = await fetch(`${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200&orderBy=name`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const d = (await res.json()) as { files?: Array<{ id: string; name: string }> }
  return d.files ?? []
}

// ─── Open a file FROM Drive (Upload) ────────────────────────────────────────────
export function googleDriveFileId(docId: string): string | null { return driveFileId(docId) }

/** Warm the once-per-session grow-only merge at IDLE, without uploading (see folder.preMergeSaveFile
 *  — same rationale: the first sync fires on a checkpoint mid-typing; do the download+parse now). */
export async function preMergeGDrive(docId: string): Promise<void> {
  const key = `gdrive:${docId}`
  const fileId = driveFileId(docId)
  if (!fileId || !needsWritebackMerge(key)) return
  try {
    const text = await downloadGoogleDriveFile(fileId)
    if (text) {
      const remote = await parseTraceOffThread(text)
      if (remote.snapshots?.length) await restoreSnapshotsFromBundle(docId, remote.snapshots)
    }
    markWritebackMerged(key)
  } catch { /* unreadable → the first sync retries its own merge */ }
}

/** Cheap remote-file check: validates the silent token and returns the file's link + modified time
 *  from Drive METADATA — no upload, no download. Used by resume-on-load, which previously rebuilt
 *  and re-uploaded the whole bundle just to re-activate sync. */
export async function getGDriveFileInfo(docId: string): Promise<{ webUrl: string | null; modifiedAt: number } | null> {
  const id = driveFileId(docId)
  if (!id) return null
  const token = await getDriveToken(false) // silent only — never a popup on load
  if (!token) return null
  try {
    const res = await fetch(`${FILES_API}/${id}?fields=webViewLink,parents,modifiedTime`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const d = (await res.json()) as { webViewLink?: string; parents?: string[]; modifiedTime?: string }
    return { webUrl: folderUrl(d), modifiedAt: d.modifiedTime ? new Date(d.modifiedTime).getTime() : 0 }
  } catch {
    return null
  }
}

// List the .studio/.inkwave files this app can SEE on drive.file (the ones Inkwave created/synced —
// your own files, across devices). drive.file can't enumerate files OTHERS shared with you; for those,
// open via "This computer" (the mounted Drive folder) on desktop.
export async function listGoogleDriveFiles(parentId?: string): Promise<Array<{ id: string; name: string }>> {
  if (!CLIENT_ID) return []
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return []
  // Broad on purpose (matches the OneDrive opener): .studio.gz matches "contains '.studio'";
  // .json/.txt catch pre-.studio-era saves and iOS renames. The opener validates by content.
  let q = "(name contains '.studio' or name contains '.inkwave' or name contains '.json' or name contains '.txt') and mimeType != 'application/vnd.google-apps.folder' and trashed = false"
  if (parentId) q += ` and '${parentId}' in parents`
  const res = await fetch(`${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200&orderBy=modifiedTime desc`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return []
  const d = (await res.json()) as { files?: Array<{ id: string; name: string }> }
  return d.files ?? []
}

/** Download a Drive file's text by id (the app has drive.file access to files it created/opened).
 *  For the grow-only merge paths, which only ever read back our own plain-text .studio uploads. */
export async function downloadGoogleDriveFile(id: string): Promise<string | null> {
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return null
  const res = await fetch(`${FILES_API}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.text()
}

/** Download a Drive file's raw bytes by id. Bytes, NOT text: the file OPENER may pick a .studio.gz,
 *  and text-decoding gzip corrupts it before readStudioFile can sniff the 1f 8b magic. */
export async function downloadGoogleDriveFileBlob(id: string): Promise<Blob | null> {
  const token = await getDriveToken(false) // silent only — interactive sign-in happens in the click, not here
  if (!token) return null
  const res = await fetch(`${FILES_API}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.blob()
}
/** Adopt an opened Drive file as this doc's sync target, so future syncs UPDATE it (no Save needed). */
export function adoptGoogleDriveFile(docId: string, fileId: string): void {
  setDriveFileId(docId, fileId)
  setDocSource(docId, 'gdrive')
}

export interface SyncResult { ok: boolean; webUrl: string | null }

/** Start sign-in / consent (interactive — call from a click). Returns true if we got a token. */
export async function startGoogleDriveSignIn(): Promise<boolean> {
  return (await getDriveToken(true)) != null
}

/** Sync the single self-contained .inkwave file to Drive using the existing grant (no UI). ok:false
 *  if not signed in / not consented — call startGoogleDriveSignIn() first. */
export async function syncToGoogleDrive(doc: InkwaveDocument, snapshots: Snapshot[]): Promise<SyncResult> {
  if (!CLIENT_ID) return { ok: false, webUrl: null }
  const token = await getDriveToken(false)
  if (!token) return { ok: false, webUrl: null }
  // GROW-ONLY: union the remote file's snapshots in before overwriting (see syncToOneDrive) — but
  // only ONCE per session, so the download+parse of a big file doesn't add per-sync lag.
  let merged = snapshots
  const fileId = driveFileId(doc.id)
  const key = `gdrive:${doc.id}`
  if (fileId && needsWritebackMerge(key)) {
    try {
      const text = await downloadGoogleDriveFile(fileId)
      if (text) { const remote = await parseTraceOffThread(text); if (remote.snapshots?.length) merged = mergeSnapshots(remote.snapshots, snapshots) }
      markWritebackMerged(key)
    } catch { /* unreadable → write local as-is; retry next sync */ }
  }
  const file = composeTraceFile(buildExportBundle(doc, merged))
  try {
    const webUrl = await uploadDrive(token, doc.id, gDriveFilename(doc.id) ?? bundleFilename(doc), file)
    setDocSource(doc.id, 'gdrive')
    if (merged.length > snapshots.length) void restoreSnapshotsFromBundle(doc.id, merged) // heal OPFS
    return { ok: true, webUrl }
  } catch {
    return { ok: false, webUrl: null }
  }
}
