// OneDrive sync via Microsoft Graph (cross-browser cloud storage). File System Access is
// Chromium-only, so this gives Firefox/Safari writers (and anyone) a way to sync their record to
// OneDrive: sign in with a Microsoft account (OAuth 2.0 PKCE via MSAL), then PUT the files into the
// app's OneDrive folder (OneDrive/Apps/Inkwave) with the least-privilege Files.ReadWrite.AppFolder
// scope. Only an access token + the file bytes leave the browser, straight to Microsoft Graph — no
// Inkwave server is involved.
//
// Requires an Azure app registration (a public SPA client id) in VITE_MS_CLIENT_ID; the feature is
// hidden until that's configured. MSAL is lazily imported so it's a separate client chunk and never
// enters the prerender/SSR graph.

import type { InkwaveDocument, Snapshot } from '../types/document'
import { buildExportBundle, bundleFilename, composeTraceFile, TRACE_EXTENSION } from '../provenance/bundle'
import { parseTraceOffThread } from '../workers/parseClient'
import { mergeSnapshots, restoreSnapshotsFromBundle, needsWritebackMerge, markWritebackMerged } from '../provenance/snapshots'
import { loadPdf, savePdf } from '../citations/pdfStore'
import type { CSLItem, IwCitationMeta } from '../types/document'
import { readAppJson, writeAppJson } from './opfs'
import { setDocSource } from './docSource'

// The OneDrive folder the writer chose to sync into. id '' (or null) = the OneDrive root. `path` is
// a human-readable location ("Documents/Inkwave") for display. Persisted so the choice sticks.
export interface OneDriveFolder { id: string; path: string }
const FOLDER_KEY = 'inkwave:onedrive-folder'

export function getChosenFolder(): OneDriveFolder | null {
  try { const s = localStorage.getItem(FOLDER_KEY); return s ? (JSON.parse(s) as OneDriveFolder) : null } catch { return null }
}
export function setChosenFolder(folder: OneDriveFolder | null): void {
  try { folder ? localStorage.setItem(FOLDER_KEY, JSON.stringify(folder)) : localStorage.removeItem(FOLDER_KEY) } catch { /* private mode */ }
}

// Recently-chosen folders (kept in OPFS), surfaced at the top of the picker. Most-recent first, deduped.
const RECENTS_FILE = 'onedrive-recent-folders.json'
const MAX_RECENTS = 6
export async function getRecentFolders(): Promise<OneDriveFolder[]> {
  return (await readAppJson<OneDriveFolder[]>(RECENTS_FILE)) ?? []
}
export async function addRecentFolder(folder: OneDriveFolder): Promise<void> {
  const list = await getRecentFolders()
  const next = [folder, ...list.filter((f) => !(f.id === folder.id && f.path === folder.path))].slice(0, MAX_RECENTS)
  await writeAppJson(RECENTS_FILE, next)
}

// The pinned per-document OneDrive filename (see stableFilename). Exposed so "Save a copy" can point
// future syncs at a NEW filename (the copy), leaving the previous file untouched in OneDrive.
function nameKey(docId: string): string { return `inkwave:onedrive-name:${docId}` }
export function oneDriveFilename(docId: string): string | null {
  try { return localStorage.getItem(nameKey(docId)) } catch { return null }
}
export function setOneDriveFilename(docId: string, name: string): void {
  const clean = /\.(studio|inkwave|trace\.json|insig\.json)$/i.test(name) ? name : `${name.replace(/\.(json|inkwave|studio)$/i, '')}.studio`
  try { localStorage.setItem(nameKey(docId), clean) } catch { /* private mode */ }
}

// The OneDrive filename is PINNED per-document the first time we sync. The slug is derived from the
// title, which is re-derived from the text on every edit — so without pinning, each sync would PUT a
// different name and create a new file every few seconds instead of overwriting the same one.
function stableFilename(doc: InkwaveDocument): string {
  try {
    const existing = localStorage.getItem(nameKey(doc.id))
    if (existing) return existing
    const name = bundleFilename(doc)
    localStorage.setItem(nameKey(doc.id), name)
    return name
  } catch {
    return bundleFilename(doc)
  }
}

