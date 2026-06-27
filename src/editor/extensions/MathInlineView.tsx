import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, insertAtCursor, applyShorthands } from './mathUtils'

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const [localLatex, setLocalLatex] = useState(latex)
  const [editing, setEditing] = useState(latex === '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (selected && !latex) setEditing(true)
  }, [selected, latex])

  const rendered = useMemo(() => {
    if (!localLatex.trim()) return ''
    try {
      return katex.renderToString(localLatex, {
        throwOnError: false,
        displayMode: false,
        output: 'htmlAndMathml',
      })
    } catch {
      return ''
    }
  }, [localLatex])

  const commit = () => {
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setEditing(false)
    editor.commands.focus()
  }

  if (editing) {
    return (
      <NodeViewWrapper as="span" style={{ display: 'inline' }}>
        <input
          ref={inputRef}
          value={localLatex}
          onChange={e => setLocalLatex(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            // CapsLock → Greek letter substitution
            const greek = handleMathKey(e)
            if (greek) {
              e.preventDefault()
              const el = inputRef.current!
              const { value, cursor } = insertAtCursor(el, greek)
              setLocalLatex(value)
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = cursor
              })
              return
            }
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              commit()
              return
            }
            e.stopPropagation()
          }}
          placeholder="LaTeX…"
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.85em',
            padding: '1px 6px',
            border: '1px solid #9b5ccc',
            borderRadius: '3px',
            minWidth: '80px',
            outline: 'none',
            background: 'rgba(155,92,204,0.06)',
            color: '#1a1a1a',
          }}
        />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="span"
      style={{ display: 'inline', cursor: 'text' }}
      onClick={() => setEditing(true)}
    >
      <span
        style={{
          padding: '0 2px',
          borderRadius: '2px',
          background: selected ? 'rgba(155,92,204,0.12)' : 'transparent',
          transition: 'background 0.1s',
        }}
        dangerouslySetInnerHTML={{
          __html: rendered || '<em style="opacity:0.35;font-size:0.85em">math</em>',
        }}
      />
    </NodeViewWrapper>
  )
}
