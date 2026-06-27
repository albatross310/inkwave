import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'

const INK = '#5c2d8a'

type Align = 'aligned' | 'center' | 'left'

const MATHLIVE_MACROS: Record<string, string> = {
  '\\imaginaryI':    'i',
  '\\imaginaryJ':    'j',
  '\\exponentialE':  'e',
  '\\differentialD': 'd',
  '\\doubleprime':   '\'\'',
  // MathLive stores multi-line equations as \displaylines{...}; KaTeX needs gathered
  '\\displaylines':  '\\begin{gathered}#1\\end{gathered}',
}

function renderDisplay(latex: string, align: Align): string {
  if (!latex.trim()) return ''
  try {
    const src = applyCustomSymbols(applyShorthandsLive(latex), getSymbols())
    const wrapped = align === 'aligned' && !/\\begin\{/.test(src)
      ? `\\begin{aligned}\n${src}\n\\end{aligned}` : src
    return katex.renderToString(wrapped, { throwOnError: false, displayMode: true, output: 'htmlAndMathml', macros: MATHLIVE_MACROS })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [greekOn,    setGreekOn]    = useState(false)

  const blockRef         = useRef<HTMLDivElement>(null)
  const mlContainer      = useRef<HTMLDivElement>(null)
  const mfRef            = useRef<any>(null)
  const greekRef         = useRef(false)
  const pendingCursorRef = useRef<'start' | 'end'>('start')
  const pendingClickRef  = useRef<{ clientX: number; clientY: number } | null>(null)
  const arrowDirRef      = useRef<'start' | 'end'>('start')
  const keyboardNavRef   = useRef(false)

  useEffect(() => {
    if (!active) setLocalLatex(latex)
  }, [latex, active])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { arrowDirRef.current = 'start'; keyboardNavRef.current = true }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { arrowDirRef.current = 'end';   keyboardNavRef.current = true }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (selected && !active && keyboardNavRef.current) {
      keyboardNavRef.current = false
      pendingCursorRef.current = arrowDirRef.current
      setActive(true)
    }
    if (!selected) keyboardNavRef.current = false
  }, [selected, active])

  const displayHtml = useMemo(() => renderDisplay(localLatex, align), [localLatex, align])

  const commit = useCallback((src: string, overrideCursor = true) => {
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
    if (overrideCursor) {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos != null) {
        editor.chain().focus().setTextSelection(pos + node.nodeSize).run()
      } else {
        editor.commands.focus()
      }
    } else {
      // Blur from clicking elsewhere — let the click transfer focus naturally.
    }
  }, [updateAttributes, editor, getPos, node])

  // ── Mount / unmount MathLive ───────────────────────────────────────────────
  useEffect(() => {
    if (!active) { setMlReady(false); return }
    if (!mlContainer.current) return

    let cancelled = false
    let lastKeyWasSlash = false
    let spaceCount = 0

    loadMathLive().then(() => {
      if (cancelled || !mlContainer.current) return

      const mf = document.createElement('math-field') as any
      mf.value = localLatex
      mf.mathVirtualKeyboardPolicy = 'manual'
      mf.style.cssText = [
        // width:max-content prevents the host expanding to fill the flex container
        // so justify-content:center actually centres it.
        'display:inline-block;width:max-content;background:transparent;border:none;',
        'outline:none;font-size:1.1em;font-family:inherit;',
        '--caret-color:#5c2d8a;',
        '--selection-background-color:rgba(155,92,204,0.25);',
      ].join('')

      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        // CapsLock hold → Greek mode while held; e.preventDefault() stops OS toggle
        if (e.code === 'CapsLock') {
          e.preventDefault()
          greekRef.current = true
          setGreekOn(true)
          return
        }

        const greek = handleMathKey(e as any, greekRef.current)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        if (e.key === '"') {
          e.preventDefault(); e.stopImmediatePropagation()
          mf.executeCommand(['switchMode', mf.mode === 'text' ? 'math' : 'text']); return
        }

        if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation()
          if (mf.mode === 'text') { mf.executeCommand(['switchMode', 'math']); return }
          commit(mf.value, true); return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value, true); return
        }

        // Enter in block math → LaTeX line break
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault(); e.stopPropagation()
          mf.executeCommand(['insert', '\\\\'])
          return
        }

        // Space: 1st = MathLive native; 2nd+ = thin space \,
        if (e.key === ' ') {
          spaceCount++
          if (spaceCount > 1) {
            e.preventDefault(); e.stopImmediatePropagation()
            mf.executeCommand(['insert', '\\,']); return
          }
        } else {
          spaceCount = 0
        }

        // Backtick — small caps
        if (e.code === 'Backquote' && !e.shiftKey) {
          e.preventDefault()
          if (mf.mode === 'text') mf.executeCommand(['insert', '\\textsc{#?}'])
          else                    mf.executeCommand(['insert', '\\text{\\textsc{#?}}'])
          return
        }

        // / types normally; // converts to \frac
        if (e.key === '/') {
          if (lastKeyWasSlash) {
            e.preventDefault()
            mf.executeCommand(['deleteBackward'])  // remove the literal /
            mf.executeCommand(['insert', '\\frac{#@}{#?}'])
            lastKeyWasSlash = false
            return
          }
          lastKeyWasSlash = true
          // fall through — first / types as a literal slash
        } else {
          lastKeyWasSlash = false
        }

        // Block alignment shortcuts
        if (e.ctrlKey && !e.metaKey) {
          if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); updateAttributes({ align: 'aligned' }); return }
          if (e.key === 'e' || e.key === 'E') { e.preventDefault(); updateAttributes({ align: 'center' });  return }
          if (e.key === 'l' || e.key === 'L') { e.preventDefault(); updateAttributes({ align: 'left' });    return }
        }

        // Ctrl+C → copy raw LaTeX with HTML marker
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          e.preventDefault()
          const v = mf.value
          const html = `<div data-inkwave-math="block" data-latex="${encodeURIComponent(v)}">${v}</div>`
          navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([v], { type: 'text/plain' }),
            'text/html':  new Blob([html], { type: 'text/html' }),
          })]).catch(() => navigator.clipboard.writeText(v).catch(() => {}))
          return
        }

        if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation()
      }, { capture: true })

      mf.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.code === 'CapsLock') { greekRef.current = false; setGreekOn(false) }
      }, { capture: true })

      mf.addEventListener('input', () => setLocalLatex(mf.value))

      mf.addEventListener('blur', (e: FocusEvent) => {
        const rel = (e as any).relatedTarget as Element | null
        if (blockRef.current?.contains(rel)) return
        if (!cancelled) commit(mf.value, false)
      })

      mlContainer.current.appendChild(mf)
      mfRef.current = mf
      if (Array.isArray(mf.keybindings)) {
        mf.keybindings = mf.keybindings.filter((kb: any) => kb.key !== '"')
      }
      // Remove 2-letter shortcuts that conflict with common variable products (s·h, c·h, t·h…)
      const REMOVE_SHORTCUTS = ['sh', 'ch', 'th', 'tg', 'cth', 'ctg', 'cotg', 'lb', 'sech']
      const sc = { ...mf.inlineShortcuts }
      REMOVE_SHORTCUTS.forEach(k => delete sc[k])
      mf.inlineShortcuts = sc
      setMlReady(true)
      requestAnimationFrame(() => {
        if (!cancelled) {
          mf.focus()
          const click = pendingClickRef.current
          pendingClickRef.current = null
          if (click) {
            const offset: number = mf.getOffsetFromPoint(click.clientX, click.clientY)
            if (offset >= 0) { mf.position = offset; return }
          }
          mf.executeCommand([pendingCursorRef.current === 'end' ? 'moveToMathfieldEnd' : 'moveToMathfieldStart'])
        }
      })
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
    <NodeViewWrapper>
      {/* Block — invisible when not in use; just the placeholder text */}
      <div
        ref={blockRef}
        onMouseDown={e => {
          if (active) e.preventDefault()
        }}
        onClick={e => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          pendingCursorRef.current = (e.clientX - rect.left) > rect.width / 2 ? 'end' : 'start'
          if (!active) {
            pendingClickRef.current = { clientX: e.clientX, clientY: e.clientY }
            setActive(true)
          }
        }}
        style={{
          margin: '0.5em 0', padding: '0.4em 0.5em',
          position: 'relative', cursor: 'text',
          textAlign: align === 'left' ? 'left' : 'center',
          minHeight: '1.8em',
          // Only show border/background when active or selected
          border: `1px solid ${active || selected ? `${INK}55` : 'transparent'}`,
          borderRadius: '6px',
          background: active || selected ? 'rgba(155,92,204,0.03)' : 'transparent',
          transition: 'border-color 0.12s, background 0.12s',
        }}
      >
        {/* KaTeX — shown when not editing */}
        <div style={{ display: active && mlReady ? 'none' : 'block' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
          }}
        />

        {/* MathLive mounts here when active — flex centres the math-field regardless of its display type;
            margin matches .katex-display { margin: 1em 0 } so there's no vertical shift on activation */}
        <div ref={mlContainer} style={{
          display: active ? 'flex' : 'none',
          justifyContent: align === 'left' ? 'flex-start' : 'center',
          margin: '1em 0',
        }} />

        {/* Greek mode indicator */}
        {greekOn && (
          <span style={{ position: 'absolute', bottom: '0.2rem', right: '0.4rem', fontSize: '0.6rem', color: INK, fontFamily: 'ui-monospace,monospace', opacity: 0.7 }}>Gk</span>
        )}
      </div>
    </NodeViewWrapper>
  )
}
