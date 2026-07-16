import { describe, it, expect } from 'vitest'
import { newEmailDocument, titleForEmail } from './newEmail'

describe('newEmailDocument', () => {
  it('is an ORDINARY InkwaveDocument — same required fields as any other', () => {
    const d = newEmailDocument()
    // This is the load-bearing property of the whole layer: edit history, provenance hashing and
    // ledger session capture apply to an email only because it is an ordinary document.
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(d.schemaVersion).toBe('0.1.0')
    expect(d.contentJson.type).toBe('doc')
    expect(d.scasSessionSeed).toBeTruthy()
    expect(d.createdAt).toBe(d.updatedAt)
  })

  it('carries docType email and empty headers', () => {
    const d = newEmailDocument()
    expect(d.docType).toBe('email')
    expect(d.email).toEqual({ to: [], cc: [], bcc: [], subject: '' })
  })

  it('seeds headers and titles itself from the subject', () => {
    const d = newEmailDocument({ to: ['a@x.com'], subject: 'Supervision meeting' })
    expect(d.email!.to).toEqual(['a@x.com'])
    expect(d.title).toBe('Supervision meeting')
  })

  it('falls back to a readable title when there is no subject', () => {
    expect(newEmailDocument().title).toBe('Untitled email')
    expect(titleForEmail({ to: [], subject: '   ' })).toBe('Untitled email')
  })

  it('gives every email its own id', () => {
    expect(newEmailDocument().id).not.toBe(newEmailDocument().id)
  })
})
