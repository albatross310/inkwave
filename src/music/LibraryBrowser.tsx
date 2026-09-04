// The public-domain library browser (build spec §B7).
//
//   "a student opens Inkwave, picks a public-domain piece from the library, and immediately gets
//    rendered notation + auto cursor + playback + annotation — no photographing, no OMR, no
//    file-hunting."
//
// The data layer (`library.ts`) owns the licensing discipline and the GitHub integration; this is
// only its surface. Three things it must not undo:
//
//  1. ATTRIBUTION IS NOT DECORATION. Every row states its corpus + licence, because CC0 asks for
//     attribution and because a student citing a score in a graded essay needs to know where it
//     came from. It travels into the master's metadata on import (`MasterMeta.attribution`), so it
//     survives past this screen.
//  2. THE CATALOGUE IS FETCHED ON DEMAND, NEVER ON LOAD. It is a ~3.4 MB git-tree request behind
//     BOTH the lazy chunk and the flag, and it only fires when the student opens this panel.
//     CLAUDE.md: nothing that hits the network per-item may run on the load path.
//  3. A FAILURE SAYS SO. GitHub rate-limits unauthenticated callers at 60/hour; that must read as
//     "GitHub is rate-limiting this device", never as an empty library.

import { useEffect, useMemo, useState } from 'react'
import {
  CORPORA,
  composers,
  fetchCatalogue,
  importFromLibrary,
  searchCatalogue,
  type Corpus,
  type LibraryEntry,
} from './library'
import type { MasterMeta } from './master'
import { type_ } from './typeScale'

// Peter 2026-07-17: every font proportionally up. Sizes from typeScale.ts, never a text-* class.
const muted = { color: 'var(--iw-pill-fg, #78716c)', ...type_('meta') }
const ink = { color: 'var(--iw-ink, #302438)' }
const border = { border: '1px solid var(--iw-nightable-border, #d6d3d1)' }

/** How many rows to show at once. The Lieder corpus is 1462 scores; a full list is unreadable. */
const PAGE = 40

export interface LibraryBrowserProps {
  onImported: (meta: MasterMeta) => void
  corpus?: Corpus
}

export function LibraryBrowser({ onImported, corpus = CORPORA[0] }: LibraryBrowserProps) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  // On demand, on mount of THIS panel — not on route load, and not on app load.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCatalogue(corpus)
      .then(list => { if (!cancelled) { setEntries(list); setError(null) } })
      .catch((e: unknown) => {
        if (cancelled) return
        // Loud and specific. An empty list here would read as "the library has nothing in it".
        setError(e instanceof Error ? e.message : 'The library could not be opened.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [corpus])

  const filtered = useMemo(() => {
    if (!entries) return []
    const byComposer = composer ? entries.filter(e => e.composer === composer) : entries
    return searchCatalogue(byComposer, query)
  }, [entries, composer, query])

  useEffect(() => { setShown(PAGE) }, [query, composer])

  const pick = async (entry: LibraryEntry) => {
    setBusy(entry.path)
    setError(null)
    try {
      const { meta, deduped } = await importFromLibrary(corpus, entry)
      if (deduped) setError(`You already had “${meta.title || entry.title}” — opening your copy.`)
      onImported(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : `“${entry.title}” could not be downloaded.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="iw-nightable my-3 pt-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #e7e5e4)' }}>
      <h2 className="font-serif" style={{ ...ink, ...type_('heading') }}>{corpus.name}</h2>
      <p className="font-serif mb-2" style={muted}>
        Public-domain scores ({corpus.licence}). Nothing here is in copyright — and Inkwave only
        lists corpora whose licence has been checked.
      </p>

      <div className="flex flex-wrap gap-2 mb-2">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search composer or title"
          aria-label="Search the library"
          className="font-serif px-2 py-1 rounded"
          style={{ ...border, ...type_('label') }}
        />
        {entries && entries.length > 0 && (
          <select
            value={composer}
            onChange={e => setComposer(e.target.value)}
            aria-label="Filter by composer"
            className="font-serif px-2 py-1 rounded"
            style={{ ...border, ...type_('label') }}
          >
            <option value="">All composers</option>
            {composers(entries).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="font-serif" style={muted}>Opening the library…</p>}

      {error && (
        <p role="alert" className="font-serif my-2" style={{ color: 'var(--iw-badge-ai, #b45309)', ...type_('meta') }}>{error}</p>
      )}

      {entries && !loading && (
        <p className="font-serif mb-1" style={muted}>
          {filtered.length} of {entries.length} scores
        </p>
      )}

      <ul className="font-serif" style={type_('body')}>
        {filtered.slice(0, shown).map(entry => (
          <li key={entry.path}>
            <button
              onClick={() => void pick(entry)}
              disabled={busy !== null}
              className="text-left w-full py-1 px-2 rounded hover:bg-stone-50 disabled:opacity-50"
            >
              <span style={ink}>{entry.title}</span>
              <span style={muted}> · {entry.composer}</span>
              {entry.collection && <span style={muted}> · {entry.collection}</span>}
              {busy === entry.path && <span style={muted}> · downloading…</span>}
            </button>
          </li>
        ))}
      </ul>

      {filtered.length > shown && (
        <button
          onClick={() => setShown(n => n + PAGE)}
          className="font-serif mt-2 px-2 py-1 rounded"
          style={{ ...border, ...ink, ...type_('label') }}
        >
          Show more
        </button>
      )}

      {entries && filtered.length === 0 && !loading && (
        <p className="font-serif" style={muted}>No scores match that search.</p>
      )}
    </section>
  )
}

export default LibraryBrowser
