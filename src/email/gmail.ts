// Gmail API sender (§B3) — browser-only, send-only, and zero-retention.
//
// Google Identity Services issues a short-lived access token directly to this browser. Inkwave
// keeps it only in memory and sends the RFC 5322 message straight from the writer's device to
// Gmail. No token or message crosses an Inkwave server. The sole OAuth scope is gmail.send: this
// module cannot list, read, modify, or delete mail.

import type { MailDraft, MailSender, SendOutcome } from './sender'
import { normaliseHeaders } from './headers'

const CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

export type GoogleTokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
export type GooglePopupError = { type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string }
export type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
}
export type GoogleIdentityServices = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string
        scope: string
        include_granted_scopes?: boolean
        callback: (response: GoogleTokenResponse) => void
        error_callback?: (error: GooglePopupError) => void
      }) => GoogleTokenClient
      hasGrantedAllScopes?: (response: GoogleTokenResponse, ...scopes: string[]) => boolean
    }
  }
}

/** Last-resort guard for browser hosts that never deliver Google's popup-close callback. */
export const GMAIL_AUTHORISATION_TIMEOUT_MS = 120_000

let gisLoad: Promise<void> | null = null
let tokenClient: GoogleTokenClient | null = null
let cached: { token: string; expiry: number } | null = null
let tokenResponse: ((response: GoogleTokenResponse) => void) | null = null
let popupError: ((error: GooglePopupError) => void) | null = null

export function gmailConfigured(): boolean {
  return !!CLIENT_ID
}

/** OAuth client IDs are public browser configuration, not credentials. Shared by the separately
 * consented mailbox token client without coupling its scope/cache to send-only. */
export function gmailClientId(): string | undefined { return CLIENT_ID }

export function loadGis(): Promise<void> {
  if (gisLoad) return gisLoad
  gisLoad = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: GoogleIdentityServices }).google?.accounts?.oauth2) return resolve()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisLoad = null
      reject(new Error('Google sign-in could not load'))
    }
    document.head.appendChild(script)
  })
  return gisLoad
}

async function ensureClient(): Promise<GoogleTokenClient> {
  if (!CLIENT_ID) throw new Error('Gmail sending is not configured')
  await loadGis()
  if (!tokenClient) {
    const gis = (window as unknown as { google: GoogleIdentityServices }).google
    tokenClient = gis.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: GMAIL_SEND_SCOPE,
      include_granted_scopes: true,
      // The GIS client is created once. Route its callbacks to the currently active request rather
      // than mutating undocumented properties on the returned TokenClient object.
      callback: (response) => tokenResponse?.(response),
      error_callback: (error) => popupError?.(error),
    })
  }
  return tokenClient
}

/** Load GIS before the Send click so mobile browsers preserve the click for Google's popup. */
export function preloadGmail(): void {
  if (!CLIENT_ID) return
  void ensureClient().catch(() => { /* the click path retries and reports the failure */ })
}

/** Request only gmail.send. The token is short-lived and never persisted. */
export async function authoriseGmailSend(): Promise<string | null> {
  if (cached && cached.expiry > Date.now() + 60_000) return cached.token
  const client = await ensureClient()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: { token?: string | null; error?: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      tokenResponse = null
      popupError = null
      if (result.error) reject(result.error)
      else resolve(result.token ?? null)
    }
    const timeout = setTimeout(() => finish({
      error: new Error('Google authorization timed out. Close any Google window and try again; your draft was not sent.'),
    }), GMAIL_AUTHORISATION_TIMEOUT_MS)

    tokenResponse = (response) => {
      if (!response.access_token) return finish({ token: null })
      cached = {
        token: response.access_token,
        expiry: Date.now() + (response.expires_in ?? 3600) * 1000,
      }
      finish({ token: response.access_token })
    }
    popupError = (error) => {
      if (error.type === 'popup_failed_to_open') {
        finish({ error: new Error('Google’s authorization window was blocked. Allow pop-ups for Inkwave, then try again; your draft was not sent.') })
      } else if (error.type === 'popup_closed') {
        finish({ error: new Error('Google’s authorization window was closed. Your draft was not sent.') })
      } else {
        finish({ error: new Error('Google authorization could not start. Your draft was not sent.') })
      }
    }
    try {
      client.requestAccessToken({ prompt: 'select_account' })
    } catch {
      finish({ error: new Error('Google’s authorization window could not open. Allow pop-ups for Inkwave, then try again; your draft was not sent.') })
    }
  })
}

