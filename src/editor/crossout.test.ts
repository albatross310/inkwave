import { describe, it, expect, beforeEach, vi } from 'vitest'
import { crossoutMode, setCrossoutMode, cycleCrossoutMode, watermarkEnabled, setWatermark, slotTimeMode, setSlotTimeMode, CROSSOUT_MODES } from './crossout'

// Stub localStorage for Node test environment.
const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k in store) delete store[k] },
})

// Reset relevant localStorage keys before each test.
beforeEach(() => {
  delete store['inkwave:crossout']
  delete store['inkwave:watermark']
  delete store['inkwave:slot-time-mode']
})

describe('crossoutMode', () => {
  it('defaults to stacked when nothing stored', () => {
    expect(crossoutMode()).toBe('stacked')
  })

  it('reads inline from localStorage', () => {
    localStorage.setItem('inkwave:crossout', 'inline')
    expect(crossoutMode()).toBe('inline')
  })

  it('reads off from localStorage', () => {
    localStorage.setItem('inkwave:crossout', 'off')
    expect(crossoutMode()).toBe('off')
  })

  it('falls back to stacked for an unrecognised stored value', () => {
    localStorage.setItem('inkwave:crossout', 'bogus')
    expect(crossoutMode()).toBe('stacked')
  })
})

describe('setCrossoutMode', () => {
  it('persists the mode to localStorage', () => {
    setCrossoutMode('inline')
    expect(localStorage.getItem('inkwave:crossout')).toBe('inline')
    expect(crossoutMode()).toBe('inline')
  })

  it('can set off', () => {
    setCrossoutMode('off')
    expect(crossoutMode()).toBe('off')
  })
})

describe('cycleCrossoutMode', () => {
  it('cycles stacked → inline → off → stacked', () => {
    expect(crossoutMode()).toBe('stacked')
    expect(cycleCrossoutMode()).toBe('inline')
    expect(cycleCrossoutMode()).toBe('off')
    expect(cycleCrossoutMode()).toBe('stacked')
  })

  it('CROSSOUT_MODES has exactly 3 entries matching the cycle order', () => {
    expect(CROSSOUT_MODES).toEqual(['stacked', 'inline', 'off'])
  })
})

describe('watermarkEnabled', () => {
  it('defaults to true when nothing stored', () => {
    expect(watermarkEnabled()).toBe(true)
  })

  it('returns false when stored as "0"', () => {
    localStorage.setItem('inkwave:watermark', '0')
    expect(watermarkEnabled()).toBe(false)
  })

  it('returns true when stored as "1"', () => {
    localStorage.setItem('inkwave:watermark', '1')
    expect(watermarkEnabled()).toBe(true)
  })
})

describe('setWatermark', () => {
  it('stores "0" when disabled', () => {
    setWatermark(false)
    expect(localStorage.getItem('inkwave:watermark')).toBe('0')
    expect(watermarkEnabled()).toBe(false)
  })

  it('stores "1" when enabled', () => {
    setWatermark(true)
    expect(localStorage.getItem('inkwave:watermark')).toBe('1')
    expect(watermarkEnabled()).toBe(true)
  })
})

describe('slotTimeMode', () => {
  it('defaults to "time" when nothing stored', () => {
    expect(slotTimeMode()).toBe('time')
  })

  it('returns "date" when stored as "date"', () => {
    localStorage.setItem('inkwave:slot-time-mode', 'date')
    expect(slotTimeMode()).toBe('date')
  })

  it('returns "time" for any value other than "date"', () => {
    localStorage.setItem('inkwave:slot-time-mode', 'bogus')
    expect(slotTimeMode()).toBe('time')
  })
})

describe('setSlotTimeMode', () => {
  it('persists "date" to localStorage', () => {
    setSlotTimeMode('date')
    expect(slotTimeMode()).toBe('date')
  })

  it('persists "time" to localStorage', () => {
    setSlotTimeMode('time')
    expect(slotTimeMode()).toBe('time')
  })
})
