// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const msal = vi.hoisted(() => ({
  initializations: 0,
  redirects: vi.fn(),
}))

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    async initialize() {
      msal.initializations += 1
      if (msal.initializations === 1) throw new Error('temporary MSAL startup failure')
    }
    async handleRedirectPromise() {}
    getAllAccounts() { return [] }
    async acquireTokenSilent() { return { accessToken: '' } }
    async loginPopup() {}
    async loginRedirect() { msal.redirects() }
  },
}))

import { clearOneDriveSyncPending, startOneDriveSignIn } from './onedrive'

describe('OneDrive authentication retry', () => {
  beforeEach(() => {
    msal.initializations = 0
    msal.redirects.mockReset()
    clearOneDriveSyncPending()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    })
  })

  it('does not cache a rejected MSAL initialisation as every future retry', async () => {
    await expect(startOneDriveSignIn()).resolves.toMatchObject({ ok: false })
    await expect(startOneDriveSignIn()).resolves.toEqual({ ok: true, mode: 'redirect' })
    expect(msal.initializations).toBe(2)
    expect(msal.redirects).toHaveBeenCalledTimes(1)
  })
})
