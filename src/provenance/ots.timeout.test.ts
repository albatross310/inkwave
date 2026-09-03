import { afterEach, describe, expect, it, vi } from 'vitest'
import { OTS_REQUEST_TIMEOUT_MS, stampBundle } from './ots'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.useRealTimers()
})

describe('OpenTimestamps relay timeout', () => {
  it('returns null after the deadline when the relay never answers', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch

    const result = stampBundle('a'.repeat(64))
    const verdict = expect(result).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(OTS_REQUEST_TIMEOUT_MS)
    await verdict
  })

  it('does not wait for the timeout after a successful response', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'pending', proofBase64: 'AA==',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(stampBundle('b'.repeat(64))).resolves.toEqual({ status: 'pending', proofBase64: 'AA==' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
