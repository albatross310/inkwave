// @vitest-environment jsdom
// The visible Gmail action must preserve the order the product promises:
// Google permission → durable local record → provider transmission.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InkwaveDocument } from '../types/document'

const calls: string[] = []
const authorise = vi.fn()
const finalise = vi.fn()
const send = vi.fn()

vi.mock('../email/gmail', () => ({
  gmailConfigured: () => true,
  preloadGmail: () => {},
  authoriseGmailSend: (...args: unknown[]) => authorise(...args),
  gmailSender: () => ({ send }),
}))

vi.mock('../email/finalise', () => ({
  draftFor: () => ({ headers: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'S' }, body: 'Body' }),
  canHandOff: () => true,
  finaliseEmail: (...args: unknown[]) => finalise(...args),
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
  finalise.mockReset().mockImplementation(async () => {
    calls.push('record')
    return { snapshot: { id: 'snap-1', createdAt: '2026-08-31T00:01:00+10:00' }, stamped: true }
  })
  send.mockReset().mockImplementation(async () => {
    calls.push('send')
    return { kind: 'sent', providerMessageId: 'gmail-1' }
  })
})

afterEach(cleanup)

describe('EmailComposePanel Gmail integration', () => {
  it('authorises, records, and only then sends', async () => {
    render(<EmailComposePanel doc={doc} onDocChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await screen.findByText(/Sent with Gmail/)
    expect(calls).toEqual(['authorise', 'record', 'send'])
    expect(screen.getByText(/Recorded/)).toBeTruthy()
  })

  it('does not send when the provenance record cannot be created', async () => {
    finalise.mockImplementationOnce(async () => {
      calls.push('record')
      return { snapshot: null, stamped: false, reason: 'storage unavailable' }
    })

    render(<EmailComposePanel doc={doc} onDocChange={() => {}} />)
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

    render(<EmailComposePanel doc={doc} onDocChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send with Gmail' }))

    await screen.findByText(/authorization window was closed.*not sent/i)
    expect(calls).toEqual(['authorise'])
    expect(finalise).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
