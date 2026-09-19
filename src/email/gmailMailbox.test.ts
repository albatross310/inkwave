// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_CONNECTED_MAILBOX_SCOPES,
  GMAIL_READONLY_SCOPE,
  gmailMailboxDraftClient,
  gmailMailboxReader,
} from './gmailMailbox'
import { buildGmailRawMessage } from './gmail'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const metadata = (id: string, internalDate: string, labels: string[], from: string, to: string) => ({
  id,
  historyId: `h-${id}`,
  snippet: `snippet ${id}`,
  messages: [{
    id: `m-${id}`,
    threadId: id,
    labelIds: labels,
    internalDate,
    payload: { headers: [
      { name: 'From', value: from },
      { name: 'To', value: to },
      { name: 'Subject', value: `Subject ${id}` },
    ] },
  }],
})

describe('Gmail connected-mailbox capability boundary', () => {
  it('names the two explicit scopes and never broadens to modify or full-mail access', () => {
    expect(GMAIL_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/gmail.readonly')
    expect(GMAIL_COMPOSE_SCOPE).toBe('https://www.googleapis.com/auth/gmail.compose')
    expect(GMAIL_CONNECTED_MAILBOX_SCOPES).toEqual([GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE])
    expect(GMAIL_CONNECTED_MAILBOX_SCOPES.join(' ')).not.toMatch(/gmail\.modify|mail\.google\.com/)
  })
})

describe('Gmail lightweight thread index', () => {
  it('loads Inbox metadata directly from Gmail and carries the mailbox history marker', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = String(input)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer short-lived')
      if (request.endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'mailbox-9' })
      if (request.includes('/threads?')) {
        expect(request).toContain('labelIds=INBOX')
        expect(new URL(request).searchParams.get('q')).toBe('category:primary')
        expect(request).toContain('maxResults=2')
        expect(request).toContain('pageToken=next-old')
        return json({ threads: [{ id: 'old' }, { id: 'new' }], nextPageToken: 'next-page', resultSizeEstimate: 42 })
      }
      if (request.includes('/threads/old?')) {
        expect(request).toContain('format=metadata')
        expect(request).not.toContain('format=full')
        return json(metadata('old', '1000', [], 'Old Sender <old@example.com>', 'writer@example.com'))
      }
      if (request.includes('/threads/new?')) return json(metadata('new', '2000', ['UNREAD'], 'New Sender <new@example.com>', 'writer@example.com'))
      throw new Error(`unexpected request ${request}`)
    })

    const page = await gmailMailboxReader('short-lived', fetcher).list('inbox', {
      maxResults: 2,
      pageToken: 'next-old',
    })
    expect(page).toMatchObject({
      provider: 'gmail',
      view: 'inbox',
      accountEmail: 'writer@example.com',
      historyId: 'mailbox-9',
      nextPageToken: 'next-page',
      resultSizeEstimate: 42,
    })
    expect(page.rows.map((row) => row.threadId)).toEqual(['new', 'old'])
    expect(page.rows[0]).toMatchObject({
      subject: 'Subject new',
      correspondent: 'New Sender <new@example.com>',
      unread: true,
      attachments: 'unknown',
      messageCount: 1,
    })
    expect(fetcher.mock.calls.every(([request]) => String(request).startsWith('https://gmail.googleapis.com/'))).toBe(true)
  })

  it('uses the recipient as the Sent correspondent and clamps excessive page sizes', async () => {
    const requests: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const request = String(input)
      requests.push(request)
      if (request.endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'h' })
      if (request.includes('/threads?')) return json({ threads: [{ id: 'sent-1' }] })
      return json(metadata('sent-1', '3000', ['SENT'], 'writer@example.com', 'Reader <reader@example.com>'))
    })
    const page = await gmailMailboxReader('token', fetcher).list('sent', { maxResults: 9999 })
    expect(requests.find((request) => request.includes('/threads?'))).toContain('labelIds=SENT')
    expect(requests.find((request) => request.includes('/threads?'))).toContain('maxResults=100')
    expect(page.rows[0].correspondent).toBe('Reader <reader@example.com>')
  })

  it('uses Gmail native Promotions and Spam labels without inspecting message bodies', async () => {
    const requests: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const request = String(input)
      requests.push(request)
      if (request.endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'h' })
      return json({ threads: [], resultSizeEstimate: 0 })
    })
    const reader = gmailMailboxReader('token', fetcher)
    await reader.list('promotions')
    await reader.list('spam')

    const lists = requests.filter((request) => request.includes('/threads?')).map((request) => new URL(request))
    expect(lists[0].searchParams.getAll('labelIds')).toEqual(['INBOX', 'CATEGORY_PROMOTIONS'])
    expect(lists[0].searchParams.has('includeSpamTrash')).toBe(false)
    expect(lists[1].searchParams.getAll('labelIds')).toEqual(['SPAM'])
    expect(lists[1].searchParams.get('includeSpamTrash')).toBe('true')
    expect(fetcher).toHaveBeenCalledTimes(4) // profile + one lightweight thread index per view
  })

  it('does not turn a failed or malformed read into an empty mailbox', async () => {
    const denied = vi.fn(async () => json({ error: { message: 'Grant needed' } }, 403))
    await expect(gmailMailboxReader('token', denied).list('inbox')).rejects.toMatchObject({
      name: 'MailboxReadError', kind: 'permission-needed', status: 403,
    })

    const malformed = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/profile')) {
        return new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return json({ threads: [] })
    })
    await expect(gmailMailboxReader('token', malformed).list('inbox')).rejects.toMatchObject({
      name: 'MailboxReadError', kind: 'failed', message: 'Gmail returned an unreadable response',
    })
  })

  it('returns an empty index only when Gmail successfully reports one', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'h-empty' })
      return json({ threads: [], resultSizeEstimate: 0 })
    })
    const page = await gmailMailboxReader('token', fetcher).list('inbox')
    expect(page.rows).toEqual([])
    expect(page.resultSizeEstimate).toBe(0)
  })
})

