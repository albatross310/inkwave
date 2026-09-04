import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'
import { pendingMathEdit } from './mathActivation'

const INK = '#302438'

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

  // Open in edit mode only when the writer JUST inserted this node (menu / Alt+=) —
  // not merely because latex is empty: an empty node arriving by doc load / undo /
  // sync used to mount active and steal focus from the page.
  const [active,     setActive]     = useState(() => pendingMathEdit())
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
      // default-mode='inline-math' (set BEFORE value) forces TEXTSTYLE rendering — limits
      // sit beside big operators (∑ ∫ lim) exactly as KaTeX inline does, instead of the
      // displaystyle limits-above/below that ballooned the field height 2–3×. Must precede
      // `value`; defaultMode only governs how the (initially empty) field renders its content.
      mf.setAttribute('default-mode', 'inline-math')
      mf.value = localLatex
      mf.mathVirtualKeyboardPolicy = 'manual'
      mf.style.cssText = [
        // font-size 1.21em matches KaTeX's intrinsic 1.21em self-scaling (KaTeX renders at
        // 1.21em of the 0.826em box = 1.0em of the document base, i.e. body-text size). With
        // inline-math mode the two engines now share textstyle metrics, so 1.21em gives
        // pixel-exact width on the common cases (x, x², a/b, √) — vs the old 1.0em which
        // rendered every formula at 0.826× and visibly shrank on click. The prior "1.21em
        // overflowed fractions" note predates the visibility:hidden grid box-sizing (the box
        // is now driven by the hidden KaTeX holder, so a wider field cannot reflow the line).
        'display:inline-block;width:max-content;background:transparent;border:none;',
        'outline:none;font-size:1.21em;font-family:KaTeX_Math,KaTeX_Main,inherit;',
        // left:-1px + translateY(-50% - 1px) zero out the constant residual offsets measured
        // between MathLive's .ML__base and KaTeX's glyph box (ML sits ~1px right / ~1px low).
        'position:absolute;top:50%;left:-1px;transform:translateY(calc(-50% - 1px));',
        '--caret-color:#302438;',
        '--selection-background-color:rgba(72, 73, 101, 0.25);',
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
          requestAnimationFrame(() => {
            if (!cancelled) {
              const click = pendingClickRef.current
              pendingClickRef.current = null
              if (click) {
                const mfRect = mf.getBoundingClientRect()
                let tx = click.clientX
                let bias: -1 | 0 | 1 = 0
                if (click.clientX < mfRect.left)       { tx = mfRect.left  + 2; bias = -1 }
                else if (click.clientX > mfRect.right) { tx = mfRect.right - 2; bias =  1 }
                const ty = Math.max(mfRect.top + 1, Math.min(mfRect.bottom - 1, click.clientY))
                const offset: number = mf.getOffsetFromPoint(tx, ty, { bias })
                if (offset >= 0) { mf.position = offset; return }
              }
              mf.executeCommand([pendingCursorRef.current === 'end' ? 'moveToMathfieldEnd' : 'moveToMathfieldStart'])
            }
          })
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
          // always prevent so the math-field keeps focus while active, and ProseMirror
          // doesn't steal it when the formula is inactive.
          e.preventDefault()
          if (!active) {
            const box = e.currentTarget as HTMLElement
            // Edge bands: the pill's padding extends the hit box a few px past the
            // rendered formula, so a click aimed "just beside the math" lands ON the
            // node and used to reopen the equation instead of placing the text caret.
            // Route padding-band clicks to a caret beside the node (same intent as the
            // CitationNodeView margin fix — the pill keeps its padding for looks, so
            // the split is done by coordinates against the KaTeX content box).
            const content = (box.firstElementChild as HTMLElement | null)?.getBoundingClientRect()
            if (content && typeof getPos === 'function') {
              const side = e.clientX > content.right ? 'after' : e.clientX < content.left ? 'before' : null
              if (side) {
                const pos = getPos()
                if (pos != null) {
                  editor.chain().focus().setTextSelection(side === 'after' ? pos + node.nodeSize : pos).run()
                  return
                }
              }
            }
            const rect = box.getBoundingClientRect()
            const xRatio = (e.clientX - rect.left) / rect.width
            pendingCursorRef.current = xRatio > 0.5 ? 'end' : 'start'
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
          background: active ? 'rgba(72, 73, 101, 0.08)' : selected ? 'rgba(72, 73, 101, 0.10)' : 'rgba(72, 73, 101, 0.04)',
          border: `1px solid ${active ? INK + '66' : 'rgba(72, 73, 101, 0.22)'}`,
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
