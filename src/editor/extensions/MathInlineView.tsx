import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'

const INK = '#5c2d8a'

function renderFull(src: string): string {
  if (!src.trim()) return ''
  try {
    return katex.renderToString(
      applyCustomSymbols(applyShorthandsLive(src), getSymbols()),
      { throwOnError: true, displayMode: false, output: 'htmlAndMathml' },
    )
  } catch { return '' }
}

export function MathInlineView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [greekOn,    setGreekOn]    = useState(false)  // CapsLock toggle indicator

  const mlContainer = useRef<HTMLSpanElement>(null)
  const mfRef       = useRef<any>(null)
  const greekRef    = useRef(false)  // for use inside keydown closure

  useEffect(() => {
    if (!active) setLocalLatex(latex)
  }, [latex, active])

  const displayHtml = useMemo(() => renderFull(localLatex), [localLatex])

  const commit = useCallback((src: string) => {
    greekRef.current = false; setGreekOn(false)
    const def = parseDefinition(src.trim())
    if (def) {
      setSymbol(def.key, def.latex)
      setLocalLatex(''); setActive(false); setMlReady(false)
      editor.commands.focus(); return
    }
    const processed = applyShorthands(src)
    updateAttributes({ latex: processed })
    setLocalLatex(processed); setActive(false); setMlReady(false)
    editor.commands.focus()
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
        // CapsLock: tap to toggle Greek mode — e.preventDefault() keeps OS state unchanged
        if (e.code === 'CapsLock') {
          e.preventDefault()
          greekRef.current = !greekRef.current
          setGreekOn(greekRef.current)
          return
        }

        // Greek mode: letter keys → Greek characters
        const greek = handleMathKey(e as any, greekRef.current)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        // Escape / Enter → commit
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }

        // Tab — toggle text mode (switchMode is cleaner than inserting \text{#?})
        if (e.code === 'Tab') {
          e.preventDefault(); e.stopPropagation()
          mf.executeCommand(['switchMode', mf.mode === 'text' ? 'math' : 'text'])
          return
        }

        // Backtick — small caps (insert \textsc{} in text mode or wrap)
        if (e.code === 'Backquote' && !e.shiftKey) {
          e.preventDefault()
          if (mf.mode === 'text') mf.executeCommand(['insert', '\\textsc{#?}'])
          else                    mf.executeCommand(['insert', '\\text{\\textsc{#?}}'])
          return
        }

        // / → \tfrac (inline/text-style fraction that stays small)
        // // → \frac (regular fraction; adapts to context)
        if (e.key === '/') {
          e.preventDefault()
          if (lastKeyWasSlash) {
            mf.executeCommand('undo')  // undo the \tfrac from first /
            mf.executeCommand(['insert', '\\frac{#@}{#?}'])
            lastKeyWasSlash = false
          } else {
            mf.executeCommand(['insert', '\\tfrac{#@}{#?}'])
            lastKeyWasSlash = true
          }
          return
        }
        lastKeyWasSlash = false

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

      mf.addEventListener('input', () => setLocalLatex(mf.value))

      mf.addEventListener('blur', (e: FocusEvent) => {
        const rel = (e as any).relatedTarget as Element | null
        if (rel?.closest('[data-math-inline-box]')) return
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

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        data-math-inline-box=""
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 4px 2px 6px', borderRadius: '5px',
          verticalAlign: 'middle', cursor: 'text',
          transition: 'background 0.1s, border-color 0.1s',
          background: active ? 'rgba(155,92,204,0.08)' : selected ? 'rgba(155,92,204,0.10)' : 'rgba(155,92,204,0.04)',
          border: `1px solid ${active ? INK + '66' : 'rgba(155,92,204,0.22)'}`,
        }}
      >
        {/* KaTeX — shown until MathLive is ready */}
        <span
          onClick={() => setActive(true)}
          style={{ display: active && mlReady ? 'none' : 'inline' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
          }}
        />

        {/* MathLive mounts here when active */}
        <span ref={mlContainer} style={{ display: active ? 'inline' : 'none' }} />

        {/* Greek mode indicator */}
        {greekOn && (
          <span style={{ fontSize: '0.6rem', color: INK, fontFamily: 'ui-monospace,monospace', padding: '0 0 0 4px', opacity: 0.7 }}>Gk</span>
        )}
      </span>
    </NodeViewWrapper>
  )
}
