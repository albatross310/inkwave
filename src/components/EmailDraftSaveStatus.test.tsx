// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailDraftSaveStatus } from './EmailDraftSaveStatus'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EmailDraftSaveStatus', () => {
  it('distinguishes local autosave from provider sync', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T05:00:00.000Z'))
    render(<EmailDraftSaveStatus initialSavedAt="2026-09-05T04:58:00.000Z" />)

    expect(screen.getByText('Saved locally 2 minutes ago')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/synced/i)
  })

  it('moves to just now only after the local-save acknowledgement arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T05:00:00.000Z'))
    render(<EmailDraftSaveStatus initialSavedAt="2026-09-05T04:00:00.000Z" />)

    act(() => window.dispatchEvent(new Event('inkwave:doc-saved')))

    expect(screen.getByText('Saved locally just now')).toBeTruthy()
  })
})
