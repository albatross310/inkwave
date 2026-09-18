// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isWarmLoad, markWarm, clearWarm } from './loadWarmth'

describe('load warmth — only the first open of a document pays the full loading choreography', () => {
  beforeEach(() => sessionStorage.clear())
  it('a fresh tab is cold', () => { expect(isWarmLoad()).toBe(false) })
  it('after a reveal the tab is warm, and a document change makes it cold again', () => {
    markWarm(); expect(isWarmLoad()).toBe(true)
    clearWarm(); expect(isWarmLoad()).toBe(false)
  })
})
