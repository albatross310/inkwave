// Deliberate attachment handoff. Bytes arrive only after a click; this module decides whether the
// browser can safely display them or should download them for the operating system/user to open.

import type { MailboxAttachmentContent } from './mailbox'

export type MailboxAttachmentPresentation = 'open' | 'download'

export function safeAttachmentFilename(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f/\\:]/g, '_').trim()
  return clean && clean !== '.' && clean !== '..' ? clean.slice(0, 180) : 'attachment'
}

function starts(bytes: Uint8Array, values: readonly number[]): boolean {
  return values.every((value, index) => bytes[index] === value)
}

/** Only formats whose bytes can be cheaply signature-checked are opened in a browser tab. HTML,
 * SVG, office documents and executables always download instead of gaining an app-origin viewer. */
export function attachmentPresentation(mimeType: string, bytes: Uint8Array): MailboxAttachmentPresentation {
  const mime = mimeType.toLowerCase().split(';', 1)[0]!.trim()
  if (mime === 'application/pdf' && starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'open'
  if (mime === 'image/png' && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'open'
  if (mime === 'image/jpeg' && starts(bytes, [0xff, 0xd8, 0xff])) return 'open'
  if (mime === 'image/gif' && (starts(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || starts(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return 'open'
  if (mime === 'image/webp' && starts(bytes, [0x52, 0x49, 0x46, 0x46])
    && starts(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return 'open'
  if (mime === 'text/plain' && !bytes.subarray(0, 4096).includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'open' } catch { /* download */ }
  }
  return 'download'
}

export function presentMailboxAttachment(content: MailboxAttachmentContent): MailboxAttachmentPresentation {
  const mode = attachmentPresentation(content.mimeType, content.bytes)
  const bytes = content.bytes.slice().buffer as ArrayBuffer
  const url = URL.createObjectURL(new Blob([bytes], { type: content.mimeType || 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  if (mode === 'open') anchor.target = '_blank'
  else anchor.download = safeAttachmentFilename(content.filename)
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // A viewer tab may read the object URL after this task; keep it briefly, never persist the bytes.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return mode
}
