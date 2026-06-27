import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'

const INK = '#5c2d8a'

// MathLive stores some commands KaTeX doesn't know — map them so the fallback never goes blank
const MATHLIVE_MACROS: Record<string, string> = {
  '\\imaginaryI':    'i',
  '\\imaginaryJ':    'j',
  '\\exponentialE':  'e',
  '\\differentialD': 'd',
  '\\doubleprime':   '\'\'',
}

function renderFull(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyCustomSymbols(applyShorthandsLive(src), getSymbols()),
      { throwOnError: false, displayMode: false, output: 'htmlAndMathml', macros: MATHLIVE_MACROS },
    )
  } catch { return '' }
}

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [greekOn,    setGreekOn]    = useState(false)

  const mlContainer = useRef<HTMLSpanElement>(null)
  const mfRef       = useRef<any>(null)
  const greekRef    = useRef(false)
  // track if we mounted with active=true (new empty node) so we can focus once ready
  const startActiveRef = useRef(latex === '')

  // KaTeX fallback — only used while MathLive hasn't loaded yet
  const displayHtml = useMemo(() => renderFull(localLatex), [localLatex])

  // When latex prop changes externally (not while we're editing), push it into MathLive
  useEffect(() => {
    if (active) return
    setLocalLatex(latex)
    if (mfRef.current) mfRef.current.value = latex
  }, [latex, active])

  const commit = useCallback((src: string) => {
    greekRef.current = false; setGreekOn(false)
    const def = parseDefinition(src.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      if (mfRef.current) { mfRef.current.value = ''; mfRef.current.readOnly = true }
      setLocalLatex(''); setActive(false)
      editor.commands.focus(); return
    }
    const processed = applyShorthands(src)
    updateAttributes({ latex: processed })
    setLocalLatex(processed)
    if (mfRef.current) { mfRef.current.value = processed; mfRef.current.readOnly = true }
    setActive(false)
    editor.commands.focus()
  }, [updateAttributes, editor])

  // ── Mount MathLive ONCE and keep it mounted (toggling readOnly instead of unmounting) ──
  // This eliminates the KaTeX→MathLive visual shift on click because the same renderer
  // is used for both display and edit modes.
  useEffect(() => {
    if (!mlContainer.current) return

    let cancelled = false
    let lastKeyWasSlash = false
    let spaceCount = 0

    loadMathLive().then(() => {
      if (cancelled || !mlContainer.current) return

      const mf = document.createElement('math-field') as any
      mf.value = localLatex
      mf.readOnly = !startActiveRef.current  // editable only if new empty node
      mf.mathVirtualKeyboardPolicy = 'manual'
      mf.menuItems = []  // hide built-in menu toggle (it shifts math left)
      mf.style.cssText = [
        'display:inline;background:transparent;border:none;',
        'outline:none;font-size:inherit;font-family:inherit;',
        '--caret-color:#5c2d8a;',
        '--selection-background-color:rgba(155,92,204,0.25);',
      ].join('')

      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        if (mf.readOnly) return  // don't intercept in display mode

        // CapsLock hold → Greek mode while held; e.preventDefault() stops OS toggle
        if (e.code === 'CapsLock') {
          e.preventDefault()
          greekRef.current = true
          setGreekOn(true)
          return
        }

        const greek = handleMathKey(e as any, greekRef.current)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        // Escape: exit text mode first, then commit
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation()
          if (mf.mode === 'text') { mf.executeCommand(['switchMode', 'math']); return }
          commit(mf.value); return
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }

        // " exits text mode; stopImmediatePropagation prevents shadow-DOM re-toggle
        if (e.key === '"' && mf.mode === 'text') {
          e.preventDefault(); e.stopImmediatePropagation()
          mf.executeCommand(['switchMode', 'math'])
          return
        }

        // Space: 1st = MathLive native (commits shortcuts like pi→π)
        //        2nd = text space (\ ); 3rd = second text space; etc.
        if (e.key === ' ' && mf.mode === 'math') {
          spaceCount++
          if (spaceCount > 1) {
            e.preventDefault(); e.stopImmediatePropagation()
            mf.executeCommand(['insert', '\\ '])
            return
          }
        } else if (e.key !== ' ') {
          spaceCount = 0
        }

        // Backtick — small caps
        if (e.code === 'Backquote' && !e.shiftKey) {
          e.preventDefault()
          if (mf.mode === 'text') mf.executeCommand(['insert', '\\textsc{#?}'])
          else                    mf.executeCommand(['insert', '\\text{\\textsc{#?}}'])
          return
        }

        // / types normally; // → \frac
        if (e.key === '/') {
          if (lastKeyWasSlash) {
            e.preventDefault()
            mf.executeCommand(['deleteBackward'])
            mf.executeCommand(['insert', '\\frac{#@}{#?}'])
            lastKeyWasSlash = false
            return
          }
          lastKeyWasSlash = true
        } else {
          lastKeyWasSlash = false
        }

        // Ctrl+C → copy raw LaTeX with HTML marker so paste recreates a math node
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          e.preventDefault()
          const v = mf.value
          const html = `<span data-inkwave-math="inline" data-latex="${encodeURIComponent(v)}">${v}</span>`
          navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([v], { type: 'text/plain' }),
            'text/html':  new Blob([html], { type: 'text/html' }),
          })]).catch(() => navigator.clipboard.writeText(v).catch(() => {}))
          return
        }

        if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation()
      }, { capture: true })

      mf.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.code === 'CapsLock') { greekRef.current = false; setGreekOn(false); return }
        // " exit fallback: if shadow DOM still inserted " and left us in text mode, clean up
        if (e.key === '"' && mf.mode === 'text') {
          mf.executeCommand(['deleteBackward'])
          mf.executeCommand(['switchMode', 'math'])
        }
      }, { capture: true })

      mf.addEventListener('input', () => setLocalLatex(mf.value))

      mf.addEventListener('blur', (e: FocusEvent) => {
        if (mf.readOnly) return
        const rel = (e as any).relatedTarget as Element | null
        if (rel?.closest('[data-math-inline-box]')) return
        if (!cancelled) commit(mf.value)
      })

      mlContainer.current.appendChild(mf)
      mfRef.current = mf
      setMlReady(true)

      if (startActiveRef.current) {
        requestAnimationFrame(() => { if (!cancelled) mf.focus() })
      }
    })

    return () => {
      cancelled = true
      if (mfRef.current && mlContainer.current?.contains(mfRef.current)) {
        mlContainer.current.removeChild(mfRef.current)
      }
      mfRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle readOnly when active state changes (after MathLive is mounted)
  useEffect(() => {
    if (!mfRef.current) return
    if (active) {
      mfRef.current.readOnly = false
      requestAnimationFrame(() => mfRef.current?.focus())
    } else {
      mfRef.current.readOnly = true
    }
  }, [active])

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        data-math-inline-box=""
        onClick={() => { if (!active) setActive(true) }}
        style={{
          display: 'inline-grid', alignItems: 'center',
          position: 'relative',
          padding: '2px 4px 2px 6px', borderRadius: '5px',
          verticalAlign: 'middle', cursor: 'text',
          transition: 'background 0.1s, border-color 0.1s',
          background: active ? 'rgba(155,92,204,0.08)' : selected ? 'rgba(155,92,204,0.10)' : 'rgba(155,92,204,0.04)',
          border: `1px solid ${active ? INK + '66' : 'rgba(155,92,204,0.22)'}`,
        }}
      >
        {/* KaTeX fallback — only visible while MathLive bundle is loading */}
        {!mlReady && (
          <span
            style={{ gridArea: '1/1' }}
            dangerouslySetInnerHTML={{
              __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
            }}
          />
        )}

        {/* MathLive — mounted once; readOnly toggles between display and edit */}
        <span ref={mlContainer} style={{ gridArea: '1/1', display: 'inline' }} />

        {greekOn && (
          <span style={{ position: 'absolute', top: '-0.75rem', right: '0.1rem', fontSize: '0.55rem', color: INK, fontFamily: 'ui-monospace,monospace', opacity: 0.8 }}>Gk</span>
        )}
      </span>
    </NodeViewWrapper>
  )
}
