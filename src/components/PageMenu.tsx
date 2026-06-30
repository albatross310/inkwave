import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { isTouchDevice } from '../editor/Scroll'
import { LINE_HEIGHTS, getLineHeight, setLineHeight } from '../editor/lineHeight'
import type { ParagraphStyleAttrs } from '../editor/extensions/ParagraphStyle'
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

// 96 CSS px = 1 inch = 2.54 cm (96 DPI reference)
const CM = 37.795   // px per cm
const EM_BASE = 18  // assumed font-size for em ↔ cm

// Presets in cm — snapped to 0.2 cm steps so the active state highlights correctly.
// Near Word-Normal: Low≈Narrow(0.5in), Mid≈Normal(1in), High≈Wide(1.5in).
const SIDE_PRESETS    = [{ l: 'Low', v: 1.2 }, { l: 'Mid', v: 2.6 }, { l: 'High', v: 4.0 }]
const MARGIN_PRESETS  = [{ l: 'Low', v: 1.2 }, { l: 'Mid', v: 2.6 }, { l: 'High', v: 4.0 }]
// Para mode "indent" presets are RELATIVE (extra beyond global). None = same as global margin.
const INDENT_PRESETS  = [{ l: 'None', v: 0 }, { l: 'Low', v: 1.2 }, { l: 'High', v: 2.6 }]
const SPACING_PRESETS = [{ l: 'Low', v: 0.4 }, { l: 'Mid', v: 0.8 }, { l: 'High', v: 1.6 }]

const pxConv = { toCm: (px: number) => px / CM,          fromCm: (cm: number) => cm * CM }
const emConv = { toCm: (em: number) => em * EM_BASE / CM, fromCm: (cm: number) => cm * CM / EM_BASE }

