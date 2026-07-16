// THE LIBRARY-HYDRATION LATCH — pinned in the gate.
//
// `btrace.prove.mjs` reproduces the real bug in a real browser (Peter's iPhone found it: a break
// table built before the async OPFS library landed baked `capa@0` into its key, so every later
// lookup missed forever). That probe is the in-browser truth — and it is NOT A GUARD: it needs a
// build, a server and two page loads, it is in no CI, and six weeks from now a proof that ran once
// is indistinguishable from one that never ran. These tests are ~ms and need no browser.
//
// They pin the three properties that make the latch a LATCH rather than an event — each one is a
// stranding bug if it breaks, and each fails SILENTLY (a builder that never resolves, or resolves
// too early, looks exactly like a cache that isn't helping).

import { describe, it, expect, vi, afterEach } from 'vitest'

// storage/opfsWrite decides ONCE AT MODULE LOAD whether writes use createWritable or the parse
// worker, and node has neither — so the modules under test must be imported AFTER the mocks are in
// place (the harness trap CLAUDE.md records for the ledger integration probe).
vi.mock('../storage/opfsWrite', () => ({ writeOpfsFile: vi.fn(async () => {}) }))

async function freshLibrary() {
  vi.resetModules()
  const mod = await import('./library')
  mod._resetLibraryReady()
  return mod
}

// The library reads OPFS via its own private readFile(); stub navigator.storage so that read is
// deterministic and, crucially, so we can make it THROW.
function stubOpfs(items: unknown[] | Error) {
  // `navigator` is getter-only under jsdom/node — assigning it throws. vi.stubGlobal replaces it.
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => {
        if (items instanceof Error) throw items
        return {
          getDirectoryHandle: async () => ({
            getFileHandle: async () => ({
              getFile: async () => ({ text: async () => JSON.stringify(items) }),
            }),
          }),
        }
      },
    },
  })
}

describe('libraryReady — the hydration latch', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

  // THE PROPERTY THE RACE NEEDS. A builder must be able to wait for hydration.
  it('does not resolve before hydration completes, and the library is populated when it does', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => {
          await gate
          return {
            getDirectoryHandle: async () => ({
              getFileHandle: async () => ({
                getFile: async () => ({ text: async () => JSON.stringify([{ id: 'a1990', type: 'book', title: 'T' }]) }),
              }),
            }),
          }
        },
      },
    })

    const { libraryReady } = await freshLibrary()
    const { bibProvider } = await import('./bibProvider')
    bibProvider.setEntries([], 'library')

    let resolved = false
    const p = libraryReady().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false) // still hydrating — a builder here would sign an EMPTY library

    release()
    await p
    expect(resolved).toBe(true)
    expect(bibProvider.getAll().length).toBe(1) // the state has SETTLED before the waiter runs
  })

  // "HAS IT ALREADY HAPPENED?" — the shape of the defect (the same one the wave video hit).
  // NB this passes because the PROMISE is the latch, not because of any explicit already-done
  // branch: mutation testing showed such a branch is redundant and unkillable, so it is gone.
  it('resolves IMMEDIATELY when hydration already finished (a late asker is never stranded)', async () => {
    stubOpfs([{ id: 'a1990', type: 'book', title: 'T' }])
    const { loadLibrary, libraryReady } = await freshLibrary()
    await loadLibrary()
    // No further loads, no events left to fire. An EVENT-based signal strands here forever.
    await expect(Promise.race([
      libraryReady().then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('STRANDED'), 50)),
    ])).resolves.toBe('resolved')
  })

  // The relocated-stranding bug: if libraryReady() only ever WAITED, a caller that never called
  // loadLibrary() would hang forever — the identical defect, one level over.
  it('STARTS hydration when nobody else has (cannot hang waiting for a load that never comes)', async () => {
    stubOpfs([{ id: 'a1990', type: 'book', title: 'T' }])
    const { libraryReady } = await freshLibrary()
    const { bibProvider } = await import('./bibProvider')
    bibProvider.setEntries([], 'library')
    await expect(Promise.race([
      libraryReady().then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('STRANDED'), 100)),
    ])).resolves.toBe('resolved')
    expect(bibProvider.getAll().length).toBe(1)
  })

  // "The initial attempt COMPLETED" — not "a library SUCCEEDED".
  //
  // THIS TEST WAS VACUOUS ON FIRST WRITING and mutation testing caught it: it made the OPFS READ
  // throw, and passed against a mutant with NO `finally` at all — because `readFile()` swallows its
  // own errors and returns [], so the read can never throw and the finally was never reached. The
  // test measured nothing while reading like a guarantee. It now aims at the path that CAN reach
  // the finally: hydration failing PAST the read (malformed data reaching setEntries). Kills the
  // no-finally mutant.
  it('resolves even when hydration THROWS past the read (a failed attempt is a completed attempt)', async () => {
    stubOpfs([{ id: 'a1990', type: 'book', title: 'T' }])
    const { libraryReady } = await freshLibrary()
    const { bibProvider } = await import('./bibProvider')
    const spy = vi.spyOn(bibProvider, 'setEntries').mockImplementation(() => { throw new Error('malformed library') })
    await expect(Promise.race([
      libraryReady().then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('STRANDED'), 100)),
    ])).resolves.toBe('resolved')
    expect(spy).toHaveBeenCalled() // the throwing path REALLY ran — else this proves nothing
    spy.mockRestore()
  })

  it('is idempotent — many waiters, one hydration, all released', async () => {
    stubOpfs([{ id: 'a1990', type: 'book', title: 'T' }])
    const { libraryReady } = await freshLibrary()
    const rs = await Promise.all([libraryReady(), libraryReady(), libraryReady()].map((p) => p.then(() => 'ok')))
    expect(rs).toEqual(['ok', 'ok', 'ok'])
  })
})
