import { describe, expect, it } from 'vitest'
import { oneDriveSignInMode } from './onedrive'

describe('OneDrive sign-in window ownership', () => {
  it('keeps every installed PWA on its document while Microsoft opens separately', () => {
    expect(oneDriveSignInMode({ standalone: true })).toBe('popup')
  })

  it('retains the established redirect flow in ordinary browser tabs', () => {
    expect(oneDriveSignInMode({ standalone: false })).toBe('redirect')
  })
})
