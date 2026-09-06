// OneDrive sync via Microsoft Graph — the cross-browser cloud destination (File System Access is
// Chromium-only). Sign in with a Microsoft account (OAuth 2.0 PKCE via MSAL), then PUT into the
// chosen folder. ONLY an access token + the file bytes leave the browser, straight to Graph — no
// Inkwave server is involved.
//
// ⚠ It MIRRORS gdrive.ts, and the two have drifted apart twice with a data-loss bug on one side only.
// The safety rule is `planWriteback`, shared; this file owns only the mapping of GRAPH's failure
// surface into `ArchiveRead`. → docs/archive/storage-and-sync.md#cloud

import type { InkwaveDocument, Snapshot } from '../types/document'
import { buildExportBundle, bundleFilename, composeTraceFile, TRACE_EXTENSION } from '../provenance/bundle'
import { parseTraceOffThread } from '../workers/parseClient'
import { restoreSnapshotsFromBundle, needsWritebackMerge, markWritebackMerged } from '../provenance/snapshots'
import { planWriteback, archiveSnapshotsOf, type ArchiveRead, type WritePrecondition } from './archiveWriteback'
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
export function clearOneDriveFile(docId: string): void {
  try { localStorage.removeItem(nameKey(docId)) } catch { /* private mode */ }
}

// ⚠ THE FILENAME IS PINNED per-document at the first sync. The slug comes from the title, which is
// re-derived from the text on every edit — so without pinning, each sync PUTs a different name and
// creates a new file every few seconds. → docs/archive/storage-and-sync.md#od-scopes
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

// The Azure app (SPA) client id — PUBLIC (it appears in OAuth redirects), so committed as the default
// and overridable. Registered redirect URIs + the scope rationale are in the archive.
const CLIENT_ID = (import.meta.env?.VITE_MS_CLIENT_ID as string | undefined) || 'be76cc89-ab01-4681-99c0-f37b9f9d2308'
// /common covers personal + work/school. Files.ReadWrite (full drive) so the writer can pick ANY
// folder; AppFolder-only sessions re-consent on the next sync.
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

/**
 * Translate a write precondition into Graph's wire form (Finding E). PURE and exported so it can be
 * tested without a Microsoft account — the DECISION is testable even where the SERVER's honouring of
 * it is not. → docs/archive/storage-and-sync.md#cloud-metadata-only
 */
export function graphWriteOptions(pre: WritePrecondition): { query: string; headers: Record<string, string> } {
  if (pre.expect === 'absent') return { query: '?@microsoft.graph.conflictBehavior=fail', headers: {} }
  if (pre.expect === 'unchanged') return { query: '', headers: { 'If-Match': pre.etag } }
  return { query: '', headers: {} } // no version to pin — the pre-existing, unguarded posture
}

// PUT the file into the chosen folder (or the OneDrive root). Returns the file's webUrl so the UI
// can offer "open in OneDrive".
//
// ⚠ THE PRECONDITIONS ARE STATED, NOT PROBED — and they FAIL SAFE, which is why they ship. Neither
// the query parameter nor the If-Match header has been exercised against real Graph; if either is
// wrong the write is REFUSED, never mis-applied. A wrong guess costs a sync cycle; the bug it
// prevents costs the rows. → docs/archive/storage-and-sync.md#cloud-metadata-only
async function putFile(token: string, name: string, content: string, pre: WritePrecondition): Promise<string | null> {
  const { query, headers } = graphWriteOptions(pre)
  const res = await fetch(contentUrl(name) + query, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain', ...headers },
    body: content,
  })
  // 409 and 412 are the precondition doing its job — a real remote we had not reconciled with. Loud,
  // not silent, and never a write.
  if (res.status === 409 || res.status === 412) {
    throw new Error(`Graph precondition failed (${res.status}) — the remote moved; retrying next sync`)
  }
  if (!res.ok) throw new Error(`Graph upload failed (${res.status})`)
  const data = await res.json().catch(() => ({} as { webUrl?: string }))
  return (data as { webUrl?: string }).webUrl ?? null
}

