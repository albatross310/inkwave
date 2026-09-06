import { describe, expect, it, vi } from 'vitest'
import { announceMediaReady, mediaReadyVersion } from './ready'

describe('media ready signal', () => {
  it('is askable even when a listener would subscribe after completion', () => {
    const before = mediaReadyVersion('asset-a')
    announceMediaReady('asset-a')
    expect(mediaReadyVersion('asset-a')).toBe(before + 1)
  })

  it('does not require window in non-browser code', () => {
    vi.stubGlobal('window', undefined)
    expect(() => announceMediaReady('asset-node')).not.toThrow()
    vi.unstubAllGlobals()
  })
})
