// The word notion, in one place.
//
// ⚠ A LEAF ON PURPOSE — it imports NOTHING but a type, and must stay that way. `bundle.ts` is in the
// framework-free verifier's runtime graph (`verify/index.ts` imports `pmToText` from it as a VALUE),
// so the obvious consolidation — have `bundle.ts` import this from `snapshots.ts` — would drag OPFS,
// the gzip worker and the whole archive layer in behind it. That is the property `src/verify`'s own
// deliberate copy exists to protect, and it would have been broken by a change made in the name of
// removing a duplicate.
//
// ⚠ THE REGEX IS A CONTRACT, not a detail. `productivity/capture.ts` reduces BOTH sides of its word
// diff to this notion before subtracting, because `diffStats` counts `\S+` runs while this counts
// `[\p{L}\p{N}]+` — and a row whose `added - removed` disagreed with its own `net_words` was a real
// bug. `capture.test.ts` pins that reconciliation. Changing this changes `wordCount` on every
// snapshot ever taken and `words` in every export bundle; it is not a free edit.
//
// `src/verify/index.ts` keeps its OWN copy, deliberately — it must not import from the app at all.
// Two copies remain and that is the intended state; the third, in `bundle.ts`, is what this replaces.

import type { TiptapJSON } from '../types/document'

/** Count content words in TipTap JSON (whitespace-delimited runs of letters/digits). */
export function countWords(contentJson: TiptapJSON): number {
  let text = ''
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: string; content?: unknown[] }
    if (typeof n.text === 'string') text += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(contentJson)
  const m = text.trim().match(/[\p{L}\p{N}]+/gu)
  return m ? m.length : 0
}
