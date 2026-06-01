// ThesaurusPopover — Word-cycle synonym interface.
// Keyboard: j/k cycle, Space accept+advance, Tab prev word, Shift+Tab next, Esc dismiss
// Slots: 0 = original word, 1–6 = synonyms, 7 = ⌫ delete
// Click/touch: opens cycle without moving cursor

import React, { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { useCompliance } from '../../../scas/compliance'
import { CYCLE_SIZE, DELETE_SENTINEL } from './popoverConstants'
import type { OnHintChange } from './popoverConstants'
import { posOf } from './popoverGeometry'
import { displayFor } from './popoverFallbacks'
import { usePopoverLayout } from './usePopoverLayout'

interface ThesaurusPopoverProps {
  editor: Editor
  paragraphIndex: number
  containerEl: React.RefObject<HTMLDivElement>
  onHintChange: OnHintChange
  onCycleChange: (active: boolean) => void
}

export function ThesaurusPopover({ editor, paragraphIndex, containerEl, onHintChange, onCycleChange }: ThesaurusPopoverProps) {
  const { recordAccepted, recordIgnored } = useCompliance()
  const tabCursorRef = useRef<number | null>(null)
  const { cycle, setCycle, openCycleForElement } = usePopoverLayout(editor, onHintChange)

  useEffect(() => { onCycleChange(!!cycle) }, [!!cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  const redWords = () => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))

  // ── Cursor management ─────────────────────────────────────────────────────

  function restoreCursor() {
    const pos = tabCursorRef.current; if (pos === null) return
    tabCursorRef.current = null
    requestAnimationFrame(() => { if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run() })
  }
  function pinCursor() {
    if (tabCursorRef.current !== null && !editor.isDestroyed)
      editor.commands.setTextSelection(tabCursorRef.current)
  }
  function closeCycle(record = true, restore = true) {
    if (record) recordIgnored(); onHintChange(null, null); setCycle(null); if (restore) restoreCursor()
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function goNext(after: number, max?: number): boolean {
    const el = redWords().find(el => { const p = posOf(el, editor); return p > after && (max === undefined || p < max) })
    if (el) { openCycleForElement(el); return true }; return false
  }
  function goPrev(before: number): boolean {
    const el = [...redWords()].reverse().find(el => posOf(el, editor) < before)
    if (el) { openCycleForElement(el); return true }; return false
  }

  // ── Accept ────────────────────────────────────────────────────────────────

  function advanceOrRestore(from: number, advance: boolean) {
    if (advance) requestAnimationFrame(() => { if (!goNext(from, tabCursorRef.current ?? undefined)) restoreCursor() })
    else restoreCursor()
  }
  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!cycle) return
    const { from, to } = cycle; const wl = to - from
    onHintChange(null, null)
    if (replacement === DELETE_SENTINEL) {
      if (tabCursorRef.current !== null && from < tabCursorRef.current) tabCursorRef.current -= wl
      editor.chain().deleteRange({ from, to }).run()
    } else {
      if (tabCursorRef.current !== null && from < tabCursorRef.current) tabCursorRef.current += replacement.length - wl
      editor.chain().deleteRange({ from, to }).insertContentAt(from, replacement).run()
    }
    pinCursor(); recordAccepted(); setCycle(null); advanceOrRestore(from, advance)
  }

  // ── Events ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return
    const edEl = editor.view.dom
    function onPointerDown(e: PointerEvent) {
      const t = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!t || !edEl.contains(t)) return
      e.preventDefault(); tabCursorRef.current = null; openCycleForElement(t)
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
        if (e.key === 'j') { e.preventDefault(); setCycle(c => c ? { ...c, currentIdx: (c.currentIdx - 1 + CYCLE_SIZE) % CYCLE_SIZE } : c); return }
        if (e.key === 'k') { e.preventDefault(); setCycle(c => c ? { ...c, currentIdx: (c.currentIdx + 1) % CYCLE_SIZE } : c); return }
        if (e.key === 'Tab') {
          e.preventDefault(); recordIgnored()
          const found = e.shiftKey ? goNext(cycle.from) : goPrev(cycle.from)
          if (!found) { onHintChange(null, null); setCycle(null); restoreCursor() }
          return
        }
        if (e.key === ' ') { e.preventDefault(); acceptSuggestion(cycle.synonyms[cycle.currentIdx], true); return }
        if (e.key === 'Enter') { e.preventDefault(); return }
        e.preventDefault(); return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabCursorRef.current === null) tabCursorRef.current = editor.state.selection.from
        const cur = editor.state.selection.from
        if (e.shiftKey) {
          const reds = redWords()
          const t = reds.find(el => parseInt(el.dataset.para ?? '0', 10) === paragraphIndex && posOf(el, editor) >= cur)
               ?? reds.find(el => posOf(el, editor) > cur)
          if (t) openCycleForElement(t); else tabCursorRef.current = null
        } else {
          const prev = [...redWords()].reverse().find(el => posOf(el, editor) < cur)
          if (prev) openCycleForElement(prev); else tabCursorRef.current = null
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, cycle, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cycle) return
    const outside = (t: HTMLElement | null) => !!t && !t.closest?.('.scas-red') && !t.closest?.('.scas-cycle-card')
    const onMD = (e: MouseEvent)  => { if (outside(e.target as HTMLElement)) closeCycle() }
    const onTS = (e: TouchEvent)  => {
      const t = e.touches[0] && document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) as HTMLElement | null
      if (outside(t)) closeCycle()
    }
    document.addEventListener('mousedown', onMD)
    document.addEventListener('touchstart', onTS, { passive: true })
    return () => { document.removeEventListener('mousedown', onMD); document.removeEventListener('touchstart', onTS) }
  }, [cycle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  if (!cycle) return null
  const focusedEl = editor.view.dom.querySelector('.scas-focused') as HTMLElement | null
  const cRect     = containerEl.current?.getBoundingClientRect()
  if (!focusedEl || !cRect) return null

  const rect = focusedEl.getBoundingClientRect()
  const cs   = window.getComputedStyle(focusedEl)
  const fsz  = parseFloat(cs.fontSize) || 18
  const left = rect.left - cRect.left

  const textNode = focusedEl.firstChild
  let textMid: number
  if (textNode?.nodeType === Node.TEXT_NODE) {
    const rng = document.createRange(); rng.selectNodeContents(textNode)
    const tr  = rng.getBoundingClientRect()
    textMid   = tr.top - cRect.top + tr.height / 2
  } else {
    textMid = rect.top - cRect.top + rect.height / 2
  }

  const rowLH    = Math.round(fsz * 1.15)
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
    display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
  }

  return (
    <>
      {/* Glyph placeholder — vertically aligned with the middle row */}
      <div className="absolute z-50 pointer-events-none select-none text-stone-300"
        style={{ position: 'absolute', top: contTop + outerLH, left: left - 18,
                 lineHeight: `${rowLH}px`, fontFamily: cs.fontFamily, fontSize: fsz }}>◯</div>

      {/* Three-row card: prev / current / next */}
      <div className="absolute z-50 select-none scas-cycle-card"
        style={{ top: contTop, left, width: Math.ceil(rect.width), fontFamily: cs.fontFamily, fontSize: fsz,
                 background: 'white', border: '1px solid rgba(180, 90, 10, 0.85)', borderRadius: '10px',
                 padding: `${cardPadY}px 3px`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ ...rowBase, height: outerLH, fontSize: fsz * 0.92, color: colorOf(prev), opacity: opacityOf(prev), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(prev, true)}>{displayFor(prev, mobile)}</div>
        <div style={{ ...rowBase, height: rowLH, color: colorOf(current), opacity: current === DELETE_SENTINEL ? 0.70 : 1, cursor: 'pointer' }}
          onClick={() => acceptSuggestion(current, true)}>{displayFor(current, mobile)}</div>
        <div style={{ ...rowBase, height: outerLH, fontSize: fsz * 0.92, color: colorOf(next), opacity: opacityOf(next), cursor: 'pointer' }}
          onClick={() => acceptSuggestion(next, true)}>{displayFor(next, mobile)}</div>
      </div>
    </>
  )
}
