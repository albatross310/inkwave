import { describe, expect, it, vi } from 'vitest'
import { claimDevServiceWorkerRepairReload, clearDevServiceWorkerState } from './devCleanup'

describe('development service-worker cleanup', () => {
  it('reports a clean origin without scheduling a repair reload', async () => {
    const serviceWorker = { getRegistrations: vi.fn().mockResolvedValue([]) }
    const cacheStorage = { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() }
    await expect(clearDevServiceWorkerState(
      serviceWorker as unknown as ServiceWorkerContainer,
      cacheStorage as unknown as CacheStorage,
    )).resolves.toBe(false)
    expect(cacheStorage.delete).not.toHaveBeenCalled()
  })

  it('awaits every stale worker and cache deletion before requesting the one repair reload', async () => {
    const unregisterA = vi.fn().mockResolvedValue(true)
    const unregisterB = vi.fn().mockResolvedValue(true)
    const serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterA }, { unregister: unregisterB }]),
    }
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['inkwave-old', 'inkwave-older']),
      delete: vi.fn().mockResolvedValue(true),
    }

    await expect(clearDevServiceWorkerState(
      serviceWorker as unknown as ServiceWorkerContainer,
      cacheStorage as unknown as CacheStorage,
    )).resolves.toBe(true)
    expect(unregisterA).toHaveBeenCalledOnce()
    expect(unregisterB).toHaveBeenCalledOnce()
    expect(cacheStorage.delete).toHaveBeenCalledWith('inkwave-old')
    expect(cacheStorage.delete).toHaveBeenCalledWith('inkwave-older')
  })
})

describe('development repair reload latch', () => {
  it('allows one reload, then consumes the marker instead of looping', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    expect(claimDevServiceWorkerRepairReload(storage)).toBe(true)
    expect(claimDevServiceWorkerRepairReload(storage)).toBe(false)
    expect(values.size).toBe(0)
  })

  it('refuses an automatic reload when private storage cannot hold the latch', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable') },
      removeItem: () => {},
    }
    expect(claimDevServiceWorkerRepairReload(storage)).toBe(false)
  })
})
