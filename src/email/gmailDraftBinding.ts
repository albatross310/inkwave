// Local-only Gmail draft identity. Kept outside InkwaveDocument so account linkage and provider
// IDs never travel in a .studio file or enter provenance hashes.

import { hashCanonical } from '../provenance/hash'
import { readAppJsonStrict, writeAppJsonStrict } from '../storage/opfs'
import type { MailboxDraftRef } from './mailbox'

export interface GmailDraftBinding extends MailboxDraftRef<'gmail'> {
  v: 1
  documentId: string
  accountHash: string
  historyId: string
  lastSyncedHash: string
  syncedAt: string
}

function pathFor(documentId: string): string {
  return `mailbox/gmail/drafts/${encodeURIComponent(documentId)}.json`
}

function isBinding(value: unknown, documentId: string): value is GmailDraftBinding {
  const row = value as Partial<GmailDraftBinding> | null
  return !!row && row.v === 1 && row.provider === 'gmail' && row.documentId === documentId
    && typeof row.draftId === 'string' && typeof row.messageId === 'string'
    && typeof row.accountHash === 'string' && typeof row.historyId === 'string'
    && typeof row.lastSyncedHash === 'string' && typeof row.syncedAt === 'string'
}

export function gmailAccountHash(accountEmail: string): Promise<string> {
  return hashCanonical({ provider: 'gmail', account: accountEmail.trim().toLowerCase() })
}

export async function readGmailDraftBinding(documentId: string): Promise<GmailDraftBinding | null> {
  const value = await readAppJsonStrict<unknown>(pathFor(documentId))
  if (value === null) return null
  if (!isBinding(value, documentId)) throw new Error('The local Gmail draft binding has an unrecognised shape')
  return value
}

export function writeGmailDraftBinding(binding: GmailDraftBinding): Promise<void> {
  return writeAppJsonStrict(pathFor(binding.documentId), binding)
}

/** A null tombstone removes the logical binding without needing a second OPFS deletion primitive. */
export function clearGmailDraftBinding(documentId: string): Promise<void> {
  return writeAppJsonStrict(pathFor(documentId), null)
}
