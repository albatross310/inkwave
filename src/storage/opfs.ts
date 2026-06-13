import type { InkwaveDocument, TiptapJSON } from '../types/document'

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
  const dir = dirPath ? await ensureDir(root, dirPath) : root
  return async (data: unknown) => {
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(data))
    await writable.close()
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
  doc: InkwaveDocument,
  onSaved?: () => void,
): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await saveDocument(doc)
    onSaved?.()
  }, AUTOSAVE_DELAY_MS)
}

// ─── Append-only event log (provenance, Week 3) ───────────────────────────────

export async function appendEventLog(
  documentId: string,
  line: string,
): Promise<void> {
  try {
    const root = await getRoot()
    await ensureDir(root, docDir(documentId))
    const dir = await root.getDirectoryHandle(docDir(documentId))
    const fileHandle = await dir.getFileHandle('events.jsonl', { create: true })
    // OPFS doesn't support append natively — read + write pattern for now.
    // Week 3 can optimise with a write-stream if needed.
    let existing = ''
    try {
      const file = await fileHandle.getFile()
      existing = await file.text()
    } catch {
      // New file — starts empty.
    }
    const writable = await fileHandle.createWritable()
    await writable.write(existing + line + '\n')
    await writable.close()
  } catch (err) {
    console.warn('[inkwave] appendEventLog failed:', err)
  }
}

// ─── Helper: default empty TiptapJSON document ────────────────────────────────

export function emptyTiptapDoc(): TiptapJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}
