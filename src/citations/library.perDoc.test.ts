// KEEPS ONE DOCUMENT'S SOURCES OUT OF ANOTHER'S (2026-08-28). Peter: "the references don't appear
// to be being saved in the studio doc but only in the OPFS which means if you start a new doc the
// old references are still there."
//
// The library used to be ONE device-wide file. Two consequences, and the test carries both: the
// files collided on disk, and — the half that is easy to fix on disk and forget in memory — the
// in-memory provider is tab-global, so switching documents had to CLEAR it. `loadLibrary` skipped
// the set on an empty read (`if (items.length)`), which was harmless with one library and is the
// whole bug with many: an empty read now means "this document has no sources", not "first use".

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'

let docId = 'doc-A'
vi.mock('../storage/tabDoc', () => ({ tabDocId: () => docId }))

let lib: typeof import('./library')
let bibProvider: typeof import('./bibProvider').bibProvider

async function reload() {
  vi.resetModules()
  lib = await import('./library')
  bibProvider = (await import('./bibProvider')).bibProvider
}

const src = (id: string, title: string) => ({ id, title, type: 'article-journal' } as never)

beforeEach(async () => {
  resetOpfsShim()
  installOpfsShim()
  docId = 'doc-A'
  await reload()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the library is per document', () => {
  it('THE BUG: a second document does not inherit the first one’s sources', async () => {
    await lib.loadLibrary()
    await lib.addToLibrary(src('kurtsal2005', 'Identity and Change'))
    expect(bibProvider.getAll().map((i) => i.id)).toEqual(['kurtsal2005'])

    docId = 'doc-B'                    // a new piece of writing, same tab, same device
    await lib.loadLibrary()
    expect(bibProvider.getAll()).toEqual([])
  })

  it('…and going back to the first finds its sources exactly where they were', async () => {
    await lib.loadLibrary()
    await lib.addToLibrary(src('kurtsal2005', 'Identity and Change'))
    docId = 'doc-B'
    await lib.loadLibrary()
    await lib.addToLibrary(src('geach1967', 'Identity'))

    docId = 'doc-A'
    await lib.loadLibrary()
    expect(bibProvider.getAll().map((i) => i.id)).toEqual(['kurtsal2005'])
    docId = 'doc-B'
    await lib.loadLibrary()
    expect(bibProvider.getAll().map((i) => i.id)).toEqual(['geach1967'])
  })

  it('KNOWN-NEGATIVE: the memory half is real — skipping the empty set leaks the old library', async () => {
    // This is what `if (items.length)` did. Restated here so the assertion above cannot be true
    // for the wrong reason (e.g. because the shim happened to return nothing at all).
    await lib.loadLibrary()
    await lib.addToLibrary(src('kurtsal2005', 'Identity and Change'))
    const carried = bibProvider.getAll()
    expect(carried.length).toBe(1)           // there IS something that could leak
    docId = 'doc-B'
    await lib.loadLibrary()
    expect(bibProvider.getAll().length).toBe(0)
  })

  it('a failed read never clears — an unreadable disk is not an empty library', async () => {
    await lib.loadLibrary()
    await lib.addToLibrary(src('kurtsal2005', 'Identity and Change'))
    // OPFS goes away mid-session: absent and error are different answers with opposite consequences.
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new Error('boom') } } })
    await lib.loadLibrary()
    expect(bibProvider.getAll().map((i) => i.id)).toEqual(['kurtsal2005'])
  })
})

describe('the legacy device-wide library', () => {
  it('is NOT adopted automatically — that would reproduce the bug', async () => {
    // Seed the old global path by writing with no document id.
    docId = ''
    await lib.loadLibrary()
    await lib.addToLibrary(src('old1', 'A source from before'))

    docId = 'doc-new'
    await lib.loadLibrary()
    expect(bibProvider.getAll()).toEqual([])          // a new document starts clean
    expect(await lib.legacyLibrarySize()).toBe(1)     // …but nothing was destroyed
  })

  it('can be imported into a document on purpose, merging rather than replacing', async () => {
    docId = ''
    await lib.loadLibrary()
    await lib.addToLibrary(src('old1', 'A source from before'))

    docId = 'doc-new'
    await lib.loadLibrary()
    await lib.addToLibrary(src('fresh', 'Something new'))
    const added = await lib.importLegacyLibrary()
    expect(added).toBe(1)
    expect(bibProvider.getAll().map((i) => i.id).sort()).toEqual(['fresh', 'old1'])
  })
})

describe('a library that arrives in a .studio', () => {
  it('merges into this document without dropping what is already here', async () => {
    await lib.loadLibrary()
    await lib.addToLibrary(src('mine', 'Added on this device'))
    await lib.restoreLibraryFromBundle([src('theirs', 'Came with the file') as never])
    expect(bibProvider.getAll().map((i) => i.id).sort()).toEqual(['mine', 'theirs'])
    // …and it is on disk, not just in memory.
    await lib.loadLibrary()
    expect(bibProvider.getAll().map((i) => i.id).sort()).toEqual(['mine', 'theirs'])
  })
})
