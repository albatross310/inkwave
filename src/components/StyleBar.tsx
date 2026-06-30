// StyleBar — formatting controls above the main toolbar.
// Acts on the current selection.
//
// All buttons use onMouseDown with e.preventDefault() (via the container) so the editor
// never loses focus or selection when the user clicks a format button.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { LINE_HEIGHTS, getLineHeight, setLineHeight } from '../editor/lineHeight'
import type { ParagraphStyleAttrs } from '../editor/extensions/ParagraphStyle'

const INK = '#5c2d8a'
const BASE_SIZE = 18   // editor root px (matches .ProseMirror { font-size: 1.125rem })
const PT_TO_PX = 96 / 72  // 1pt = 1.3333px at 96 DPI

const FONTS = [
  { label: 'Fell',        css: "'IM Fell DW Pica', 'EB Garamond', Georgia, serif" },
  { label: 'Garamond',    css: "'EB Garamond', Georgia, serif" },
  { label: 'Times',       css: "'Times New Roman', Times, serif" },
  { label: 'Cambria',     css: "Cambria, Georgia, serif" },
  { label: 'Georgia',     css: "Georgia, serif" },
  { label: 'Palatino',    css: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: 'Baskerville', css: "'Baskerville Old Face', Baskerville, 'Book Antiqua', serif" },
  { label: 'Sans',        css: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
]

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

const HIGHLIGHT_COLORS = [
  { label: 'Yellow', color: '#fef08a' },
  { label: 'Green',  color: '#bbf7d0' },
  { label: 'Blue',   color: '#bae6fd' },
  { label: 'Pink',   color: '#fbcfe8' },
  { label: 'Orange', color: '#fed7aa' },
  { label: 'Clear',  color: null },
]

type Align = 'left' | 'center' | 'right' | 'justify'

function BulletListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="2.5" cy="3.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="7"   r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <line x1="5" y1="3.5" x2="12" y2="3.5" />
      <line x1="5" y1="7"   x2="12" y2="7" />
      <line x1="5" y1="10.5" x2="10" y2="10.5" />
    </svg>
  )
}

function OrderedListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <text x="0.5" y="4.5"  fontSize="4" fill="currentColor" stroke="none" fontFamily="serif">1.</text>
      <text x="0.5" y="8"    fontSize="4" fill="currentColor" stroke="none" fontFamily="serif">2.</text>
      <text x="0.5" y="11.5" fontSize="4" fill="currentColor" stroke="none" fontFamily="serif">3.</text>
      <line x1="5" y1="3.5" x2="12" y2="3.5" />
      <line x1="5" y1="7"   x2="12" y2="7" />
      <line x1="5" y1="10.5" x2="10" y2="10.5" />
    </svg>
  )
}

