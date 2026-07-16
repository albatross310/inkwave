import { describe, it, expect } from 'vitest'
import {
  parseAddressList, looksLikeAddress, extractAddress, canonicaliseAddress,
  normaliseHeaders, hasRecipient, suspectAddresses,
} from './headers'

describe('parseAddressList', () => {
  it('splits on commas and semicolons and trims', () => {
    expect(parseAddressList('a@x.com, b@y.com; c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
  })
  it('drops empties from trailing separators', () => {
    expect(parseAddressList('a@x.com,,; ')).toEqual(['a@x.com'])
  })
  it('preserves display-name forms verbatim', () => {
    expect(parseAddressList('Ada Lovelace <ada@x.com>, b@y.com'))
      .toEqual(['Ada Lovelace <ada@x.com>', 'b@y.com'])
  })
  it('is empty for empty input', () => {
    expect(parseAddressList('   ')).toEqual([])
  })
})

describe('extractAddress', () => {
  it('unwraps angle brackets', () => {
    expect(extractAddress('Ada Lovelace <ada@x.com>')).toBe('ada@x.com')
  })
  it('returns a bare address unchanged', () => {
    expect(extractAddress('ada@x.com')).toBe('ada@x.com')
  })
})

describe('looksLikeAddress', () => {
  it('accepts ordinary and wrapped addresses', () => {
    expect(looksLikeAddress('ada@example.com')).toBe(true)
    expect(looksLikeAddress('Ada <ada@example.co.uk>')).toBe(true)
    expect(looksLikeAddress('a.b+tag@sub.example.com')).toBe(true)
  })
  it('rejects things with no domain or no @', () => {
    expect(looksLikeAddress('ada')).toBe(false)
    expect(looksLikeAddress('ada@localhost')).toBe(false)
    expect(looksLikeAddress('ada @ example.com')).toBe(false)
  })
})

// ─── Canonicalisation — the hashed form ──────────────────────────────────────
// These are provenance-boundary tests: the canonical form decides what an anchored header hash
// MEANS. A change that breaks one of these changes the meaning of every past email anchor.

describe('canonicaliseAddress', () => {
  it('lowercases a bare address', () => {
    expect(canonicaliseAddress('  Ada@Example.COM ')).toBe('ada@example.com')
  })
  it('lowercases the address but keeps the display name', () => {
    expect(canonicaliseAddress('Ada Lovelace <Ada@Example.COM>')).toBe('Ada Lovelace <ada@example.com>')
  })
  it('collapses whitespace in the display name', () => {
    expect(canonicaliseAddress('Ada    Lovelace <a@x.com>')).toBe('Ada Lovelace <a@x.com>')
  })
  it('unwraps a bracketed address with no display name', () => {
    expect(canonicaliseAddress('<A@X.com>')).toBe('a@x.com')
  })
})

describe('normaliseHeaders', () => {
  it('canonicalises every list and the subject', () => {
    expect(normaliseHeaders({
      to: [' Ada@X.com '], cc: ['B@Y.com'], bcc: undefined, subject: '  Re:   the   draft  ',
    })).toEqual({ to: ['ada@x.com'], cc: ['b@y.com'], bcc: [], subject: 'Re: the draft' })
  })

  it('de-duplicates addresses that differ only in case/whitespace', () => {
    expect(normaliseHeaders({ to: ['a@x.com', 'A@X.COM', ' a@x.com '], subject: 's' }).to)
      .toEqual(['a@x.com'])
  })

  it('preserves recipient ORDER (it is part of what was committed to)', () => {
    expect(normaliseHeaders({ to: ['c@x.com', 'a@x.com', 'b@x.com'], subject: 's' }).to)
      .toEqual(['c@x.com', 'a@x.com', 'b@x.com'])
  })

  it('is IDEMPOTENT — canonicalising a canonical form changes nothing', () => {
    const once = normaliseHeaders({ to: [' Ada <A@X.com> '], cc: ['B@y.com'], subject: ' hi  there ' })
    expect(normaliseHeaders(once)).toEqual(once)
  })

  it('turns absent cc/bcc into empty arrays, so one header set has one shape', () => {
    const a = normaliseHeaders({ to: ['a@x.com'], subject: 's' })
    const b = normaliseHeaders({ to: ['a@x.com'], cc: [], bcc: [], subject: 's' })
    expect(a).toEqual(b)
  })
})

describe('hasRecipient / suspectAddresses', () => {
  it('needs at least one real recipient', () => {
    expect(hasRecipient({ to: [], subject: 's' })).toBe(false)
    expect(hasRecipient({ to: ['  '], subject: 's' })).toBe(false)
    expect(hasRecipient({ to: ['a@x.com'], subject: 's' })).toBe(true)
  })
  it('reports only the addresses it could not recognise', () => {
    expect(suspectAddresses({ to: ['a@x.com', 'nonsense'], cc: ['b@y.com'], subject: 's' }))
      .toEqual(['nonsense'])
  })
})
