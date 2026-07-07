// ReviewBar — the review-mode control strip (shown when the R button is toggled on). Add a comment on
// the selection, pick/create the active annotation SET (drop-up), toggle live suggestion mode, and
// step through changes. Styled to match the footer toolbar. Sits just above the footer.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { Editor } from '@tiptap/react'
import { activeSet, setActiveSet, suggestOn, setSuggestOn, onReviewChanged, DEFAULT_SET } from '../editor/review/reviewState'
import { resolveSuggestions, reviewerColor } from '../editor/extensions/TrackChanges'

const INK = '#5c2d8a'

// Contiguous runs of tracked-change text (insertion or deletion), in document order — the units the
// review nav steps through and accept/discard act on.
function changeRanges(editor: Editor): Array<{ from: number; to: number; kind: 'ins' | 'del' }> {
  const out: Array<{ from: number; to: number; kind: 'ins' | 'del' }> = []
  let cur: { from: number; to: number; kind: 'ins' | 'del' } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) { cur = null; return }
    const kind: 'ins' | 'del' | null =
      node.marks.some((m) => m.type.name === 'insertion') ? 'ins'
      : node.marks.some((m) => m.type.name === 'deletion') ? 'del' : null
    if (!kind) { cur = null; return }
    if (cur && cur.kind === kind && cur.to === pos) cur.to = pos + node.nodeSize
    else { cur = { from: pos, to: pos + node.nodeSize, kind }; out.push(cur) }
  })
  return out
}

// Distinct comment sets present in the doc, plus the default + active, for the drop-up.
function docSets(editor: Editor): string[] {
  const s = new Set<string>([DEFAULT_SET, activeSet()])
  editor.state.doc.descendants((node) => {
    if (!node.isText) return
    for (const m of node.marks) if (m.type.name === 'comment' && m.attrs.set) s.add(m.attrs.set as string)
  })
  return [...s]
}

