// The shared INSIDES of a footer panel: one header row (small-caps title left, × right), one
// section label, one pill. Tokens: styles/panelSheet.ts — nothing here carries its own number.
// Used on BOTH platforms so the pieces read the same; only the outer box differs (phoneSheetStyle).
import type { ReactNode } from 'react'
import { PHONE_SHEET, SHEET_TYPE } from '../styles/panelSheet'

const LABEL = 'var(--iw-pill-fg, #78716c)'

export function SheetHeader({ title, onClose, right, onPointerDownCapture, style, closeTitle = 'Close' }: {
  title: ReactNode
  onClose?: () => void
  /** Extra controls between the title and the ×. */
  right?: ReactNode
  onPointerDownCapture?: (e: React.PointerEvent) => void
  style?: React.CSSProperties
  closeTitle?: string
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 shrink-0 border-b border-stone-100"
      style={{ padding: '8px 10px 6px 16px', ...style }}
      onPointerDownCapture={onPointerDownCapture}
    >
      <span className="uppercase tracking-wide" style={{ fontSize: SHEET_TYPE.label, color: LABEL }}>{title}</span>
      <div className="flex items-center gap-2">
        {right}
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            title={closeTitle}
            onClick={onClose}
            onMouseDown={e => e.preventDefault()}
            className="flex items-center justify-center rounded-full transition-colors hover:text-stone-600"
            // 44px: the phone tap-target floor; the glyph itself stays PHONE_SHEET.closePx.
            style={{ minWidth: 44, minHeight: 44, margin: -8, fontSize: PHONE_SHEET.closePx, lineHeight: 1, color: LABEL }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export function SheetSection({ label }: { label: string }) {
  return (
    <div className="px-5 pt-2.5 pb-1 uppercase tracking-widest" style={{ fontSize: SHEET_TYPE.label, color: LABEL }}>
      {label}
    </div>
  )
}

export function SheetPill({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      onMouseDown={e => e.preventDefault()}
      className="px-3 py-0.5 rounded-full transition-colors whitespace-nowrap"
      style={{
        fontSize: SHEET_TYPE.meta,
        background: active ? 'var(--iw-ink, #302438)' : 'transparent',
        color: active ? 'var(--iw-on-ink, #ffffff)' : LABEL,
        border: `1px solid ${active ? 'var(--iw-ink, #302438)' : 'var(--iw-nightable-border, #d1d5db)'}`,
      }}>
      {label}
    </button>
  )
}
