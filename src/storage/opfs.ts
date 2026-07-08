import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { writeOpfsFile } from './opfsWrite'

// ─── Path helpers ─────────────────────────────────────────────────────────────

function docDir(documentId: string) {
  return `documents/${documentId}`
}

function currentPath(documentId: string) {
  return `${docDir(documentId)}/current.json`
}

// ─── Low-level OPFS helpers ───────────────────────────────────────────────────

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/')
  let handle: FileSystemDirectoryHandle = root
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part, { create: true })
  }
  return handle
}

async function writeJson(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<(data: unknown) => Promise<void>> {
  const parts = filePath.split('/')
  const fileName = parts.pop()!
  const dirPath = parts.join('/')
  if (dirPath) await ensureDir(root, dirPath) // keep dir creation semantics for callers
  return async (data: unknown) => {
    // iOS-safe write (no createWritable on WebKit — worker sync-access fallback).
    await writeOpfsFile([...(dirPath ? dirPath.split('/') : []), fileName], JSON.stringify(data))
  }
}

async function readJson<T>(
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<T | null> {
  try {
    const parts = filePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')
    let dir: FileSystemDirectoryHandle = root
    for (const part of dirPath.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part)
    }
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read a small app-level JSON file from the OPFS root (e.g. recent-folder choices). */
export async function readAppJson<T>(name: string): Promise<T | null> {
  return readJson<T>(await getRoot(), name)
}

/** Write a small app-level JSON file to the OPFS root. */
export async function writeAppJson(name: string, data: unknown): Promise<void> {
  const write = await writeJson(await getRoot(), name)
  await write(data)
}

/** Save the full document to OPFS. */
export async function saveDocument(doc: InkwaveDocument): Promise<void> {
  const root = await getRoot()
  const write = await writeJson(root, currentPath(doc.id))
  await write(doc)
}

/** Load a document from OPFS. Returns null if it doesn't exist. */
export async function loadDocument(
  documentId: string,
): Promise<InkwaveDocument | null> {
  const root = await getRoot()
  return readJson<InkwaveDocument>(root, currentPath(documentId))
}

/** List all document IDs stored in OPFS. */
export async function listDocumentIds(): Promise<string[]> {
  try {
    const root = await getRoot()
    const docsDir = await root.getDirectoryHandle('documents')
    const ids: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const name of (docsDir as any).keys()) {
      ids.push(name)
    }
    return ids
  } catch {
    return []
  }
}

// ─── Debounced autosave ───────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null
const AUTOSAVE_DELAY_MS = 200

export function scheduleSave(
  doc: InkwaveDocument | (() => InkwaveDocument),
  onSaved?: () => void,
): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    // A thunk defers building the document snapshot to SAVE time (200ms after the last edit) —
    // the editor passes one so serialization never runs per keystroke (see ensureDocFresh).
    await saveDocument(typeof doc === 'function' ? doc() : doc)
    onSaved?.()
  }, AUTOSAVE_DELAY_MS)
}

// (The Week-3 appendEventLog stub that lived here was deleted 2026-07-08: zero callers, and its
// read-whole-file-per-append pattern was an O(n²) trap. The provenance record is snapshots +
// signed receipts; if a per-event log is ever needed, design it append-friendly from the start.)

// ─── Helper: default empty TiptapJSON document ────────────────────────────────

export function emptyTiptapDoc(): TiptapJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}
