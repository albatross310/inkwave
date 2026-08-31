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
// ─── IT HAS NO `param`, AND THAT IS THE ODD ONE OUT ──────────────────────────────────────────
// It is the only one of the nine that reads NO URL: entry.client.tsx syncs `?textRender` into
// localStorage at boot, alongside the other boot-synced flags, before the app reads anything. So
// the spec below deliberately omits `param` — giving it one would be a second place the URL is
// interpreted, and the two would drift the first time either changed. Absent · `?textRender` ·
// `?textRender=1` ⇒ ON; `?textRender=off` ⇒ a sticky '0' (an absence would silently re-enable it
// under a default-ON reader). SSR/node/denied storage all keep the default (ON): nothing off the
// keystroke path reads this — only the client-only /snapshot route — so there is no load-path
// reason to fall OFF the way the prod-capture flags do.
import { stickyFlag } from '../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:textRender',
  defaultOn: true,
  override: '__iwTextRender',
})

export function textRenderEnabled(): boolean { return flag.enabled() }

/** Test seam: forget the cached flag read. */
export function _resetTextRenderFlag(): void { flag.reset() }
