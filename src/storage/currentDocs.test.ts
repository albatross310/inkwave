import { describe, expect, it } from 'vitest'
import { addCurrentDoc, currentDocIds, removeCurrentDoc, saveCurrentDocOrder } from './currentDocs'

function memoryStore(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('current documents workflow', () => {
  it('starts newest-first, preserves manual order, and puts genuinely new docs at the front', () => {
    const store = memoryStore()
    expect(currentDocIds(['b', 'a'], store)).toEqual(['b', 'a'])
    expect(currentDocIds(['a', 'b'], store)).toEqual(['a', 'b'])
    saveCurrentDocOrder(['a', 'b'], store)
    expect(currentDocIds(['b', 'a'], store)).toEqual(['a', 'b'])
    expect(currentDocIds(['c', 'b', 'a'], store)).toEqual(['c', 'a', 'b'])
  })

  it('keeps a removed doc out until the user explicitly adds it back', () => {
    const store = memoryStore()
    currentDocIds(['b', 'a'], store)
    removeCurrentDoc('b', store)
    expect(currentDocIds(['b', 'a'], store)).toEqual(['a'])
    addCurrentDoc('b', store)
    expect(currentDocIds(['b', 'a'], store)).toEqual(['b', 'a'])
  })
})
