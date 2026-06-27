import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import {
  handleMathKey, insertAtCursor, applyShorthands, applyShorthandsLive,
  capsDown, capsUp,
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

function renderLatex(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const symbols = getSymbols()
    const src     = applyCustomSymbols(applyShorthandsLive(latex), symbols)
    const wrapped = align === 'aligned' && !/\\begin\{/.test(src)
      ? `\\begin{aligned}\n${src}\n\\end{aligned}`
      : src
    return katex.renderToString(wrapped, { throwOnError: true, displayMode: true, output: 'htmlAndMathml' })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'
  const [popupOpen,  setPopupOpen]  = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [scOpen,     setScOpen]     = useState(false)
  const [textOpen,   setTextOpen]   = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)

  const blockRef    = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef     = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  useEffect(() => { if (latex === '') openPopup() }, []) // eslint-disable-line

  const openPopup = useCallback(() => {
    const rect = blockRef.current?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 280
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= POPOVER_H + 16
        ? rect.bottom + 24
        : rect.top - POPOVER_H - 16
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 580 - 8))
      setPopoverPos({ top, left })
    }
    setPopupOpen(true)
  }, [])

  useEffect(() => {
    if (!popupOpen) return
    const id = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [popupOpen])

  const onDragHeaderDown = useCallback((e: React.MouseEvent) => {
    if (!popoverPos) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: popoverPos.left, origY: popoverPos.top }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPopoverPos({
        left: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        top:  dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [popoverPos])

  const rendered = useMemo(() => renderLatex(localLatex, align), [localLatex, align])

  const commit = useCallback(() => {
    const def = parseDefinition(localLatex.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex(''); setPopupOpen(false); setScOpen(false); setTextOpen(false)
      resetCapsTracking(); editor.commands.focus(); return
    }
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [localLatex, updateAttributes, editor])

  const cancel = useCallback(() => {
    setLocalLatex(latex); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
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

    if (e.code === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      const { value, cursor } = textOpen
        ? insertAtCursor(el, '}')
        : insertAtCursor(el, '\\text{')
      setLocalLatex(value); setTextOpen(!textOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
    }

    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      const { value, cursor } = scOpen
        ? insertAtCursor(el, '}}')
        : insertAtCursor(el, '\\text{\\textsc{')
      setLocalLatex(value); setScOpen(!scOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
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

  const isDefMode = localLatex.startsWith('"')
  const defParsed = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel = isDefMode ? 'define' : textOpen ? 'text' : scOpen ? 'sc' : null

  return (
    <NodeViewWrapper>
      {/* Always-visible rendered block */}
      <div
        ref={blockRef}
        onClick={openPopup}
        onCopy={handleCopy}
        style={{
          margin: '1em 0', padding: '0.6em 1em',
          border: `1px solid ${popupOpen || selected ? `${INK}55` : 'rgba(155,92,204,0.12)'}`,
          borderRadius: '4px', background: 'rgba(155,92,204,0.02)',
          cursor: 'text', textAlign: align === 'left' ? 'left' : 'center',
          minHeight: '2.5em', position: 'relative',
        }}
      >
        {/* Alignment buttons (appear on hover/select) */}
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
            <button key={opt.value} type="button" title={`${opt.title} (${opt.shortcut})`}
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

      {/* Floating draggable popover */}
      {popupOpen && popoverPos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left,
            zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            padding: '0 0 12px',
            minWidth: '340px', maxWidth: '580px', width: 'max-content',
          }}
        >
          {/* Drag handle / header */}
          <div
            onMouseDown={onDragHeaderDown}
            style={{
              cursor: 'grab', userSelect: 'none',
              padding: '9px 14px 7px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: `1px solid ${INK}18`,
            }}
          >
            <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
              block math
              {modeLabel && (
                <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.7rem' }}>
                  {modeLabel}{modeLabel !== 'define' ? '…' : ''}
                </span>
              )}
            </span>
            <button type="button" onClick={cancel} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>

          <div style={{ padding: '10px 16px 0' }}>
            {/* Definition mode hint */}
            {isDefMode && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX, then Escape</span>}
              </div>
            )}

            {/* Rendered preview */}
            {!isDefMode && rendered && (
              <div
                style={{ marginBottom: '8px', padding: '8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: align === 'left' ? 'left' : 'center' }}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            )}

            {/* LaTeX textarea — bigger font */}
            <textarea
              ref={textareaRef}
              value={localLatex}
              rows={3}
              onChange={e => setLocalLatex(e.target.value)}
              onFocus={() => resetCapsTracking()}
              onKeyDown={onKeyDown}
              onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
              placeholder={isDefMode ? '"name = \\command' : align === 'aligned' ? 'x &= 1\ny &= 2' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace',
                fontSize: '1.05rem',
                border: `1px solid ${INK}33`, borderRadius: '4px',
                padding: '7px 10px', outline: 'none', resize: 'vertical',
                color: '#1a1a1a', background: 'transparent', boxSizing: 'border-box',
              }}
            />

            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {ALIGN_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" title={`${opt.title} (${opt.shortcut})`}
                    onClick={() => updateAttributes({ align: opt.value })}
                    style={{
                      fontSize: '0.72rem', padding: '3px 8px',
                      border: `1px solid ${align === opt.value ? INK : 'rgba(155,92,204,0.25)'}`,
                      borderRadius: '4px',
                      background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent',
                      color: align === opt.value ? INK : '#b0a0b8', cursor: 'pointer',
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
