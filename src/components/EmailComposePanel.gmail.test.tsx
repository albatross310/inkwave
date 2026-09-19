// @vitest-environment jsdom
// The visible Gmail action must preserve the order the product promises:
// Google permission → durable local record → provider transmission.

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InkwaveDocument } from '../types/document'

const calls: string[] = []
const authorise = vi.fn()
const snapshotDraft = vi.fn()
const send = vi.fn()
const draftFor = vi.fn()
const readDraftBinding = vi.fn()
const writeDraftBinding = vi.fn()
const syncConnectedDraft = vi.fn()

vi.mock('../email/gmail', () => ({
  gmailConfigured: () => true,
  preloadGmail: () => {},
  authoriseGmailSend: (...args: unknown[]) => authorise(...args),
  gmailSender: () => ({ send }),
}))

vi.mock('../email/draft', () => ({
  draftFor: (...args: unknown[]) => draftFor(...args),
  hydratedDraftFor: async (...args: unknown[]) => draftFor(...args),
  canHandOff: () => true,
}))

vi.mock('./GmailMailboxPanel', () => ({
  GmailMailboxPanel: () => <div role="dialog" aria-label="Gmail mailbox">Mailbox</div>,
}))

vi.mock('../email/gmailDraftBinding', () => ({
  readGmailDraftBinding: (...args: unknown[]) => readDraftBinding(...args),
  writeGmailDraftBinding: (...args: unknown[]) => writeDraftBinding(...args),
}))

vi.mock('../email/gmailDraftSyncController', () => ({
  syncGmailDraft: (...args: unknown[]) => syncConnectedDraft(...args),
}))

import { EmailComposePanel } from './EmailComposePanel'

const doc = {
  id: 'email-1',
  title: 'S',
  createdAt: '2026-08-31T00:00:00+10:00',
  updatedAt: '2026-08-31T00:00:00+10:00',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
  schemaVersion: '0.1.0',
  scasLimitN: 'infinite',
  scasSessionSeed: 'email-seed',
  docType: 'email',
  email: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'S' },
} as InkwaveDocument

beforeEach(() => {
  calls.length = 0
  authorise.mockReset().mockImplementation(async () => {
    calls.push('authorise')
    return 'token'
  })
  draftFor.mockReset().mockImplementation((_doc: unknown, html?: string) => ({
    headers: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'S' }, body: 'Body',
    ...(html ? { html } : {}),
  }))
  snapshotDraft.mockReset().mockImplementation(async () => {
    calls.push('record')
    return { snapshot: { id: 'snap-1', createdAt: '2026-08-31T00:01:00+10:00' }, stamped: true }
  })
  send.mockReset().mockImplementation(async () => {
    calls.push('send')
    return { kind: 'sent', providerMessageId: 'gmail-1' }
  })
  readDraftBinding.mockReset().mockResolvedValue(null)
  writeDraftBinding.mockReset().mockResolvedValue(undefined)
  syncConnectedDraft.mockReset().mockResolvedValue({
    kind: 'synced', action: 'created', binding: {
      v: 1, provider: 'gmail', documentId: 'email-1', accountHash: 'account-hash', historyId: 'h-1',
      draftId: 'draft-1', messageId: 'message-1', threadId: null, lastSyncedHash: 'hash',
      syncedAt: '2026-09-07T00:00:00Z',
    },
  })
})

afterEach(cleanup)

