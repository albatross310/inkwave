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

// ─── THE DESKTOP SHEET — the same panels, sized for a pointer (Peter, 2026-09-18) ──────────────
// Screenshots at 1440×900 showed the desktop panels each at their own size: Settings 208px wide in
// 13px type beside a 470px Guide, the ⋮ menu at 230px, its modals at 300px, the receipt at 210px.
// ONE width for a menu-shaped panel, one for a modal, one radius / border / shadow, one type ramp
// (15/13/12/11 — index.css :root), and the SheetHeader on every one of them.
export const DESKTOP_SHEET = {
  /** Menu-shaped panels: Settings, ⋮, receipt, sync, math, media, clock. */
  widthPx: 340,
  /** Dialog-shaped panels (Save / Open / Export…, citations). */
  modalWidthPx: 400,
  radiusPx: 14,
  fontPx: 15,
  shadow: 'var(--iw-sheet-shadow, 0 10px 40px rgba(28, 25, 23, 0.18))',
  border: '1px solid var(--iw-nightable-border, #e7e5e4)',
} as const

/** Class on a desktop panel's outer box (index.css `.iw-desktop-sheet`): the type ramp remaps. */
export const DESKTOP_SHEET_CLASS = 'iw-desktop-sheet'

/** The desktop box: radius, shadow, border and body type. Position and width are the caller's. */
/**
 * The SHEET EDGE alone — radius, shadow, border, no type size. Platform-agnostic on purpose: the
 * two sheets' edge values are identical (radius 14, the same nightable border token), and only
 * their body size differs. A small menu that renders on BOTH platforms inside a bar — ReviewBar's
 * annotation-set menu, EmailComposePanel's provider menu — wears this rather than
 * `desktopSheetStyle()` with the font knocked back out, so nothing reads as desktop-only styling
 * being applied to a phone (Max's review of #28, 2026-09-19).
 */
export function sheetEdgeStyle(): CSSProperties {
  return {
    borderRadius: DESKTOP_SHEET.radiusPx,
    boxShadow: DESKTOP_SHEET.shadow,
    border: DESKTOP_SHEET.border,
  }
}

export function desktopSheetStyle(): CSSProperties {
  return {
    borderRadius: DESKTOP_SHEET.radiusPx,
    boxShadow: DESKTOP_SHEET.shadow,
    border: DESKTOP_SHEET.border,
    fontSize: DESKTOP_SHEET.fontPx,
  }
}

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

// ─── THE DESKTOP TAXONOMY — popup / panel / bar (Peter, 2026-09-18) ───────────────────────────
// "Need to divide into panels (big) and popovers (small eg hamburger). Panels should all be
// centralised sensibly on the screen, ideally with same width if it fits. All a bit under width of
// paper, so they can resize with whole page zoom. Popovers need to be centralised over the button —
// a little speech-bubble bezier triangle, middle bottom, pointing to just above the button."
// Three categories, three type sizes (popup 14 / panel 15 / bar 14 — index.css), one helper each.
// A component picks its category HERE and never carries its own anchor maths again.

/** POPUP: content-sized, anchored over its trigger, tail pointing at the trigger. */
export const DESKTOP_POPUP = {
  /** Air between the tail's tip and the trigger's top edge. */
  gapPx: 10,
  /** The SVG tail's height (index.css .iw-desktop-popup::after). */
  tailPx: 12,
  minWidthPx: 200,
  maxWidthPx: 340,
  fontPx: 14,
  /** The popup never gets closer than this to the viewport's side edges. */
  edgePx: 8,
} as const
export const DESKTOP_POPUP_CLASS = 'iw-desktop-popup'

/**
 * Fixed above `anchor` (the trigger's rect, measured at open), horizontally centred on it and
 * clamped to the viewport; `--iw-tail-x` carries the trigger's centre into the CSS tail so the
 * tail still points at the button when the box has been pushed off-centre by the clamp.
 */
export function desktopPopupStyle(anchor: { left: number; width: number; top: number } | null | undefined, widthPx?: number): CSSProperties {
  const base: CSSProperties = {
    position: 'fixed',
    borderRadius: DESKTOP_SHEET.radiusPx,
    boxShadow: DESKTOP_SHEET.shadow,
    border: DESKTOP_SHEET.border,
    fontSize: DESKTOP_POPUP.fontPx,
    minWidth: DESKTOP_POPUP.minWidthPx,
    maxWidth: `min(${DESKTOP_POPUP.maxWidthPx}px, 96vw)`,
    ...(widthPx ? { width: widthPx } : { width: 'max-content' }),
  }
  if (!anchor || typeof window === 'undefined') return { ...base, bottom: 80, left: '50%', transform: 'translateX(-50%)' }
  const w = widthPx ?? DESKTOP_POPUP.maxWidthPx
  const half = w / 2
  const centre = anchor.left + anchor.width / 2
  const left = Math.round(Math.max(DESKTOP_POPUP.edgePx + half, Math.min(window.innerWidth - DESKTOP_POPUP.edgePx - half, centre)))
  return {
    ...base,
    bottom: Math.round(window.innerHeight - anchor.top + DESKTOP_POPUP.gapPx + DESKTOP_POPUP.tailPx),
    left,
    transform: 'translateX(-50%)',
    ['--iw-tail-x' as string]: `calc(50% + ${Math.round(centre - left)}px)`,
  }
}

/** PANEL: big, centred over the writing, a bit under the paper's width so it zooms with the page. */
export const DESKTOP_PANEL = {
  /** Fraction of the paper's live width (`--iw-paper-w`, written by Scroll's ResizeObserver). */
  paperFrac: 0.92,
  /** Floor / ceiling so a tiny or huge zoom still gives a usable dialog. */
  minWidthPx: 420,
  maxWidthPx: 960,
  maxHeightVh: 84,
  fontPx: 15,
} as const
export const DESKTOP_PANEL_CLASS = 'iw-desktop-panel'

/** Centred on the writing area (shifted off a docked PDF panel), sized from the paper. */
export function desktopPanelStyle(): CSSProperties {
  return {
    position: 'fixed',
    top: '50%',
    left: 'calc(50% - var(--iw-pdf-room, 0px) / 2 + var(--iw-pdf-room-left, 0px) / 2)',
    transform: 'translate(-50%, -50%)',
    width: `clamp(${DESKTOP_PANEL.minWidthPx}px, calc(var(--iw-paper-w, 760px) * ${DESKTOP_PANEL.paperFrac}), min(${DESKTOP_PANEL.maxWidthPx}px, 96vw))`,
    maxHeight: `${DESKTOP_PANEL.maxHeightVh}vh`,
    borderRadius: DESKTOP_SHEET.radiusPx,
    boxShadow: DESKTOP_SHEET.shadow,
    border: DESKTOP_SHEET.border,
    fontSize: DESKTOP_PANEL.fontPx,
  }
}

/** BAR: the style / review / music rows above the toolbar pill (TiptapEditor DESKTOP_BAR_CLASS). */
export const DESKTOP_BAR = { fontPx: 14 } as const
