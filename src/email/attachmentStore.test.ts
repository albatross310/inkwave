// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES, formatAttachmentBytes, importEmailAttachment } from './attachmentStore'

describe('email attachments', () => {
  it('reports compact byte sizes', () => {
    expect(formatAttachmentBytes(700)).toBe('700 B')
    expect(formatAttachmentBytes(1500)).toBe('2 KB')
    expect(formatAttachmentBytes(2.25 * 1024 * 1024)).toBe('2.3 MB')
  })

  it('refuses a file that would cross the safe Gmail message total before touching storage', async () => {
    const file = new File(['x'], 'too-much.pdf', { type: 'application/pdf' })
    const result = await importEmailAttachment(file, EMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES)
    expect(result).toEqual({
      ok: false,
      reason: 'Email attachments are limited to 18.0 MB in total so Gmail can carry the encoded message.',
    })
  })
})
