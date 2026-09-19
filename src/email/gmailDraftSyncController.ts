// One explicit connected-draft sync attempt. Local saving remains the caller's first boundary;
// this controller compares ancestry before any remote replacement and never retries ambiguity.

import type { MailDraft } from './sender'
import { gmailMailboxDraftClient, gmailMailboxProfile, type GmailMailboxProfile } from './gmailMailbox'
import { gmailAccountHash, type GmailDraftBinding } from './gmailDraftBinding'
import { classifyMailboxDraftSync, mailboxDraftHash } from './mailboxDraftSync'
import type { MailboxDraft, MailboxDraftMutation } from './mailbox'

export type GmailDraftSyncResult =
  | { kind: 'synced'; action: 'created' | 'updated' | 'unchanged'; binding: GmailDraftBinding }
  | { kind: 'remote-newer'; remote: MailboxDraft<'gmail'>; profile: GmailMailboxProfile }
  | { kind: 'conflict'; remote: MailboxDraft<'gmail'>; profile: GmailMailboxProfile }
  | { kind: 'permission-needed' | 'failed' | 'unknown'; reason: string }

function failure(result: Exclude<MailboxDraftMutation<'gmail'>, { kind: 'saved' }>): GmailDraftSyncResult {
  return { kind: result.kind, reason: result.reason }
}

async function bindingFor(input: {
  documentId: string
  profile: GmailMailboxProfile
  remote: { draftId: string; messageId: string; threadId: string | null }
  hash: string
}): Promise<GmailDraftBinding> {
  return {
    v: 1,
    provider: 'gmail',
    documentId: input.documentId,
    accountHash: await gmailAccountHash(input.profile.accountEmail),
    historyId: input.profile.historyId,
    draftId: input.remote.draftId,
    messageId: input.remote.messageId,
    threadId: input.remote.threadId,
    lastSyncedHash: input.hash,
    syncedAt: new Date().toISOString(),
  }
}

export async function syncGmailDraft(input: {
  accessToken: string
  documentId: string
  local: MailDraft
  binding: GmailDraftBinding | null
}): Promise<GmailDraftSyncResult> {
  const client = gmailMailboxDraftClient(input.accessToken)
  let profile: GmailMailboxProfile
  try { profile = await gmailMailboxProfile(input.accessToken) }
  catch (cause) {
    const kind = typeof cause === 'object' && cause && 'kind' in cause
      ? (cause as { kind?: string }).kind
      : undefined
    return {
      kind: kind === 'permission-needed' ? 'permission-needed' : 'failed',
      reason: cause instanceof Error ? cause.message : 'Gmail profile could not be read',
    }
  }
  const localHash = await mailboxDraftHash(input.local)

  if (!input.binding) {
    const created = await client.createDraft(input.local)
    if (created.kind !== 'saved') return failure(created)
    return {
      kind: 'synced',
      action: 'created',
      binding: await bindingFor({
        documentId: input.documentId,
        profile,
        remote: created.draft,
        hash: localHash,
      }),
    }
  }

  let remote: MailboxDraft<'gmail'>
  try { remote = await client.readDraft(input.binding.draftId) }
  catch (cause) {
    const kind = typeof cause === 'object' && cause && 'kind' in cause
      ? (cause as { kind?: string }).kind
      : undefined
    return {
      kind: kind === 'permission-needed' ? 'permission-needed' : 'failed',
      reason: cause instanceof Error ? cause.message : 'The Gmail draft could not be read',
    }
  }
  if (remote.body === null) {
    return { kind: 'failed', reason: 'The Gmail draft has no plain-text body, so Inkwave will not replace it.' }
  }
  const remoteDraft: MailDraft = {
    headers: remote.headers,
    body: remote.body,
    attachments: remote.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  }
  const remoteHash = await mailboxDraftHash(remoteDraft)
  const decision = classifyMailboxDraftSync(input.binding.lastSyncedHash, localHash, remoteHash)
  if (decision === 'preserve-both') return { kind: 'conflict', remote, profile }
  if (decision === 'import-remote') return { kind: 'remote-newer', remote, profile }
  if (decision === 'in-sync') {
    return {
      kind: 'synced',
      action: 'unchanged',
      binding: await bindingFor({ documentId: input.documentId, profile, remote, hash: localHash }),
    }
  }

  const replaced = await client.replaceDraft(input.binding.draftId, input.local)
  if (replaced.kind !== 'saved') return failure(replaced)
  return {
    kind: 'synced',
    action: 'updated',
    binding: await bindingFor({
      documentId: input.documentId,
      profile,
      remote: replaced.draft,
      hash: localHash,
    }),
  }
}
