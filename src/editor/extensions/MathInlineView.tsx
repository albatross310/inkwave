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

// ── KaTeX helpers ─────────────────────────────────────────────────────────────

function balanceBraces(s: string): string {
  let depth = 0
  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
  }
  return depth > 0 ? s + '}'.repeat(depth) : s
}

function renderPartial(src: string): string {
  if (!src) return ''
  try {
    return katex.renderToString(balanceBraces(src), {
      throwOnError: false, displayMode: false, output: 'htmlAndMathml',
    })
  } catch { return '' }
}

function renderKatex(src: string): string {
  if (!src.trim()) return ''
  try {
    const expanded = applyCustomSymbols(applyShorthandsLive(src), getSymbols())
    return katex.renderToString(expanded, {
      throwOnError: true, displayMode: false, output: 'htmlAndMathml',
    })
  } catch { return '' }
}

function renderWithCursor(src: string, offset: number): string {
  const pre = applyShorthandsLive(src.slice(0, offset))
  const suf = applyShorthandsLive(src.slice(offset))
  return renderPartial(pre) +
    '<span class="math-cursor" aria-hidden="true"></span>' +
    renderPartial(suf)
}

function findCursorOffset(src: string, clickX: number): number {
  if (!src) return 0
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;pointer-events:none;'
  document.body.appendChild(probe)
  const measure = (prefix: string) => {
    probe.innerHTML = renderPartial(applyShorthandsLive(prefix))
    return probe.getBoundingClientRect().width
  }
  try {
    if (clickX <= 0) return 0
    if (clickX >= measure(src)) return src.length
    let lo = 0, hi = src.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (measure(src.slice(0, mid)) <= clickX) lo = mid
      else hi = mid - 1
    }
    return lo
  } finally { document.body.removeChild(probe) }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const [popupOpen,    setPopupOpen]    = useState(latex === '')
  const [localLatex,   setLocalLatex]   = useState(latex)
  const [cursorOffset, setCursorOffset] = useState(latex.length)
  const [scOpen,       setScOpen]       = useState(false)
  const [textOpen,     setTextOpen]     = useState(false)
  const [hovering,     setHovering]     = useState(false)
  const [popoverPos,   setPopoverPos]   = useState<{ top: number; left: number } | null>(null)

  const inputRef         = useRef<HTMLInputElement>(null)
  const eqRef            = useRef<HTMLSpanElement>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const dragRef          = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  useEffect(() => { if (latex === '') openPopup(latex.length) }, []) // eslint-disable-line

  const openPopup = useCallback((cursorPos: number) => {
    const rect = eqRef.current?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 180
      const spaceBelow = window.innerHeight - rect.bottom
      // Default 24px below the equation so it doesn't crowd the text.
      const top = spaceBelow >= POPOVER_H + 16
        ? rect.bottom + 24
        : rect.top - POPOVER_H - 16
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 360 - 8))
      setPopoverPos({ top, left })
    }
    setCursorOffset(cursorPos)
    pendingCursorRef.current = cursorPos
    setPopupOpen(true)
  }, [])

  useEffect(() => {
    if (!popupOpen) return
    const id = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      const pos = pendingCursorRef.current ?? el.value.length
      pendingCursorRef.current = null
      el.focus()
      el.selectionStart = el.selectionEnd = pos
      setCursorOffset(pos)
    })
    return () => cancelAnimationFrame(id)
  }, [popupOpen])

  // Drag the popover by its header bar.
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

  const trackCursor = useCallback((el: HTMLInputElement) => {
    setCursorOffset(el.selectionStart ?? el.value.length)
  }, [])

  const displayHtml = useMemo(
    () => popupOpen
      ? renderWithCursor(localLatex, cursorOffset)
      : renderKatex(localLatex),
    [localLatex, cursorOffset, popupOpen],
  )
  const previewHtml = useMemo(() => renderKatex(localLatex), [localLatex])

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = inputRef.current!
    initCapsTracking(e)
    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

    if (e.code === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      const { value, cursor } = textOpen
        ? insertAtCursor(el, '}')
        : insertAtCursor(el, '\\text{')
      setLocalLatex(value); setTextOpen(!textOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      const { value, cursor } = scOpen
        ? insertAtCursor(el, '}}')
        : insertAtCursor(el, '\\text{\\textsc{')
      setLocalLatex(value); setScOpen(!scOpen)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    const greek = handleMathKey(e)
    if (greek) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, greek)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    const normal = normalizeCapsLetter(e)
    if (normal !== null) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, normal)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(); return }
    e.stopPropagation()
  }

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.code === 'CapsLock') capsUp()
    trackCursor(inputRef.current!)
  }

  const isDefMode  = localLatex.startsWith('"')
  const defParsed  = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel  = isDefMode ? 'define' : textOpen ? 'text' : scOpen ? 'sc' : null

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', position: 'relative' }}>
      {/* Rendered equation */}
      <span
        ref={eqRef}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          openPopup(findCursorOffset(localLatex, e.clientX - rect.left))
        }}
        onCopy={handleCopy}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          display: 'inline', cursor: 'text', padding: '1px 8px', borderRadius: '4px',
          background: selected ? 'rgba(155,92,204,0.10)' : 'transparent',
          outline: popupOpen ? `1px solid ${INK}55` : 'none',
          transition: 'background 0.1s',
        }}
        dangerouslySetInnerHTML={{
          __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
        }}
      />

      {/* Hover edit button */}
      {hovering && !popupOpen && (
        <button type="button" aria-label="Edit equation"
          onMouseEnter={() => setHovering(true)}
          onClick={() => openPopup(localLatex.length)}
          style={{
            position: 'absolute', top: '-7px', right: '-7px',
            width: '16px', height: '16px',
            background: INK, color: 'white',
            border: 'none', borderRadius: '50%',
            fontSize: '9px', lineHeight: '16px', textAlign: 'center',
            cursor: 'pointer', padding: 0,
          }}>✎</button>
      )}

      {/* Floating draggable popover */}
      {popupOpen && popoverPos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left,
            zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,0.13)',
            padding: '0 0 10px',
            minWidth: '300px', maxWidth: '440px', width: 'max-content',
          }}
        >
          {/* Drag handle / header */}
          <div
            onMouseDown={onDragHeaderDown}
            style={{
              cursor: 'grab', userSelect: 'none',
              padding: '8px 14px 6px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: `1px solid ${INK}18`,
            }}
          >
            <span style={{ fontSize: '0.72rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
              inline math
              {modeLabel && (
                <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.68rem' }}>
                  {modeLabel}{modeLabel !== 'define' ? '…' : ''}
                </span>
              )}
            </span>
            <button type="button" onClick={cancel} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>

          <div style={{ padding: '10px 14px 0' }}>
            {/* Definition mode hint */}
            {isDefMode && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX, then Enter</span>}
              </div>
            )}

            {/* Rendered preview */}
            {!isDefMode && previewHtml && (
              <div
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pos = findCursorOffset(localLatex, e.clientX - rect.left)
                  const el = inputRef.current; if (!el) return
                  el.selectionStart = el.selectionEnd = pos; el.focus(); trackCursor(el)
                }}
                style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: 'center', cursor: 'text' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}

            {/* LaTeX input — bigger font */}
            <input
              ref={inputRef}
              value={localLatex}
              onChange={e => { setLocalLatex(e.target.value); trackCursor(e.target) }}
              onFocus={() => resetCapsTracking()}
              onClick={e => trackCursor(e.currentTarget)}
              onSelect={e => trackCursor(e.currentTarget)}
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              placeholder={isDefMode ? '"name = \\command' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace',
                fontSize: '1.1rem',
                border: `1px solid ${INK}33`, borderRadius: '4px',
                padding: '7px 10px', outline: 'none',
                color: '#1a1a1a', background: 'transparent',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
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
