import { describe, expect, it } from 'vitest'
import { isWebKitEngine, scrollWaterMovesFor, threadedScrollWaterFor } from './browserCadence'

describe('engine-adaptive decorative water', () => {
  it('detects Safari/WebKit without mistaking Chromium for it', () => {
    const safari = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15'
    const chromium = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'

    expect(isWebKitEngine(safari)).toBe(true)
    expect(scrollWaterMovesFor(safari)).toBe(false)
    expect(isWebKitEngine(chromium)).toBe(false)
    expect(scrollWaterMovesFor(chromium)).toBe(true)
  })

  it('treats iOS browser wrappers as WebKit', () => {
    const iosChrome = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1'
    expect(isWebKitEngine(iosChrome)).toBe(true)
    expect(isWebKitEngine('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0')).toBe(false)
  })

  it('uses threaded scroll water only on Safari 26.4 or newer', () => {
    const safari263 = 'Mozilla/5.0 AppleWebKit/605.1.15 Version/26.3 Safari/605.1.15'
    const safari264 = 'Mozilla/5.0 AppleWebKit/605.1.15 Version/26.4 Safari/605.1.15'
    const chrome = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36'
    expect(threadedScrollWaterFor(safari263, true)).toBe(false)
    expect(threadedScrollWaterFor(safari264, true)).toBe(true)
    expect(threadedScrollWaterFor(safari264, false)).toBe(false)
    expect(threadedScrollWaterFor(chrome, true)).toBe(false)
  })
})
