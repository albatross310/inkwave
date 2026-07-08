import { describe, it, expect } from 'vitest'
import { POOL_ID } from './pool'
import { POOL_ID_STATIC } from './poolId'

describe('poolId', () => {
  it('frozen POOL_ID_STATIC matches the value derived from the shipped pool', () => {
    expect(POOL_ID_STATIC).toBe(POOL_ID)
  })
})
