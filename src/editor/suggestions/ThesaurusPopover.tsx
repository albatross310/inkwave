// ThesaurusPopover — Tab/Shift+Tab to navigate flagged words, Space to accept.
//
// Interaction model:
//   1. Tab (or click a red word) → opens popover with up to 4 in-vocab synonyms.
//   2. Shift+Tab → opens the previous flagged word.
//   3. With popover open, type letters to filter suggestions.
//      → Matched prefix highlighted. Non-matching keystrokes ignored.
//      → Tiptap suppressed — nothing goes to the editor while popover is open.
//   4. Press 1–4 to accept by position.
//   5. Space → accept top filtered match and advance to next flagged word.
//   6. Tab → skip (dismiss without accepting) and advance.
//   7. Shift+Tab → skip and go to previous.
//   8. Esc → dismiss without change.

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
  openedByKey: number | null
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

  const filteredSuggestions = popover
    ? typeBuffer
      ? popover.suggestions.filter((s) => s.toLowerCase().startsWith(typeBuffer))
      : popover.suggestions
    : []

  // ── Helpers ────────────────────────────────────────────────────────────────

  function closePopover(record = true) {
    if (record) recordIgnored()
    onHintChange(null)
    setPopover(null)
    setTypeBuffer('')
  }

  /** Find all .scas-red elements sorted by document position. */
  function allRedWords(): HTMLElement[] {
    return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.scas-red'))
  }

  function posOf(el: HTMLElement): number {
    try { return editor.view.posAtDOM(el.firstChild ?? el, 0) } catch { return -1 }
  }

  // ── Open popover for a given .scas-red DOM element ─────────────────────────
  function openPopoverForElement(target: HTMLElement, openedByKey: number | null = null) {
    const word = target.dataset.word ?? target.textContent ?? ''
    if (!word) return

    const view = editor.view
    let domPos: number
    try {
      const node = target.firstChild ?? target
      domPos = view.posAtDOM(node, 0)
    } catch {
      return
    }

    const from = domPos
    const to = from + word.length

    const rect = target.getBoundingClientRect()
    const editorRect = view.dom.getBoundingClientRect()
    const anchor = {
      top: rect.bottom - editorRect.top - 13,
      left: rect.left - editorRect.left - 6,
    }

    const paraIdx = parseInt(target.dataset.para ?? '0', 10)

    setTypeBuffer('')
    setLoading(true)
    getSynonyms(word).then((candidates) => {
      setLoading(false)
      const suggestions = candidates
        .filter((w) => isInVocab(w, paraIdx, scasSessionSeed, scasLimitN))
        .slice(0, 4)
      onHintChange(from)
      setPopover({ word, from, to, suggestions, anchor, openedByKey })
    })
  }

  // ── Navigate to next/prev red word ────────────────────────────────────────

  function goNext(afterPos: number) {
    const next = allRedWords().find(el => posOf(el) > afterPos)
    if (next) openPopoverForElement(next, null)
  }

  function goPrev(beforePos: number) {
    const prev = [...allRedWords()].reverse().find(el => posOf(el) < beforePos)
    if (prev) openPopoverForElement(prev, null)
  }

  // ── Click handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return

    function onEditorClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('.scas-red') as HTMLElement | null
      if (!target) return
      e.preventDefault()
      openPopoverForElement(target, null)
    }

    const editorEl = editor.view.dom
    editorEl.addEventListener('click', onEditorClick)
    return () => editorEl.removeEventListener('click', onEditorClick)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Key handler (capture phase) ────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return

    function onKeyDown(e: KeyboardEvent) {
      // ── Popover open ───────────────────────────────────────────────────────
      if (popover) {
        e.stopPropagation()

        if (e.key === 'Escape') {
          e.preventDefault()
          closePopover(true)
          return
        }

        // Tab / Shift+Tab: skip current word and advance / go back.
        if (e.key === 'Tab') {
          e.preventDefault()
          const from = popover.from
          closePopover(true)
          requestAnimationFrame(() => {
            if (e.shiftKey) goPrev(from)
            else goNext(from)
          })
          return
        }

        // Enter: swallowed but no action.
        if (e.key === 'Enter') {
          e.preventDefault()
          return
        }

        // Space: accept top filtered match and advance.
        if (e.key === ' ') {
          e.preventDefault()
          const exactMatch = popover.suggestions.find(
            (s) => s.toLowerCase() === typeBuffer
          )
          if (exactMatch) {
            acceptSuggestion(exactMatch, true)
          } else {
            setTypeBuffer('')
          }
          return
        }

        // Backspace: trim buffer.
        if (e.key === 'Backspace') {
          e.preventDefault()
          setTypeBuffer((b) => b.slice(0, -1))
          return
        }

        // Alphabetic: type-to-filter.
        if (/^[a-z]$/i.test(e.key)) {
          e.preventDefault()
          const next = typeBuffer + e.key.toLowerCase()
          const hasMatch = popover.suggestions.some((s) => s.toLowerCase().startsWith(next))
          if (hasMatch) setTypeBuffer(next)
          return
        }

        e.preventDefault()
        return
      }

      // ── No popover ─────────────────────────────────────────────────────────
      if (e.key === 'Tab') {
        e.preventDefault()
        const cursorPos = editor.state.selection.from
        if (e.shiftKey) {
          const prev = [...allRedWords()].reverse().find(el => posOf(el) < cursorPos)
          if (prev) openPopoverForElement(prev, null)
        } else {
          const next = allRedWords().find(el => posOf(el) >= cursorPos)
          if (next) openPopoverForElement(next, null)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editor, popover, typeBuffer, filteredSuggestions, paragraphIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dismiss on outside click ───────────────────────────────────────────────
  useEffect(() => {
    if (!popover) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopover(true)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [popover]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept a suggestion ────────────────────────────────────────────────────
  function acceptSuggestion(replacement: string, advance: boolean) {
    if (!popover) return
    const acceptedFrom = popover.from
    // Clear hint state before the transaction so the rebuild sees focusedPos = null.
    onHintChange(null)
    editor
      .chain()
      .focus()
      .deleteRange({ from: popover.from, to: popover.to })
      .insertContentAt(popover.from, replacement)
      .run()
    recordAccepted()
    setPopover(null)
    setTypeBuffer('')

    if (advance) {
      requestAnimationFrame(() => {
        const next = allRedWords().find(el => posOf(el) > acceptedFrom)
        if (next) openPopoverForElement(next, null)
      })
    }
  }

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
            <div className="px-1.5 py-1 text-stone-400 text-xs italic">
              No suggestions found.
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="px-1.5 py-1 text-stone-400 text-xs italic">
              No match for &ldquo;{typeBuffer}&rdquo;.
            </div>
          ) : (
            filteredSuggestions.map((s) => (
              <button
                key={s}
                className="block w-full text-left px-1.5 py-0.5 rounded hover:bg-stone-100 text-stone-700"
                onClick={() => acceptSuggestion(s, false)}
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
