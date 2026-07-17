// WHAT COUNTS AS A LINE — the ONE predicate shared by both DOM line collectors.
//
// Two surfaces measure page lines out of `getClientRects()`:
//   · `PaginationExtension.collectLines`  — the LIVE editor (ProseMirror).
//   · `staticPagination.collectStaticLines` — the /snapshot doc pane (plain DOM, no PM view).
// They had SEPARATE copies of this predicate, including a separate literal `80` and a separate
// literal `3`, with a comment in the pane claiming it was "the same 80px filter as the editor".
// A comment asserting parity is a reason nobody checks parity — and the 2026-07-17 container-box
// bug had to be found and fixed TWICE, once per copy, because of it.
//
// Lives in its own lean module (NO Tiptap/ProseMirror imports) so the snapshot route chunk can
// apply the identical rule without dragging the editor graph in — the same reasoning as pageGap.ts
// and as MARGIN_BOTTOM living in pageSettings.
//
// WHAT IS *NOT* HERE, AND WHY. The CONTAINER rule — "a `<ul>`'s `<li>` box is not a line" — is not
// shareable, and pretending otherwise would be the same mistake one level up. The editor asks
// ProseMirror (`child.isTextblock`, PaginationExtension.textblockEls); the pane has no PM tree and
// asks the layout engine (`getComputedStyle().display`, staticPagination.staticLineRects). Two
// authorities, two implementations, one meaning. What binds them is not shared code but a shared
// ASSERTION: `lineRuleParity.test.ts` runs one document through both and requires the same answer —
// the `breakRuleParity.test.ts` / `textMap.test.ts` pattern.

/** The tall-box cut. A rect this tall is not a text line at the canonical 18px/29.1px grid. */
export const MAX_LINE_H = 80

/** The same-line threshold: two rect tops within this are fragments of ONE line.
 *  NB it is also, exactly, the half-leading ((29.109 − 23) / 2 = 3.05) — which is why a container's
 *  border box, sitting 3.000px above its own first text rect, was deduped INTO that line and stood
 *  in for it. The constant is not the bug; admitting the container's box was. */
export const SAME_LINE_PX = 3

/** Is this rect a LINE? `s` is the magnify scale (1 in an unscaled canonical window). */
export const isLineRect = (r: { width: number; height: number }, s = 1): boolean =>
  r.width >= 1 && r.height >= 1 && r.height <= MAX_LINE_H * s

/** Are these two rect tops the same line? Callers must pass tops in ASCENDING order. */
export const sameLine = (top: number, lastTop: number): boolean => top - lastTop <= SAME_LINE_PX
