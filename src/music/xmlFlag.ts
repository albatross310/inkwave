// The MusicXML PATH's own sub-flag (build spec v0.1 §C2 step 6 / PART B). DEFAULT OFF.
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
// means editing the photo lane's `MusicStudio`, which is that lane's call to make.
//
// ─── THE ONE THING TO NOTICE NEXT TO ITS NEIGHBOUR ───────────────────────────────────────────
// `?music` next door is DEFAULT ON and records its opt-out as a sticky '0'. This one is DEFAULT
// OFF, so its `off` is an ABSENCE — and it must be: under a present-means-on reader a '0' would
// also read as off, so the two are indistinguishable from the flag's own answer and only differ in
// what is left in storage. The shared core derives both from `defaultOn` rather than leaving two
// lanes to pick a spelling each.
import { stickyFlag } from '../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:musicXml',
  param: 'musicXml',
  defaultOn: false,
  companionKey: 'inkwave:musicXmlDemo',
  override: '__iwMusicXml',
  companionOverride: '__iwMusicXmlDemo',
})

/** Whether the MusicXML path is showing. Default OFF. Implies the music module. */
export function musicXmlEnabled(): boolean { return flag.enabled() }

/** `?musicXml=demo` — the labelled synthetic score. Never a real score, never silent. */
export function musicXmlDemo(): boolean { return flag.demo() }

/** Tests only: forget the resolved flags so a suite can re-resolve them. */
export function __resetMusicXmlFlagForTest(): void { flag.reset() }