describe('EmailComposePanel Gmail integration', () => {
  it('keeps the ordinary formatting bar and attachment control visible inside the email', () => {
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        formattingBar={<div>Usual formatting controls</div>}
      />,
    )
    expect(screen.getByLabelText('Email text formatting').textContent).toContain('Usual formatting controls')
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset email text zoom to 100%' })).toBeTruthy()
  })

  it('places the editable message inside the default isolated application surface', () => {
    render(
      <EmailComposePanel doc={doc} getCurrentDoc={() => doc} onDocChange={() => {}} onSnapshotDraft={snapshotDraft}>
        <div data-testid="message-editor">Editable body</div>
      </EmailComposePanel>,
    )

    const surface = screen.getByRole('region', { name: 'Email draft' })
    expect(surface.getAttribute('data-iw-surface-mode')).toBe('isolated')
    expect(surface.contains(screen.getByTestId('message-editor'))).toBe(true)
    expect(screen.getByLabelText('Message body').contains(screen.getByTestId('message-editor'))).toBe(true)
    expect(screen.getByText(/Recording proves this exact draft existed by this time/)).toBeTruthy()
    expect(screen.getByText(/Saved locally/)).toBeTruthy()
  })

  it('switches the same message editor between focus and contextual studio surfaces', () => {
    function Harness() {
      const [mode, setMode] = useState<'isolated' | 'contextual'>('isolated')
      return (
        <EmailComposePanel
          doc={doc}
          getCurrentDoc={() => doc}
          onDocChange={() => {}}
          onSnapshotDraft={snapshotDraft}
          surfaceMode={mode}
          onSurfaceModeChange={setMode}
        >
          <div data-testid="message-editor">Editable body</div>
        </EmailComposePanel>
      )
    }

    render(<Harness />)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    const body = screen.getByTestId('message-editor')
    expect(surface.getAttribute('data-iw-surface-mode')).toBe('isolated')

    fireEvent.click(screen.getByRole('button', { name: 'Studio' }))

    expect(surface.getAttribute('data-iw-surface-mode')).toBe('contextual')
    expect(surface.contains(body)).toBe(true)
    expect(screen.getByRole('button', { name: 'Studio' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('duplicates from the fresh editor document rather than the stale render prop', async () => {
    const fresh = {
      ...doc,
      updatedAt: '2026-09-05T04:30:00+10:00',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest duplicate body' }] }] },
    } as InkwaveDocument
    const getCurrentDoc = vi.fn(() => fresh)
    const duplicate = vi.fn(async () => {})

    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={getCurrentDoc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        onDuplicateAsNew={duplicate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate as new email' }))

    await waitFor(() => expect(duplicate).toHaveBeenCalledWith(fresh))
    expect(getCurrentDoc).toHaveBeenCalledOnce()
  })

  it('routes Snapshot this draft through the supplied global snapshot action', async () => {
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Snapshot this draft' }))

    await screen.findByText(/Snapshot created and submitted for Bitcoin timestamping/i)
    expect(snapshotDraft).toHaveBeenCalledWith(doc)
    expect(screen.queryByText(/^Recorded /)).toBeNull()
  })

  it('authorises, records, and only then sends', async () => {
    render(<EmailComposePanel doc={doc} getCurrentDoc={() => doc} getCurrentHtml={() => '<p><strong>Body</strong></p>'} onDocChange={() => {}} onSnapshotDraft={snapshotDraft} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await screen.findByText(/Sent with Gmail/)
    expect(calls).toEqual(['authorise', 'record', 'send'])
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: '<p><strong>Body</strong></p>' }))
    expect(snapshotDraft).toHaveBeenCalledWith(doc)
    expect(screen.queryByText(/^Recorded /)).toBeNull()
  })

  it('does not send when the provenance record cannot be created', async () => {
    snapshotDraft.mockImplementationOnce(async () => {
      calls.push('record')
      return { snapshot: null, stamped: false, reason: 'storage unavailable' }
    })

    render(<EmailComposePanel doc={doc} getCurrentDoc={() => doc} onDocChange={() => {}} onSnapshotDraft={snapshotDraft} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await waitFor(() => expect(screen.getByText(/Nothing was sent/)).toBeTruthy())
    expect(calls).toEqual(['authorise', 'record'])
    expect(send).not.toHaveBeenCalled()
  })

  it('surfaces a closed authorization popup and does not record or send', async () => {
    authorise.mockImplementationOnce(async () => {
      calls.push('authorise')
      throw new Error('Google’s authorization window was closed. Your draft was not sent.')
    })

    render(<EmailComposePanel doc={doc} getCurrentDoc={() => doc} onDocChange={() => {}} onSnapshotDraft={snapshotDraft} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await screen.findByText(/authorization window was closed.*not sent/i)
    expect(calls).toEqual(['authorise'])
    expect(snapshotDraft).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('records and sends one fresh post-authorization document, not the stale render prop', async () => {
    const fresh = {
      ...doc,
      updatedAt: '2026-09-03T18:55:00+10:00',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest typed body' }] }] },
    } as InkwaveDocument
    const getCurrentDoc = vi.fn(() => fresh)

    render(<EmailComposePanel doc={doc} getCurrentDoc={getCurrentDoc} onDocChange={() => {}} onSnapshotDraft={snapshotDraft} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await screen.findByText(/Sent with Gmail/)
    expect(getCurrentDoc).toHaveBeenCalledOnce()
    expect(draftFor).toHaveBeenCalledWith(fresh, undefined)
    expect(snapshotDraft).toHaveBeenCalledWith(fresh)
  })

  it('does not call a lost Gmail response a failure or invite a blind duplicate retry', async () => {
    send.mockImplementationOnce(async () => {
      calls.push('send')
      return { kind: 'unknown', reason: 'Gmail did not return a final response' }
    })

    render(<EmailComposePanel doc={doc} getCurrentDoc={() => doc} onDocChange={() => {}} onSnapshotDraft={snapshotDraft} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    const status = await screen.findByText(/send status is unknown/i)
    expect(status.textContent).toMatch(/check (your )?Gmail Sent before trying again/i)
    expect(status.textContent).not.toMatch(/was not sent/i)
    expect(calls).toEqual(['authorise', 'record', 'send'])
  })

  it('shows the connected-mailbox capability step-up before invoking restricted authorization', async () => {
    const connectMailbox = vi.fn(async () => 'mailbox-token')
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        onConnectMailbox={connectMailbox}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail mailbox' }))

    const dialog = screen.getByRole('dialog', { name: 'Connect your Gmail mailbox?' })
    expect(connectMailbox).not.toHaveBeenCalled()
    expect(dialog.textContent).toMatch(/separate from Send with Gmail/i)
    expect(dialog.textContent).toMatch(/View your Inbox and Sent/i)
    expect(dialog.textContent).toMatch(/Create, read, replace and send Gmail drafts/i)
    expect(dialog.textContent).toMatch(/does not let Inkwave mark messages read or unread/i)
    expect(dialog.textContent).toMatch(/do not pass through or stay on Inkwave servers/i)
    expect(dialog.textContent).toMatch(/does not delete your Inkwave documents or anything in Gmail/i)

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(connectMailbox).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Connect your Gmail mailbox?' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail mailbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }))

    await waitFor(() => expect(connectMailbox).toHaveBeenCalledOnce())
    await screen.findByText(/Gmail mailbox connected for this session/i)
    expect(screen.queryByRole('dialog', { name: 'Connect your Gmail mailbox?' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Gmail mailbox' })).toBeTruthy()
  })

  it('surfaces a mailbox authorization failure without reporting a connection', async () => {
    const connectMailbox = vi.fn(async () => { throw new Error('Google mailbox permission was not granted.') })
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        onConnectMailbox={connectMailbox}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail mailbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }))

    await screen.findByText('Google mailbox permission was not granted.')
    expect(screen.queryByText(/mailbox connected/i)).toBeNull()
  })

  it('saves locally before creating a connected Gmail draft', async () => {
    const order: string[] = []
    const connectMailbox = vi.fn(async () => 'mailbox-token')
    const persistCurrent = vi.fn(async () => { order.push('local') })
    syncConnectedDraft.mockImplementationOnce(async () => {
      order.push('gmail')
      return {
        kind: 'synced', action: 'created', binding: {
          v: 1, provider: 'gmail', documentId: 'email-1', accountHash: 'account-hash', historyId: 'h-1',
          draftId: 'draft-1', messageId: 'message-1', threadId: null, lastSyncedHash: 'hash',
          syncedAt: '2026-09-07T00:00:00Z',
        },
      }
    })
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        onConnectMailbox={connectMailbox}
        onPersistCurrent={persistCurrent}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail mailbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }))
    await screen.findByRole('button', { name: 'Save to Gmail Drafts' })
    fireEvent.click(screen.getByRole('button', { name: 'Save to Gmail Drafts' }))

    await screen.findByText('Saved to Gmail Drafts.')
    expect(order).toEqual(['local', 'gmail'])
    expect(writeDraftBinding).toHaveBeenCalledOnce()
  })

  it('keeps a formatted draft local rather than flattening it during Gmail draft sync', async () => {
    const connectMailbox = vi.fn(async () => 'mailbox-token')
    const persistCurrent = vi.fn(async () => {})
    render(
      <EmailComposePanel
        doc={doc}
        getCurrentDoc={() => doc}
        getCurrentHtml={() => '<p><strong>Body</strong></p>'}
        onDocChange={() => {}}
        onSnapshotDraft={snapshotDraft}
        onConnectMailbox={connectMailbox}
        onPersistCurrent={persistCurrent}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail mailbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }))
    await screen.findByRole('button', { name: 'Save to Gmail Drafts' })
    fireEvent.click(screen.getByRole('button', { name: 'Save to Gmail Drafts' }))

    await screen.findByText(/Formatted Gmail draft sync is not available yet/i)
    expect(persistCurrent).toHaveBeenCalledWith(doc)
    expect(syncConnectedDraft).not.toHaveBeenCalled()
    expect(writeDraftBinding).not.toHaveBeenCalled()
  })
})
