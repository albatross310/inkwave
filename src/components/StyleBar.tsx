// StyleBar — formatting controls above the main toolbar.
//
// All buttons use the container's onMouseDown preventDefault to keep the editor's
// selection alive. Long-press (≥175ms) opens the option popup; short tap applies
// the last-used option (font + size are HOLD-ONLY — a plain click does nothing).
// Menu items trigger on pointer-up for immediacy.

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
  { label: 'Coral',  color: '#fda4af' },
  { label: 'Orange', color: '#fed7aa' },
  { label: 'Peach',  color: '#fde68a' },
  { label: 'Yellow', color: '#fef08a' },
  { label: 'Green',  color: '#bbf7d0' },
  { label: 'Sage',   color: '#d1fae5' },
  { label: 'Teal',   color: '#99f6e4' },
  { label: 'Blue',   color: '#bae6fd' },
  { label: 'Indigo', color: '#a5b4fc' },
  { label: 'Pink',   color: '#fbcfe8' },
  { label: 'Clear',  color: null },
]

// Text colours — a small tasteful set fitting the calm identity (deep, ink-like tones).
const TEXT_COLORS: Array<{ label: string; color: string | null }> = [
  { label: 'Default', color: null },
  { label: 'Ink',     color: '#5c2d8a' },
  { label: 'Black',   color: '#1a1a1a' },
  { label: 'Blue',    color: '#1e3a8a' },
  { label: 'Red',     color: '#991b1b' },
  { label: 'Green',   color: '#166534' },
  { label: 'Brown',   color: '#78350f' },
]

type CharFmt = 'bold' | 'italic' | 'underline' | 'strike'
type ListType = 'bulletList' | 'decimal' | 'lower-roman' | 'lower-alpha' | 'upper-roman' | 'taskList'
type Align = 'left' | 'center' | 'right' | 'justify'
type IndentAction = 'line+' | 'line-' | 'para+' | 'para-' | 'clear'

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
const INDENT_ITEMS: Array<{ action: IndentAction; label: string; preview: string }> = [
  { action: 'line+', label: 'Indent line',        preview: '⇥' },
  { action: 'line-', label: 'Unindent line',      preview: '⇤' },
  { action: 'para+', label: 'First-line indent',  preview: '¶⇥' },
  { action: 'para-', label: 'Remove first-line',  preview: '¶⇤' },
  { action: 'clear', label: 'Clear line format',  preview: '⌫' },
]

