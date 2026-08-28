// The wire shape of a fetched source. MIRRORS api/_reader-core.mjs, which is a Node ESM module
// outside the TS project — so this is a hand-kept contract, and the reader's tests assert the real
// server core produces exactly it rather than trusting the mirror (the interop pattern verify/ uses
// against the signing core).

export type Run = { text: string; href?: string; em?: boolean; strong?: boolean; code?: boolean }

export type ReaderBlock =
  | { kind: 'heading'; level: number; id: string; runs: Run[]; text: string }
  | { kind: 'para'; runs: Run[]; text: string }
  | { kind: 'quote'; runs: Run[]; text: string }
  | { kind: 'code'; runs: Run[]; text: string }
  | { kind: 'list'; ordered: boolean; items: Run[][] }

export type ReaderDoc = { url: string; title: string; blocks: ReaderBlock[] }

/**
 * A heading → the locator a citation should carry. Numbered headings ("2.1 Relative Identity",
 * "§3", "Chapter 4") give a SECTION locator of just the number, which is what a reader can look up;
 * an unnumbered heading has no number to give, so its TITLE travels verbatim rather than being
 * turned into one — inventing "§1" from position would be a number that is not in the source.
 */
export function locatorForHeading(text: string): { kind: 'section' | 'chapter' | 'verbatim'; value: string } {
  const t = text.replace(/\s+/g, ' ').trim()
  let m = /^(?:§\s*)?(\d+(?:\.\d+)*)[.)]?\s+\S/.exec(t)
  if (m) return { kind: 'section', value: m[1] }
  m = /^(?:chapter|part)\s+(\d+|[ivxlc]+)\b/i.exec(t)
  if (m) return { kind: 'chapter', value: m[1] }
  return { kind: 'verbatim', value: t }
}
