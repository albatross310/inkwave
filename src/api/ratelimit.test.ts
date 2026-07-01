// Client IP extraction — pure, no side effects. Import via the api/ path (vitest resolves it).
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { clientIp } from '../../api/_ratelimit.mjs'

type Req = { headers?: Record<string, string | undefined> }

describe('clientIp', () => {
  it('prefers x-forwarded-for (first IP in a list)', () => {
    const req: Req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }
    expect(clientIp(req)).toBe('1.2.3.4')
  })

  it('trims whitespace around the extracted IP', () => {
    const req: Req = { headers: { 'x-forwarded-for': '  9.10.11.12 ' } }
    expect(clientIp(req)).toBe('9.10.11.12')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req: Req = { headers: { 'x-real-ip': '2.3.4.5' } }
    expect(clientIp(req)).toBe('2.3.4.5')
  })

  it('returns "unknown" when no IP headers are present', () => {
    expect(clientIp({ headers: {} })).toBe('unknown')
  })

  it('returns "unknown" for null/undefined request', () => {
    expect(clientIp(null)).toBe('unknown')
    expect(clientIp(undefined)).toBe('unknown')
  })

  it('ignores an empty x-forwarded-for and falls through to x-real-ip', () => {
    const req: Req = { headers: { 'x-forwarded-for': '', 'x-real-ip': '7.8.9.10' } }
    expect(clientIp(req)).toBe('7.8.9.10')
  })
})
