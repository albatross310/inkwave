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
const POPOVER_H = 240

type Align = 'aligned' | 'center' | 'left'

const ALIGN_OPTIONS: { value: Align; label: string; title: string }[] = [
  { value: 'aligned', label: '=',  title: 'Align at equals (Ctrl+Q)' },
  { value: 'center',  label: '⊙', title: 'Centre (Ctrl+E)'          },
  { value: 'left',    label: '◁',  title: 'Left align (Ctrl+L)'      },
]

function renderDisplay(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const src     = applyCustomSymbols(applyShorthandsLive(latex), getSymbols())
    const wrapped = align === 'aligned' && !/\\begin\{/.test(src)
      ? `\\begin{aligned}\n${src}\n\\end{aligned}` : src
    return katex.renderToString(wrapped, { throwOnError: true, displayMode: true, output: 'htmlAndMathml' })
  } catch { return '' }
}

function renderPreview(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const wrapped = align === 'aligned' && !/\\begin\{/.test(latex)
      ? `\\begin{aligned}\n${latex}\n\\end{aligned}` : latex
    return katex.renderToString(wrapped, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [popupOpen,  setPopupOpen]  = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const [popupLatex, setPopupLatex] = useState(latex)

  const blockRef    = useRef<HTMLDivElement>(null)
  const mlContainer = useRef<HTMLDivElement>(null)
  const mfRef       = useRef<any>(null)
  const dragRef     = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    if (!active) { setLocalLatex(latex); setPopupLatex(latex) }
  }, [latex, active])

  const displayHtml = useMemo(() => renderDisplay(localLatex, align), [localLatex, align])
  const previewHtml = useMemo(() => renderPreview(popupLatex, align), [popupLatex, align])

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
        'display:block;width:100%;background:transparent;border:none;',
        'outline:none;font-size:1.1em;font-family:inherit;',
        '--caret-color:#5c2d8a;',
        '--selection-background-color:rgba(155,92,204,0.25);',
      ].join('')

      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        initCapsTracking(e as any)

        if (e.code === 'CapsLock') { capsDown(); e.preventDefault(); return }

        const greek = handleMathKey(e as any)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }

        // Enter in block math → LaTeX line break
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault(); e.stopPropagation()
          mf.executeCommand(['insert', '\\\\'])
          return
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

        // // → display fraction
        if (e.key === '/' && lastKeyWasSlash) {
          e.preventDefault()
          mf.executeCommand('undo')
          mf.executeCommand(['insert', '\\dfrac{#@}{#?}'])
          lastKeyWasSlash = false; return
        }
        lastKeyWasSlash = e.key === '/'

        // Block alignment shortcuts
        if (e.ctrlKey && !e.metaKey) {
          if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); updateAttributes({ align: 'aligned' }); return }
          if (e.key === 'e' || e.key === 'E') { e.preventDefault(); updateAttributes({ align: 'center' });  return }
          if (e.key === 'l' || e.key === 'L') { e.preventDefault(); updateAttributes({ align: 'left' });    return }
        }

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
        if (rel?.closest('[data-math-popup]') || blockRef.current?.contains(rel)) return
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
    if (!blockRef.current) return
    const rect = blockRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= POPOVER_H + 16 ? rect.bottom + 24 : rect.top - POPOVER_H - 16
    setPopoverPos({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 560 - 8)) })
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

  return (
    <NodeViewWrapper>
      <div
        ref={blockRef}
        onClick={() => { if (!active) setActive(true) }}
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

        {/* KaTeX — shown when not editing (or while MathLive loads) */}
        <div style={{ display: active && mlReady ? 'none' : 'block' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
          }}
        />

        {/* MathLive mounts here when active */}
        <div ref={mlContainer} style={{ display: active ? 'block' : 'none' }} />
      </div>

      {/* Floating popup — only via ⋯ */}
      {popupOpen && createPortal(
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
              value={popupLatex}
              rows={Math.max(2, popupLatex.split('\n').length)}
              onChange={e => {
                const v = e.target.value
                setPopupLatex(v); setLocalLatex(v)
                if (mfRef.current) mfRef.current.value = v
              }}
              onFocus={() => resetCapsTracking()}
              onKeyDown={e => {
                if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                  e.preventDefault(); commit(popupLatex); return
                }
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