export function StyleBar({ editor, onActivity, onLineHeightChange, phone }: {
  editor: Editor
  onActivity?: () => void
  onLineHeightChange?: (v: number) => void
  phone?: boolean
}) {
  const [, force] = useState(0)
  const [fontOpen,  setFontOpen]  = useState(false)
  const [sizeOpen,  setSizeOpen]  = useState(false)
  const [boldOpen,  setBoldOpen]  = useState(false)
  const [hlOpen,    setHlOpen]    = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [listOpen,  setListOpen]  = useState(false)
  const [paraOpen,  setParaOpen]  = useState(false)
  const [pageOpen,  setPageOpen]  = useState(false)

  const fontBtnRef  = useRef<HTMLButtonElement>(null)
  const sizeBtnRef  = useRef<HTMLDivElement>(null)
  const boldBtnRef  = useRef<HTMLButtonElement>(null)
  const hlBtnRef    = useRef<HTMLButtonElement>(null)
  const alignBtnRef = useRef<HTMLButtonElement>(null)
  const listBtnRef  = useRef<HTMLButtonElement>(null)
  const paraBtnRef  = useRef<HTMLButtonElement>(null)
  const pageBtnRef  = useRef<HTMLButtonElement>(null)

  const [sizeStr,     setSizeStr]     = useState('')
  const [sizeFocused, setSizeFocused] = useState(false)

  const ping = () => onActivity?.()

  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  const closeAll = () => {
    setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setHlOpen(false)
    setAlignOpen(false); setListOpen(false); setParaOpen(false); setPageOpen(false)
  }

  // Close all popups on outside click / Escape.
  useEffect(() => {
    const anyOpen = fontOpen || sizeOpen || boldOpen || hlOpen || alignOpen || listOpen || paraOpen || pageOpen
    if (!anyOpen) return
    const onDown = () => closeAll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [fontOpen, sizeOpen, boldOpen, hlOpen, alignOpen, listOpen, paraOpen, pageOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const ts = editor.getAttributes('textStyle')
  const paraAttrs = editor.getAttributes('paragraph')
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const rawFontSize = ts.fontSize ?? ''
  const curSizePx = rawFontSize.endsWith('em')
    ? parseFloat(rawFontSize) * BASE_SIZE
    : parseInt(rawFontSize, 10) || BASE_SIZE
  const curSize = Math.round(curSizePx / PT_TO_PX)
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'
  const curLH = parseFloat(paraAttrs.lineHeight ?? '') || getLineHeight()

  const setFont  = (css: string) => { ping(); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize  = (pt: number) => {
    ping()
    const em = +((pt * PT_TO_PX) / BASE_SIZE).toFixed(4)
    editor.chain().setMark('textStyle', { fontSize: `${em}em` }).run()
    setSizeOpen(false)
  }
  const setAlign = (a: Align) => { ping(); editor.chain().setTextAlign(a).run(); setAlignOpen(false) }

  const pickLineHeight = (v: number) => {
    setLineHeight(v)
    onLineHeightChange?.(v)
    editor.chain().setLineHeight(v.toString()).run()
    setParaOpen(false)
    ping()
  }

  // Popup positioned above its anchor button.
  function popupAbove(ref: React.RefObject<HTMLElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }

  // Shared popup container style.
  function popupStyle(width: number): React.CSSProperties {
    return { border: `1px solid ${INK}55`, borderRadius: 12, width }
  }

  const boldActive  = editor.isActive('bold') || editor.isActive('italic') || editor.isActive('underline') || editor.isActive('strike')
  const listActive  = editor.isActive('bulletList') || editor.isActive('orderedList')
  const indented    = !!(paraAttrs.textIndent as string | null)
  const curHlColor  = (editor.getAttributes('highlight') as { color?: string }).color ?? null

  return (
    // onMouseDown with preventDefault prevents buttons from stealing focus and deselecting text.
    // The input's own click stops propagation so it can still receive focus for typing.
    <div
      className="flex items-center gap-1.5 text-sm text-stone-500 font-serif w-full"
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}
    >

      {/* ── Font drop-up ── */}
      <button ref={fontBtnRef} type="button" aria-haspopup="dialog" aria-expanded={fontOpen}
        onClick={e => { e.stopPropagation(); setFontOpen(o => !o); setSizeOpen(false); setBoldOpen(false); setHlOpen(false); setAlignOpen(false); setListOpen(false); setParaOpen(false); setPageOpen(false) }}
        className="rounded border border-stone-300 px-2 py-0.5 text-stone-500 hover:border-stone-400 transition-colors min-w-[5.5rem] text-left whitespace-nowrap">
        {curFont}
      </button>

      {fontOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setFontOpen(false)} />
          <div role="dialog" aria-label="Choose font" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(fontBtnRef), ...popupStyle(136) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {FONTS.map(f => (
              <button key={f.label} type="button" onClick={() => setFont(f.css)}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 truncate"
                style={{ fontFamily: f.css, color: f.label === curFont ? INK : '#374151',
                  fontWeight: f.label === curFont ? 500 : 400,
                  borderLeft: f.label === curFont ? `2px solid ${INK}` : '2px solid transparent' }}>
                {f.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* ── Size: text input + click-container opens picker ── */}
      <div ref={sizeBtnRef}
        className="flex items-center rounded border border-stone-300 hover:border-stone-400 transition-colors cursor-pointer"
        style={{ minWidth: 48 }}
        onClick={e => { e.stopPropagation(); closeAll(); setSizeOpen(o => !o) }}>
        <input
          type="text" inputMode="numeric"
          value={sizeFocused ? sizeStr : String(curSize)}
          onFocus={() => { setSizeStr(String(curSize)); setSizeFocused(true) }}
          onBlur={() => { setSizeFocused(false); const v = parseInt(sizeStr, 10); if (v >= 4 && v <= 200) setSize(v) }}
          onChange={e => setSizeStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = parseInt(sizeStr, 10); if (v >= 4 && v <= 200) { setSize(v); (e.target as HTMLInputElement).blur() } } }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          className="w-10 text-center text-sm py-0.5 bg-transparent outline-none text-stone-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      {sizeOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setSizeOpen(false)} />
          <div role="dialog" aria-label="Font size" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(sizeBtnRef), ...popupStyle(96) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            <div className="grid grid-cols-2">
              {FONT_SIZES.map(sz => (
                <button key={sz} type="button" onClick={() => setSize(sz)}
                  className="text-center px-2 py-1 text-sm transition-colors hover:bg-stone-50"
                  style={{ color: sz === curSize ? INK : '#374151',
                    fontWeight: sz === curSize ? 600 : 400,
                    background: sz === curSize ? `${INK}12` : undefined }}>
                  {sz}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* ── B drop-up: Bold / Italic / Underline / Strikethrough ── */}
      <button ref={boldBtnRef} type="button" aria-haspopup="dialog" aria-expanded={boldOpen}
        onClick={e => { e.stopPropagation(); setBoldOpen(o => !o); setFontOpen(false); setSizeOpen(false); setHlOpen(false); setAlignOpen(false); setListOpen(false); setParaOpen(false); setPageOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors font-bold ${boldActive || boldOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Character formatting">
        B
      </button>

      {boldOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setBoldOpen(false)} />
          <div role="dialog" aria-label="Character formatting" className="z-[99] bg-white shadow-xl py-1"
            style={{ ...popupAbove(boldBtnRef), ...popupStyle(130) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {[
              { key: 'bold',      label: 'Bold',          style: { fontWeight: 700 },                              cmd: () => editor.chain().toggleBold().run() },
              { key: 'italic',    label: 'Italic',        style: { fontStyle: 'italic' },                          cmd: () => editor.chain().toggleItalic().run() },
              { key: 'underline', label: 'Underline',     style: { textDecoration: 'underline' },                  cmd: () => editor.chain().toggleUnderline().run() },
              { key: 'strike',    label: 'Strikethrough', style: { textDecoration: 'line-through' },               cmd: () => editor.chain().toggleStrike().run() },
            ].map(item => {
              const active = editor.isActive(item.key)
              return (
                <button key={item.key} type="button"
                  onClick={() => { ping(); item.cmd(); }}
                  className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                  style={{ ...item.style, color: active ? INK : '#374151',
                    borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                  {item.label}
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}

      {/* ── Highlight drop-up ── */}
      <button ref={hlBtnRef} type="button" aria-haspopup="dialog" aria-expanded={hlOpen}
        onClick={e => { e.stopPropagation(); setHlOpen(o => !o); setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setAlignOpen(false); setListOpen(false); setParaOpen(false); setPageOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors ${curHlColor || hlOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Highlight"
        style={curHlColor ? { background: curHlColor, borderColor: `${INK}88` } : {}}>
        H
      </button>

      {hlOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setHlOpen(false)} />
          <div role="dialog" aria-label="Highlight colour" className="z-[99] bg-white shadow-xl p-2"
            style={{ ...popupAbove(hlBtnRef), ...popupStyle(148) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            <div className="grid grid-cols-3 gap-1.5">
              {HIGHLIGHT_COLORS.map(h => (
                <button key={h.label} type="button"
                  onClick={() => {
                    ping()
                    if (h.color) {
                      editor.chain().setHighlight({ color: h.color }).run()
                    } else {
                      editor.chain().unsetHighlight().run()
                    }
                    setHlOpen(false)
                  }}
                  className="rounded py-1 text-xs text-center transition-colors hover:opacity-80 border"
                  style={{
                    background: h.color ?? '#f3f4f6',
                    borderColor: curHlColor === h.color ? INK : 'transparent',
                    color: '#374151',
                  }}
                  title={h.label}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* ── A: Alignment drop-up ── */}
      <button ref={alignBtnRef} type="button" aria-haspopup="dialog" aria-expanded={alignOpen}
        onClick={e => { e.stopPropagation(); setAlignOpen(o => !o); setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setHlOpen(false); setListOpen(false); setParaOpen(false); setPageOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors font-serif ${alignOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Alignment">
        A
      </button>

      {alignOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setAlignOpen(false)} />
          <div role="dialog" aria-label="Alignment" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(alignBtnRef), ...popupStyle(118) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {(['left', 'center', 'right', 'justify'] as const).map(a => (
              <button key={a} type="button" onClick={() => setAlign(a)}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 capitalize"
                style={{ color: a === curAlign ? INK : '#374151',
                  fontWeight: a === curAlign ? 500 : 400,
                  borderLeft: a === curAlign ? `2px solid ${INK}` : '2px solid transparent' }}>
                {a}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* ── L: Lists drop-up ── */}
      <button ref={listBtnRef} type="button" aria-haspopup="dialog" aria-expanded={listOpen}
        onClick={e => { e.stopPropagation(); setListOpen(o => !o); setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setHlOpen(false); setAlignOpen(false); setParaOpen(false); setPageOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors font-serif ${listActive || listOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Lists">
        L
      </button>

      {listOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setListOpen(false)} />
          <div role="dialog" aria-label="Lists" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(listBtnRef), ...popupStyle(136) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {[
              { label: 'Bullets',   icon: <BulletListIcon />, type: 'bulletList',   cmd: () => editor.chain().focus().toggleBulletList().run() },
              { label: 'Numbered',  icon: <OrderedListIcon />, type: 'orderedList',  cmd: () => editor.chain().focus().toggleOrderedList().run() },
            ].map(item => {
              const active = editor.isActive(item.type)
              return (
                <button key={item.type} type="button"
                  onClick={() => { ping(); item.cmd(); setListOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                  style={{ color: active ? INK : '#374151',
                    fontWeight: active ? 500 : 400,
                    borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}

      {/* ── ¶: Paragraph panel (line spacing) — translucent ── */}
      <button ref={paraBtnRef} type="button" aria-haspopup="dialog" aria-expanded={paraOpen}
        onClick={e => { e.stopPropagation(); setParaOpen(o => !o); setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setHlOpen(false); setAlignOpen(false); setListOpen(false); setPageOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors italic ${paraOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Paragraph spacing">
        ¶
      </button>

      {paraOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setParaOpen(false)} />
          <div role="dialog" aria-label="Paragraph spacing" className="z-[99] shadow-xl py-1"
            style={{
              ...popupAbove(paraBtnRef),
              width: 76,
              border: `1px solid ${INK}44`,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.88)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {LINE_HEIGHTS.map(lh => (
              <button key={lh.label} type="button" onClick={() => pickLineHeight(lh.value)}
                className="w-full text-center px-2 py-1 text-sm transition-colors hover:bg-white/60 italic"
                style={{ color: lh.value === curLH ? INK : '#6b7280',
                  fontWeight: lh.value === curLH ? 600 : 400 }}>
                {lh.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* ── P: Page panel (indent first line) ── */}
      <button ref={pageBtnRef} type="button" aria-haspopup="dialog" aria-expanded={pageOpen}
        onClick={e => { e.stopPropagation(); setPageOpen(o => !o); setFontOpen(false); setSizeOpen(false); setBoldOpen(false); setHlOpen(false); setAlignOpen(false); setListOpen(false); setParaOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors font-serif ${indented || pageOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Page settings">
        P
      </button>

      {pageOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setPageOpen(false)} />
          <div role="dialog" aria-label="Page settings" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(pageBtnRef), ...popupStyle(148) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            <button type="button"
              onClick={() => {
                ping()
                editor.chain().setParaStyle({
                  textIndent: indented ? null : '1.5em',
                } as Partial<ParagraphStyleAttrs>).run()
                setPageOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
              style={{ color: indented ? INK : '#374151',
                fontWeight: indented ? 500 : 400,
                borderLeft: indented ? `2px solid ${INK}` : '2px solid transparent' }}>
              Indent first line
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* All — phone only */}
      {phone && (
        <button type="button"
          onClick={() => { ping(); editor.chain().focus().selectAll().run() }}
          className="rounded border px-2 py-0.5 text-xs transition-colors border-stone-300 text-stone-500 hover:border-stone-400 whitespace-nowrap"
          title="Select all">
          All
        </button>
      )}

    </div>
  )
}
