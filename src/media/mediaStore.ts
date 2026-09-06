// Device-scoped storage for imported media, in OPFS at library/media/<id>.<ext>.
//
// THIS IS NOT A SECOND BINARY-ASSET STORE — read before adding one. `citations/pdfStore.ts` already
// solved every hard part of this problem and each solution is load-bearing:
//   · `writeOpfsFile` — WebKit has NO createWritable; iOS takes a worker sync-access fallback, and
//     savePdf THREW on iOS until that shim existed.
//   · `blobToBase64` / `base64ToBlob` — native FileReader/fetch data-URL, because the hand-rolled
//     btoa + per-char loop was a 20MB main-thread stall on every save and every open.
// So this module IMPORTS those rather than copying them. A copy would not merely duplicate code —
// it would re-acquire both bugs on the one platform Peter tests on, and the copies would drift the
// first time either is fixed. What differs here is only the KEY SPACE (an asset id, not a citekey)
// and the extension. That is a directory, not an architecture.

import { writeOpfsFile } from '../storage/opfsWrite'
import { blobToBase64, base64ToBlob } from '../citations/pdfStore'
import type { MediaAsset, MediaKind } from './types'

const DIR = 'library'
const SUB = 'media'

export { blobToBase64, base64ToBlob }

/** ids are ours (uuid), but encode anyway — the same defence pdfStore takes for citekeys. */
const fileName = (asset: Pick<MediaAsset, 'id' | 'mime'>) =>
  `${encodeURIComponent(asset.id)}${extFor(asset.mime)}`

/** The extension is cosmetic — `mime` on the asset is the authority when reading back. */
export function extFor(mime: string): string {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return '.' + (m.split('/')[1]?.split(';')[0] || 'img')
  if (m.startsWith('audio/')) return '.' + (m.split('/')[1]?.split(';')[0] || 'aud')
  if (m.startsWith('video/')) return '.' + (m.split('/')[1]?.split(';')[0] || 'vid')
  return '.bin'
}

/**
 * Peter's three kinds, from the MIME type.
 *
 * Returns null for anything else, and the caller REFUSES rather than guessing. An unknown type
 * stored as a 'photo' is a file the writer can never open again — and "it imported fine" is the
 * worst way to find that out.
 */
export function kindOf(mime: string): MediaKind | null {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'photo'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return null
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle(DIR, { create })
    return await lib.getDirectoryHandle(SUB, { create })
  } catch {
    return null
  }
}

/** Store (or replace) the bytes for an asset. Throws if OPFS is unavailable — never silently. */
export async function saveMedia(asset: MediaAsset, file: Blob): Promise<void> {
  await saveMediaBytes(asset, new Uint8Array(await file.arrayBuffer()))
}

async function saveMediaBytes(asset: MediaAsset, bytes: Uint8Array): Promise<void> {
  const dir = await mediaDir(true)
  if (!dir) throw new Error('Storage unavailable — cannot import media on this device.')
  await writeOpfsFile([DIR, SUB, fileName(asset)], bytes)
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Read the stored bytes, or null if none. */
export async function loadMedia(asset: Pick<MediaAsset, 'id' | 'mime'>): Promise<Blob | null> {
  const dir = await mediaDir(false)
  if (!dir) return null
  try {
    const f = await (await dir.getFileHandle(fileName(asset))).getFile()
    // Re-attach the recorded mime: OPFS hands back a File typed by EXTENSION, and a <video> with
    // the wrong type refuses to decode. The asset's `mime` is the authority, not the filename.
    return f.slice(0, f.size, asset.mime)
  } catch {
    return null
  }
}

/** Remove an asset's bytes (no-op if absent). */
export async function deleteMedia(asset: Pick<MediaAsset, 'id' | 'mime'>): Promise<void> {
  const dir = await mediaDir(false)
  if (!dir) return
  try { await dir.removeEntry(fileName(asset)) } catch { /* already gone */ }
}

/** How big is too big. Peter asked what audio/video costs; this is the honest first answer. */
export const MEDIA_LIMIT_BYTES = 50 * 1024 * 1024

export type ImportResult =
  | { ok: true; asset: MediaAsset }
  | { ok: false; reason: string }

/**
 * THE ONE IMPORTER. Peter's two paths must converge here — media import → music bar → "turn this
 * photo into a piece", OR music panel → import directly. The second is a CALLER of this, never a
 * parallel road: the music lane gets its file by calling `importMedia`, and has no file input, no
 * OPFS write and no size rule of its own. A second importer is how one path grows a limit, a MIME
 * rule or a failure mode the other does not have.
 *
 * REFUSES rather than truncates (the email lane's rule for over-long drafts, and the same reason):
 * a silently-degraded import is a file the writer believes they have.
 */
export async function importMedia(file: File, id: string, now = new Date()): Promise<ImportResult> {
  const kind = kindOf(file.type)
  if (!kind) return { ok: false, reason: `Inkwave can import photos, audio and video — not ${file.type || 'that file type'}.` }
  if (file.size > MEDIA_LIMIT_BYTES) {
    return { ok: false, reason: `That file is ${mb(file.size)} — the limit is ${mb(MEDIA_LIMIT_BYTES)}.` }
  }
  let bytes: Uint8Array
  let sha256: string
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return { ok: false, reason: 'Could not read that file.' }
  }
  const asset: MediaAsset = {
    id,
    kind,
    mime: file.type,
    name: file.name,
    size: file.size,
    sha256,
    addedAt: now.toISOString(),
  }
  try {
    await saveMediaBytes(asset, bytes)
  } catch (e) {
    // Loud, never silent — the storage rule this repo learned the hard way on 15 July.
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not store that file.' }
  }
  return { ok: true, asset }
}

export function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