describe('Gmail on-demand thread read', () => {
  it('returns plain text and attachment metadata without fetching attachment bytes', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const request = String(input)
      expect(request).toContain('/threads/thread%2Fone?format=full')
      return json({
        id: 'thread/one',
        historyId: 'thread-history',
        messages: [{
          id: 'message-1',
          threadId: 'thread/one',
          labelIds: ['INBOX', 'UNREAD'],
          internalDate: '1720000000000',
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'Ada <ada@example.com>' },
              { name: 'To', value: 'writer@example.com' },
              { name: 'Cc', value: 'team@example.com' },
              { name: 'Subject', value: 'Unicode' },
            ],
            parts: [
              { mimeType: 'text/plain', body: { data: encode('Hello, λ and 🌊.') } },
              { mimeType: 'text/html', body: { data: encode('<img src="https://tracker.invalid/open">') } },
              { mimeType: 'application/pdf', filename: 'paper.pdf', body: { attachmentId: 'attachment-1', size: 321 } },
            ],
          },
        }],
      })
    })

    const thread = await gmailMailboxReader('token', fetcher).readThread('thread/one')
    expect(thread).toMatchObject({ provider: 'gmail', threadId: 'thread/one', historyId: 'thread-history' })
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0]).toMatchObject({
      providerMessageId: 'message-1',
      plainText: 'Hello, λ and 🌊.',
      htmlAvailable: true,
      unread: true,
      attachments: [{
        providerAttachmentId: 'attachment-1', filename: 'paper.pdf', mimeType: 'application/pdf', size: 321,
      }],
    })
    expect(JSON.stringify(thread)).not.toContain('tracker.invalid')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('fetches and verifies exactly one attachment only after the deliberate action', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/messages/message%2Fone/attachments/attachment%2Fone')
      return json({ size: 8, data: encode('%PDF-1.7') })
    })
    const attachment = {
      providerAttachmentId: 'attachment/one', filename: 'paper.pdf', mimeType: 'application/pdf', size: 8,
    }
    const content = await gmailMailboxReader('token', fetcher).readAttachment('message/one', attachment)
    expect(content).toMatchObject(attachment)
    expect(Array.from(content.bytes)).toEqual(Array.from(new TextEncoder().encode('%PDF-1.7')))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('refuses a truncated attachment instead of opening bytes that contradict Gmail metadata', async () => {
    const fetcher = vi.fn(async () => json({ size: 100, data: encode('short') }))
    await expect(gmailMailboxReader('token', fetcher).readAttachment('message', {
      providerAttachmentId: 'attachment', filename: 'paper.pdf', mimeType: 'application/pdf', size: 100,
    })).rejects.toMatchObject({
      name: 'MailboxReadError',
      message: 'Gmail attachment size did not match its metadata; nothing was opened',
    })
  })

  it('keeps HTML-only mail inert until a sanitised renderer exists', async () => {
    const fetcher = vi.fn(async () => json({
      id: 'html-thread', historyId: 'h', messages: [{
        id: 'html-message',
        payload: { mimeType: 'text/html', body: { data: encode('<form action="https://evil.invalid"></form>') } },
      }],
    }))
    const thread = await gmailMailboxReader('token', fetcher).readThread('html-thread')
    expect(thread.messages[0].plainText).toBeNull()
    expect(thread.messages[0].htmlAvailable).toBe(true)
    expect(JSON.stringify(thread)).not.toContain('evil.invalid')
  })
})

