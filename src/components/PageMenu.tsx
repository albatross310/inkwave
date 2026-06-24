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

// Named presets for each dimension
const SIDE_PRESETS   = [{ l: 'Compact', v: 16 }, { l: 'Normal', v: 40 }, { l: 'Wide', v: 80 }]
const TOP_PRESETS    = [{ l: 'Small', v: 16 },   { l: 'Normal', v: 32 }, { l: 'Large', v: 64 }]
const BTM_PRESETS    = [{ l: 'Small', v: 48 },   { l: 'Normal', v: 96 }, { l: 'Large', v: 160 }]
const PARA_PRESETS   = [{ l: 'Tight', v: 0 },    { l: 'Normal', v: 0.5 }, { l: 'Loose', v: 1.5 }]

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
    // Anchor left edge to button, but keep on screen
    const left = Math.min(Math.max(8, Math.round(br.left)), window.innerWidth - 340)
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), left }
  }

  function apply() {
    rerender(n => n + 1)
    window.dispatchEvent(new CustomEvent('inkwave:page-settings-changed'))
  }

  const cols  = getColumns()
  const paper = getPaperSize()

  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Page settings">
        <span className="flex items-center justify-center w-7 h-7 rounded-full border-[1.5px] border-current text-[13px] italic leading-none">p</span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <div role="dialog" aria-label="Page settings"
            className="z-[91] bg-white shadow-xl font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), width: 320, border: `1px solid ${INK}55`, borderRadius: 14 }}
            onMouseDown={e => e.stopPropagation()}>

            <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-stone-400 border-b border-stone-100">
              Page
            </div>

            {/* Side margins — desktop only */}
            {!isPhone && (
              <PresetRow label="Side margins" unit="px"
                presets={SIDE_PRESETS} value={getSideMarginPx()} min={0} max={200} step={4}
                onChange={v => { setSideMarginPx(v); apply() }} />
            )}

            <PresetRow label="Top margin" unit="px"
              presets={TOP_PRESETS} value={getTopMarginPx()} min={0} max={300} step={8}
              onChange={v => { setTopMarginPx(v); apply() }} />

            <PresetRow label="Bottom margin" unit="px"
              presets={BTM_PRESETS} value={getBtmMarginPx()} min={0} max={400} step={8}
              onChange={v => { setBtmMarginPx(v); apply() }} />

            <PresetRow label="Para spacing" unit="em"
              presets={PARA_PRESETS} value={getParaSpacingEm()} min={0} max={4} step={0.1} decimals={1}
              onChange={v => { setParaSpacingEm(v); apply() }} />

            {/* Columns */}
            <div className="flex items-center px-4 py-2.5 gap-3 border-t border-stone-100 mt-1">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-24 shrink-0">Columns</span>
              <div className="flex gap-1.5">
                {[1, 2, 3].map(n => (
                  <Chip key={n} label={String(n)} active={cols === n} onClick={() => { setColumns(n); apply() }} />
                ))}
              </div>
            </div>

            {/* Paper size */}
            <div className="flex items-center px-4 py-2.5 gap-3">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-24 shrink-0">Paper</span>
              <div className="flex gap-1.5">
                {(['a4', 'letter', 'scroll'] as PaperSize[]).map(ps => (
                  <Chip key={ps} label={ps === 'a4' ? 'A4' : ps === 'letter' ? 'Letter' : 'Scroll'}
                    active={paper === ps} onClick={() => { setPaperSize(ps); apply() }} />
                ))}
              </div>
            </div>

            <div className="h-1" />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-2.5 py-0.5 rounded-full text-xs transition-colors whitespace-nowrap"
      style={{ background: active ? INK : 'transparent', color: active ? 'white' : '#6b7280', border: `1px solid ${active ? INK : '#d1d5db'}` }}>
      {label}
    </button>
  )
}

function PresetRow({ label, unit, presets, value, min, max, step, decimals = 0, onChange }: {
  label: string; unit: string
  presets: { l: string; v: number }[]
  value: number; min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const fmt   = (v: number) => decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))
  const activePreset = presets.find(p => Math.abs(p.v - value) < 0.001)

  return (
    <div className="px-4 py-2 flex items-center gap-2">
      <span className="text-stone-500 text-xs uppercase tracking-wide w-24 shrink-0">{label}</span>
      {/* Preset chips */}
      <div className="flex gap-1 flex-1">
        {presets.map(p => (
          <Chip key={p.l} label={p.l} active={activePreset?.l === p.l} onClick={() => onChange(p.v)} />
        ))}
      </div>
      {/* Manual number input */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button type="button" onClick={() => onChange(clamp(parseFloat(fmt(value - step))))}
          className="w-5 h-5 flex items-center justify-center text-stone-400 hover:text-[#5c2d8a] rounded hover:bg-stone-100 text-base leading-none">−</button>
        <input type="number" min={min} max={max} step={step} value={fmt(value)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)) }}
          className="w-12 text-center text-xs border border-stone-200 rounded py-0.5 focus:outline-none focus:border-[#5c2d8a]"
          style={{ color: INK }} />
        <button type="button" onClick={() => onChange(clamp(parseFloat(fmt(value + step))))}
          className="w-5 h-5 flex items-center justify-center text-stone-400 hover:text-[#5c2d8a] rounded hover:bg-stone-100 text-base leading-none">+</button>
        <span className="text-[10px] text-stone-400 w-5">{unit}</span>
      </div>
    </div>
  )
}
