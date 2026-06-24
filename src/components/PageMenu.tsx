import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  COL_WIDTHS, getColWidth, setColWidth, type ColWidth,
  PAGE_MARGINS, getPageMargin, setPageMargin, type PageMargin,
  PARA_SPACINGS, getParaSpacing, setParaSpacing, type ParaSpacing,
  PAPER_SIZES, getPaperSize, setPaperSize, type PaperSize,
} from '../editor/pageSettings'

const INK = '#5c2d8a'

export function PageMenu() {
  const [open, setOpen] = useState(false)
  const [, rerender] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    return {
      position: 'fixed',
      bottom: Math.round(window.innerHeight - br.top + 8),
      left: Math.round(br.left),
    }
  }

  function pick<T>(setter: (v: T) => void, value: T) {
    setter(value)
    rerender(n => n + 1)
    // Re-apply layout — reload only when gapped pages is involved (done elsewhere).
    window.dispatchEvent(new CustomEvent('inkwave:page-settings-changed'))
  }

  const colWidth   = getColWidth()
  const pageMargin = getPageMargin()
  const paraSpacing = getParaSpacing()
  const paperSize  = getPaperSize()

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Page settings"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-full border-[1.5px] border-current text-[13px] italic leading-none">
          p
        </span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Page settings"
            className="z-[91] w-56 bg-white shadow-lg font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), border: `1px solid ${INK}55`, borderRadius: 12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-stone-400">Page</div>

            <Section label="Column width">
              <Chips
                options={COL_WIDTHS.map(o => ({ label: o.label, value: o.value }))}
                value={colWidth}
                onChange={(v) => pick(setColWidth, v as ColWidth)}
              />
            </Section>

            <Section label="Margins">
              <Chips
                options={PAGE_MARGINS.map(o => ({ label: o.label, value: o.value }))}
                value={pageMargin}
                onChange={(v) => pick(setPageMargin, v as PageMargin)}
              />
            </Section>

            <Section label="Paragraph spacing">
              <Chips
                options={PARA_SPACINGS.map(o => ({ label: o.label, value: o.value }))}
                value={paraSpacing}
                onChange={(v) => pick(setParaSpacing, v as ParaSpacing)}
              />
            </Section>

            <Section label="Paper size">
              <Chips
                options={PAPER_SIZES.map(o => ({ label: o.label, value: o.value }))}
                value={paperSize}
                onChange={(v) => pick(setPaperSize, v as PaperSize)}
              />
            </Section>

            <div className="h-3" />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2">
      <div className="text-[11px] text-stone-400 mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function Chips({ options, value, onChange }: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="px-2.5 py-0.5 rounded-full text-xs transition-colors"
          style={{
            background: o.value === value ? INK : 'transparent',
            color: o.value === value ? 'white' : '#6b7280',
            border: `1px solid ${o.value === value ? INK : '#d1d5db'}`,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
