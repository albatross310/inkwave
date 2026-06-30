// StyleBar — formatting controls above the main toolbar.
//
// All buttons use the container's onMouseDown preventDefault to keep the editor's
// selection alive while clicking. Long-press (≥350ms) opens the option popup;
// short tap applies the last-used option.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { LINE_HEIGHTS, getLineHeight, setLineHeight } from '../editor/lineHeight'
import type { ParagraphStyleAttrs } from '../editor/extensions/ParagraphStyle'

const INK = '#5c2d8a'
const BASE_SIZE = 18       // editor root px (matches .ProseMirror { font-size: 1.125rem })
const PT_TO_PX = 96 / 72  // 1pt = 1.3333px at 96 DPI
const HOLD_MS = 350        // ms before a press becomes a long-press

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
  { label: 'Yellow',   color: '#fef08a' },
  { label: 'Green',    color: '#bbf7d0' },
  { label: 'Teal',     color: '#99f6e4' },
  { label: 'Blue',     color: '#bae6fd' },
  { label: 'Purple',   color: '#e9d5ff' },
  { label: 'Pink',     color: '#fbcfe8' },
  { label: 'Red',      color: '#fca5a5' },
  { label: 'Orange',   color: '#fed7aa' },
  { label: 'Peach',    color: '#fde68a' },
  { label: 'Lavender', color: '#c7d2fe' },
  { label: 'Sage',     color: '#d1fae5' },
  { label: 'Clear',    color: null },
]

type CharFmt = 'bold' | 'italic' | 'underline' | 'strike'
type ListType = 'bulletList' | 'decimal' | 'lower-roman' | 'lower-alpha'
type Align = 'left' | 'center' | 'right' | 'justify'

const CHAR_FMT_LABELS: Record<CharFmt, string> = {
  bold: 'B', italic: 'i', underline: 'U', strike: 'S',
}
const CHAR_FMT_STYLES: Record<CharFmt, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through' },
}
const CHAR_FMT_NAMES: Record<CharFmt, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough',
}

const LIST_TYPE_LABELS: Record<ListType, string> = {
  bulletList: '•', decimal: '1.', 'lower-roman': 'i.', 'lower-alpha': 'a.',
}

// Hook: distinguishes short tap (click) from long press (hold ≥ HOLD_MS).
function useLongPress(
  onShortPress: () => void,
  onLongPress: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)
  return {
    onPointerDown: () => {
      firedRef.current = false
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        onLongPress()
      }, HOLD_MS)
    },
    onClick: () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (!firedRef.current) onShortPress()
    },
  }
}

