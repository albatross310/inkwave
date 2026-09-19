import type { InkwaveDocument } from '../types/document'
import { pmToText } from '../provenance/bundle'
import { hasRecipient } from './headers'
import type { MailDraft } from './sender'
import { EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES, loadEmailAttachmentBytes } from './attachmentStore'

/** The exact message bytes a MailSender sees. Snapshotting belongs to the global provenance lane. */
export function draftFor(doc: InkwaveDocument, html?: string): MailDraft | null {
  if (doc.docType !== 'email' || !doc.email) return null
  return {
    headers: doc.email,
    body: pmToText(doc.contentJson, true),
    ...(html ? { html } : {}),
    attachments: (doc.emailAttachments ?? []).map((attachment) => ({
      filename: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  }
}

/** Hydrate and verify local attachment bytes only for an explicit Gmail mutation. */
export async function hydratedDraftFor(doc: InkwaveDocument, html?: string): Promise<MailDraft | null> {
  const draft = draftFor(doc, html)
  if (!draft) return null
  const total = (doc.emailAttachments ?? []).reduce((sum, attachment) => sum + attachment.size, 0)
  if (total > EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES) {
    throw new Error('This draft exceeds Inkwave’s safe Gmail attachment limit. Nothing was sent.')
  }
  const attachments = []
  for (const attachment of doc.emailAttachments ?? []) {
    const bytes = await loadEmailAttachmentBytes(attachment)
    if (!bytes) throw new Error(`“${attachment.name}” is no longer available on this device. Nothing was sent.`)
    attachments.push({
      filename: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      bytes,
    })
  }
  return { ...draft, attachments }
}

/** A recipient is the one precondition for handing a draft to a provider. */
export function canHandOff(doc: InkwaveDocument): boolean {
  return doc.docType === 'email' && !!doc.email && hasRecipient(doc.email)
}
