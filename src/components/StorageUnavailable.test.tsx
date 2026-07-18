// @vitest-environment jsdom
// THE STORAGE-ERROR SCREEN SAYS THE RIGHT THING IN A PRIVATE WINDOW.
//
// One full-screen panel, two failures. On a TRANSIENT read failure (working storage) it must keep
// the load-bearing reassurance "your writing is still here / nothing deleted" AND the Open Storage
// recovery button. In a PRIVATE/incognito window that reassurance is a lie — there is nothing stored
// and nothing to recover — so it must switch to a message that says so and HIDE Open Storage (which
// reads OPFS and implies recoverable data that isn't there).
//
// The switch is driven by the async probe (navigator.storage.getDirectory), so both cases are
// asserted after the effect settles. A suite that only checked the private case would pass against a
// component that ALWAYS shows the private message (the scary-lie inverse) — so the transient case is
// asserted too, and each asserts the ABSENCE of the other's heading.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageUnavailable } from './StorageUnavailable'
import { StorageReadError } from '../storage/opfs'

// OpfsInspector is imported at module load; it is never rendered here (Open Storage is not clicked),
// but stub it so the test stays about THIS component, not its recovery surface's deps.
vi.mock('./OpfsInspector', () => ({ OpfsInspector: () => null }))

// @testing-library/react auto-cleans only with globals:true, which this repo does not set.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { value, configurable: true, writable: true })
}

const err = new StorageReadError('documents/x/current.json', new Error('transient read failure'))

describe('StorageUnavailable', () => {
  it('private window (getDirectory rejects): shows the private-window message, hides Open Storage', async () => {
    setStorage({ getDirectory: () => Promise.reject(new Error('SecurityError')) })
    render(<StorageUnavailable error={err} onRetry={() => {}} />)

    // The new heading appears once the probe resolves to "unavailable".
    await screen.findByText(/private window/i)

    // The lie must be GONE.
    expect(screen.queryByText(/still here/i)).toBeNull()
    expect(screen.queryByText(/Nothing has been changed or deleted/i)).toBeNull()
    // Open Storage is useless when OPFS is unavailable — it must not be offered.
    expect(screen.queryByRole('button', { name: /Open Storage/i })).toBeNull()
    // Reload stays (harmless; helps if they switch to a normal window).
    expect(screen.getByRole('button', { name: /Reload/i })).toBeTruthy()
    // Technical details disclosure stays.
    expect(screen.getByText(/Technical details/i)).toBeTruthy()
  })

  it('getDirectory absent: also treated as the private/unavailable case', async () => {
    setStorage({}) // no getDirectory
    render(<StorageUnavailable error={err} onRetry={() => {}} />)
    await screen.findByText(/private window/i)
    expect(screen.queryByRole('button', { name: /Open Storage/i })).toBeNull()
  })

  it('transient failure (getDirectory resolves): keeps the reassuring message AND Open Storage', async () => {
    setStorage({ getDirectory: () => Promise.resolve({} as FileSystemDirectoryHandle) })
    render(<StorageUnavailable error={err} onRetry={() => {}} />)

    // The safe default is present immediately and STAYS after the probe resolves to false.
    expect(screen.getByText(/still here/i)).toBeTruthy()
    // Give the effect a chance to (wrongly) flip; assert it did not.
    await waitFor(() => expect(screen.getByRole('button', { name: /Open Storage/i })).toBeTruthy())
    expect(screen.queryByText(/private window/i)).toBeNull()
    expect(screen.getByText(/Nothing has been changed or deleted/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reload/i })).toBeTruthy()
  })
})
