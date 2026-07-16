// @vitest-environment jsdom
//
// The §B7 browser's contract. The network is stubbed at `fetch` — the DATA layer's behaviour
// (licensing allowlist, git-tree derivation, rate-limit handling) is `library.test.ts`'s; this is
// about what the surface does with it.
//
// The load-path claim gets its own test, and it is the one that matters: the catalogue is a ~3.4 MB
// request, and "on demand" is a property nothing else in the suite would notice being broken.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LibraryBrowser } from './LibraryBrowser'
import { CORPORA } from './library'

const PATHS = [
  'scores/Wolf,_Hugo/Mörike-Lieder/9_Nimmersatte_Liebe/lc4945954.mxl',
  'scores/Abrams,_Harriett/_/The_Orphan’s_Prayer/lc6583966.mxl',
  'scores/Abbott,_Jane_Bingham/_/Just_for_Today/lc6583477.mxl',
]

const treeOk = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    truncated: false,
    tree: [
      ...PATHS.map(path => ({ path, type: 'blob' })),
      // The corpus ships four formats per folder; only one of them is ours.
      { path: 'scores/Wolf,_Hugo/Mörike-Lieder/9_Nimmersatte_Liebe/lc4945954.mscz', type: 'blob' },
      { path: 'data/scores.tsv', type: 'blob' },
    ],
  }),
})

beforeEach(() => {
  vi.restoreAllMocks()
  // The catalogue cache lives in OPFS, which jsdom has none of — every test starts cold, which is
  // what we want here (the cache is library.test.ts's business).
})
afterEach(() => cleanup())

describe('LibraryBrowser — the load path', () => {
  it('fetches the catalogue ONCE on mount, asking for the tree', async () => {
    const fetchMock = vi.fn().mockResolvedValue(treeOk())
    vi.stubGlobal('fetch', fetchMock)

    render(<LibraryBrowser onImported={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // The tree, not 1462 individual file requests.
    expect(String(fetchMock.mock.calls[0][0])).toContain('git/trees')
  })

  // NOTE — a test that was DECORATION, and why it is gone. This block first asserted
  // `expect(fetchMock).not.toHaveBeenCalled()` BEFORE render(), as "importing the module must not
  // fetch". It could never fail: this file imports LibraryBrowser at module load, long before
  // `beforeEach` installs the stub, so a module-scope fetch would have used the REAL fetch and the
  // mock would still have read zero. It asserted the ordering of its own imports, not the code's
  // behaviour. The claim it was reaching for — "no catalogue until the student asks" — is a
  // property of the PANEL, and is tested where it can actually fire: MusicPanel.test.tsx.
})

describe('LibraryBrowser — listing', () => {
  it('lists the scores the catalogue really contains', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeOk()))
    render(<LibraryBrowser onImported={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Just for Today')).toBeTruthy())
    expect(screen.getByText('9 Nimmersatte Liebe')).toBeTruthy()
    // The .mscz sibling and the TSV are not scores we can open — they must not appear.
    expect(screen.getByText(/3 of 3 scores/)).toBeTruthy()
  })

  it('states the corpus and its licence — attribution is not optional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeOk()))
    render(<LibraryBrowser onImported={vi.fn()} />)
    expect(screen.getByText(CORPORA[0].name)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/CC0-1\.0/)).toBeTruthy())
  })

  it('filters by search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeOk()))
    const user = userEvent.setup()
    render(<LibraryBrowser onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Just for Today')).toBeTruthy())

    await user.type(screen.getByLabelText('Search the library'), 'wolf')
    await waitFor(() => expect(screen.queryByText('Just for Today')).toBeNull())
    expect(screen.getByText('9 Nimmersatte Liebe')).toBeTruthy()
  })

  it('says so when a search matches nothing, rather than showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeOk()))
    const user = userEvent.setup()
    render(<LibraryBrowser onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Just for Today')).toBeTruthy())

    await user.type(screen.getByLabelText('Search the library'), 'zzzz')
    await waitFor(() => expect(screen.getByText(/No scores match/)).toBeTruthy())
  })
})

describe('LibraryBrowser — failure is announced', () => {
  it('reports a GitHub rate-limit as a rate-limit, never as an empty library', async () => {
    // 60/hour unauthenticated is the likeliest failure by far, and "the library is empty" would be
    // the wrong story to tell about it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }))
    render(<LibraryBrowser onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/rate-limiting/))
  })

  it('reports a download failure without losing the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(treeOk())
      .mockResolvedValueOnce({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<LibraryBrowser onImported={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Just for Today')).toBeTruthy())
    await user.click(screen.getByText('Just for Today'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be downloaded|GitHub returned 500/))
    expect(screen.getByText('Just for Today')).toBeTruthy() // the list survives
  })
})
