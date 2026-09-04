import { describe, expect, it, vi } from 'vitest'
import type { InkwaveDocument } from '../types/document'
import { duplicateEmailAsNew } from './duplicateEmail'

const source = {
  id: 'source-email',
  title: 'Original title',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  contentJson: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Message body' }] }],
  },
  schemaVersion: '0.1.0',
  scasLimitN: 1500,
  scasSessionSeed: 'old-session-seed',
  scasSeedRef: 'old-server-seed-ref',
  scasState: { version: 4, locked: ['proof'], satisfied: [], liveKicks: [], kickTimes: {} },
  scasReceipts: [{ signature: 'old-proof' }],
  scasGreenAnchors: ['old-anchor'],
  docType: 'email',
  email: {
    to: ['ada@example.com'],
    cc: ['team@example.com'],
    bcc: [],
    subject: 'Project update',
  },
  toolbar: { row: ['page', 'style', 'info', 'settings', 'media', 'review'] },
} as unknown as InkwaveDocument

describe('duplicateEmailAsNew', () => {
  it('copies the composed message under a genuinely new identity', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T04:00:00.000Z'))
    const copy = duplicateEmailAsNew(source)
    vi.useRealTimers()

    expect(copy.id).not.toBe(source.id)
    expect(copy.scasSessionSeed).not.toBe(source.scasSessionSeed)
    expect(copy.createdAt).toBe('2026-09-05T04:00:00.000Z')
    expect(copy.updatedAt).toBe(copy.createdAt)
    expect(copy.docType).toBe('email')
    expect(copy.email).toEqual(source.email)
    expect(copy.contentJson).toEqual(source.contentJson)
    expect(copy.title).toBe('Project update')
    expect(copy.toolbar).toEqual(source.toolbar)
  })

  it('does not carry identity-bound provenance or live SCAS state', () => {
    const copy = duplicateEmailAsNew(source)

    expect(copy.scasReceipts).toBeUndefined()
    expect(copy.scasGreenAnchors).toBeUndefined()
    expect(copy.scasState).toEqual({ version: 0, locked: [], satisfied: [], liveKicks: [], kickTimes: {} })
    expect(copy.scasSeedRef).toBe(copy.scasSessionSeed)
    expect(copy.scasSeedRef).not.toBe(source.scasSeedRef)
  })

  it('does not share mutable message objects with the source', () => {
    const copy = duplicateEmailAsNew(source)
    copy.email!.to.push('new@example.com')
    copy.contentJson.content![0].content![0].text = 'Changed copy'

    expect(source.email!.to).toEqual(['ada@example.com'])
    expect(source.contentJson.content![0].content![0].text).toBe('Message body')
  })

  it('refuses a non-email document instead of guessing a message shape', () => {
    expect(() => duplicateEmailAsNew({ ...source, docType: 'essay', email: undefined }))
      .toThrow(/Only an email document/)
  })
})
