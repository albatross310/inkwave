// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneDriveSignInRecoveryDialog } from './OneDriveSignInRecoveryDialog'

describe('OneDrive sign-in recovery', () => {
  afterEach(cleanup)

  it('offers a real retry and an explicit route back to the unchanged document', async () => {
    const retry = vi.fn(async () => {})
    const back = vi.fn()
    render(<OneDriveSignInRecoveryDialog message="Microsoft could not sign in." onRetry={retry} onBack={back} />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to document' }))
    expect(back).toHaveBeenCalledTimes(1)
  })
})
