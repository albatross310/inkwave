import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, insertAtCursor, applyShorthands, capsDown, capsUp, capsToggleCase } from './mathUtils'

function renderKatex(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(applyShorthands(src), {
      throwOnError: false,
      displayMode: false,
      output: 'htmlAndMathml',
    })
  } catch { return '' }
}

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const [popupOpen, setPopupOpen] = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const spanRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])

  useEffect(() => {
    if (latex === '' && !popupOpen) setPopupOpen(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (popupOpen && spanRef.current) setAnchorRect(spanRef.current.getBoundingClientRect())
  }, [popupOpen])

  useEffect(() => {
    if (!popupOpen) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [popupOpen])

  // Apply shorthands live for rendering only — textarea keeps raw source.
  const rendered = useMemo(() => renderKatex(localLatex), [localLatex])

  const commit = () => {
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setPopupOpen(false)
    editor.commands.focus()
  }

  const popupY = anchorRect ? anchorRect.bottom + 6 : 0
  const popupX = anchorRect ? anchorRect.left       : 0

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      {/* Always-rendered equation in the editor — click to open popup */}
      <span
        ref={spanRef}
        onClick={() => {
          setAnchorRect(spanRef.current?.getBoundingClientRect() ?? null)
          setPopupOpen(true)
        }}
        style={{
          display: 'inline',
          cursor: 'text',
          padding: '0 2px',
          borderRadius: '2px',
          background: selected ? 'rgba(155,92,204,0.10)' : 'transparent',
          outline: popupOpen ? '1px solid rgba(155,92,204,0.35)' : 'none',
          transition: 'background 0.1s',
        }}
      >
        <span dangerouslySetInnerHTML={{
          __html: rendered || '<em style="opacity:0.4;font-size:0.85em">math</em>',
        }} />
        {popupOpen && <span className="math-cursor" aria-hidden="true" />}
      </span>

      {/* Floating LaTeX source popup */}
      {popupOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 190 }}
            onMouseDown={commit}
          />
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: popupX,
              top: popupY,
              zIndex: 200,
              background: 'white',
              border: '1px solid rgba(155,92,204,0.35)',
              borderRadius: '6px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
              padding: '6px 8px',
              minWidth: '180px',
            }}
          >
            <input
              ref={inputRef}
              value={localLatex}
              onChange={e => setLocalLatex(e.target.value)}
              onKeyDown={e => {
                if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }
                if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); capsToggleCase(); return }
                const greek = handleMathKey(e)
                if (greek) {
                  e.preventDefault()
                  const el = inputRef.current!
                  const { value, cursor } = insertAtCursor(el, greek)
                  setLocalLatex(value)
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
                  return
                }
                if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(); return }
                e.stopPropagation()
              }}
              onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
              placeholder="LaTeX…"
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85em',
                border: 'none',
                outline: 'none',
                width: '100%',
                color: '#1a1a1a',
                background: 'transparent',
              }}
            />
          </div>
        </>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