export function PageMenu({ editor }: { editor?: Editor }) {
  const [open, setOpen] = useState(false)
  const [, rerender] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Capture editor focus before the panel open click causes blur.
  const parFocusRef = useRef(false)
  const parFocus = parFocusRef.current

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, right: 16 }
    // Shift 24px right from the button's left edge so it sits inset from the right edge
    const right = Math.max(8, Math.round(window.innerWidth - br.right) - 24)
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), right }
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

  // When the global side margin changes, compensate every paragraph that has a per-paragraph
  // extra paddingLeft so its visual left position stays fixed (avoids the out-of-sync drift).
  function applyGlobalSide(newPx: number) {
    const delta = newPx - getSideMarginPx()
    setSideMarginPx(newPx)
    if (delta !== 0 && editor) {
      const { tr } = editor.state
      let changed = false
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph') return
        const lStr = node.attrs.paddingLeft as string | null
        const rStr = node.attrs.paddingRight as string | null
        if (!lStr && !rStr) return
        const l = Math.max(0, Math.round((parseFloat(lStr ?? '') || 0) - delta))
        const r = Math.max(0, Math.round((parseFloat(rStr ?? '') || 0) - delta))
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          paddingLeft:  l > 0 ? `${l}px` : null,
          paddingRight: r > 0 ? `${r}px` : null,
        })
        changed = true
      })
      if (changed) editor.view.dispatch(tr)
    }
    dispatch()
  }

  function applyParaPx(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}px` } as Record<string, string>).run()
    rerender(n => n + 1)
  }
  function applyParaEm(key: string, v: number) {
    editor?.chain().setParaStyle({ [key]: `${v}em` } as Record<string, string>).run()
    rerender(n => n + 1)
  }

  // Para mode "Indent": extra paddingLeft BEYOND the global margin (relative, not absolute).
  // Para mode "Side" row is hidden — the global margin row is always the absolute reference.
  const paraExtraLeft = parseFloat(paraAttrs.paddingLeft ?? '') || 0

  function applyIndent(extraPx: number) {
    editor?.chain().setParaStyle({
      paddingLeft:  extraPx > 0 ? `${Math.round(extraPx)}px` : null,
      paddingRight: extraPx > 0 ? `${Math.round(extraPx)}px` : null,
    } as Record<string, string>).run()
    rerender(n => n + 1)
  }

  // Copy all style attrs from the currently-focused paragraph to every other paragraph.
  function applyToAll() {
    if (!editor) return
    const currentAttrs = editor.getAttributes('paragraph')
    const { tr } = editor.state
    let changed = false
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...currentAttrs })
      changed = true
    })
    if (changed) editor.view.dispatch(tr)
    rerender(n => n + 1)
  }

  const cols        = getColumns()
  const paper       = getPaperSize()
  const orientation = getOrientation()

  const topVal     = parFocus ? readPx('marginTop', getTopMarginPx)  : getTopMarginPx()
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
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">P</span>
      </button>

      {open && createPortal(
        <>
          <div role="dialog" aria-label="Page settings"
            className="z-[91] bg-white shadow-xl font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), width: 384, border: `1px solid ${INK}55`, borderRadius: 14 }}
            onMouseDown={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-100">
              <span className="text-[11px] uppercase tracking-wide text-stone-400">Page</span>
              <div className="flex items-center gap-2">
                {parFocus && editor ? (
                  <>
                    <span className="text-[11px] italic" style={{ color: INK }}>↳ paragraph</span>
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={applyToAll}
                      className="text-[11px] px-2 py-0.5 rounded-full transition-colors"
                      style={{ background: `${INK}18`, color: INK, border: `1px solid ${INK}44` }}>
                      Apply to all
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-stone-400 italic">changes apply to all text</span>
                )}
                <button type="button" onClick={() => setOpen(false)} onMouseDown={e => e.preventDefault()}
                  className="ml-1 text-stone-400 hover:text-stone-600 transition-colors leading-none"
                  style={{ fontSize: 18, lineHeight: 1 }} title="Close (Esc)">
                  ×
                </button>
              </div>
            </div>

            {/* ── Margins ── */}
            <SectionHead label="Margins" />

            {/* Global side margin — always editable; applyGlobalSide compensates per-para overrides. */}
            {!isPhone && (
              <MRow label="Side" presets={SIDE_PRESETS} conv={pxConv}
                value={getSideMarginPx()} minCm={0} maxCm={10}
                onChange={px => applyGlobalSide(px)} />
            )}

            {/* Per-paragraph extra indent — only in para mode */}
            {!isPhone && parFocus && (
              <MRow label="Indent" presets={INDENT_PRESETS} conv={pxConv}
                value={paraExtraLeft} minCm={0} maxCm={8}
                onChange={px => applyIndent(px)} />
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

            {/* ── Text ── */}
            <SectionHead label="Text" />

            {/* First-line indent */}
            <div className="flex items-center px-5 py-2 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Indent</span>
              <div className="flex gap-1.5">
                {[
                  { l: 'None', v: null },
                  { l: 'Low',  v: '1em' },
                  { l: 'High', v: '2em' },
                ].map(p => {
                  const paraAttrsNow = (parFocus && editor) ? (editor.getAttributes('paragraph') as Partial<ParagraphStyleAttrs>) : {}
                  const cur = paraAttrsNow.textIndent ?? null
                  const active = p.v === null ? !cur : cur === p.v
                  return (
                    <Chip key={p.l} label={p.l} active={active}
                      onClick={() => {
                        editor?.chain().setParaStyle({ textIndent: p.v } as Partial<ParagraphStyleAttrs>).run()
                        rerender(n => n + 1)
                      }} />
                  )
                })}
              </div>
            </div>

            {/* Line height */}
            <div className="flex items-center px-5 py-2 gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0">Spacing</span>
              <div className="flex gap-1.5 flex-wrap">
                {LINE_HEIGHTS.map(lh => (
                  <Chip key={lh.label} label={lh.label} active={Math.abs(getLineHeight() - lh.value) < 0.01}
                    onClick={() => {
                      setLineHeight(lh.value)
                      editor?.chain().setLineHeight(lh.value.toString()).run()
                      window.dispatchEvent(new CustomEvent('inkwave:page-settings-changed'))
                      rerender(n => n + 1)
                    }} />
                ))}
              </div>
            </div>

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
      onMouseDown={e => e.preventDefault()}
      className="px-3 py-0.5 rounded-full text-xs transition-colors whitespace-nowrap"
      style={{ background: active ? INK : 'transparent', color: active ? 'white' : '#6b7280', border: `1px solid ${active ? INK : '#d1d5db'}` }}>
      {label}
    </button>
  )
}

const STEP = 0.2 // cm per arrow click

function MRow({ label, presets, conv, value, minCm, maxCm, readOnly = false, onChange }: {
  label: string
  presets: { l: string; v: number }[]
  conv: { toCm: (v: number) => number; fromCm: (cm: number) => number }
  value: number        // internal units (px or em)
  minCm: number; maxCm: number
  readOnly?: boolean
  onChange: (internal: number) => void
}) {
  const [inputStr, setInputStr] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  const snap  = (cm: number) => Math.round(cm / STEP) * STEP
  const clamp = (cm: number) => Math.max(minCm, Math.min(maxCm, cm))
  const displayed = snap(conv.toCm(value))
  const active = presets.find(p => Math.abs(p.v - displayed) < 0.05)

  const dec = () => { if (!readOnly) onChange(conv.fromCm(clamp(snap(displayed - STEP)))) }
  const inc = () => { if (!readOnly) onChange(conv.fromCm(clamp(snap(displayed + STEP)))) }

  const inputStyle: React.CSSProperties = readOnly
    ? { color: '#9ca3af', cursor: 'default' }
    : { color: INK }

  return (
    <div className="flex items-center px-5 py-2 gap-3">
      <span className="text-stone-500 text-xs uppercase tracking-wide w-20 shrink-0 leading-tight whitespace-pre-line">{label}</span>
      <div className="flex gap-1.5 flex-1 min-w-0">
        {presets.map(p => (
          <Chip key={p.l} label={p.l}
            active={!readOnly && active?.l === p.l}
            onClick={() => { if (!readOnly) onChange(conv.fromCm(p.v)) }} />
        ))}
      </div>
      {/* Spinner: ▲▼ arrows stacked inside the right side of the input box */}
      <div className="flex items-center shrink-0 gap-1">
        <div className="flex items-center border border-stone-200 rounded overflow-hidden" style={{ width: 72 }}>
          <input
            type="text" inputMode="decimal"
            value={inputFocused ? inputStr : displayed.toFixed(1)}
            readOnly={readOnly}
            onFocus={() => { if (!readOnly) { setInputStr(displayed.toFixed(1)); setInputFocused(true) } }}
            onBlur={() => {
              setInputFocused(false)
              if (!readOnly) { const v = parseFloat(inputStr); if (!isNaN(v)) onChange(conv.fromCm(clamp(v))) }
            }}
            onChange={e => {
              if (readOnly) return
              if (inputFocused) setInputStr(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = parseFloat(inputStr)
                if (!isNaN(v)) { onChange(conv.fromCm(clamp(v))); (e.target as HTMLInputElement).blur() }
              }
            }}
            className="flex-1 min-w-0 text-xs py-0.5 px-1.5 bg-transparent outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            style={inputStyle}
          />
          <div className="flex flex-col border-l border-stone-200 shrink-0" style={{ width: 16 }}>
            <button type="button" onClick={inc} onMouseDown={e => e.preventDefault()} tabIndex={-1}
              className={`flex items-center justify-center border-b border-stone-200 ${readOnly ? 'cursor-default text-stone-200' : 'text-stone-400 hover:text-[#5c2d8a] hover:bg-stone-50'}`}
              style={{ height: 13, fontSize: 7 }}>
              ▲
            </button>
            <button type="button" onClick={dec} onMouseDown={e => e.preventDefault()} tabIndex={-1}
              className={`flex items-center justify-center ${readOnly ? 'cursor-default text-stone-200' : 'text-stone-400 hover:text-[#5c2d8a] hover:bg-stone-50'}`}
              style={{ height: 13, fontSize: 7 }}>
              ▼
            </button>
          </div>
        </div>
        <span className="text-[10px] text-stone-400 shrink-0">cm</span>
      </div>
    </div>
  )
}
