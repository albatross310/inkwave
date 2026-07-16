import { describe, it, expect, vi } from 'vitest'
import {
  buildGmailUrl, buildOutlookUrl, buildMailto, urlFor, fits, handoffSender,
  MAILTO_MAX, WEB_COMPOSE_MAX, type MailDraft,
} from './sender'

const draft = (over: Partial<MailDraft> = {}): MailDraft => ({
  headers: { to: ['ada@x.com'], subject: 'Hello', ...over.headers },
  body: over.body ?? 'Dear Ada,\n\nRegards',
})

describe('buildGmailUrl', () => {
  it('pre-fills to/subject/body on the compose deep-link', () => {
    const u = new URL(buildGmailUrl(draft()))
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/')
    expect(u.searchParams.get('view')).toBe('cm')
    expect(u.searchParams.get('to')).toBe('ada@x.com')
    expect(u.searchParams.get('su')).toBe('Hello')
    expect(u.searchParams.get('body')).toBe('Dear Ada,\n\nRegards')
  })

  it('joins multiple recipients and includes cc/bcc only when present', () => {
    const u = new URL(buildGmailUrl(draft({ headers: { to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], subject: 'S' } })))
    expect(u.searchParams.get('to')).toBe('a@x.com,b@x.com')
    expect(u.searchParams.get('cc')).toBe('c@x.com')
    expect(u.searchParams.has('bcc')).toBe(false)
  })

  it('canonicalises the headers it sends (same rule as the hash)', () => {
    const u = new URL(buildGmailUrl(draft({ headers: { to: [' Ada@X.COM '], subject: '  S  ' } })))
    expect(u.searchParams.get('to')).toBe('ada@x.com')
    expect(u.searchParams.get('su')).toBe('S')
  })

  it('escapes characters that would otherwise break out of the query', () => {
    const u = new URL(buildGmailUrl(draft({ body: 'a&b=c #d' })))
    expect(u.searchParams.get('body')).toBe('a&b=c #d')
  })
})

describe('buildOutlookUrl', () => {
  it('uses the deeplink compose endpoint with subject/body', () => {
    const u = new URL(buildOutlookUrl(draft()))
    expect(u.origin + u.pathname).toBe('https://outlook.office.com/mail/deeplink/compose')
    expect(u.searchParams.get('to')).toBe('ada@x.com')
    expect(u.searchParams.get('subject')).toBe('Hello')
  })
})

describe('buildMailto', () => {
  it('puts recipients in the path and the rest in the query', () => {
    const url = buildMailto(draft())
    expect(url.startsWith('mailto:ada%40x.com?')).toBe(true)
    const q = new URLSearchParams(url.split('?')[1])
    expect(q.get('subject')).toBe('Hello')
    expect(q.get('body')).toBe('Dear Ada,\n\nRegards')
  })

  it('keeps comma separators between encoded recipients', () => {
    expect(buildMailto(draft({ headers: { to: ['a@x.com', 'b@x.com'], subject: '' } })))
      .toContain('mailto:a%40x.com,b%40x.com')
  })

  it('omits the ? entirely when there is nothing to add', () => {
    expect(buildMailto({ headers: { to: ['a@x.com'], subject: '' }, body: '' })).toBe('mailto:a%40x.com')
  })
})

describe('fits — the length limits are real, and refusal beats truncation', () => {
  it('an ordinary draft fits every sender', () => {
    for (const id of ['gmail-handoff', 'outlook-handoff', 'mailto'] as const) {
      expect(fits(id, draft()).ok).toBe(true)
    }
  })

  it('FAILS a mailto draft over the limit — and the negative genuinely fires', () => {
    const big = draft({ body: 'x'.repeat(MAILTO_MAX + 500) })
    const f = fits('mailto', big)
    expect(f.ok).toBe(false)
    expect(f.length).toBeGreaterThan(MAILTO_MAX)
    expect(f.reason).toMatch(/too long/i)
  })

  it('a draft between the two limits fits web compose but NOT mailto', () => {
    const mid = draft({ body: 'x'.repeat(MAILTO_MAX + 500) })
    expect(fits('mailto', mid).ok).toBe(false)
    expect(fits('gmail-handoff', mid).ok).toBe(true)
  })

  it('FAILS a web-compose draft over its own larger limit', () => {
    const huge = draft({ body: 'x'.repeat(WEB_COMPOSE_MAX + 500) })
    expect(fits('gmail-handoff', huge).ok).toBe(false)
  })

  it('measures the ENCODED url, not the raw body (a newline is 3 chars encoded)', () => {
    const plain = fits('mailto', draft({ body: 'a'.repeat(300) })).length
    const encoded = fits('mailto', draft({ body: '\n'.repeat(300) })).length
    expect(encoded).toBeGreaterThan(plain)
  })
})

describe('handoffSender', () => {
  it('opens the provider url and reports handed-off — never "sent"', async () => {
    const open = vi.fn()
    const s = handoffSender('gmail-handoff', 'Gmail', open)
    const out = await s.send(draft())
    expect(out.kind).toBe('handed-off')
    expect(open).toHaveBeenCalledWith(urlFor('gmail-handoff', draft()))
  })

  it('refuses an over-long draft WITHOUT opening anything', async () => {
    const open = vi.fn()
    const s = handoffSender('mailto', 'Mail app', open)
    const out = await s.send(draft({ body: 'x'.repeat(MAILTO_MAX + 500) }))
    expect(out.kind).toBe('failed')
    expect(open).not.toHaveBeenCalled()
  })

  it('reports failure rather than throwing when the window cannot open', async () => {
    const s = handoffSender('gmail-handoff', 'Gmail', () => { throw new Error('popup blocked') })
    const out = await s.send(draft())
    expect(out.kind).toBe('failed')
    expect(out.reason).toBe('popup blocked')
  })

  it('canCarry agrees with fits', () => {
    const s = handoffSender('mailto', 'Mail app', () => {})
    expect(s.canCarry(draft()).ok).toBe(true)
    expect(s.canCarry(draft({ body: 'x'.repeat(MAILTO_MAX + 500) })).ok).toBe(false)
  })
})
