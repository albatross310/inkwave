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
  // 'before': exit left/up → cursor before the node; 'after': exit right/down/Tab → cursor after
  const exitDirRef       = useRef<'before' | 'after'>('after')
  // Set to true only when an arrow key fired immediately before a NodeSelection is created —
  // used to distinguish keyboard navigation (should auto-enter) from mouse clicks near the
  // node (which ProseMirror may also turn into a NodeSelection, but shouldn't auto-enter).
  const keyboardNavRef   = useRef(false)
  // Saved click coords from KaTeX mode, replayed into MathLive's shadow DOM on mount.
  const pendingClickRef  = useRef<{ clientX: number; clientY: number } | null>(null)

  useEffect(() => {
    if (!active) { setLocalLatex(latex) }
  }, [latex, active])

  // Track arrow direction and flag keyboard navigation for the selected→active guard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { arrowDirRef.current = 'start'; keyboardNavRef.current = true }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { arrowDirRef.current = 'end';   keyboardNavRef.current = true }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // Only auto-enter when ProseMirror creates the NodeSelection via arrow-key navigation.
  // Mouse clicks on or near the node also create NodeSelections but should NOT auto-enter
  // (those are handled by onClick; clicks below/above the box otherwise reopen it).
  useEffect(() => {
    if (selected && !active && keyboardNavRef.current) {
      keyboardNavRef.current = false
      pendingCursorRef.current = arrowDirRef.current
      setActive(true)
    }
    if (!selected) keyboardNavRef.current = false
  }, [selected, active])

  const displayHtml = useMemo(() => renderFull(localLatex), [localLatex])

  // overrideCursor=true: keyboard exit (Esc/Enter) — place cursor after this node.
  // overrideCursor=false: blur from clicking elsewhere — let ProseMirror keep the
  //   click-positioned selection so the user's cursor lands where they clicked.
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
      const dir = exitDirRef.current
      exitDirRef.current = 'after'
      if (pos != null) {
        const target = dir === 'before' ? pos : pos + node.nodeSize
        editor.chain().focus().setTextSelection(target).run()
      } else {
        editor.commands.focus()
      }
    } else {
      // Blur from clicking elsewhere — the click already transferred focus naturally.
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
        // font-size 1.0em → matches the outer box's 0.826em scaling (same as KaTeX).
        // At 1.21em, the formula was 21% larger than KaTeX, causing a 16px width overflow on fractions.
        'display:inline-block;width:max-content;background:transparent;border:none;',
        'outline:none;font-size:1.0em;font-family:KaTeX_Math,KaTeX_Main,inherit;',
        'position:absolute;top:50%;left:0;transform:translateY(-50%);',
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
          commit(mf.value, true); return
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation(); commit(mf.value, true); return
        }
        if (e.key === 'Tab') {
          e.preventDefault(); e.stopImmediatePropagation()
          exitDirRef.current = e.shiftKey ? 'before' : 'after'
          commit(mf.value, true); return
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
        if (!cancelled) commit(mf.value, false)
      })

      // Arrow keys that try to leave the math field
      mf.addEventListener('move-out', (e: any) => {
        if (cancelled) return
        const dir: string = e.detail?.direction ?? 'forward'
        const isUp = dir === 'upward', isDown = dir === 'downward'
        exitDirRef.current = (dir === 'backward' || isUp) ? 'before' : 'after'
        commit(mf.value, true)
        // Up/Down: after exiting, also move one visual line in ProseMirror
        if (isUp || isDown) {
          const key = isUp ? 'ArrowUp' : 'ArrowDown'
          requestAnimationFrame(() => requestAnimationFrame(() => {
            editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
          }))
        }
      })

      mlContainer.current.appendChild(mf)
      // Must be after appendChild — setting keybindings before DOM connection crashes the element
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
            // Use MathLive's own coordinate→offset API. The saved KaTeX click coords map
            // well since both renderers share the same midline (absolute + translateY(-50%)).
            const offset: number = mf.getOffsetFromPoint(click.clientX, click.clientY)
            if (offset >= 0) { mf.position = offset; return }
          }
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
        onMouseDown={e => {
          // When already active, prevent the browser from moving focus away from the
          // math-field when the user clicks in the padding area. Without this, the
          // click blurs MathLive → commits → onClick re-activates → oscillation.
          if (active) e.preventDefault()
        }}
        onClick={e => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const xRatio = (e.clientX - rect.left) / rect.width
          pendingCursorRef.current = xRatio > 0.5 ? 'end' : 'start'
          if (!active) {
            pendingClickRef.current = { clientX: e.clientX, clientY: e.clientY }
            setActive(true)
          }
        }}
        style={{
          display: 'inline-grid', alignItems: 'center',
          position: 'relative',
          padding: '2px 4px 2px 6px', borderRadius: '5px',
          verticalAlign: 'baseline', cursor: 'text',
          fontSize: '0.826em',
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
