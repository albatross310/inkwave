// Local email-attachment bytes. A document carries only these small references; the bytes stay in
// OPFS until an explicit Gmail draft/send action hydrates them into a MIME message.

import { v4 as uuidv4 } from 'uuid'
import { isNotFound } from '../storage/notFound'
import { writeOpfsFile } from '../storage/opfsWrite'

const DIR = 'library'
const SUB = 'email-attachments'

// Gmail's wire representation base64-expands attachments. Keep the local total comfortably below
// provider request ceilings instead of accepting a file and having Gmail reject it only at Send.
export const EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES = 18 * 1024 * 1024

export interface EmailAttachmentRef {
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
  addedAt: string
}

export type EmailAttachmentImportResult =
  | { ok: true; attachment: EmailAttachmentRef }
  | { ok: false; reason: string }

function attachmentPath(id: string): string[] {
  return [DIR, SUB, encodeURIComponent(id)]
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function importEmailAttachment(
  file: File,
  existingBytes: number,
  now = new Date(),
): Promise<EmailAttachmentImportResult> {
  if (existingBytes + file.size > EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES) {
    return {
      ok: false,
      reason: `Email attachments are limited to ${formatAttachmentBytes(EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES)} in total so Gmail can carry the encoded message.`,
    }
  }

  let bytes: Uint8Array
  try { bytes = new Uint8Array(await file.arrayBuffer()) }
  catch { return { ok: false, reason: `Could not read “${file.name || 'that file'}”.` } }

  const attachment: EmailAttachmentRef = {
    id: uuidv4(),
    name: file.name.trim() || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    size: bytes.byteLength,
    sha256: await sha256(bytes),
    addedAt: now.toISOString(),
  }
  try {
    await writeOpfsFile(attachmentPath(attachment.id), bytes)
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : 'Could not store that attachment on this device.',
    }
  }
  return { ok: true, attachment }
}

/** Null means genuinely absent; a failed storage read throws and must never be treated as empty. */
export async function loadEmailAttachmentBytes(attachment: EmailAttachmentRef): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const library = await root.getDirectoryHandle(DIR)
    const dir = await library.getDirectoryHandle(SUB)
    const file = await (await dir.getFileHandle(encodeURIComponent(attachment.id))).getFile()
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength !== attachment.size) {
      throw new Error(`“${attachment.name}” no longer matches its recorded size.`)
    }
    if (await sha256(bytes) !== attachment.sha256) {
      throw new Error(`“${attachment.name}” no longer matches its recorded bytes.`)
    }
    return bytes
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw cause
  }
}
