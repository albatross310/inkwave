// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { paginationEnabled } from './pageView'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('pagination availability', () => {
  it('ignores a stale production pagOff flag, including in an isolated Safari-PWA store', () => {
    localStorage.setItem('inkwave:pagOff', '1')
    expect(paginationEnabled()).toBe(true)
  })

  it('still supports the explicit benchmark ablation', () => {
    sessionStorage.setItem('inkwave:benchmark', '1')
    localStorage.setItem('inkwave:pagOff', '1')
    expect(paginationEnabled()).toBe(false)
  })
})
