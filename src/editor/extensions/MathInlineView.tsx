import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import {
  handleMathKey, applyShorthands, applyShorthandsLive,
  capsDown, capsUp, initCapsTracking, resetCapsTracking, normalizeCapsLetter,
} from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'

const INK = '#5c2d8a'

// ── KaTeX ─────────────────────────────────────────────────────────────────────

function balanceBraces(s: string): string {
  let d = 0
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d = Math.max(0, d - 1) }
  return d > 0 ? s + '}'.repeat(d) : s
}

// Partial render — throwOnError:true so broken commands return '' cleanly.
function renderPart(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(balanceBraces(applyShorthandsLive(src)), {
      throwOnError: true, displayMode: false, output: 'htmlAndMathml',
    })
  } catch { return '' }
}

function renderFull(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyCustomSymbols(applyShorthandsLive(src), getSymbols()),
      { throwOnError: true, displayMode: false, output: 'htmlAndMathml' },
    )
  } catch { return '' }
}

function renderWithCursor(src: string, cursor: number): string {
  return renderPart(src.slice(0, cursor)) +
    '<span class="math-cursor" aria-hidden="true"></span>' +
    renderPart(src.slice(cursor))
}

// Binary-search click X → LaTeX source offset.
function findOffset(src: string, clickX: number): number {
  if (!src) return 0
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;pointer-events:none;'
  document.body.appendChild(probe)
  const w = (p: string) => { probe.innerHTML = renderPart(p); return probe.getBoundingClientRect().width }
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

  const [localLatex, setLocalLatex] = useState(latex)
  const [cursorPos,  setCursorPos]  = useState(latex.length)
  const [active,     setActive]     = useState(latex === '')
  const [scOpen,     setScOpen]     = useState(false)
  const [textOpen,   setTextOpen]   = useState(false)
  const [popupOpen,  setPopupOpen]  = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)

  // Refs for stable event-handler access (avoid stale closures).
  const rLatex  = useRef(localLatex)
  const rCursor = useRef(cursorPos)
  const rSc     = useRef(scOpen)
  const rText   = useRef(textOpen)
  rLatex.current  = localLatex
  rCursor.current = cursorPos
  rSc.current     = scOpen
  rText.current   = textOpen

  const captureRef = useRef<HTMLTextAreaElement>(null)
  const boxRef     = useRef<HTMLSpanElement>(null)
  const dragRef    = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => { setLocalLatex(latex); rLatex.current = latex }, [latex])
  useEffect(() => { if (latex === '') activateAt(0) }, []) // eslint-disable-line

  const activateAt = useCallback((pos: number) => {
    rCursor.current = pos; setCursorPos(pos)
    setActive(true)
    requestAnimationFrame(() => captureRef.current?.focus())
  }, [])

  const commit = useCallback(() => {
    const src = rLatex.current
    const def = parseDefinition(src.trim())
    if (def) {
      setSymbol(def.key, def.latex); setLocalLatex(''); rLatex.current = ''
      setActive(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
      resetCapsTracking(); editor.commands.focus(); return
    }
    const processed = applyShorthands(src)
    updateAttributes({ latex: processed })
    setLocalLatex(processed); rLatex.current = processed
    setCursorPos(processed.length); rCursor.current = processed.length
    setActive(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [updateAttributes, editor])

  const cancel = useCallback(() => {
    setLocalLatex(latex); rLatex.current = latex
    setCursorPos(latex.length); rCursor.current = latex.length
    setActive(false); setPopupOpen(false); setScOpen(false); setTextOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [latex, editor])

  const openPopup = useCallback(() => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 190
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
      setPopoverPos({ top: top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 360 - 8)) })
    }
    setPopupOpen(true)
  }, [])

  const onDragHeaderDown = useCallback((e: React.MouseEvent) => {
    if (!popoverPos) return; e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: popoverPos.left, origY: popoverPos.top }
    const mv = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPopoverPos({ left: dragRef.current.origX + ev.clientX - dragRef.current.startX, top: dragRef.current.origY + ev.clientY - dragRef.current.startY })
    }
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
  }, [popoverPos])

  const displayHtml = useMemo(() =>
    active ? renderWithCursor(localLatex, cursorPos) : renderFull(localLatex),
    [localLatex, cursorPos, active])

  const previewHtml = useMemo(() => renderFull(localLatex), [localLatex])

  // All typing is handled manually; the hidden textarea stays empty.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const src = rLatex.current
    const pos = rCursor.current

    initCapsTracking(e)
    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(); return }

    // Arrow navigation
    if (e.key === 'ArrowLeft')  { e.preventDefault(); const p = Math.max(0, pos - 1);        rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); const p = Math.min(src.length, pos + 1); rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'Home')       { e.preventDefault(); rCursor.current = 0;          setCursorPos(0);          return }
    if (e.key === 'End')        { e.preventDefault(); rCursor.current = src.length; setCursorPos(src.length); return }

    // Deletion
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (pos > 0) {
        const v = src.slice(0, pos - 1) + src.slice(pos)
        rLatex.current = v; setLocalLatex(v)
        rCursor.current = pos - 1; setCursorPos(pos - 1)
      }; return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      if (pos < src.length) { const v = src.slice(0, pos) + src.slice(pos + 1); rLatex.current = v; setLocalLatex(v) }; return
    }

    // Tab: toggle text mode
    if (e.code === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      const ins = rText.current ? '}' : '\\text{'
      const v = src.slice(0, pos) + ins + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + ins.length; rCursor.current = p; setCursorPos(p)
      const t = !rText.current; rText.current = t; setTextOpen(t)
      return
    }

    // Backtick: small caps
    if (e.code === 'Backquote' && !e.shiftKey) {
      e.preventDefault()
      const ins = rSc.current ? '}}' : '\\text{\\textsc{'
      const v = src.slice(0, pos) + ins + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + ins.length; rCursor.current = p; setCursorPos(p)
      const sc = !rSc.current; rSc.current = sc; setScOpen(sc)
      return
    }

    // Greek (CapsLock held)
    const greek = handleMathKey(e)
    if (greek) {
      e.preventDefault()
      const v = src.slice(0, pos) + greek + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + greek.length; rCursor.current = p; setCursorPos(p)
      return
    }

    // CapsLock drift
    const norm = normalizeCapsLetter(e)
    if (norm !== null) {
      e.preventDefault()
      const v = src.slice(0, pos) + norm + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + 1; rCursor.current = p; setCursorPos(p)
      return
    }

    // Ctrl+C: copy raw LaTeX
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault(); navigator.clipboard.writeText(src); return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) { e.stopPropagation(); return }

    // Printable characters
    if (e.key.length === 1) {
      e.preventDefault()
      const v = src.slice(0, pos) + e.key + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + 1; rCursor.current = p; setCursorPos(p)
      return
    }

    e.stopPropagation()
  }, [commit, cancel])

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const pos = rCursor.current; const src = rLatex.current
    const v = src.slice(0, pos) + text + src.slice(pos)
    rLatex.current = v; setLocalLatex(v)
    const p = pos + text.length; rCursor.current = p; setCursorPos(p)
  }, [])

  const isDefMode = localLatex.startsWith('"')
  const defParsed = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel = isDefMode ? 'define' : textOpen ? 'text' : scOpen ? 'sc' : null

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', position: 'relative' }}>
      {/* Hidden textarea — keyboard/paste capture when active */}
      <textarea
        ref={captureRef}
        value=""
        onChange={() => {}}
        onKeyDown={onKeyDown}
        onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
        onPaste={onPaste}
        onBlur={e => {
          // Keep active if focus moves to our popup
          const rel = e.relatedTarget as HTMLElement | null
          if (rel?.closest('[data-math-popup]')) return
          commit()
        }}
        style={{
          position: 'absolute', opacity: 0, pointerEvents: 'none',
          width: 1, height: 1, top: 0, left: 0,
          resize: 'none', overflow: 'hidden', border: 0, padding: 0, margin: 0,
          zIndex: -1,
        }}
      />

      {/* Purple box — always rendered KaTeX, never raw source */}
      <span
        ref={boxRef}
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 3px 2px 7px',
          borderRadius: '5px',
          background: active ? 'rgba(155,92,204,0.08)' : selected ? 'rgba(155,92,204,0.10)' : 'rgba(155,92,204,0.04)',
          border: `1px solid ${active ? INK + '66' : 'rgba(155,92,204,0.22)'}`,
          verticalAlign: 'middle',
          cursor: 'text',
          transition: 'background 0.1s, border-color 0.1s',
        }}
      >
        <span
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            activateAt(findOffset(localLatex, e.clientX - rect.left))
          }}
          style={{ display: 'inline' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
          }}
        />
        {/* ⋯ — only trigger for the popup */}
        <button
          type="button"
          title="Open LaTeX source editor"
          onMouseDown={e => e.preventDefault()}
          onClick={openPopup}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            color: `${INK}66`, fontSize: '0.65rem', lineHeight: 1,
            padding: '0 2px 0 4px', flexShrink: 0,
            fontFamily: 'ui-monospace, monospace',
          }}
        >⋯</button>
      </span>

      {/* Floating popup — source editor, only via ⋯ */}
      {popupOpen && popoverPos && createPortal(
        <div data-math-popup=""
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,0.13)',
            padding: '0 0 10px', minWidth: '300px', maxWidth: '440px', width: 'max-content',
          }}
        >
          <div onMouseDown={onDragHeaderDown}
            style={{ cursor: 'grab', userSelect: 'none', padding: '8px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${INK}18` }}>
            <span style={{ fontSize: '0.72rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>
              LaTeX source
              {modeLabel && <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.68rem' }}>{modeLabel}{modeLabel !== 'define' ? '…' : ''}</span>}
            </span>
            <button type="button" onClick={() => setPopupOpen(false)} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <div style={{ padding: '10px 14px 0' }}>
            {isDefMode && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX, then Enter</span>}
              </div>
            )}
            {!isDefMode && previewHtml && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: 'center' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
            <input
              value={localLatex}
              onChange={e => { const v = e.target.value; setLocalLatex(v); rLatex.current = v }}
              onFocus={() => resetCapsTracking()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); setPopupOpen(false) }
                if (e.key === 'Escape') { e.preventDefault(); setPopupOpen(false) }
                e.stopPropagation()
              }}
              placeholder={isDefMode ? '"name = \\command' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '1.1rem',
                border: `1px solid ${INK}33`, borderRadius: '4px', padding: '7px 10px',
                outline: 'none', color: '#1a1a1a', background: 'transparent', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { commit(); setPopupOpen(false) }}
                style={{ background: INK, color: 'white', border: 'none', borderRadius: '5px', padding: '5px 14px', fontSize: '0.8rem', cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
