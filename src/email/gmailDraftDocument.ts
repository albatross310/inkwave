import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { draftFor } from './draft'
import { gmailAccountHash, type GmailDraftBinding } from './gmailDraftBinding'
import type { MailboxDraft } from './mailbox'
import { mailboxDraftHash } from './mailboxDraftSync'
import { newEmailDocument } from './newEmail'

/** Preserve internal plain-text newlines as hard breaks in one ProseMirror text block. */
export function gmailPlainTextDocument(body: string): TiptapJSON {
  const lines = body.replace(/\r\n|\r/g, '\n').split('\n')
  const content: TiptapJSON[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
  })
  return { type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] }
}

export async function importGmailDraftDocument(input: {
  remote: MailboxDraft<'gmail'>
  accountEmail: string
  historyId: string
}): Promise<{ document: InkwaveDocument; binding: GmailDraftBinding }> {
  if (input.remote.body === null) {
    throw new Error('This Gmail draft has no plain-text body. It remains safe in Gmail and was not imported.')
  }
  const document = {
    ...newEmailDocument(input.remote.headers),
    contentJson: gmailPlainTextDocument(input.remote.body),
  }
  const local = draftFor(document)
  if (!local) throw new Error('Could not construct the local Gmail draft')
  const [accountHash, lastSyncedHash] = await Promise.all([
    gmailAccountHash(input.accountEmail),
    mailboxDraftHash(local),
  ])
  return {
    document,
    binding: {
      v: 1,
      provider: 'gmail',
      documentId: document.id,
      accountHash,
      historyId: input.historyId,
      draftId: input.remote.draftId,
      messageId: input.remote.messageId,
      threadId: input.remote.threadId,
      lastSyncedHash,
      syncedAt: new Date().toISOString(),
    },
  }
}