/** Where the synced file lives in the user's OneDrive (for display), honouring the chosen folder. */
export function oneDrivePath(doc: InkwaveDocument): string {
  const folder = getChosenFolder()
  const prefix = folder?.path ? `${folder.path}/` : ''
  return `${prefix}${stableFilename(doc)}`
}

// The Azure app (SPA) client id — PUBLIC (it appears in OAuth redirects), so it's committed as the
// default and overridable via VITE_MS_CLIENT_ID. Redirect URIs registered: https://iwsolo.me
// + https://www.iwsolo.me + http://localhost:5173 (dev). Authority /common + delegated Files.ReadWrite.
const CLIENT_ID = (import.meta.env?.VITE_MS_CLIENT_ID as string | undefined) || 'be76cc89-ab01-4681-99c0-f37b9f9d2308'
// Personal + work/school accounts. Files.ReadWrite (full drive) so the writer can pick ANY folder
// to sync into; existing AppFolder-only sessions are re-prompted to consent on the next sync.
const AUTHORITY = 'https://login.microsoftonline.com/common'
const SCOPES = ['Files.ReadWrite', 'User.Read']
const GRAPH = 'https://graph.microsoft.com/v1.0'

/** Is OneDrive sync configured (an Azure client id is present)? */
export function oneDriveConfigured(): boolean {
  return !!CLIENT_ID
}

// MSAL is browser-only and heavy — load it on demand.
let appPromise: Promise<unknown> | null = null
async function getApp(): Promise<{
  getAllAccounts: () => Array<{ username: string }>
  acquireTokenSilent: (o: unknown) => Promise<{ accessToken: string }>
  loginRedirect: (o: unknown) => Promise<void>
}> {
  if (!CLIENT_ID) throw new Error('OneDrive not configured')
  if (!appPromise) {
    appPromise = import('@azure/msal-browser').then(async (m) => {
      const app = new m.PublicClientApplication({
        auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: window.location.origin },
        // sessionStorage, NOT localStorage: keeps the OneDrive access token out of a persistent,
        // cross-tab, XSS-readable store. It still survives the same-tab Microsoft redirect (which is
        // all the redirect flow needs); the cost is a re-auth in a fresh tab, an acceptable trade.
        // localStorage on TOUCH devices (2026-07-10): iOS Safari treats every launch as a new
        // session, so sessionStorage meant re-auth on every visit — the recurring 'PDF isn't on
        // this device / picker empty' reports. Desktop keeps sessionStorage (tighter XSS surface).
        cache: { cacheLocation: (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches) ? 'localStorage' : 'sessionStorage' },
      })
      await app.initialize()
      // Same-window flow: process the auth response when we return from the Microsoft redirect.
      await app.handleRedirectPromise()
      return app
    })
  }
  return appPromise as Promise<Awaited<ReturnType<typeof getApp>>>
}

/** The signed-in Microsoft account's username/email, or null. */
export async function oneDriveAccount(): Promise<string | null> {
  if (!CLIENT_ID) return null
  try {
    const app = await getApp()
    return app.getAllAccounts()[0]?.username ?? null
  } catch {
    return null
  }
}

// Silent access token (an existing session only — no UI). null if not signed in / expired.
// Exported so the folder picker can call Graph directly.
export async function getSilentToken(): Promise<string | null> {
  const app = await getApp()
  const account = app.getAllAccounts()[0]
  if (!account) return null
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken
  } catch {
    return null
  }
}

const PENDING_KEY = 'inkwave:onedrive-pending'

/** Begin sign-in in the SAME window (full-page redirect to Microsoft and back). Flags that a sync
 *  is wanted on return. The page navigates away; work is restored from OPFS when it comes back. */
export async function startOneDriveSignIn(): Promise<void> {
  if (!CLIENT_ID) return
  try { sessionStorage.setItem(PENDING_KEY, '1') } catch { /* private mode */ }
  const app = await getApp()
  await app.loginRedirect({ scopes: SCOPES })
}

