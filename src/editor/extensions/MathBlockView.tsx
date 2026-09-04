import 'katex/dist/katex.min.css'
import katex from 'katex'
import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { handleMathKey, applyShorthands, applyShorthandsLive } from './mathUtils'
import { parseDefinition, setSymbol, getSymbols, applyCustomSymbols } from './mathSymbols'
import { loadMathLive } from './mathLiveLoader'
import { pendingMathEdit } from './mathActivation'

const INK = '#35283e'

type Align = 'aligned' | 'center' | 'left'

// Snap the click to the center of the nearest KaTeX leaf glyph so that
// getOffsetFromPoint maps clicks inside the formula to the right character.
// Without this, clicks on wide atoms (fractions, large operators) map poorly
// because MathLive's geometry doesn't perfectly match KaTeX's glyph box.
function nearestKaTeXCenter(
  container: HTMLElement | null,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const root = container?.querySelector('.katex-html')
  if (!root) return null
  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const span of (root as Element).querySelectorAll('span')) {
    if (span.querySelector('span')) continue  // skip non-leaf containers
    const r = span.getBoundingClientRect()
    if (r.width < 0.5) continue
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2
    const dist = (cx - sx) ** 2 + (cy - sy) ** 2
    if (dist < bestDist) { bestDist = dist; best = { x: sx, y: sy } }
  }
  return best
}

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
    // Strip trailing \\ — MathLive shows an empty last row for it, KaTeX suppresses it.
    const cleaned = src.replace(/\s*\\\\\s*$/, '')

    // MathLive stores multi-line content as \displaylines{...}; unwrap it so we can
    // re-wrap with the correct environment for each alignment mode.
    const dlMatch = /^\\displaylines\{([\s\S]*)\}$/.exec(cleaned)
    const content = dlMatch ? dlMatch[1] : cleaned

    let wrapped: string
    if (/\\begin\{/.test(cleaned)) {
      // Already has an explicit environment — honour it as-is.
      wrapped = cleaned
    } else if (align === 'center') {
      // Pass through: the \displaylines macro expands to \begin{gathered} in KaTeX
      // (so multi-line MathLive equations render centered), and .katex-display
      // { text-align:center } handles single-line. Don't unwrap \displaylines here.
      wrapped = cleaned
    } else if (align === 'aligned') {
      // Unwrap \displaylines if present, then insert & before the first bare = on each
      // line so KaTeX column-aligns at the equals sign.
      // Negative lookbehind guards: skip <=, >=, !=, :=, \\-prefixed.
      const autoAligned = content.split(/\\\\/).map(line =>
        line.includes('&') ? line : line.replace(/(?<![<>!:\\])=(?!=)/, '&=')
      ).join('\\\\')
      wrapped = `\\begin{aligned}\n${autoAligned}\n\\end{aligned}`
    } else {
      // left: \begin{array}{l} creates a flush-left column; KaTeX centers the array
      // block on the page via .katex-display { text-align:center }.
      wrapped = `\\begin{array}{l}\n${content}\n\\end{array}`
    }

    return katex.renderToString(wrapped, { throwOnError: false, displayMode: true, output: 'htmlAndMathml', macros: MATHLIVE_MACROS })
  } catch { return '' }
}

