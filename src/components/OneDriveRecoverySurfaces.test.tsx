// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OneDriveFileOpener } from './OneDriveFileOpener'
import { OneDriveFolderPicker } from './OneDriveFolderPicker'

const mocks = vi.hoisted(() => ({
  listFolders: vi.fn(),
  listFiles: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('../storage/onedrive', () => ({
  listFolders: mocks.listFolders,
  listOneDriveFiles: mocks.listFiles,
  listQuickFolders: vi.fn(async () => []),
  getRecentFolders: vi.fn(async () => []),
  createOneDriveFolder: vi.fn(async () => {}),
  startOneDriveSignIn: mocks.signIn,
}))

vi.mock('../storage/openCache', () => ({
  listingKey: () => 'od:root',
  getListing: vi.fn(async () => null),
  putListing: vi.fn(),
}))

describe('OneDrive picker recovery surfaces', () => {
  beforeEach(() => {
    mocks.listFolders.mockReset().mockRejectedValue(new Error('not signed in'))
    mocks.listFiles.mockReset().mockRejectedValue(new Error('not signed in'))
    mocks.signIn.mockReset().mockResolvedValue({ ok: false, error: 'Microsoft sign-in was cancelled.' })
  })

  afterEach(cleanup)

  it('lets a failed folder-picker login retry or return to the document', async () => {
    const close = vi.fn()
    render(<OneDriveFolderPicker currentName="draft.studio" onPick={async () => {}} onClose={close} />)

    await screen.findByText('⚠ OneDrive sign-in did not finish.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Back to document' }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('lets a failed file-opener login retry or return to the document', async () => {
    const close = vi.fn()
    render(<OneDriveFileOpener onOpen={async () => {}} onClose={close} />)

    await screen.findByText('Your OneDrive session has ended — sign in again to browse your files.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Back to document' }))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
