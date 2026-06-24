// StyleBar — a flat row of formatting controls that sits flush above the main toolbar.
// Everything acts on the current selection (commands run without .focus() so the editor's
// focus/selection is preserved); "all" applies the selection's style to the whole document.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { LINE_HEIGHTS, getLineHeight, setLineHeight } from '../editor/lineHeight'

const INK = '#5c2d8a'
const BASE_SIZE = 18

const FONTS = [
  { label: 'Fell',       css: "'IM Fell DW Pica', 'EB Garamond', Georgia, serif" },
  { label: 'Garamond',   css: "'EB Garamond', Georgia, serif" },
  { label: 'Times',      css: "'Times New Roman', Times, serif" },
  { label: 'Cambria',    css: "Cambria, Georgia, serif" },
  { label: 'Georgia',    css: "Georgia, serif" },
  { label: 'Palatino',   css: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: 'Baskerville',css: "'Baskerville Old Face', Baskerville, 'Book Antiqua', serif" },
  { label: 'Sans',       css: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
]

type Align = 'left' | 'center' | 'justify'

function AlignIcon({ a }: { a: Align }) {
  const lines: Record<Align, Array<[number, number]>> = {
    left:    [[2, 12], [2, 8], [2, 11]],
    center:  [[2, 12], [4, 10], [3, 11]],
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
  const [curLineHeight, setCurLineHeight] = useState(getLineHeight)
  const [fontOpen, setFontOpen] = useState(false)
  const [lhOpen, setLhOpen] = useState(false)
  const fontBtnRef = useRef<HTMLButtonElement>(null)
  const lhBtnRef = useRef<HTMLButtonElement>(null)
  const ping = () => onActivity?.()

  // Re-render when the selection/content changes so the controls reflect the cursor.
  useEffect(() => {
    const upd = () => force(n => n + 1)
    editor.on('selectionUpdate', upd)
    editor.on('transaction', upd)
    return () => { editor.off('selectionUpdate', upd); editor.off('transaction', upd) }
  }, [editor])

  useEffect(() => {
    if (!fontOpen && !lhOpen) return
    const onDown = () => { setFontOpen(false); setLhOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFontOpen(false); setLhOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [fontOpen, lhOpen])

  const ts = editor.getAttributes('textStyle')
  const curFont = FONTS.find(f => f.css === ts.fontFamily)?.label ?? 'Fell'
  const curSize = parseInt(ts.fontSize ?? '', 10) || BASE_SIZE
  const curAlign: Align = (['left', 'center', 'justify'] as const).find(a => editor.isActive({ textAlign: a })) ?? 'left'

  const setFont  = (css: string) => { ping(); editor.chain().setFontFamily(css).run(); setFontOpen(false) }
  const setSize  = (px: number) => { ping(); if (px >= 8 && px <= 120) editor.chain().setMark('textStyle', { fontSize: `${px}px` }).run() }
  const setAlign = (a: Align) => { ping(); editor.chain().setTextAlign(a).run() }
  const pickLineHeight = (v: number) => {
    setLineHeight(v)
    setCurLineHeight(v)
    onLineHeightChange?.(v)
  }

  // Apply the current selection's style (font / size / align) to the whole document.
  const applyToAll = () => {
    ping()
    const { from, to } = editor.state.selection
    const chain = editor.chain().selectAll()
    if (ts.fontFamily) chain.setFontFamily(ts.fontFamily)
    if (ts.fontSize)   chain.setMark('textStyle', { fontSize: ts.fontSize })
    chain.setTextAlign(curAlign).setTextSelection({ from, to }).run()
  }

  const segBtn = (active: boolean) =>
    `flex items-center justify-center rounded px-1.5 py-1 transition-colors ${active ? 'text-[#5c2d8a] bg-[#5c2d8a]/10' : 'text-stone-400 hover:text-[#5c2d8a]'}`

  // Popup positioning helper — fixed above the triggering button.
  function popupAbove(ref: React.RefObject<HTMLButtonElement | null>): React.CSSProperties {
    const br = ref.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    return {
      position: 'fixed',
      bottom: Math.round(window.innerHeight - br.top + 8),
      left: Math.max(8, Math.round(br.left)),
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm text-stone-500 font-serif w-full">
      {/* Font picker — opens a portal popup */}
      <button
        ref={fontBtnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={fontOpen}
        onClick={(e) => { e.stopPropagation(); setFontOpen(o => !o) }}
        className="rounded border border-stone-300 px-2 py-0.5 text-stone-500 hover:border-stone-400 transition-colors min-w-[5.5rem] text-left whitespace-nowrap"
      >
        {curFont} <span className="text-[0.6em] align-middle">▴</span>
      </button>

      {fontOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setFontOpen(false)} />
          <div
            role="dialog"
            aria-label="Choose font"
            className="z-[99] bg-white shadow-xl py-1.5"
            style={{
              ...popupAbove(fontBtnRef),
              border: `1px solid ${INK}55`,
              borderRadius: 12,
              width: 136,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {FONTS.map(f => (
              <button
                key={f.label}
                role="menuitem"
                type="button"
                onClick={() => setFont(f.css)}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 truncate"
                style={{
                  fontFamily: f.css,
                  color: f.label === curFont ? INK : '#374151',
                  fontWeight: f.label === curFont ? 500 : 400,
                  borderLeft: f.label === curFont ? `2px solid ${INK}` : '2px solid transparent',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* Size (numeric) */}
      <input
        type="number" min={8} max={120} value={curSize}
        onChange={e => setSize(parseInt(e.target.value, 10))}
        aria-label="Font size"
        className="w-14 rounded border border-stone-300 px-2 py-0.5 text-center text-stone-500 focus:outline-none focus:border-stone-400"
      />

      {/* Alignment */}
      <div className="flex items-center gap-0.5">
        {(['left', 'center', 'justify'] as const).map(a => (
          <button key={a} type="button" aria-label={`Align ${a}`} aria-pressed={curAlign === a}
            onClick={() => setAlign(a)} className={segBtn(curAlign === a)}>
            <AlignIcon a={a} />
          </button>
        ))}
      </div>

      {/* Line spacing — drop-up */}
      <button
        ref={lhBtnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={lhOpen}
        onClick={(e) => { e.stopPropagation(); setLhOpen(o => !o); setFontOpen(false) }}
        className={`rounded border px-2 py-0.5 text-xs transition-colors whitespace-nowrap ${lhOpen ? 'border-[#5c2d8a] text-[#5c2d8a]' : 'border-stone-300 text-stone-500 hover:border-stone-400'}`}
        style={{ fontStyle: 'italic' }}
        title="Line spacing"
      >
        {LINE_HEIGHTS.find(lh => lh.value === curLineHeight)?.label ?? '·'} <span className="not-italic text-[0.6em] align-middle">▴</span>
      </button>

      {lhOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" aria-hidden="true" onMouseDown={() => setLhOpen(false)} />
          <div
            role="dialog"
            aria-label="Line spacing"
            className="z-[99] bg-white shadow-xl py-1.5"
            style={{
              ...popupAbove(lhBtnRef),
              border: `1px solid ${INK}55`,
              borderRadius: 12,
              width: 110,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {LINE_HEIGHTS.map(lh => (
              <button
                key={lh.label}
                type="button"
                onClick={() => { pickLineHeight(lh.value); setLhOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-stone-50"
                style={{
                  fontStyle: 'italic',
                  color: lh.value === curLineHeight ? INK : '#374151',
                  fontWeight: lh.value === curLineHeight ? 500 : 400,
                  borderLeft: lh.value === curLineHeight ? `2px solid ${INK}` : '2px solid transparent',
                }}
              >
                {lh.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}

      {/* Apply to whole document */}
      <button type="button" onClick={applyToAll}
        className="ml-auto rounded border border-stone-300 px-2 py-0.5 text-xs uppercase tracking-wide text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a] transition-colors whitespace-nowrap">
        all
      </button>
    </div>
  )
}
