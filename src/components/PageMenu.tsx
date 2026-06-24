import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/Scroll'
import {
  getSideMarginPx, setSideMarginPx,
  getTopMarginPx, setTopMarginPx,
  getBtmMarginPx, setBtmMarginPx,
  getParaSpacingEm, setParaSpacingEm,
  getColumns, setColumns,
  getPaperSize, setPaperSize, type PaperSize,
} from '../editor/pageSettings'

const INK = '#5c2d8a'
const isPhone = isTouchDevice()

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
      left: Math.max(8, Math.round(br.left)),
    }
  }

  function apply() {
    rerender(n => n + 1)
    window.dispatchEvent(new CustomEvent('inkwave:page-settings-changed'))
  }

  const cols = getColumns()
  const paper = getPaperSize()

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
            className="z-[91] w-52 bg-white shadow-lg font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), border: `1px solid ${INK}55`, borderRadius: 12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-stone-400">Page</div>

            {/* Side margins — desktop only */}
            {!isPhone && (
              <NumRow label="Side margins" unit="px" value={getSideMarginPx()} min={0} max={200} step={4}
                onChange={v => { setSideMarginPx(v); apply() }} />
            )}

            <NumRow label="Top margin" unit="px" value={getTopMarginPx()} min={0} max={300} step={8}
              onChange={v => { setTopMarginPx(v); apply() }} />

            <NumRow label="Bottom margin" unit="px" value={getBtmMarginPx()} min={0} max={400} step={8}
              onChange={v => { setBtmMarginPx(v); apply() }} />

            <NumRow label="Para spacing" unit="em" value={getParaSpacingEm()} min={0} max={4} step={0.1} decimals={1}
              onChange={v => { setParaSpacingEm(v); apply() }} />

            {/* Columns */}
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-stone-400 mb-1.5">Columns</div>
              <div className="flex gap-1.5">
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { setColumns(n); apply() }}
                    className="flex-1 py-0.5 rounded-full text-xs transition-colors"
                    style={{
                      background: cols === n ? INK : 'transparent',
                      color: cols === n ? 'white' : '#6b7280',
                      border: `1px solid ${cols === n ? INK : '#d1d5db'}`,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Paper size */}
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-stone-400 mb-1.5">Paper size</div>
              <div className="flex gap-1.5">
                {(['a4', 'letter', 'scroll'] as PaperSize[]).map(ps => (
                  <button
                    key={ps}
                    type="button"
                    onClick={() => { setPaperSize(ps); apply() }}
                    className="flex-1 py-0.5 rounded-full text-xs transition-colors capitalize"
                    style={{
                      background: paper === ps ? INK : 'transparent',
                      color: paper === ps ? 'white' : '#6b7280',
                      border: `1px solid ${paper === ps ? INK : '#d1d5db'}`,
                    }}
                  >
                    {ps === 'a4' ? 'A4' : ps === 'letter' ? 'Letter' : 'Scroll'}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-2" />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function NumRow({ label, unit, value, min, max, step, decimals = 0, onChange }: {
  label: string; unit: string; value: number
  min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const fmt = (v: number) => decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))

  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-stone-600">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(clamp(parseFloat(fmt(value - step))))}
          className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-[#5c2d8a] hover:bg-stone-100 text-base leading-none">−</button>
        <input
          type="number" min={min} max={max} step={step}
          value={fmt(value)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)) }}
          className="w-12 text-center text-xs border border-stone-200 rounded py-0.5 focus:outline-none focus:border-[#5c2d8a]"
          style={{ color: INK }}
        />
        <button type="button" onClick={() => onChange(clamp(parseFloat(fmt(value + step))))}
          className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-[#5c2d8a] hover:bg-stone-100 text-base leading-none">+</button>
        <span className="text-[11px] text-stone-400 w-5">{unit}</span>
      </div>
    </div>
  )
}
