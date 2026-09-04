import type { InkwaveDocument } from '../types/document'
import { pmToText } from '../provenance/bundle'
import { hasRecipient } from './headers'
import type { MailDraft } from './sender'

/** The exact message bytes a MailSender sees. Snapshotting belongs to the global provenance lane. */
export function draftFor(doc: InkwaveDocument): MailDraft | null {
  if (doc.docType !== 'email' || !doc.email) return null
  return { headers: doc.email, body: pmToText(doc.contentJson, true) }
}

/** A recipient is the one precondition for handing a draft to a provider. */
export function canHandOff(doc: InkwaveDocument): boolean {
  return doc.docType === 'email' && !!doc.email && hasRecipient(doc.email)
}
