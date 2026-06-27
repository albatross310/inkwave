import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, insertAtCursor, applyShorthands, capsDown, capsUp } from './mathUtils'

type Align = 'aligned' | 'center' | 'left'

const ALIGN_OPTIONS: { value: Align; label: string; title: string }[] = [
  { value: 'aligned', label: '=',  title: 'Align at equals (use & before =)' },
  { value: 'center',  label: '⊙', title: 'Centre' },
  { value: 'left',    label: '◁',  title: 'Left align' },
]

function renderLatex(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    let src = latex
    if (align === 'aligned' && !/\\begin\{/.test(latex)) {
      src = `\\begin{aligned}\n${latex}\n\\end{aligned}`
    }
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: true,
      output: 'htmlAndMathml',
    })
  } catch {
    return ''
  }
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align = node.attrs.align ?? 'aligned'
  const [popupOpen, setPopupOpen] = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const blockRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])

  useEffect(() => {
    if (latex === '' && !popupOpen) setPopupOpen(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (popupOpen && blockRef.current) {
      setAnchorRect(blockRef.current.getBoundingClientRect())
    }
  }, [popupOpen])

  useEffect(() => {
    if (!popupOpen) return
    const id = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [popupOpen])

  const rendered = useMemo(() => renderLatex(localLatex, align), [localLatex, align])

  const commit = () => {
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setPopupOpen(false)
    editor.commands.focus()
  }

  const openPopup = () => {
    setAnchorRect(blockRef.current?.getBoundingClientRect() ?? null)
    setPopupOpen(true)
  }

  // Position popup below the block, left-aligned with it.
  const popupTop  = anchorRect ? anchorRect.bottom + 6 : 0
  const popupLeft = anchorRect ? anchorRect.left       : 0
  const popupW    = anchorRect ? Math.max(anchorRect.width, 280) : 280

  return (
    <NodeViewWrapper>
      {/* Always-rendered block equation */}
      <div
        ref={blockRef}
        onClick={openPopup}
        style={{
          margin: '1em 0',
          padding: '0.6em 1em',
          border: `1px solid ${popupOpen || selected ? 'rgba(155,92,204,0.35)' : 'rgba(155,92,204,0.12)'}`,
          borderRadius: '4px',
          background: 'rgba(155,92,204,0.02)',
          cursor: 'text',
          textAlign: align === 'left' ? 'left' : 'center',
          minHeight: '2.5em',
          position: 'relative',
        }}
      >
        {/* Alignment buttons — visible when selected or popup open */}
        <div
          style={{
            position: 'absolute',
            top: '0.3rem',
            right: '0.4rem',
            display: 'flex',
            gap: '2px',
            opacity: selected || popupOpen ? 1 : 0,
            transition: 'opacity 0.15s',
            pointerEvents: selected || popupOpen ? 'auto' : 'none',
          }}
        >
          {ALIGN_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              title={opt.title}
              onMouseDown={e => { e.preventDefault(); updateAttributes({ align: opt.value }) }}
              style={{
                fontSize: '0.68rem',
                padding: '1px 5px',
                border: `1px solid ${align === opt.value ? '#9b5ccc' : 'rgba(155,92,204,0.25)'}`,
                borderRadius: '3px',
                background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent',
                color: align === opt.value ? '#5c2d8a' : '#b0a0b8',
                cursor: 'pointer',
                fontFamily: 'ui-monospace, monospace',
                lineHeight: '1.4',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div
          dangerouslySetInnerHTML={{
            __html: rendered || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
          }}
        />
      </div>

      {/* Floating LaTeX editor popup */}
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
              left: popupLeft,
              top: popupTop,
              width: popupW,
              zIndex: 200,
              background: 'white',
              border: '1px solid rgba(155,92,204,0.35)',
              borderRadius: '6px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              padding: '8px 10px',
            }}
          >
            <textarea
              ref={textareaRef}
              value={localLatex}
              rows={3}
              onChange={e => setLocalLatex(e.target.value)}
              onKeyDown={e => {
                if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }
                const greek = handleMathKey(e)
                if (greek) {
                  e.preventDefault()
                  const el = textareaRef.current!
                  const { value, cursor } = insertAtCursor(el, greek)
                  setLocalLatex(value)
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
                  return
                }
                if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                  e.preventDefault(); commit(); return
                }
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault()
                  const el = textareaRef.current!
                  const { value, cursor } = insertAtCursor(el, '\\\\\n')
                  setLocalLatex(value)
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
                  return
                }
                e.stopPropagation()
              }}
              onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
              placeholder={align === 'aligned' ? 'x &= 1\ny &= 2' : 'LaTeX…'}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85em',
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                color: '#1a1a1a',
                background: 'transparent',
              }}
            />
            {localLatex && (
              <div
                style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(155,92,204,0.15)',
                  textAlign: align === 'left' ? 'left' : 'center',
                  opacity: 0.75,
                }}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            )}
            <div style={{ marginTop: '4px', fontSize: '0.68rem', color: '#b0a0b8', textAlign: 'right' }}>
              Ctrl+Enter or click outside to confirm
            </div>
          </div>
        </>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
