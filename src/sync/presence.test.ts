import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isOtherDeviceActive } from './presence'

// isOtherDeviceActive: pure given Date.now(). We freeze time to make tests deterministic.
const NOW = new Date('2026-07-01T12:00:00.000Z').getTime()

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('isOtherDeviceActive', () => {
  // 'this-device' is the id returned by deviceId() in a non-browser env (which returns '').
  // In tests, localStorage is absent, so deviceId() returns ''. For tests we use a non-empty
  // "other device" id to trigger the active-device path, and the SAME id as '' for the same-device path.

  it('returns false when session is undefined', () => {
    expect(isOtherDeviceActive(undefined, new Date(NOW - 5000).toISOString())).toBe(false)
  })

  it('returns false when exportedAt is undefined', () => {
    expect(isOtherDeviceActive('other-device-id', undefined)).toBe(false)
  })

  it('returns false for the same device id (empty, matching deviceId() in a non-browser env)', () => {
    // deviceId() returns '' when localStorage is absent (test env). Session '' === '' → same device.
    expect(isOtherDeviceActive('', new Date(NOW - 5000).toISOString())).toBe(false)
  })

  it('returns true when another device was active within 2 minutes', () => {
    const recent = new Date(NOW - 60_000).toISOString() // 60 seconds ago
    expect(isOtherDeviceActive('other-device', recent)).toBe(true)
  })

  it('returns false when the other device write is older than 2 minutes', () => {
    const stale = new Date(NOW - 3 * 60 * 1000).toISOString() // 3 minutes ago
    expect(isOtherDeviceActive('other-device', stale)).toBe(false)
  })

  it('returns false for a future exportedAt (clocks skewed forward on remote device)', () => {
    const future = new Date(NOW + 5000).toISOString()
    expect(isOtherDeviceActive('other-device', future)).toBe(false)
  })

  it('returns false for a malformed exportedAt', () => {
    expect(isOtherDeviceActive('other-device', 'not-a-date')).toBe(false)
  })
})
