import { describe, it, expect } from 'vitest'
import { isExtUpsert } from './extensionChannel'

describe('isExtUpsert — message validation (security boundary)', () => {
  it('accepts a well-formed upsert', () => {
    expect(isExtUpsert({ source: 'inkwave-ext', type: 'cite/upsert', uuid: 'u1', items: [{ id: 'a', type: 'book' }] })).toBe(true)
  })
  it('rejects a wrong source tag (spoof from other page script)', () => {
    expect(isExtUpsert({ source: 'evil', type: 'cite/upsert', uuid: 'u1', items: [{ id: 'a', type: 'book' }] })).toBe(false)
  })
  it('rejects a wrong type', () => {
    expect(isExtUpsert({ source: 'inkwave-ext', type: 'cite/delete', uuid: 'u1', items: [] })).toBe(false)
  })
  it('rejects a missing uuid', () => {
    expect(isExtUpsert({ source: 'inkwave-ext', type: 'cite/upsert', items: [] })).toBe(false)
  })
  it('rejects items without string ids', () => {
    expect(isExtUpsert({ source: 'inkwave-ext', type: 'cite/upsert', uuid: 'u1', items: [{ type: 'book' }] })).toBe(false)
  })
  it('rejects non-objects', () => {
    expect(isExtUpsert(null)).toBe(false)
    expect(isExtUpsert('string')).toBe(false)
    expect(isExtUpsert(42)).toBe(false)
  })
})
