// THE LEDGER+DOC COMBO (Peter, 2026-07-17: "structured ledger+doc combo data to match it").
//
// Peter wants a report that can say "the forty minutes after your 3pm break produced this
// paragraph" — and MEAN it. That needs each session paired with the prose it actually produced,
// which neither half has alone: the ledger knows a session ran 09:05–09:50 and added 400 words;
// the document knows the words. Nothing joined them.
//
// THE JOIN IS ALREADY IN THE REPO, AND IT IS EXACT — NOT INFERRED. The provenance spine snapshots
// contentJson as the writer works. So for a session [start, end] in document D:
//   baseline = the last snapshot of D at or before `start`
//   final    = the last snapshot of D at or before `end`
//   the added text = diffWords(pmToText(baseline), pmToText(final)) filtered to 'add' ops
// That is the writing that appeared during that session, taken from the record rather than
// guessed at. No heuristic, no model, no attribution rule to get wrong.
//
// ─── FOUR HONEST LIMITS, each surfaced in the payload rather than papered over ───────────────
// 1. SNAPSHOTS ARE EVENT-TRIGGERED, NOT CONTINUOUS ('word-nudge' | 'kick' | 'manual' |
//    'paragraph'). A session that produced no snapshot boundary yields NO excerpt — and says so.
//    Coverage is a property of how the writer worked, not something to fill in.
// 2. THE PAIRING IS BY THE WRITER'S LOCAL CLOCK. `Snapshot.createdAt` is documented "writer's
//    local clock — ordering only, never authority". That is fine here — this is a reading aid,
//    not a provenance claim — but it is NOT Bitcoin-anchored time and nothing may present it as
//    such. A clock change mid-window mis-pairs; it does not lie about anything anchored.
// 3. ADDED TEXT ONLY. Deletions are a MEASURED signal already in the payload (words_deleted), so
//    §A6.4 says take them from the ledger, not from a diff the model reads.
// 4. THE BASELINE MAY PREDATE THE SESSION. If the last snapshot before `start` is hours old, the
//    excerpt can include work from an untracked gap. `baselineAgeMin` reports it; a wide gap is
//    labelled in the payload so the model cannot silently attribute someone's afternoon to a
//    twenty-minute session.
//
// §A7.3 GATES EVERY WORD OF THIS. An excerpt is document prose, so it exists only for documents
// the writer ticked. compile.ts calls this with the ticked ids and nothing else — the same rule
// as whole-document text, applied to a finer slice.

import type { Snapshot } from '../../types/document'
import type { SessionRow } from '../types'
import { pmToText } from '../../provenance/bundle'
import { diffWords } from '../../provenance/diff'

/** What one session produced, paired from the record. */
export interface SessionExcerpt {
  session_id: string
  /** The prose that appeared during the session. Empty ⇒ nothing to show (see `reason`). */
  added: string
  /** Why there is no excerpt, when there isn't. Surfaced to the writer AND to the model (§A9). */
  reason?: 'no-snapshots' | 'no-change'
  /**
   * Minutes between the baseline snapshot and the session start. Large ⇒ the excerpt may include
   * work from before this session (limit 4). Undefined when there was no baseline at all.
   */
  baselineAgeMin?: number
}

/** How stale a baseline may be before the payload flags the excerpt as possibly over-wide. */
export const BASELINE_WARN_MIN = 20

function ms(iso: string): number {
  return new Date(iso).getTime()
}

/**
 * The prose that appears in `after` and not in `before`.
 *
 * ─── THE TOKENISATION ARTIFACT, AND WHY THE OBVIOUS VERSION IS WRONG ───────────────────────
 * `diffWords` tokenises as [word][trailing-whitespace] so a re-join reproduces the original
 * byte-exactly — right for the diff VIEW it was built for, wrong here. Appending to a paragraph
 * changes the OLD last token ("paragraph." → "paragraph. "), so the diff emits it as a del plus
 * an add, and a naive `filter(op => op.type === 'add')` returns "paragraph. And the new middle
 * bit." — crediting this session with a sentence written before it. Measured, not theorised:
 * that is what the first cut of this module did, and the excerpt tests caught it.
 *
 * The ledger lane hit the SAME artifact in `capture.ts wordDiffStats` and its fix is documented
 * there — but it cannot be reused, because it normalises FOR COUNTING: it reduces both sides to
 * `[\p{L}\p{N}]+` runs joined by spaces, which throws away punctuation, capitalisation and
 * paragraph breaks. That is correct for a word count and useless for prose a human will read.
 * So this is the same INSIGHT applied to the other purpose, not a second copy of the rule.
 *
 * THE RECONCILIATION: when an add is immediately preceded by a del, and the add begins with the
 * del's own text, that leading fragment is the re-spaced old token — not new writing. Strip it.
 * A genuine rewrite has the same shape and the same answer: "paragraph." was not written now.
 */
function addedText(before: string, after: string): string {
  const ops = diffWords(before, after)
  const parts: string[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'add') continue
    let text = ops[i].text
    const prev = i > 0 ? ops[i - 1] : undefined
    if (prev?.type === 'del') {
      const stale = prev.text.trim()
      const lead = text.trimStart()
      if (stale && lead.startsWith(stale)) text = lead.slice(stale.length)
    }
    parts.push(text)
  }
  return parts.join('').trim()
}

/**
 * The added prose for one session, from that document's snapshots.
 *
 * `snaps` need not be sorted or filtered — this takes the document's whole list and does the
 * bounding itself, because getting the baseline right is the entire subtlety.
 */
export function excerptForSession(session: SessionRow, snaps: Snapshot[]): SessionExcerpt {
  const start = ms(session.start)
  const end = ms(session.end)
  const ordered = [...snaps]
    .filter(s => Number.isFinite(ms(s.createdAt)))
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))

  // The baseline is the last snapshot AT OR BEFORE the session start — the document as it stood
  // when the writer sat down. `final` is the last at or before the end.
  let baseline: Snapshot | undefined
  let final: Snapshot | undefined
  for (const s of ordered) {
    const t = ms(s.createdAt)
    if (t <= start) baseline = s
    if (t <= end) final = s
  }

  if (!final || final === baseline) {
    // Either the document has no snapshots in play at all, or nothing was snapshotted DURING the
    // session — both mean "the record has no writing to attribute here", which is honest and is
    // not the same as "the writer did nothing" (words_added, measured, may still be non-zero).
    return { session_id: session.session_id, added: '', reason: 'no-snapshots' }
  }

  const before = baseline ? pmToText(baseline.contentJson) : ''
  const after = pmToText(final.contentJson)
  const added = addedText(before, after)

  const out: SessionExcerpt = {
    session_id: session.session_id,
    added,
    ...(added ? {} : { reason: 'no-change' as const }),
  }
  if (baseline) out.baselineAgeMin = Math.max(0, Math.round((start - ms(baseline.createdAt)) / 60000))
  return out
}

/**
 * Excerpts for every session in `sessions` whose document the writer ticked.
 *
 * `snapshotsByDoc` is supplied by the caller (compile.ts, via the excerpt source) and MUST already
 * be restricted to ticked documents — this function will not fetch, and a document absent from the
 * map contributes nothing. That ordering matters: text that was never read cannot leak.
 */
export function sessionExcerpts(
  sessions: SessionRow[],
  snapshotsByDoc: Record<string, Snapshot[]>,
): SessionExcerpt[] {
  return sessions
    .filter(s => Object.prototype.hasOwnProperty.call(snapshotsByDoc, s.doc_id))
    .map(s => excerptForSession(s, snapshotsByDoc[s.doc_id] ?? []))
}
