// @vitest-environment jsdom
//
// The public-domain library (§B7). Network is FAKED here — a suite that hits GitHub would be slow,
// rate-limited (60/hour unauthenticated) and red whenever a corpus reorganised. What is NOT faked
// is the shape of the data: the tree fragments below are real paths copied from
// OpenScore/Lieder, including the awkward ones (accents, commas, apostrophes, '_' for "no set").
//
// The findings these tests encode were established against the LIVE corpora — see library.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  attributionFor,
  composers,
  CORPORA,
  fetchCatalogue,
  parseEntryPath,
  rawUrl,
  searchCatalogue,
  type Corpus,
  type LibraryEntry,
} from './library'

const LIEDER = CORPORA[0]

// Real paths from the corpus tree.
const REAL_PATHS = [
  'scores/Abbott,_Jane_Bingham/_/Just_for_Today/lc6583477.mxl',
  'scores/Abrams,_Harriett/_/The_Orphan’s_Prayer/lc6583966.mxl',
  'scores/Wolf,_Hugo/Mörike-Lieder/9_Nimmersatte_Liebe/lc4945954.mxl',
  'scores/Schoenberg,_Arnold/Das_Buch_der_hängenden_Gärten,_Op.15/10_Das_schöne_Beet_betracht_ich_mir_im_Harren/lc30509480.mxl',
]

const treeResponse = (paths: string[], extra: string[] = []) => ({
  ok: true,
  status: 200,
  json: async () => ({
    truncated: false,
    tree: [
      ...paths.map(path => ({ path, type: 'blob' })),
      ...extra.map(path => ({ path, type: 'blob' })),
    ],
  }),
})

beforeEach(() => { vi.restoreAllMocks() })

describe('the corpus allowlist — licensing discipline (§B7)', () => {
  it('lists only corpora with a verified public-domain licence', () => {
    for (const c of CORPORA) {
      expect(c.licence).toMatch(/^(CC0-1\.0|PD)$/)
      expect(c.licenceUrl).toMatch(/^https:\/\//)
    }
  })

  it('does NOT include OpenScore/StringQuartets — it contains no MusicXML', () => {
    // Checked live: 122 .mscx (MuseScore's own format, which OSMD cannot read) and zero .mxl.
    // The spec names "string quartets" as a source; wiring it would fill the library with scores
    // that fail to open.
    expect(CORPORA.map(c => c.repo)).not.toContain('OpenScore/StringQuartets')
  })

  it('never reaches MuseScore.com user uploads', () => {
    // Those include in-copyright arrangements. This is the line the spec draws and it is the whole
    // reason sources are an allowlist rather than a search.
    for (const c of CORPORA) {
      expect(c.repo).toMatch(/^OpenScore\//)
      expect(rawUrl(c, parseEntryPath(REAL_PATHS[0], c.id)!)).toContain('raw.githubusercontent.com')
      expect(rawUrl(c, parseEntryPath(REAL_PATHS[0], c.id)!)).not.toContain('musescore.com')
    }
  })

  it('attaches corpus, licence and a checkable source URL to every library score', () => {
    const entry = parseEntryPath(REAL_PATHS[0], LIEDER.id)!
    const attr = attributionFor(LIEDER, entry)
    expect(attr).toEqual({
      corpus: 'OpenScore Lieder Corpus',
      licence: 'CC0-1.0',
      sourceUrl: expect.stringContaining('raw.githubusercontent.com/OpenScore/Lieder/main/scores/'),
    })
  })
})

describe('parseEntryPath', () => {
  it('reads composer, collection and title from a real path', () => {
    expect(parseEntryPath('scores/Wolf,_Hugo/Mörike-Lieder/9_Nimmersatte_Liebe/lc4945954.mxl', 'x')).toEqual({
      path: 'scores/Wolf,_Hugo/Mörike-Lieder/9_Nimmersatte_Liebe/lc4945954.mxl',
      corpusId: 'x',
      composer: 'Wolf, Hugo',
      collection: 'Mörike-Lieder',
      title: '9 Nimmersatte Liebe',
    })
  })

  it('treats the corpus’s "_" placeholder as no collection', () => {
    // A standalone song. Rendering "_" as a set name would be visible nonsense in the browser.
    expect(parseEntryPath(REAL_PATHS[0], 'x')?.collection).toBe('')
  })

  it('ignores everything that is not MusicXML', () => {
    // Each score's folder also holds .mscz, .mscx, .txt and a README — the corpus ships four
    // formats side by side, and only one of them is ours.
    expect(parseEntryPath('scores/A,_B/_/T/lc1.mscz', 'x')).toBeNull()
    expect(parseEntryPath('scores/A,_B/_/T/lc1.mscx', 'x')).toBeNull()
    expect(parseEntryPath('scores/A,_B/_/T/README.md', 'x')).toBeNull()
    expect(parseEntryPath('data/scores.tsv', 'x')).toBeNull()
    expect(parseEntryPath('LICENSE.txt', 'x')).toBeNull()
  })

  it('ignores a path of the wrong depth rather than inventing fields', () => {
    expect(parseEntryPath('scores/weird/lc1.mxl', 'x')).toBeNull()
    expect(parseEntryPath('elsewhere/A/B/C/lc1.mxl', 'x')).toBeNull()
  })
})

describe('rawUrl', () => {
  it('escapes accents, commas and apostrophes in a real path', () => {
    // "The_Orphan’s_Prayer" and "Mörike-Lieder" are real folder names. An unescaped URL 404s.
    const entry = parseEntryPath(REAL_PATHS[1], LIEDER.id)!
    const url = rawUrl(LIEDER, entry)
    expect(url).toContain('%E2%80%99')          // the ’ apostrophe
    expect(url).not.toContain('’')
  })

  it('keeps the path separators as separators', () => {
    // encodeURIComponent would turn every / into %2F and break every download.
    const url = rawUrl(LIEDER, parseEntryPath(REAL_PATHS[0], LIEDER.id)!)
    expect(url).toContain('/scores/')
    expect(url).not.toContain('%2F')
  })
})

describe('fetchCatalogue', () => {
  it('derives the catalogue from the git TREE, keeping only real MusicXML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeResponse(REAL_PATHS, [
      'scores/Abbott,_Jane_Bingham/_/Just_for_Today/lc6583477.mscz',
      'scores/Abbott,_Jane_Bingham/_/Just_for_Today/README.md',
      'data/scores.tsv',
    ])))
    const entries = await fetchCatalogue(LIEDER, { force: true })
    expect(entries).toHaveLength(REAL_PATHS.length)
    expect(entries.every(e => e.path.endsWith('.mxl'))).toBe(true)
  })

  it('asks GitHub for the recursive tree of the right repo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(treeResponse(REAL_PATHS))
    vi.stubGlobal('fetch', fetchMock)
    await fetchCatalogue(LIEDER, { force: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/OpenScore/Lieder/git/trees/main?recursive=1',
    )
  })

  it('refuses a TRUNCATED tree instead of offering a partial library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ truncated: true, tree: [{ path: REAL_PATHS[0], type: 'blob' }] }),
    }))
    // A silently partial catalogue is the worst outcome: the student's piece is simply "not in the
    // library" for no visible reason.
    await expect(fetchCatalogue(LIEDER, { force: true })).rejects.toThrow(/too large/)
  })

  it('says so LOUDLY when a corpus has no MusicXML (the StringQuartets case)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeResponse([], [
      'scores/Beethoven,_Ludwig_van/Op.18/1/lc1.mscx',
    ])))
    const fake: Corpus = { ...LIEDER, id: 'fake', name: 'Fake Corpus', repo: 'OpenScore/StringQuartets' }
    await expect(fetchCatalogue(fake, { force: true })).rejects.toThrow(/no MusicXML/)
  })

  it('explains a GitHub rate-limit rather than reporting an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }))
    await expect(fetchCatalogue(LIEDER, { force: true })).rejects.toThrow(/rate-limiting/)
  })

  it('reports any other GitHub failure with its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    await expect(fetchCatalogue(LIEDER, { force: true })).rejects.toThrow(/GitHub returned 500/)
  })
})

