import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import {
  handleMathKey, applyShorthands, applyShorthandsLive,
  capsDown, capsUp, initCapsTracking, resetCapsTracking,
} from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'

const INK = '#5c2d8a'
const POPOVER_H = 190

function renderFull(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyCustomSymbols(applyShorthandsLive(src), getSymbols()),
      { throwOnError: true, displayMode: false, output: 'htmlAndMathml' },
    )
  } catch { return '' }
}

function renderPreview(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyShorthandsLive(src),
      { throwOnError: false, displayMode: false, output: 'htmlAndMathml' },
    )
  } catch { return '' }
}

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [popupOpen,  setPopupOpen]  = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const [popupLatex, setPopupLatex] = useState(latex)

  const boxRef      = useRef<HTMLSpanElement>(null)
  const mlContainer = useRef<HTMLSpanElement>(null)
  const mfRef       = useRef<any>(null)
  const dragRef     = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  // Sync display when node attribute changes externally (and we're not editing)
  useEffect(() => {
    if (!active) { setLocalLatex(latex); setPopupLatex(latex) }
  }, [latex, active])

  const displayHtml = useMemo(() => renderFull(localLatex), [localLatex])
  const previewHtml = useMemo(() => renderPreview(popupLatex), [popupLatex])

  const commit = useCallback((src: string) => {
    const def = parseDefinition(src.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex(''); setPopupLatex('')
      setActive(false); setMlReady(false); setPopupOpen(false)
      resetCapsTracking(); editor.commands.focus(); return
    }
    const processed = applyShorthands(src)
    updateAttributes({ latex: processed })
    setLocalLatex(processed); setPopupLatex(processed)
    setActive(false); setMlReady(false); setPopupOpen(false)
    resetCapsTracking(); editor.commands.focus()
  }, [updateAttributes, editor])

  // ── Mount / unmount MathLive ───────────────────────────────────────────────
  useEffect(() => {
    if (!active) { setMlReady(false); return }
    if (!mlContainer.current) return

    let cancelled = false
    let lastKeyWasSlash = false

    loadMathLive().then(() => {
      if (cancelled || !mlContainer.current) return

      const mf = document.createElement('math-field') as any
      mf.value = localLatex
      mf.mathVirtualKeyboardPolicy = 'manual'
      mf.style.cssText = [
        'display:inline;background:transparent;border:none;',
        'outline:none;font-size:inherit;font-family:inherit;',
        '--caret-color:#5c2d8a;',
        '--selection-background-color:rgba(155,92,204,0.25);',
      ].join('')

      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        initCapsTracking(e as any)

        if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

        const greek = handleMathKey(e as any)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }

        // Tab — toggle \text{} mode
        if (e.code === 'Tab') {
          e.preventDefault(); e.stopPropagation()
          if (mf.mode === 'text') mf.executeCommand('moveAfterParent')
          else                    mf.executeCommand(['insert', '\\text{#?}'])
          return
        }

        // Backtick — small caps
        if (e.code === 'Backquote' && !e.shiftKey) {
          e.preventDefault()
          if (mf.mode === 'text') mf.executeCommand('moveAfterParent')
          else                    mf.executeCommand(['insert', '\\text{\\textsc{#?}}'])
          return
        }

        // // → display fraction (undo the first /, insert \dfrac)
        if (e.key === '/' && lastKeyWasSlash) {
          e.preventDefault()
          mf.executeCommand('undo')
          mf.executeCommand(['insert', '\\dfrac{#@}{#?}'])
          lastKeyWasSlash = false; return
        }
        lastKeyWasSlash = e.key === '/'

        // Ctrl+C — copy raw LaTeX
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          e.preventDefault()
          navigator.clipboard.writeText(mf.value).catch(() => {})
          return
        }

        if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation()
      }, { capture: true })

      mf.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.code === 'CapsLock') capsUp()
      })

      mf.addEventListener('input', () => {
        const v = mf.value
        setLocalLatex(v); setPopupLatex(v)
      })

      mf.addEventListener('blur', (e: FocusEvent) => {
        const rel = (e as any).relatedTarget as Element | null
        if (rel?.closest('[data-math-popup]') || rel?.closest('[data-math-inline-box]')) return
        if (!cancelled) commit(mf.value)
      })

      mlContainer.current.appendChild(mf)
      mfRef.current = mf
      setMlReady(true)
      requestAnimationFrame(() => { if (!cancelled) mf.focus() })
    })

    return () => {
      cancelled = true
      if (mfRef.current && mlContainer.current?.contains(mfRef.current)) {
        mlContainer.current.removeChild(mfRef.current)
      }
      mfRef.current = null
    }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Popup ──────────────────────────────────────────────────────────────────
  const openPopup = useCallback(() => {
    if (!boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
    setPopoverPos({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 360 - 8)) })
    setPopupLatex(mfRef.current ? mfRef.current.value : localLatex)
    setPopupOpen(true)
  }, [localLatex])

  const onDragHeaderDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: popoverPos.left, origY: popoverPos.top }
    const mv = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPopoverPos({ left: dragRef.current.origX + ev.clientX - dragRef.current.startX, top: dragRef.current.origY + ev.clientY - dragRef.current.startY })
    }
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
  }, [popoverPos])

  const isDefMode = localLatex.startsWith('"')
  const defParsed = isDefMode ? parseDefinition(localLatex.trim()) : null
  const modeLabel = isDefMode ? 'define' : null

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        ref={boxRef}
        data-math-inline-box=""
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 3px 2px 7px', borderRadius: '5px',
          verticalAlign: 'middle', cursor: 'text',
          transition: 'background 0.1s, border-color 0.1s',
          background: active ? 'rgba(155,92,204,0.08)' : selected ? 'rgba(155,92,204,0.10)' : 'rgba(155,92,204,0.04)',
          border: `1px solid ${active ? INK + '66' : 'rgba(155,92,204,0.22)'}`,
        }}
      >
        {/* KaTeX — shown until MathLive is ready, then hidden */}
        <span
          onClick={() => setActive(true)}
          style={{ display: active && mlReady ? 'none' : 'inline' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
          }}
        />

        {/* MathLive mounts here when active */}
        <span ref={mlContainer} style={{ display: active ? 'inline' : 'none' }} />

        {/* ⋯ — only trigger for the popup */}
        <button
          type="button"
          title="Open LaTeX source editor"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { if (!active) setActive(true); openPopup() }}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            color: `${INK}66`, fontSize: '0.65rem', lineHeight: 1,
            padding: '0 2px 0 4px', flexShrink: 0,
            fontFamily: 'ui-monospace, monospace',
          }}
        >⋯</button>
      </span>

      {/* Floating popup — source editor, only via ⋯ */}
      {popupOpen && createPortal(
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
              {modeLabel && <span style={{ marginLeft: '6px', color: '#9b5ccc', fontSize: '0.68rem' }}>{modeLabel}</span>}
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
              value={popupLatex}
              onChange={e => {
                const v = e.target.value
                setPopupLatex(v); setLocalLatex(v)
                if (mfRef.current) mfRef.current.value = v
              }}
              onFocus={() => resetCapsTracking()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(popupLatex); return }
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
              <button type="button" onClick={() => commit(popupLatex)}
                style={{ background: INK, color: 'white', border: 'none', borderRadius: '5px', padding: '5px 14px', fontSize: '0.8rem', cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
