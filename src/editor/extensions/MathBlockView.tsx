import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, insertAtCursor, applyShorthands } from './mathUtils'

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
  const [localLatex, setLocalLatex] = useState(latex)
  const [editing, setEditing] = useState(latex === '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (selected && !latex) setEditing(true)
  }, [selected, latex])

  const rendered = useMemo(() => renderLatex(localLatex, align), [localLatex, align])

  const commit = () => {
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setEditing(false)
    editor.commands.focus()
  }

  return (
    <NodeViewWrapper>
      <div
        style={{
          margin: '1em 0',
          padding: '0.75em 1em',
          border: `1px solid ${selected ? 'rgba(155,92,204,0.4)' : 'rgba(155,92,204,0.15)'}`,
          borderRadius: '4px',
          background: 'rgba(155,92,204,0.03)',
          position: 'relative',
        }}
      >
        {/* Alignment toggle buttons */}
        <div
          style={{
            position: 'absolute',
            top: '0.4rem',
            right: '0.5rem',
            display: 'flex',
            gap: '2px',
            opacity: selected || editing ? 1 : 0,
            transition: 'opacity 0.15s',
            pointerEvents: selected || editing ? 'auto' : 'none',
          }}
        >
          {ALIGN_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              title={opt.title}
              onMouseDown={e => {
                e.preventDefault()
                updateAttributes({ align: opt.value })
              }}
              style={{
                fontSize: '0.7rem',
                padding: '1px 5px',
                border: `1px solid ${align === opt.value ? '#9b5ccc' : 'rgba(155,92,204,0.3)'}`,
                borderRadius: '3px',
                background: align === opt.value ? 'rgba(155,92,204,0.12)' : 'transparent',
                color: align === opt.value ? '#5c2d8a' : '#9ca3af',
                cursor: 'pointer',
                fontFamily: 'ui-monospace, monospace',
                lineHeight: '1.4',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Rendered equation */}
        {!editing && (
          <div
            onClick={() => setEditing(true)}
            style={{
              cursor: 'text',
              textAlign: align === 'left' ? 'left' : 'center',
              minHeight: '2em',
            }}
            dangerouslySetInnerHTML={{
              __html: rendered || '<em style="opacity:0.35;font-size:0.9em">Click to enter equation…</em>',
            }}
          />
        )}

        {/* LaTeX textarea */}
        {editing && (
          <>
            <textarea
              ref={textareaRef}
              value={localLatex}
              onChange={e => setLocalLatex(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                // CapsLock → Greek
                const greek = handleMathKey(e)
                if (greek) {
                  e.preventDefault()
                  const el = textareaRef.current!
                  const { value, cursor } = insertAtCursor(el, greek)
                  setLocalLatex(value)
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = cursor
                  })
                  return
                }
                if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                  e.preventDefault()
                  commit()
                  return
                }
                e.stopPropagation()
              }}
              placeholder={
                align === 'aligned'
                  ? 'x &= 1 \\\\\ny &= 2'
                  : 'LaTeX…'
              }
              rows={3}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85em',
                padding: '6px 8px',
                border: '1px solid #9b5ccc',
                borderRadius: '3px',
                outline: 'none',
                background: 'rgba(155,92,204,0.04)',
                color: '#1a1a1a',
                resize: 'vertical',
              }}
            />
            {localLatex && (
              <div
                style={{ marginTop: '0.5em', opacity: 0.7, textAlign: align === 'left' ? 'left' : 'center' }}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
