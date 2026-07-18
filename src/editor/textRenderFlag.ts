// The `inkwave:textRender` flag, ALONE in its own module.
//
// WHAT IT GATES: the /snapshot doc pane renders RICH formatted pages (RichDiffView) for every
// version instead of the flat `pre-wrap` transcript that 115 of 116 versions used to show. This is
// "the fast scrub rich text" — Peter's "look pretty similar to an actual page".
//
// DEFAULT ON (2026-07-18 — "STOP FLAGGING EVERYTHING: FINISHED FEATURES SHIP LIVE"). Graduated after
// the accuracy gates passed: `breaks.prove.mjs` IDENTICAL, and the per-type matrix
// (typematrix.prove.mjs) is accurate-or-honest across the schema — every divergent type DECLARES low
// reliability (est>0, reliablePages < pages) or DEFERS outright; none is silently wrong. The pane's
// own page gaps come from staticPagination (DOM-measured, container-box fixed), not the arithmetic
// model, so the rich pane shows the same information as the flat one, formatted, with no regression.
//
// Why it isn't in textRender.ts: a static import of textRender.ts for one function pulls the whole
// paint path (fillText, the map strip, the page model) into whatever reads it. Keeping the flag
// separate keeps that cost where it belongs.
//
// Sticky, resolved once per load (the `?auth` / snapThumbs pattern — a flag read fresh from the URL
// dies the moment any route rewrites it). Absent · `?textRender` · `?textRender=1` ⇒ ON;
// `?textRender=off` ⇒ a STICKY '0' opt-out (removeItem would silently re-enable it under a default-ON
// reader). entry.client.tsx does the URL→localStorage sync before the app reads anything.
//
// The reader is `!== '0'` (absent-means-on), the mirror of the old `=== '1'`. SSR/node/denied storage
// keeps the default (ON) — nothing off the keystroke path reads this (only the client-only /snapshot
// route), so there is no load-path reason to fall OFF the way the prod-capture flags do.

const FLAG = 'inkwave:textRender'
let _flag: boolean | null = null

export function textRenderEnabled(): boolean {
  const w = typeof window !== 'undefined' ? (window as unknown as { __iwTextRender?: boolean }) : null
  if (w && typeof w.__iwTextRender === 'boolean') return w.__iwTextRender
  if (_flag !== null) return _flag
  try { _flag = typeof localStorage === 'undefined' ? true : localStorage.getItem(FLAG) !== '0' } catch { _flag = true }
  return _flag
}

/** Test seam: forget the cached flag read. */
export function _resetTextRenderFlag(): void { _flag = null }
