// Where each document was last synced/saved — so "Open recent" can show its origin (Google Drive /
// OneDrive / this computer). Written on every successful sync/save; read by the recent list.
export type DocSource = 'gdrive' | 'onedrive' | 'local'

const key = (docId: string) => `inkwave:doc-source:${docId}`

export function getDocSource(docId: string): DocSource | null {
  try { return localStorage.getItem(key(docId)) as DocSource | null } catch { return null }
}
export function setDocSource(docId: string, source: DocSource): void {
  try { localStorage.setItem(key(docId), source) } catch { /* private mode */ }
}
