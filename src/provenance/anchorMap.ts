// Cross-version content anchoring — the pure half.
//
// A scrub presents one version after another. Versions differ in LENGTH, so preserving the scroll
// OFFSET does not preserve the CONTENT: identical offsets, sliding text (measured on the /snapshot
// doc pane: anchor drift p50 186px per version step). Registration has to be built on content
// identity instead — the same shape as the zoom focal anchor (99bf8a0): hold an identity, re-find
// it after the thing changed, land on it.
//
// This module answers the one question that needs the provenance spine rather than the DOM: when
// the anchor text has NO counterpart in the target version (it was inserted or deleted between
// them), what is the nearest text that DOES survive? Framework-free and pure so it can be tested
// directly, and so it outlives whatever renders the pane.

import type { Snapshot } from '../types/document'
import { opsBetween, displayTextOf } from './diffCache'

/** Shorter than this is too weak to anchor on reliably (matches SnapshotView's SIG_MIN). */
export const ANCHOR_MIN = 12
/** Chars of surviving text handed back as the replacement signature (matches SIG_LEN). */
export const ANCHOR_LEN = 80

/** Char offset of `sig` in `text`, choosing the occurrence nearest `ratioBias` of the way through
 *  (the anchor's own neighbourhood — the same tie-break the DOM search uses). -1 if absent. */
export function offsetOfNearest(text: string, sig: string, ratioBias: number): number {
  const bias = ratioBias * text.length
  let at = -1, best = Infinity
  for (let i = text.indexOf(sig); i >= 0; i = text.indexOf(sig, i + 1)) {
    const d = Math.abs(i - bias)
    if (d < best) { best = d; at = i }
  }
  return at
}

/** The text nearest the anchor that SURVIVES from `active` into `target`, per the provenance word
 *  diff (`opsBetween` — pure + diffCache-backed). Null when nothing usable survives.
 *
 *  THE CORRESPONDENCE: a `same` op is, by construction, a run of text present in BOTH versions, so
 *  its text is guaranteed findable in the target. We locate the anchor in the ACTIVE version's own
 *  text, walk the ops in ACTIVE-text space (`same` and `del` advance it; `add` is target-only text
 *  and does not), and take the `same` run nearest the anchor — biting the END of a run that sits
 *  above the anchor and the START of one below it, i.e. the surviving text closest to what the
 *  reader was actually looking at. Landing on that is the smallest honest error available: the
 *  anchor itself does not exist to land on, and the reader drifts by the size of the edit rather
 *  than being thrown to the top of the document. */
export function survivingNeighbourSig(
  active: Snapshot, target: Snapshot, anchorSig: string, ratioBias: number,
): string | null {
  const ops = opsBetween(active, target)
  if (!ops) return null
  const at = offsetOfNearest(displayTextOf(active), anchorSig, ratioBias)
  if (at < 0) return null
  let pos = 0, bestSig: string | null = null, bestD = Infinity
  for (const op of ops) {
    if (op.type === 'add') continue // target-only — does not advance ACTIVE-text space
    const len = op.text.length
    if (op.type === 'same') {
      const above = at > pos + len
      const d = at < pos ? pos - at : above ? at - (pos + len) : 0
      if (d < bestD) {
        const t = op.text.replace(/\s+/g, ' ').trim()
        if (t.length >= ANCHOR_MIN) {
          bestD = d
          bestSig = above ? t.slice(-ANCHOR_LEN) : t.slice(0, ANCHOR_LEN)
        }
      }
    }
    pos += len
  }
  return bestSig
}
