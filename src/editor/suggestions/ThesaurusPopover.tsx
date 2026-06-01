// ThesaurusPopover — Tab/Shift+Tab to navigate flagged words, Space to accept.
//
// Interaction model:
//   1. Shift+Tab → opens first red word in current paragraph (forward).
//   2. Tab        → opens the previous flagged word (backward).
//   3. Click a red word → opens popover for that word.
//   4. With popover open, type letters to filter suggestions.
//      → Matched prefix highlighted. Non-matching keystrokes ignored.
//      → Tiptap suppressed — nothing goes to the editor while popover is open.
//   5. Space      → accept top filtered match and advance forward.
//   6. Shift+Tab  → skip and advance forward.
//   7. Tab        → skip and go backward.
//   8. Esc        → dismiss without change.
//
// Cursor behaviour:
//   - Saved when a keyboard Tab session begins; pinned there for the whole session.
//   - Adjusted for length differences when a replacement word is shorter/longer.
//   - Restored (editor focused) only when the session ends: Esc, outside click,
//     or no more words within the original cursor boundary.
//   - Navigation never advances past the original cursor position.
//   - Click-initiated popovers do not participate in cursor save/restore.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { getSynonyms } from './thesaurus'
import { useCompliance } from '../../scas/compliance'
import { isInVocab } from '../../scas/ranking'

interface PopoverState {
  word: string
  from: number
  to: number
  suggestions: string[]
  anchor: { top: number; left: number }
}

interface ThesaurusPopoverProps {
  editor: Editor
  paragraphIndex: number
  scasLimitN: number | 'infinite'
  scasSessionSeed: string
  onHintChange: (pos: number | null) => void
}

