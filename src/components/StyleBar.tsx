// StyleBar — formatting controls above the main toolbar.
//
// All buttons use the container's onMouseDown preventDefault to keep the editor's
// selection alive. Long-press (≥175ms) opens the option popup; short tap applies
// the last-used option. Menu items trigger on pointer-up for immediacy.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'

const INK = '#5c2d8a'
const BASE_SIZE = 18       // editor root px (matches .ProseMirror { font-size: 1.125rem })
const PT_TO_PX = 96 / 72  // 1pt = 1.3333px at 96 DPI
const HOLD_MS = 175        // ms before a press becomes a long-press

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
  { label: 'Red',    color: '#fca5a5' },
  { label: 'Orange', color: '#fed7aa' },
  { label: 'Yellow', color: '#fef08a' },
  { label: 'Peach',  color: '#fde68a' },
  { label: 'Green',  color: '#bbf7d0' },
  { label: 'Sage',   color: '#d1fae5' },
  { label: 'Teal',   color: '#99f6e4' },
  { label: 'Blue',   color: '#bae6fd' },
  { label: 'Coral',  color: '#fda4af' },
  { label: 'Pink',   color: '#fbcfe8' },
  { label: 'Purple', color: '#e9d5ff' },
  { label: 'Clear',  color: null },
]

type CharFmt = 'bold' | 'italic' | 'underline' | 'strike'
type ListType = 'bulletList' | 'decimal' | 'lower-roman' | 'lower-alpha' | 'upper-roman' | 'taskList'
type Align = 'left' | 'center' | 'right' | 'justify'

const CHAR_FMT_LABELS: Record<CharFmt, string> = { bold: 'B', italic: 'i', underline: 'U', strike: 'S' }
const CHAR_FMT_STYLES: Record<CharFmt, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through' },
}
const CHAR_FMT_NAMES: Record<CharFmt, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough',
}
const ALIGN_LABELS: Record<Align, string> = {
  left: 'Left', center: 'Centre', right: 'Right', justify: 'Justify',
}
const LIST_TYPE_LABELS: Record<ListType, string> = {
  bulletList: '•', decimal: '1.', 'lower-roman': 'i.', 'lower-alpha': 'a.', 'upper-roman': 'I.', taskList: '☐',
}

function useLongPress(onShortPress: () => void, onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)
  return {
    onPointerDown: () => {
      firedRef.current = false
      timerRef.current = setTimeout(() => { firedRef.current = true; onLongPress() }, HOLD_MS)
    },
    onClick: () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (!firedRef.current) onShortPress()
    },
  }
}

