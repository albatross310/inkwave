// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GMAIL_CONNECTED_MAILBOX_SCOPE,
  _resetGmailMailboxAuthForTests,
  authoriseGmailMailbox,
  connectedGmailMailboxToken,
  disconnectGmailMailbox,
} from './gmailMailboxAuth'
import { GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE } from './gmailMailboxScopes'
import { _resetGmailForTests } from './gmail'

type Config = {
  scope: string
  include_granted_scopes?: boolean
  callback: (response: { access_token?: string; expires_in?: number }) => void
  error_callback?: (error: { type?: string }) => void
}

function installGoogle() {
  let config: Config | undefined
  const requestAccessToken = vi.fn()
  const hasGrantedAllScopes = vi.fn(() => true)
  ;(window as unknown as { google?: unknown }).google = {
    accounts: { oauth2: { hasGrantedAllScopes, initTokenClient: (next: Config) => {
      config = next
      return { requestAccessToken }
    } } },
  }
  return { requestAccessToken, hasGrantedAllScopes, config: () => config! }
}

afterEach(() => {
  _resetGmailMailboxAuthForTests()
  _resetGmailForTests()
  delete (window as unknown as { google?: unknown }).google
})

describe('connected Gmail authorization', () => {
  it('requests exactly readonly + compose only after the caller invokes authorization', async () => {
    const google = installGoogle()
    expect(google.requestAccessToken).not.toHaveBeenCalled()

    const result = authoriseGmailMailbox()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' }))
    expect(google.config().scope).toBe(`${GMAIL_READONLY_SCOPE} ${GMAIL_COMPOSE_SCOPE}`)
    expect(google.config().include_granted_scopes).toBe(true)
    expect(GMAIL_CONNECTED_MAILBOX_SCOPE).not.toMatch(/gmail\.modify|mail\.google\.com/)
    google.config().callback({ access_token: 'mailbox-token', expires_in: 3600 })

    await expect(result).resolves.toBe('mailbox-token')
    expect(google.hasGrantedAllScopes).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'mailbox-token' }),
      GMAIL_READONLY_SCOPE,
      GMAIL_COMPOSE_SCOPE,
    )
    expect(connectedGmailMailboxToken()).toBe('mailbox-token')
  })

  it('does not connect when granular consent omits either required mailbox scope', async () => {
    const google = installGoogle()
    google.hasGrantedAllScopes.mockReturnValue(false)
    const result = authoriseGmailMailbox()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledOnce())
    google.config().callback({ access_token: 'partial-token', expires_in: 3600 })

    await expect(result).resolves.toBeNull()
    expect(connectedGmailMailboxToken()).toBeNull()
  })

  it('disconnect clears the memory-only token without touching Gmail data', async () => {
    const google = installGoogle()
    const result = authoriseGmailMailbox()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledOnce())
    google.config().callback({ access_token: 'temporary', expires_in: 3600 })
    await result

    disconnectGmailMailbox()
    expect(connectedGmailMailboxToken()).toBeNull()
  })
})
