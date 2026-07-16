// The MusicXML PATH's own sub-flag (build spec §C2 step 6 / PART B). DEFAULT OFF.
//
// ─── Why a second flag, and why it is not the `flag.ts` mistake ──────────────────────────────
// `flag.ts` (`?music`) gates the MUSIC MODULE and is owned by the photo lane. This gates one PATH
// INSIDE it — the MusicXML entry (§B) as distinct from the photo entry (§A) — and it exists because
// the two paths landed on separate branches and must be switchable independently while they do.
//
// CLAUDE.md warns that "a flag.ts/flags.ts pair in one directory is how someone imports the wrong
// feature and never notices" (the prodLedger/prodReport rename). The names here are deliberately
// NOT near-synonyms: `music` = the module, `musicXml` = one path within it. `?musicXml` IMPLIES the
// module, so a reader never has to hold two switches at once.
//
//   ?musicXml=1     on
//   ?musicXml=demo  on + the LABELLED synthetic fixture score (scoreFixtures.ts)
//   ?musicXml=off   clears
//
// ⚠️ THIS IS A SEAM, NOT A DESTINATION — reported to the coordinator rather than decided here.
// §1 makes `source: { type: "photo" | "musicxml" }` a property of ONE Piece, so the end state is a
// single surface where the student picks how the score comes in, not two flags. Collapsing them
// means editing the photo lane's `MusicStudio`, which is that lane's call to make. Until then the
// module's default behaviour is BYTE-UNCHANGED: no `?musicXml` ⇒ `/music` renders exactly what it
// rendered before this lane existed.
//
// STICKY, resolved ONCE per load (the `?auth` / `?prodGraphs` / `?snapThumbs` pattern): a flag read
// fresh from the URL dies the moment any local-first navigation rewrites it — which silently
// disabled snapThumbs exactly when it was being used (CLAUDE.md, snapThumbs round 8, bug 2).

type Pair = { on: boolean; demo: boolean }

let _flags: Pair | null = null

function resolve(): Pair {
  let on = false, demo = false
  try {
    const p = new URLSearchParams(window.location.search).get('musicXml')
    if (p === 'off') {
      window.localStorage.removeItem('inkwave:musicXml')
      window.localStorage.removeItem('inkwave:musicXmlDemo')
    } else if (p === 'demo') {
      window.localStorage.setItem('inkwave:musicXml', '1')
      window.localStorage.setItem('inkwave:musicXmlDemo', '1')
    } else if (p === '1') {
      window.localStorage.setItem('inkwave:musicXml', '1')
      window.localStorage.removeItem('inkwave:musicXmlDemo')
    }
    on = window.localStorage.getItem('inkwave:musicXml') === '1'
    demo = window.localStorage.getItem('inkwave:musicXmlDemo') === '1'
  } catch { /* SSR/prerender or private mode → stays off */ }
  return { on, demo }
}

function flags(): Pair {
  if (!_flags) _flags = resolve()
  return _flags
}

/** Whether the MusicXML path is showing. Default OFF. Implies the music module. */
export function musicXmlEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwMusicXml?: boolean }) : null
  if (w && typeof w.__iwMusicXml === 'boolean') return w.__iwMusicXml
  return flags().on
}

/** `?musicXml=demo` — the labelled synthetic score. Never a real score, never silent. */
export function musicXmlDemo(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwMusicXmlDemo?: boolean }) : null
  if (w && typeof w.__iwMusicXmlDemo === 'boolean') return w.__iwMusicXmlDemo
  return flags().demo
}

/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetMusicXmlFlagForTest(): void { _flags = null }
