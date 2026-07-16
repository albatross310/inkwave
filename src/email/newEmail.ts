// Creating an email document (§B2.1).
//
// The design claim worth stating plainly: this function is short BECAUSE an email is not a new kind
// of thing. It is an InkwaveDocument with `docType: 'email'` and a header block. Everything the spec
// wants "for free" — edit history, provenance hashing, session capture for the productivity ledger —
// follows from it being an ordinary document, not from anything here.

import { v4 as uuidv4 } from 'uuid'
import type { InkwaveDocument, EmailHeaders } from '../types/document'

/** An empty email document, ready to compose into. */
export function newEmailDocument(headers?: Partial<EmailHeaders>): InkwaveDocument {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    title: headers?.subject?.trim() || 'Untitled email',
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    createdAt: now,
    updatedAt: now,
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: uuidv4(),
    docType: 'email',
    email: {
      to: headers?.to ?? [],
      cc: headers?.cc ?? [],
      bcc: headers?.bcc ?? [],
      subject: headers?.subject ?? '',
    },
  }
}

/**
 * An email document's title tracks its subject, so it reads correctly everywhere a document title is
 * shown — the library list, and the ledger's optional `doc_label` (§A3.2). An empty subject falls
 * back rather than showing a blank row.
 */
export function titleForEmail(headers: EmailHeaders): string {
  return headers.subject.trim() || 'Untitled email'
}
