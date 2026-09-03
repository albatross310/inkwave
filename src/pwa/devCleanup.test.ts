import { describe, expect, it, vi } from 'vitest'
import { DEV_SW_CLEARED_MESSAGE, repairDevServiceWorker } from './devCleanup'

function serviceWorkerWith(registrations: unknown[]) {
  let listener: ((event: MessageEvent) => void) | null = null
  const api = {
    getRegistrations: vi.fn().mockResolvedValue(registrations),
    register: vi.fn().mockResolvedValue({}),
    addEventListener: vi.fn((_type: string, next: (event: MessageEvent) => void) => { listener = next }),
    removeEventListener: vi.fn(),
  }
  return {
    api: api as unknown as ServiceWorkerContainer,
    emit: (data: unknown) => listener?.({ data } as MessageEvent),
    spies: api,
  }
}

describe('development service-worker repair', () => {
  it('clears orphaned caches without reloading a page already served by dev', async () => {
    const sw = serviceWorkerWith([])
    const reload = vi.fn()
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['inkwave-old', 'inkwave-older']),
      delete: vi.fn().mockResolvedValue(true),
    }

    await expect(repairDevServiceWorker(
      sw.api, cacheStorage as unknown as CacheStorage, 'build 1', reload,
    )).resolves.toBe('clean')
    expect(cacheStorage.delete).toHaveBeenCalledWith('inkwave-old')
    expect(cacheStorage.delete).toHaveBeenCalledWith('inkwave-older')
    expect(sw.spies.register).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('replaces a controlling worker and reloads only after the cleanup worker confirms completion', async () => {
    const sw = serviceWorkerWith([{}])
    const reload = vi.fn()
    await expect(repairDevServiceWorker(sw.api, undefined, 'build 1', reload))
      .resolves.toBe('replacement-requested')
    expect(sw.spies.register).toHaveBeenCalledWith('/sw-dev-cleanup.js?v=build%201', { scope: '/' })
    expect(reload).not.toHaveBeenCalled()

    sw.emit({ type: 'something-else' })
    expect(reload).not.toHaveBeenCalled()
    sw.emit({ type: DEV_SW_CLEARED_MESSAGE })
    expect(reload).toHaveBeenCalledOnce()
    expect(sw.spies.removeEventListener).toHaveBeenCalled()
  })

  it('removes its message listener when replacement registration fails', async () => {
    const sw = serviceWorkerWith([{}])
    sw.spies.register.mockRejectedValueOnce(new Error('registration blocked'))
    await expect(repairDevServiceWorker(sw.api, undefined, 'b', vi.fn())).rejects.toThrow('registration blocked')
    expect(sw.spies.removeEventListener).toHaveBeenCalled()
  })
})