/** True if we just returned from a sign-in redirect and should sync now. */
export function oneDriveSyncPending(): boolean {
  try { return sessionStorage.getItem(PENDING_KEY) === '1' } catch { return false }
}
export function clearOneDriveSyncPending(): void {
  try { sessionStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}

// The Graph /content URL for the synced file — addressed by path relative to a folder id, or root.
function contentUrl(name: string): string {
  const folder = getChosenFolder()
  return folder?.id
    ? `${GRAPH}/me/drive/items/${folder.id}:/${encodeURIComponent(name)}:/content`
    : `${GRAPH}/me/drive/root:/${encodeURIComponent(name)}:/content`
}

// PUT the file into the chosen folder (or the OneDrive root). Returns the file's webUrl so the UI
// can offer "open in OneDrive".
async function putFile(token: string, name: string, content: string): Promise<string | null> {
  const res = await fetch(contentUrl(name), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: content,
  })
  if (!res.ok) throw new Error(`Graph upload failed (${res.status})`)
  const data = await res.json().catch(() => ({} as { webUrl?: string }))
  return (data as { webUrl?: string }).webUrl ?? null
}

// ─── Generic small-file access (the productivity ledger; NOT the .studio) ─────
// The ledger is its own small JSON file beside the .studio. These two exports are deliberately
// dumb: they move bytes and REPORT WHAT HAPPENED. In particular a 404 (the file does not exist yet)
// is a DIFFERENT answer from a failure, and the caller must be able to tell them apart — treating
// "I couldn't read it" as "there's nothing there" is precisely the 2026-07-15 blind overwrite.

export type OneDriveReadResult =
  | { status: 'ok'; text: string }
  | { status: 'absent' }
  | { status: 'error'; reason: string }

/**
 * Map a Graph GET's HTTP status to the union. PURE, exported, and tested — because this one line is
 * the entire absent-vs-error decision, and F16's lesson is that a perfectly-typed union guards the
 * CONSUMER while the PRODUCER quietly decides the answer. `404 ⇒ absent` licenses a first write; a
 * mistake in the other direction (a failure read as "not there") is the 2026-07-15 blind overwrite.
 *
 * FAIL-SAFE BY DESIGN: everything that is not exactly 404 is an ERROR. A Graph status we have never
 * seen makes sync refuse to write, never destroy. That is also why 401/403 are errors and not
 * "absent" — an expired token means we cannot SEE the file, not that it is gone.
 */
export function mapGraphReadStatus(status: number): 'ok' | 'absent' | 'error' {
  if (status === 404) return 'absent'
  if (status >= 200 && status < 300) return 'ok'
  return 'error'
}

/**
 * Read a small file by name from the chosen folder.
 *
 * NEVER THROWS — and that used to be a lie (auditor F13, 2026-07-17): `getSilentToken()` sat OUTSIDE
 * the try, so an MSAL failure threw straight through a function whose contract says it returns an
 * error union. The whole point of the union is that a caller cannot forget the failure case; a
 * producer that throws instead of returning `error` hands the caller an exception it never wrote a
 * branch for. Everything fallible is now inside the try.
 */
export async function readOneDriveText(name: string): Promise<OneDriveReadResult> {
  try {
    if (!CLIENT_ID) return { status: 'error', reason: 'OneDrive not configured' }
    const token = await getSilentToken()
    if (!token) return { status: 'error', reason: 'not signed in' }
    const res = await fetch(contentUrl(name), { headers: { Authorization: `Bearer ${token}` } })
    const kind = mapGraphReadStatus(res.status)
    if (kind === 'absent') return { status: 'absent' }
    if (kind === 'error') return { status: 'error', reason: `Graph GET ${res.status}` }
    return { status: 'ok', text: await res.text() }
  } catch (e) {
    return { status: 'error', reason: `onedrive read: ${(e as Error)?.message ?? String(e)}` }
  }
}

/** Write a small file by name into the chosen folder. False on any failure (caller keeps local). */
export async function writeOneDriveText(name: string, text: string): Promise<boolean> {
  try {
    if (!CLIENT_ID) return false
    const token = await getSilentToken() // inside the try: same F13 hole as the reader had
    if (!token) return false
    await putFile(token, name, text)
    return true
  } catch {
    return false // the caller keeps local; nothing is lost
  }
}

// The Graph metadata URL for the synced file (same addressing as contentUrl, minus `:/content`).
function itemUrl(name: string): string {
  const folder = getChosenFolder()
  const base = folder?.id
    ? `${GRAPH}/me/drive/items/${folder.id}:/${encodeURIComponent(name)}`
    : `${GRAPH}/me/drive/root:/${encodeURIComponent(name)}`
  return `${base}?$select=lastModifiedDateTime,webUrl,size`
}

