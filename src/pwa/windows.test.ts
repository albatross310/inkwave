import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  NEW_INKWAVE_WINDOW_URL,
  NEW_BLANK_INKWAVE_WINDOW_URL,
  adjacentInkwaveWindowId,
  inkwaveWindowCycleDirection,
  lowestAvailableWindowSlot,
  openNewInkwaveWindow,
  openNewBlankInkwaveWindow,
} from './windows'

describe('openNewInkwaveWindow', () => {
  it('opens a fresh browsing context without cloning the current document session', () => {
    const open = vi.fn(() => null)

    openNewInkwaveWindow(open)

    expect(open).toHaveBeenCalledWith(NEW_INKWAVE_WINDOW_URL, '_blank', 'noopener')
  })

  it('keeps the installed-app launch and Dock shortcut on the same new-window route', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'))

    expect(manifest.launch_handler).toEqual({ client_mode: 'navigate-new' })
    expect(manifest.shortcuts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'New doc', url: NEW_INKWAVE_WINDOW_URL }),
    ]))
  })

  it('can explicitly open a blank document in a separate window', () => {
    const open = vi.fn(() => null)
    openNewBlankInkwaveWindow(open)
    expect(open).toHaveBeenCalledWith(NEW_BLANK_INKWAVE_WINDOW_URL, '_blank', 'noopener')
  })

  it('cycles a stable N-window roster in both directions', () => {
    const registry = [
      { id: 'third', openedAt: 30, seenAt: 30, slot: 3 },
      { id: 'first', openedAt: 10, seenAt: 10, slot: 1 },
      { id: 'second', openedAt: 20, seenAt: 20, slot: 2 },
    ]
    expect(adjacentInkwaveWindowId(registry, 'first', 1)).toBe('second')
    expect(adjacentInkwaveWindowId(registry, 'first', -1)).toBe('third')
    expect(adjacentInkwaveWindowId(registry, 'third', 1)).toBe('first')
  })

  it('assigns the lowest free stable visual slot across N windows', () => {
    expect(lowestAvailableWindowSlot([])).toBe(1)
    expect(lowestAvailableWindowSlot([
      { id: 'one', openedAt: 10, seenAt: 10, slot: 1 },
      { id: 'three', openedAt: 30, seenAt: 30, slot: 3 },
    ])).toBe(2)
  })

  it('maps macOS and Windows-safe cycling shortcuts without stealing plain Tab', () => {
    const key = (overrides: Partial<KeyboardEvent>) => ({
      key: 'Tab', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides,
    })
    expect(inkwaveWindowCycleDirection(key({ altKey: true }))).toBe(1)
    expect(inkwaveWindowCycleDirection(key({ altKey: true, ctrlKey: true }))).toBe(-1)
    expect(inkwaveWindowCycleDirection(key({ key: 'ArrowRight', altKey: true, ctrlKey: true }))).toBe(1)
    expect(inkwaveWindowCycleDirection(key({ key: 'ArrowLeft', altKey: true, ctrlKey: true }))).toBe(-1)
    expect(inkwaveWindowCycleDirection(key({}))).toBe(0)
  })
})