export function StyleBar({ editor, onActivity, onLineHeightChange, phone }: {
  editor: Editor
  onActivity?: () => void
  onLineHeightChange?: (v: number) => void
  phone?: boolean
}) {
  const [, force] = useState(0)
  const [fontOpen, setFontOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [fmtOpen,  setFmtOpen]  = useState(false)
  const [hlOpen,   setHlOpen]   = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [listOpen,  setListOpen]  = useState(false)
  const [pageOpen,  setPageOpen]  = useState(false)

  // Last-used state for single-tap behaviour
  const [lastFmt,      setLastFmt]      = useState<CharFmt>('bold')
  const [lastHlColor,  setLastHlColor]  = useState<string | null>('#fef08a')
  const [lastListType, setLastListType] = useState<ListType>('bulletList')

  const fontBtnRef  = useRef<HTMLButtonElement>(null)
  const sizeBtnRef  = useRef<HTMLDivElement>(null)
  const fmtBtnRef   = useRef<HTMLButtonElement>(null)
  const hlBtnRef    = useRef<HTMLButtonElement>(null)
  const alignBtnRef = useRef<HTMLButtonElement>(null)
  const listBtnRef  = useRef<HTMLButtonElement>(null)
  const pageBtnRef  = useRef<HTMLButtonElement>(null)

  const ping = () => onActivity?.()

  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  const closeAll = () => {
    setFontOpen(false); setSizeOpen(false); setFmtOpen(false); setHlOpen(false)
    setAlignOpen(false); setListOpen(false); setPageOpen(false)
  }

  useEffect(() => {
    const anyOpen = fontOpen || sizeOpen || fmtOpen || hlOpen || alignOpen || listOpen || pageOpen
    if (!anyOpen) return
    const onDown = () => closeAll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [fontOpen, sizeOpen, fmtOpen, hlOpen, alignOpen, listOpen, pageOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ──────────────────────────────────────────────────────────
  const ts       = editor.getAttributes('textStyle')
  const paraAttrs = editor.getAttributes('paragraph')
  const curFont  = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const rawSize  = ts.fontSize ?? ''
  const curSizePx = rawSize.endsWith('em')
    ? parseFloat(rawSize) * BASE_SIZE
    : parseInt(rawSize, 10) || BASE_SIZE
  const curSize  = Math.round(curSizePx / PT_TO_PX)
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(
    a => editor.isActive({ textAlign: a }),
  ) ?? 'left'
  const curLH    = parseFloat(paraAttrs.lineHeight ?? '') || getLineHeight()
  const indented = !!(paraAttrs.textIndent as string | null)
  const curHlColor = (editor.getAttributes('highlight') as { color?: string }).color ?? null
  const listActive = editor.isActive('bulletList') || editor.isActive('orderedList')

  // ── Formatters ─────────────────────────────────────────────────────────────
  const setFont  = (css: string) => { ping(); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize  = (pt: number) => {
    ping()
    const em = +((pt * PT_TO_PX) / BASE_SIZE).toFixed(4)
    editor.chain().setMark('textStyle', { fontSize: `${em}em` }).run()
    setSizeOpen(false)
  }
  const setAlign = (a: Align) => { ping(); editor.chain().setTextAlign(a).run(); setAlignOpen(false) }

  const pickLineHeight = (v: number) => {
    setLineHeight(v); onLineHeightChange?.(v)
    editor.chain().setLineHeight(v.toString()).run()
    setPageOpen(false); ping()
  }

  function applyFmt(fmt: CharFmt) {
    ping(); setLastFmt(fmt)
    switch (fmt) {
      case 'bold':      editor.chain().toggleBold().run(); break
      case 'italic':    editor.chain().toggleItalic().run(); break
      case 'underline': editor.chain().toggleUnderline().run(); break
      case 'strike':    editor.chain().toggleStrike().run(); break
    }
  }

  function applyHighlight(color: string | null) {
    ping()
    if (color) { setLastHlColor(color); editor.chain().setHighlight({ color }).run() }
    else editor.chain().unsetHighlight().run()
    setHlOpen(false)
  }

  function applyListType(type: ListType) {
    ping(); setLastListType(type); setListOpen(false)
    if (type === 'bulletList') {
      editor.chain().focus().toggleBulletList().run()
      return
    }
    // Ordered list with sub-type
    const inOrdered  = editor.isActive('orderedList')
    const curType    = (editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal'
    if (inOrdered && curType === type) {
      editor.chain().focus().toggleOrderedList().run()
    } else if (inOrdered) {
      editor.chain().focus().updateAttributes('orderedList', { listType: type }).run()
    } else {
      editor.chain().focus().toggleOrderedList().run()
      if (type !== 'decimal') editor.chain().focus().updateAttributes('orderedList', { listType: type }).run()
    }
  }

  // ── Long-press handlers ────────────────────────────────────────────────────
  const fmtPress = useLongPress(
    () => { applyFmt(lastFmt) },
    () => { setFmtOpen(true) },
  )
  const hlPress = useLongPress(
    () => { applyHighlight(lastHlColor) },
    () => { setHlOpen(true) },
  )
  const listPress = useLongPress(
    () => { applyListType(lastListType) },
    () => { setListOpen(true) },
  )

  // ── Popup positioning ──────────────────────────────────────────────────────
  function popupAbove(ref: React.RefObject<HTMLElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }
  const ps = (width: number): React.CSSProperties =>
    ({ border: `1px solid ${INK}55`, borderRadius: 12, width })

  // Current B icon — reflects last used format
  const fmtIcon = CHAR_FMT_LABELS[lastFmt]
  const fmtStyle = CHAR_FMT_STYLES[lastFmt]

  return (
    // onMouseDown with check prevents all buttons from stealing editor focus/selection.
    // The size container's inner click is stopped at source.
    <div
      className="flex items-center gap-1.5 text-sm text-stone-500 font-serif w-full"
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}
      onMouseEnter={() => onActivity?.()}
    >

      {/* ── Font ── */}
      <button ref={fontBtnRef} type="button" aria-haspopup="dialog" aria-expanded={fontOpen}
        onClick={e => { e.stopPropagation(); closeAll(); setFontOpen(o => !o) }}
        className="rounded border border-stone-300 px-1.5 py-0.5 text-stone-500 hover:border-stone-400 transition-colors min-w-[4.8rem] text-left whitespace-nowrap text-xs">
        {curFont}
      </button>

      {fontOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setFontOpen(false)} />
          <div role="dialog" aria-label="Choose font" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(fontBtnRef), ...ps(136) }}
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

      {/* ── Size — display only, click to open picker ── */}
      <div ref={sizeBtnRef}
        className="flex items-center justify-center rounded border border-stone-300 hover:border-stone-400 transition-colors cursor-pointer px-1.5 py-0.5"
        style={{ minWidth: 36 }}
        onClick={e => { e.stopPropagation(); closeAll(); setSizeOpen(o => !o) }}>
        <span className="text-xs text-stone-500 select-none">{curSize}</span>
      </div>

      {sizeOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setSizeOpen(false)} />
          <div role="dialog" aria-label="Font size" className="z-[99] bg-white shadow-xl py-1.5 overflow-y-auto"
            style={{ ...popupAbove(sizeBtnRef), ...ps(64), maxHeight: 280 }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {FONT_SIZES.map(sz => (
              <button key={sz} type="button" onClick={() => setSize(sz)}
                className="w-full text-center px-2 py-1 text-sm transition-colors hover:bg-stone-50"
                style={{ color: sz === curSize ? INK : '#374151',
                  fontWeight: sz === curSize ? 600 : 400,
                  background: sz === curSize ? `${INK}12` : undefined }}>
                {sz}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* ── B/I/U/S — tap=last format, hold=picker ── */}
      <button ref={fmtBtnRef} type="button"
        {...fmtPress}
        aria-haspopup="dialog" aria-expanded={fmtOpen}
        onClick={e => { e.stopPropagation(); fmtPress.onClick() }}
        className={`rounded border px-1.5 py-0.5 transition-colors ${fmtOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        style={{ ...fmtStyle, minWidth: 26, textAlign: 'center', fontSize: '0.82rem' }}
        title="Character formatting (hold for options)">
        {fmtIcon}
      </button>

      {fmtOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setFmtOpen(false)} />
          <div role="dialog" aria-label="Character formatting" className="z-[99] bg-white shadow-xl py-1"
            style={{ ...popupAbove(fmtBtnRef), ...ps(140) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {(['bold', 'italic', 'underline', 'strike'] as CharFmt[]).map(fmt => {
              const active = editor.isActive(fmt)
              return (
                <button key={fmt} type="button"
                  onClick={() => { applyFmt(fmt); setFmtOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                  style={{ ...CHAR_FMT_STYLES[fmt], color: active ? INK : '#374151',
                    borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                  {CHAR_FMT_NAMES[fmt]}
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}

      {/* ── H — tap=last colour, hold=picker ── */}
      <button ref={hlBtnRef} type="button"
        {...hlPress}
        aria-haspopup="dialog" aria-expanded={hlOpen}
        onClick={e => { e.stopPropagation(); hlPress.onClick() }}
        className={`rounded border px-1.5 py-0.5 transition-colors ${hlOpen ? 'border-[#5c2d8a]' : curHlColor ? 'border-stone-400' : 'border-stone-300 hover:border-stone-400'}`}
        style={{ minWidth: 26, textAlign: 'center', fontSize: '0.82rem',
          background: curHlColor ?? undefined,
          color: hlOpen ? INK : curHlColor ? '#374151' : '#6b7280' }}
        title="Highlight (hold for colours)">
        H
      </button>

      {hlOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setHlOpen(false)} />
          <div role="dialog" aria-label="Highlight colour" className="z-[99] bg-white shadow-xl p-2"
            style={{ ...popupAbove(hlBtnRef), ...ps(156) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            <div className="grid grid-cols-3 gap-1.5">
              {HIGHLIGHT_COLORS.map(h => (
                <button key={h.label} type="button"
                  onClick={() => applyHighlight(h.color)}
                  className="rounded py-1 text-[0.68rem] text-center transition-opacity hover:opacity-80 border"
                  style={{
                    background: h.color ?? '#f3f4f6',
                    borderColor: curHlColor === h.color ? INK : (h.color ? 'transparent' : '#d1d5db'),
                    color: '#374151',
                  }}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* ── A — Alignment ── */}
      <button ref={alignBtnRef} type="button" aria-haspopup="dialog" aria-expanded={alignOpen}
        onClick={e => { e.stopPropagation(); closeAll(); setAlignOpen(o => !o) }}
        className={`rounded border px-1.5 py-0.5 transition-colors font-serif ${alignOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        style={{ minWidth: 26, textAlign: 'center', fontSize: '0.82rem' }}
        title="Alignment">
        A
      </button>

      {alignOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setAlignOpen(false)} />
          <div role="dialog" aria-label="Alignment" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(alignBtnRef), ...ps(110) }}
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

      {/* ── L — tap=last list, hold=picker (•/1./i./a.) ── */}
      <button ref={listBtnRef} type="button"
        {...listPress}
        aria-haspopup="dialog" aria-expanded={listOpen}
        onClick={e => { e.stopPropagation(); listPress.onClick() }}
        className={`rounded border px-1.5 py-0.5 transition-colors ${listActive || listOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        style={{ minWidth: 26, textAlign: 'center', fontSize: '0.82rem' }}
        title="Lists (hold for types)">
        {LIST_TYPE_LABELS[lastListType]}
      </button>

      {listOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setListOpen(false)} />
          <div role="dialog" aria-label="List type" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(listBtnRef), ...ps(148) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            {([
              { type: 'bulletList'   as ListType, label: 'Bullets',   preview: '•' },
              { type: 'decimal'      as ListType, label: 'Numbered',  preview: '1.' },
              { type: 'lower-roman'  as ListType, label: 'Roman',     preview: 'i.' },
              { type: 'lower-alpha'  as ListType, label: 'Alphabet',  preview: 'a.' },
            ]).map(item => {
              const active = item.type === 'bulletList'
                ? editor.isActive('bulletList')
                : editor.isActive('orderedList') &&
                  ((editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal') === item.type
              return (
                <button key={item.type} type="button"
                  onClick={() => applyListType(item.type)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                  style={{ color: active ? INK : '#374151',
                    fontWeight: active ? 500 : 400,
                    borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                  <span className="w-5 text-center tabular-nums" style={{ color: INK, opacity: 0.8 }}>{item.preview}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}

      {/* ── P — Page panel: indent + line height ── */}
      <button ref={pageBtnRef} type="button" aria-haspopup="dialog" aria-expanded={pageOpen}
        onClick={e => { e.stopPropagation(); closeAll(); setPageOpen(o => !o) }}
        className={`rounded border px-1.5 py-0.5 transition-colors font-serif ${indented || pageOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        style={{ minWidth: 26, textAlign: 'center', fontSize: '0.82rem' }}
        title="Page settings">
        P
      </button>

      {pageOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setPageOpen(false)} />
          <div role="dialog" aria-label="Page settings" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(pageBtnRef), ...ps(156) }}
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}>
            <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-stone-400">Indent</div>
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
              First line indent
            </button>
            <div className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-stone-400">Line spacing</div>
            {LINE_HEIGHTS.map(lh => (
              <button key={lh.label} type="button" onClick={() => pickLineHeight(lh.value)}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 italic"
                style={{ color: lh.value === curLH ? INK : '#374151',
                  fontWeight: lh.value === curLH ? 500 : 400,
                  borderLeft: lh.value === curLH ? `2px solid ${INK}` : '2px solid transparent' }}>
                {lh.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* All — phone only */}
      {phone && (
        <button type="button"
          onClick={() => { ping(); editor.chain().focus().selectAll().run() }}
          className="rounded border px-1.5 py-0.5 text-xs transition-colors border-stone-300 text-stone-500 hover:border-stone-400 whitespace-nowrap"
          title="Select all">
          All
        </button>
      )}

    </div>
  )
}
