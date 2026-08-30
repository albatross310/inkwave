// In-editor @-trigger citation autocomplete.
// Typing "@" opens a dropdown over the matching bibProvider entries.
// Select → insertCitation node.

import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { bibProvider } from '../citations/bibProvider'
import { maybeShowCitationToast } from '../citations/citationToast'
import type { CSLItem } from '../types/document'

const INK = '#5c2d8a'
const MAX_RESULTS = 10

interface Props {
  editor: Editor
}

interface Popup {
  query: string
  x: number
  y: number
  results: CSLItem[]
  index: number
}

export function CiteAutocomplete({ editor }: Props) {
  const [popup, setPopup] = useState<Popup | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPopup(null), [])

  // Listen for selection changes from the suggestion plugin
  // We wire this via a custom event emitted by the Suggestion extension
  useEffect(() => {
    const onSuggest = (e: Event) => {
      const { query, rect, active } = (e as CustomEvent<{
        query: string; rect: DOMRect; active: boolean
      }>).detail
      if (!active) { setPopup(null); return }
      const results = bibProvider.search(query).slice(0, MAX_RESULTS)
      setPopup(prev => ({
        query,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 4),
        results,
        index: prev && prev.query === query ? Math.min(prev.index, results.length - 1) : 0,
      }))
    }
    const el = editor.view.dom
    el.addEventListener('citeautocomplete', onSuggest as EventListener)
    return () => el.removeEventListener('citeautocomplete', onSuggest as EventListener)
  }, [editor])

  // Keyboard navigation — intercept when popup is open
  useEffect(() => {
    if (!popup) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        setPopup(p => p ? { ...p, index: (p.index + 1) % Math.max(1, p.results.length) } : p)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        setPopup(p => p ? { ...p, index: ((p.index - 1) + Math.max(1, p.results.length)) % Math.max(1, p.results.length) } : p)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (popup.results[popup.index]) {
          e.preventDefault(); e.stopPropagation()
          pick(popup.results[popup.index])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault(); close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [popup, close]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!popup) return
    const onDown = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popup, close])

  function pick(item: CSLItem) {
    close()
    // Delete the @query trigger text, then insert citation node
    const { state } = editor
    const { from } = state.selection
    const triggerStart = from - (popup!.query.length + 1) // +1 for "@"
    editor
      .chain()
      .focus()
      .deleteRange({ from: triggerStart, to: from })
      .insertCitation({ citekeys: [item.id] })
      .run()
    maybeShowCitationToast()
  }

  if (!popup) return null

  const { x, y, results, index } = popup
  const clampedX = Math.min(x, window.innerWidth - 280)
  const clampedY = Math.min(y, window.innerHeight - 300)

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: 'fixed', left: clampedX, top: clampedY, zIndex: 200,
        width: 280, maxHeight: 280, overflowY: 'auto',
        background: 'white', borderRadius: 10,
        border: `1px solid ${INK}44`,
        boxShadow: '0 4px 16px rgb(var(--iw-ink-rgb) / 0.14)',
      }}
    >
      {results.length === 0 ? (
        <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: '0.8rem' }}>
          No sources found
        </div>
      ) : (
        results.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={e => { e.preventDefault(); pick(item) }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '7px 12px', border: 'none',
              background: i === index ? `${INK}12` : 'transparent',
              borderLeft: i === index ? `2px solid ${INK}` : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: INK, fontWeight: 500 }}>{item.id}</div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }} className="truncate">
              {item.title ?? ''}
            </div>
          </button>
        ))
      )}
    </div>,
    document.body,
  )
}
