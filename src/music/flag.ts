// Music module feature flag — DEFAULT OFF.
//
// STICKY URL FLAG (the `?auth` / `?prodGraphs` / `?snapThumbs` pattern, and the round-8 lesson
// behind it): a flag read fresh from the URL DIES the moment any local-first navigation rewrites
// it — which silently disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs
// round 8, bug 2). Resolve ONCE per load, persist, then read from storage. Don't reintroduce it.
//
//   ?music=1     on
//   ?music=demo  on + a synthetic, LABELLED demo piece (no real score — see fixtures.ts)
//   ?music=off   clears
//
// OFF COSTS NOTHING BY CONSTRUCTION, not merely by measurement: the whole module sits behind a lazy
// import (`routes/Music.tsx`), so with the flag off nothing here is fetched or parsed and the editor
// bundle is untouched. CLAUDE.md: load performance is sacred.

type Pair = { on: boolean; demo: boolean }

let _flags: Pair | null = null

function resolve(): Pair {
  let on = false, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get('music')
    if (p === 'off') {
      window.localStorage.removeItem('inkwave:music')
      window.localStorage.removeItem('inkwave:musicDemo')
    } else if (p === 'demo') {
      window.localStorage.setItem('inkwave:music', '1')
      window.localStorage.setItem('inkwave:musicDemo', '1')
    } else if (p === '1') {
      window.localStorage.setItem('inkwave:music', '1')
      window.localStorage.removeItem('inkwave:musicDemo')
    }
    on = window.localStorage.getItem('inkwave:music') === '1'
    demo = window.localStorage.getItem('inkwave:musicDemo') === '1'
  } catch { /* SSR/prerender or private mode → stays off */ }
  return { on, demo }
}

function flags(): Pair {
  if (!_flags) _flags = resolve()
  return _flags
}

/** Whether the music module is available at all. Default OFF. */
export function musicEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwMusic?: boolean }) : null
  if (w && typeof w.__iwMusic === 'boolean') return w.__iwMusic
  return flags().on
}

/** `?music=demo` — render a synthetic, clearly-labelled piece. Never silent, never a real score. */
export function musicDemo(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwMusicDemo?: boolean }) : null
  if (w && typeof w.__iwMusicDemo === 'boolean') return w.__iwMusicDemo
  return flags().demo
}

/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetMusicFlagForTest(): void { _flags = null }

/**
 * Tests only: force the on-flag without a URL/localStorage/window (node env). Mirrors
 * ledgerFlag.setProdLedgerEnabled so the toolbar's music slot can be toggled the same way the
 * clock's is. Leaves `demo` as it was.
 */
export function setMusicEnabledForTest(on: boolean): void { _flags = { on, demo: _flags?.demo ?? false } }
