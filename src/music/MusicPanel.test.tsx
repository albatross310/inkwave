// @vitest-environment jsdom
//
// THE LOAD-PATH CLAIM, tested where it can actually fail.
//
// §B7's catalogue is a ~3.4 MB git-tree request. It is behind the lazy chunk and the flag — but
// once a student opens /music?musicXml=1, nothing structural stops the panel fetching it eagerly.
// A catalogue fetched on panel mount would WORK PERFECTLY and silently cost 3.4 MB to every visitor
// who only wanted to open their own file. That is the exact shape of regression this repo keeps
// finding (a lane shipped 16 kB onto every writer's load path while truthfully reporting its own
// chunk), and no other test in this lane would notice it.
//
// OSMD is mocked — this is about network behaviour, not engraving.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    cursor = { reset() {}, show() {}, hide() {}, next() {}, update() {}, iterator: { EndReached: true, CurrentMeasureIndex: 0 } }
    zoom = 1
    constructor(_host: HTMLElement, _options: unknown) { /* not engraving here */ }
    async load() { /* resolves */ }
    render() { /* no-op */ }
    clear() { /* no-op */ }
  },
}))

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MusicPanel } from './MusicPanel'

const isTreeCall = (call: unknown[]) => String(call[0]).includes('git/trees')

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => cleanup())

describe('MusicPanel — the library costs nothing until it is asked for', () => {
  it('does NOT fetch the catalogue on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ truncated: false, tree: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<MusicPanel />)
    // Give any stray effect a chance to fire before concluding it didn't.
    await waitFor(() => expect(screen.getByText(/Browse public-domain scores/)).toBeTruthy())
    await new Promise(r => setTimeout(r, 20))

    expect(fetchMock.mock.calls.filter(isTreeCall)).toHaveLength(0)
  })

  it('DOES fetch it once the student opens the library (the positive arm)', async () => {
    // Without this, the test above would pass on a panel whose library is simply broken — "no
    // fetch" is trivially true of a feature that never works. Both arms, or neither means anything.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ truncated: false, tree: [{ path: 'scores/A,_B/_/T/lc1.mxl', type: 'blob' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<MusicPanel />)
    await user.click(screen.getByText(/Browse public-domain scores/))

    await waitFor(() => expect(fetchMock.mock.calls.filter(isTreeCall).length).toBe(1))
  })
})

describe('MusicPanel — copy (§C1.4, and the spec is wrong about encryption)', () => {
  it('says the true thing about storage and never claims encryption', () => {
    // §0/§1/§B2 of the music spec list "encryption at rest" among what is reused from the engine.
    // It does not exist (four lanes have now confirmed it independently). Zero-retention IS real,
    // so this is the sentence — and `src/copy/claims.test.ts` sweeps the repo for the other one.
    render(<MusicPanel />)
    expect(screen.getByText(/Stored on your device|stays on your device/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/encrypt/i)
  })

  it('says the score is never edited — Inkwave is not a notation editor (§0)', () => {
    render(<MusicPanel />)
    expect(screen.getByText(/never edits your notation/i)).toBeTruthy()
  })
})

describe('MusicPanel — the demo is labelled, never silent', () => {
  it('says the demo score is synthetic', async () => {
    // ?musicXml=demo puts a fixture on screen. A fixture the reader could mistake for their own
    // score is how a demo becomes a lie.
    render(<MusicPanel demo />)
    await waitFor(() => expect(screen.getByText(/synthetic|not a real score/i)).toBeTruthy())
  })

  it('shows no demo label when it is not a demo (the negative fires)', () => {
    render(<MusicPanel />)
    expect(screen.queryByText(/not a real score/i)).toBeNull()
  })
})
