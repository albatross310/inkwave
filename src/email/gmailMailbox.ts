// Gmail connected-mailbox adapter (Productivity + Email v0.2, §B3.1–B3.3).
//
// This module deliberately does NOT authorise itself. The visible Connect mailbox action must show
// the added capabilities before it asks Google, so the OAuth request belongs to that later UI seam.
// Given a short-lived token, every request goes from this browser straight to Gmail. Nothing here
// persists tokens, message bodies, attachment bytes, or calls an Inkwave endpoint.

import {
  MailboxReadError,
  type MailboxAttachment,
  type MailboxAttachmentContent,
  type MailboxDraft,
  type MailboxDraftClient,
  type MailboxDraftMutation,
  type MailboxDraftRef,
  type MailboxDraftRow,
  type MailboxDraftSend,
  type MailboxIndexPage,
  type MailboxMessage,
  type MailboxReader,
  type MailboxThread,
  type MailboxThreadRow,
  type MailboxView,
} from './mailbox'
import { buildGmailRawMessage } from './gmail'
import type { MailDraft } from './sender'
export { GMAIL_COMPOSE_SCOPE, GMAIL_CONNECTED_MAILBOX_SCOPES, GMAIL_READONLY_SCOPE } from './gmailMailboxScopes'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const INDEX_HEADERS = ['From', 'To', 'Subject', 'Date'] as const
const DEFAULT_MAX_RESULTS = 20
const MAX_RESULTS = 100
const METADATA_CONCURRENCY = 6
export const GMAIL_ATTACHMENT_BYTE_CAP = 25 * 1024 * 1024

const GMAIL_VIEW_FILTERS: Record<MailboxView, {
  labelIds: readonly string[]
  query?: string
  includeSpamTrash?: boolean
}> = {
  // Gmail's Inbox label contains every tab. Pair it with Gmail's own Primary search category so
  // Promotions does not appear twice and Inkwave never attempts its own classifier.
  inbox: { labelIds: ['INBOX'], query: 'category:primary' },
  promotions: { labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] },
  spam: { labelIds: ['SPAM'], includeSpamTrash: true },
  sent: { labelIds: ['SENT'] },
}

export interface GmailMailboxProfile {
  accountEmail: string
  historyId: string
}

type FetchLike = typeof fetch

interface GmailHeader { name?: string; value?: string }
interface GmailBody { attachmentId?: string; data?: string; size?: number }
interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailBody
  parts?: GmailPart[]
}
interface GmailMessage {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}
interface GmailThreadPayload {
  id?: string
  historyId?: string
  snippet?: string
  messages?: GmailMessage[]
}
interface GmailDraftPayload {
  id?: string
  message?: GmailMessage
}

function url(path: string, params?: URLSearchParams): string {
  const query = params?.toString()
  return `${API}${path}${query ? `?${query}` : ''}`
}

async function gmailJson<T>(fetcher: FetchLike, accessToken: string, requestUrl: string): Promise<T> {
  let response: Response
  try {
    response = await fetcher(requestUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    throw new MailboxReadError(
      'failed',
      error instanceof Error ? error.message : 'Gmail could not be reached',
    )
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } }
    const kind = response.status === 401 || response.status === 403
      ? 'permission-needed'
      : 'failed'
    throw new MailboxReadError(kind, payload.error?.message ?? `Gmail request failed (${response.status})`, response.status)
  }
  try {
    return await response.json() as T
  } catch {
    // A malformed successful read is not an empty mailbox.
    throw new MailboxReadError('failed', 'Gmail returned an unreadable response', response.status)
  }
}

export async function gmailMailboxProfile(
  accessToken: string,
  fetcher: FetchLike = fetch,
): Promise<GmailMailboxProfile> {
  const profile = await gmailJson<{ emailAddress?: string; historyId?: string }>(fetcher, accessToken, url('/profile'))
  if (!profile.emailAddress || !profile.historyId) {
    throw new MailboxReadError('failed', 'Gmail profile is missing its account or history marker')
  }
  return { accountEmail: profile.emailAddress, historyId: profile.historyId }
}

