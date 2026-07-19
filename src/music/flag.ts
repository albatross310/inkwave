// Music module feature flag — GRADUATED TO DEFAULT ON (2026-07-18).
//
// Peter, 2026-07-18: stop flagging finished features. Both halves of the module are now real — the
// toolbar's ♪ BAR LAYER opens MusicStudio / MusicPanel as a panel over the editor (the dead `/music`
// route is retired), the MusicXML import is reachable there, and the photo→Piece creation flow
// mints a real `docType:'music'` document from an imported photo — so the studio reaches a REAL
// score, not just the demo/harness. It ships live for every writer. `?music` remains only to turn it
// OFF or to force the demo:
//
//   (no param)   ON — the graduated default
//   ?music=1     on (explicit; also re-arms after a previous ?music=off)
//   ?music=demo  on + a synthetic, LABELLED demo piece (no real score — see fixtures.ts)
//   ?music=off   OFF — persisted as '0', sticky across loads (only an explicit '0' turns it off)
//
// STILL STICKY, resolved ONCE per load (the `?auth` / `?prodGraphs` / `?snapThumbs` pattern): a flag
// read fresh from the URL DIES the moment any local-first navigation rewrites it — which silently
// disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs round 8, bug 2). Resolve
// once, persist, then read from storage. Don't reintroduce a live URL read.
//
// LAZINESS SURVIVES GRADUATION: the heavy panels (OSMD, the detector) still sit behind
// `components/MusicBar.tsx`'s `lazy(() => import(...))`, itself behind the editor's own dynamic
// import, so the editor's static graph reaches ONLY this tiny flag leaf and the panels are fetched
// only when a writer opens the ♪ bar and clicks a button. `music/chunk.test.ts` asserts it. CLAUDE.md:
// load performance is sacred, flag on or off.

type Pair = { on: boolean; demo: boolean }

let _flags: Pair | null = null

const KEY = 'inkwave:music'

function resolve(): Pair {
  // DEFAULT ON — only an explicit persisted '0' (from ?music=off) turns the module off.
  let on = true, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get('music')
    if (p === 'off') {
      window.localStorage.setItem(KEY, '0')
      window.localStorage.removeItem('inkwave:musicDemo')
    } else if (p === 'demo') {
      window.localStorage.setItem(KEY, '1')
      window.localStorage.setItem('inkwave:musicDemo', '1')
    } else if (p === '1') {
      window.localStorage.setItem(KEY, '1')
      window.localStorage.removeItem('inkwave:musicDemo')
    }
    on = window.localStorage.getItem(KEY) !== '0'
    demo = window.localStorage.getItem('inkwave:musicDemo') === '1'
  } catch { on = true; demo = false /* SSR/prerender/private → the graduated default: ON */ }
  return { on, demo }
}

function flags(): Pair {
  if (!_flags) _flags = resolve()
  return _flags
}

/** Whether the music module is available at all. Default ON (graduated 2026-07-18). */
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
