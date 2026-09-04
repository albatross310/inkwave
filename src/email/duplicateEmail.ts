import { v4 as uuidv4 } from 'uuid'
import { withScasDefaults } from '../scas/defaults'
import type { InkwaveDocument, TiptapJSON } from '../types/document'
import { titleForEmail } from './newEmail'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Start a new email from an existing one without letting the new identity inherit evidence that
 * belongs to the source document. Headers/body and ordinary writing configuration are copied; the
 * receipt chain, live SCAS verdict state, green anchors and seed reference are not.
 *
 * This is deliberately a document constructor, not a UI operation. A later workspace can append
 * the returned subdoc beside its source; today's single-document shell can save and open it.
 */
export function duplicateEmailAsNew(source: InkwaveDocument): InkwaveDocument {
  if (source.docType !== 'email' || !source.email) {
    throw new Error('Only an email document can be duplicated as a new email')
  }

  const now = new Date().toISOString()
  const id = uuidv4()
  const seed = uuidv4()
  const {
    scasReceipts: _receipts,
    scasState: _state,
    scasGreenAnchors: _anchors,
    scasSeedRef: _seedRef,
    ...portable
  } = source
  void _receipts; void _state; void _anchors; void _seedRef

  const email = cloneJson(source.email)
  return withScasDefaults({
    ...portable,
    id,
    title: titleForEmail(email),
    contentJson: cloneJson(source.contentJson) as TiptapJSON,
    email,
    createdAt: now,
    updatedAt: now,
    scasSessionSeed: seed,
  })
}
