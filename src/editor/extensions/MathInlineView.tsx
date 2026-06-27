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

// ── KaTeX helpers ─────────────────────────────────────────────────────────────

function balanceBraces(s: string): string {
  let d = 0
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d = Math.max(0, d - 1) }
  return d > 0 ? s + '}'.repeat(d) : s
}

function renderPartial(src: string): string {
  if (!src) return ''
  try { return katex.renderToString(balanceBraces(src), { throwOnError: false, displayMode: false, output: 'htmlAndMathml' }) }
  catch { return '' }
}

function renderKatex(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyCustomSymbols(applyShorthandsLive(src), getSymbols()),
      { throwOnError: true, displayMode: false, output: 'htmlAndMathml' },
    )
  } catch { return '' }
}

// Find LaTeX source offset from a click X inside the rendered span.
function findCursorOffset(src: string, clickX: number): number {
  if (!src) return 0
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;pointer-events:none;'
  document.body.appendChild(probe)
  const w = (prefix: string) => {
    probe.innerHTML = renderPartial(applyShorthandsLive(prefix))
    return probe.getBoundingClientRect().width
  }
  try {
    if (clickX <= 0) return 0
    if (clickX >= w(src)) return src.length
    let lo = 0, hi = src.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (w(src.slice(0, mid)) <= clickX) lo = mid; else hi = mid - 1
    }
    return lo
  } finally { document.body.removeChild(probe) }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex

  // editing = inline input visible inside the box (direct edit)
  // popupOpen = floating popup open (via tiny ⋯ button only)
  const [editing,     setEditing]     = useState(latex === '')
  const [popupOpen,   setPopupOpen]   = useState(false)
  const [localLatex,  setLocalLatex]  = useState(latex)
  const [scOpen,      setScOpen]      = useState(false)
  const [textOpen,    setTextOpen]    = useState(false)
  const [popoverPos,  setPopoverPos]  = useState<{ top: number; left: number } | null>(null)

  const inputRef    = useRef<HTMLInputElement>(null)
  const boxRef      = useRef<HTMLSpanElement>(null)
  const btnRef      = useRef<HTMLButtonElement>(null)
  const dragRef     = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const pendingCursor = useRef<number | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  // New empty equation → go straight into edit mode
  useEffect(() => { if (latex === '') { setEditing(true) } }, []) // eslint-disable-line

  // When entering edit mode, place cursor at the position computed from click.
  useEffect(() => {
    if (!editing) return
    const id = requestAnimationFrame(() => {
      const el = inputRef.current; if (!el) return
      el.focus()
      const pos = pendingCursor.current ?? el.value.length
      pendingCursor.current = null
      el.selectionStart = el.selectionEnd = pos
    })
    return () => cancelAnimationFrame(id)
  }, [editing])

  const commit = useCallback(() => {
    const def = parseDefinition(localLatex.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex(''); setEditing(false); setScOpen(false); setTextOpen(false)
      resetCapsTracking(); editor.commands.focus(); return
    }
    const processed = applyShorthands(localLatex)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    setEditing(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [localLatex, updateAttributes, editor])

  const cancel = useCallback(() => {
    setLocalLatex(latex); setEditing(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [latex, editor])

  // Open floating popup anchored to the box.
  const openPopup = useCallback(() => {
    const rect = (boxRef.current ?? btnRef.current)?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 190
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 360 - 8))
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

  const renderedHtml = useMemo(() => renderKatex(localLatex), [localLatex])

  const handleCopy = (e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) { e.preventDefault(); e.clipboardData.setData('text/plain', localLatex) }
  }

  const sharedKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = inputRef.current!
    initCapsTracking(e)
    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

    if (e.code === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      const { value, cursor } = textOpen ? insertAtCursor(el, '}') : insertAtCursor(el, '\\text{')
      setLocalLatex(value); setTextOpen(!textOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
    }
    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      const { value, cursor } = scOpen ? insertAtCursor(el, '}}') : insertAtCursor(el, '\\text{\\textsc{')
      setLocalLatex(value); setScOpen(!scOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor })
      return
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
    if (e.key === 'Enter') { e.preventDefault(); commit(); return }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    e.stopPropagation()
  }, [textOpen, scOpen, commit, cancel])

  const isDefMode = localLatex.startsWith('"')
  const defParsed = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel = isDefMode ? 'define' : textOpen ? 'text' : scOpen ? 'sc' : null

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', position: 'relative' }}>
      {/* Purple box — always visible */}
      <span
        ref={boxRef}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: editing ? '2px 4px 2px 8px' : '2px 4px 2px 8px',
          borderRadius: '5px',
          background: editing ? 'rgba(155,92,204,0.07)' : selected ? 'rgba(155,92,204,0.10)' : 'rgba(155,92,204,0.04)',
          border: `1px solid ${editing ? INK + '55' : 'rgba(155,92,204,0.22)'}`,
          transition: 'background 0.1s, border-color 0.1s',
          verticalAlign: 'middle',
        }}
      >
        {/* Direct-edit input — shown while editing */}
        {editing ? (
          <input
            ref={inputRef}
            value={localLatex}
            onChange={e => setLocalLatex(e.target.value)}
            onFocus={() => resetCapsTracking()}
            onKeyDown={sharedKeyDown}
            onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
            onBlur={commit}
            placeholder="LaTeX…"
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.92em', color: '#1a1a1a',
              minWidth: '4ch',
              width: `${Math.max(4, localLatex.length + 1)}ch`,
            }}
          />
        ) : (
          /* Rendered KaTeX — click to edit */
          <span
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              pendingCursor.current = findCursorOffset(localLatex, e.clientX - rect.left)
              setEditing(true)
            }}
            onCopy={handleCopy}
            style={{ cursor: 'text', display: 'inline' }}
            dangerouslySetInnerHTML={{
              __html: renderedHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
            }}
          />
        )}

        {/* Tiny ⋯ button — ONLY way to open the popup */}
        <button
          ref={btnRef}
          type="button"
          title="Open LaTeX editor"
          onMouseDown={e => e.preventDefault()}
          onClick={e => { e.stopPropagation(); openPopup() }}
          style={{
            flexShrink: 0,
            border: 'none', background: 'none',
            color: INK + '88', cursor: 'pointer',
            fontSize: '0.7rem', lineHeight: 1, padding: '0 1px',
            fontFamily: 'ui-monospace, monospace',
          }}
        >⋯</button>
      </span>

      {/* Floating popup — only from ⋯ button */}
      {popupOpen && popoverPos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,0.13)',
            padding: '0 0 10px', minWidth: '300px', maxWidth: '440px', width: 'max-content',
          }}
        >
          {/* Drag handle */}
          <div
            onMouseDown={onDragHeaderDown}
            style={{
              cursor: 'grab', userSelect: 'none', padding: '8px 14px 6px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: `1px solid ${INK}18`,
            }}
          >
            <span style={{ fontSize: '0.72rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
              inline math
              {modeLabel && <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.68rem' }}>{modeLabel}{modeLabel !== 'define' ? '…' : ''}</span>}
            </span>
            <button type="button" onClick={() => setPopupOpen(false)} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>

          <div style={{ padding: '10px 14px 0' }}>
            {/* Def mode hint */}
            {isDefMode && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX, then Enter</span>}
              </div>
            )}
            {/* Rendered preview */}
            {!isDefMode && renderedHtml && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: 'center' }}
                dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            )}
            {/* Popup input */}
            <input
              value={localLatex}
              onChange={e => setLocalLatex(e.target.value)}
              onFocus={() => resetCapsTracking()}
              onKeyDown={sharedKeyDown}
              onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
              placeholder={isDefMode ? '"name = \\command' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '1.1rem',
                border: `1px solid ${INK}33`, borderRadius: '4px',
                padding: '7px 10px', outline: 'none', color: '#1a1a1a',
                background: 'transparent', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { commit(); setPopupOpen(false) }}
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
