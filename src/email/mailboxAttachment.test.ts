import { describe, expect, it } from 'vitest'
import { attachmentPresentation, safeAttachmentFilename } from './mailboxAttachment'

describe('mailbox attachment presentation', () => {
  it('opens only signature-verified passive browser formats', () => {
    expect(attachmentPresentation('application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe('open')
    expect(attachmentPresentation('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('open')
    expect(attachmentPresentation('text/plain', new TextEncoder().encode('hello'))).toBe('open')
  })

  it('downloads active, mismatched and native-document formats', () => {
    expect(attachmentPresentation('text/html', new TextEncoder().encode('<script>'))).toBe('download')
    expect(attachmentPresentation('image/svg+xml', new TextEncoder().encode('<svg>'))).toBe('download')
    expect(attachmentPresentation('application/pdf', new TextEncoder().encode('not pdf'))).toBe('download')
    expect(attachmentPresentation('application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Uint8Array())).toBe('download')
  })

  it('removes path/control characters from provider filenames', () => {
    expect(safeAttachmentFilename('../bad\\name\u0000.pdf')).toBe('.._bad_name_.pdf')
    expect(safeAttachmentFilename('..')).toBe('attachment')
  })
})
