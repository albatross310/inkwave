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

// ── KaTeX helpers ─────────────────────────────────────────────────────────────

// Add enough closing braces so a prefix-fragment won't throw.
function balanceBraces(s: string): string {
  let depth = 0
  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
  }
  return depth > 0 ? s + '}'.repeat(depth) : s
}

// Render a possibly-incomplete LaTeX fragment inline (throwOnError:false so
// partial expressions like "\frac{x" show approximately, not as red errors).
function renderPartial(src: string): string {
  if (!src) return ''
  try {
    return katex.renderToString(balanceBraces(src), {
      throwOnError: false,
      displayMode: false,
      output: 'htmlAndMathml',
    })
  } catch { return '' }
}

// Render the full source. Uses live shorthand expansion so x// shows immediately.
function renderKatex(src: string, live = false): string {
  if (!src.trim()) return ''
  try {
    const symbols  = getSymbols()
    const expanded = live ? applyShorthandsLive(src) : applyShorthands(src)
    return katex.renderToString(applyCustomSymbols(expanded, symbols), {
      throwOnError: true,
      displayMode: false,
      output: 'htmlAndMathml',
    })
  } catch { return '' }
}

// Split at cursor offset, apply live shorthands to each half, embed blinking cursor.
function renderWithCursor(src: string, offset: number): string {
  const pre = applyShorthandsLive(src.slice(0, offset))
  const suf = applyShorthandsLive(src.slice(offset))
  return renderPartial(pre) +
    '<span class="math-cursor" aria-hidden="true"></span>' +
    renderPartial(suf)
}

// Given a click X coordinate (relative to the equation span's left edge),
// binary-search for the LaTeX source offset whose rendered prefix width
// is closest to clickX. Uses an off-screen measurement span so KaTeX fonts
// are loaded (they're already in the document via the katex.css import).
function findCursorOffset(src: string, clickX: number): number {
  if (!src) return 0

  // Reuse a single measurement span per call (created fresh, removed after).
  const probe = document.createElement('span')
  probe.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;visibility:hidden;' +
    'white-space:nowrap;pointer-events:none;'
  document.body.appendChild(probe)

  function measureWidth(prefix: string): number {
    probe.innerHTML = renderPartial(applyShorthandsLive(prefix))
    return probe.getBoundingClientRect().width
  }

  try {
    // Quick bounds check.
    if (clickX <= 0) return 0
    if (clickX >= measureWidth(src)) return src.length

    // Binary search over character positions.
    let lo = 0, hi = src.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (measureWidth(src.slice(0, mid)) <= clickX) lo = mid
      else hi = mid - 1
    }
    return lo
  } finally {
    document.body.removeChild(probe)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const [popupOpen,    setPopupOpen]    = useState(latex === '')
  const [localLatex,   setLocalLatex]   = useState(latex)
  const [cursorOffset, setCursorOffset] = useState(latex.length)
  const [scOpen,       setScOpen]       = useState(false) // small-caps mode
  const inputRef        = useRef<HTMLInputElement>(null)
  // Carries a click-computed cursor position into the popup-open effect.
  const pendingCursorRef = useRef<number | null>(null)

  useEffect(() => { setLocalLatex(latex) }, [latex])
  useEffect(() => { if (latex === '') setPopupOpen(true) }, []) // eslint-disable-line

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

  // Cursor tracking: call this after any event that may move the caret.
  const trackCursor = useCallback((el: HTMLInputElement) => {
    setCursorOffset(el.selectionStart ?? el.value.length)
  }, [])

  // Full rendered html (cursor embedded when popup is open, live shorthands always).
  const displayHtml = useMemo(
    () => popupOpen
      ? renderWithCursor(localLatex, cursorOffset)
      : renderKatex(localLatex, true),
    [localLatex, cursorOffset, popupOpen],
  )

  // Preview in the popup modal (live shorthands, no cursor).
  const previewHtml = useMemo(() => renderKatex(localLatex, true), [localLatex])

  const commit = useCallback(() => {
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = inputRef.current!
    initCapsTracking(e)

    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

    // Tab held → normal letters. Tab up handled in onKeyUp.
    if (e.code === 'Tab') { e.preventDefault(); e.stopPropagation(); tabDown(); return }

    // Backtick: toggle small-caps mode.
    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      if (!scOpen) {
        const { value, cursor } = insertAtCursor(el, '\\text{\\textsc{')
        setLocalLatex(value)
        setScOpen(true)
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      } else {
        const { value, cursor } = insertAtCursor(el, '}}')
        setLocalLatex(value)
        setScOpen(false)
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      }
      return
    }

    // Greek mode (CapsLock held, Tab not held).
    const greek = handleMathKey(e)
    if (greek) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, greek)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    // CapsLock drift normalisation (regular letters when CapsLock drifted).
    const normal = normalizeCapsLetter(e)
    if (normal !== null) {
      e.preventDefault()
      const { value, cursor } = insertAtCursor(el, normal)
      setLocalLatex(value)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = cursor; trackCursor(el) })
      return
    }

    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      // "key = latex → save as symbol definition, clear box
      const def = parseDefinition(localLatex.trim())
      if (e.key === 'Enter' && def) {
        setSymbol(def.key, def.latex)
        setLocalLatex('')
        setPopupOpen(false)
        resetCapsTracking()
        editor.commands.focus()
        return
      }
      commit()
      return
    }
    e.stopPropagation()
  }

  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.code === 'CapsLock') capsUp()
    if (e.code === 'Tab') tabUp()
    trackCursor(inputRef.current!)
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      {/* Always-visible rendered equation; click opens popup at click position */}
      <span
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const pos  = findCursorOffset(localLatex, e.clientX - rect.left)
          setCursorOffset(pos)
          pendingCursorRef.current = pos
          setPopupOpen(true)
        }}
        onCopy={handleCopy}
        style={{
          display: 'inline',
          cursor: 'text',
          padding: '1px 8px',
          borderRadius: '4px',
          background: selected ? 'rgba(155,92,204,0.10)' : 'transparent',
          outline: popupOpen ? `1px solid ${INK}55` : 'none',
          transition: 'background 0.1s',
        }}
        dangerouslySetInnerHTML={{
          __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
        }}
      />

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
              minWidth: '260px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
                inline math{scOpen ? <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.7rem' }}>sc…</span> : null}
              </span>
              <button type="button" onClick={cancel} aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>

            {previewHtml && (
              <div
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pos  = findCursorOffset(localLatex, e.clientX - rect.left)
                  const el   = inputRef.current
                  if (!el) return
                  el.selectionStart = el.selectionEnd = pos
                  el.focus()
                  trackCursor(el)
                }}
                style={{ marginBottom: '8px', padding: '6px 8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: 'center', cursor: 'text' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}

            <input
              ref={inputRef}
              value={localLatex}
              onChange={e => { setLocalLatex(e.target.value); trackCursor(e.target) }}
              onFocus={() => resetCapsTracking()}
              onClick={e => trackCursor(e.currentTarget)}
              onSelect={e => trackCursor(e.currentTarget)}
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              placeholder="LaTeX…"
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85em',
                border: `1px solid ${INK}33`,
                borderRadius: '4px',
                padding: '5px 8px',
                outline: 'none',
                color: '#1a1a1a',
                background: 'transparent',
              }}
            />

            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
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
