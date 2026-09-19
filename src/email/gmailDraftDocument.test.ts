import { describe, expect, it } from 'vitest'
import { pmToText } from '../provenance/bundle'
import { gmailPlainTextDocument, importGmailDraftDocument } from './gmailDraftDocument'

describe('Gmail draft to local email document', () => {
  it('keeps internal line breaks without executing or interpreting content', () => {
    const body = 'Hello Ada,\n\nLine two <script>not markup</script>'
    expect(pmToText(gmailPlainTextDocument(body))).toBe(`${body}\n`)
  })

  it('creates a fresh local identity and a separate local-only stable draft binding', async () => {
    const result = await importGmailDraftDocument({
      accountEmail: 'Writer@Example.com',
      historyId: 'history-9',
      remote: {
        provider: 'gmail',
        draftId: 'draft-stable',
        messageId: 'message-current',
        threadId: 'thread-1',
        headers: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'Notes' },
        body: 'One\nTwo',
        htmlAvailable: false,
        attachments: [],
      },
    })

    expect(result.document).toMatchObject({ docType: 'email', title: 'Notes' })
    expect(pmToText(result.document.contentJson)).toBe('One\nTwo\n')
    expect(result.binding).toMatchObject({
      provider: 'gmail', draftId: 'draft-stable', messageId: 'message-current', historyId: 'history-9',
    })
    expect(result.binding.documentId).toBe(result.document.id)
    expect(result.binding.accountHash).not.toContain('writer@example.com')
  })

  it('refuses HTML-only drafts rather than importing an invented empty body', async () => {
    await expect(importGmailDraftDocument({
      accountEmail: 'writer@example.com',
      historyId: 'h',
      remote: {
        provider: 'gmail', draftId: 'd', messageId: 'm', threadId: null,
        headers: { to: [], subject: 'HTML' }, body: null, htmlAvailable: true, attachments: [],
      },
    })).rejects.toThrow(/no plain-text body/i)
  })
})
