import { describe, expect, it } from 'vitest'
import { classifyMailboxDraftSync, mailboxDraftHash } from './mailboxDraftSync'

describe('connected-mailbox draft hash', () => {
  it('canonicalises headers and line endings into one logical draft identity', async () => {
    const a = await mailboxDraftHash({
      headers: { to: [' Ada@Example.com '], subject: '  Hello  there ' },
      body: 'One\r\nTwo\rThree',
    })
    const b = await mailboxDraftHash({
      headers: { to: ['ada@example.com'], cc: [], bcc: [], subject: 'Hello there' },
      body: 'One\nTwo\nThree',
    })
    expect(a).toBe(b)
  })

  it('changes when either sent content or a hidden recipient changes', async () => {
    const base = { headers: { to: ['a@example.com'], bcc: ['secret@example.com'], subject: 'S' }, body: 'Body' }
    expect(await mailboxDraftHash(base)).not.toBe(await mailboxDraftHash({ ...base, body: 'Changed' }))
    expect(await mailboxDraftHash(base)).not.toBe(await mailboxDraftHash({
      ...base,
      headers: { ...base.headers, bcc: ['other@example.com'] },
    }))
  })

  it('includes ordered attachment metadata without retaining attachment bytes in the hash input', async () => {
    const base = { headers: { to: ['a@example.com'], subject: 'S' }, body: 'Body' }
    const a = await mailboxDraftHash({
      ...base,
      attachments: [{ filename: 'one.pdf', mimeType: 'application/pdf', size: 12, bytes: Uint8Array.of(1) }],
    })
    const b = await mailboxDraftHash({
      ...base,
      attachments: [{ filename: 'one.pdf', mimeType: 'application/pdf', size: 12 }],
    })
    const changed = await mailboxDraftHash({
      ...base,
      attachments: [{ filename: 'two.pdf', mimeType: 'application/pdf', size: 12 }],
    })
    expect(a).toBe(b)
    expect(changed).not.toBe(a)
  })
})

describe('connected-mailbox draft conflict controller', () => {
  it('does nothing when local and remote already agree', () => {
    expect(classifyMailboxDraftSync('old', 'same', 'same')).toBe('in-sync')
  })

  it('uploads only when remote is still the acknowledged ancestor', () => {
    expect(classifyMailboxDraftSync('base', 'local-new', 'base')).toBe('upload-local')
  })

  it('imports only when local is still the acknowledged ancestor', () => {
    expect(classifyMailboxDraftSync('base', 'base', 'remote-new')).toBe('import-remote')
  })

  it('preserves both independent changes instead of choosing by timestamp', () => {
    expect(classifyMailboxDraftSync('base', 'local-new', 'remote-new')).toBe('preserve-both')
  })

  it('preserves both when there is no acknowledged ancestry', () => {
    expect(classifyMailboxDraftSync(null, 'local', 'remote')).toBe('preserve-both')
  })
})
