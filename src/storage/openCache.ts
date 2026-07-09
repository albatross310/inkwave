// Cloud open cache — makes re-opening a cloud document near-instant by using loading dead-time.
//
// Three layers, all best-effort and ALWAYS silent (background warming must never surface an error
// or, above all, trigger any auth UI — getSilentToken/getDriveToken(false)/preloadGis are the only
// token paths used here and none of them ever prompt):
//
//  1. CONTENT CACHE (the big win): downloaded .studio bytes live in OPFS at opencache/<key>, with
//     a small JSON index (change-tag + size + lastUsed). On open, if the picker listing's
//     change-tag (Graph cTag / Drive md5Checksum) matches the cached entry, the download is
//     skipped entirely — parse straight from OPFS. Tag mismatch → download + refill. Download
//     failure with cached bytes present → open the stale copy (airplane mode still works).
//     Evicted LRU beyond ~100 MB.
//
//  2. LISTING CACHE: the OneDrive/Drive openers' folder listings, keyed per folder, persisted to
//     OPFS so the picker paints instantly (and still works offline) while a fresh listing loads
//     behind it. TTL only gates the idle warm pass — the picker always refreshes in background.
//
//  3. WARM PASS (warmCloudOpen): at idle after load, warm the silent tokens (MSAL chunk + GIS
//     script), prefetch the root + sync-folder listings, and background-prefetch the bytes of the
//     1-2 most recently modified .studio files per provider so even the FIRST open is warm.

import { oneDriveConfigured, getSilentToken, getChosenFolder, listFolders, listOneDriveFiles, downloadOneDriveFile, type OneDriveFileEntry, type DriveFolder } from './onedrive'
import { googleDriveConfigured, preloadGis, listGoogleDriveFolders, listGoogleDriveFiles, downloadGoogleDriveFileBlob, type GDriveFileEntry, peekDriveToken } from './gdrive'
import { readAppJson, writeAppJson } from './opfs'
import { writeOpfsFile } from './opfsWrite'

export type OpenCacheProvider = 'onedrive' | 'gdrive'

const CACHE_DIR = 'opencache'
const INDEX_PATH = `${CACHE_DIR}/index.json`
const LISTINGS_PATH = `${CACHE_DIR}/listings.json`
const MAX_CACHE_BYTES = 100 * 1024 * 1024   // LRU-evict beyond this
const MAX_ENTRY_BYTES = 40 * 1024 * 1024    // one doc may never dominate the cache
const LISTING_TTL_MS = 60_000               // idle-warm refresh gate (pickers always refresh)
const PREFETCH_MAX_FILES = 2
const PREFETCH_MAX_ENTRY_BYTES = 25 * 1024 * 1024

// ─── Content cache (OPFS bytes + JSON index) ──────────────────────────────────

interface IndexEntry { tag: string; size: number; lastUsed: number }
type CacheIndex = Record<string, IndexEntry>

let _index: Promise<CacheIndex> | null = null
let _indexWrite: Promise<void> = Promise.resolve()

async function loadIndex(): Promise<CacheIndex> {
  if (!_index) _index = readAppJson<CacheIndex>(INDEX_PATH).then((i) => i ?? {})
  return _index
}

// Serialise index writes so a lastUsed bump can't clobber a concurrent put (and vice versa).
function persistIndex(idx: CacheIndex): void {
  _indexWrite = _indexWrite.then(() => writeAppJson(INDEX_PATH, idx)).catch(() => { /* best-effort */ })
}

// OPFS-safe entry name: sanitise the raw item id + append a short hash of it, so two ids that
// sanitise identically can't collide.
function keyOf(provider: OpenCacheProvider, itemId: string): string {
  let h = 5381
  for (let i = 0; i < itemId.length; i++) h = ((h << 5) + h + itemId.charCodeAt(i)) >>> 0
  return `${provider}-${itemId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)}-${h.toString(36)}`
}