export function StyleBar({ editor, onActivity, phone }: {
  editor: Editor
  onActivity?: () => void
  phone?: boolean
}) {
  const [, force] = useState(0)
  const [fontOpen,  setFontOpen]  = useState(false)
  const [sizeOpen,  setSizeOpen]  = useState(false)
  const [fmtOpen,   setFmtOpen]   = useState(false)
  const [hlOpen,    setHlOpen]    = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [listOpen,  setListOpen]  = useState(false)

  const [lastFmt,      setLastFmt]      = useState<CharFmt>('bold')
  const [lastHlColor,  setLastHlColor]  = useState<string | null>('#fef08a')
  const [lastListType, setLastListType] = useState<ListType>('bulletList')
  const [lastAlign,    setLastAlign]    = useState<Align>('left')
  const [lastFont,     setLastFont]     = useState<string>('')
  const [lastSize,     setLastSize]     = useState<number>(0)

  const fontBtnRef  = useRef<HTMLButtonElement>(null)
  const sizeBtnRef  = useRef<HTMLButtonElement>(null)
  const fmtBtnRef   = useRef<HTMLButtonElement>(null)
  const hlBtnRef    = useRef<HTMLButtonElement>(null)
  const alignBtnRef = useRef<HTMLButtonElement>(null)
  const listBtnRef  = useRef<HTMLButtonElement>(null)

  const ping = () => onActivity?.()

  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  const closeAll = () => { setFontOpen(false); setSizeOpen(false); setFmtOpen(false); setHlOpen(false); setAlignOpen(false); setListOpen(false) }

  useEffect(() => {
    if (!(fontOpen || sizeOpen || fmtOpen || hlOpen || alignOpen || listOpen)) return
    const onDown = () => closeAll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [fontOpen, sizeOpen, fmtOpen, hlOpen, alignOpen, listOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────
  const ts = editor.getAttributes('textStyle')
  const rawSize = ts.fontSize ?? ''
  const curSizePx = rawSize.endsWith('em') ? parseFloat(rawSize) * BASE_SIZE : parseInt(rawSize, 10) || BASE_SIZE
  const curSize = Math.round(curSizePx / PT_TO_PX)
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'
  const curHlColor = (editor.getAttributes('highlight') as { color?: string }).color ?? null
  const listActive = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')

  // ── Actions ───────────────────────────────────────────────────────────────
  const setFont = (css: string) => { ping(); setLastFont(css); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize = (pt: number) => {
    ping()
    setLastSize(pt)
    editor.chain().setMark('textStyle', { fontSize: `${+((pt * PT_TO_PX) / BASE_SIZE).toFixed(4)}em` }).run()
    setSizeOpen(false)
  }
  function applyFmt(fmt: CharFmt) {
    ping(); setLastFmt(fmt)
    const cmds: Record<CharFmt, () => boolean> = {
      bold: () => editor.chain().toggleBold().run(),
      italic: () => editor.chain().toggleItalic().run(),
      underline: () => editor.chain().toggleUnderline().run(),
      strike: () => editor.chain().toggleStrike().run(),
    }
    cmds[fmt]()
  }
  function applyHighlight(color: string | null) {
    ping()
    if (color) {
      setLastHlColor(color)
      editor.chain().setHighlight({ color }).run()
      // Clear highlight from stored marks so typing after highlighted text doesn't inherit it
      const { state, view } = editor
      const stored = state.storedMarks
      if (stored) {
        const filtered = stored.filter((m: { type: { name: string } }) => m.type.name !== 'highlight')
        if (filtered.length !== stored.length) {
          view.dispatch(state.tr.setStoredMarks(filtered))
        }
      }
    } else {
      editor.chain().unsetHighlight().run()
    }
    setHlOpen(false)
  }
  function applyAlign(a: Align) { ping(); setLastAlign(a); editor.chain().setTextAlign(a).run(); setAlignOpen(false) }
  function applyListType(type: ListType) {
    ping(); setLastListType(type); setListOpen(false)
    if (type === 'taskList') { editor.chain().focus().toggleTaskList().run(); return }
    if (type === 'bulletList') { editor.chain().focus().toggleBulletList().run(); return }
    const inOrdered = editor.isActive('orderedList')
    const cur = (editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal'
    if (inOrdered && cur === type) editor.chain().focus().toggleOrderedList().run()
    else if (inOrdered) editor.chain().focus().updateAttributes('orderedList', { listType: type }).run()
    else { editor.chain().focus().toggleOrderedList().run(); if (type !== 'decimal') editor.chain().focus().updateAttributes('orderedList', { listType: type }).run() }
  }

  const fontPress  = useLongPress(
    () => { if (lastFont) setFont(lastFont); else { closeAll(); setFontOpen(true) } },
    () => { closeAll(); setFontOpen(true) },
  )
  const sizePress  = useLongPress(
    () => { if (lastSize) setSize(lastSize); else { closeAll(); setSizeOpen(true) } },
    () => { closeAll(); setSizeOpen(true) },
  )
  const fmtPress   = useLongPress(() => applyFmt(lastFmt),          () => setFmtOpen(true))
  const hlPress    = useLongPress(() => applyHighlight(lastHlColor), () => setHlOpen(true))
  const listPress  = useLongPress(() => applyListType(lastListType), () => setListOpen(true))
  const alignPress = useLongPress(() => applyAlign(lastAlign),       () => setAlignOpen(true))

  function above(ref: React.RefObject<HTMLElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }
  const box = (w: number): React.CSSProperties => ({ border: `1px solid ${INK}55`, borderRadius: 12, width: w })

  // Desktop: circular badge buttons. Phone: rectangular flush buttons filling bar height.
  const pill = (open: boolean, hl = false): string => {
    if (phone) {
      return `flex-1 flex items-center justify-center self-stretch transition-colors text-sm ${open || hl ? `text-[${INK}] bg-stone-50` : 'text-stone-500'}`
    }
    // Desktop: circular badge — same visual as main toolbar buttons
    return `flex items-center justify-center w-8 h-8 rounded-full border transition-colors ${open || hl ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-200 text-stone-500 hover:border-stone-400'}`
  }

  const phoneFontSizeClass = `flex-1 flex items-center justify-center self-stretch text-xs text-stone-500 transition-colors`
  const deskFontClass = `flex items-center justify-center h-8 px-1.5 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors text-left whitespace-nowrap text-xs min-w-[2.5rem]`
  const deskSizeClass = `flex items-center justify-center h-8 px-2 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors cursor-pointer text-xs tabular-nums min-w-[2.5rem]`

  return (
    <div
      className={phone
        ? 'flex items-stretch text-sm text-stone-500 font-serif w-full divide-x divide-stone-100'
        : 'flex items-center gap-1.5 text-sm text-stone-500 font-serif w-full'
      }
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}
      onMouseEnter={() => onActivity?.()}
    >
      {/* Font — short-press applies last font, long-press opens picker */}
      <button ref={fontBtnRef} type="button" {...fontPress}
        onClick={e => { e.stopPropagation(); fontPress.onClick() }}
        className={phone ? phoneFontSizeClass : deskFontClass}
        title="Font (hold to change)">
        {curFont.slice(0, 3)}
      </button>
      {fontOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFontOpen(false)} />
        <div className="z-[99] bg-white shadow-xl py-1.5" style={{ ...above(fontBtnRef), ...box(136) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {FONTS.map(f => (
            <button key={f.label} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => setFont(f.css)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 truncate"
              style={{ fontFamily: f.css, color: f.label === curFont ? INK : '#374151',
                fontWeight: f.label === curFont ? 500 : 400,
                borderLeft: f.label === curFont ? `2px solid ${INK}` : '2px solid transparent' }}>
              {f.label}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* Size — short-press applies last size, long-press opens picker */}
      <button ref={sizeBtnRef} type="button" {...sizePress}
        onClick={e => { e.stopPropagation(); sizePress.onClick() }}
        className={phone ? phoneFontSizeClass : deskSizeClass}
        title="Font size (hold to change)">
        <span className="text-xs select-none">{curSize}</span>
      </button>
      {sizeOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setSizeOpen(false)} />
        <div className="z-[99] bg-white shadow-xl py-1.5 overflow-y-auto" style={{ ...above(sizeBtnRef), ...box(64), maxHeight: 280 }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {FONT_SIZES.map(sz => (
            <button key={sz} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => setSize(sz)}
              className="w-full text-center px-2 py-1 text-sm hover:bg-stone-50"
              style={{ color: sz === curSize ? INK : '#374151', fontWeight: sz === curSize ? 600 : 400, background: sz === curSize ? `${INK}12` : undefined }}>
              {sz}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* B — tap=last fmt, hold=picker */}
      <button ref={fmtBtnRef} type="button" {...fmtPress}
        onClick={e => { e.stopPropagation(); fmtPress.onClick() }}
        className={pill(fmtOpen)}
        style={{ ...CHAR_FMT_STYLES[lastFmt], minWidth: phone ? undefined : 30, textAlign: 'center', fontSize: '0.82rem' }}
        title="Character formatting (hold for options)">
        {CHAR_FMT_LABELS[lastFmt]}
      </button>
      {fmtOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFmtOpen(false)} />
        <div className="z-[99] bg-white shadow-xl py-1" style={{ ...above(fmtBtnRef), ...box(140) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {(['bold', 'italic', 'underline', 'strike'] as CharFmt[]).map(fmt => (
            <button key={fmt} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => { applyFmt(fmt); setFmtOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ ...CHAR_FMT_STYLES[fmt], color: editor.isActive(fmt) ? INK : '#374151',
                borderLeft: editor.isActive(fmt) ? `2px solid ${INK}` : '2px solid transparent' }}>
              {CHAR_FMT_NAMES[fmt]}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* H — tap=last colour, hold=picker */}
      <button ref={hlBtnRef} type="button" {...hlPress}
        onClick={e => { e.stopPropagation(); hlPress.onClick() }}
        className={pill(hlOpen, !!lastHlColor)}
        style={{ minWidth: phone ? undefined : 30, textAlign: 'center', fontSize: '0.82rem',
          background: lastHlColor ?? undefined, color: (hlOpen || lastHlColor) ? (hlOpen ? INK : '#374151') : '#6b7280' }}
        title="Highlight (hold for colours)">
        H
      </button>
      {hlOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setHlOpen(false)} />
        <div className="z-[99] bg-white shadow-xl p-2" style={{ ...above(hlBtnRef), ...box(156) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          <div className="grid grid-cols-3 gap-1.5">
            {HIGHLIGHT_COLORS.map(h => (
              <button key={h.label} type="button"
                onPointerDown={e => e.preventDefault()} onPointerUp={() => applyHighlight(h.color)}
                className="rounded py-1 text-[0.68rem] text-center hover:opacity-80 border"
                style={{ background: h.color ?? '#f3f4f6', borderColor: curHlColor === h.color ? INK : (h.color ? 'transparent' : '#d1d5db'), color: '#374151' }}>
                {h.label}
              </button>
            ))}
          </div>
        </div></>,
        document.body,
      )}

      {/* A — tap=last align, hold=picker */}
      <button ref={alignBtnRef} type="button" {...alignPress}
        onClick={e => { e.stopPropagation(); alignPress.onClick() }}
        className={pill(alignOpen) + ' font-serif'}
        style={{ minWidth: phone ? undefined : 30, textAlign: 'center', fontSize: '0.82rem' }}
        title="Alignment (hold for options)">
        A
      </button>
      {alignOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setAlignOpen(false)} />
        <div className="z-[99] bg-white shadow-xl py-1.5" style={{ ...above(alignBtnRef), ...box(110) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {(['left', 'center', 'right', 'justify'] as Align[]).map(a => (
            <button key={a} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyAlign(a)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: a === curAlign ? INK : '#374151', fontWeight: a === curAlign ? 500 : 400,
                borderLeft: a === curAlign ? `2px solid ${INK}` : '2px solid transparent' }}>
              {ALIGN_LABELS[a]}
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* L — tap=last list, hold=picker */}
      <button ref={listBtnRef} type="button" {...listPress}
        onClick={e => { e.stopPropagation(); listPress.onClick() }}
        className={pill(listOpen, listActive)}
        style={{ minWidth: phone ? undefined : 30, textAlign: 'center', fontSize: '0.82rem' }}
        title="Lists (hold for types)">
        {LIST_TYPE_LABELS[lastListType]}
      </button>
      {listOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setListOpen(false)} />
        <div className="z-[99] bg-white shadow-xl py-1.5" style={{ ...above(listBtnRef), ...box(148) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {([
            { type: 'bulletList'  as ListType, label: 'Bullets',  preview: '•' },
            { type: 'taskList'    as ListType, label: 'Checkboxes', preview: '☐' },
            { type: 'decimal'     as ListType, label: 'Numbered', preview: '1.' },
            { type: 'lower-roman' as ListType, label: 'Roman',    preview: 'i.' },
            { type: 'lower-alpha' as ListType, label: 'Alphabet',  preview: 'a.' },
            { type: 'upper-roman' as ListType, label: 'Roman caps', preview: 'I.' },
          ]).map(item => {
            const active = item.type === 'taskList'
              ? editor.isActive('taskList')
              : item.type === 'bulletList'
              ? editor.isActive('bulletList')
              : editor.isActive('orderedList') &&
                ((editor.getAttributes('orderedList') as { listType?: string }).listType ?? 'decimal') === item.type
            return (
              <button key={item.type} type="button"
                onPointerDown={e => e.preventDefault()} onPointerUp={() => applyListType(item.type)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
                style={{ color: active ? INK : '#374151', fontWeight: active ? 500 : 400,
                  borderLeft: active ? `2px solid ${INK}` : '2px solid transparent' }}>
                <span className="w-5 text-center tabular-nums" style={{ color: INK, opacity: 0.8 }}>{item.preview}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div></>,
        document.body,
      )}

      {/* ∀ — select all (always visible on both phone and desktop) */}
      <button type="button"
        onClick={() => { ping(); editor.chain().focus().selectAll().run() }}
        title="Select all"
        className={phone
          ? `flex-1 flex items-center justify-center self-stretch text-stone-500 text-base`
          : `flex items-center justify-center w-8 h-8 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors text-sm`
        }>
        ∀
      </button>
    </div>
  )
}
