import type { DocumentMeta } from '../types/document'

// ─── Config ───────────────────────────────────────────────────────────────────

const DB_NAME = 'inkwave'
const DB_VERSION = 1
const STORE = 'documents'

// ─── Open DB ──────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Upsert a lightweight metadata row (does not store content). */
export async function upsertMeta(meta: DocumentMeta): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(meta)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Get metadata for a single document. */
export async function getMeta(id: string): Promise<DocumentMeta | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as DocumentMeta) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** List all document metadata rows, most-recently-updated first. */
export async function listMeta(): Promise<DocumentMeta[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .index('updatedAt')
      .getAll()
    req.onsuccess = () => {
      const rows = req.result as DocumentMeta[]
      resolve(rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }
    req.onerror = () => reject(req.error)
  })
}

/** Delete a metadata row (e.g. when a document is deleted). */
export async function deleteMeta(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
