// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GmailDraftBinding } from './gmailDraftBinding'

const profile = vi.fn()
const createDraft = vi.fn()
const readDraft = vi.fn()
const replaceDraft = vi.fn()

vi.mock('./gmailMailbox', () => ({
  gmailMailboxProfile: (...args: unknown[]) => profile(...args),
  gmailMailboxDraftClient: () => ({ createDraft, readDraft, replaceDraft }),
}))

import { mailboxDraftHash } from './mailboxDraftSync'
import { syncGmailDraft } from './gmailDraftSyncController'

const local = { headers: { to: ['ada@example.com'], subject: 'S' }, body: 'Local body' }
const remote = (body: string) => ({
  provider: 'gmail' as const, draftId: 'draft-1', messageId: 'message-1', threadId: 'thread-1',
  headers: local.headers, body, htmlAvailable: false, attachments: [],
})

beforeEach(() => {
  profile.mockReset().mockResolvedValue({ accountEmail: 'writer@example.com', historyId: 'h-2' })
  createDraft.mockReset().mockResolvedValue({
    kind: 'saved', draft: { provider: 'gmail', draftId: 'draft-1', messageId: 'message-1', threadId: 'thread-1' },
  })
  readDraft.mockReset()
  replaceDraft.mockReset().mockResolvedValue({
    kind: 'saved', draft: { provider: 'gmail', draftId: 'draft-1', messageId: 'message-2', threadId: 'thread-1' },
  })
})

describe('connected Gmail draft sync', () => {
  it('creates a Gmail draft and returns a local-only stable binding', async () => {
    const result = await syncGmailDraft({ accessToken: 'token', documentId: 'doc-1', local, binding: null })
    expect(result).toMatchObject({ kind: 'synced', action: 'created', binding: { draftId: 'draft-1', documentId: 'doc-1' } })
    expect(createDraft).toHaveBeenCalledWith(local)
  })

  it('replaces remotely only when the remote still equals the acknowledged ancestor', async () => {
    const baseHash = await mailboxDraftHash({ ...local, body: 'Old body' })
    const binding = { v: 1, provider: 'gmail', documentId: 'doc-1', accountHash: 'a', historyId: 'h-1',
      draftId: 'draft-1', messageId: 'message-old', threadId: 'thread-1', lastSyncedHash: baseHash,
      syncedAt: '2026-09-07T00:00:00Z' } satisfies GmailDraftBinding
    readDraft.mockResolvedValue(remote('Old body'))

    const result = await syncGmailDraft({ accessToken: 'token', documentId: 'doc-1', local, binding })
    expect(result).toMatchObject({ kind: 'synced', action: 'updated', binding: { messageId: 'message-2' } })
    expect(replaceDraft).toHaveBeenCalledWith('draft-1', local)
  })

  it('preserves both when local and Gmail independently changed', async () => {
    const baseHash = await mailboxDraftHash({ ...local, body: 'Old body' })
    const binding = { v: 1, provider: 'gmail', documentId: 'doc-1', accountHash: 'a', historyId: 'h-1',
      draftId: 'draft-1', messageId: 'message-old', threadId: null, lastSyncedHash: baseHash,
      syncedAt: '2026-09-07T00:00:00Z' } satisfies GmailDraftBinding
    readDraft.mockResolvedValue(remote('Remote body'))

    const result = await syncGmailDraft({ accessToken: 'token', documentId: 'doc-1', local, binding })
    expect(result).toMatchObject({ kind: 'conflict', remote: { body: 'Remote body' } })
    expect(replaceDraft).not.toHaveBeenCalled()
  })

  it('does not invite a blind duplicate after an ambiguous create response', async () => {
    createDraft.mockResolvedValue({ kind: 'unknown', reason: 'connection lost' })
    await expect(syncGmailDraft({ accessToken: 'token', documentId: 'doc-1', local, binding: null }))
      .resolves.toEqual({ kind: 'unknown', reason: 'connection lost' })
  })
})
