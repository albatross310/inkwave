// A reload-persistent OPFS shim for Playwright WebKit, whose Linux port exposes
// navigator.storage.getDirectory but rejects the actual root. Real Safari/PWA is tested manually;
// this keeps production navigation/storage wiring reachable in the automated WebKit engine.

export async function installOpfsBrowserShim(context) {
  await context.addInitScript(() => {
    const DIR = '__iw_webkit_opfs_dir:'
    const FILE = '__iw_webkit_opfs_file:'
    const pathOf = (parts) => parts.join('/')
    const dirKey = (parts) => DIR + pathOf(parts)
    const fileKey = (parts) => FILE + pathOf(parts)
    const notFound = () => new DOMException('A requested file or directory could not be found.', 'NotFoundError')
    const bytesOf = (value) => value instanceof Uint8Array ? value : new Uint8Array(value)

    const makeFileHandle = (parts) => ({
      async createWritable() {
        const chunks = []
        return {
          async write(value) { chunks.push(bytesOf(value)) },
          async close() {
            const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
            const bytes = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
            sessionStorage.setItem(fileKey(parts), JSON.stringify(Array.from(bytes)))
          },
        }
      },
      async getFile() {
        const raw = sessionStorage.getItem(fileKey(parts))
        if (raw === null) throw notFound()
        const bytes = new Uint8Array(JSON.parse(raw))
        return {
          size: bytes.byteLength,
          lastModified: 0,
          async text() { return new TextDecoder().decode(bytes) },
          async arrayBuffer() { return bytes.slice().buffer },
        }
      },
    })

    const childNames = (parts) => {
      const path = pathOf(parts)
      const prefix = path ? `${path}/` : ''
      const names = new Map()
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index) || ''
        const kind = key.startsWith(DIR) ? 'directory' : key.startsWith(FILE) ? 'file' : null
        if (!kind) continue
        const rest = key.slice(kind === 'directory' ? DIR.length : FILE.length)
        if (!rest.startsWith(prefix)) continue
        const tail = rest.slice(prefix.length)
        const name = tail.split('/')[0]
        if (name) names.set(name, tail.includes('/') ? 'directory' : kind)
      }
      return names
    }

    const makeDirHandle = (parts) => ({
      async getDirectoryHandle(name, opts = {}) {
        const child = [...parts, name]
        if (sessionStorage.getItem(dirKey(child)) === null) {
          if (!opts.create) throw notFound()
          sessionStorage.setItem(dirKey(child), '1')
        }
        return makeDirHandle(child)
      },
      async getFileHandle(name, opts = {}) {
        const child = [...parts, name]
        if (sessionStorage.getItem(fileKey(child)) === null) {
          if (!opts.create) throw notFound()
          sessionStorage.setItem(fileKey(child), '[]')
        }
        return makeFileHandle(child)
      },
      async removeEntry(name) {
        const child = pathOf([...parts, name])
        const prefixes = [DIR + child, FILE + child]
        const remove = []
        for (let index = 0; index < sessionStorage.length; index++) {
          const key = sessionStorage.key(index) || ''
          if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}/`))) remove.push(key)
        }
        remove.forEach((key) => sessionStorage.removeItem(key))
      },
      async *keys() { for (const name of childNames(parts).keys()) yield name },
      async *entries() { for (const [name, kind] of childNames(parts)) yield [name, { kind }] },
      async *values() { for (const kind of childNames(parts).values()) yield { kind } },
    })

    class ShimFileSystemFileHandle { async createWritable() {} }
    Object.defineProperty(window, 'FileSystemFileHandle', { value: ShimFileSystemFileHandle, configurable: true })
    const storage = { getDirectory: async () => makeDirHandle([]), persist: async () => true }
    try { Object.defineProperty(navigator, 'storage', { value: storage, configurable: true }) }
    catch { Object.defineProperty(navigator.storage, 'getDirectory', { value: storage.getDirectory, configurable: true }) }
  })
}

