import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
  const now = 2_000_000

  it('formats the save/sync recency bands compactly', () => {
    expect(relativeTime(now, now)).toBe('just now')
    expect(relativeTime(now - 12_000, now)).toBe('12 seconds ago')
    expect(relativeTime(now - 60_000, now)).toBe('1 minute ago')
    expect(relativeTime(now - 8 * 60_000, now)).toBe('8 minutes ago')
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1 hour ago')
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3 hours ago')
  })

  it('treats a future clock value as just now', () => {
    expect(relativeTime(now + 10_000, now)).toBe('just now')
  })
})