function useLongPress(onShortPress: () => void, onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)
  const clear = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }
  return {
    // stopPropagation prevents the outer toolbar div's onPointerDown from calling
    // e.preventDefault(), which on iOS suppresses the subsequent click event (causing
    // second-press deadlock when the editor is already focused).
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      firedRef.current = false
      timerRef.current = setTimeout(() => { firedRef.current = true; onLongPress() }, HOLD_MS)
    },
    // iOS can end a press WITHOUT a click (touch cancel, scroll, system long-press UI), which used
    // to leave the timer running → the drop-up popped open after the finger was gone. Clear on every
    // pointer end; short-press still lives in onClick (fires after pointerup on desktop AND touch,
    // gated by firedRef), so click behaviour is unchanged.
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick: () => {
      clear()
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
  const [fontOpen,   setFontOpen]   = useState(false)
  const [sizeOpen,   setSizeOpen]   = useState(false)
  const [fmtOpen,    setFmtOpen]    = useState(false)
  const [hlOpen,     setHlOpen]     = useState(false)
  const [colorOpen,  setColorOpen]  = useState(false)
  const [alignOpen,  setAlignOpen]  = useState(false)
  const [listOpen,   setListOpen]   = useState(false)
  const [indentOpen, setIndentOpen] = useState(false)

  const [lastFmt,      setLastFmt]      = useState<CharFmt>('bold')
  const [lastHlColor,  setLastHlColor]  = useState<string | null>(null)
  const [lastTxtColor, setLastTxtColor] = useState<string | null>(null)
  const [lastListType, setLastListType] = useState<ListType>('bulletList')
  const [lastAlign,    setLastAlign]    = useState<Align>('left')
  const [lastIndent,   setLastIndent]   = useState<IndentAction>('line+')

  const fontBtnRef   = useRef<HTMLButtonElement>(null)
  const sizeBtnRef   = useRef<HTMLButtonElement>(null)
  const fmtBtnRef    = useRef<HTMLButtonElement>(null)
  const hlBtnRef     = useRef<HTMLButtonElement>(null)
  const colorBtnRef  = useRef<HTMLButtonElement>(null)
  const alignBtnRef  = useRef<HTMLButtonElement>(null)
  const listBtnRef   = useRef<HTMLButtonElement>(null)
  const indentBtnRef = useRef<HTMLButtonElement>(null)

  const ping = () => onActivity?.()

  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  // Highlight should never extend to newly typed text — clear it from stored marks whenever
  // the cursor lands anywhere, so typing always starts without an ambient highlight.
  useEffect(() => {
    const clearHighlight = () => {
      const { state } = editor
      if (!state.selection.empty) return
      const marks = state.storedMarks ?? state.selection.$from.marks()
      if (!marks.some((m: { type: { name: string } }) => m.type.name === 'highlight')) return
      const filtered = marks.filter((m: { type: { name: string } }) => m.type.name !== 'highlight')
      editor.view.dispatch(state.tr.setStoredMarks(filtered))
    }
    editor.on('selectionUpdate', clearHighlight)
    return () => { editor.off('selectionUpdate', clearHighlight) }
  }, [editor])

  const closeAll = () => { setFontOpen(false); setSizeOpen(false); setFmtOpen(false); setHlOpen(false); setColorOpen(false); setAlignOpen(false); setListOpen(false); setIndentOpen(false) }
  const anyOpen = fontOpen || sizeOpen || fmtOpen || hlOpen || colorOpen || alignOpen || listOpen || indentOpen

  useEffect(() => {
    if (!anyOpen) return
    const onDown = () => closeAll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [anyOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────
  const ts = editor.getAttributes('textStyle')
  const rawSize = ts.fontSize ?? ''
  const curSizePx = rawSize.endsWith('em') ? parseFloat(rawSize) * BASE_SIZE : parseInt(rawSize, 10) || BASE_SIZE
  const curSize = Math.round(curSizePx / PT_TO_PX)
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'
  const curHlColor = (editor.getAttributes('highlight') as { color?: string }).color ?? null
  const curTxtColor = (ts as { color?: string }).color ?? null
  const listActive = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')

  // ── Actions ───────────────────────────────────────────────────────────────
  const setFont = (css: string) => { ping(); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize = (pt: number) => {
    ping()
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
      // Toggle semantics: highlighting text ALREADY in this exact colour unhighlights it
      // (a different colour still re-colours, below).
      if (editor.isActive('highlight', { color })) {
        editor.chain().unsetHighlight().run()
        setHlOpen(false)
        return
      }
      editor.chain().setHighlight({ color }).run()
      // After applying highlight to a selection, storedMarks is null (range selection has no
      // stored marks). But when the cursor later collapses to the right edge of highlighted text,
      // ProseMirror auto-inherits the highlight mark. Override this by setting storedMarks now
      // to the marks at the cursor position minus highlight, so typing never extends the highlight.
      const { view } = editor
      const st = view.state
      const marksAtPos = st.selection.$from.marks()
      const filtered = marksAtPos.filter((m: { type: { name: string } }) => m.type.name !== 'highlight')
      view.dispatch(st.tr.setStoredMarks(filtered))
    } else {
      editor.chain().unsetHighlight().run()
    }
    setHlOpen(false)
  }
  function applyTextColor(color: string | null) {
    ping()
    if (color) setLastTxtColor(color)
    editor.chain().setMark('textStyle', { color }).run()
    setColorOpen(false)
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
  // Indent: whole-line/block indent = paddingLeft (stepped, stackable); paragraph first-line
  // indent = textIndent (on/off). Values live on ParagraphStyle attrs. A non-em paddingLeft
  // (pasted px values) unindents straight to none. 'clear' keeps the old ⌫¶ escape hatch for
  // stuck pasted margins/line-height that the remove actions don't touch.
  const INDENT_STEP = 2 // em
  const emVal = (v: string | null | undefined): number | null => {
    const m = /^([\d.]+)em$/.exec(v ?? ''); return m ? parseFloat(m[1]) : null
  }
  function applyIndent(action: IndentAction) {
    ping()
    if (action !== 'clear') setLastIndent(action)
    const attrs = editor.getAttributes('paragraph') as { paddingLeft?: string | null; textIndent?: string | null }
    if (action === 'line+') {
      const cur = emVal(attrs.paddingLeft) ?? 0
      editor.chain().focus().setParaStyle({ paddingLeft: `${cur + INDENT_STEP}em` }).run()
    } else if (action === 'line-') {
      const cur = emVal(attrs.paddingLeft)
      const next = cur != null ? cur - INDENT_STEP : 0
      editor.chain().focus().setParaStyle({ paddingLeft: next > 0 ? `${next}em` : null }).run()
    } else if (action === 'para+') {
      editor.chain().focus().setParaStyle({ textIndent: `${INDENT_STEP}em` }).run()
    } else if (action === 'para-') {
      editor.chain().focus().setParaStyle({ textIndent: null }).run()
    } else {
      editor.chain().focus().setParaStyle({ lineHeight: null, marginBottom: null, marginTop: null, paddingLeft: null, paddingRight: null, textIndent: null }).run()
    }
    setIndentOpen(false)
  }

  // Font + size open ONLY on click-and-hold — a plain click does nothing (no apply, no cycle).
  const fontPress   = useLongPress(() => {}, () => { closeAll(); setFontOpen(true) })
  const sizePress   = useLongPress(() => {}, () => { closeAll(); setSizeOpen(true) })
  const fmtPress    = useLongPress(() => applyFmt(lastFmt),          () => { closeAll(); setFmtOpen(true) })
  const hlPress     = useLongPress(
    () => { if (lastHlColor !== null) applyHighlight(lastHlColor); else { closeAll(); setHlOpen(true) } },
    () => { closeAll(); setHlOpen(true) },
  )
  const colorPress  = useLongPress(
    () => { if (lastTxtColor !== null) applyTextColor(lastTxtColor); else { closeAll(); setColorOpen(true) } },
    () => { closeAll(); setColorOpen(true) },
  )
  const listPress   = useLongPress(() => applyListType(lastListType), () => { closeAll(); setListOpen(true) })
  const alignPress  = useLongPress(() => applyAlign(lastAlign),       () => { closeAll(); setAlignOpen(true) })
  const indentPress = useLongPress(() => applyIndent(lastIndent),     () => { closeAll(); setIndentOpen(true) })

  function above(ref: React.RefObject<HTMLElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }
  const box = (w: number): React.CSSProperties => ({ border: `1px solid ${INK}55`, borderRadius: 12, width: w })

  // Circular badge buttons everywhere. Phone: same circles as desktop, ~19% bigger (38px — the max
  // nine controls fit a 360px row with the tightened spacing) for comfortable tapping. flex-shrink-0
  // keeps them true circles — without it a tight row squeezes them oval.
  const circleSize = phone ? 'w-[38px] h-[38px] flex-shrink-0' : 'w-8 h-8'
  const pill = (open: boolean, hl = false): string =>
    `flex items-center justify-center ${circleSize} rounded-full border transition-colors ${open || hl ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-200 text-stone-500 hover:border-stone-400'}`

  const fontClass = `flex items-center justify-center ${phone ? 'h-[38px]' : 'h-8'} px-1.5 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors text-left whitespace-nowrap text-xs min-w-[2.5rem]`
  const sizeClass = `flex items-center justify-center ${phone ? 'h-[38px]' : 'h-8'} px-2 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 transition-colors cursor-pointer text-xs tabular-nums min-w-[2.5rem]`

  return (
    <div
      className={`flex items-center ${phone ? 'justify-between' : 'gap-1'} text-sm text-stone-500 font-serif w-full`}
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}
      onMouseEnter={() => onActivity?.()}
    >
      {/* Font — opens on click-and-hold only */}
      <button ref={fontBtnRef} type="button" {...fontPress}
        onClick={e => { e.stopPropagation(); fontPress.onClick() }}
        className={fontClass}
        title="Font (hold to change)">
        {curFont.slice(0, 3)}
      </button>
      {fontOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFontOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5" style={{ ...above(fontBtnRef), ...box(136) }}
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

      {/* Size — opens on click-and-hold only */}
      <button ref={sizeBtnRef} type="button" {...sizePress}
        onClick={e => { e.stopPropagation(); sizePress.onClick() }}
        className={sizeClass}
        title="Font size (hold to change)">
        <span className="text-xs select-none">{curSize}</span>
      </button>
      {sizeOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setSizeOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5 overflow-y-auto" style={{ ...above(sizeBtnRef), ...box(64), maxHeight: 280 }}
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
        style={{ ...CHAR_FMT_STYLES[lastFmt], textAlign: 'center', fontSize: '0.82rem' }}
        title="Character formatting (hold for options)">
        {CHAR_FMT_LABELS[lastFmt]}
      </button>
      {fmtOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setFmtOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1" style={{ ...above(fmtBtnRef), ...box(140) }}
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

      {/* H — tap=last colour (toggles off on same-colour text), hold=picker */}
      <button ref={hlBtnRef} type="button" {...hlPress}
        onClick={e => { e.stopPropagation(); hlPress.onClick() }}
        className={pill(hlOpen, !!lastHlColor)}
        style={{ textAlign: 'center', fontSize: '0.82rem',
          background: lastHlColor ?? undefined, color: (hlOpen || lastHlColor) ? (hlOpen ? INK : '#374151') : '#6b7280' }}
        title="Highlight (hold for colours; same colour again removes it)">
        H
      </button>
      {hlOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setHlOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl p-2" style={{ ...above(hlBtnRef), ...box(156) }}
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

      {/* T (text colour) — tap=last colour, hold=palette */}
      <button ref={colorBtnRef} type="button" {...colorPress}
        onClick={e => { e.stopPropagation(); colorPress.onClick() }}
        className={pill(colorOpen)}
        style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 600,
          color: lastTxtColor ?? 'var(--iw-ink, #5c2d8a)' }}
        title="Text colour (hold for palette)">
        T
      </button>
      {colorOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setColorOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5" style={{ ...above(colorBtnRef), ...box(136) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {TEXT_COLORS.map(c => (
            <button key={c.label} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyTextColor(c.color)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: curTxtColor === c.color ? INK : '#374151', fontWeight: curTxtColor === c.color ? 500 : 400,
                borderLeft: curTxtColor === c.color ? `2px solid ${INK}` : '2px solid transparent' }}>
              <span className="w-3.5 h-3.5 rounded-full border flex-shrink-0"
                style={{ background: c.color ?? 'transparent', borderColor: c.color ? 'transparent' : '#d1d5db' }} />
              <span>{c.label}</span>
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* A — tap=last align, hold=picker */}
      <button ref={alignBtnRef} type="button" {...alignPress}
        onClick={e => { e.stopPropagation(); alignPress.onClick() }}
        className={pill(alignOpen) + ' font-serif'}
        style={{ textAlign: 'center', fontSize: '0.82rem' }}
        title="Alignment (hold for options)">
        A
      </button>
      {alignOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setAlignOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5" style={{ ...above(alignBtnRef), ...box(110) }}
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
        style={{ textAlign: 'center', fontSize: '0.82rem' }}
        title="Lists (hold for types)">
        {LIST_TYPE_LABELS[lastListType]}
      </button>
      {listOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setListOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5" style={{ ...above(listBtnRef), ...box(148) }}
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

      {/* ⇥ (indent) — tap=last indent action, hold=picker. Replaces the old ⌫¶ button; its
          clear-line-formatting escape hatch lives on as the drop-up's last row. */}
      <button ref={indentBtnRef} type="button" {...indentPress}
        onClick={e => { e.stopPropagation(); indentPress.onClick() }}
        className={pill(indentOpen)}
        style={{ textAlign: 'center', fontSize: '0.82rem' }}
        title="Indent (hold for options)">
        ⇥
      </button>
      {indentOpen && createPortal(
        <><div className="fixed inset-0 z-[98]" onMouseDown={() => setIndentOpen(false)} />
        <div className="z-[99] iw-nightable bg-white shadow-xl py-1.5" style={{ ...above(indentBtnRef), ...box(168) }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}>
          {INDENT_ITEMS.map(item => (
            <button key={item.action} type="button"
              onPointerDown={e => e.preventDefault()} onPointerUp={() => applyIndent(item.action)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-50"
              style={{ color: '#374151', borderLeft: '2px solid transparent' }}>
              <span className="w-6 text-center" style={{ color: INK, opacity: 0.8 }}>{item.preview}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div></>,
        document.body,
      )}

      {/* ∀ — select all */}
      <button type="button"
        onClick={() => { ping(); editor.chain().focus().selectAll().run() }}
        title="Select all"
        className={pill(false) + ' text-sm'}>
        ∀
      </button>
    </div>
  )
}
