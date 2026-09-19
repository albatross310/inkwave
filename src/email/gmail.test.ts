// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authoriseGmailSend,
  buildGmailRawMessage,
  gmailSender,
  GMAIL_AUTHORISATION_TIMEOUT_MS,
  GMAIL_SEND_SCOPE,
  _resetGmailForTests,
} from './gmail'
import type { MailDraft } from './sender'

const draft = (body = 'Hello, Ada.'): MailDraft => ({
  headers: {
    to: ['Ada Lovelace <ADA@Example.com>'],
    cc: ['charles@example.com'],
    bcc: ['archive@example.com'],
    subject: '  Notes   on λ calculus  ',
  },
  body,
})

function decodeRaw(raw: string): string {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

type GisConfig = {
  include_granted_scopes?: boolean
  callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void
  error_callback?: (error: { type?: string }) => void
}

function installGoogle() {
  let config: GisConfig | undefined
  const requestAccessToken = vi.fn()
  ;(window as unknown as { google?: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (next: GisConfig) => {
          config = next
          return { requestAccessToken }
        },
      },
    },
  }
  return {
    requestAccessToken,
    config: () => {
      if (!config) throw new Error('GIS client was not initialised')
      return config
    },
  }
}

afterEach(() => {
  _resetGmailForTests()
  delete (window as unknown as { google?: unknown }).google
  vi.useRealTimers()
})

describe('Gmail send boundary', () => {
  it('declares exactly the send-only OAuth scope', () => {
    expect(GMAIL_SEND_SCOPE).toBe('https://www.googleapis.com/auth/gmail.send')
    expect(GMAIL_SEND_SCOPE).not.toMatch(/readonly|modify|mail\.google/)
  })

  it('builds canonical recipients and UTF-8 text without losing Bcc', () => {
    const mime = decodeRaw(buildGmailRawMessage(draft('Line one\nλ line two')))
    expect(mime).toContain('To: Ada Lovelace <ada@example.com>\r\n')
    expect(mime).toContain('Cc: charles@example.com\r\n')
    expect(mime).toContain('Bcc: archive@example.com\r\n')
    expect(mime).toContain('Subject: Notes on λ calculus\r\n')
    expect(mime).toContain('\r\n\r\nLine one\r\nλ line two')
  })

  it('handles a long Unicode body without argument-stack truncation', () => {
    const body = 'writing 🌊\n'.repeat(20_000)
    expect(decodeRaw(buildGmailRawMessage(draft(body)))).toContain(body.replace(/\n/g, '\r\n'))
  })

  it('carries the formatted body as HTML with a plain-text fallback', () => {
    const mime = decodeRaw(buildGmailRawMessage({
      ...draft('Hello Ada'),
      html: '<p>Hello <strong>Ada</strong></p>',
    }))
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="inkwave-alternative-boundary"')
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHello Ada')
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n<p>Hello <strong>Ada</strong></p>')
  })

  it('builds a multipart Gmail message with verified attachment bytes', () => {
    const mime = decodeRaw(buildGmailRawMessage({
      ...draft('Attached.'),
      attachments: [{
        filename: 'résumé.pdf',
        mimeType: 'application/pdf',
        size: 5,
        bytes: Uint8Array.from([0, 1, 2, 3, 4]),
      }],
    }))
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="inkwave-mixed-boundary"')
    expect(mime).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")
    expect(mime).toContain('Content-Transfer-Encoding: base64\r\n\r\nAAECAwQ=')
    expect(mime).toContain('--inkwave-mixed-boundary--')
  })

  it('nests formatted text and attachments in standards-shaped MIME boundaries', () => {
    const mime = decodeRaw(buildGmailRawMessage({
      ...draft('Body'),
      html: '<p><em>Body</em></p>',
      attachments: [{ filename: 'note.txt', mimeType: 'text/plain', size: 2, bytes: Uint8Array.of(72, 105) }],
    }))
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="inkwave-mixed-boundary"')
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="inkwave-alternative-boundary"')
    expect(mime).toContain('<p><em>Body</em></p>')
    expect(mime).toContain('Content-Disposition: attachment; filename="note.txt"')
    expect(mime).toContain('\r\n\r\nSGk=')
  })

  it('refuses attachment metadata without the complete local bytes', () => {
    expect(() => buildGmailRawMessage({
      ...draft(),
      attachments: [{ filename: 'missing.pdf', mimeType: 'application/pdf', size: 10 }],
    })).toThrow(/not fully loaded.*Nothing was sent/i)
  })

  it('POSTs the raw message directly to Gmail and reports a real sent outcome', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'gmail-123', threadId: 'thread-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const outcome = await gmailSender('short-lived-token', fetcher).send(draft())
    expect(outcome).toEqual({ kind: 'sent', providerMessageId: 'gmail-123' })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(init.headers.Authorization).toBe('Bearer short-lived-token')
    expect(JSON.parse(init.body).raw).toBe(buildGmailRawMessage(draft()))
  })

  it('surfaces Gmail failures without claiming the message was sent', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Gmail API is disabled' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }))
    await expect(gmailSender('token', fetcher).send(draft())).resolves.toEqual({
      kind: 'failed', reason: 'Gmail API is disabled',
    })
  })

  it('reports an unknown outcome when Gmail may have accepted the request before the response was lost', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network connection closed'))
    const outcome = await gmailSender('token', fetcher).send(draft())
    expect(outcome.kind).toBe('unknown')
    expect(outcome.reason).toMatch(/network connection closed/i)
    expect(outcome.providerMessageId).toBeUndefined()
  })
})

describe('Gmail authorization boundary', () => {
  it('returns the short-lived token from Google', async () => {
    const google = installGoogle()
    const result = authoriseGmailSend()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' }))
    google.config().callback({ access_token: 'short-lived', expires_in: 3600 })
    await expect(result).resolves.toBe('short-lived')
  })

  it('reports a blocked popup instead of waiting forever', async () => {
    const google = installGoogle()
    const result = authoriseGmailSend()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledOnce())
    google.config().error_callback?.({ type: 'popup_failed_to_open' })
    await expect(result).rejects.toThrow(/blocked.*Allow pop-ups/i)
  })

  it('reports a popup the writer closed', async () => {
    const google = installGoogle()
    const result = authoriseGmailSend()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledOnce())
    google.config().error_callback?.({ type: 'popup_closed' })
    await expect(result).rejects.toThrow(/window was closed.*not sent/i)
  })

  it('times out when a browser host never returns a callback', async () => {
    vi.useFakeTimers()
    const google = installGoogle()
    const result = authoriseGmailSend()
    const rejection = expect(result).rejects.toThrow(/timed out.*not sent/i)
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(GMAIL_AUTHORISATION_TIMEOUT_MS)
    await rejection
  })
})
