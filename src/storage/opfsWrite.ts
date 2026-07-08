// OPFS writes that work EVERYWHERE — including iOS Safari, where FileSystemFileHandle has NO
// createWritable(): WebKit only allows OPFS writes via createSyncAccessHandle, which is
// worker-only. So: main-thread createWritable when the browser has it (Chromium/Firefox/node
// tests), otherwise the parse worker performs the write with a sync access handle. Without this,
// EVERY OPFS write on iPhone threw "createWritable is not a function" (autosave, snapshot
// restore, PDFs — the whole persistence layer).

import { opfsWriteOffThread } from '../workers/parseClient'

const hasCreateWritable = (() => {
  try {
    return typeof FileSystemFileHandle !== 'undefined'
      && 'createWritable' in FileSystemFileHandle.prototype
  } catch { return false }
})()

/** Write `data` to OPFS at path segments (dirs created as needed), atomically replacing the file. */
export async function writeOpfsFile(path: string[], data: Uint8Array | string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (hasCreateWritable) {
    let dir = await navigator.storage.getDirectory()
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const handle = await dir.getFileHandle(path[path.length - 1], { create: true })
    const w = await handle.createWritable()
    await w.write(bytes)
    await w.close()
    return
  }
  await opfsWriteOffThread(path, bytes)
}
