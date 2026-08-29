// The rules the extension's fetch obeys, exercised where a test can reach them.
//
// The fetch itself lives in extension-src/entrypoints/background.ts, which vitest does not include
// and cannot load. That is exactly why these decisions were pulled OUT of it: an unreachable rule
// is one nobody notices breaking. What remains in the worker is a single `fetch` call.

import { describe, it, expect } from 'vitest'
import { assertFetchable, charsetOf, decodeHtml, isHtmlContentType, READER_ACCEPT } from './fetchRules'

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('assertFetchable — what the extension will not even attempt', () => {
  it('accepts ordinary web addresses', () => {
    expect(assertFetchable('https://plato.stanford.edu/entries/identity/').host).toBe('plato.stanford.edu')
    expect(assertFetchable('http://example.org/a?b=c#d').protocol).toBe('http:')
  })

  it('refuses schemes that are not the web', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd',
      'chrome-extension://abc/page.html', 'about:blank', 'not a url']) {
      expect(() => assertFetchable(bad), bad).toThrow('bad url')
    }
  })

  it('refuses credentials embedded in the URL — never ours to forward', () => {
    expect(() => assertFetchable('https://user:pw@example.org/')).toThrow('bad url')
  })

  it('DELIBERATELY allows private addresses, unlike the server core', () => {
    // Not an oversight, and the difference is the point: the SERVER sits in a privileged network
    // where 169.254.169.254 is a cloud metadata endpoint. The extension sits in the writer's own
    // browser, where 127.0.0.1 is the docs server they are reading — and typing that address into
    // the URL bar already fetches it. If this ever starts throwing, someone has copied a guard
    // across a boundary where its reason does not hold.
    expect(assertFetchable('http://127.0.0.1:8080/docs').hostname).toBe('127.0.0.1')
    expect(assertFetchable('http://192.168.1.1/').hostname).toBe('192.168.1.1')
  })
})

describe('decodeHtml — the two refusals that can only happen after the body arrives', () => {
  it('decodes a page', () => {
    expect(decodeHtml(bytes('<p>café</p>'), 'text/html; charset=utf-8')).toBe('<p>café</p>')
  })

  it('refuses what is not a page rather than extracting nothing from it', () => {
    expect(() => decodeHtml(bytes('%PDF-1.7'), 'application/pdf')).toThrow('not html')
    expect(() => decodeHtml(bytes('{}'), 'application/json')).toThrow('not html')
    expect(() => decodeHtml(bytes('x'), null)).toThrow('not html')
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true)
  })

  it('caps by MEASURING the body, not by trusting a header', () => {
    const big = '<html>' + 'x'.repeat(500)
    expect(() => decodeHtml(bytes(big), 'text/html', 100)).toThrow('too large')
    // KNOWN-POSITIVE: the same call under the cap must succeed, or "too large" would be proving
    // only that decodeHtml throws on everything.
    expect(decodeHtml(bytes(big), 'text/html', 10_000)).toBe(big)
  })

  it('falls back to utf-8 when the server names a charset the browser has never heard of', () => {
    expect(charsetOf('text/html; charset=windows-1252')).toBe('windows-1252')
    expect(charsetOf('text/html')).toBe('utf-8')
    expect(decodeHtml(bytes('<p>ok</p>'), 'text/html; charset=x-made-up')).toBe('<p>ok</p>')
  })
})

describe('the request must look like a person', () => {
  it('offers an Accept and nothing that would override the browser’s own identity', () => {
    // The measured reason the whole feature exists: a datacenter-shaped request is refused by every
    // search engine tried. Naming a user-agent here would hand that back. If a `user-agent` key
    // ever appears in the extension's fetch headers, this is the note it contradicts.
    expect(READER_ACCEPT).toContain('text/html')
    expect(READER_ACCEPT.toLowerCase()).not.toContain('inkwave')
  })
})