// ─── Generic small-file access (the productivity ledger; NOT the .studio) ─────
// Deliberately dumb: they move bytes and REPORT WHAT HAPPENED. ⚠ A 404 is a DIFFERENT answer from a
// failure and the caller must be able to tell them apart — treating "I couldn't read it" as "there's
// nothing there" is precisely the 2026-07-15 blind overwrite.

export type OneDriveReadResult =
  /** `etag` is the version read, for the write's precondition (Finding E). null when Graph sent
   *  none — stated out loud rather than omitted, so the caller cannot silently write unguarded. */
  | { status: 'ok'; text: string; etag: string | null }
  | { status: 'absent' }
  | { status: 'error'; reason: string }

/**
 * Map a Graph GET's HTTP status to the union. PURE, exported and tested, because ⚠ THIS ONE LINE IS
 * THE ENTIRE ABSENT-VS-ERROR DECISION and a typed union guards the CONSUMER while the PRODUCER
 * quietly decides the answer.
 *
 * ⚠ FAIL-SAFE BY DESIGN: everything that is not exactly 404 is an ERROR, so a Graph status we have
 * never seen makes sync refuse to write rather than destroy. 401/403 are errors and NOT "absent" —
 * an expired token means we cannot SEE the file, not that it is gone.
 * → docs/archive/storage-and-sync.md#cloud-status-map
 */
export function mapGraphReadStatus(status: number): 'ok' | 'absent' | 'error' {
  if (status === 404) return 'absent'
  if (status >= 200 && status < 300) return 'ok'
  return 'error'
}

/**
 * Read a small file by name from the chosen folder.
 *
 * ⚠ NEVER THROWS — keep everything fallible INSIDE the try. It used to be a lie: `getSilentToken()`
 * sat outside it, so an MSAL failure threw straight through a function whose contract says it returns
 * an error union, handing the caller an exception it never wrote a branch for.
 * → docs/archive/storage-and-sync.md#cloud-status-map
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
    return { status: 'ok', text: await res.text(), etag: res.headers.get('ETag') }
  } catch (e) {
    return { status: 'error', reason: `onedrive read: ${(e as Error)?.message ?? String(e)}` }
  }
}

/**
 * Write a small file by name into the chosen folder, ONLY if `pre` still holds. False on any failure,
 * a violated precondition included — the caller keeps local and the next sync re-reads.
 * ⚠ `pre` is REQUIRED: an optional precondition is one a caller forgets, silently.
 */
