// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listOpfsDocuments, listOpfsDocumentsStrict, StorageReadError } from './opfs'

let storageDescriptor: PropertyDescriptor | undefined

function setStorage(getDirectory: () => Promise<FileSystemDirectoryHandle>): void {
  Object.defineProperty(navigator, 'storage', {
    value: { getDirectory },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage')
})

afterEach(() => {
  if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor)
  else delete (navigator as { storage?: unknown }).storage
})

describe('direct OPFS document listing', () => {
  it('keeps a failed storage read distinct from an empty document store at startup', async () => {
    setStorage(() => Promise.reject(new Error('storage temporarily unavailable')))

    await expect(listOpfsDocumentsStrict()).rejects.toBeInstanceOf(StorageReadError)
  })

  it('keeps the recovery inspector compatibility surface non-throwing', async () => {
    setStorage(() => Promise.reject(new Error('storage temporarily unavailable')))

    await expect(listOpfsDocuments()).resolves.toEqual([])
  })

  it('treats a genuinely missing documents directory as empty', async () => {
    const root = {
      getDirectoryHandle: () => Promise.reject(new DOMException('missing', 'NotFoundError')),
    } as unknown as FileSystemDirectoryHandle
    setStorage(() => Promise.resolve(root))

    await expect(listOpfsDocumentsStrict()).resolves.toEqual([])
  })
})