function header(part: GmailPart | undefined, name: string): string {
  const wanted = name.toLowerCase()
  return part?.headers?.find((item) => item.name?.toLowerCase() === wanted)?.value?.trim() ?? ''
}

/** Split an RFC-style address header without treating a comma in a quoted display name as a separator. */
function addressHeader(value: string): string[] {
  const result: string[] = []
  let start = 0
  let quoted = false
  let escaped = false
  let angleDepth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && char === '<') angleDepth++
    else if (!quoted && char === '>' && angleDepth > 0) angleDepth--
    else if (!quoted && angleDepth === 0 && (char === ',' || char === ';')) {
      const address = value.slice(start, index).trim()
      if (address) result.push(address)
      start = index + 1
    }
  }
  const tail = value.slice(start).trim()
  if (tail) result.push(tail)
  return result
}

function isoFromMillis(value: string | undefined): string | null {
  if (!value || !/^\d+$/.test(value)) return null
  const date = new Date(Number(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function newest(messages: GmailMessage[]): GmailMessage | undefined {
  return messages.reduce<GmailMessage | undefined>((latest, message) => {
    if (!latest) return message
    return Number(message.internalDate ?? 0) >= Number(latest.internalDate ?? 0) ? message : latest
  }, undefined)
}

function rowFromThread(view: MailboxView, payload: GmailThreadPayload): MailboxThreadRow<'gmail'> | null {
  if (!payload.id) return null
  const messages = payload.messages ?? []
  const latest = newest(messages)
  return {
    provider: 'gmail',
    threadId: payload.id,
    subject: header(latest?.payload, 'Subject') || '(no subject)',
    correspondent: header(latest?.payload, view === 'sent' ? 'To' : 'From') || '(unknown)',
    snippet: payload.snippet?.trim() || latest?.snippet?.trim() || '',
    activityAt: isoFromMillis(latest?.internalDate),
    unread: messages.some((message) => message.labelIds?.includes('UNREAD')),
    // Gmail metadata format intentionally omits MIME bodies/parts. Claiming "no attachment" here
    // would turn an unknown into a known-empty; the opened-thread request resolves it.
    attachments: 'unknown',
    messageCount: messages.length,
  }
}

async function mapLimited<T, U>(items: T[], limit: number, map: (item: T) => Promise<U>): Promise<U[]> {
  const result = new Array<U>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      result[index] = await map(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return result
}

function decodeBase64UrlBytes(value: string | undefined): Uint8Array | null {
  if (!value) return null
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
    const binary = atob(padded)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function decodeBase64Url(value: string | undefined): string | null {
  const bytes = decodeBase64UrlBytes(value)
  return bytes ? new TextDecoder().decode(bytes) : null
}

function walkParts(part: GmailPart | undefined, visit: (part: GmailPart) => void): void {
  if (!part) return
  visit(part)
  for (const child of part.parts ?? []) walkParts(child, visit)
}

function messageFromPayload(message: GmailMessage, fallbackThreadId: string): MailboxMessage | null {
  if (!message.id) return null
  let plainText: string | null = null
  let htmlAvailable = false
  const attachments: MailboxAttachment[] = []

  walkParts(message.payload, (part) => {
    if (
      part.mimeType?.toLowerCase() === 'text/plain'
      && plainText === null
      && !part.filename
      && !part.body?.attachmentId
    ) {
      plainText = decodeBase64Url(part.body?.data)
    }
    if (part.mimeType?.toLowerCase() === 'text/html') htmlAvailable = true
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        providerAttachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size ?? 0,
      })
    }
  })

  return {
    providerMessageId: message.id,
    threadId: message.threadId || fallbackThreadId,
    from: header(message.payload, 'From'),
    to: header(message.payload, 'To'),
    cc: header(message.payload, 'Cc'),
    subject: header(message.payload, 'Subject'),
    sentAt: isoFromMillis(message.internalDate),
    unread: !!message.labelIds?.includes('UNREAD'),
    plainText,
    htmlAvailable,
    attachments,
  }
}

function draftRef(payload: GmailDraftPayload): MailboxDraftRef<'gmail'> | null {
  if (!payload.id || !payload.message?.id) return null
  return {
    provider: 'gmail',
    draftId: payload.id,
    messageId: payload.message.id,
    threadId: payload.message.threadId ?? null,
  }
}

function draftRow(payload: GmailDraftPayload): MailboxDraftRow<'gmail'> | null {
  const ref = draftRef(payload)
  if (!ref) return null
  const message = payload.message!
  return {
    ...ref,
    subject: header(message.payload, 'Subject') || '(no subject)',
    recipients: header(message.payload, 'To') || '(no recipients)',
    snippet: message.snippet?.trim() || '',
    updatedAt: isoFromMillis(message.internalDate),
    // Metadata format does not expose MIME parts, so absence cannot be claimed here.
    attachments: 'unknown',
  }
}

function openedDraft(payload: GmailDraftPayload): MailboxDraft<'gmail'> | null {
  const ref = draftRef(payload)
  if (!ref) return null
  const message = payload.message!
  const resolved = messageFromPayload(message, message.threadId ?? '')
  if (!resolved) return null
  return {
    ...ref,
    headers: {
      to: addressHeader(header(message.payload, 'To')),
      cc: addressHeader(header(message.payload, 'Cc')),
      bcc: addressHeader(header(message.payload, 'Bcc')),
      subject: header(message.payload, 'Subject'),
    },
    body: resolved.plainText,
    htmlAvailable: resolved.htmlAvailable,
    attachments: resolved.attachments,
  }
}

type GmailMutationResponse<T> =
  | { kind: 'ok'; payload: T }
  | { kind: 'permission-needed' | 'failed' | 'unknown'; reason: string }

async function gmailMutation<T>(
  fetcher: FetchLike,
  accessToken: string,
  requestUrl: string,
  init: RequestInit,
): Promise<GmailMutationResponse<T>> {
  let response: Response
  try {
    response = await fetcher(requestUrl, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  } catch (error) {
    return {
      kind: 'unknown',
      reason: error instanceof Error ? error.message : 'Gmail did not return a final response',
    }
  }

  let payload: T & { error?: { message?: string } }
  try {
    payload = await response.json() as T & { error?: { message?: string } }
  } catch {
    return response.ok
      ? { kind: 'unknown', reason: 'Gmail accepted the request but returned an unreadable response' }
      : { kind: 'failed', reason: `Gmail request failed (${response.status})` }
  }
  if (!response.ok) {
    return {
      kind: response.status === 401 || response.status === 403 ? 'permission-needed' : 'failed',
      reason: payload.error?.message ?? `Gmail request failed (${response.status})`,
    }
  }
  return { kind: 'ok', payload }
}

/** A zero-retention reader: full bodies exist only in the returned object held by the caller. */
export function gmailMailboxReader(accessToken: string, fetcher: FetchLike = fetch): MailboxReader<'gmail'> {
  return {
    list: async (view, options = {}): Promise<MailboxIndexPage<'gmail'>> => {
      const maxResults = Math.max(1, Math.min(MAX_RESULTS, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS)))
      const filter = GMAIL_VIEW_FILTERS[view]
      const listParams = new URLSearchParams({ maxResults: String(maxResults) })
      for (const labelId of filter.labelIds) listParams.append('labelIds', labelId)
      if (filter.query) listParams.set('q', filter.query)
      if (filter.includeSpamTrash) listParams.set('includeSpamTrash', 'true')
      if (options.pageToken) listParams.set('pageToken', options.pageToken)

      const [profile, listed] = await Promise.all([
        gmailJson<{ emailAddress?: string; historyId?: string }>(fetcher, accessToken, url('/profile')),
        gmailJson<{ threads?: Array<{ id?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(
          fetcher, accessToken, url('/threads', listParams),
        ),
      ])

      if (!profile.emailAddress || !profile.historyId) {
        throw new MailboxReadError('failed', 'Gmail profile is missing its account or history marker')
      }

      const ids = (listed.threads ?? []).map((thread) => thread.id).filter((id): id is string => !!id)
      const rows = (await mapLimited(ids, METADATA_CONCURRENCY, async (threadId) => {
        const params = new URLSearchParams({ format: 'metadata' })
        for (const name of INDEX_HEADERS) params.append('metadataHeaders', name)
        const thread = await gmailJson<GmailThreadPayload>(
          fetcher, accessToken, url(`/threads/${encodeURIComponent(threadId)}`, params),
        )
        return rowFromThread(view, thread)
      })).filter((row): row is MailboxThreadRow<'gmail'> => row !== null)

      rows.sort((a, b) => (b.activityAt ?? '').localeCompare(a.activityAt ?? ''))
      return {
        provider: 'gmail',
        view,
        accountEmail: profile.emailAddress,
        historyId: profile.historyId,
        rows,
        ...(listed.nextPageToken ? { nextPageToken: listed.nextPageToken } : {}),
        resultSizeEstimate: listed.resultSizeEstimate ?? rows.length,
      }
    },

    readThread: async (threadId): Promise<MailboxThread<'gmail'>> => {
      const params = new URLSearchParams({ format: 'full' })
      const payload = await gmailJson<GmailThreadPayload>(
        fetcher, accessToken, url(`/threads/${encodeURIComponent(threadId)}`, params),
      )
      if (!payload.id || !payload.historyId) {
        throw new MailboxReadError('failed', 'Gmail thread is missing its identity or history marker')
      }
      const resolvedThreadId = payload.id
      return {
        provider: 'gmail',
        threadId: resolvedThreadId,
        historyId: payload.historyId,
        messages: (payload.messages ?? [])
          .map((message) => messageFromPayload(message, resolvedThreadId))
          .filter((message): message is MailboxMessage => message !== null),
      }
    },

    readAttachment: async (messageId, attachment): Promise<MailboxAttachmentContent> => {
      if (attachment.size > GMAIL_ATTACHMENT_BYTE_CAP) {
        throw new MailboxReadError('failed', `“${attachment.filename}” is larger than the 25 MB safe-open limit`)
      }
      const payload = await gmailJson<{ size?: number; data?: string }>(
        fetcher,
        accessToken,
        url(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.providerAttachmentId)}`),
      )
      const bytes = decodeBase64UrlBytes(payload.data)
      if (!bytes || !Number.isFinite(payload.size)) {
        throw new MailboxReadError('failed', 'Gmail returned an unreadable attachment')
      }
      if (payload.size !== bytes.byteLength || (attachment.size > 0 && attachment.size !== bytes.byteLength)) {
        throw new MailboxReadError('failed', 'Gmail attachment size did not match its metadata; nothing was opened')
      }
      if (bytes.byteLength > GMAIL_ATTACHMENT_BYTE_CAP) {
        throw new MailboxReadError('failed', `“${attachment.filename}” is larger than the 25 MB safe-open limit`)
      }
      return { ...attachment, size: bytes.byteLength, bytes }
    },

    changedSince: async (historyId) => {
      const params = new URLSearchParams({ startHistoryId: historyId, maxResults: '20' })
      for (const kind of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) {
        params.append('historyTypes', kind)
      }
      try {
        const payload = await gmailJson<{
          historyId?: string
          history?: unknown[]
          nextPageToken?: string
        }>(fetcher, accessToken, url('/history', params))
        if (!payload.historyId) throw new MailboxReadError('failed', 'Gmail history is missing its high-water marker')
        return {
          historyId: payload.historyId,
          changed: !!payload.nextPageToken || !!payload.history?.length,
          expired: false,
        }
      } catch (cause) {
        // Gmail uses 404 when startHistoryId is outside its retained history window. That means
        // rebuild the index—not "empty", and not a permission failure.
        if (cause instanceof MailboxReadError && cause.status === 404) {
          return { historyId, changed: true, expired: true }
        }
        throw cause
      }
    },
  }
}

/**
 * Draft-capable Gmail client. OAuth remains outside this module: constructing it requests no scope
 * and persists no token. The consent/controller layer supplies a short-lived connected token.
 */
export function gmailMailboxDraftClient(
  accessToken: string,
  fetcher: FetchLike = fetch,
): MailboxDraftClient<'gmail'> {
  return {
    listDrafts: async (options = {}) => {
      const maxResults = Math.max(1, Math.min(100, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS)))
      const params = new URLSearchParams({ maxResults: String(maxResults) })
      if (options.pageToken) params.set('pageToken', options.pageToken)
      const [profile, listed] = await Promise.all([
        gmailJson<{ emailAddress?: string; historyId?: string }>(fetcher, accessToken, url('/profile')),
        gmailJson<{ drafts?: GmailDraftPayload[]; nextPageToken?: string; resultSizeEstimate?: number }>(
          fetcher, accessToken, url('/drafts', params),
        ),
      ])
      if (!profile.emailAddress || !profile.historyId) {
        throw new MailboxReadError('failed', 'Gmail profile is missing its account or history marker')
      }
      const listedDrafts = listed.drafts ?? []
      if (listedDrafts.some((draft) => !draft.id)) {
        throw new MailboxReadError('failed', 'Gmail returned draft metadata without a stable identity')
      }
      const ids = listedDrafts.map((draft) => draft.id!)
      const rows = await mapLimited(ids, METADATA_CONCURRENCY, async (draftId) => {
        const metadata = new URLSearchParams({ format: 'metadata' })
        for (const name of ['To', 'Cc', 'Bcc', 'Subject', 'Date']) metadata.append('metadataHeaders', name)
        const payload = await gmailJson<GmailDraftPayload>(
          fetcher, accessToken, url(`/drafts/${encodeURIComponent(draftId)}`, metadata),
        )
        const row = draftRow(payload)
        if (!row) throw new MailboxReadError('failed', 'Gmail draft metadata is missing its stable identity')
        return row
      })
      rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      return {
        provider: 'gmail',
        accountEmail: profile.emailAddress,
        historyId: profile.historyId,
        rows,
        ...(listed.nextPageToken ? { nextPageToken: listed.nextPageToken } : {}),
        resultSizeEstimate: listed.resultSizeEstimate ?? rows.length,
      }
    },

    readDraft: async (draftId) => {
      const params = new URLSearchParams({ format: 'full' })
      const payload = await gmailJson<GmailDraftPayload>(
        fetcher, accessToken, url(`/drafts/${encodeURIComponent(draftId)}`, params),
      )
      const draft = openedDraft(payload)
      if (!draft) throw new MailboxReadError('failed', 'Gmail draft is missing its stable identity')
      return draft
    },

    createDraft: async (draft: MailDraft): Promise<MailboxDraftMutation<'gmail'>> => {
      const response = await gmailMutation<GmailDraftPayload>(fetcher, accessToken, url('/drafts'), {
        method: 'POST',
        body: JSON.stringify({ message: { raw: buildGmailRawMessage(draft) } }),
      })
      if (response.kind !== 'ok') return response
      const ref = draftRef(response.payload)
      return ref
        ? { kind: 'saved', draft: ref }
        : { kind: 'unknown', reason: 'Gmail saved the draft but did not return its stable identity' }
    },

    replaceDraft: async (draftId: string, draft: MailDraft): Promise<MailboxDraftMutation<'gmail'>> => {
      const response = await gmailMutation<GmailDraftPayload>(
        fetcher,
        accessToken,
        url(`/drafts/${encodeURIComponent(draftId)}`),
        {
          method: 'PUT',
          body: JSON.stringify({ id: draftId, message: { raw: buildGmailRawMessage(draft) } }),
        },
      )
      if (response.kind !== 'ok') return response
      const ref = draftRef(response.payload)
      return ref
        ? { kind: 'saved', draft: ref }
        : { kind: 'unknown', reason: 'Gmail replaced the draft but did not return its new message identity' }
    },

    sendDraft: async (draftId: string): Promise<MailboxDraftSend<'gmail'>> => {
      const response = await gmailMutation<GmailMessage>(fetcher, accessToken, url('/drafts/send'), {
        method: 'POST',
        body: JSON.stringify({ id: draftId }),
      })
      if (response.kind !== 'ok') return response
      if (!response.payload.id) {
        return { kind: 'unknown', reason: 'Gmail accepted the send but did not return its message identity' }
      }
      return {
        kind: 'sent',
        provider: 'gmail',
        providerMessageId: response.payload.id,
        threadId: response.payload.threadId ?? null,
      }
    },
  }
}
