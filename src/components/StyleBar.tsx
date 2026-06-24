// StyleBar — formatting controls above the main toolbar.
// Acts on the current selection; "all" applies to the whole document.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { LINE_HEIGHTS, getLineHeight, setLineHeight } from '../editor/lineHeight'
import type { ParagraphStyleAttrs } from '../editor/extensions/ParagraphStyle'

const INK = '#5c2d8a'
const BASE_SIZE = 18

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

const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72]

type Align = 'left' | 'center' | 'right' | 'justify'

function IndentFirstLineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="3.5" x2="12" y2="3.5" />
      <line x1="2" y1="7" x2="12" y2="7" />
      <line x1="2" y1="10.5" x2="10" y2="10.5" />
    </svg>
  )
}

function AlignIcon({ a }: { a: Align }) {
  const lines: Record<Align, Array<[number, number]>> = {
    left:    [[2, 12], [2, 8], [2, 11]],
    center:  [[2, 12], [4, 10], [3, 11]],
    right:   [[2, 12], [6, 12], [4, 12]],
    justify: [[2, 12], [2, 12], [2, 12]],
  }
  const ys = [3.5, 7, 10.5]
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      {lines[a].map(([x1, x2], i) => <line key={i} x1={x1} y1={ys[i]} x2={x2} y2={ys[i]} />)}
    </svg>
  )
}