export async function writeOneDriveText(name: string, text: string, pre: WritePrecondition): Promise<boolean> {
  try {
    if (!CLIENT_ID) return false
    const token = await getSilentToken() // inside the try: same F13 hole as the reader had
    if (!token) return false
    await putFile(token, name, text, pre)
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

/** Cheap remote-file check: the file's link + modified time from Graph METADATA. ⚠ Never downloads
 *  the (possibly 20 MB) body — resume-on-load and the heartbeat both used to fetch and parse the
 *  whole file. → docs/archive/storage-and-sync.md#cloud-metadata-only */
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

/** Warm the once-per-session grow-only merge at IDLE, without uploading — the first sync otherwise
 *  fires on a checkpoint mid-typing.
 *
 * ⚠ THIS PASS CLOSES THE MERGE GATE, so it is a WRITE-BACK DECISION wearing a cache-warmer's clothes
 * and it MUST use the same read as the sync path. The gate sits UPSTREAM of `syncToOneDrive`'s guard,
 * so closing it on a read we did not establish means `planWriteback` is never even called and the
 * next checkpoint PUTs the short local set unopposed. A private `fetch` + parse here is exactly how
 * Drive's copy drifted into a live data-loss bug.
 * → docs/archive/storage-and-sync.md#cloud-warm-pass */
export async function preMergeRemote(doc: InkwaveDocument): Promise<void> {
  const key = `onedrive:${doc.id}`
  if (!CLIENT_ID || !needsWritebackMerge(key)) return
  const token = await getSilentToken()
  if (!token) return // no session: nothing established, gate stays open (not an error — just not yet)
  const read = await readRemoteArchive(token, stableFilename(doc))
  if (read.status === 'error') {
    console.info(`[inkwave] OneDrive warm merge skipped: ${read.reason} — the next sync retries the read`)
    return // THE LOAD-BEARING LINE: we established nothing, so the gate MUST stay open.
  }
  if (read.status === 'ok' && read.snapshots.length) {
    // A restore failure must not close the gate either: the merge did not happen, so the sync's own
    // read is still the only thing standing between a short local set and the archive.
    try {
      await restoreSnapshotsFromBundle(doc.id, read.snapshots)
    } catch (e) {
      console.info(`[inkwave] OneDrive warm merge: local restore failed (${String(e)}) — the next sync retries`)
      return
    }
  }
  markWritebackMerged(key) // 'absent' or a merged 'ok' — both are facts we established.
}

/** Multi-device guard WITHOUT downloading the file — metadata only: modified well after OUR last
 *  upload means another device wrote it. The generous margin absorbs server-vs-local clock skew, and
 *  the guard is purely advisory. */
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
// BROAD ON PURPOSE — real Inkwave files arrive as .studio.gz, .trace.json/.json (pre-.studio era) or
// .txt (iOS "rename on share"). The opener validates by CONTENT, so a wrong pick errors.
const OPENABLE_FILE_RE = /\.(studio|studio\.gz|inkwave|trace\.json|insig\.json|json|txt)$/i

/** An openable OneDrive file, with the metadata the open cache keys on: cTag is Graph's CONTENT tag
 *  (a rename doesn't invalidate the cache), eTag the fallback — which over-invalidates, always the
 *  safe direction. → docs/archive/storage-and-sync.md#cloud-listing */
export interface OneDriveFileEntry { id: string; name: string; cTag?: string; size?: number; modifiedAt?: number }

// ⚠ FOLLOW @odata.nextLink TO EXHAUSTION. Graph pages children at $top and every doc's PDF sidecars
// live in the SAME folder, so past one page the .studio files sorting after the cut vanish from the
// picker silently. → docs/archive/storage-and-sync.md#cloud-listing
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
  // ⚠ THE ENRICHED $select MUST DEGRADE. It feeds the open cache, but consumer drives are pickier
  // about $select/$orderby than the docs admit and a rejected field 400s the WHOLE listing — the
  // 2026-07-10 "not seeing the files" regression. Retry the minimal listing before erroring: files
  // still list and open, and only the byte cache misses.
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
/**
 * Read the remote .studio's snapshot archive, reporting WHAT HAPPENED — OneDrive's half of the
 * write-back decision, and the only half it owns. ⚠ REUSE `mapGraphReadStatus` rather than
 * re-deriving the absent-vs-error rule, and note that a PARSE failure is an ERROR: a truncated or
 * garbled download tells us nothing about what the file holds, and "I could not decode it" must
 * never license replacing it. → docs/archive/storage-and-sync.md#cloud-status-map
 */
async function readRemoteArchive(token: string, name: string): Promise<ArchiveRead> {
  try {
    const res = await fetch(contentUrl(name), { headers: { Authorization: `Bearer ${token}` } })
    const kind = mapGraphReadStatus(res.status)
    if (kind === 'absent') return { status: 'absent' } // no remote yet → a first upload is safe
    if (kind === 'error') return { status: 'error', reason: `Graph GET ${res.status}` }
    const text = await res.text()
    // An EMPTY BODY is an established emptiness (a desktop-client placeholder, or an upload that
    // never landed) — nothing to lose. As a parse ERROR it would refuse every sync forever, since
    // the merge gate only closes on a write.
    if (!text.trim()) return { status: 'absent' }
    // ⚠ A body that PARSED is not a body we UNDERSTOOD — `parseTraceFile` is JSON.parse plus a marker
    // slice, so any valid JSON used to arrive here as an emptiness we never established.
    const snapshots = archiveSnapshotsOf(await parseTraceOffThread(text))
    if (!snapshots) return { status: 'error', reason: 'the remote file is not an Inkwave record' }
    return { status: 'ok', snapshots }
  } catch (e) {
    return { status: 'error', reason: `archive read: ${(e as Error)?.message ?? String(e)}` }
  }
}

export async function syncToOneDrive(doc: InkwaveDocument, snapshots: Snapshot[]): Promise<SyncResult> {
  if (!CLIENT_ID) return { ok: false, webUrl: null }
  const token = await getSilentToken()
  if (!token) return { ok: false, webUrl: null }
  // The .studio stays LEAN (no PDF bytes) so text edits don't re-upload megabytes; cited PDFs go as
  // sidecars beside it, uploaded once.
  const studioName = oneDriveFilename(doc.id) ?? bundleFilename(doc)
  // GROW-ONLY: union the remote's snapshots in before overwriting, so a short local set cannot
  // truncate history — but only ONCE per session (a per-sync GET+parse of a big file adds lag).
  //
  // ⚠ THE READ MUST BE ABLE TO FAIL. As `if (res.ok) { merge }` inside a `catch { /* no remote */ }`,
  // a 500, a throttle, an expired token or a corrupt body all read as "there is nothing there" and
  // the PUT replaced the remote archive with the local set — in the live sync of Peter's thesis.
  // `planWriteback` is the guard; only 404 means absent.
  // → docs/archive/storage-and-sync.md#cloud-sync-guard
  let merged = snapshots
  const key = `onedrive:${doc.id}`
  if (needsWritebackMerge(key)) {
    const plan = planWriteback(await readRemoteArchive(token, studioName), snapshots)
    if (!plan.write) {
      // A refusal is the correct, boring outcome: nothing synced, nothing lost, and the throttled
      // sync retries (the gate stays OPEN because we never established what the remote holds).
      console.info(`[inkwave] OneDrive sync skipped: ${plan.reason}`)
      return { ok: false, webUrl: null }
    }
    merged = plan.snapshots
    markWritebackMerged(key)
  }
  const bundle = buildExportBundle(doc, merged)
  try {
    // { expect: 'any' } — the .studio keeps its PRE-EXISTING posture, STATED rather than defaulted.
    // Its cross-device race is mitigated by the heartbeat + the once-per-session merge above, and
    // pinning it is a separate change with its own proof. Finding E is scoped to the LEDGER.
    const webUrl = await putFile(token, studioName, composeTraceFile(bundle), { expect: 'any' })
    recordOneDriveWrite(doc.id) // heartbeat baseline: metadata newer than this = another device
    setDocSource(doc.id, 'onedrive')
    void uploadPdfSidecars(token, doc.id, studioName, bundle.bibliography ?? []) // fire-and-forget
    // ⚠ CATCH THIS, never bare-`void` it: `restoreSnapshotsFromBundle` READS the local archive and
    // that read THROWS on a fault, so an unhandled rejection would surface as an uncaught browser
    // error at the exact moment storage is already misbehaving. The heal is best-effort — the remote
    // already has the union — so the failure is LOGGED.
    if (merged.length > snapshots.length) {
      void restoreSnapshotsFromBundle(doc.id, merged)
        .catch((err) => console.warn('[inkwave] snapshot heal after sync failed (the remote has the union):', err))
    }
    return { ok: true, webUrl }
  } catch {
    return { ok: false, webUrl: null }
  }
}

// ── PDF sidecars ──────────────────────────────────────────────────────────────
// Stored beside the .studio as "<base>.<citekey>.pdf", uploaded once and tracked per-doc by pdfName —
// annotations live as JSON in the .studio, not in the PDF, so marking one up triggers no re-upload.
// → docs/archive/storage-and-sync.md#cloud-sidecars
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

/** Fetch ONE missing sidecar on demand. It exists because `savePdf` threw on WebKit until the OPFS
 *  write shim, so a doc's sidecar pass could "complete" with nothing stored — this and the quiet-pass
 *  refetch heal that. → docs/archive/storage-and-sync.md#cloud-sidecars */
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
