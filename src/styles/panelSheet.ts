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

// ─── THE DESKTOP SHEET — the same panels, sized for a pointer (Peter, 2026-09-18) ──────────────
// Screenshots at 1440×900 showed the desktop panels each at their own size: Settings 208px wide in
// 13px type beside a 470px Guide, the ⋮ menu at 230px, its modals at 300px, the receipt at 210px.
// Then a second pass (Lambert, 2026-09-18) found the survivors: Math at 180px, the receipt and sync
// pop-overs with square corners and their own type size, Guide pinned to `100vh - 92px`, and four
// panels each clamping to the viewport edge with a different half-width (240 / 230 / 186 / 150).
//
// THE RULES, and there are only four:
//   1. A panel is one of FOUR KINDS by shape, and the kind is its width: menu 340 · modal 400 ·
//      wide 470 · broad 820. Never wider than the viewport minus a gutter (`min(Npx, 92vw)`).
//   2. Every panel wears the same radius, border, shadow and body type (`desktopSheetStyle`).
//   3. A panel that pops up FROM A BUTTON sits SHEET_GAP above it, centred on it, and slides in from
//      the viewport edge by SHEET_EDGE — one function, `anchorAbove`, every caller.
//   4. A panel is never taller than the viewport minus the toolbar band (`--iw-sheet-max-h`).
export const DESKTOP_SHEET = {
  /** Menu-shaped panels: Settings, ⋮, receipt, sync, math, media, clock. */
  widthPx: 340,
  /** Dialog-shaped panels (Save / Open / Export…, citations, page). */
  modalWidthPx: 400,
  /** Tall reference panels (Guide, the citation editor, two-column Settings). */
  wideWidthPx: 470,
  /** Table-shaped panels (the document inspector). */
  broadWidthPx: 820,
  radiusPx: 14,
  fontPx: 15,
  shadow: 'var(--iw-sheet-shadow, 0 10px 40px rgba(28, 25, 23, 0.18))',
  border: '1px solid var(--iw-nightable-border, #e7e5e4)',
} as const

export type SheetKind = 'menu' | 'modal' | 'wide' | 'broad'

const KIND_PX: Record<SheetKind, number> = {
  menu: DESKTOP_SHEET.widthPx,
  modal: DESKTOP_SHEET.modalWidthPx,
  wide: DESKTOP_SHEET.wideWidthPx,
  broad: DESKTOP_SHEET.broadWidthPx,
}

/** The design width of a kind, in px — for callers that must do arithmetic (edge clamping). */
export function sheetWidthPx(kind: SheetKind): number { return KIND_PX[kind] }

/** The rendered width of a kind: its design width, or the viewport minus a gutter, whichever is less. */
export function sheetWidth(kind: SheetKind): string { return `min(${KIND_PX[kind]}px, 92vw)` }

/** Air between a pop-up panel's bottom edge and the button it rose from. */
export const SHEET_GAP = 14
/** The least a panel may come to the viewport's left or right edge. */
export const SHEET_EDGE = 8
/** The tallest any desktop panel may be — index.css declares it: the viewport minus the toolbar band. */
export const SHEET_MAX_H = 'var(--iw-sheet-max-h, calc(100vh - 92px))'

/** Class on a desktop panel's outer box (index.css `.iw-desktop-sheet`): the type ramp remaps. */
export const DESKTOP_SHEET_CLASS = 'iw-desktop-sheet'

/**
 * The desktop box: radius, shadow, border and body type — and, given a kind, its width and height
 * cap. Position is the caller's (`anchorAbove` for a pop-up; centred for a modal).
 */
export function desktopSheetStyle(kind?: SheetKind): CSSProperties {
  return {
    borderRadius: DESKTOP_SHEET.radiusPx,
    boxShadow: DESKTOP_SHEET.shadow,
    border: DESKTOP_SHEET.border,
    fontSize: DESKTOP_SHEET.fontPx,
    ...(kind ? { width: sheetWidth(kind), maxHeight: SHEET_MAX_H } : {}),
  }
}

/** The toolbar pill's box — every pop-up rises from ITS top edge, not from wherever its trigger is drawn. */
const TOOLBAR_PILL = '.iw-toolbar-outline'

/**
 * Where a pop-up panel of `kind` sits when it rises from `button`: SHEET_GAP above the TOOLBAR
 * PILL (a trigger that lives in the ▲ drawer is drawn a row higher, and a panel anchored to it
 * floated mid-air), centred on the button, and pushed in so no edge comes within SHEET_EDGE of
 * the viewport. No button rect (first paint before the ref lands): centred, a toolbar's height up.
 */
export function anchorAbove(button: DOMRect | null | undefined, kind: SheetKind, gap = SHEET_GAP): CSSProperties {
  if (!button) return { position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)' }
  const half = Math.min(KIND_PX[kind], window.innerWidth * 0.92) / 2
  const centre = button.left + button.width / 2
  const pillTop = document.querySelector(TOOLBAR_PILL)?.getBoundingClientRect().top ?? button.top
  return {
    position: 'fixed',
    bottom: Math.round(window.innerHeight - pillTop + gap),
    left: Math.round(Math.max(SHEET_EDGE + half, Math.min(window.innerWidth - SHEET_EDGE - half, centre))),
    transform: 'translateX(-50%)',
  }
}
