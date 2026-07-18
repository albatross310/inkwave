// @vitest-environment jsdom
//
// THE "OPEN IN ANOTHER WINDOW" SCREEN wires its three buttons to the three actions and to nothing
// else. The correctness of the handoff lives in storage/singleOpen.ts (mutation-proved there); this
// keeps the UI honest — that a button click reaches the callback it claims to, and that a failed
// action lands the writer back on the screen with an explanation rather than a dead end.
//
// A browser probe that ran once is not a guard (CLAUDE.md), so the wiring is pinned here in ~40ms.

import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentOpenElsewhere, SurrenderedBanner } from './DocumentOpenElsewhere'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const noop = () => {}
const resolved = () => Promise.resolve()

describe('DocumentOpenElsewhere', () => {
  it('names the held document and offers exactly the three ways forward', () => {
    render(<DocumentOpenElsewhere title="My Thesis" onSwitch={noop} onOpenCopy={resolved} onTakeOver={resolved} />)
    expect(screen.getByText(/My Thesis.*open in another window/)).toBeTruthy()
    expect(screen.getByText('Switch to it')).toBeTruthy()
    expect(screen.getByText('Open a copy')).toBeTruthy()
    expect(screen.getByText('Take over here')).toBeTruthy()
  })

  it('"Switch to it" calls onSwitch and confirms it asked the other window', () => {
    const onSwitch = vi.fn()
    render(<DocumentOpenElsewhere title="T" onSwitch={onSwitch} onOpenCopy={resolved} onTakeOver={resolved} />)
    fireEvent.click(screen.getByText('Switch to it'))
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Asked the other window/)).toBeTruthy()
  })

  it('"Open a copy" calls onOpenCopy', () => {
    const onOpenCopy = vi.fn(() => Promise.resolve())
    render(<DocumentOpenElsewhere title="T" onSwitch={noop} onOpenCopy={onOpenCopy} onTakeOver={resolved} />)
    fireEvent.click(screen.getByText('Open a copy'))
    expect(onOpenCopy).toHaveBeenCalledTimes(1)
  })

  it('"Take over here" calls onTakeOver', () => {
    const onTakeOver = vi.fn(() => Promise.resolve())
    render(<DocumentOpenElsewhere title="T" onSwitch={noop} onOpenCopy={resolved} onTakeOver={onTakeOver} />)
    fireEvent.click(screen.getByText('Take over here'))
    expect(onTakeOver).toHaveBeenCalledTimes(1)
  })

  it('a failed action lands back on the screen with an explanation — never a dead end', async () => {
    const onTakeOver = vi.fn(() => Promise.reject(new Error('boom')))
    render(<DocumentOpenElsewhere title="T" onSwitch={noop} onOpenCopy={resolved} onTakeOver={onTakeOver} />)
    fireEvent.click(screen.getByText('Take over here'))
    await waitFor(() => expect(screen.getByText(/didn.t work.*boom/)).toBeTruthy())
    // The other two actions are usable again after the failure.
    expect((screen.getByText('Open a copy').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('SurrenderedBanner', () => {
  it('explains the read-only state and offers to take it back', () => {
    const onReload = vi.fn()
    render(<SurrenderedBanner onReload={onReload} />)
    expect(screen.getByText(/read-only here/)).toBeTruthy()
    fireEvent.click(screen.getByText('Take it back'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