export function StyleBar({ editor, onActivity, onLineHeightChange }: {
  editor: Editor
  onActivity?: () => void
  onLineHeightChange?: (v: number) => void
}) {
  const [, force] = useState(0)
  const [fontOpen, setFontOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [lhOpen, setLhOpen] = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const fontBtnRef  = useRef<HTMLButtonElement>(null)
  const sizeBtnRef  = useRef<HTMLButtonElement>(null)
  const lhBtnRef    = useRef<HTMLButtonElement>(null)
  const alignBtnRef = useRef<HTMLButtonElement>(null)
  // Manual size input: local string so user can type freely; committed on Enter / blur
  const [sizeStr, setSizeStr] = useState('')
  const [sizeFocused, setSizeFocused] = useState(false)
  const ping = () => onActivity?.()

  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  useEffect(() => {
    if (!fontOpen && !sizeOpen && !lhOpen && !alignOpen) return
    const onDown = () => { setFontOpen(false); setSizeOpen(false); setLhOpen(false); setAlignOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDown() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [fontOpen, sizeOpen, lhOpen, alignOpen])

  const ts = editor.getAttributes('textStyle')
  const paraAttrs = editor.getAttributes('paragraph')
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const curSize = parseInt(ts.fontSize ?? '', 10) || BASE_SIZE
  const curAlign: Align = (['left', 'center', 'right', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'
  // Line height: read from paragraph attribute (set per selection) or global default
  const curLH = parseFloat(paraAttrs.lineHeight ?? '') || getLineHeight()
  const curLHLabel = LINE_HEIGHTS.find(lh => lh.value === curLH)?.label ?? curLH.toString()

  const setFont  = (css: string) => { ping(); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize  = (px: number) => { ping(); editor.chain().setMark('textStyle', { fontSize: `${px}px` }).run(); setSizeOpen(false) }
  const setAlign = (a: Align)   => { ping(); editor.chain().setTextAlign(a).run(); setAlignOpen(false) }

  const pickLineHeight = (v: number) => {
    setLineHeight(v)             // persist global default
    onLineHeightChange?.(v)      // update CSS var fallback
    editor.chain().setLineHeight(v.toString()).run()  // apply to selected paragraphs
    setLhOpen(false)
    ping()
  }

  function popupAbove(ref: React.RefObject<HTMLButtonElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), left: Math.max(8, Math.round(br.left)) }
  }

  return (
    <div className="flex items-center gap-2 text-sm text-stone-500 font-serif w-full">

      {/* Font drop-up */}
      <button ref={fontBtnRef} type="button" aria-haspopup="dialog" aria-expanded={fontOpen}
        onClick={e => { e.stopPropagation(); setFontOpen(o => !o); setSizeOpen(false); setLhOpen(false) }}
        className="rounded border border-stone-300 px-2 py-0.5 text-stone-500 hover:border-stone-400 transition-colors min-w-[5.5rem] text-left whitespace-nowrap">
        {curFont} <span className="text-[0.6em] align-middle">▴</span>
      </button>

      {fontOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setFontOpen(false)} />
          <div role="dialog" aria-label="Choose font" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(fontBtnRef), border: `1px solid ${INK}55`, borderRadius: 12, width: 136 }}
            onMouseDown={e => e.stopPropagation()}>
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

      {/* Font size: direct input + drop-up */}
      <div className="flex items-center rounded border border-stone-300 hover:border-stone-400 transition-colors"
        style={{ minWidth: 60 }}>
        <input
          type="text" inputMode="numeric"
          value={sizeFocused ? sizeStr : String(curSize)}
          onFocus={() => { setSizeStr(String(curSize)); setSizeFocused(true) }}
          onBlur={() => { setSizeFocused(false); const v = parseInt(sizeStr, 10); if (v >= 4 && v <= 200) setSize(v) }}
          onChange={e => setSizeStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = parseInt(sizeStr, 10); if (v >= 4 && v <= 200) { setSize(v); (e.target as HTMLInputElement).blur() } } }}
          onClick={e => e.stopPropagation()}
          className="w-9 text-center text-sm py-0.5 bg-transparent outline-none text-stone-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button ref={sizeBtnRef} type="button" aria-haspopup="dialog" aria-expanded={sizeOpen}
          onClick={e => { e.stopPropagation(); setSizeOpen(o => !o); setFontOpen(false); setLhOpen(false) }}
          className="pr-1.5 text-stone-400 hover:text-stone-600 text-[0.6em] leading-none">
          ▴
        </button>
      </div>

      {sizeOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setSizeOpen(false)} />
          <div role="dialog" aria-label="Font size" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(sizeBtnRef), border: `1px solid ${INK}55`, borderRadius: 12, width: 96 }}
            onMouseDown={e => e.stopPropagation()}>
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

      {/* Alignment drop-up */}
      <button ref={alignBtnRef} type="button" aria-haspopup="dialog" aria-expanded={alignOpen}
        onClick={e => { e.stopPropagation(); setAlignOpen(o => !o); setFontOpen(false); setSizeOpen(false); setLhOpen(false) }}
        className={`rounded border px-2 py-0.5 transition-colors font-serif flex items-center gap-1 ${alignOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Alignment">
        a<span className="text-[0.6em] align-middle">▴</span>
      </button>

      {alignOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setAlignOpen(false)} />
          <div role="dialog" aria-label="Alignment" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(alignBtnRef), border: `1px solid ${INK}55`, borderRadius: 12, width: 124 }}
            onMouseDown={e => e.stopPropagation()}>
            {(['left', 'center', 'right', 'justify'] as const).map(a => (
              <button key={a} type="button" onClick={() => setAlign(a)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                style={{ color: a === curAlign ? INK : '#374151',
                  fontWeight: a === curAlign ? 500 : 400,
                  borderLeft: a === curAlign ? `2px solid ${INK}` : '2px solid transparent' }}>
                <AlignIcon a={a} />
                <span className="capitalize">{a}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* First-line indent toggle */}
      {(() => {
        const indented = !!(paraAttrs.textIndent as string | null)
        return (
          <button type="button" aria-pressed={indented}
            onClick={() => {
              ping()
              editor.chain().setParaStyle({
                textIndent: indented ? null : '1.5em',
              } as Partial<ParagraphStyleAttrs>).run()
            }}
            className={`rounded border px-2 py-0.5 transition-colors ${indented ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
            title="Indent first line">
            <IndentFirstLineIcon />
          </button>
        )
      })()}

      {/* Line spacing drop-up */}
      <button ref={lhBtnRef} type="button" aria-haspopup="dialog" aria-expanded={lhOpen}
        onClick={e => { e.stopPropagation(); setLhOpen(o => !o); setFontOpen(false); setSizeOpen(false) }}
        className={`rounded border px-2 py-0.5 text-xs transition-colors whitespace-nowrap italic ${lhOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        title="Line spacing">
        {curLHLabel} <span className="not-italic text-[0.6em] align-middle">▴</span>
      </button>

      {lhOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setLhOpen(false)} />
          <div role="dialog" aria-label="Line spacing" className="z-[99] bg-white shadow-xl py-1.5"
            style={{ ...popupAbove(lhBtnRef), border: `1px solid ${INK}55`, borderRadius: 12, width: 90 }}
            onMouseDown={e => e.stopPropagation()}>
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

    </div>
  )
}
