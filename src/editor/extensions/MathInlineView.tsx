import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'

const INK = '#5c2d8a'

const MATHLIVE_MACROS: Record<string, string> = {
  '\\imaginaryI':    'i',
  '\\imaginaryJ':    'j',
  '\\exponentialE':  'e',
  '\\differentialD': 'd',
  '\\doubleprime':   '\'\'',
  '\\displaylines':  '\\begin{gathered}#1\\end{gathered}',
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

export function MathInlineView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const latex: string = node.attrs.latex

  const [active,     setActive]     = useState(latex === '')
  const [localLatex, setLocalLatex] = useState(latex)
  const [mlReady,    setMlReady]    = useState(false)
  const [greekOn,    setGreekOn]    = useState(false)

  const mlContainer      = useRef<HTMLSpanElement>(null)
  const greekRef         = useRef(false)
  const pendingCursorRef = useRef<'start' | 'end'>('start')
  const arrowDirRef      = useRef<'start' | 'end'>('start')

  useEffect(() => {
    if (!active) { setLocalLatex(latex) }
  }, [latex, active])

  // Track which arrow direction navigated onto this node so we can place the cursor correctly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') arrowDirRef.current = 'start'
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   arrowDirRef.current = 'end'
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // Activate immediately when ProseMirror arrow-navigates onto this node (creates NodeSelection)
  useEffect(() => {
    if (selected && !active) {
      pendingCursorRef.current = arrowDirRef.current
      setActive(true)
    }
  }, [selected, active])

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
    // Place cursor just after this node as a text selection so ProseMirror doesn't
    // restore a NodeSelection (which would re-trigger selected→active and reopen the box)
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos != null) {
      editor.chain().focus().setTextSelection(pos + node.nodeSize).run()
    } else {
      editor.commands.focus()
    }
  }, [updateAttributes, editor, getPos, node])

  // ── Mount / unmount MathLive on activation ────────────────────────────────
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
        'display:inline-block;background:transparent;border:none;',
        'outline:none;font-size:inherit;font-family:inherit;',
        'position:absolute;top:50%;transform:translateY(-50%);',
        '--caret-color:#5c2d8a;',
        '--selection-background-color:rgba(155,92,204,0.25);',
      ].join('')

      mf.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.code === 'CapsLock') {
          e.preventDefault(); greekRef.current = true; setGreekOn(true); return
        }

        const greek = handleMathKey(e as any, greekRef.current)
        if (greek) { e.preventDefault(); mf.executeCommand(['insert', greek]); return }

        // " toggles text / math mode (we own this key; MathLive's binding is removed above)
        if (e.key === '"') {
          e.preventDefault(); e.stopImmediatePropagation()
          mf.executeCommand(['switchMode', mf.mode === 'text' ? 'math' : 'text']); return
        }

        if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation()
          if (mf.mode === 'text') { mf.executeCommand(['switchMode', 'math']); return }
          commit(mf.value); return
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value); return
        }

        // Space: 1st = MathLive native (commits shortcuts like pi→π)
        //        2nd+ = insert thin space \, (visible gap in math mode)
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

        // / types normally; // → \frac
        if (e.key === '/') {
          if (lastKeyWasSlash) {
            e.preventDefault()
            mf.executeCommand(['deleteBackward'])
            mf.executeCommand(['insert', '\\frac{#@}{#?}'])
            lastKeyWasSlash = false; return
          }
          lastKeyWasSlash = true
        } else {
          lastKeyWasSlash = false
        }

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
        if (e.code === 'CapsLock') { greekRef.current = false; setGreekOn(false) }
      }, { capture: true })

      mf.addEventListener('input', () => setLocalLatex(mf.value))

      mf.addEventListener('blur', (e: FocusEvent) => {
        const rel = (e as any).relatedTarget as Element | null
        if (rel?.closest('[data-math-inline-box]')) return
        if (!cancelled) commit(mf.value)
      })

      mlContainer.current.appendChild(mf)
      // Must be after appendChild — setting keybindings before DOM connection crashes the element
      if (Array.isArray(mf.keybindings)) {
        mf.keybindings = mf.keybindings.filter((kb: any) => kb.key !== '"')
      }
      setMlReady(true)
      requestAnimationFrame(() => {
        if (!cancelled) {
          mf.focus()
          mf.executeCommand([pendingCursorRef.current === 'end' ? 'moveToMathfieldEnd' : 'moveToMathfieldStart'])
        }
      })
    })

    return () => {
      cancelled = true
      if (mlContainer.current) mlContainer.current.innerHTML = ''
      setMlReady(false)
    }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        data-math-inline-box=""
        onClick={e => {
          // Position cursor at the start/end based on which half of the box was clicked
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          pendingCursorRef.current = (e.clientX - rect.left) > rect.width / 2 ? 'end' : 'start'
          if (!active) setActive(true)
        }}
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
        {/* KaTeX — always in layout via visibility:hidden so the box doesn't shift when MathLive mounts.
            padding:2px 0 matches MathLive's own padding so both occupy the same grid-cell height. */}
        <span
          style={{
            gridArea: '1/1',
            padding: '2px 0',
            visibility: active && mlReady ? 'hidden' : 'visible',
            pointerEvents: active && mlReady ? 'none' : 'auto',
          }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || '<em style="opacity:0.4;font-size:0.85em">math</em>',
          }}
        />

        {/* MathLive mounts here when active.
            height:0 + overflow:visible: container contributes nothing to the grid row height
            (so the row stays at the KaTeX holder's height and surrounding text never reflows).
            The math-field is position:absolute with top:50%+translateY(-50%) to center it
            on the same midline as the KaTeX content. */}
        <span ref={mlContainer} style={{ gridArea: '1/1', display: active ? 'block' : 'none', height: 0, overflow: 'visible', position: 'relative' }} />

        {greekOn && (
          <span style={{ position: 'absolute', top: '-0.75rem', right: '0.1rem', fontSize: '0.55rem', color: INK, fontFamily: 'ui-monospace,monospace', opacity: 0.8 }}>Gk</span>
        )}
      </span>
    </NodeViewWrapper>
  )
}
