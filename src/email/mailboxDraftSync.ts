// Gmail Draft conflict controller (Productivity + Email v0.2, §B3.4). Pure decisions only: the
// caller owns local document creation/preservation and provider I/O.

import { hashCanonical } from '../provenance/hash'
import { normaliseHeaders } from './headers'
import type { MailDraft } from './sender'

export type MailboxDraftSyncDecision =
  | 'in-sync'
  | 'upload-local'
  | 'import-remote'
  | 'preserve-both'

/** One logical draft hash across browser and Gmail line-ending representations. */
export function mailboxDraftHash(draft: MailDraft): Promise<string> {
  const attachments = (draft.attachments ?? []).map(({ filename, mimeType, size }) => ({ filename, mimeType, size }))
  return hashCanonical({
    v: 1,
    headers: normaliseHeaders(draft.headers),
    // Tiptap's plain-text boundary omits meaningless leading/trailing blank space and emits one
    // terminal newline. Treat those wire-format differences as one logical draft so importing a
    // Gmail body does not manufacture an immediate conflict before the writer edits anything.
    body: draft.body.replace(/\r\n|\r|\n/g, '\n').trim(),
    // Keep every already-acknowledged plain-draft hash byte-identical. Attachments extend the
    // shape only when present, so upgrading cannot manufacture a conflict on ordinary drafts.
    ...(attachments.length ? { attachments } : {}),
  })
}

/**
 * Timestamps never decide draft content. Only ancestry against the last acknowledged hash may
 * choose upload or import; two independent changes preserve both for the writer to resolve.
 */
export function classifyMailboxDraftSync(
  lastSyncedHash: string | null,
  localHash: string,
  remoteHash: string,
): MailboxDraftSyncDecision {
  if (localHash === remoteHash) return 'in-sync'
  if (!lastSyncedHash) return 'preserve-both'
  if (remoteHash === lastSyncedHash) return 'upload-local'
  if (localHash === lastSyncedHash) return 'import-remote'
  return 'preserve-both'
}
