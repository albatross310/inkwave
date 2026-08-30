// CASTING A STORED INK FOR THE SURFACE IT IS DRAWN ON.
//
// A mark carries its own colour, chosen by the writer and stored in the mark (reader/marks.ts,
// citations/pdfHighlights.ts). That value is IDENTITY and this module never changes it — nothing
// here is ever written back, and `readerInk` is a DISPLAY function only.
//
// The distinction it exists to keep is between the two kinds of colour a mark can carry:
//
//   • A FILL — a highlight, a sticky note, a textbox. It is an opaque patch of a PALE colour with
//     text laid over it, so the surface behind it is irrelevant and the ink on top is always dark
//     (`--iw-reader-on-mark`). Nothing in this module touches those; they are painted at their
//     stored value in both themes, which is what keeps "one highlight is one colour on every
//     device" true.
//
//   • A STROKE — the writer's own coloured text (SourceBrowser's `TEXT_COLORS`). Here the colour IS
//     the readable element, so it has to be paired against the page. The four were chosen for white
//     paper — maroon `#991b1b` on the night reading surface `#26241f` measures about 1.5:1, and no
//     choice of dark surface rescues it (4.5:1 against that maroon needs a MID-TONE page, not a
//     night one). So the three non-purple inks get tokens, exactly as the app's own `--iw-ink` has
//     always been dark by day and light by night, and the CSS switches them.
//
// Anything not in the table passes through unchanged — a colour from a future palette renders at
// its stored value rather than being silently re-cast by a rule that never heard of it.

/** Stored ink → the token that displays it. Keys are the day palette, i.e. the stored values. */
const INK_TOKEN: Record<string, string> = {
  '#991b1b': '--iw-reader-ink-red',
  '#1e3a8a': '--iw-reader-ink-blue',
  '#166534': '--iw-reader-ink-green',
  '#5c2d8a': '--iw-reader-accent',
  // The highlighter TOOL's glyph — a dark gold that says "yellow highlighter" on a white control
  // face and dies on a dark one (measured 2.37:1 against the night control face, below the 3:1 a
  // glyph needs). Not a mark's stored colour, but the same kind of thing: a stroke whose colour is
  // the readable element, so it takes the same casting rather than a rule of its own.
  '#8a6a04': '--iw-reader-ink-gold',
}

/**
 * The CSS colour to PAINT a stored text-ink with. Returns a `var(--token, <stored>)`, so the stored
 * value is still the fallback and an engine that cannot resolve the token renders today's colour.
 */
export function readerInk(stored: string): string {
  const token = INK_TOKEN[stored.trim().toLowerCase()]
  return token ? `var(${token}, ${stored})` : stored
}

/** The inks this module knows how to cast — for tests, so the list cannot silently drift. */
export const CASTABLE_INKS = Object.keys(INK_TOKEN)
