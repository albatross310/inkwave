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

type Align = 'aligned' | 'center' | 'left'

const ALIGN_OPTIONS: { value: Align; label: string; title: string }[] = [
  { value: 'aligned', label: '=',  title: 'Align at equals (Ctrl+Q)' },
  { value: 'center',  label: '⊙', title: 'Centre (Ctrl+E)'          },
  { value: 'left',    label: '◁',  title: 'Left align (Ctrl+L)'      },
]

function balanceBraces(s: string): string {
  let d = 0
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d = Math.max(0, d - 1) }
  return d > 0 ? s + '}'.repeat(d) : s
}

// When editing: inline split-render so cursor is visible mid-expression.
function renderPart(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(balanceBraces(applyShorthandsLive(src)), {
      throwOnError: true, displayMode: false, output: 'htmlAndMathml',
    })
  } catch { return '' }
}

// When committed: full display-mode render.
function renderDisplay(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const src     = applyCustomSymbols(applyShorthandsLive(latex), getSymbols())
    const wrapped = align === 'aligned' && !/\\begin\{/.test(src)
      ? `\\begin{aligned}\n${src}\n\\end{aligned}` : src
    return katex.renderToString(wrapped, { throwOnError: true, displayMode: true, output: 'htmlAndMathml' })
  } catch { return '' }
}

