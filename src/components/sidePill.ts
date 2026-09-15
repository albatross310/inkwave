import { useEffect, useState } from 'react'

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

// ─── The side pills' WIDTH feeds the toolbar's budget (2026-09-15) ────────────────────────────────
//
// Peter, on a ~430px-wide window with the R and ⋮ circles hanging past the pill's border: "it needs
// to have wider buffer if that narrow, it can go all the way to the side pills". The toolbar's
// `--iw-bar-budget` used to subtract a FIXED reserve of 140px per side — nearly double what the two
// pills actually occupy (the ◈ pill ~60px painted, "Save to folder" ~90px). At 430px that left the
// centred pill a 134px box for eight circles that need 154 even at their 17px floor: a guaranteed
// 24px spill, on the one window size Peter tests in. MEASURED before this change, headless Chromium:
// overflow +54px at 400, +24 at 430, contained from 460 up.
//
// So the reserve is MEASURED, not assumed. Each pill's trigger registers its element here; the
// editor observes them and publishes `--iw-side-reserve` = the painted px the WIDER pill claims from
// its own edge. Wider, not each side separately, because the toolbar is CENTRED: it can only ever
// grow symmetrically, so the narrower side's slack is unusable and the wider side is the bound
// (w ≤ 100vw − 2·max(L, R)). Registering the TRIGGER rather than the fixed wrapper matters: the
// wrapper also holds the open detail panel (w-64), and measuring it would shrink the toolbar every
// time a panel opened.

export type SidePillSide = 'left' | 'right'

/** What the budget assumes per side until a pill has been measured — the historical constant. */
export const SIDE_RESERVE_FALLBACK_PX = 140

/** Breathing room between the toolbar's edge and a side pill, painted px, each side. */
export const TOOLBAR_SIDE_GAP_PX = 8

/**
 * Painted px the toolbar must leave clear on EACH side, from the two pills' trigger rects (post-
 * transform, viewport coordinates) — the wider pill's claim from its own edge. A side with no pill
 * mounted (hidden trigger, panel-only state) claims nothing. Never negative: a rect that has
 * scrolled or animated past its edge is treated as flush with it.
 */
export function sideReserve(
  viewportWidth: number,
  left: { right: number } | null,
  right: { left: number } | null,
): number {
  const l = left ? Math.max(0, left.right) : 0
  const r = right ? Math.max(0, viewportWidth - right.left) : 0
  return Math.max(l, r)
}

const registered = new Map<SidePillSide, HTMLElement>()
const subscribers = new Set<() => void>()

/** Ref-callback target for a side pill's TRIGGER element. Pass null on unmount (React does). */
export function registerSidePill(side: SidePillSide, el: HTMLElement | null): void {
  const prev = registered.get(side)
  if (el) registered.set(side, el)
  else registered.delete(side)
  if (prev !== el) for (const fn of subscribers) fn()
}

export function sidePillElements(): ReadonlyMap<SidePillSide, HTMLElement> {
  return registered
}

/** Notified whenever a side pill mounts, unmounts or swaps its element. Returns the unsubscribe. */
export function subscribeSidePills(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

// ─── CRAMPED: below a width both pills fold, so the bar gets the room (2026-09-15) ────────────────
//
// Peter, at the desktop app's ~300px docked browser pane, with the measured reserve already in:
// "we need to shrink the res pill to just an icon and left pill padding to squeeze the whole bar
// in". The measured reserve handles every width where the FULL pills leave eight circles room; below
// that the pills themselves are the cost. So under this width the sync pill drops to its ☁ glyph
// (the same form it already takes with the PDF panel open) and the ◈ pill sheds its side padding.
// The reserve is measured off the triggers, so it follows the fold automatically — nothing else
// needs to know. One threshold on the VIEWPORT, not on the pills' own size, so folding cannot
// un-trigger itself (a rule that read the pills would flip the moment they shrank).
//
// 440 is where the full pills push the circles below ~24px (measured: 23px at 430, 19 at 400).

export const FOOTER_CRAMPED_BELOW_PX = 440

/** Pure form of the rule, for the test and for anything without a window. */
export function footerCramped(viewportWidth: number): boolean {
  return viewportWidth < FOOTER_CRAMPED_BELOW_PX
}

/** True while the viewport is narrower than FOOTER_CRAMPED_BELOW_PX. False during SSR. */
export function useFooterCramped(): boolean {
  const [cramped, setCramped] = useState(() => typeof window !== 'undefined' && footerCramped(window.innerWidth))
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${FOOTER_CRAMPED_BELOW_PX - 1}px)`)
    const on = () => setCramped(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return cramped
}
