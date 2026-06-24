import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { isTouchDevice } from '../editor/Scroll'
import {
  getSideMarginPx, setSideMarginPx,
  getTopMarginPx,  setTopMarginPx,
  getBtmMarginPx,  setBtmMarginPx,
  getParaSpacingEm, setParaSpacingEm,
  getColumns, setColumns,
  getPaperSize, setPaperSize, type PaperSize,
} from '../editor/pageSettings'

const INK = '#5c2d8a'
const isPhone = isTouchDevice()

const PX_PRESETS  = [{ l: 'Low', v: 16 }, { l: 'Mid', v: 40 }, { l: 'High', v: 80 }]
const EM_PRESETS  = [{ l: 'Low', v: 0 },  { l: 'Mid', v: 0.5 }, { l: 'High', v: 1.5 }]

export function PageMenu({ editor }: { editor?: Editor }) {
  const [open, setOpen] = useState(false)
  const [, rerender] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [parFocus, setParFocus] = useState(false)

  useEffect(() => {
    if (!editor) return
    const sync = () => setParFocus(editor.isFocused)
    editor.on('focus', sync); editor.on('blur', sync); editor.on('selectionUpdate', sync)
    return () => { editor.off('focus', sync); editor.off('blur', sync); editor.off('selectionUpdate', sync) }
  }, [editor])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const left = Math.min(Math.max(8, Math.round(br.left)), window.innerWidth - 648)
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), left }
  }

  const paraAttrs = (parFocus && editor) ? (editor.getAttributes('paragraph') as Record<string, string>) : {}
  const readPx = (key: string, fallback: () => number) =>
    parseFloat(paraAttrs[key] ?? '') || (parFocus ? 0 : fallback())
  const readEm = (key: string, fallback: () => number) =>
    parseFloat(paraAttrs[key] ?? '') || fallback()

  function dispatch() {
    rerender(n => n + 1)
    window.dispatchEvent(new CustomEvent('inkwave:page-settings-changed'))
  }

  function applyGlobal(fn: () => void) { fn(); dispatch() }

  // Para-mode helpers
  function applyParaPx(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}px` } as Record<string, string>).run()
    rerender(n => n + 1)
  }
  function applyParaEm(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}em` } as Record<string, string>).run()
    rerender(n => n + 1)
  }
  // Side margins: set both sides symmetrically
  function applySide(v: number) {
    if (parFocus && editor) {
      editor.chain().setParaStyle({ paddingLeft: `${v}px`, paddingRight: `${v}px` } as Record<string, string>).run()
      rerender(n => n + 1)
    } else { applyGlobal(() => setSideMarginPx(v)) }
  }

  const cols  = getColumns()
  const paper = getPaperSize()

  // In para mode: Side (indent), Top (margin-top), Para spacing (margin-bottom) — hide Bot
  // In doc mode: Side, Top, Bot, Para spacing
  const sideVal  = parFocus ? readPx('paddingLeft', getSideMarginPx) : getSideMarginPx()
  const topVal   = parFocus ? readPx('marginTop',   getTopMarginPx)  : getTopMarginPx()
  const botVal   = getBtmMarginPx()
  const spacingVal = readEm('marginBottom', getParaSpacingEm)

  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif
          ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Page settings">
        <span className="flex items-center justify-center w-7 h-7 rounded-full border-[1.5px] border-current text-[13px] italic leading-none">p</span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <div role="dialog" aria-label="Page settings"
            className="z-[91] bg-white shadow-xl font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), width: 640, border: `1px solid ${INK}55`, borderRadius: 14 }}
            onMouseDown={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-100">
              <span className="text-[11px] uppercase tracking-wide text-stone-400">Page</span>
              {parFocus && editor && (
                <span className="text-[11px] italic" style={{ color: INK }}>↳ selected paragraph</span>
              )}
            </div>

            {/* ── Margins ── */}
            <SectionHead label="Margins" />

            {!isPhone && (
              <MRow label={parFocus ? 'Indent' : 'Side'} unit="px" presets={PX_PRESETS}
                value={sideVal} min={0} max={200} step={4}
                onChange={applySide} />
            )}

            <MRow label="Top" unit="px" presets={PX_PRESETS}
              value={topVal} min={0} max={300} step={8}
              onChange={v => parFocus ? applyParaPx('marginTop', v) : applyGlobal(() => setTopMarginPx(v))} />

            {!parFocus && (
              <MRow label="Bot" unit="px" presets={PX_PRESETS}
                value={botVal} min={0} max={400} step={8}
                onChange={v => applyGlobal(() => setBtmMarginPx(v))} />
            )}

            <MRow label={'Para\nspacing'} unit="em" presets={EM_PRESETS}
              value={spacingVal} min={0} max={4} step={0.1} decimals={1}
              onChange={v => parFocus ? applyParaEm('marginBottom', v) : applyGlobal(() => setParaSpacingEm(v))} />

            {/* ── Layout ── */}
            <SectionHead label="Layout" />

            <div className="flex items-center px-5 py-2.5 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Columns</span>
              <div className="flex gap-2">
                {[1, 2, 3].map(n => (
                  <Chip key={n} label={String(n)} active={cols === n}
                    onClick={() => applyGlobal(() => setColumns(n))} />
                ))}
              </div>
            </div>

            <div className="flex items-center px-5 py-2.5 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Paper</span>
              <div className="flex gap-2">
                {(['a4', 'letter', 'scroll'] as PaperSize[]).map(ps => (
                  <Chip key={ps} label={ps === 'a4' ? 'A4' : ps === 'letter' ? 'Letter' : 'Scroll'}
                    active={paper === ps} onClick={() => applyGlobal(() => setPaperSize(ps))} />
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

function SectionHead({ label }: { label: string }) {
  return (
    <div className="px-5 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-stone-400">{label}</div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-3 py-0.5 rounded-full text-xs transition-colors whitespace-nowrap"
      style={{ background: active ? INK : 'transparent', color: active ? 'white' : '#6b7280', border: `1px solid ${active ? INK : '#d1d5db'}` }}>
      {label}
    </button>
  )
}

function MRow({ label, unit, presets, value, min, max, step, decimals = 0, onChange }: {
  label: string; unit: string
  presets: { l: string; v: number }[]
  value: number; min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
}) {
  const fmt   = (v: number) => decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const active = presets.find(p => Math.abs(p.v - value) < 0.001)

  return (
    <div className="flex items-center px-5 py-2 gap-4">
      <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0 leading-tight whitespace-pre-line">{label}</span>
      <div className="flex gap-2 flex-1">
        {presets.map(p => (
          <Chip key={p.l} label={p.l} active={active?.l === p.l} onClick={() => onChange(p.v)} />
        ))}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <input type="number" min={min} max={max} step={step} value={fmt(value)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)) }}
          className="w-16 text-center text-xs border border-stone-200 rounded py-0.5 focus:outline-none focus:border-[#5c2d8a]"
          style={{ color: INK }} />
        <span className="text-[10px] text-stone-400 w-5">{unit}</span>
      </div>
    </div>
  )
}
