// Channel A — BBT auto-exported .bib file via File System Access API.
//
// FSA has no push notifications so we poll lastModified on:
//   • window focus
//   • a 10s interval while the BibPanel is open
//   • an explicit "Refresh" button call
//
// The handle is persisted in IndexedDB so the user only picks once per browser profile.

import { parseBibtex } from './parse'
import { bibProvider } from './bibProvider'

const IDB_DB = 'inkwave-bib'
const IDB_STORE = 'handles'
const IDB_KEY = 'bib-file'

// ── IndexedDB handle persistence ──────────────────────────────────────────────

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

let handle: FileSystemFileHandle | null = null
let lastModified = 0

// ── Core ops ──────────────────────────────────────────────────────────────────

export function fileChannelAvailable(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

export async function pickBibFile(): Promise<boolean> {
  if (!fileChannelAvailable()) return false
  try {
    const [picked] = await (window as typeof window & {
      showOpenFilePicker(opts: unknown): Promise<FileSystemFileHandle[]>
    }).showOpenFilePicker({
      types: [{ description: 'BibTeX file', accept: { 'text/plain': ['.bib'] } }],
      multiple: false,
    })
    handle = picked
    await saveHandle(picked)
    await readAndRefresh()
    return true
  } catch (e: unknown) {
    // User cancelled or permission denied
    if ((e as { name?: string })?.name !== 'AbortError') console.warn('[bib/fileChannel] pick error', e)
    return false
  }
}

type FSHandleWithPerm = FileSystemFileHandle & {
  queryPermission(opts: { mode: string }): Promise<PermissionState>
  requestPermission(opts: { mode: string }): Promise<PermissionState>
}

export async function loadPersistedHandle(): Promise<void> {
  if (!fileChannelAvailable()) return
  try {
    const saved = await loadHandle()
    if (!saved) return
    const h = saved as FSHandleWithPerm
    const perm = await h.queryPermission({ mode: 'read' })
    if (perm === 'granted') {
      handle = saved
      await readAndRefresh()
    } else if (perm === 'prompt') {
      handle = saved
    }
  } catch (e) {
    console.warn('[bib/fileChannel] loadPersistedHandle error', e)
  }
}

export async function requestPermissionIfNeeded(): Promise<boolean> {
  if (!handle) return false
  try {
    const h = handle as FSHandleWithPerm
    const perm = await h.requestPermission({ mode: 'read' })
    if (perm === 'granted') { await readAndRefresh(); return true }
    return false
  } catch {
    return false
  }
}

export function hasBibFile(): boolean { return handle !== null }
export function getBibHandle(): FileSystemFileHandle | null { return handle }

async function readAndRefresh(): Promise<void> {
  if (!handle) return
  try {
    const file = await handle.getFile()
    if (file.lastModified === lastModified) return // unchanged
    lastModified = file.lastModified
    const text = await file.text()
    const items = await parseBibtex(text)
    bibProvider.setEntries(items, 'file')
    bibProvider.setRefreshFn(readAndRefresh)
  } catch (e) {
    console.warn('[bib/fileChannel] read error', e)
  }
}

export async function pollIfChanged(): Promise<void> { await readAndRefresh() }

// ── Focus / interval polling ───────────────────────────────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null

export function startPolling(): void {
  if (pollingInterval) return
  pollingInterval = setInterval(() => { pollIfChanged().catch(() => {}) }, 10_000)
}

export function stopPolling(): void {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { pollIfChanged().catch(() => {}) }, { passive: true })
}