describe('Gmail foreground history check', () => {
  it('uses the lightweight history endpoint and reports whether an index rebuild is needed', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const request = String(input)
      expect(request).toContain('/history?startHistoryId=h-1')
      expect(request).toContain('maxResults=20')
      expect(request).toContain('historyTypes=labelRemoved')
      return json({ historyId: 'h-2', history: [{ id: 'change-1' }] })
    })
    await expect(gmailMailboxReader('token', fetcher).changedSince('h-1')).resolves.toEqual({
      historyId: 'h-2', changed: true, expired: false,
    })
  })

  it('treats an expired history marker as rebuild-required rather than an empty mailbox', async () => {
    const fetcher = vi.fn(async () => json({ error: { message: 'History expired' } }, 404))
    await expect(gmailMailboxReader('token', fetcher).changedSince('old')).resolves.toEqual({
      historyId: 'old', changed: true, expired: true,
    })
  })
})

describe('Gmail Draft resources use the stable draft identity', () => {
  it('lists lightweight draft metadata newest-first without reading bodies', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const request = String(input)
      if (request.endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'mailbox-drafts' })
      if (request.includes('/drafts?')) {
        expect(request).toContain('maxResults=2')
        expect(request).toContain('pageToken=older')
        return json({
          drafts: [
            { id: 'draft-old', message: { id: 'list-message-old', threadId: 'thread-old' } },
            { id: 'draft-new', message: { id: 'list-message-new', threadId: 'thread-new' } },
          ],
          nextPageToken: 'more',
          resultSizeEstimate: 12,
        })
      }
      const draftId = request.includes('draft-new') ? 'draft-new' : 'draft-old'
      expect(request).toContain('format=metadata')
      expect(request).not.toContain('format=full')
      return json({
        id: draftId,
        message: {
          id: `current-${draftId}`,
          threadId: `thread-${draftId}`,
          snippet: `snippet ${draftId}`,
          internalDate: draftId === 'draft-new' ? '2000' : '1000',
          payload: { headers: [
            { name: 'To', value: `${draftId}@example.com` },
            { name: 'Subject', value: `Subject ${draftId}` },
          ] },
        },
      })
    })

    const page = await gmailMailboxDraftClient('draft-token', fetcher).listDrafts({
      maxResults: 2,
      pageToken: 'older',
    })
    expect(page).toMatchObject({
      provider: 'gmail',
      accountEmail: 'writer@example.com',
      historyId: 'mailbox-drafts',
      nextPageToken: 'more',
      resultSizeEstimate: 12,
    })
    expect(page.rows.map((row) => row.draftId)).toEqual(['draft-new', 'draft-old'])
    expect(page.rows[0]).toMatchObject({
      draftId: 'draft-new',
      messageId: 'current-draft-new',
      subject: 'Subject draft-new',
      recipients: 'draft-new@example.com',
      attachments: 'unknown',
    })
  })

  it('opens one draft as structured headers and plain text on demand', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/drafts/draft%2Fone?format=full')
      return json({
        id: 'draft/one',
        message: {
          id: 'message-current',
          threadId: 'thread-one',
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'To', value: '"Lovelace, Ada" <ada@example.com>, bob@example.com' },
              { name: 'Cc', value: 'team@example.com' },
              { name: 'Bcc', value: 'private@example.com' },
              { name: 'Subject', value: 'Draft subject' },
            ],
            parts: [
              { mimeType: 'text/plain', body: { data: encode('Editable body') } },
              { mimeType: 'text/html', body: { data: encode('<img src="https://tracker.invalid/open">') } },
              { mimeType: 'application/pdf', filename: 'paper.pdf', body: { attachmentId: 'att-1', size: 42 } },
            ],
          },
        },
      })
    })

    const draft = await gmailMailboxDraftClient('token', fetcher).readDraft('draft/one')
    expect(draft).toMatchObject({
      provider: 'gmail',
      draftId: 'draft/one',
      messageId: 'message-current',
      threadId: 'thread-one',
      headers: {
        to: ['"Lovelace, Ada" <ada@example.com>', 'bob@example.com'],
        cc: ['team@example.com'],
        bcc: ['private@example.com'],
        subject: 'Draft subject',
      },
      body: 'Editable body',
      htmlAvailable: true,
      attachments: [{ providerAttachmentId: 'att-1', filename: 'paper.pdf', size: 42 }],
    })
    expect(JSON.stringify(draft)).not.toContain('tracker.invalid')
  })

  it('creates and replaces exact RFC 5322 bytes while retaining draft.id', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return requests.length === 1
        ? json({ id: 'stable-draft', message: { id: 'message-1', threadId: 'thread-1' } })
        : json({ id: 'stable-draft', message: { id: 'message-2', threadId: 'thread-1' } })
    })
    const client = gmailMailboxDraftClient('token', fetcher)
    const draft = {
      headers: { to: ['ada@example.com'], cc: [], bcc: ['private@example.com'], subject: 'S' },
      body: 'Body λ',
    }

    await expect(client.createDraft(draft)).resolves.toMatchObject({
      kind: 'saved', draft: { draftId: 'stable-draft', messageId: 'message-1' },
    })
    await expect(client.replaceDraft('stable-draft', draft)).resolves.toMatchObject({
      kind: 'saved', draft: { draftId: 'stable-draft', messageId: 'message-2' },
    })
    expect(requests[0].url).toMatch(/\/drafts$/)
    expect(requests[0].init?.method).toBe('POST')
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ message: { raw: buildGmailRawMessage(draft) } })
    expect(requests[1].url).toMatch(/\/drafts\/stable-draft$/)
    expect(requests[1].init?.method).toBe('PUT')
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      id: 'stable-draft', message: { raw: buildGmailRawMessage(draft) },
    })
  })

  it('sends by stable draft.id and returns Gmail sent identities', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ id: 'draft-9' })
      return json({ id: 'sent-message', threadId: 'sent-thread' })
    })
    await expect(gmailMailboxDraftClient('token', fetcher).sendDraft('draft-9')).resolves.toEqual({
      kind: 'sent', provider: 'gmail', providerMessageId: 'sent-message', threadId: 'sent-thread',
    })
    expect(String(fetcher.mock.calls[0][0])).toMatch(/\/drafts\/send$/)
  })

  it('keeps ambiguous create/update/send responses unknown and permission failures explicit', async () => {
    const lost = vi.fn(async () => { throw new Error('connection lost') })
    const client = gmailMailboxDraftClient('token', lost)
    const draft = { headers: { to: ['a@example.com'], subject: 'S' }, body: 'Body' }
    await expect(client.createDraft(draft)).resolves.toMatchObject({ kind: 'unknown' })
    await expect(client.replaceDraft('draft-1', draft)).resolves.toMatchObject({ kind: 'unknown' })
    await expect(client.sendDraft('draft-1')).resolves.toMatchObject({ kind: 'unknown' })

    const denied = vi.fn(async () => json({ error: { message: 'Compose permission needed' } }, 403))
    await expect(gmailMailboxDraftClient('token', denied).replaceDraft('draft-1', draft)).resolves.toEqual({
      kind: 'permission-needed', reason: 'Compose permission needed',
    })
  })

  it('never turns malformed draft metadata into an empty Drafts view', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/profile')) return json({ emailAddress: 'writer@example.com', historyId: 'h' })
      return json({ drafts: [{ message: { id: 'message-without-draft' } }], resultSizeEstimate: 1 })
    })
    await expect(gmailMailboxDraftClient('token', fetcher).listDrafts()).rejects.toMatchObject({
      name: 'MailboxReadError',
      kind: 'failed',
      message: 'Gmail returned draft metadata without a stable identity',
    })
  })
})
