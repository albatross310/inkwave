// THE TWO SIDE PILLS THAT FLANK THE FOOTER TOOLBAR — one source of truth for their geometry.
//
// `ReceiptPanel`'s snaps pill (left) and `SyncStatus` (right) are separate components that never
// reference each other, but they are read as a matched pair: they sit either side of the centred
// toolbar in the same band, and Peter's ask (2026-08-20) is that they be the SAME HEIGHT and that
// all three midlines line up. The reconnect state is deliberately taller, but feeds that height into
// the same centring formula. Two files each carrying their own copy of "how tall" and "how far up"
// is exactly how they drifted apart in the first place — the right pill had been given a height that
// tracked the toolbar's own (making it nearly twice the left pill's) while the left sat 10px higher
// than the right on a different `bottom` formula. So both numbers live here, once.
//
// MEASURED before choosing (900×700, zoom 1): toolbar pill 56px tall with its midline 56px above the
// viewport bottom; snaps pill 30.8px (midline 53.4px up); sync pill 56px (midline 56px up).

/**
 * Normal layout height of BOTH side pills, in unscaled px. The reconnect exception uses the tall
 * height below; ordinary short states and the snaps pill remain a matched 30px pair.
 */
export const SIDE_PILL_H = 30

/** Two-line right-pill height used only by the reconnect message. */
export const SIDE_PILL_TALL_H = 42

/**
 * Font size shared by BOTH side pills (Peter, 2026-08-20: "make it same font size as on the left").
 * The right pill rises to it from 10px, the left comes down from Tailwind's text-sm 14px. Kept here
 * with the height for the same reason: two files agreeing by coincidence is how they drifted before.
 */
export const SIDE_PILL_FONT = '12px'

/**
 * Distance from the viewport bottom to the footer toolbar's BOTTOM EDGE, in unscaled px.
 * 28 → 13 (Peter, 2026-08-20: "lower them all a bit maybe 15px") — lowering the toolbar lowers the
 * side pills with it, because `sidePillBottom()` is measured from this same number. It lived in TWO
 * places (this formula and the footer wrapper's paddingBottom in TiptapEditor.tsx) and a change to
 * one silently detached the pills from the bar, so it is one exported constant now.
 */
export const TOOLBAR_BOTTOM_PX = 13

/**
 * `bottom` for a side pill so its MIDLINE sits on the toolbar pill's midline.
 *
 * The toolbar's bottom edge is `28 * zoom` above the viewport bottom (its wrapper's padding) and its
 * painted height is published live as `--iw-toolbar-h` — so its midline is `28*zoom + toolbarH/2` up.
 * A side pill is anchored by its own bottom edge and rises by its painted height, so centring it
 * means subtracting half of that: both pills carry `transform: scale(zoom * 1.12)`. The optional
 * height argument keeps the exceptional two-line reconnect pill on the same midline too.
 *
 * `--iw-toolbar-h` is read as a var rather than hard-coded because the toolbar GROWS when its style
 * or review row opens; the pills then re-centre on the taller bar for free.
 */
export function sidePillBottom(zoom: number, height = SIDE_PILL_H): string {
  const halfPill = (height * zoom * 1.12) / 2
  return `calc(${TOOLBAR_BOTTOM_PX * zoom}px + (var(--iw-toolbar-h, 56px) / 2) - ${halfPill.toFixed(2)}px + var(--iw-pdf-room-bottom, 0px))`
}
