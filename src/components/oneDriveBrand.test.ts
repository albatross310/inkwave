import { describe, expect, it } from 'vitest'
import { ONE_DRIVE_BLUE } from './oneDriveBrand'

describe('OneDrive colour', () => {
  it('uses the shared deeper action blue', () => {
    expect(ONE_DRIVE_BLUE).toBe('#02579f')
  })
})
