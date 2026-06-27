import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import {
  handleMathKey, insertAtCursor, applyShorthands, applyShorthandsLive,
  capsDown, capsUp, initCapsTracking, resetCapsTracking, normalizeCapsLetter,
} from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'

const INK = '#5c2d8a'

type Align = 'aligned' | 'center' | 'left'

const ALIGN_OPTIONS: { value: Align; label: string; title: string; shortcut: string }[] = [
  { value: 'aligned', label: '=',  title: 'Align at equals', shortcut: 'Ctrl+Q' },
  { value: 'center',  label: '⊙', title: 'Centre',          shortcut: 'Ctrl+E' },
  { value: 'left',    label: '◁',  title: 'Left align',      shortcut: 'Ctrl+L' },
]

function renderLatex(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const src     = applyCustomSymbols(applyShorthandsLive(latex), getSymbols())
    const wrapped = align === 'aligned' && !/\\begin\{/.test(src)
      ? `\\begin{aligned}\n${src}\n\\end{aligned}` : src
    return katex.renderToString(wrapped, { throwOnError: true, displayMode: true, output: 'htmlAndMathml' })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'

  // editing = textarea visible inside the block
  // popupOpen = floating popup (via tiny ⋯ button)
  const [editing,    setEditing]    = useState(latex === '')
  const [popupOpen,  setPopupOpen]  = useState(false)
  const [localLatex, setLocalLatex] = useState(latex)
  const [scOpen,     setScOpen]     = useState(false)
  const [textOpen,   setTextOpen]   = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)

  const blockRef    = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef     = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  useEffect(() => { if (latex === '') setEditing(true) }, []) // eslint-disable-line

  useEffect(() => {
    if (!editing) return
    const id = requestAnimationFrame(() => { textareaRef.current?.focus() })
    return () => cancelAnimationFrame(id)
  }, [editing])

  const commit = useCallback(() => {
    const def = parseDefinition(localLatex.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex(''); setEditing(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
      resetCapsTracking(); editor.commands.focus(); return
    }
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setEditing(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [localLatex, updateAttributes, editor])

  const cancel = useCallback(() => {
    setLocalLatex(latex); setEditing(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [latex, editor])

  const openPopup = useCallback(() => {
    const rect = blockRef.current?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 300
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 580 - 8))
      setPopoverPos({ top, left })
    }
    setPopupOpen(true)
  }, [])

  const onDragHeaderDown = useCallback((e: React.MouseEvent) => {
    if (!popoverPos) return; e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: popoverPos.left, origY: popoverPos.top }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPopoverPos({ left: dragRef.current.origX + (ev.clientX - dragRef.current.startX), top: dragRef.current.origY + (ev.clientY - dragRef.current.startY) })
    }
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [popoverPos])

  const rendered = useMemo(() => renderLatex(localLatex, align), [localLatex, align])

  const handleCopy = (e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) { e.preventDefault(); e.clipboardData.setData('text/plain', localLatex) }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current!
    initCapsTracking(e)
    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

    if (e.code === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      const { value, cursor } = textOpen ? insertAtCursor(el, '}') : insertAtCursor(el, '\\text{')
      setLocalLatex(value); setTextOpen(!textOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor }); return
    }
    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      const { value, cursor } = scOpen ? insertAtCursor(el, '}}') : insertAtCursor(el, '\\text{\\textsc{')
      setLocalLatex(value); setScOpen(!scOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor }); return
    }
    const greek = handleMathKey(e)
    if (greek) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, greek); setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor }); return
    }
    const norm = normalizeCapsLetter(e)
    if (norm !== null) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, norm); setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor }); return
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
      const { value, cursor } = insertAtCursor(el, '\\\\\n'); setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor }); return
    }
    e.stopPropagation()
  }

  const isDefMode = localLatex.startsWith('"')
  const defParsed = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel = isDefMode ? 'define' : textOpen ? 'text' : scOpen ? 'sc' : null

  return (
    <NodeViewWrapper>
      {/* Block — always visible; editing happens directly inside it */}
      <div
        ref={blockRef}
        onCopy={handleCopy}
        style={{
          margin: '1em 0', padding: '0.6em 1em',
          border: `1px solid ${editing || selected ? `${INK}55` : 'rgba(155,92,204,0.18)'}`,
          borderRadius: '6px', background: 'rgba(155,92,204,0.03)',
          position: 'relative', minHeight: '2.5em',
        }}
      >
        {/* Top-right controls: alignment + ⋯ popup button */}
        <div style={{
          position: 'absolute', top: '0.35rem', right: '0.4rem',
          display: 'flex', gap: '3px', alignItems: 'center',
          opacity: editing || selected ? 1 : 0,
          transition: 'opacity 0.15s',
          pointerEvents: editing || selected ? 'auto' : 'none',
        }}>
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
              }}>{opt.label}</button>
          ))}
          <button type="button" title="Open LaTeX editor"
            onMouseDown={e => e.preventDefault()}
            onClick={openPopup}
            style={{
              fontSize: '0.7rem', padding: '1px 4px',
              border: `1px solid rgba(155,92,204,0.25)`, borderRadius: '3px',
              background: 'transparent', color: `${INK}88`,
              cursor: 'pointer', fontFamily: 'ui-monospace, monospace', lineHeight: '1.4',
            }}>⋯</button>
        </div>

        {/* Rendered equation — click to open edit textarea */}
        <div
          onClick={() => setEditing(true)}
          style={{
            cursor: 'text',
            textAlign: align === 'left' ? 'left' : 'center',
          }}
          dangerouslySetInnerHTML={{
            __html: rendered || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
          }}
        />

        {/* Inline textarea — appears directly in the block when editing */}
        {editing && (
          <div style={{ marginTop: '10px', borderTop: `1px solid ${INK}18`, paddingTop: '8px' }}>
            {isDefMode && (
              <div style={{ marginBottom: '6px', padding: '4px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX, then Escape</span>}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={localLatex}
              rows={Math.max(2, localLatex.split('\n').length)}
              onChange={e => setLocalLatex(e.target.value)}
              onFocus={() => resetCapsTracking()}
              onKeyDown={onKeyDown}
              onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
              onBlur={e => {
                // Don't commit if focus moves to an alignment button inside the block
                if (blockRef.current?.contains(e.relatedTarget as Node)) return
                commit()
              }}
              placeholder={isDefMode ? '"name = \\command' : align === 'aligned' ? 'x &= 1\ny &= 2' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace',
                fontSize: '1rem', border: 'none', outline: 'none',
                resize: 'none', background: 'transparent',
                color: '#1a1a1a', boxSizing: 'border-box', lineHeight: 1.5,
              }}
            />
            {modeLabel && (
              <div style={{ fontSize: '0.68rem', color: '#9b5ccc', marginTop: '2px' }}>{modeLabel}…</div>
            )}
            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button type="button" onClick={cancel}
                style={{ background: 'none', border: `1px solid rgba(155,92,204,0.25)`, borderRadius: '4px', padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer', color: '#7a6a7a' }}>
                Cancel
              </button>
              <button type="button" onClick={commit}
                style={{ background: INK, color: 'white', border: 'none', borderRadius: '4px', padding: '3px 12px', fontSize: '0.75rem', cursor: 'pointer' }}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating popup — only from ⋯ button */}
      {popupOpen && popoverPos && createPortal(
        <div onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            padding: '0 0 12px', minWidth: '340px', maxWidth: '580px', width: 'max-content',
          }}
        >
          <div onMouseDown={onDragHeaderDown}
            style={{ cursor: 'grab', userSelect: 'none', padding: '9px 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${INK}18` }}>
            <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
              block math
              {modeLabel && <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.7rem' }}>{modeLabel}…</span>}
            </span>
            <button type="button" onClick={() => setPopupOpen(false)} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <div style={{ padding: '10px 16px 0' }}>
            {rendered && <div style={{ marginBottom: '8px', padding: '8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: align === 'left' ? 'left' : 'center' }} dangerouslySetInnerHTML={{ __html: rendered }} />}
            <div style={{ marginTop: '6px', display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
              {ALIGN_OPTIONS.map(opt => (
                <button key={opt.value} type="button" title={opt.title}
                  onClick={() => updateAttributes({ align: opt.value })}
                  style={{ fontSize: '0.72rem', padding: '3px 8px', border: `1px solid ${align === opt.value ? INK : 'rgba(155,92,204,0.25)'}`, borderRadius: '4px', background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent', color: align === opt.value ? INK : '#b0a0b8', cursor: 'pointer' }}
                >{opt.label}</button>
              ))}
              <button type="button" onClick={() => { setPopupOpen(false); setEditing(true) }}
                style={{ background: INK, color: 'white', border: 'none', borderRadius: '4px', padding: '3px 12px', fontSize: '0.75rem', cursor: 'pointer' }}>Edit</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
