// WHERE YOU WERE IN THE DOCUMENT, ACROSS A HARD REFRESH.
//
// Peter, 2026-08-28: "we should make the users scroll position in the doc a saved field that
// persists through a hard refresh… as that's very useful as I have to keep hard refreshing for
// testing and so on."
//
// THREE DECISIONS, and each is the difference between useful and dangerous:
//
// 1. IT IS NOT A DOCUMENT FIELD. Putting it on InkwaveDocument would make every scroll a reason to
//    write current.json — the file the provenance spine reads, the cloud mirrors sync and the
//    2026-07-15 incident taught this codebase to touch as rarely as possible. A reading position is
//    not part of the writing. It lives in its own localStorage key, per document.
//
// 2. IT IS KEYED BY DOCUMENT, NOT BY TAB. Two tabs on two documents each restore their own; one
//    document reopened in a new tab restores where you left it. Keying by tab would lose it on
//    exactly the hard refresh it exists for.
//
// 3. IT IS A HINT, NEVER AN INSTRUCTION. A restored offset is only meaningful if the document is
//    the same length it was — pagination re-measures on load, fonts arrive late, and a stale offset
//    can point past the end. So it is CLAMPED to the live scroll range and, crucially, it is
//    discarded when the document's length has changed a lot since it was written: landing someone
//    in the wrong part of a document they did not scroll is worse than landing them at the top.

const KEY = (docId: string) => `inkwave:scrollPos:${docId}`
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14   // a fortnight; older than that, start at the top

export type ScrollMemory = { top: number; height: number; at: number }

export function readScrollMemory(docId: string): ScrollMemory | null {
  if (!docId) return null
  try {
    const raw = localStorage.getItem(KEY(docId))
    if (!raw) return null
    const m = JSON.parse(raw) as ScrollMemory
    if (typeof m?.top !== 'number' || typeof m?.height !== 'number') return null
    if (!Number.isFinite(m.top) || m.top < 0) return null
    if (Date.now() - (m.at ?? 0) > MAX_AGE_MS) return null
    return m
  } catch { return null }
}

export function writeScrollMemory(docId: string, top: number, height: number): void {
  if (!docId || !Number.isFinite(top) || top < 0) return
  try { localStorage.setItem(KEY(docId), JSON.stringify({ top: Math.round(top), height: Math.round(height), at: Date.now() })) }
  catch { /* private mode / quota — a reading position is never worth an error */ }
}

/**
 * The offset to restore, or null to leave the document at the top.
 * `liveHeight` is the scrollable content height NOW; `range` its maximum scrollTop.
 */
export function restoreOffset(m: ScrollMemory | null, liveHeight: number, range: number): number | null {
  if (!m || range <= 0) return null
  // The document has changed size materially — an offset measured against a different layout is a
  // guess about where the reader was, and a confident guess in the wrong place is the failure mode.
  // 12% covers a re-measure, a late font and a paragraph or two; beyond that, don't pretend.
  if (m.height > 0 && Math.abs(liveHeight - m.height) / m.height > 0.12) return null
  const clamped = Math.min(m.top, range)
  return clamped > 8 ? clamped : null      // "the very top" is not worth restoring
}
