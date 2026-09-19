// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const readThread = vi.fn()
const readAttachment = vi.fn()
const changedSince = vi.fn()
const listDrafts = vi.fn()
const readDraft = vi.fn()

vi.mock('../email/gmailMailbox', () => ({
  gmailMailboxReader: () => ({ list, readThread, readAttachment, changedSince }),
  gmailMailboxDraftClient: () => ({ listDrafts, readDraft }),
}))

const presentMailboxAttachment = vi.fn()
vi.mock('../email/mailboxAttachment', () => ({
  presentMailboxAttachment: (...args: unknown[]) => presentMailboxAttachment(...args),
}))

import { GmailMailboxPanel } from './GmailMailboxPanel'

beforeEach(() => {
  list.mockReset().mockResolvedValue({
    provider: 'gmail', view: 'inbox', accountEmail: 'writer@example.com', historyId: 'h-1',
    resultSizeEstimate: 1,
    rows: [{
      provider: 'gmail', threadId: 'thread-1', subject: 'Hello', correspondent: 'Ada',
      snippet: 'A short safe snippet', activityAt: '2026-09-07T00:00:00Z', unread: true,
      attachments: 'unknown', messageCount: 1,
    }],
  })
  readThread.mockReset().mockResolvedValue({
    provider: 'gmail', threadId: 'thread-1', historyId: 'h-thread', messages: [{
      providerMessageId: 'message-1', threadId: 'thread-1', from: 'Ada', to: 'writer@example.com',
      cc: '', subject: 'Hello', sentAt: '2026-09-07T00:00:00Z', unread: true,
      plainText: 'Plain body', htmlAvailable: true,
      attachments: [{ providerAttachmentId: 'att-1', filename: 'paper.pdf', mimeType: 'application/pdf', size: 42 }],
    }],
  })
  changedSince.mockReset().mockResolvedValue({ historyId: 'h-1', changed: false, expired: false })
  readAttachment.mockReset().mockResolvedValue({
    providerAttachmentId: 'att-1', filename: 'paper.pdf', mimeType: 'application/pdf', size: 8,
    bytes: new TextEncoder().encode('%PDF-1.7'),
  })
  presentMailboxAttachment.mockReset().mockReturnValue('open')
  listDrafts.mockReset().mockResolvedValue({
    provider: 'gmail', accountEmail: 'writer@example.com', historyId: 'h-drafts', resultSizeEstimate: 1,
    rows: [{
      provider: 'gmail', draftId: 'draft-1', messageId: 'm-1', threadId: null,
      subject: 'Draft subject', recipients: 'ada@example.com', snippet: 'Draft snippet',
      updatedAt: '2026-09-07T00:00:00Z', attachments: 'unknown',
    }],
  })
  readDraft.mockReset().mockResolvedValue({
    provider: 'gmail', draftId: 'draft-1', messageId: 'm-1', threadId: null,
    headers: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'Draft subject' },
    body: 'Editable draft', htmlAvailable: false, attachments: [],
  })
})

afterEach(cleanup)

describe('connected Gmail mailbox UI', () => {
  it('loads only metadata until a thread is deliberately opened and keeps unsafe content inert', async () => {
    render(<GmailMailboxPanel accessToken="memory-token" onClose={() => {}} onDisconnect={() => {}} />)

    await screen.findByText('A short safe snippet')
    expect(readThread).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Ada/ }))

    await screen.findByText('Plain body')
    expect(readThread).toHaveBeenCalledWith('thread-1')
    expect(screen.getByText(/HTML and remote images are not loaded/)).toBeTruthy()
    expect(screen.getByText(/paper\.pdf.*application\/pdf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open paper.pdf' }))
    await waitFor(() => expect(readAttachment).toHaveBeenCalledWith(
      'message-1', expect.objectContaining({ providerAttachmentId: 'att-1' }),
    ))
    expect(presentMailboxAttachment).toHaveBeenCalled()
    expect(document.querySelector('[dangerouslySetInnerHTML]')).toBeNull()
  })

  it('opens a stable Gmail draft as a deliberate local editing action', async () => {
    const onOpenDraft = vi.fn(async () => {})
    render(
      <GmailMailboxPanel
        accessToken="memory-token"
        onClose={() => {}}
        onDisconnect={() => {}}
        onOpenDraft={onOpenDraft}
      />,
    )
    await screen.findByText('A short safe snippet')
    fireEvent.click(screen.getByRole('button', { name: /drafts/i }))
    await screen.findByText('Draft snippet')
    fireEvent.click(screen.getByRole('button', { name: /ada@example\.com/ }))
    await screen.findByText('Editable draft')
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Inkwave' }))

    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft-1', messageId: 'm-1' }),
      { accountEmail: 'writer@example.com', historyId: 'h-drafts' },
    ))
  })

  it('offers Gmail-native Promotions and Spam views', async () => {
    render(<GmailMailboxPanel accessToken="memory-token" onClose={() => {}} onDisconnect={() => {}} />)
    await screen.findByText('A short safe snippet')

    fireEvent.click(screen.getByRole('button', { name: 'Promotions' }))
    await waitFor(() => expect(list).toHaveBeenCalledWith('promotions'))
    fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
    await waitFor(() => expect(list).toHaveBeenCalledWith('spam'))
  })
})
