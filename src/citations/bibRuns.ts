// CSL ENTRY HTML → INLINE RUNS (2026-07-17).
//
// citeproc emits each `.csl-entry` as HTML, and it CARRIES MARKUP: `<i>` around container titles is
// the common one (APA italicises the journal/book), `<b>` and `<span style="font-style:italic">`
// appear in other styles. Stripping to plain text would measure the wrong glyphs — an italic face
// has different advances, so a stripped entry wraps at a different column and the entry's LINE COUNT
// (i.e. its height) comes out wrong. The renderer's whole claim is that it draws what the editor
// draws, so the markup has to survive into the run list.
//
// SCOPE, deliberately narrow: this parses the SUBSET citeproc actually emits — inline emphasis and
// spans — into {text, italic, bold} runs. It is NOT a general HTML engine. Anything it does not
// understand (a nested block, an unknown tag with its own box) makes it return null ⇒ the caller
// DEFERS. An unparseable entry must never be silently flattened into a height.
//
// THE CHROME IS NOT PARSED HERE. The `↩` back-refs, the `esp. pp` span and the `+` note button are
// injected by ReferenceListNodeView AFTER citeproc, and they are not text — they are boxes with
// their own padding/border/font-size whose geometry only the DOM knows. They arrive here as ATOM
// runs carrying no box; supplying their real boxes is the caller's job (refChrome.ts), and a missing
// box defers the block. See `parseEntryHtml`'s CHROME_SELECTORS.

/** One parsed piece of an entry: text in a face, or an opaque chrome atom to be boxed by the caller. */
export interface BibRun {
  text: string
  italic: boolean
  bold: boolean
  /** Set when this run is a chrome ATOM (back-ref group / esp / note button) rather than text. */
  atom?: 'backref' | 'esp' | 'note'
}

// The chrome injected by decorateEntry(). Each is an inline box the DOM owns, NOT text we may shape.
const CHROME: Array<{ sel: string; kind: 'backref' | 'esp' | 'note' }> = [
  { sel: '.iw-backref-group', kind: 'backref' },
  { sel: '.iw-esp', kind: 'esp' },
  { sel: '.iw-note-add', kind: 'note' },
]

// Tags whose CONTENT is inline text we can shape. Anything outside this set is a refusal, not a
// guess — a tag we don't model may carry a box (display, padding, a different font) we cannot see.
const INLINE_OK = new Set(['I', 'EM', 'B', 'STRONG', 'SPAN', 'A', 'DIV', 'P', 'SUP', 'SUB', 'SMALL'])
// SUP/SUB are ACCEPTED into the walk but REFUSED below: they render at a smaller size on a raised
// baseline, which this run model has no way to express. Listing them here rather than letting them
// fall into the generic refusal keeps the reason honest in the returned error.
const REFUSE = new Set(['SUP', 'SUB'])

export interface ParsedEntry {
  runs: BibRun[]
  /** Why we refused, when runs is empty. Reported by the coverage map — never swallowed. */
  refusal?: string
}

/**
 * Parse ONE `.csl-entry` html string into runs. Returns `{ runs }` on success, or `{ runs: [],
 * refusal }` when the markup contains something this model cannot honestly represent.
 *
 * Needs a DOM (it uses the browser's own parser rather than a regex — an entity- and
 * attribute-correct HTML parse is not something to hand-roll next to a provenance chain).
 */
export function parseEntryHtml(html: string): ParsedEntry {
  if (typeof document === 'undefined') return { runs: [], refusal: 'no-dom' }
  const host = document.createElement('div')
  host.innerHTML = html
  const runs: BibRun[] = []
  let refusal: string | undefined

  const walk = (node: Node, italic: boolean, bold: boolean): void => {
    if (refusal) return
    if (node.nodeType === 3) {
      const t = node.textContent ?? ''
      if (t) runs.push({ text: t, italic, bold })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as HTMLElement
    const tag = el.tagName

    // Chrome first: it is an ATOM, and its subtree must NOT be walked as text.
    for (const c of CHROME) {
      if (el.matches(c.sel)) { runs.push({ text: '', italic: false, bold: false, atom: c.kind }); return }
    }
    if (!INLINE_OK.has(tag)) { refusal = `tag:${tag.toLowerCase()}`; return }
    if (REFUSE.has(tag)) { refusal = `tag:${tag.toLowerCase()}`; return }

    // Emphasis comes from the TAG and from an inline style — citeproc uses both depending on style.
    const st = el.getAttribute('style') ?? ''
    const it = italic || tag === 'I' || tag === 'EM' || /font-style:\s*italic/i.test(st)
    const bd = bold || tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/i.test(st)
    for (const child of Array.from(el.childNodes)) walk(child, it, bd)
  }

  for (const child of Array.from(host.childNodes)) walk(child, false, false)
  if (refusal) return { runs: [], refusal }

  // Merge adjacent runs in the same face — fewer, longer measureText calls, identical shaping
  // (the engine measures a run as a unit, and concatenating two same-face runs cannot change it).
  const merged: BibRun[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && !last.atom && !r.atom && last.italic === r.italic && last.bold === r.bold) last.text += r.text
    else merged.push({ ...r })
  }
  return { runs: merged }
}