async function cacheDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(CACHE_DIR, { create })
  } catch { return null }
}

/** The cached bytes + change-tag for a cloud item, or null. Bumps lastUsed (LRU). */
export async function getCachedOpen(provider: OpenCacheProvider, itemId: string): Promise<{ blob: Blob; tag: string } | null> {
  try {
    const idx = await loadIndex()
    const key = keyOf(provider, itemId)
    const entry = idx[key]
    if (!entry) return null
    const dir = await cacheDir(false)
    if (!dir) return null
    const blob = await (await dir.getFileHandle(key)).getFile()
    entry.lastUsed = Date.now()
    persistIndex(idx)
    return { blob, tag: entry.tag }
  } catch { return null }
}

/** Index-only peek (no byte read, no LRU bump) — the prefetcher's "already warm?" check. */
export async function peekCachedTag(provider: OpenCacheProvider, itemId: string): Promise<string | null> {
  try { return (await loadIndex())[keyOf(provider, itemId)]?.tag ?? null } catch { return null }
}

/** Store downloaded bytes under the item's change-tag, then LRU-evict beyond the size budget. */
export async function putCachedOpen(provider: OpenCacheProvider, itemId: string, tag: string, blob: Blob): Promise<void> {
  try {
    if (!blob.size || blob.size > MAX_ENTRY_BYTES) return
    const idx = await loadIndex()
    const key = keyOf(provider, itemId)
    await writeOpfsFile([CACHE_DIR, key], new Uint8Array(await blob.arrayBuffer())) // iOS-safe write
    idx[key] = { tag, size: blob.size, lastUsed: Date.now() }
    // Evict least-recently-used entries (never the one just written) until under budget.
    let total = Object.values(idx).reduce((s, e) => s + e.size, 0)
    if (total > MAX_CACHE_BYTES) {
      const dir = await cacheDir(false)
      for (const [k, e] of Object.entries(idx).sort((a, b) => a[1].lastUsed - b[1].lastUsed)) {
        if (total <= MAX_CACHE_BYTES) break
        if (k === key) continue
        try { await dir?.removeEntry(k) } catch { /* already gone */ }
        delete idx[k]
        total -= e.size
      }
    }
    persistIndex(idx)
  } catch { /* cache is best-effort — the open already has its bytes */ }
}

// ─── Listing cache (per-folder picker listings, OPFS-persisted) ───────────────

export interface CachedListing<F, T> { folders: F[]; files: T[] }
interface ListingRecord { at: number; value: unknown }

let _listings: Promise<Record<string, ListingRecord>> | null = null
let _listingsWrite: Promise<void> = Promise.resolve()

async function loadListings(): Promise<Record<string, ListingRecord>> {
  if (!_listings) _listings = readAppJson<Record<string, ListingRecord>>(LISTINGS_PATH).then((l) => l ?? {})
  return _listings
}

/** The listing-cache key for a picker view. parentId null/'' /'root' all mean the root view. */
export function listingKey(provider: 'od' | 'gd', parentId: string | null | undefined): string {
  return `${provider}:${!parentId || parentId === 'root' ? 'root' : parentId}`
}

/** The cached listing for a key (any age — `fresh` says whether it's within the warm-pass TTL). */
export async function getListing<T>(key: string): Promise<{ value: T; fresh: boolean } | null> {
  try {
    const rec = (await loadListings())[key]
    if (!rec) return null
    return { value: rec.value as T, fresh: Date.now() - rec.at < LISTING_TTL_MS }
  } catch { return null }
}

/** Store a listing (memory + OPFS, fire-and-forget persist). */
export function putListing(key: string, value: unknown): void {
  void loadListings().then((all) => {
    all[key] = { at: Date.now(), value }
    _listingsWrite = _listingsWrite.then(() => writeAppJson(LISTINGS_PATH, all)).catch(() => { /* best-effort */ })
  }).catch(() => { /* best-effort */ })
}

