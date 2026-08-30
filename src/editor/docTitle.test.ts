// CHARACTERIZATION of the title rule, written to hold what TiptapEditor's ensureDocFresh did before
// this logic moved out of it. Every case below is an observation of the shipped behaviour, not a
// guarantee invented here — the distinction matters because a test written AFTER a move can only
// certify the move against the mover's own assumptions.
//
// MUTATION-PROVED, one named test per mutant (each was applied to docTitle.ts and the listed test
// observed to fail, then reverted):
//   drop the email branch entirely ................. 'an email is titled by its subject' (+1 more)
//   drop the `&& doc.email` guard .................. 'an email-typed document with no headers'
//   drop `|| doc.title` ............................ 'an empty first block keeps the existing title'
//   read the whole text instead of the first line .. 'only the first line'
//   drop the 80-character cap ...................... 'a long first line is capped'
//   drop the outer trim ............................ 'leading blank lines are skipped'
//
// NOT covered here: that the caller passes the FIRST BLOCK's text rather than the whole document.
// That is a property of the call site, and `commitDoc.test.ts` is where the call sites are pinned.

import { describe, expect, it } from 'vitest'
import { deriveTitle, titleForDocument } from './docTitle'
import type { InkwaveDocument } from '../types/document'

type TitleDoc = Pick<InkwaveDocument, 'docType' | 'email' | 'title'>

const prose = (title: string): TitleDoc => ({ docType: 'essay', title })
const email = (subject: string, title = 'whatever'): TitleDoc => ({
  docType: 'email',
  title,
  email: { to: [], cc: [], bcc: [], subject },
})

describe('deriveTitle', () => {
  it('takes only the first line — never the whole document', () => {
    expect(deriveTitle('Hello\nWorld')).toBe('Hello')
    expect(deriveTitle('Hello\n\nWorld\nMore')).toBe('Hello')
  })

  it('leading blank lines are skipped rather than yielding an empty title', () => {
    expect(deriveTitle('\n\n  On method')).toBe('On method')
    expect(deriveTitle('   \n\tIndented')).toBe('Indented')
  })

  it('trims the line it picks, CRLF included', () => {
    expect(deriveTitle('  spaced  \nnext')).toBe('spaced')
    expect(deriveTitle('windows\r\nnext')).toBe('windows')
  })

  it('a long first line is capped at 80 characters', () => {
    const long = 'x'.repeat(200)
    expect(deriveTitle(long)).toHaveLength(80)
    // The cap is a slice, not an ellipsis — nothing is appended.
    expect(deriveTitle(long)).toBe('x'.repeat(80))
  })

  it('returns the empty string for empty and all-whitespace input', () => {
    // Not a failure mode: the caller reads '' as "no title could be derived" and keeps the old one.
    expect(deriveTitle('')).toBe('')
    expect(deriveTitle('   \n\n \t ')).toBe('')
  })
})

describe('titleForDocument', () => {
  it('titles ordinary prose from its first line', () => {
    expect(titleForDocument(prose('old'), 'A new beginning\nbody')).toBe('A new beginning')
  })

  it('an empty first block keeps the existing title', () => {
    // Deleting the opening line of a document you have already named must not un-name it.
    expect(titleForDocument(prose('On Kant'), '')).toBe('On Kant')
    expect(titleForDocument(prose('On Kant'), '   ')).toBe('On Kant')
  })

  it('an email is titled by its SUBJECT, not by the first line of the message', () => {
    // The bug this branch exists to prevent: the save beat overwriting the subject with the greeting,
    // so the library and the ledger's doc_label show "Dear Ada," instead of what was sent.
    expect(titleForDocument(email('Re: supervision'), 'Dear Ada,\n\nAbout Tuesday')).toBe('Re: supervision')
  })

  it('an email with a blank subject is Untitled email — it does NOT fall back to the old title', () => {
    // Deliberately asymmetric with the prose rule above. An email's title tracks its subject; a stale
    // title would misreport what was sent.
    expect(titleForDocument(email('   ', 'Re: supervision'), 'Dear Ada,')).toBe('Untitled email')
  })

  it('an email-typed document with no headers falls back to the body rule', () => {
    // The `&& doc.email` guard. `email` is optional on InkwaveDocument, so this shape is reachable.
    const headerless: TitleDoc = { docType: 'email', title: 'kept' }
    expect(titleForDocument(headerless, 'Dear Ada,')).toBe('Dear Ada,')
    expect(titleForDocument(headerless, '')).toBe('kept')
  })

  it('a music or misc document takes the ordinary prose rule', () => {
    // docType only ever diverts the rule for 'email'. Pinned so a new DocType member cannot quietly
    // acquire a title rule by being added to the union.
    expect(titleForDocument({ docType: 'music', title: 'old' }, 'Prelude')).toBe('Prelude')
    expect(titleForDocument({ docType: 'misc', title: 'old' }, 'Notes')).toBe('Notes')
  })
})