// When WE last uploaded (per doc, local clock) — the baseline the metadata heartbeat compares against.
const writeAtKey = (docId: string) => `inkwave:odWriteAt:${docId}`
function recordOneDriveWrite(docId: string): void {
  try { localStorage.setItem(writeAtKey(docId), String(Date.now())) } catch { /* private mode */ }
}

/** Cheap remote-file check: validates the silent token and returns the file's link + modified time
 *  from Graph METADATA — never downloads the (possibly 20 MB) body. Used by resume-on-load and the
 *  heartbeat, both of which previously fetched + parsed the whole file. */
export async function getRemoteFileInfo(doc: InkwaveDocument): Promise<{ webUrl: string | null; modifiedAt: number } | null> {
  if (!CLIENT_ID) return null
  const token = await getSilentToken()
  if (!token) return null
  try {
    const res = await fetch(itemUrl(stableFilename(doc)), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const d = (await res.json()) as { webUrl?: string; lastModifiedDateTime?: string }
    return { webUrl: d.webUrl ?? null, modifiedAt: d.lastModifiedDateTime ? new Date(d.lastModifiedDateTime).getTime() : 0 }
  } catch {
    return null
  }
}

/** Warm the once-per-session grow-only merge at IDLE, without uploading (see folder.preMergeSaveFile
 *  — same rationale: the first sync fires on a checkpoint mid-typing; do the download+parse now). */
export async function preMergeRemote(doc: InkwaveDocument): Promise<void> {
  const key = `onedrive:${doc.id}`
  if (!CLIENT_ID || !needsWritebackMerge(key)) return
  const token = await getSilentToken()
  if (!token) return
  try {
    const res = await fetch(contentUrl(stableFilename(doc)), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const remote = await parseTraceOffThread(await res.text())
    if (remote.snapshots?.length) await restoreSnapshotsFromBundle(doc.id, remote.snapshots)
    markWritebackMerged(key)
  } catch { /* no remote yet → the first sync retries its own merge */ }
}

/** Multi-device guard WITHOUT downloading the file — metadata only, mirroring readLocalHeartbeat's
 *  design: the remote file having been modified well after OUR last upload means another device wrote
 *  it. The generous margin absorbs Graph-server vs local clock skew; the guard is purely advisory. */
export async function readRemoteHeartbeat(doc: InkwaveDocument): Promise<{ session?: string; exportedAt?: string } | null> {
  const info = await getRemoteFileInfo(doc)
  if (!info?.modifiedAt) return null
  let ourWrite = 0
  try { ourWrite = Number(localStorage.getItem(writeAtKey(doc.id))) || 0 } catch { /* private mode */ }
  if (ourWrite && info.modifiedAt > ourWrite + 10_000) {
    return { session: 'other-device', exportedAt: new Date(info.modifiedAt).toISOString() }
  }
  return null // we wrote it last (or haven't uploaded from this device yet) → no conflict
}

export interface DriveFolder { id: string; name: string }

// Common "quick access" destinations, resolved via Graph special folders (any that 404 are skipped).
const QUICK_SPECIAL = ['documents', 'photos', 'music', 'cameraroll'] as const

/** Resolve the writer's quick-access folders (Documents, Photos, …) for the top of the picker. */
export async function listQuickFolders(): Promise<DriveFolder[]> {
  const token = await getSilentToken()
  if (!token) return []
  const out: DriveFolder[] = []
  for (const s of QUICK_SPECIAL) {
    try {
      const res = await fetch(`${GRAPH}/me/drive/special/${s}?$select=id,name`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { const d = (await res.json()) as { id: string; name: string }; out.push({ id: d.id, name: d.name }) }
    } catch { /* skip */ }
  }
  return out
}

/** List the sub-folders of a folder (null/'' = OneDrive root) for the folder picker. */
export async function listFolders(parentId: string | null): Promise<DriveFolder[]> {
  const token = await getSilentToken()
  if (!token) throw new Error('not signed in')
  const base = parentId ? `${GRAPH}/me/drive/items/${parentId}/children` : `${GRAPH}/me/drive/root/children`
  const items = await listAllPages<{ id: string; name: string; folder?: unknown }>(
    `${base}?$select=id,name,folder&$top=200&$orderby=name`, token)
  return items.filter((it) => it.folder).map((it) => ({ id: it.id, name: it.name }))
}

/** Create a sub-folder in `parentId` (null/'' = OneDrive root) and return it. Auto-renames on clash. */
export async function createOneDriveFolder(parentId: string | null, name: string): Promise<DriveFolder> {
  const token = await getSilentToken()
  if (!token) throw new Error('not signed in')
  const base = parentId ? `${GRAPH}/me/drive/items/${parentId}/children` : `${GRAPH}/me/drive/root/children`
  const res = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
  })
  if (!res.ok) throw new Error(`Graph create folder failed (${res.status})`)
  const d = (await res.json()) as { id: string; name: string }
  return { id: d.id, name: d.name }
}

// ─── Open a file FROM OneDrive (Upload — esp. phone, where OneDrive isn't a mounted folder) ───────
// Broad on purpose: real Inkwave files show up as .studio.gz (zipped exports), .trace.json/.json
// (pre-.studio era), or .txt (iOS "rename on share" mangling). The opener validates by CONTENT
// (parseTraceFile anchors on the record marker), so listing broadly is safe — a wrong pick errors.
const OPENABLE_FILE_RE = /\.(studio|studio\.gz|inkwave|trace\.json|insig\.json|json|txt)$/i

/** An openable OneDrive file, with the metadata the open cache keys on: cTag is Graph's CONTENT
 *  tag (changes only when the file's bytes change — a rename doesn't invalidate the cache); eTag
 *  is the fallback for the rare items without one (over-invalidates, which is always safe). */
export interface OneDriveFileEntry { id: string; name: string; cTag?: string; size?: number; modifiedAt?: number }

// Graph pages children at $top and every doc's PDF sidecars live in the SAME folder — past one
// page, .studio files sorting after the cut silently vanish from the picker (2026-07-11 "open
// file is not showing the studio files"). Follow @odata.nextLink to exhaustion (capped).
async function listAllPages<T>(firstUrl: string, token: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = firstUrl
  for (let page = 0; url && page < 20; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Graph list failed (${res.status})`)
    const data = (await res.json()) as { value: T[]; '@odata.nextLink'?: string }
    out.push(...data.value)
    url = data['@odata.nextLink'] ?? null
  }
  return out
}

/** List the openable FILES in a folder (null/'' = root) for the file opener. */
export async function listOneDriveFiles(parentId: string | null): Promise<OneDriveFileEntry[]> {
  const token = await getSilentToken()
  if (!token) throw new Error('not signed in')
  const base = parentId ? `${GRAPH}/me/drive/items/${parentId}/children` : `${GRAPH}/me/drive/root/children`
  // The enriched $select feeds the open cache (change-tags) + recency prefetch. Graph's consumer
  // (personal) drives are pickier about $select/$orderby combinations than the docs admit, and a
  // rejected field would 400 the WHOLE listing — the picker regression ("not seeing the files",
  // 2026-07-10). So: any failure of the enriched request retries the proven pre-cache minimal
  // listing before erroring. Files then still list + open; the byte cache just misses (safe).
  type Item = { id: string; name: string; file?: unknown; cTag?: string; eTag?: string; size?: number; lastModifiedDateTime?: string }
  let items: Item[]
  try {
    items = await listAllPages<Item>(`${base}?$select=id,name,file,cTag,eTag,size,lastModifiedDateTime&$top=200&$orderby=name`, token)
  } catch (err) {
    console.warn(`[inkwave] enriched OneDrive listing failed (${String(err)}) — retrying the minimal listing`)
    items = await listAllPages<Item>(`${base}?$select=id,name,file&$top=200&$orderby=name`, token)
  }
  return items
    .filter((it) => it.file && OPENABLE_FILE_RE.test(it.name))
    .map((it) => ({
      id: it.id,
      name: it.name,
      cTag: it.cTag ?? it.eTag,
      size: it.size,
      modifiedAt: it.lastModifiedDateTime ? Date.parse(it.lastModifiedDateTime) : undefined,
    }))
}

/** The LIVE change-tag for one item (metadata GET, no body) — the open cache verifies a cached
 *  copy against this when the picker's listing itself came from cache (a stale listing tag must
 *  never produce a false cache hit). null on any failure (offline / no token). */
export async function getOneDriveItemTag(itemId: string): Promise<string | null> {
  try {
    const token = await getSilentToken()
    if (!token) return null
    const res = await fetch(`${GRAPH}/me/drive/items/${itemId}?$select=cTag,eTag`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const d = (await res.json()) as { cTag?: string; eTag?: string }
    return d.cTag ?? d.eTag ?? null
  } catch { return null }
}

/** Download a OneDrive file's raw bytes by item id. Bytes, NOT text: a .studio.gz is gzip binary,
 *  and text-decoding it corrupts the stream before readStudioFile can sniff the 1f 8b magic. */
export async function downloadOneDriveFile(itemId: string): Promise<Blob | null> {
  const token = await getSilentToken()
  if (!token) return null
  const res = await fetch(`${GRAPH}/me/drive/items/${itemId}/content`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.blob()
}

/** Adopt an opened OneDrive file as this doc's sync target so future syncs UPDATE it (no Save). */
export function adoptOneDriveFile(docId: string, folder: OneDriveFolder, name: string): void {
  setChosenFolder(folder)        // global sync folder = the opened file's folder
  setOneDriveFilename(docId, name)
  setDocSource(docId, 'onedrive')
}

export interface SyncResult { ok: boolean; webUrl: string | null }

/**
 * Sync the single self-contained .trace.json to the chosen OneDrive folder using the existing session
 * (no UI). ok:false if not signed in / the scope isn't consented — call startOneDriveSignIn() first.
 */
export async function syncToOneDrive(doc: InkwaveDocument, snapshots: Snapshot[]): Promise<SyncResult> {
  if (!CLIENT_ID) return { ok: false, webUrl: null }
  const token = await getSilentToken()
  if (!token) return { ok: false, webUrl: null }
  // The .studio stays LEAN (no PDF bytes) so text edits don't re-upload megabytes. The cited PDFs go
  // as sidecar files next to it, uploaded once (re-uploaded only if the PDF itself changes).
  const studioName = oneDriveFilename(doc.id) ?? bundleFilename(doc)
  // GROW-ONLY: union the remote file's snapshots in before overwriting so a short local set can't
  // truncate history — but only ONCE per session (the per-sync GET+parse of a big file adds lag).
  let merged = snapshots
  const key = `onedrive:${doc.id}`
  if (needsWritebackMerge(key)) {
    try {
      const res = await fetch(contentUrl(studioName), { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const remote = await parseTraceOffThread(await res.text())
        if (remote.snapshots?.length) merged = mergeSnapshots(remote.snapshots, snapshots)
        markWritebackMerged(key)
      }
    } catch { /* no remote yet → write local as-is; retry the merge next sync */ }
  }
  const bundle = buildExportBundle(doc, merged)
  try {
    const webUrl = await putFile(token, studioName, composeTraceFile(bundle))
    recordOneDriveWrite(doc.id) // heartbeat baseline: metadata newer than this = another device
    setDocSource(doc.id, 'onedrive')
    void uploadPdfSidecars(token, doc.id, studioName, bundle.bibliography ?? []) // fire-and-forget
    if (merged.length > snapshots.length) void restoreSnapshotsFromBundle(doc.id, merged) // heal OPFS
    return { ok: true, webUrl }
  } catch {
    return { ok: false, webUrl: null }
  }
}

// ── PDF sidecars ──────────────────────────────────────────────────────────────
// A cited source's PDF is stored beside the .studio as "<base>.<citekey>.pdf". Uploaded once and
// tracked per-doc (by pdfName), so annotations — which live as JSON in the .studio, not in the PDF —
// never trigger a re-upload; only replacing the PDF does.
const sidecarBase = (studioName: string) => studioName.replace(/\.(studio|inkwave)$/i, '')
const sidecarName = (studioName: string, citekey: string) => `${sidecarBase(studioName)}.${citekey.replace(/[^\w.-]/g, '_')}.pdf`

function contentUrlIn(folder: OneDriveFolder | null, name: string): string {
  return folder?.id
    ? `${GRAPH}/me/drive/items/${folder.id}:/${encodeURIComponent(name)}:/content`
    : `${GRAPH}/me/drive/root:/${encodeURIComponent(name)}:/content`
}

const pdfNameOf = (item: CSLItem): string | undefined => (item as { _iw?: IwCitationMeta })._iw?.pdfName

async function uploadPdfSidecars(token: string, docId: string, studioName: string, items: CSLItem[]): Promise<void> {
  const folder = getChosenFolder()
  const doneKey = `inkwave:od-pdfsidecars:${docId}`
  let done: Record<string, string> = {}
  try { done = JSON.parse(localStorage.getItem(doneKey) || '{}') } catch { /* ignore */ }
  for (const item of items) {
    const name = pdfNameOf(item)
    if (!name || done[item.id] === name) continue // no PDF, or this exact PDF already uploaded
    const blob = await loadPdf(item.id)
    if (!blob) continue
    try {
      const res = await fetch(contentUrlIn(folder, sidecarName(studioName, item.id)), {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: blob,
      })
      if (res.ok) done[item.id] = name
    } catch { /* leave for the next sync */ }
  }
  try { localStorage.setItem(doneKey, JSON.stringify(done)) } catch { /* ignore */ }
}

/** Download a doc's PDF sidecars into OPFS when opening it from OneDrive. */
export async function fetchPdfSidecars(folder: OneDriveFolder | null, studioName: string, items: CSLItem[]): Promise<void> {
  if (!oneDriveConfigured()) return
  const token = await getSilentToken()
  if (!token) return
  for (const item of items) {
    if (!pdfNameOf(item)) continue
    if (await loadPdf(item.id)) continue // already have it locally
    try {
      const res = await fetch(contentUrlIn(folder, sidecarName(studioName, item.id)), { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) await savePdf(item.id, await res.blob())
    } catch { /* skip missing sidecar */ }
  }
}

/** Fetch ONE missing sidecar on demand (e.g. the reader tapped a PDF whose bytes aren't local).
 *  Historical iOS trap: savePdf threw on WebKit until the OPFS write shim (2026-07-08), so a doc's
 *  sidecar pass could "complete" with nothing stored. This + the quiet-pass refetch heal that. */
export type SidecarFetchResult = { ok: true } | { ok: false; reason: 'unavailable' | 'no-auth' | 'not-found' }
export async function fetchSidecarFor(docId: string, item: CSLItem): Promise<SidecarFetchResult> {
  if (!oneDriveConfigured() || !pdfNameOf(item)) return { ok: false, reason: 'unavailable' }
  const token = await getSilentToken()
  if (!token) return { ok: false, reason: 'no-auth' } // not signed in on THIS device/session
  const studioName = oneDriveFilename(docId)
  if (!studioName) return { ok: false, reason: 'unavailable' }
  try {
    const res = await fetch(contentUrlIn(getChosenFolder(), sidecarName(studioName, item.id)), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { ok: false, reason: 'not-found' }
    await savePdf(item.id, await res.blob())
    return { ok: true }
  } catch {
    return { ok: false, reason: 'not-found' }
  }
}

/** Re-fetch any missing sidecars for a doc's cited items (idempotent — skips bytes already local). */
export async function fetchMissingSidecars(docId: string, items: CSLItem[]): Promise<void> {
  const studioName = oneDriveFilename(docId)
  if (!studioName) return
  await fetchPdfSidecars(getChosenFolder(), studioName, items)
}

const ensureExt = (name: string) => (name.toLowerCase().endsWith(`.${TRACE_EXTENSION}`) ? name : `${name}.${TRACE_EXTENSION}`)

/** Rename the synced OneDrive file in place (PATCH by its current path) and remember the new name for
 *  future syncs. If nothing's synced yet, the name just applies on the next sync. */
export async function renameOneDriveFile(doc: InkwaveDocument, name: string): Promise<boolean> {
  const clean = ensureExt(name.trim())
  if (!clean || clean === `.${TRACE_EXTENSION}`) return false
  const oldName = oneDriveFilename(doc.id) ?? bundleFilename(doc)
  setOneDriveFilename(doc.id, clean)
  if (!CLIENT_ID) return true
  const token = await getSilentToken()
  if (!token) return false
  const folder = getChosenFolder()
  const itemPath = folder?.id
    ? `${GRAPH}/me/drive/items/${folder.id}:/${encodeURIComponent(oldName)}:`
    : `${GRAPH}/me/drive/root:/${encodeURIComponent(oldName)}:`
  const res = await fetch(itemPath, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean }),
  })
  return res.ok || res.status === 404 // 404 = nothing synced under the old name yet; next sync names it
}