export function ReviewBar({ editor, bottom, onClose }: { editor: Editor; bottom: number; onClose: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const bump = () => tick((n) => n + 1)
    editor.on('update', bump)
    const off = onReviewChanged(bump)
    return () => { editor.off('update', bump); off() }
  }, [editor])
  const [setMenu, setSetMenu] = useState(false)

  const sets = useMemo(() => docSets(editor), [editor, setMenu]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = activeSet()

  function addComment() {
    const { from, to } = editor.state.selection
    if (from === to) return
    const id = uuidv4()
    editor.chain().focus().setComment({ id, body: '', set: cur, createdAt: new Date().toISOString() }).run()
    window.dispatchEvent(new CustomEvent('inkwave:edit-comment', { detail: { id } })) // open the new note to type
  }

  const hasSelection = editor.state.selection.from !== editor.state.selection.to
  const suggest = suggestOn()

  // ── Review nav (step through tracked changes; accept/discard) ──
  const navIdxRef = useRef(0)
  const nChanges = changeRanges(editor).length
  function goToChange(i: number) {
    const chs = changeRanges(editor)
    if (!chs.length) return
    const n = ((i % chs.length) + chs.length) % chs.length
    navIdxRef.current = n
    const c = chs[n]
    editor.chain().focus().setTextSelection({ from: c.from, to: c.to }).scrollIntoView().run()
    tick((x) => x + 1)
  }
  function resolveCurrent(mode: 'accept' | 'reject') {
    const chs = changeRanges(editor)
    if (!chs.length) return
    const n = Math.min(navIdxRef.current, chs.length - 1)
    resolveSuggestions(editor, mode, chs[n])
    navIdxRef.current = Math.max(0, n - (n >= chs.length - 1 ? 1 : 0))
    tick((x) => x + 1)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); resolveCurrent('accept') }
      else if (k === 's') { e.preventDefault(); resolveCurrent('reject') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToChange(navIdxRef.current + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goToChange(navIdxRef.current - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Set drop-up collapses on outside-click or any scroll — the same behaviour as the style menus.
  useEffect(() => {
    if (!setMenu) return
    const close = () => setSetMenu(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, { capture: true } as EventListenerOptions) }
  }, [setMenu])

  const pill = 'flex items-center justify-center h-8 px-3 rounded-full border text-sm font-serif transition-colors whitespace-nowrap'

  return createPortal(
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[95] flex items-center gap-2 px-3 py-1.5 iw-nightable bg-white rounded-full shadow-md"
      style={{ bottom, border: `1px solid ${INK}44` }}
      onMouseDown={(e) => e.stopPropagation()}
    >

      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addComment}
        disabled={!hasSelection}
        className={`${pill} ${hasSelection ? 'text-[#5c2d8a] border-[#5c2d8a]/40 hover:bg-stone-50' : 'text-stone-300 border-stone-200 cursor-default'}`}
        title={hasSelection ? 'Comment on the selected text' : 'Select text first, then comment'}>
        ＋ Comment
      </button>

      {/* Set (drop-up) */}
      <div className="relative">
        <button type="button" onClick={() => setSetMenu((o) => !o)}
          className={`${pill} text-stone-600 border-stone-200 hover:bg-stone-50`} title="Annotation set">
          <span style={{ color: reviewerColor(cur) }}>◆</span>&nbsp;{cur} ▾
        </button>
        {setMenu && (
          <div className="absolute bottom-full mb-2 left-0 min-w-[160px] iw-nightable bg-white rounded-lg shadow-lg py-1 text-sm"
            style={{ border: `1px solid ${INK}33` }}>
            {sets.map((s) => (
              <button key={s} type="button"
                onClick={() => { setActiveSet(s); setSetMenu(false) }}
                className="w-full text-left px-3 py-1.5 hover:bg-stone-50 flex items-center justify-between"
                style={{ color: s === cur ? INK : '#374151', fontWeight: s === cur ? 600 : 400 }}>
                <span><span style={{ color: reviewerColor(s) }}>◆</span> {s}</span>
                {sets.length > 1 && (
                  <span role="button" title="Delete this set's comments"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!confirm(`Delete all comments in "${s}"?`)) return
                      deleteSet(editor, s); if (activeSet() === s) setActiveSet(sets.find((x) => x !== s) || DEFAULT_SET)
                      setSetMenu(false)
                    }}
                    className="text-stone-300 hover:text-red-500 px-1">×</span>
                )}
              </button>
            ))}
            <div className="border-t border-stone-100 my-1" />
            <button type="button"
              onClick={() => { const name = prompt('New annotation set name:')?.trim(); if (name) setActiveSet(name); setSetMenu(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 text-stone-500">＋ New set…</button>
          </div>
        )}
      </div>

      {/* Review nav: step through tracked changes + accept/discard (Alt+A / Alt+S, Alt+←/→) */}
      {nChanges > 0 && (
        <div className="flex items-center gap-1 pl-1" style={{ borderLeft: '1px solid #e5e5e8' }}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToChange(navIdxRef.current - 1)}
            className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-stone-100" style={{ color: INK, fontSize: '1.15rem', lineHeight: 1 }} title="Previous change (Alt+←)">‹</button>
          <span className="tabular-nums font-serif" style={{ fontSize: '0.9rem', color: '#57534e', minWidth: '2.4em', textAlign: 'center' }}>{Math.min(navIdxRef.current + 1, nChanges)} <span style={{ color: '#b8b0a4' }}>/</span> {nChanges}</span>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToChange(navIdxRef.current + 1)}
            className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-stone-100" style={{ color: INK, fontSize: '1.15rem', lineHeight: 1 }} title="Next change (Alt+→)">›</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => resolveCurrent('accept')}
            className="flex items-center justify-center w-7 h-7 rounded-full text-green-700 hover:bg-green-50" title="Accept (Alt+A)">✓</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => resolveCurrent('reject')}
            className="flex items-center justify-center w-7 h-7 rounded-full text-red-600 hover:bg-red-50" title="Discard (Alt+S)">✗</button>
        </div>
      )}

      {/* Suggest (track changes) toggle */}
      <button type="button" onClick={() => setSuggestOn(!suggest)}
        className={`${pill} ${suggest ? 'text-white bg-[#5c2d8a] border-[#5c2d8a]' : 'text-stone-600 border-stone-200 hover:bg-stone-50'}`}
        title="Live suggestion mode — record edits as tracked changes">
        ✎ Suggest{suggest ? ' · on' : ''}
      </button>

      <button type="button" onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100" title="Close review">×</button>
    </div>,
    document.body,
  )
}

// Remove every comment mark belonging to a set (delete the whole set's annotations).
function deleteSet(editor: Editor, set: string) {
  const type = editor.schema.marks.comment
  if (!type) return
  const tr = editor.state.tr
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    if (node.marks.some((m) => m.type.name === 'comment' && m.attrs.set === set)) {
      tr.removeMark(pos, pos + node.nodeSize, type)
    }
  })
  editor.view.dispatch(tr)
}