function utf8Base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  // Avoid a spread over a large draft: it can overflow the JS argument stack.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function crlf(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n')
}

function bytesBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '')
}

function safeMimeType(value: string): string {
  return /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(value) ? value : 'application/octet-stream'
}

function attachmentFilenameHeaders(filename: string): { fallback: string; encoded: string } {
  const clean = filename.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'attachment'
  return {
    fallback: clean.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_').slice(0, 120) || 'attachment',
    encoded: encodeURIComponent(clean).replace(/'/g, '%27'),
  }
}

function boundaryFor(base: string, draft: MailDraft): string {
  let boundary = base
  while (draft.body.includes(boundary) || draft.html?.includes(boundary)) boundary += '-x'
  return boundary
}

function plainPart(draft: MailDraft): string[] {
  return [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    crlf(draft.body),
  ]
}

function alternativeBody(draft: MailDraft, boundary: string): string[] {
  return [
    `--${boundary}`,
    ...plainPart(draft),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    crlf(draft.html ?? ''),
    `--${boundary}--`,
  ]
}

/** Build the exact UTF-8 RFC 5322 message submitted to Gmail. Exported for boundary tests. */
export function buildGmailRawMessage(draft: MailDraft): string {
  const headers = normaliseHeaders(draft.headers)
  const headerLines = [
    `To: ${headers.to.join(', ')}`,
    ...(headers.cc.length ? [`Cc: ${headers.cc.join(', ')}`] : []),
    ...(headers.bcc.length ? [`Bcc: ${headers.bcc.join(', ')}`] : []),
    `Subject: ${headers.subject}`,
    'MIME-Version: 1.0',
  ]
  const attachments = draft.attachments ?? []
  if (!attachments.length && !draft.html) {
    return utf8Base64Url([...headerLines,
      ...plainPart(draft),
    ].join('\r\n'))
  }

  if (!attachments.length) {
    const alternative = boundaryFor('inkwave-alternative-boundary', draft)
    return utf8Base64Url([
      ...headerLines,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      '',
      ...alternativeBody(draft, alternative),
      '',
    ].join('\r\n'))
  }

  const boundary = boundaryFor('inkwave-mixed-boundary', draft)
  const lines = [
    ...headerLines,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
  ]
  if (draft.html) {
    const alternative = boundaryFor('inkwave-alternative-boundary', draft)
    lines.push(
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      '',
      ...alternativeBody(draft, alternative),
    )
  } else lines.push(...plainPart(draft))
  for (const attachment of attachments) {
    if (!attachment.bytes || attachment.bytes.byteLength !== attachment.size) {
      throw new Error(`“${attachment.filename}” was not fully loaded. Nothing was sent.`)
    }
    const filename = attachmentFilenameHeaders(attachment.filename)
    lines.push(
      `--${boundary}`,
      `Content-Type: ${safeMimeType(attachment.mimeType)}; name="${filename.fallback}"`,
      `Content-Disposition: attachment; filename="${filename.fallback}"; filename*=UTF-8''${filename.encoded}`,
      'Content-Transfer-Encoding: base64',
      '',
      bytesBase64(attachment.bytes),
    )
  }
  lines.push(`--${boundary}--`, '')
  return utf8Base64Url(lines.join('\r\n'))
}

type FetchLike = typeof fetch

export function gmailSender(accessToken: string, fetcher: FetchLike = fetch): MailSender {
  return {
    id: 'gmail-api',
    label: 'Gmail',
    canCarry: () => ({ ok: true }),
    send: async (draft): Promise<SendOutcome> => {
      try {
        const response = await fetcher(SEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: buildGmailRawMessage(draft) }),
        })
        const payload = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } }
        if (!response.ok || !payload.id) {
          if (response.status === 401) cached = null
          return { kind: 'failed', reason: payload.error?.message ?? `Gmail rejected the message (${response.status})` }
        }
        return { kind: 'sent', providerMessageId: payload.id }
      } catch (error) {
        // Fetch can reject before Gmail receives the request OR after Gmail accepts it but before
        // the response reaches this browser. Send-only permission cannot reconcile those cases.
        // Calling this "failed" invites a duplicate retry, so preserve the uncertainty honestly.
        return {
          kind: 'unknown',
          reason: error instanceof Error ? error.message : 'Gmail did not return a final response',
        }
      }
    },
  }
}

export function _resetGmailForTests(): void {
  gisLoad = null
  tokenClient = null
  cached = null
  tokenResponse = null
  popupError = null
}
