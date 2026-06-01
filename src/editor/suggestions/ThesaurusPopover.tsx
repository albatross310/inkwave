// ThesaurusPopover — Word-cycle synonym interface.
//
// Display (3-item vertical slot machine):
//   prev synonym  — one line above, faded
//   CURRENT       — overlaid on the focused word (word text is hidden via decoration)
//   next synonym  — one line below, faded
//   ◯             — placeholder glyph to the left (future: per-paragraph glyph)
//
// Keyboard:
//   j / k         → cycle down / up through 8 options (wraps)
//   Space         → accept current option and advance to next red word
//   Tab           → skip, go to previous red word
//   Shift+Tab     → skip, go to next red word
//   Esc           → dismiss without change
//
// Cycle slots (8 total):
//   0  — original word (default, no change on first open)
//   1  — ⌫ delete the word entirely
//   2–7 — synonyms from thesaurus
//
// Click / touch:
//   Clicking or tapping a red word opens the cycle without moving the cursor.

import React, { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { getSynonyms } from './thesaurus'
import { useCompliance } from '../../scas/compliance'
import { getFont, measureTextWidth } from './textMetrics'

const CYCLE_SIZE = 8
// Sentinel stored in the synonyms array to represent "delete this word".
const DELETE_SENTINEL = '\x00delete'
const DELETE_DISPLAY  = '⌫'

function displayFor(s: string, mobileScale = 1): React.ReactNode {
  if (s !== DELETE_SENTINEL) return s
  // Always render ⌫ in a system font — IM Fell DW Pica doesn't have this glyph.
  // On desktop: scale down slightly (system-ui has a larger x-height than the serifed font).
  // On mobile: scale up for tap target.
  const fontSize = mobileScale > 1 ? `${mobileScale}em` : '0.82em'
  const style: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', fontSize }
  if (mobileScale > 1) style.lineHeight = '1'
  return <span style={style}>{DELETE_DISPLAY}</span>
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface CycleState {
  word: string
  from: number
  to: number
  synonyms: string[]   // exactly CYCLE_SIZE entries
  currentIdx: number
  minWidth: number          // px — min-width applied to focused word decoration
  naturalWidth: number      // px — word's natural width before decoration
  naturalTop: number        // px viewport-y — focused word's top in pre-decoration layout
  naturalBottom: number     // px viewport-y — focused word's bottom in pre-decoration layout
  naturalLineRight: number  // px — rightmost char on the focused word's line, pre-decoration
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

  // Notify parent when cycle opens / closes so the hint panel can show/hide.
  useEffect(() => {
    onCycleChange(!!cycle)
  }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render on zoom or scroll so live DOM positions stay in sync.
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

  // Line-compression effect: tighten letter-spacing on non-word chars on the
  // focused word's visual line so the min-width expansion fits without wrapping.
  // A widget at the visual line start cancels the first-word's compression,
  // keeping it anchored and preventing flows-back to the previous line.
  useEffect(() => {
    if (!cycle) return

    function updateCompression() {
      const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
      if (!focusedEl) return

      const paraEl = focusedEl.closest('p')
      if (!paraEl) return

      // Use the NATURAL y-position of the focused word (pre-decoration) as the
      // reference for line detection. Post-decoration, the browser may have
      // wrapped the focused word to a different visual line, so fRect.top would
      // point to the wrong line. naturalTop/Bottom are viewport-relative
      // snapshots taken synchronously before any decoration fired.
      //
      // NOTE: .scas-red is display:inline-block, so naturalTop/Bottom span the
      // full line-height box (2.5 × fontSize ≈ 45px). Pure vertical-overlap
      // would include glyphs from the NEXT visual line (their cr.top falls
      // within the generous line-height box). A midpoint+tolerance check is
      // safer: all glyphs on the current line have midpoints within ±0.45×height
      // of the line centre, while next-line glyphs are ~45px away.
      const naturalMidY  = (cycle!.naturalTop + cycle!.naturalBottom) / 2
      const naturalHeight = cycle!.naturalBottom - cycle!.naturalTop
      const tolerance     = naturalHeight * 0.45

      let lineFrom:  number | null = null
      let lineFromX  = Infinity   // x-coord of lineFrom — picks true visual line start
      let lineTo:    number | null = null
      let charsBefore = 0
      let charsAfter  = 0

      const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
      const r = document.createRange()

      for (;;) {
        const node = walker.nextNode() as Text | null
        if (!node) break
        if (!node.length) continue

        // Skip text nodes entirely above/below the original line.
        r.setStart(node, 0)
        r.setEnd(node, node.length)
        const nr = r.getBoundingClientRect()
        if (nr.bottom < cycle!.naturalTop - 2 || nr.top > cycle!.naturalBottom + 2) continue

        for (let i = 0; i < node.length; i++) {
          r.setStart(node, i)
          r.setEnd(node, i + 1)
          const cr = r.getBoundingClientRect()
          if (Math.abs((cr.top + cr.bottom) / 2 - naturalMidY) < tolerance) {
            try {
              const pmPos = editor.view.posAtDOM(node, i)
              if (pmPos < cycle!.from) {
                charsBefore++
                // Track the LEFTMOST char as the true visual line start.
                // Using min x-coordinate (not min pmPos) prevents stray end-of-
                // previous-line chars (e.g. a trailing comma) from being picked
                // up as lineFrom — they sit at large x values, not small ones.
                if (cr.left < lineFromX) {
                  lineFromX = cr.left
                  lineFrom  = pmPos
                }
              } else if (pmPos >= cycle!.to) {
                charsAfter++
                if (lineTo === null || pmPos + 1 > lineTo) lineTo = pmPos + 1
              }
            } catch { /* skip non-editable nodes */ }
          }
        }
      }

      const totalNonWord = charsBefore + charsAfter
      if (totalNonWord === 0) {
        onHintChange(cycle!.from, cycle!.minWidth, null)
        return
      }

      // naturalLineRight includes all chars on the original line (before and
      // after the focused word) measured before decoration fired. This gives
      // correct slack even when after-chars wrapped due to the expansion.
      const paraRight    = paraEl.getBoundingClientRect().right
      const naturalSlack = Math.max(0, paraRight - cycle!.naturalLineRight)
      const expansion    = Math.max(0, cycle!.minWidth - cycle!.naturalWidth)
      // Add a 2 px buffer when compression is already needed: absorbs subpixel
      // rounding differences between browsers and font hinting that can leave
      // a single word just over the fold even with otherwise-correct compression.
      const netExpansion = expansion > naturalSlack
        ? expansion - naturalSlack + 2
        : 0

      // Slack already covers the expansion — no compression needed.
      if (netExpansion === 0) {
        onHintChange(cycle!.from, cycle!.minWidth, null)
        return
      }

      const fontSize = parseFloat(window.getComputedStyle(focusedEl).fontSize) || 18

      // The widget that cancels first-word compression only makes sense when
      // there is a previous visual line within the paragraph that text could
      // flow back onto. On the first visual line of a paragraph (lineFrom at
      // parentOffset 0) there is nothing above to reflow into, so skip the
      // widget and compress all chars uniformly instead.
      let firstWordChars = 0
      if (lineFrom !== null) {
        const isFirstLineOfPara = (() => {
          try { return editor.state.doc.resolve(lineFrom).parentOffset === 0 }
          catch { return false }
        })()

        if (!isFirstLineOfPara) {
          // Count chars of the first word on the line (up to first whitespace).
          // These are excluded from charsToCompress because the widget cancels
          // their compression, keeping the first word anchored in place.
          const docSize = editor.state.doc.content.size
          let p = lineFrom
          while (p < cycle!.from && p + 1 <= docSize) {
            try {
              const ch = editor.state.doc.textBetween(p, p + 1)
              if (ch === ' ' || ch === '\t' || ch === '\xa0') break
              firstWordChars++
            } catch { break }
            p++
          }
        }
      }

      // The widget cancels the compression on firstWordChars, so those chars
      // contribute zero net line reduction. Only the remaining chars absorb
      // the overflow — divide by (totalNonWord - firstWordChars).
      // If that denominator is zero (only the first word exists, no other chars
      // to compress), skip compression — the widget would cancel everything.
      const charsToCompress = totalNonWord - firstWordChars
      if (charsToCompress <= 0) {
        onHintChange(cycle!.from, cycle!.minWidth, null)
        return
      }
      const lsEm = netExpansion / charsToCompress / fontSize

      // Widget width is based only on the first word's compression — we only
      // need to anchor the first word so it cannot flow back to the previous line.
      const offsetLeft = firstWordChars * lsEm * fontSize

      // Use cycle.from as range start when there are no before-chars so
      // RedHighlightExtension's "lf < fw.from" guard stays false in that case.
      const rangeFrom = lineFrom ?? cycle!.from

      onHintChange(
        cycle!.from,
        cycle!.minWidth,
        lsEm > 0
          ? { from: rangeFrom, to: lineTo ?? cycle!.to, letterSpacingEm: lsEm, offsetLeft }
          : null,
      )
    }

    // RAF ensures the min-width decoration has been painted before we measure.
    const raf = requestAnimationFrame(updateCompression)
    window.addEventListener('resize', updateCompression)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updateCompression)
    }
  }, [cycle?.from, cycle?.minWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cursor management ──────────────────────────────────────────────────────

  function restoreCursor() {
    if (tabCursorRef.current !== null) {
      const pos = tabCursorRef.current
      tabCursorRef.current = null
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run()
      })
    }
  }

  function pinCursor() {
    if (tabCursorRef.current !== null && !editor.isDestroyed) {
      editor.commands.setTextSelection(tabCursorRef.current)
    }
  }

  // ── Cycle lifecycle ────────────────────────────────────────────────────────

  function closeCycle(record = true, restore = true) {
    if (record) recordIgnored()
    onHintChange(null, null)
    setCycle(null)
    if (restore) restoreCursor()
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function allRedWords(): HTMLElement[] {
    return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
  }

  function posOf(el: HTMLElement): number {
    try { return editor.view.posAtDOM(el.firstChild ?? el, 0) } catch { return -1 }
  }

  // ── Open cycle ─────────────────────────────────────────────────────────────

  function openCycleForElement(target: HTMLElement) {
    const displayWord = target.textContent ?? ''
    const lookupWord  = target.dataset.word ?? displayWord.toLowerCase()
    if (!lookupWord) return

    let domPos: number
    try {
      domPos = editor.view.posAtDOM(target.firstChild ?? target, 0)
    } catch { return }

    // Clear any existing decoration synchronously first. PM dispatch is
    // synchronous so the DOM reverts to natural (un-decorated) layout before
    // we measure. This prevents geometry corruption when the previous word's
    // min-width or letter-spacing is still active in the DOM.
    onHintChange(null, null)

    // Capture geometry with the DOM in its natural state.
    const rect = target.getBoundingClientRect()
    const font = getFont(target)
    const wordWidth = rect.width

    // Measure rightmost char on the focused word's visual line (vertical-overlap).
    // Also captures top/bottom so the compression walker can find chars on the
    // correct original line even if the word later wraps after decoration fires.
    let naturalLineRight = rect.right
    const pEl = target.closest('p')
    if (pEl) {
      // Vertical-overlap: char is on the same line if its bbox overlaps the
      // focused word's bbox vertically.  Correctly captures tall glyphs
      // (capitals, ascenders) whose midpoint would be clipped by a tolerance check.
      const tw  = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT)
      const rng = document.createRange()
      for (;;) {
        const nd = tw.nextNode() as Text | null
        if (!nd) break
        rng.setStart(nd, 0)
        rng.setEnd(nd, nd.length)
        const nr = rng.getBoundingClientRect()
        if (nr.bottom < rect.top - 2 || nr.top > rect.bottom + 2) continue
        for (let i = 0; i < nd.length; i++) {
          rng.setStart(nd, i)
          rng.setEnd(nd, i + 1)
          const cr = rng.getBoundingClientRect()
          if (cr.bottom >= rect.top && cr.top <= rect.bottom && cr.right > naturalLineRight)
            naturalLineRight = cr.right
        }
      }
    }

    // Apply .scas-focused immediately with provisional min-width = natural word
    // width.  This prevents the null-render gap between closing one cycle and
    // opening the next — the Tab-navigation flash is eliminated because we
    // never pass through a state where both cycle and focusedEl are absent.
    onHintChange(domPos, wordWidth)

    // Set provisional cycle so the popover card renders right away.
    // All synonym slots show the word itself until getSynonyms resolves.
    const provisionalSynonyms = Array.from(
      { length: CYCLE_SIZE },
      (_, i) => i === CYCLE_SIZE - 1 ? DELETE_SENTINEL : displayWord,
    )
    setCycle({
      word: lookupWord,
      from: domPos,
      to: domPos + displayWord.length,
      synonyms: provisionalSynonyms,
      currentIdx: 0,
      minWidth: wordWidth,
      naturalWidth: wordWidth,
      naturalTop: rect.top,
      naturalBottom: rect.bottom,
      naturalLineRight,
    })

    getSynonyms(lookupWord).then((candidates) => {
      // Slot 0 = original word, slots 1-6 = synonyms, slot 7 = delete sentinel.
      const base = [displayWord, ...candidates].slice(0, CYCLE_SIZE - 1)
      const padded = Array.from(
        { length: CYCLE_SIZE - 1 },
        (_, i) => base[i % Math.max(base.length, 1)]
      )
      const synonyms = [...padded, DELETE_SENTINEL]

      // Exclude the sentinel from width measurement (⌫ is narrow).
      // Add card horizontal padding on both sides so the reserved space already
      // includes the breathing room — no positional offset needed at render time.
      const CARD_PAD_X = 3
      const measurable = synonyms.filter(s => s !== DELETE_SENTINEL)
      const maxWidth = Math.max(wordWidth, ...measurable.map(s => measureTextWidth(s, font))) + CARD_PAD_X * 2

      onHintChange(domPos, maxWidth)
      // Guard: if another word was opened while we were fetching, discard.
      setCycle(prev =>
        prev && prev.from === domPos
          ? { ...prev, synonyms, minWidth: maxWidth }
          : prev
      )
    })
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function goNext(afterPos: number, maxPos?: number): boolean {
    const next = allRedWords().find(el => {
      const p = posOf(el)
      return p > afterPos && (maxPos === undefined || p < maxPos)
    })
    if (next) { openCycleForElement(next); return true }
    return false
  }

  function goPrev(beforePos: number): boolean {
    const prev = [...allRedWords()].reverse().find(el => posOf(el) < beforePos)
    if (prev) { openCycleForElement(prev); return true }
    return false
  }

  // ── Pointer handler (mouse + touch unified) ────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const editorEl = editor.view.dom

    // pointerdown fires for both mouse clicks and finger taps.
    // Capturing at document level ensures we beat ProseMirror's own handlers.
    function onPointerDown(e: PointerEvent) {
      const target = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!target || !editorEl.contains(target)) return
      e.preventDefault()
      tabCursorRef.current = null
      openCycleForElement(target)
    }

    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Key handler ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return

    function onKeyDown(e: KeyboardEvent) {
      // ── Cycle open ─────────────────────────────────────────────────────────
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
          const from = cycle.from
          recordIgnored()
          // Navigate directly without closing the cycle first.
          // openCycleForElement clears and replaces the cycle atomically,
          // so we never pass through a null cycle state (no flash).
          const found = e.shiftKey ? goNext(from) : goPrev(from)
          if (!found) {
            onHintChange(null, null)
            setCycle(null)
            restoreCursor()
          }
          return
        }

        if (e.key === ' ') {
          e.preventDefault()
          acceptSuggestion(cycle.synonyms[cycle.currentIdx], true)
          return
        }

        if (e.key === 'Enter') { e.preventDefault(); return }

        e.preventDefault()
        return
      }

      // ── No cycle ───────────────────────────────────────────────────────────
      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabCursorRef.current === null) tabCursorRef.current = editor.state.selection.from
        const cursorPos = editor.state.selection.from

        if (e.shiftKey) {
          const reds = allRedWords()
          const target =
            reds.find(el => parseInt(el.dataset.para ?? '0', 10) === paragraphIndex && posOf(el) >= cursorPos) ??
            reds.find(el => posOf(el) > cursorPos)
          if (target) openCycleForElement(target)
          else tabCursorRef.current = null
        } else {
          const prev = [...allRedWords()].reverse().find(el => posOf(el) < cursorPos)
          if (prev) openCycleForElement(prev)
          else tabCursorRef.current = null
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, cycle, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Outside click / tap ────────────────────────────────────────────────────
  useEffect(() => {
    if (!cycle) return

    function isOutside(target: HTMLElement | null) {
      return target && !target.closest?.('.scas-red') && !target.closest?.('.scas-cycle-card')
    }

    function onMouseDown(e: MouseEvent) {
      if (isOutside(e.target as HTMLElement)) closeCycle()
    }

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      if (!touch) return
      const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (isOutside(target)) closeCycle()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('touchstart', onTouchStart)
    }
  }, [cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept a suggestion ────────────────────────────────────────────────────
  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!cycle) return
    const acceptedFrom = cycle.from
    const wordLen = cycle.to - cycle.from

    if (replacement === DELETE_SENTINEL) {
      // Delete the word entirely — adjust saved cursor position accordingly.
      if (tabCursorRef.current !== null && cycle.from < tabCursorRef.current) {
        tabCursorRef.current -= wordLen
      }
      onHintChange(null, null)
      editor.chain().deleteRange({ from: cycle.from, to: cycle.to }).run()
      pinCursor()
      recordAccepted()
      setCycle(null)
      if (advance) {
        requestAnimationFrame(() => {
          const found = goNext(acceptedFrom, tabCursorRef.current ?? undefined)
          if (!found) restoreCursor()
        })
      } else {
        restoreCursor()
      }
      return
    }

    const lengthDiff = replacement.length - wordLen
    if (tabCursorRef.current !== null && cycle.from < tabCursorRef.current) {
      tabCursorRef.current += lengthDiff
    }

    onHintChange(null, null)
    editor.chain()
      .deleteRange({ from: cycle.from, to: cycle.to })
      .insertContentAt(cycle.from, replacement)
      .run()
    pinCursor()

    recordAccepted()
    setCycle(null)

    if (advance) {
      requestAnimationFrame(() => {
        const found = goNext(acceptedFrom, tabCursorRef.current ?? undefined)
        if (!found) restoreCursor()
      })
    } else {
      restoreCursor()
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!cycle) return null

  // Measure live from the DOM every render — correct at any zoom level.
  // The .scas-focused span already has min-width applied by the decoration,
  // so rect.width is exactly the reserved space to centre into.
  const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
  const cRect     = containerEl.current?.getBoundingClientRect()
  if (!focusedEl || !cRect) return null

  const rect       = focusedEl.getBoundingClientRect()
  const left       = rect.left - cRect.left
  const width      = rect.width
  const cs         = window.getComputedStyle(focusedEl)
  const fontFamily = cs.fontFamily
  const fontSize   = parseFloat(cs.fontSize) || 18

  // Use a Range over the (transparent) text to get the exact glyph bounding
  // box — this is font-metric-accurate at any zoom level, no magic offsets.
  let textMid: number
  const textNode = focusedEl.firstChild
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const range = document.createRange()
    range.selectNodeContents(textNode)
    const tr = range.getBoundingClientRect()
    textMid = tr.top - cRect.top + tr.height / 2
  } else {
    // Fallback: centre of the full line box
    textMid = rect.top - cRect.top + rect.height / 2
  }

  // Row height: a little taller than the glyph box so adjacent rows breathe.
  const rowLH    = Math.round(fontSize * 1.15)
  const cardPadY = 2  // must match padding-top on the card container below
  const outerLH  = Math.round(rowLH * 0.78)
  const contTop  = textMid - outerLH - rowLH / 2 - cardPadY

  const prevSynonym    = cycle.synonyms[(cycle.currentIdx - 1 + CYCLE_SIZE) % CYCLE_SIZE]
  const currentSynonym = cycle.synonyms[cycle.currentIdx]
  const nextSynonym    = cycle.synonyms[(cycle.currentIdx + 1) % CYCLE_SIZE]

  // Original word (slot 0) is shown in dark red wherever it appears so the
  // user can always track which was the old word.
  const colorFor   = (s: string) => s === cycle.synonyms[0] ? '#a02020' : '#c96a00'
  const opacityFor = (s: string) => s === cycle.synonyms[0] ? 0.92 : 0.72

  // Shared flex style keeps content vertically centred within the fixed row
  // height, so oversized glyphs (⌫ at 1.4em) can't push subsequent rows down.
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
      >
        ◯
      </div>

      {/* Three-row container: prev / current / next */}
      <div
        className="absolute z-50 select-none scas-cycle-card"
        style={{
          top: contTop,
          left,
          width: Math.ceil(width),
          fontFamily,
          fontSize,
          background: 'white',
          border: '1px solid rgba(180, 90, 10, 0.85)',
          borderRadius: '10px',
          padding: `${cardPadY}px 3px`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{ ...rowBase, height: outerLH, fontSize: fontSize * 0.92, color: colorFor(prevSynonym), opacity: opacityFor(prevSynonym), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(prevSynonym, true)}
        >{displayFor(prevSynonym, window.innerWidth < 768 ? 1.4 : 1)}</div>
        <div
          style={{ ...rowBase, height: rowLH, color: colorFor(currentSynonym), opacity: currentSynonym === DELETE_SENTINEL ? 0.70 : 1, cursor: 'pointer' }}
          onClick={() => acceptSuggestion(currentSynonym, true)}
        >{displayFor(currentSynonym, window.innerWidth < 768 ? 1.4 : 1)}</div>
        <div
          style={{ ...rowBase, height: outerLH, fontSize: fontSize * 0.92, color: colorFor(nextSynonym), opacity: opacityFor(nextSynonym), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(nextSynonym, true)}
        >{displayFor(nextSynonym, window.innerWidth < 768 ? 1.4 : 1)}</div>
      </div>
    </>
  )
}
