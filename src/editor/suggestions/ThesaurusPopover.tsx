// ThesaurusPopover — Word-cycle synonym interface.
//
// Keyboard: j/k cycle, Space accept+advance, Tab prev word, Shift+Tab next, Esc dismiss
// Slots: 0 = original word, 1–6 = synonyms, 7 = ⌫ delete
// Click/touch: opens cycle without moving cursor

import React, { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { getSynonyms } from './thesaurus'
import { useCompliance } from '../../scas/compliance'
import { getFont, measureTextWidth } from './textMetrics'

const CYCLE_SIZE = 8
const DELETE_SENTINEL = '\x00delete'

function displayFor(s: string, mobileScale = 1): React.ReactNode {
  if (s !== DELETE_SENTINEL) return s
  // ⌫ in system-ui — IM Fell DW Pica doesn't have this glyph.
  const fontSize = mobileScale > 1 ? `${mobileScale}em` : '0.82em'
  const style: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', fontSize }
  if (mobileScale > 1) style.lineHeight = '1'
  return <span style={style}>⌫</span>
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CycleState {
  word: string
  from: number
  to: number
  synonyms: string[]        // exactly CYCLE_SIZE entries
  currentIdx: number
  minWidth: number          // px — min-width on the focused word decoration
  naturalWidth: number      // px — word width before decoration
  naturalTop: number        // px viewport-y — focused word top, pre-decoration
  naturalBottom: number     // px viewport-y — focused word bottom, pre-decoration
  naturalLineRight: number  // px — rightmost char on the line, pre-decoration
}

interface ThesaurusPopoverProps {
  editor: Editor
  paragraphIndex: number
  containerEl: React.RefObject<HTMLDivElement>
  onHintChange: (
    pos: number | null,
    minWidth?: number | null,
    lineRange?: { from: number; to: number; letterSpacingEm: number; offsetLeft: number } | null,
  ) => void
  onCycleChange: (active: boolean) => void
}

export function ThesaurusPopover({
  editor,
  paragraphIndex,
  containerEl,
  onHintChange,
  onCycleChange,
}: ThesaurusPopoverProps) {
  const [cycle, setCycle] = useState<CycleState | null>(null)
  const [, forceUpdate] = useState(0)
  const { recordAccepted, recordIgnored } = useCompliance()
  const tabCursorRef = useRef<number | null>(null)

  useEffect(() => { onCycleChange(!!cycle) }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render on zoom/scroll so live DOM positions stay in sync.
  useEffect(() => {
    if (!cycle) return
    const update = () => forceUpdate(n => n + 1)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────

  const redWords = () => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
  const posOf    = (el: Element) => { try { return editor.view.posAtDOM(el.firstChild ?? el, 0) } catch { return -1 } }

  // ── Line compression ──────────────────────────────────────────────────────

  // Computes negative letter-spacing to absorb the focused word's min-width
  // expansion without overflowing the paragraph.  Uses pre-decoration natural
  // geometry so it can be dispatched atomically with the min-width itself —
  // preventing any intermediate painted frame where the word is expanded but
  // not yet compressed.
  //
  // .scas-red is display:inline-block (≈45px line box). Midpoint+tolerance is
  // used for same-line detection to exclude adjacent-line chars that fall inside
  // the tall box.
  //
  // Known limitation: naturalLineRight is measured from text nodes only.
  // Non-text inline content (images, widgets) on the same line is invisible to
  // the walker and will cause naturalSlack to be overestimated — see arch doc.
  function computeLineCompressionRange(
    naturalTop: number,
    naturalBottom: number,
    naturalLineRight: number,
    naturalWidth: number,
    minWidth: number,
    wordFrom: number,
    wordTo: number,
    paraEl: Element,
  ): { from: number; to: number; letterSpacingEm: number; offsetLeft: number } | null {
    const midY      = (naturalTop + naturalBottom) / 2
    const tolerance = (naturalBottom - naturalTop) * 0.45

    let lineFrom = null as number | null, lineFromX = Infinity
    let lineTo   = null as number | null
    let charsBefore = 0, charsAfter = 0

    const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
    const r = document.createRange()

    for (;;) {
      const node = walker.nextNode() as Text | null
      if (!node) break
      if (!node.length) continue
      r.setStart(node, 0); r.setEnd(node, node.length)
      const nr = r.getBoundingClientRect()
      if (nr.bottom < naturalTop - 2 || nr.top > naturalBottom + 2) continue

      for (let i = 0; i < node.length; i++) {
        r.setStart(node, i); r.setEnd(node, i + 1)
        const cr = r.getBoundingClientRect()
        if (Math.abs((cr.top + cr.bottom) / 2 - midY) >= tolerance) continue
        try {
          const pmPos = editor.view.posAtDOM(node, i)
          if (pmPos < wordFrom) {
            charsBefore++
            if (cr.left < lineFromX) { lineFromX = cr.left; lineFrom = pmPos }
          } else if (pmPos >= wordTo) {
            charsAfter++
            if (lineTo === null || pmPos + 1 > lineTo) lineTo = pmPos + 1
          }
        } catch { /* skip non-editable nodes */ }
      }
    }

    if (charsBefore + charsAfter === 0) return null

    const naturalSlack = Math.max(0, paraEl.getBoundingClientRect().right - naturalLineRight)
    // Math.ceil(minWidth) matches what RedHighlightExtension applies to the DOM.
    const expansion    = Math.max(0, Math.ceil(minWidth) - naturalWidth)
    const netExpansion = expansion > naturalSlack ? expansion - naturalSlack + 2 : 0
    if (netExpansion === 0) return null

    const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
    const fontSize  = parseFloat(focusedEl ? window.getComputedStyle(focusedEl).fontSize : '18') || 18

    // The first word on a wrapped line is excluded from compression — a widget
    // offsets it instead, keeping the focused word anchored to its original x.
    // On the very first line of a paragraph, skip the widget (nothing above to reflow).
    let firstWordChars = 0
    if (lineFrom !== null) {
      let isFirstLine = false
      try { isFirstLine = editor.state.doc.resolve(lineFrom).parentOffset === 0 } catch {}
      if (!isFirstLine) {
        const docSize = editor.state.doc.content.size
        for (let p = lineFrom; p < wordFrom && p + 1 <= docSize; p++) {
          try {
            const ch = editor.state.doc.textBetween(p, p + 1)
            if (ch === ' ' || ch === '\t' || ch === '\xa0') break
            firstWordChars++
          } catch { break }
        }
      }
    }

    const charsToCompress = charsBefore + charsAfter - firstWordChars
    if (charsToCompress <= 0) return null

    const lsEm       = netExpansion / charsToCompress / fontSize
    const offsetLeft = firstWordChars * lsEm * fontSize
    return { from: lineFrom ?? wordFrom, to: lineTo ?? wordTo, letterSpacingEm: lsEm, offsetLeft }
  }

  // Recomputes and reapplies compression on resize (or when cycle geometry changes).
  // The initial application is done synchronously inside the getSynonyms .then()
  // so min-width and compression land in one PM dispatch. This is a safety net.
  useEffect(() => {
    if (!cycle) return
    function updateCompression() {
      const fe = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
      const paraEl = fe?.closest('p')
      if (!fe || !paraEl) return
      const lineRange = computeLineCompressionRange(
        cycle!.naturalTop, cycle!.naturalBottom, cycle!.naturalLineRight,
        cycle!.naturalWidth, cycle!.minWidth, cycle!.from, cycle!.to, paraEl,
      )
      onHintChange(cycle!.from, cycle!.minWidth, lineRange)
    }
    updateCompression()
    window.addEventListener('resize', updateCompression)
    return () => window.removeEventListener('resize', updateCompression)
  }, [cycle?.from, cycle?.minWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cursor management ─────────────────────────────────────────────────────

  function restoreCursor() {
    if (tabCursorRef.current === null) return
    const pos = tabCursorRef.current
    tabCursorRef.current = null
    requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run()
    })
  }

  function pinCursor() {
    if (tabCursorRef.current !== null && !editor.isDestroyed)
      editor.commands.setTextSelection(tabCursorRef.current)
  }

  // ── Cycle lifecycle ───────────────────────────────────────────────────────

  function closeCycle(record = true, restore = true) {
    if (record) recordIgnored()
    onHintChange(null, null)
    setCycle(null)
    if (restore) restoreCursor()
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function goNext(afterPos: number, maxPos?: number): boolean {
    const el = redWords().find(el => {
      const p = posOf(el)
      return p > afterPos && (maxPos === undefined || p < maxPos)
    })
    if (el) { openCycleForElement(el); return true }
    return false
  }

  function goPrev(beforePos: number): boolean {
    const el = [...redWords()].reverse().find(el => posOf(el) < beforePos)
    if (el) { openCycleForElement(el); return true }
    return false
  }

  // ── Open cycle ────────────────────────────────────────────────────────────

  function openCycleForElement(target: HTMLElement) {
    const displayWord = target.textContent ?? ''
    const lookupWord  = target.dataset.word ?? displayWord.toLowerCase()
    if (!lookupWord) return

    let domPos: number
    try { domPos = editor.view.posAtDOM(target.firstChild ?? target, 0) }
    catch { return }

    // Clear existing decoration synchronously — PM dispatch is sync so the DOM
    // reverts to natural layout before we measure.
    onHintChange(null, null)

    // Re-acquire a live element: the PM rebuild above may have destroyed the
    // original target if the previous compression range covered this word.
    const liveTarget = redWords().find(el => posOf(el) === domPos)
    if (!liveTarget) return

    const rect      = liveTarget.getBoundingClientRect()
    const font      = getFont(liveTarget)
    const wordWidth = rect.width

    // Rightmost char on the focused word's visual line (vertical-overlap walker).
    let naturalLineRight = rect.right
    const pEl = liveTarget.closest('p')
    if (pEl) {
      const tw = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT)
      const rng = document.createRange()
      for (;;) {
        const nd = tw.nextNode() as Text | null
        if (!nd) break
        rng.setStart(nd, 0); rng.setEnd(nd, nd.length)
        const nr = rng.getBoundingClientRect()
        if (nr.bottom < rect.top - 2 || nr.top > rect.bottom + 2) continue
        for (let i = 0; i < nd.length; i++) {
          rng.setStart(nd, i); rng.setEnd(nd, i + 1)
          const cr = rng.getBoundingClientRect()
          if (cr.bottom >= rect.top && cr.top <= rect.bottom && cr.right > naturalLineRight)
            naturalLineRight = cr.right
        }
      }
    }

    // Apply provisional focus immediately — prevents the null-gap flash on Tab navigation.
    onHintChange(domPos, wordWidth)

    // Provisional cycle: all synonym slots = word until getSynonyms resolves.
    setCycle({
      word: lookupWord, from: domPos, to: domPos + displayWord.length,
      synonyms: [...Array(CYCLE_SIZE - 1).fill(displayWord), DELETE_SENTINEL],
      currentIdx: 0,
      minWidth: wordWidth, naturalWidth: wordWidth,
      naturalTop: rect.top, naturalBottom: rect.bottom, naturalLineRight,
    })

    getSynonyms(lookupWord).then(candidates => {
      const pool     = [displayWord, ...candidates]
      const synonyms = [
        ...Array.from({ length: CYCLE_SIZE - 1 }, (_, i) => pool[i % pool.length]),
        DELETE_SENTINEL,
      ]

      const CARD_PAD_X = 3
      const maxWidth = Math.max(wordWidth, ...synonyms
        .filter(s => s !== DELETE_SENTINEL)
        .map(s => measureTextWidth(s, font))
      ) + CARD_PAD_X * 2

      // Bail if the cycle closed, or if another word was focused while fetching.
      const fe = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
      if (!fe || posOf(fe) !== domPos) return

      // Compute compression atomically with min-width — single PM dispatch, no overflow frame.
      const pe = (fe.closest('p') ?? pEl) as Element | null
      const lineRange = pe
        ? computeLineCompressionRange(rect.top, rect.bottom, naturalLineRight,
            wordWidth, maxWidth, domPos, domPos + displayWord.length, pe)
        : null

      onHintChange(domPos, maxWidth, lineRange)
      setCycle(prev => prev?.from === domPos ? { ...prev, synonyms, minWidth: maxWidth } : prev)
    })
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return
    const editorEl = editor.view.dom
    function onPointerDown(e: PointerEvent) {
      const target = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!target || !editorEl.contains(target)) return
      e.preventDefault()
      tabCursorRef.current = null
      openCycleForElement(target)
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor) return
    function onKeyDown(e: KeyboardEvent) {
      if (cycle) {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); closeCycle(); return }
        if (e.key === 'j') {
          e.preventDefault()
          setCycle(c => c ? { ...c, currentIdx: (c.currentIdx - 1 + CYCLE_SIZE) % CYCLE_SIZE } : c)
          return
        }
        if (e.key === 'k') {
          e.preventDefault()
          setCycle(c => c ? { ...c, currentIdx: (c.currentIdx + 1) % CYCLE_SIZE } : c)
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const { from } = cycle
          recordIgnored()
          const found = e.shiftKey ? goNext(from) : goPrev(from)
          if (!found) { onHintChange(null, null); setCycle(null); restoreCursor() }
          return
        }
        if (e.key === ' ') { e.preventDefault(); acceptSuggestion(cycle.synonyms[cycle.currentIdx], true); return }
        if (e.key === 'Enter') { e.preventDefault(); return }
        e.preventDefault()
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabCursorRef.current === null) tabCursorRef.current = editor.state.selection.from
        const cursorPos = editor.state.selection.from
        if (e.shiftKey) {
          const reds = redWords()
          const target =
            reds.find(el => parseInt(el.dataset.para ?? '0', 10) === paragraphIndex && posOf(el) >= cursorPos) ??
            reds.find(el => posOf(el) > cursorPos)
          if (target) openCycleForElement(target); else tabCursorRef.current = null
        } else {
          const prev = [...redWords()].reverse().find(el => posOf(el) < cursorPos)
          if (prev) openCycleForElement(prev); else tabCursorRef.current = null
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, cycle, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cycle) return
    const isOutside = (t: HTMLElement | null) =>
      t && !t.closest?.('.scas-red') && !t.closest?.('.scas-cycle-card')
    const onMouseDown  = (e: MouseEvent) => { if (isOutside(e.target as HTMLElement)) closeCycle() }
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) {
        const t = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
        if (isOutside(t)) closeCycle()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('touchstart', onTouchStart)
    }
  }, [cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept ────────────────────────────────────────────────────────────────

  function advanceOrRestore(from: number, advance: boolean) {
    if (advance) {
      requestAnimationFrame(() => {
        if (!goNext(from, tabCursorRef.current ?? undefined)) restoreCursor()
      })
    } else {
      restoreCursor()
    }
  }

  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!cycle) return
    const { from, to } = cycle
    const wordLen = to - from

    onHintChange(null, null)

    if (replacement === DELETE_SENTINEL) {
      if (tabCursorRef.current !== null && from < tabCursorRef.current) tabCursorRef.current -= wordLen
      editor.chain().deleteRange({ from, to }).run()
    } else {
      if (tabCursorRef.current !== null && from < tabCursorRef.current) tabCursorRef.current += replacement.length - wordLen
      editor.chain().deleteRange({ from, to }).insertContentAt(from, replacement).run()
    }

    pinCursor()
    recordAccepted()
    setCycle(null)
    advanceOrRestore(from, advance)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!cycle) return null

  const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
  const cRect     = containerEl.current?.getBoundingClientRect()
  if (!focusedEl || !cRect) return null

  const rect       = focusedEl.getBoundingClientRect()
  const left       = rect.left - cRect.left
  const width      = rect.width
  const cs         = window.getComputedStyle(focusedEl)
  const fontFamily = cs.fontFamily
  const fontSize   = parseFloat(cs.fontSize) || 18

  // Range over the transparent text node gives font-metric-accurate vertical position.
  const textNode = focusedEl.firstChild
  let textMid: number
  if (textNode?.nodeType === Node.TEXT_NODE) {
    const range = document.createRange()
    range.selectNodeContents(textNode)
    const tr = range.getBoundingClientRect()
    textMid = tr.top - cRect.top + tr.height / 2
  } else {
    textMid = rect.top - cRect.top + rect.height / 2
  }

  const rowLH    = Math.round(fontSize * 1.15)
  const cardPadY = 2
  const outerLH  = Math.round(rowLH * 0.78)
  const contTop  = textMid - outerLH - rowLH / 2 - cardPadY

  const prev    = cycle.synonyms[(cycle.currentIdx - 1 + CYCLE_SIZE) % CYCLE_SIZE]
  const current = cycle.synonyms[cycle.currentIdx]
  const next    = cycle.synonyms[(cycle.currentIdx + 1) % CYCLE_SIZE]

  const colorOf   = (s: string) => s === cycle.synonyms[0] ? '#a02020' : '#c96a00'
  const opacityOf = (s: string) => s === cycle.synonyms[0] ? 0.92 : 0.72
  const mobile    = window.innerWidth < 768 ? 1.4 : 1

  const rowBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden',
  }

  return (
    <>
      {/* Glyph placeholder — vertically aligned with the middle row */}
      <div
        className="absolute z-50 pointer-events-none select-none text-stone-300"
        style={{ position: 'absolute', top: contTop + outerLH, left: left - 18,
                 lineHeight: `${rowLH}px`, fontFamily, fontSize }}
      >◯</div>

      {/* Three-row card: prev / current / next */}
      <div
        className="absolute z-50 select-none scas-cycle-card"
        style={{
          top: contTop, left, width: Math.ceil(width),
          fontFamily, fontSize,
          background: 'white',
          border: '1px solid rgba(180, 90, 10, 0.85)',
          borderRadius: '10px',
          padding: `${cardPadY}px 3px`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ ...rowBase, height: outerLH, fontSize: fontSize * 0.92, color: colorOf(prev), opacity: opacityOf(prev), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(prev, true)}>{displayFor(prev, mobile)}</div>
        <div style={{ ...rowBase, height: rowLH, color: colorOf(current), opacity: current === DELETE_SENTINEL ? 0.70 : 1, cursor: 'pointer' }}
          onClick={() => acceptSuggestion(current, true)}>{displayFor(current, mobile)}</div>
        <div style={{ ...rowBase, height: outerLH, fontSize: fontSize * 0.92, color: colorOf(next), opacity: opacityOf(next), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(next, true)}>{displayFor(next, mobile)}</div>
      </div>
    </>
  )
}
