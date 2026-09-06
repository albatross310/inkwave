// Where each document was last synced/saved — so "Open recent" can show its origin (Google Drive /
// OneDrive / this computer). Written on every successful sync/save; read by the recent list.
export type DocSource = 'gdrive' | 'onedrive' | 'local'
export type RecognisedSaveDestination = DocSource | 'download'

export interface RecognisedSave {
  at: number
  destination: RecognisedSaveDestination
}

export const RECOGNISED_SAVE_LIVE_MS = 20_000

const key = (docId: string) => `inkwave:doc-source:${docId}`
const savedKey = (docId: string) => `inkwave:recognised-save:${docId}`
const dirtyKey = (docId: string) => `inkwave:document-dirty:${docId}`

export function getDocSource(docId: string): DocSource | null {
  try { return localStorage.getItem(key(docId)) as DocSource | null } catch { return null }
}
export function setDocSource(docId: string, source: DocSource): void {
  try { localStorage.setItem(key(docId), source) } catch { /* private mode */ }
  markRecognisedSave(docId, source)
}

export function markRecognisedSave(docId: string, destination: RecognisedSaveDestination): void {
  const save: RecognisedSave = { at: Date.now(), destination }
  try { localStorage.setItem(savedKey(docId), JSON.stringify(save)) } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent('inkwave:recognised-save', { detail: { docId, ...save } })) } catch { /* SSR */ }
}

export function getRecognisedSave(docId: string): RecognisedSave | null {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey(docId)) ?? 'null') as RecognisedSave | null
    return value && Number.isFinite(value.at) && typeof value.destination === 'string' ? value : null
  } catch { return null }
}

export function markDocumentDirty(docId: string, at = Date.now()): void {
  try { localStorage.setItem(dirtyKey(docId), String(at)) } catch { /* private mode */ }
}

export function getDocumentDirtyAt(docId: string): number | null {
  try {
    const at = Number(localStorage.getItem(dirtyKey(docId)))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch { return null }
}

export function recognisedSaveIsLive(docId: string, now = Date.now()): boolean {
  const save = getRecognisedSave(docId)
  if (!save) return false
  const dirtyAt = getDocumentDirtyAt(docId)
  // A save does not become false merely because the writer spent 20 seconds reading. It remains
  // current until a later document mutation. Once dirty, allow one sync interval before warning.
  if (dirtyAt === null || save.at >= dirtyAt) return true
  return now - dirtyAt <= RECOGNISED_SAVE_LIVE_MS
}

export function forgetDocSource(docId: string): void {
  try {
    localStorage.removeItem(key(docId))
    localStorage.removeItem(savedKey(docId))
    localStorage.removeItem(dirtyKey(docId))
  } catch { /* private mode */ }
}
