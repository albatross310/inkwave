import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCAS_DISPLAY_KEY, scasSuggestionsEnabled, setScasSuggestionsEnabled } from './display'

function browserWith(raw: string | null) {
  const values = new Map<string, string>()
  if (raw !== null) values.set(SCAS_DISPLAY_KEY, raw)
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
  vi.stubGlobal('window', { localStorage })
  return localStorage
}

afterEach(() => vi.unstubAllGlobals())

describe('SCAS suggestion display default', () => {
  it('is off when the writer has never made a choice', () => {
    browserWith(null)
    expect(scasSuggestionsEnabled()).toBe(false)
  })

  it('preserves both meanings of the existing inverse storage key', () => {
    browserWith('0')
    expect(scasSuggestionsEnabled()).toBe(true)
    browserWith('1')
    expect(scasSuggestionsEnabled()).toBe(false)
  })

  it('writes an explicit choice rather than relying on the default', () => {
    const storage = browserWith(null)
    setScasSuggestionsEnabled(true)
    expect(storage.setItem).toHaveBeenLastCalledWith(SCAS_DISPLAY_KEY, '0')
    expect(scasSuggestionsEnabled()).toBe(true)
    setScasSuggestionsEnabled(false)
    expect(storage.setItem).toHaveBeenLastCalledWith(SCAS_DISPLAY_KEY, '1')
    expect(scasSuggestionsEnabled()).toBe(false)
  })

  it('fails closed without browser storage', () => {
    vi.stubGlobal('window', undefined)
    expect(scasSuggestionsEnabled()).toBe(false)
  })
})