export function MathBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const latex: string = node.attrs.latex
  const align: Align  = node.attrs.align ?? 'aligned'

  // Open in edit mode only when the writer JUST inserted this node (menu / Alt+⇧+=) —
  // not merely because latex is empty (doc load / undo / sync used to steal focus).
  const [active,     setActive]     = useState(() => pendingMathEdit())
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
  const exitDirRef         = useRef<'before' | 'after'>('after')
  const pendingPointerIdRef = useRef<number | null>(null)

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

  // Alignment from the sigma menu: the menu fires a custom event so it works even
  // when ProseMirror's selection is not on this node (math-field has focus instead).
  // Only the active or ProseMirror-selected block responds — not all blocks on the page.
  useEffect(() => {
    if (!active && !selected) return
    const handler = (e: Event) => {
      const a = (e as CustomEvent<{ align: string }>).detail.align
      updateAttributes({ align: a })
    }
    window.addEventListener('inkwave-math-align', handler)
    return () => window.removeEventListener('inkwave-math-align', handler)
  }, [active, selected, updateAttributes])

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
        // display:inline-block; width:max-content — the parent column-flex's align-items
        // shrink-wraps it to content width then centres or left-aligns it.
        // font-size:1.21em matches KaTeX's default block display scale (KaTeX applies 1.21×
        // internally; without this the formula appears ~17% smaller than the KaTeX render).
        'display:inline-block;width:max-content;background:transparent;border:none;',
        'outline:none;font-size:1.21em;font-family:KaTeX_Math,KaTeX_Main,inherit;',
        '--caret-color:#35283e;',
        '--selection-background-color:rgba(72, 73, 101, 0.25);',
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
        if (e.key === 'Tab') {
          e.preventDefault(); e.stopImmediatePropagation()
          exitDirRef.current = e.shiftKey ? 'before' : 'after'
          commit(mf.value, true); return
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

      mf.addEventListener('move-out', (e: any) => {
        if (cancelled) return
        const dir: string = e.detail?.direction ?? 'forward'
        const isUp = dir === 'upward', isDown = dir === 'downward'
        exitDirRef.current = (dir === 'backward' || isUp) ? 'before' : 'after'
        commit(mf.value, true)
        if (isUp || isDown) {
          const key = isUp ? 'ArrowUp' : 'ArrowDown'
          requestAnimationFrame(() => requestAnimationFrame(() => {
            editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
          }))
        }
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
      // First RAF: focus (shadow DOM renders) + transfer pointer capture for drag-select.
      // Second RAF: accurate cursor placement — getOffsetFromPoint needs a fully-laid-out
      // field; the first RAF gives MathLive one frame to compute glyph geometry.
      requestAnimationFrame(() => {
        if (!cancelled) {
          mf.focus()
          // Snapshot click now (before second RAF consumes pendingClickRef) for capture.
          const clickForCapture = pendingClickRef.current
          // Transfer pointer capture so the user can drag-select in one gesture:
          // setPointerCapture routes pointermove/pointerup to mf; the synthetic
          // pointerdown anchors MathLive's selection at the original click position.
          const pid = pendingPointerIdRef.current
          if (pid != null && clickForCapture) {
            pendingPointerIdRef.current = null
            try {
              // Dispatch BEFORE setPointerCapture: MathLive's shadow-DOM pointerdown
              // handler must fire first so it anchors its selection start position.
              // composed:true lets the event cross the shadow boundary; bubbles:true
              // means it propagates up through the shadow root's event tree.
              mf.dispatchEvent(new PointerEvent('pointerdown', {
                clientX: clickForCapture.clientX, clientY: clickForCapture.clientY,
                bubbles: true, cancelable: true, composed: true,
                pointerId: pid, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
              }))
              // Transfer capture AFTER: routes subsequent pointermove/pointerup to mf
              // so the user's drag extends the selection MathLive just anchored.
              mf.setPointerCapture(pid)
            } catch { /* pointer already released — quick click, not a drag */ }
          }
          requestAnimationFrame(() => {
            if (!cancelled) {
              const click = pendingClickRef.current
              pendingClickRef.current = null
              if (click) {
                const mfRect = mf.getBoundingClientRect()
                let tx = click.clientX, ty = click.clientY
                let bias: -1 | 0 | 1 = 0
                if (click.clientX < mfRect.left) {
                  tx = mfRect.left + 2; bias = -1
                  ty = Math.max(mfRect.top + 1, Math.min(mfRect.bottom - 1, ty))
                } else if (click.clientX > mfRect.right) {
                  tx = mfRect.right - 2; bias = 1
                  ty = Math.max(mfRect.top + 1, Math.min(mfRect.bottom - 1, ty))
                } else {
                  // Click landed on the formula — snap to the nearest KaTeX glyph centre
                  // so getOffsetFromPoint maps to the right character even for fractions.
                  const snapped = nearestKaTeXCenter(blockRef.current, click.clientX, click.clientY)
                  if (snapped) { tx = snapped.x; ty = snapped.y }
                  else ty = Math.max(mfRect.top + 1, Math.min(mfRect.bottom - 1, ty))
                }
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
      if (mfRef.current && mlContainer.current?.contains(mfRef.current)) {
        mlContainer.current.removeChild(mfRef.current)
      }
      mfRef.current = null
    }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Center formula lines inside MathLive's shadow DOM.
  // MathLive renders \displaylines rows left-aligned within the math-field box;
  // injecting text-align:center on .ML__vlist (the table cell that governs inline
  // content position within each row) centres every line at the same horizontal
  // midpoint as KaTeX's text-align:center on .katex-display.
  useEffect(() => {
    const mf = mfRef.current
    if (!mf || !mlReady) return
    const shadow = mf.shadowRoot
    if (!shadow) return
    let styleEl = shadow.querySelector('#iw-align') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'iw-align'
      shadow.insertBefore(styleEl, shadow.firstChild)
    }
    styleEl.textContent = align === 'left' ? '' : '.ML__vlist { text-align: center; }'
  }, [align, mlReady])

  return (
    <NodeViewWrapper>
      {/* Block — invisible when not in use; just the placeholder text */}
      <div
        ref={blockRef}
        onMouseDown={e => {
          e.preventDefault()  // always prevent ProseMirror from stealing focus
          if (!active) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            pendingCursorRef.current = (e.clientX - rect.left) > rect.width / 2 ? 'end' : 'start'
            pendingClickRef.current = { clientX: e.clientX, clientY: e.clientY }
            pendingPointerIdRef.current = (e.nativeEvent as PointerEvent).pointerId ?? 1
            setActive(true)
          }
        }}
        onClick={e => {
          // Handle whitespace clicks while active: clicks outside the formula area
          // (left/right margin, above/below) move the cursor to the nearest line end.
          const mf = mfRef.current
          if (!active || !mf) return
          const mfRect = mf.getBoundingClientRect()
          if (e.clientX >= mfRect.left && e.clientX <= mfRect.right
            && e.clientY >= mfRect.top  && e.clientY <= mfRect.bottom) return
          let tx = e.clientX, bias: -1 | 0 | 1 = 0
          if (e.clientX < mfRect.left)       { tx = mfRect.left  + 2; bias = -1 }
          else if (e.clientX > mfRect.right) { tx = mfRect.right - 2; bias =  1 }
          const ty = Math.max(mfRect.top + 1, Math.min(mfRect.bottom - 1, e.clientY))
          const offset: number = mf.getOffsetFromPoint(tx, ty, { bias })
          if (offset >= 0) { mf.position = offset; mf.focus() }
        }}
        style={{
          margin: '0.5em 0', padding: '0.4em 0.5em',
          position: 'relative', cursor: 'text',
          minHeight: '1.8em',
          // Only show border/background when active or selected
          border: `1px solid ${active || selected ? `${INK}55` : 'transparent'}`,
          borderRadius: '6px',
          background: active || selected ? 'rgba(72, 73, 101, 0.03)' : 'transparent',
          transition: 'border-color 0.12s, background 0.12s',
        }}
      >
        {/* CSS Grid stack — KaTeX and MathLive share gridArea 1/1 so they occupy
            exactly the same box. KaTeX (visibility:hidden when active) always drives
            the grid row height; MathLive overlays at the same centering reference. */}
        <div style={{ display: 'grid' }}>
          {/* KaTeX alignment is handled entirely in renderDisplay:
              - aligned → \begin{aligned} with auto-inserted &= per line
              - left    → \begin{array}{l}  (left-flush lines, block centred by .katex-display)
              - center  → plain display math (.katex-display text-align:center) */}
          <div style={{
            gridArea: '1/1',
            visibility: active && mlReady ? 'hidden' : 'visible',
          }}
            dangerouslySetInnerHTML={{
              __html: displayHtml || '<em style="opacity:0.35;font-size:0.9em;font-style:italic">Click to enter equation…</em>',
            }}
          />
          {/* column-flex centres the math-field block horizontally (align-items:center).
              Shadow-DOM text-align injection (see useEffect below) then controls whether
              lines inside the block are centred (center/aligned) or flush-left (left). */}
          <div ref={mlContainer} style={{
            gridArea: '1/1',
            display: active ? 'flex' : 'none',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }} />
        </div>

        {/* Greek mode indicator */}
        {greekOn && (
          <span style={{ position: 'absolute', bottom: '0.2rem', right: '0.4rem', fontSize: '0.6rem', color: INK, fontFamily: 'ui-monospace,monospace', opacity: 0.7 }}>Gk</span>
        )}
      </div>
    </NodeViewWrapper>
  )
}
