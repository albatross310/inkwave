// An in-memory OPFS for tests (node has none), so a test can drive the REAL snapshot store —
// createSnapshotIfChanged, the gzip archive, listSnapshots — instead of a hand-built imitation of
// what those functions are believed to do. Hand-building the record under test is precisely how a
// suite comes to verify a fiction.
//
// It implements only what snapshots.ts + opfsWrite.ts actually touch:
//   navigator.storage.getDirectory() → getDirectoryHandle / getFileHandle → createWritable / getFile
// and the `FileSystemFileHandle.prototype.createWritable` presence check opfsWrite.ts gates on.
//
// TEST-ONLY. Not imported by any production module.

interface Node { files: Map<string, Uint8Array>; dirs: Map<string, Node> }

let root: Node = { files: new Map(), dirs: new Map() }

export function resetOpfsShim(): void {
  root = { files: new Map(), dirs: new Map() }
}

function makeFileHandle(dir: Node, name: string) {
  return {
    async createWritable() {
      const chunks: Uint8Array[] = []
      return {
        async write(data: Uint8Array | ArrayBuffer) {
          chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data))
        },
        async close() {
          const total = chunks.reduce((n, c) => n + c.byteLength, 0)
          const out = new Uint8Array(total)
          let off = 0
          for (const c of chunks) { out.set(c, off); off += c.byteLength }
          dir.files.set(name, out)
        },
      }
    },
    async getFile() {
      const bytes = dir.files.get(name)
      if (!bytes) throw new Error('NotFoundError')
      return {
        async arrayBuffer() {
          // A fresh copy with its OWN buffer — a Uint8Array view's .buffer can be larger than the
          // view, which would hand back trailing bytes and corrupt the gzip read.
          return bytes.slice().buffer
        },
        get lastModified() { return 0 },
        get size() { return bytes.byteLength },
      }
    },
  }
}

function makeDirHandle(node: Node) {
  return {
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      let child = node.dirs.get(name)
      if (!child) {
        if (!opts?.create) throw new Error('NotFoundError')
        child = { files: new Map(), dirs: new Map() }
        node.dirs.set(name, child)
      }
      return makeDirHandle(child)
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!node.files.has(name)) {
        if (!opts?.create) throw new Error('NotFoundError')
        node.files.set(name, new Uint8Array(0))
      }
      return makeFileHandle(node, name)
    },
    async removeEntry(name: string) {
      node.files.delete(name)
      node.dirs.delete(name)
    },
  }
}

export function installOpfsShim(): void {
  // opfsWrite.ts gates on `'createWritable' in FileSystemFileHandle.prototype` — without this it
  // routes writes to the parse worker, which does not exist in node, and every write silently
  // becomes a no-op that the test would read as "nothing was saved".
  if (typeof (globalThis as { FileSystemFileHandle?: unknown }).FileSystemFileHandle === 'undefined') {
    class FileSystemFileHandle { async createWritable() { /* presence only */ } }
    ;(globalThis as unknown as Record<string, unknown>).FileSystemFileHandle = FileSystemFileHandle
  }
  const storage = { getDirectory: async () => makeDirHandle(root) }
  const nav = (globalThis as unknown as { navigator?: object }).navigator
  if (nav) Object.defineProperty(nav, 'storage', { value: storage, configurable: true })
  else (globalThis as unknown as Record<string, unknown>).navigator = { storage }
}
