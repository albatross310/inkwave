import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import {
  handleMathKey, insertAtCursor, applyShorthands, applyShorthandsLive,
  capsDown, capsUp, tabDown, tabUp,
  initCapsTracking, resetCapsTracking, normalizeCapsLetter,
} from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'

const INK = '#5c2d8a'

type Align = 'aligned' | 'center' | 'left'

const ALIGN_OPTIONS: { value: Align; label: string; title: string; shortcut: string }[] = [
  { value: 'aligned', label: '=',  title: 'Align at equals',  shortcut: 'Ctrl+Q' },
  { value: 'center',  label: '⊙', title: 'Centre',           shortcut: 'Ctrl+E' },
  { value: 'left',    label: '◁',  title: 'Left align',       shortcut: 'Ctrl+L' },
]

function renderLatex(latex: string, align: Align, live = false): string {
  if (!latex.trim()) return ''
  try {
    const symbols  = getSymbols()
    const src      = applyCustomSymbols(live ? applyShorthandsLive(latex) : applyShorthands(latex), symbols)
    let wrapped    = src
    if (align === 'aligned' && !/\\begin\{/.test(src)) {
      wrapped = `\\begin{aligned}\n${src}\n\\end{aligned}`
    }
    return katex.renderToString(wrapped, {
      throwOnError: true,
      displayMode: true,
      output: 'htmlAndMathml',
    })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'
  const [popupOpen,    setPopupOpen]   = useState(latex === '')
  const [localLatex,   setLocalLatex]  = useState(latex)
  const [scOpen,       setScOpen]      = useState(false)
  const blockRef    = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  useEffect(() => { if (latex === '') setPopupOpen(true) }, []) // eslint-disable-line

  useEffect(() => {
    if (!popupOpen) return
    const id = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [popupOpen])

  // Always use live shorthands so x// shows as fraction at all times.
  const rendered = useMemo(() => renderLatex(localLatex, align, true), [localLatex, align])

  const commit = useCallback(() => {
    // "key = latex → save symbol definition instead of inserting math
    const def = parseDefinition(localLatex.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex('')
      setPopupOpen(false)
      setScOpen(false)
      resetCapsTracking()
      editor.commands.focus()
      return
    }
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setPopupOpen(false)
    setScOpen(false)
    resetCapsTracking()
    editor.commands.focus()
  }, [localLatex, updateAttributes, editor])

  const cancel = useCallback(() => {
    setLocalLatex(latex)
    setPopupOpen(false)
    setScOpen(false)
    resetCapsTracking()
    editor.commands.focus()
  }, [latex, editor])

  const handleCopy = (e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', localLatex)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current!
    initCapsTracking(e)

    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

    if (e.code === 'Tab') { e.preventDefault(); e.stopPropagation(); tabDown(); return }

    // Backtick: toggle small-caps.
    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      if (!scOpen) {
        const { value, cursor } = insertAtCursor(el, '\\text{\\textsc{')
        setLocalLatex(value)
        setScOpen(true)
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      } else {
        const { value, cursor } = insertAtCursor(el, '}}')
        setLocalLatex(value)
        setScOpen(false)
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      }
      return
    }

    const greek = handleMathKey(e)
    if (greek) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, greek)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
    }

    const normal = normalizeCapsLetter(e)
    if (normal !== null) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, normal)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
    }

    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      e.preventDefault(); commit(); return
    }
    if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
      if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); updateAttributes({ align: 'aligned' }); return }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); updateAttributes({ align: 'center' });  return }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); updateAttributes({ align: 'left' });    return }
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, '\\\\\n')
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
    }
    e.stopPropagation()
  }

  return (
    <NodeViewWrapper>
      {/* Always-visible rendered equation */}
      <div
        ref={blockRef}
        onClick={() => setPopupOpen(true)}
        onCopy={handleCopy}
        style={{
          margin: '1em 0',
          padding: '0.6em 1em',
          border: `1px solid ${popupOpen || selected ? `${INK}55` : 'rgba(155,92,204,0.12)'}`,
          borderRadius: '4px',
          background: 'rgba(155,92,204,0.02)',
          cursor: 'text',
          textAlign: align === 'left' ? 'left' : 'center',
          minHeight: '2.5em',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute', top: '0.3rem', right: '0.4rem',
            display: 'flex', gap: '2px',
            opacity: selected || popupOpen ? 1 : 0,
            transition: 'opacity 0.15s',
            pointerEvents: selected || popupOpen ? 'auto' : 'none',
          }}
        >
          {ALIGN_OPTIONS.map(opt => (
            <button
              key={opt.value} type="button"
              title={`${opt.title} (${opt.shortcut})`}
              onMouseDown={e => { e.preventDefault(); updateAttributes({ align: opt.value }) }}
              style={{
                fontSize: '0.68rem', padding: '1px 5px',
                border: `1px solid ${align === opt.value ? INK : 'rgba(155,92,204,0.25)'}`,
                borderRadius: '3px',
                background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent',
                color: align === opt.value ? INK : '#b0a0b8',
                cursor: 'pointer', fontFamily: 'ui-monospace, monospace', lineHeight: '1.4',
              }}
            >{opt.label}</button>
          ))}
        </div>

        <div dangerouslySetInnerHTML={{
          __html: rendered || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
        }} />
      </div>

      {/* Modal popup */}
      {popupOpen && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onMouseDown={e => { if (e.target === e.currentTarget) commit() }}
        >
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              background: 'white',
              border: `1px solid ${INK}44`,
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
              padding: '16px 18px 14px',
              minWidth: '320px',
              maxWidth: '560px',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
                block math{scOpen ? <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.7rem' }}>sc…</span> : null}
              </span>
              <button type="button" onClick={cancel} aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>

            {rendered && (
              <div
                style={{ marginBottom: '8px', padding: '8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: align === 'left' ? 'left' : 'center' }}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            )}

            <textarea
              ref={textareaRef}
              value={localLatex}
              rows={3}
              onChange={e => setLocalLatex(e.target.value)}
              onFocus={() => resetCapsTracking()}
              onKeyDown={onKeyDown}
              onKeyUp={e => {
                if (e.code === 'CapsLock') capsUp()
                if (e.code === 'Tab') tabUp()
              }}
              placeholder={align === 'aligned' ? 'x &= 1\ny &= 2' : 'LaTeX…'}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85em',
                border: `1px solid ${INK}33`,
                borderRadius: '4px',
                padding: '6px 8px',
                outline: 'none',
                resize: 'vertical',
                color: '#1a1a1a',
                background: 'transparent',
              }}
            />

            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {ALIGN_OPTIONS.map(opt => (
                  <button
                    key={opt.value} type="button"
                    title={`${opt.title} (${opt.shortcut})`}
                    onClick={() => updateAttributes({ align: opt.value })}
                    style={{
                      fontSize: '0.72rem', padding: '3px 8px',
                      border: `1px solid ${align === opt.value ? INK : 'rgba(155,92,204,0.25)'}`,
                      borderRadius: '4px',
                      background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent',
                      color: align === opt.value ? INK : '#b0a0b8',
                      cursor: 'pointer',
                    }}
                  >{opt.label}</button>
                ))}
              </div>
              <button type="button" onClick={commit}
                style={{ background: INK, color: 'white', border: 'none', borderRadius: '5px', padding: '5px 14px', fontSize: '0.8rem', cursor: 'pointer' }}>
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
