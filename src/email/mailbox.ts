// Connected-mailbox seam (Productivity + Email v0.2, §B3.1–B3.3).
//
// A mailbox is a provider VIEW, not an Inkwave document. Listing or reading one of these rows must
// therefore remain incapable of creating a document, snapshot, ledger session, or sync membership.
// Provider adapters return inert data; a later, explicit "Save to Inkwave" action will own the
// conversion into an ordinary document.

import type { EmailHeaders } from '../types/document'
import type { MailDraft } from './sender'

export type MailboxView = 'inbox' | 'promotions' | 'spam' | 'sent'

/** `unknown` is honest while the lightweight metadata request has not fetched MIME structure. */
export type AttachmentPresence = 'present' | 'absent' | 'unknown'

export interface MailboxThreadRow<Provider extends string = string> {
  provider: Provider
  threadId: string
  subject: string
  correspondent: string
  snippet: string
  activityAt: string | null
  unread: boolean
  attachments: AttachmentPresence
  messageCount: number
}

export interface MailboxIndexPage<Provider extends string = string> {
  provider: Provider
  view: MailboxView
  /** Memory-only display identity. A future persisted index must hash this before writing it. */
  accountEmail: string
  /** Gmail's mailbox-wide high-water mark, used by the later foreground history synchroniser. */
  historyId: string
  rows: MailboxThreadRow<Provider>[]
  nextPageToken?: string
  resultSizeEstimate: number
}

export interface MailboxAttachment {
  providerAttachmentId: string
  filename: string
  mimeType: string
  size: number
}

export interface MailboxAttachmentContent extends MailboxAttachment {
  /** Bytes exist only for this deliberate open/download action and are never indexed or stored. */
  bytes: Uint8Array
}

export interface MailboxMessage {
  providerMessageId: string
  threadId: string
  from: string
  to: string
  cc: string
  subject: string
  sentAt: string | null
  unread: boolean
  /** Plain text only. HTML remains inert until the isolated sanitised renderer exists. */
  plainText: string | null
  htmlAvailable: boolean
  attachments: MailboxAttachment[]
}

export interface MailboxThread<Provider extends string = string> {
  provider: Provider
  threadId: string
  historyId: string
  messages: MailboxMessage[]
}

export interface MailboxReader<Provider extends string = string> {
  list(view: MailboxView, options?: { pageToken?: string; maxResults?: number }): Promise<MailboxIndexPage<Provider>>
  /** Full content is fetched only for the thread the writer deliberately opens. */
  readThread(threadId: string): Promise<MailboxThread<Provider>>
  /** Attachment bytes cross the network only after the writer activates that attachment. */
  readAttachment(messageId: string, attachment: MailboxAttachment): Promise<MailboxAttachmentContent>
  /** Cheap foreground high-water check; callers rebuild rather than guessing across expiry. */
  changedSince(historyId: string): Promise<{ historyId: string; changed: boolean; expired: boolean }>
}

/** Gmail keeps this identity stable while replacing `messageId` on every draft update. */
export interface MailboxDraftRef<Provider extends string = string> {
  provider: Provider
  draftId: string
  messageId: string
  threadId: string | null
}

export interface MailboxDraftRow<Provider extends string = string> extends MailboxDraftRef<Provider> {
  subject: string
  recipients: string
  snippet: string
  updatedAt: string | null
  attachments: AttachmentPresence
}

export interface MailboxDraftIndexPage<Provider extends string = string> {
  provider: Provider
  accountEmail: string
  historyId: string
  rows: MailboxDraftRow<Provider>[]
  nextPageToken?: string
  resultSizeEstimate: number
}

export interface MailboxDraft<Provider extends string = string> extends MailboxDraftRef<Provider> {
  headers: EmailHeaders
  /** Null means Gmail supplied HTML-only content; callers must not invent editable plain text. */
  body: string | null
  htmlAvailable: boolean
  attachments: MailboxAttachment[]
}

export type MailboxDraftMutation<Provider extends string = string> =
  | { kind: 'saved'; draft: MailboxDraftRef<Provider> }
  | { kind: 'permission-needed' | 'failed' | 'unknown'; reason: string }

export type MailboxDraftSend<Provider extends string = string> =
  | { kind: 'sent'; provider: Provider; providerMessageId: string; threadId: string | null }
  | { kind: 'permission-needed' | 'failed' | 'unknown'; reason: string }

/** Provider-neutral draft API. It receives a token; it never authorises or persists one. */
export interface MailboxDraftClient<Provider extends string = string> {
  listDrafts(options?: { pageToken?: string; maxResults?: number }): Promise<MailboxDraftIndexPage<Provider>>
  readDraft(draftId: string): Promise<MailboxDraft<Provider>>
  createDraft(draft: MailDraft): Promise<MailboxDraftMutation<Provider>>
  /** Replacement preserves draftId but providers may replace messageId. */
  replaceDraft(draftId: string, draft: MailDraft): Promise<MailboxDraftMutation<Provider>>
  sendDraft(draftId: string): Promise<MailboxDraftSend<Provider>>
}

export type MailboxFailureKind = 'permission-needed' | 'failed'

export class MailboxReadError extends Error {
  constructor(
    public readonly kind: MailboxFailureKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'MailboxReadError'
  }
}