function renderWithCursor(src: string, cursor: number): string {
  return renderPart(src.slice(0, cursor)) +
    '<span class="math-cursor" aria-hidden="true"></span>' +
    renderPart(src.slice(cursor))
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'

  const [localLatex, setLocalLatex] = useState(latex)
  const [cursorPos,  setCursorPos]  = useState(latex.length)
  const [active,     setActive]     = useState(latex === '')
  const [scOpen,     setScOpen]     = useState(false)
  const [textOpen,   setTextOpen]   = useState(false)
  const [popupOpen,  setPopupOpen]  = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)

  const rLatex  = useRef(localLatex)
  const rCursor = useRef(cursorPos)
  const rSc     = useRef(scOpen)
  const rText   = useRef(textOpen)
  rLatex.current  = localLatex
  rCursor.current = cursorPos
  rSc.current     = scOpen
  rText.current   = textOpen

  const captureRef = useRef<HTMLTextAreaElement>(null)
  const blockRef   = useRef<HTMLDivElement>(null)
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
    const rect = blockRef.current?.getBoundingClientRect()
    if (rect) {
      const POPOVER_H = 240
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
      setPopoverPos({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 560 - 8)) })
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

  // Active: inline split-render with cursor. Inactive: full display-mode render.
  const displayHtml = useMemo(() =>
    active ? renderWithCursor(localLatex, cursorPos) : renderDisplay(localLatex, align),
    [localLatex, cursorPos, active, align])

  const previewHtml = useMemo(() => renderDisplay(localLatex, align), [localLatex, align])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const src = rLatex.current
    const pos = rCursor.current

    initCapsTracking(e)
    if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); return }

    // Arrow navigation
    if (e.key === 'ArrowLeft')  { e.preventDefault(); const p = Math.max(0, pos - 1);        rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); const p = Math.min(src.length, pos + 1); rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'ArrowUp')    { e.preventDefault(); const p = Math.max(0, pos - 1);        rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); const p = Math.min(src.length, pos + 1); rCursor.current = p; setCursorPos(p); return }
    if (e.key === 'Home')       { e.preventDefault(); rCursor.current = 0;          setCursorPos(0);          return }
    if (e.key === 'End')        { e.preventDefault(); rCursor.current = src.length; setCursorPos(src.length); return }

    // Deletion
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (pos > 0) { const v = src.slice(0, pos - 1) + src.slice(pos); rLatex.current = v; setLocalLatex(v); rCursor.current = pos - 1; setCursorPos(pos - 1) }; return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      if (pos < src.length) { const v = src.slice(0, pos) + src.slice(pos + 1); rLatex.current = v; setLocalLatex(v) }; return
    }

    // Enter in block math: insert line break (\\)
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      const ins = '\\\\\n'
      const v = src.slice(0, pos) + ins + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + ins.length; rCursor.current = p; setCursorPos(p)
      return
    }

    // Tab: text mode
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

    // Greek
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

    // Ctrl shortcuts
    if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
      if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); updateAttributes({ align: 'aligned' }); return }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); updateAttributes({ align: 'center' });  return }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); updateAttributes({ align: 'left' });    return }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); navigator.clipboard.writeText(src);     return }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) { e.stopPropagation(); return }

    // Printable
    if (e.key.length === 1) {
      e.preventDefault()
      const v = src.slice(0, pos) + e.key + src.slice(pos)
      rLatex.current = v; setLocalLatex(v)
      const p = pos + 1; rCursor.current = p; setCursorPos(p)
      return
    }
    e.stopPropagation()
  }, [commit, cancel, updateAttributes])

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
    <NodeViewWrapper>
      {/* Hidden keyboard capture */}
      <textarea
        ref={captureRef}
        value=""
        onChange={() => {}}
        onKeyDown={onKeyDown}
        onKeyUp={e => { if (e.code === 'CapsLock') capsUp() }}
        onPaste={onPaste}
        onBlur={e => {
          const rel = e.relatedTarget as HTMLElement | null
          if (rel?.closest('[data-math-popup]') || blockRef.current?.contains(rel)) return
          commit()
        }}
        style={{
          position: 'absolute', opacity: 0, pointerEvents: 'none',
          width: 1, height: 1, resize: 'none', overflow: 'hidden',
          border: 0, padding: 0, margin: 0, zIndex: -1,
        }}
      />

      {/* Block — always rendered KaTeX (inline split when editing) */}
      <div
        ref={blockRef}
        onClick={() => { if (!active) activateAt(rLatex.current.length) }}
        style={{
          margin: '1em 0', padding: '0.6em 1em',
          border: `1px solid ${active || selected ? `${INK}55` : 'rgba(155,92,204,0.18)'}`,
          borderRadius: '6px', background: 'rgba(155,92,204,0.03)',
          position: 'relative', cursor: 'text',
          textAlign: active ? 'left' : align === 'left' ? 'left' : 'center',
          minHeight: '2.5em',
        }}
      >
        {/* Top-right: align buttons + ⋯ */}
        <div style={{
          position: 'absolute', top: '0.35rem', right: '0.4rem',
          display: 'flex', gap: '3px', alignItems: 'center',
          opacity: active || selected ? 1 : 0,
          transition: 'opacity 0.15s',
          pointerEvents: active || selected ? 'auto' : 'none',
        }}>
          {ALIGN_OPTIONS.map(opt => (
            <button key={opt.value} type="button" title={opt.title}
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
          <button type="button" title="Open LaTeX source editor"
            onMouseDown={e => e.preventDefault()}
            onClick={openPopup}
            style={{
              fontSize: '0.68rem', padding: '1px 5px',
              border: `1px solid rgba(155,92,204,0.22)`, borderRadius: '3px',
              background: 'transparent', color: `${INK}77`,
              cursor: 'pointer', fontFamily: 'ui-monospace, monospace', lineHeight: '1.4',
            }}>⋯</button>
        </div>

        {/* Rendered math — always KaTeX */}
        <div
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
          }}
        />

        {/* Mode indicator when active */}
        {active && modeLabel && (
          <div style={{ fontSize: '0.68rem', color: '#9b5ccc', marginTop: '2px' }}>{modeLabel}…</div>
        )}
      </div>

      {/* Floating popup — only via ⋯ */}
      {popupOpen && popoverPos && createPortal(
        <div data-math-popup=""
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 190,
            background: 'white', border: `1px solid ${INK}44`,
            borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            padding: '0 0 12px', minWidth: '340px', maxWidth: '560px', width: 'max-content',
          }}
        >
          <div onMouseDown={onDragHeaderDown}
            style={{ cursor: 'grab', userSelect: 'none', padding: '9px 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${INK}18` }}>
            <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.05em' }}>LaTeX source</span>
            <button type="button" onClick={() => setPopupOpen(false)} aria-label="Close"
              onMouseDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <div style={{ padding: '10px 16px 0' }}>
            {isDefMode && (
              <div style={{ marginBottom: '8px', padding: '5px 8px', background: 'rgba(155,92,204,0.06)', borderRadius: '4px', fontSize: '0.78rem', color: INK }}>
                {defParsed
                  ? <>defining <strong style={{ fontFamily: 'ui-monospace,monospace' }}>{defParsed.key}</strong> → <code>{defParsed.latex}</code></>
                  : <span style={{ color: '#b0a898' }}>type: "name = \LaTeX</span>}
              </div>
            )}
            {!isDefMode && previewHtml && (
              <div style={{ marginBottom: '8px', padding: '8px', background: 'rgba(155,92,204,0.04)', borderRadius: '4px', textAlign: align === 'left' ? 'left' : 'center' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
            <textarea
              value={localLatex}
              rows={Math.max(2, localLatex.split('\n').length)}
              onChange={e => { const v = e.target.value; setLocalLatex(v); rLatex.current = v }}
              onFocus={() => resetCapsTracking()}
              onKeyDown={e => {
                if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); commit(); setPopupOpen(false) }
                e.stopPropagation()
              }}
              placeholder={isDefMode ? '"name = \\command' : align === 'aligned' ? 'x &= 1\ny &= 2' : 'LaTeX…'}
              style={{
                width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '1.05rem',
                border: `1px solid ${INK}33`, borderRadius: '4px', padding: '7px 10px',
                outline: 'none', resize: 'vertical', color: '#1a1a1a',
                background: 'transparent', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {ALIGN_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" title={opt.title}
                    onClick={() => updateAttributes({ align: opt.value })}
                    style={{ fontSize: '0.72rem', padding: '3px 8px', border: `1px solid ${align === opt.value ? INK : 'rgba(155,92,204,0.25)'}`, borderRadius: '4px', background: align === opt.value ? 'rgba(155,92,204,0.10)' : 'transparent', color: align === opt.value ? INK : '#b0a0b8', cursor: 'pointer' }}
                  >{opt.label}</button>
                ))}
              </div>
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
