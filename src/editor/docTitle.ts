// What a document is CALLED — the rule the save beat writes into `doc.title`.
//
// Extracted from TiptapEditor's ensureDocFresh, where it was an untested module-level helper plus a
// ternary. Both halves are load-bearing and neither is obvious, so they are pinned in docTitle.test.ts
// rather than re-derived by the next reader:
//
//  · The title is read from the FIRST BLOCK, never from `editor.getText()`. The whole-document walk
//    ran on every save beat to read one line.
//  · An EMAIL titles itself from its SUBJECT. The generic rule would overwrite the subject with the
//    first line of the message ("Dear Ada,") on the next save beat, so the library and the ledger's
//    `doc_label` (§A3.2) would show the greeting instead of the subject.
//
// Pure: no React, no DOM, no I/O. `titleForEmail` is imported rather than restated — the blank-subject
// fallback already had two copies and a third is how the ledger and the library start disagreeing.

import type { InkwaveDocument } from '../types/document'
import { titleForEmail } from '../email/newEmail'

/**
 * The first non-empty line of `text`, capped at 80 characters.
 *
 * The outer trim is why leading blank lines are skipped rather than yielding an empty title, and why
 * a CRLF document does not keep its `\r`. An all-whitespace input returns '' — the caller decides
 * what an empty derivation means, because for a document already named it means "keep the name".
 */
export function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  return first.slice(0, 80)
}

/**
 * The title for `doc` given the text of its first block.
 *
 * Note the asymmetry, which is deliberate: the body rule falls back to the EXISTING title when the
 * first block is empty (a document you have named does not lose its name when you delete the opening
 * line), while the email rule does not — an email with a blank subject is 'Untitled email', because
 * its title tracks its subject and a stale one would misreport what was sent.
 */
export function titleForDocument(
  doc: Pick<InkwaveDocument, 'docType' | 'email' | 'title'>,
  firstBlockText: string,
): string {
  if (doc.docType === 'email' && doc.email) return titleForEmail(doc.email)
  return deriveTitle(firstBlockText) || doc.title
}