describe('searchCatalogue', () => {
  const entries = REAL_PATHS.map(p => parseEntryPath(p, LIEDER.id)!) as LibraryEntry[]

  it('finds by composer, title and collection', () => {
    expect(searchCatalogue(entries, 'wolf').map(e => e.composer)).toEqual(['Wolf, Hugo'])
    expect(searchCatalogue(entries, 'orphan')).toHaveLength(1)
    expect(searchCatalogue(entries, 'Mörike')).toHaveLength(1)
  })

  it('is case-insensitive and returns everything for an empty query', () => {
    expect(searchCatalogue(entries, 'WOLF')).toHaveLength(1)
    expect(searchCatalogue(entries, '   ')).toHaveLength(entries.length)
  })

  it('finds nothing for a miss (the negative fires)', () => {
    expect(searchCatalogue(entries, 'zzzz-not-a-composer')).toEqual([])
  })

  it('lists composers uniquely and sorted', () => {
    expect(composers(entries)).toEqual([
      'Abbott, Jane Bingham', 'Abrams, Harriett', 'Schoenberg, Arnold', 'Wolf, Hugo',
    ])
  })
})

describe('the CSP permits §B7 — without this the library is dead in production', () => {
  // Dev runs no middleware, so a missing directive works perfectly locally and fails only once
  // deployed. That is the exact trap this repo asked to be checked rather than discovered.
  const csp = readFileSync(resolve(__dirname, '../../middleware.ts'), 'utf8')
  const connectSrc = /"connect-src ([^"]+)"/.exec(csp)?.[1] ?? ''

  it('found the connect-src directive to check (the probe is real)', () => {
    expect(connectSrc).toContain("'self'")
  })

  it('allows the GitHub hosts the library actually calls', () => {
    expect(connectSrc).toContain('https://api.github.com')
    expect(connectSrc).toContain('https://raw.githubusercontent.com')
  })

  it('covers every host this module can reach', () => {
    const source = readFileSync(resolve(__dirname, 'library.ts'), 'utf8')
    for (const [, host] of source.matchAll(/['"`](https:\/\/[a-z0-9.-]+)/g)) {
      // github.com links are documentation (the licence URL), not fetches.
      if (host === 'https://github.com') continue
      expect(connectSrc, `${host} must be in connect-src`).toContain(host)
    }
  })
})