// ─── Idle warm pass ────────────────────────────────────────────────────────────

const STUDIO_RE = /\.(studio|studio\.gz|inkwave)$/i

interface PrefetchCandidate { id: string; name: string; tag?: string; size?: number; modifiedAt?: number }

async function prefetchRecentBytes(
  provider: OpenCacheProvider,
  entries: PrefetchCandidate[],
  download: (id: string) => Promise<Blob | null>,
): Promise<void> {
  const candidates = entries
    .filter((e) => STUDIO_RE.test(e.name) && e.tag && (e.size ?? 0) <= PREFETCH_MAX_ENTRY_BYTES)
    .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
    .slice(0, PREFETCH_MAX_FILES)
  for (const e of candidates) {
    if ((await peekCachedTag(provider, e.id)) === e.tag) continue // already warm at this version
    const blob = await download(e.id).catch(() => null)
    if (blob) await putCachedOpen(provider, e.id, e.tag!, blob)
  }
}

async function warmOneDrive(): Promise<void> {
  if (!oneDriveConfigured()) return
  const token = await getSilentToken().catch(() => null) // warms the MSAL chunk + token cache; NEVER prompts
  if (!token) return
  // Warm the opener's landing view (root), and the chosen sync folder — where the docs live.
  const rootKey = listingKey('od', null)
  let rootFiles: OneDriveFileEntry[] = []
  if (!(await getListing(rootKey))?.fresh) {
    const [folders, files] = await Promise.all([listFolders(null), listOneDriveFiles(null)])
    putListing(rootKey, { folders, files } satisfies CachedListing<DriveFolder, OneDriveFileEntry>)
    rootFiles = files
  } else {
    rootFiles = ((await getListing<CachedListing<DriveFolder, OneDriveFileEntry>>(rootKey))?.value.files) ?? []
  }
  let candidates = rootFiles
  const chosen = getChosenFolder()
  if (chosen?.id) {
    const chosenKey = listingKey('od', chosen.id)
    const cached = await getListing<CachedListing<DriveFolder, OneDriveFileEntry>>(chosenKey)
    if (cached?.fresh) {
      candidates = cached.value.files
    } else {
      const [folders, files] = await Promise.all([listFolders(chosen.id), listOneDriveFiles(chosen.id)])
      putListing(chosenKey, { folders, files })
      candidates = files
    }
  }
  await prefetchRecentBytes('onedrive', candidates, downloadOneDriveFile)
}

async function warmGDrive(): Promise<void> {
  if (!googleDriveConfigured()) return
  preloadGis() // GIS script + token client off any click path
  const token = peekDriveToken() // peek only — getDriveToken(false) opens a GIS popup window on load (Firefox blocks + warns)
  if (!token) return
  const rootKey = listingKey('gd', 'root')
  if (!(await getListing(rootKey))?.fresh) {
    const [folders, files] = await Promise.all([listGoogleDriveFolders('root'), listGoogleDriveFiles('root')])
    putListing(rootKey, { folders, files } satisfies CachedListing<{ id: string; name: string }, GDriveFileEntry>)
  }
  // drive.file listing without a parent = every app-visible file, already modifiedTime-desc.
  const all = await listGoogleDriveFiles()
  await prefetchRecentBytes('gdrive', all, downloadGoogleDriveFileBlob)
}

let _lastWarm = 0

/** Warm everything the open path will need, silently, at idle. Re-arms after the listing TTL so a
 *  doc-switch remount doesn't hammer the APIs. Never throws; never shows auth UI. */
export function warmCloudOpen(): void {
  if (typeof window === 'undefined') return
  if (Date.now() - _lastWarm < LISTING_TTL_MS) return
  _lastWarm = Date.now()
  void warmOneDrive().catch(() => { /* silent */ })
  void warmGDrive().catch(() => { /* silent */ })
}
