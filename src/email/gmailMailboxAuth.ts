// Optional connected-Gmail authorization. This is deliberately independent of gmail.ts's
// send-only token client: a cached gmail.send grant must never be mistaken for mailbox access, and
// an existing send-only user must never be silently upgraded.

import {
  GMAIL_CONNECTED_MAILBOX_SCOPES,
} from './gmailMailboxScopes'
import {
  GMAIL_AUTHORISATION_TIMEOUT_MS,
  gmailClientId,
  loadGis,
  type GoogleIdentityServices,
  type GooglePopupError,
  type GoogleTokenClient,
  type GoogleTokenResponse,
} from './gmail'

export const GMAIL_CONNECTED_MAILBOX_SCOPE = GMAIL_CONNECTED_MAILBOX_SCOPES.join(' ')

let client: GoogleTokenClient | null = null
let cached: { token: string; expiry: number } | null = null
let tokenResponse: ((response: GoogleTokenResponse) => void) | null = null
let popupError: ((error: GooglePopupError) => void) | null = null

async function ensureMailboxClient(): Promise<GoogleTokenClient> {
  const clientId = gmailClientId()
  if (!clientId) throw new Error('Gmail mailbox access is not configured')
  await loadGis()
  if (!client) {
    const gis = (window as unknown as { google: GoogleIdentityServices }).google
    client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_CONNECTED_MAILBOX_SCOPE,
      include_granted_scopes: true,
      callback: (response) => tokenResponse?.(response),
      error_callback: (error) => popupError?.(error),
    })
  }
  return client
}

/** Called only by the consent dialog's explicit “Continue to Google” action. */
export async function authoriseGmailMailbox(): Promise<string | null> {
  if (cached && cached.expiry > Date.now() + 60_000) return cached.token
  const tokenClient = await ensureMailboxClient()
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
      error: new Error('Google mailbox authorization timed out. Close any Google window and try again.'),
    }), GMAIL_AUTHORISATION_TIMEOUT_MS)
    tokenResponse = (response) => {
      if (!response.access_token) return finish({ token: null })
      const oauth = (window as unknown as { google: GoogleIdentityServices }).google.accounts.oauth2
      if (typeof oauth.hasGrantedAllScopes === 'function'
        && !oauth.hasGrantedAllScopes(response, ...GMAIL_CONNECTED_MAILBOX_SCOPES)) {
        return finish({ token: null })
      }
      cached = {
        token: response.access_token,
        expiry: Date.now() + (response.expires_in ?? 3600) * 1000,
      }
      finish({ token: response.access_token })
    }
    popupError = (error) => {
      if (error.type === 'popup_failed_to_open') {
        finish({ error: new Error('Google’s authorization window was blocked. Allow pop-ups for Inkwave, then try again.') })
      } else if (error.type === 'popup_closed') {
        finish({ error: new Error('Google’s authorization window was closed. The mailbox remains disconnected.') })
      } else {
        finish({ error: new Error('Google mailbox authorization could not start.') })
      }
    }
    try {
      tokenClient.requestAccessToken({ prompt: 'select_account' })
    } catch {
      finish({ error: new Error('Google’s authorization window could not open. Allow pop-ups for Inkwave, then try again.') })
    }
  })
}

/** Memory only. A document switch may remount the editor, so the token lives at module scope. */
export function connectedGmailMailboxToken(): string | null {
  if (!cached || cached.expiry <= Date.now() + 60_000) return null
  return cached.token
}

export function disconnectGmailMailbox(): void {
  cached = null
  tokenResponse = null
  popupError = null
}

export function _resetGmailMailboxAuthForTests(): void {
  client = null
  disconnectGmailMailbox()
}
