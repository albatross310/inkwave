// Sentence-completion detector for the "Snapshot every: sentence" cadence (Peter, 2026-09-17).
// A sentence completes when terminal punctuation (. ! ?) — optionally followed by closing quotes or
// brackets — is followed by whitespace or a paragraph break. Pure string logic; the editor decides
// WHEN to ask (after the keystroke that inserted the space/newline, or on Enter).

const TERMINAL = /[.!?]["'”’)\]]*$/

/**
 * Did the text just typed complete a sentence? `before` is the paragraph text up to the caret AFTER
 * the change; `inserted` is what the last transaction inserted. Only a whitespace insert (space,
 * newline, tab) right after a terminator counts — typing the full stop itself does not, so an
 * abbreviation mid-sentence ("e.g. this") is not cut in half until the writer moves on.
 */
export function sentenceJustCompleted(before: string, inserted: string): boolean {
  if (!/^\s+$/.test(inserted)) return false
  const stem = before.slice(0, before.length - inserted.length)
  if (stem.length !== before.length - inserted.length) return false
  return TERMINAL.test(stem)
}

/** Enter after a terminated paragraph also completes a sentence (paragraph text, trimmed). */
export function paragraphEndsSentence(paragraphText: string): boolean {
  return TERMINAL.test(paragraphText.trimEnd())
}
