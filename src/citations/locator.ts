// WHAT PART OF THE SOURCE IS BEING CITED — pages, but also sections, paragraphs, chapters, lines.
//
// Peter, 2026-08-28: "we need to add a feature where you can cite paragraphs etc." Until now the
// locator was a free string that the popover labelled "p." and the renderer prefixed with p./pp. by
// counting commas and dashes — so a philosophy writer citing an SEP article by section had no way
// to say so, and "§2.1" rendered as "p. §2.1".
//
// ⚠ THIS IS DISPLAY ONLY, AND THAT IS LOAD-BEARING. `citationText` (provenance/bundle.ts) — the
// function whose output is hashed, anchored to Bitcoin and recomputed by the verifier — emits the
// locator VALUE verbatim (`, ${locator}`) and has never read a label. So a label cannot move a
// single byte of pmToText, which is why this can ship without a bundle version. Do not "improve"
// citationText to include the label without reading provenance/bundle.ts's own warning first.
//
// TWO WAYS IN, both of them Peter's ask ("both by highlighting the headings and simply writing it
// out"): pick a kind from the popover, or just TYPE it. A value that already carries its own marker
// — "§2.1", "¶4", "ch. 2", "sec. 3" — is rendered VERBATIM whatever the kind says, because a writer
// who has spelled out what they mean should not have their words re-prefixed. That is what makes
// the typed path work with no interaction at all.

export type LocatorKind = 'page' | 'section' | 'paragraph' | 'chapter' | 'part' | 'line' | 'note' | 'verbatim'

/** The picker's contents. `short` is what appears beside the input; `label` names it in the list. */
export const LOCATOR_KINDS: Array<{ kind: LocatorKind; short: string; label: string }> = [
  { kind: 'page',      short: 'p.',  label: 'page' },
  { kind: 'section',   short: '§',   label: 'section' },
  { kind: 'paragraph', short: '¶',   label: 'paragraph' },
  { kind: 'chapter',   short: 'ch.', label: 'chapter' },
  { kind: 'part',      short: 'pt.', label: 'part' },
  { kind: 'line',      short: 'l.',  label: 'line' },
  { kind: 'note',      short: 'n.',  label: 'note' },
  { kind: 'verbatim',  short: '—',   label: 'as written' },
]

export const DEFAULT_LOCATOR_KIND: LocatorKind = 'page'

/** A locator whose FIRST token already announces what it is. Matched at the start only: "chapter 2"
 *  is self-labelled, "the argument of chapter 2" is a prefix the writer typed into `prefix`. */
const SELF_LABELLED = /^\s*(?:[§¶]|p{1,2}\.|pp?\s|sec(?:t|tion)?s?\b|§§|para(?:graph)?s?\b|ch(?:ap(?:ter)?)?s?\b|pt\.?\s|part\b|lines?\b|l{1,2}\.|nn?\.|notes?\b|v(?:er)?s?\.)/i

export function isSelfLabelled(value: string): boolean {
  return SELF_LABELLED.test(value)
}

/** True when the value names more than one of whatever it is (a range or a list) — "pp." not "p.". */
export function isPlural(value: string): boolean {
  return /[,;]/.test(value) || /\d\s*[–—-]\s*\d/.test(value)
}

/**
 * The label a reader sees: "p. 5", "pp. 3–7", "§2.1", "¶4", "ch. 2".
 * Returns '' for an empty value so callers can test it directly.
 */
export function formatLocator(value: string | null | undefined, kind: LocatorKind = DEFAULT_LOCATOR_KIND): string {
  const v = (value ?? '').trim()
  if (!v) return ''
  if (kind === 'verbatim' || isSelfLabelled(v)) return v
  switch (kind) {
    // The section and paragraph signs sit TIGHT against their number — that is how they are set in
    // print, and a space reads as a typo.
    case 'section':   return `${isPlural(v) ? '§§' : '§'}${v}`
    case 'paragraph': return `${isPlural(v) ? '¶¶' : '¶'}${v}`
    case 'chapter':   return `${isPlural(v) ? 'chs.' : 'ch.'} ${v}`
    case 'part':      return `${isPlural(v) ? 'pts.' : 'pt.'} ${v}`
    case 'line':      return `${isPlural(v) ? 'll.' : 'l.'} ${v}`
    case 'note':      return `${isPlural(v) ? 'nn.' : 'n.'} ${v}`
    case 'page':
    default:          return `${isPlural(v) ? 'pp.' : 'p.'} ${v}`
  }
}

/** Only a PAGE locator can be merged with pages harvested from PDF highlights — a section number
 *  and a page number are not the same quantity, and unioning them would print "§2.1, 7". */
export function mergesWithPdfPages(kind: LocatorKind): boolean {
  return kind === 'page'
}

export function asLocatorKind(v: unknown): LocatorKind {
  return LOCATOR_KINDS.some((k) => k.kind === v) ? (v as LocatorKind) : DEFAULT_LOCATOR_KIND
}
