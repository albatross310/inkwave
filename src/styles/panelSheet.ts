// ─── THE PHONE PANEL SHEET — one look for every footer drop-up ──────────────
// Peter, iPhone, 2026-09-17: the P / S / i / ⚙ / ❐ / R / ⋮ panels and the ▲ drawer's ◈ ☁ ‟ Σ ⁝ each
// arrived with their own radius, shadow, inset, font size and header, and each parked at a
// different height above the toolbar. THIS FILE IS THE ONLY PLACE THOSE NUMBERS LIVE. A panel takes
// `phoneSheetStyle()` + `PHONE_SHEET_CLASS` for its outer box on phone and the shared header /
// section / pill pieces (components/PanelSheet.tsx) inside; desktop keeps its own geometry and only
// shares the tokens that read the same on both (pill, section label, header type).
//
// Phone-only by construction, not by media query: a panel applies these only under
// isTouchDevice() (editor/isTouchDevice.ts) — the same predicate index.css's phone block uses.

import type { CSSProperties } from 'react'

export const PHONE_SHEET = {
  /** Inset from the screen's left/right edges — matches the ▲ drawer's own margin. */
  insetPx: 8,
  /** Air between the sheet's bottom edge and the toolbar pill's top edge. */
  gapPx: 10,
  /** Air kept above the sheet so a tall one never runs under the status bar / notch. */
  topAirPx: 12,
  radiusPx: 14,
  /** Body type. ≥16px is mandatory: iOS auto-zooms (and STAYS zoomed) on anything smaller. */
  fontPx: 17,
  /** The small-caps header title and section labels. */
  labelPx: 11,
  /** Pill (chip) type. */
  pillPx: 13,
  /** The header's × glyph. Its tap target is grown to 44px by the header, not by this size. */
  closePx: 22,
  // Both are TOKENS (index.css declares them; the fallbacks repeat the day values verbatim, as the
  // palette gate requires) so night mode restyles every sheet at once.
  shadow: 'var(--iw-sheet-shadow, 0 10px 40px rgba(28, 25, 23, 0.18))',
  border: '1px solid var(--iw-nightable-border, #e7e5e4)',
} as const

/**
 * The sheet's TYPE RAMP — four semantic steps, one ramp for every panel body, as CSS-variable
 * strings. index.css sets the phone values on `.iw-phone-sheet` (17/15/13/11) and the desktop
 * values on :root, so a panel says WHAT a run of text is and never picks a size. Use these for
 * inline `fontSize`; Tailwind `text-xs` / `text-sm` / `text-[11px]` inside a sheet are remapped to
 * the same steps by index.css, so legacy classes land on the ramp without a rewrite.
 */
export const SHEET_TYPE = {
  body: 'var(--iw-sheet-body, 17px)',
  small: 'var(--iw-sheet-small, 15px)',
  meta: 'var(--iw-sheet-meta, 13px)',
  label: 'var(--iw-sheet-label, 11px)',
} as const

/** Class on the sheet's outer box (index.css `.iw-phone-sheet`): scrolling, max-height, type. */
export const PHONE_SHEET_CLASS = 'iw-phone-sheet'

/**
 * The sheet's box on phone: fixed, full-width minus the inset, bottom-anchored ABOVE THE TOOLBAR
 * AND THE KEYBOARD. The two CSS vars are written live by TiptapEditor — `--iw-toolbar-h` from the
 * pill's ResizeObserver, `--iw-kb-offset` per frame by the keyboard dock — so the sheet follows the
 * pill without measuring a button rect at open time (the old per-panel `innerHeight - rect.top`
 * snapshot went stale the moment the keyboard or the URL bar moved). `env(safe-area-inset-bottom)`
 * mirrors the footer wrapper's own padding: the pill sits at max(keyboard, safe-area) above the
 * layout bottom, so the sheet does too.
 */
export function phoneSheetStyle(): CSSProperties {
  return {
    position: 'fixed',
    left: PHONE_SHEET.insetPx,
    right: PHONE_SHEET.insetPx,
    bottom: `calc(max(var(--iw-kb-offset, 0px), env(safe-area-inset-bottom, 0px)) + var(--iw-toolbar-h, 56px) + ${PHONE_SHEET.gapPx}px)`,
    // Never taller than the VISIBLE viewport above the pill (`--iw-vv-h` = visualViewport.height,
    // also written by the editor) — with the keyboard up that is the short band the writer can see.
    maxHeight: `calc(var(--iw-vv-h, 100dvh) - var(--iw-toolbar-h, 56px) - max(var(--iw-kb-offset, 0px), env(safe-area-inset-bottom, 0px)) - ${PHONE_SHEET.gapPx + PHONE_SHEET.topAirPx}px)`,
    borderRadius: PHONE_SHEET.radiusPx,
    boxShadow: PHONE_SHEET.shadow,
    border: PHONE_SHEET.border,
    fontSize: PHONE_SHEET.fontPx,
  }
}