export function ThesaurusPopover({
  editor,
  paragraphIndex,
  scasLimitN,
  scasSessionSeed,
  onHintChange,
}: ThesaurusPopoverProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [loading, setLoading] = useState(false)
  const [typeBuffer, setTypeBuffer] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const { recordAccepted, recordIgnored } = useCompliance()

  // Saved when a keyboard Tab session begins. Null = no active session.
  const tabCursorRef = useRef<number | null>(null)

  const filteredSuggestions = popover
    ? typeBuffer
      ? popover.suggestions.filter((s) => s.toLowerCase().startsWith(typeBuffer))
      : popover.suggestions
    : []

  // ── Cursor management ──────────────────────────────────────────────────────

  /** End the session: focus the editor and restore cursor to pre-session position. */
  function restoreCursor() {
    if (tabCursorRef.current !== null) {
      const pos = tabCursorRef.current
      tabCursorRef.current = null
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run()
      })
    }
  }

  /** Keep cursor pinned at the saved position mid-session (no focus change). */
  function pinCursor() {
    if (tabCursorRef.current !== null && !editor.isDestroyed) {
      editor.commands.setTextSelection(tabCursorRef.current)
    }
  }

  // ── Popover lifecycle ──────────────────────────────────────────────────────

  /**
   * Close the popover.
   * @param record   Fire recordIgnored (default true).
   * @param restore  End the session and restore cursor (default true).
   *                 Pass false when immediately opening the next word.
   */
  function closePopover(record = true, restore = true) {
    if (record) recordIgnored()
    onHintChange(null)
    setPopover(null)
    setTypeBuffer('')
    if (restore) restoreCursor()
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function allRedWords(): HTMLElement[] {
    return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
  }

  function posOf(el: HTMLElement): number {
    try { return editor.view.posAtDOM(el.firstChild ?? el, 0) } catch { return -1 }
  }

  // ── Open popover ───────────────────────────────────────────────────────────

  function openPopoverForElement(target: HTMLElement) {
    const word = target.dataset.word ?? target.textContent ?? ''
    if (!word) return

    let domPos: number
    try {
      domPos = editor.view.posAtDOM(target.firstChild ?? target, 0)
    } catch { return }

    const rect = target.getBoundingClientRect()
    const editorRect = editor.view.dom.getBoundingClientRect()

    const paraIdx = parseInt(target.dataset.para ?? '0', 10)

    setTypeBuffer('')
    setLoading(true)
    getSynonyms(word).then((candidates) => {
      setLoading(false)
      const suggestions = candidates
        .filter((w) => isInVocab(w, paraIdx, scasSessionSeed, scasLimitN))
        .slice(0, 4)
      onHintChange(domPos)
      setPopover({
        word,
        from: domPos,
        to: domPos + word.length,
        suggestions,
        anchor: {
          top: rect.bottom - editorRect.top - 13,
          left: rect.left - editorRect.left - 6,
        },
      })
    })
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Next red word after afterPos, optionally bounded by maxPos. */
  function goNext(afterPos: number, maxPos?: number): boolean {
    const next = allRedWords().find(el => {
      const p = posOf(el)
      return p > afterPos && (maxPos === undefined || p < maxPos)
    })
    if (next) { openPopoverForElement(next); return true }
    return false
  }

  /** Previous red word before beforePos. */
  function goPrev(beforePos: number): boolean {
    const prev = [...allRedWords()].reverse().find(el => posOf(el) < beforePos)
    if (prev) { openPopoverForElement(prev); return true }
    return false
  }

  // ── Click handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    function onEditorClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!target) return
      e.preventDefault()
      tabCursorRef.current = null // clicks don't participate in cursor save/restore
      openPopoverForElement(target)
    }
    const editorEl = editor.view.dom
    editorEl.addEventListener('click', onEditorClick, { capture: true })
    return () => editorEl.removeEventListener('click', onEditorClick, { capture: true })
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Key handler ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return

    function onKeyDown(e: KeyboardEvent) {
      // ── Popover open ───────────────────────────────────────────────────────
      if (popover) {
        e.stopPropagation()

        if (e.key === 'Escape') { e.preventDefault(); closePopover(); return }

        if (e.key === 'Tab') {
          e.preventDefault()
          const from = popover.from
          closePopover(true, false) // don't restore yet — may open another word
          requestAnimationFrame(() => {
            const found = e.shiftKey
              ? goNext(from)
              : goPrev(from)
            if (!found) restoreCursor()
          })
          return
        }

        if (e.key === 'Enter') { e.preventDefault(); return }

        if (e.key === ' ') {
          e.preventDefault()
          const match = popover.suggestions.find(s => s.toLowerCase() === typeBuffer)
          if (match) acceptSuggestion(match, true)
          else setTypeBuffer('')
          return
        }

        if (e.key === 'Backspace') {
          e.preventDefault()
          setTypeBuffer(b => b.slice(0, -1))
          return
        }

        if (/^[a-z]$/i.test(e.key)) {
          e.preventDefault()
          const next = typeBuffer + e.key.toLowerCase()
          if (popover.suggestions.some(s => s.toLowerCase().startsWith(next))) setTypeBuffer(next)
          return
        }

        e.preventDefault()
        return
      }

      // ── No popover ─────────────────────────────────────────────────────────
      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabCursorRef.current === null) tabCursorRef.current = editor.state.selection.from
        const cursorPos = editor.state.selection.from

        if (e.shiftKey) {
          // Forward: first red word in current paragraph at or after cursor,
          // else first red word after cursor in any paragraph.
          const reds = allRedWords()
          const target =
            reds.find(el => parseInt(el.dataset.para ?? '0', 10) === paragraphIndex && posOf(el) >= cursorPos) ??
            reds.find(el => posOf(el) > cursorPos)
          if (target) openPopoverForElement(target)
          else tabCursorRef.current = null
        } else {
          // Backward: last red word before cursor.
          const prev = [...allRedWords()].reverse().find(el => posOf(el) < cursorPos)
          if (prev) openPopoverForElement(prev)
          else tabCursorRef.current = null
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, popover, typeBuffer, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Outside click ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!popover) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopover()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [popover]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept a suggestion ────────────────────────────────────────────────────
  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!popover) return
    const acceptedFrom = popover.from
    const lengthDiff = replacement.length - (popover.to - popover.from)

    // Keep the saved cursor anchored correctly after a shorter/longer replacement.
    if (tabCursorRef.current !== null && popover.from < tabCursorRef.current) {
      tabCursorRef.current += lengthDiff
    }

    onHintChange(null)
    editor.chain()
      .deleteRange({ from: popover.from, to: popover.to })
      .insertContentAt(popover.from, replacement)
      .run()
    pinCursor() // snap cursor back before React re-renders

    recordAccepted()
    setPopover(null)
    setTypeBuffer('')

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
  if (!popover && !loading) return null

  return (
    <div
      ref={containerRef}
      className="absolute z-50 rounded border border-stone-200 bg-white/75 backdrop-blur-sm shadow-sm py-1 px-0 text-sm font-sans w-fit"
      style={popover ? { top: popover.anchor.top, left: popover.anchor.left } : { display: 'none' }}
    >
      {loading && (
        <div className="text-stone-400 text-xs px-1 py-0.5">Looking up&hellip;</div>
      )}
      {popover && (
        <>
          {popover.suggestions.length === 0 ? (
            <div className="px-1.5 py-1 text-stone-400 text-xs italic">No suggestions found.</div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="px-1.5 py-1 text-stone-400 text-xs italic">
              No match for &ldquo;{typeBuffer}&rdquo;.
            </div>
          ) : (
            filteredSuggestions.map((s) => (
              <button
                key={s}
                className="block w-full text-left px-1.5 py-0.5 rounded hover:bg-stone-100 text-stone-700"
                onClick={() => acceptSuggestion(s, true)}
              >
                {typeBuffer ? (
                  <>
                    <span className="text-blue-500 font-medium">{s.slice(0, typeBuffer.length)}</span>
                    <span>{s.slice(typeBuffer.length)}</span>
                  </>
                ) : s}
              </button>
            ))
          )}
        </>
      )}
    </div>
  )
}
