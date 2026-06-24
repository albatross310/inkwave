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
  getOrientation, setOrientation, type Orientation,
} from '../editor/pageSettings'

const INK = '#5c2d8a'
const isPhone = isTouchDevice()

// 1 cm = 96px / 2.54
const CM = 37.795
// Paragraph spacing is stored in em; base font-size assumed 18 px for the cm display
const EM_BASE = 18

// Presets in cm. Side: "high lower and low higher" (compressed range vs top/bot).
const SIDE_PRESETS    = [{ l: 'Low', v: 1.8 }, { l: 'Mid', v: 2.6 }, { l: 'High', v: 3.2 }]
const MARGIN_PRESETS  = [{ l: 'Low', v: 1.2 }, { l: 'Mid', v: 2.4 }, { l: 'High', v: 4.0 }]
const SPACING_PRESETS = [{ l: 'Low', v: 0.4 }, { l: 'Mid', v: 0.8 }, { l: 'High', v: 1.6 }]

// Conversion helpers between internal storage units and cm display
const pxConv  = { toCm: (px: number) => px / CM,        fromCm: (cm: number) => cm * CM }
const emConv  = { toCm: (em: number) => em * EM_BASE / CM, fromCm: (cm: number) => cm * CM / EM_BASE }

export function PageMenu({ editor }: { editor?: Editor }) {
  const [open, setOpen] = useState(false)
  const [, rerender] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Capture whether the editor was focused AT THE MOMENT the panel opened (before blur).
  const parFocusRef = useRef(false)
  const parFocus = parFocusRef.current

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll) }
  }, [open])

  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const left = Math.min(Math.max(8, Math.round(br.left)), window.innerWidth - 392)
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

  function applyParaPx(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}px` } as Record<string, string>).run()
    rerender(n => n + 1)
  }
  function applyParaEm(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}em` } as Record<string, string>).run()
    rerender(n => n + 1)
  }
  function applySide(px: number) {
    if (parFocus && editor) {
      editor.chain().setParaStyle({ paddingLeft: `${px}px`, paddingRight: `${px}px` } as Record<string, string>).run()
      rerender(n => n + 1)
    } else { applyGlobal(() => setSideMarginPx(px)) }
  }

  const cols        = getColumns()
  const paper       = getPaperSize()
  const orientation = getOrientation()

  const sideVal    = parFocus ? readPx('paddingLeft', getSideMarginPx) : getSideMarginPx()
  const topVal     = parFocus ? readPx('marginTop',   getTopMarginPx)  : getTopMarginPx()
  const botVal     = getBtmMarginPx()
  const spacingVal = readEm('marginBottom', getParaSpacingEm)

  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        onMouseDown={() => { parFocusRef.current = Boolean(editor?.isFocused) }}
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
            style={{ ...menuStyle(), width: 384, border: `1px solid ${INK}55`, borderRadius: 14 }}
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
              <MRow label={parFocus ? 'Indent' : 'Side'} presets={SIDE_PRESETS} conv={pxConv}
                value={sideVal} minCm={0} maxCm={8}
                onChange={px => applySide(px)} />
            )}

            <MRow label="Top" presets={MARGIN_PRESETS} conv={pxConv}
              value={topVal} minCm={0} maxCm={12}
              onChange={px => parFocus ? applyParaPx('marginTop', px) : applyGlobal(() => setTopMarginPx(px))} />

            {!parFocus && (
              <MRow label="Bot" presets={MARGIN_PRESETS} conv={pxConv}
                value={botVal} minCm={0} maxCm={12}
                onChange={px => applyGlobal(() => setBtmMarginPx(px))} />
            )}

            <MRow label={'Para\nspacing'} presets={SPACING_PRESETS} conv={emConv}
              value={spacingVal} minCm={0} maxCm={4}
              onChange={em => parFocus ? applyParaEm('marginBottom', em) : applyGlobal(() => setParaSpacingEm(em))} />

            {/* ── Layout ── */}
            <SectionHead label="Layout" />

            <div className="flex items-center px-5 py-2 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Columns</span>
              <div className="flex gap-2">
                {[1, 2, 3].map(n => (
                  <Chip key={n} label={String(n)} active={cols === n}
                    onClick={() => applyGlobal(() => setColumns(n))} />
                ))}
              </div>
            </div>

            <div className="flex items-center px-5 py-2 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Paper</span>
              <div className="flex gap-2">
                {(['a4', 'letter', 'scroll'] as PaperSize[]).map(ps => (
                  <Chip key={ps} label={ps === 'a4' ? 'A4' : ps === 'letter' ? 'Letter' : 'Scroll'}
                    active={paper === ps} onClick={() => applyGlobal(() => setPaperSize(ps))} />
                ))}
              </div>
            </div>

            <div className="flex items-center px-5 py-2 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Orient</span>
              <div className="flex gap-2">
                {(['portrait', 'landscape'] as Orientation[]).map(o => (
                  <Chip key={o} label={o === 'portrait' ? 'Portrait' : 'Landscape'}
                    active={orientation === o} onClick={() => applyGlobal(() => setOrientation(o))} />
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

const STEP = 0.2 // cm per arrow click

function MRow({ label, presets, conv, value, minCm, maxCm, onChange }: {
  label: string
  presets: { l: string; v: number }[]
  conv: { toCm: (v: number) => number; fromCm: (cm: number) => number }
  value: number   // internal units (px or em)
  minCm: number; maxCm: number
  onChange: (internal: number) => void
}) {
  const snap  = (cm: number) => Math.round(cm / STEP) * STEP
  const clamp = (cm: number) => Math.max(minCm, Math.min(maxCm, cm))
  const displayed = snap(conv.toCm(value))
  const active = presets.find(p => Math.abs(p.v - displayed) < 0.05)

  const dec = (e: React.MouseEvent) => {
    e.preventDefault()
    onChange(conv.fromCm(clamp(snap(displayed - STEP))))
  }
  const inc = (e: React.MouseEvent) => {
    e.preventDefault()
    onChange(conv.fromCm(clamp(snap(displayed + STEP))))
  }

  return (
    <div className="flex items-center px-5 py-2 gap-3">
      <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0 leading-tight whitespace-pre-line">{label}</span>
      <div className="flex gap-1.5 flex-1 min-w-0">
        {presets.map(p => (
          <Chip key={p.l} label={p.l} active={active?.l === p.l} onClick={() => onChange(conv.fromCm(p.v))} />
        ))}
      </div>
      <div className="flex items-center shrink-0 gap-px">
        <button type="button" onMouseDown={dec}
          className="w-5 h-6 flex items-center justify-center text-stone-400 hover:text-[#5c2d8a] border border-stone-200 rounded-l text-base leading-none select-none">
          −
        </button>
        <input
          type="text" inputMode="decimal"
          value={displayed.toFixed(1)}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(conv.fromCm(clamp(v))) }}
          className="w-11 text-center text-xs border-t border-b border-stone-200 py-0.5 focus:outline-none focus:border-[#5c2d8a] bg-white"
          style={{ color: INK }} />
        <button type="button" onMouseDown={inc}
          className="w-5 h-6 flex items-center justify-center text-stone-400 hover:text-[#5c2d8a] border border-stone-200 rounded-r text-base leading-none select-none">
          +
        </button>
        <span className="text-[10px] text-stone-400 ml-1 w-4">cm</span>
      </div>
    </div>
  )
}
