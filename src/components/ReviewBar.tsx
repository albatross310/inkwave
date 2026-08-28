// ReviewBar — the review-mode control strip (shown when the R button is toggled on). Add a comment on
// the selection, pick/create the active annotation SET (drop-up, with per-layer show/hide eyes + a
// global show-changes toggle), toggle live suggestion mode, and step through changes. Styled to match
// the footer toolbar. Sits just above the footer.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { Editor } from '@tiptap/react'
import {
  activeSet, setActiveSet, suggestOn, setSuggestOn, onReviewChanged, DEFAULT_SET,
  showChangesGlobal, setShowChangesGlobal, isSetHidden, setSetHidden, isSetVisible,
} from '../editor/review/reviewState'
import { resolveSuggestions, reviewerColor } from '../editor/extensions/TrackChanges'

const INK = '#5c2d8a'

// Small stroke eye (open / struck-through) for the visibility toggles — inherits currentColor.
function Eye({ off, size = 15 }: { off?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

// Contiguous runs of tracked-change text (insertion or deletion), in document order — the units the
// review nav steps through and accept/discard act on. Runs never span layers, and HIDDEN layers
// (per-set eye / global show-changes off) are skipped so the nav only visits what's on screen.
function changeRanges(editor: Editor): Array<{ from: number; to: number; kind: 'ins' | 'del' }> {
  const out: Array<{ from: number; to: number; kind: 'ins' | 'del' }> = []
  let cur: { from: number; to: number; kind: 'ins' | 'del'; set: string } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) { cur = null; return }
    const mark = node.marks.find((m) => m.type.name === 'insertion' || m.type.name === 'deletion')
    if (!mark) { cur = null; return }
    const kind: 'ins' | 'del' = mark.type.name === 'insertion' ? 'ins' : 'del'
    const set = (mark.attrs.set as string) || DEFAULT_SET
    if (!isSetVisible(set)) { cur = null; return }
    if (cur && cur.kind === kind && cur.set === set && cur.to === pos) cur.to = pos + node.nodeSize
    else { cur = { from: pos, to: pos + node.nodeSize, kind, set }; out.push(cur) }
  })
  return out
}

// Distinct comment/suggestion sets present in the doc, plus the default + active, for the drop-up.
function docSets(editor: Editor): string[] {
  const s = new Set<string>([DEFAULT_SET, activeSet()])
  editor.state.doc.descendants((node) => {
    if (!node.isText) return
    for (const m of node.marks) {
      if ((m.type.name === 'comment' || m.type.name === 'insertion' || m.type.name === 'deletion') && m.attrs.set) {
        s.add(m.attrs.set as string)
      }
    }
  })
  return [...s]
}

export function ReviewBar({ editor, phone }: { editor: Editor; phone?: boolean }) {
  const [rev, tick] = useState(0)
  useEffect(() => {
    const bump = () => tick((n) => n + 1)
    editor.on('update', bump)
    const off = onReviewChanged(bump)
    return () => { editor.off('update', bump); off() }
  }, [editor])
  const [setMenu, setSetMenu] = useState(false)

  // Only scan the doc for set names when the drop-up is actually open — `sets` renders nowhere
  // else, and this full-doc walk was riding the R-tap's frame (bar-open lag, 2026-07-11).
  const sets = useMemo(() => (setMenu ? docSets(editor) : []), [editor, setMenu])
  const cur = activeSet()
  const showAll = showChangesGlobal()

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
  // Memoed on `rev` (bumped by editor updates + review-state changes): parent re-renders — every
  // footer toggle re-renders the whole editor tree — must not re-walk the doc.
  const nChanges = useMemo(() => changeRanges(editor).length, [editor, rev])
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

  // The drop-up renders through a PORTAL (the review row lives in a 60px overflow-hidden animated
  // container that would clip it) — fixed above the trigger, with a backdrop that closes on
  // outside-press, the same idiom as the StyleBar pickers.
  const setBtnRef = useRef<HTMLButtonElement>(null)
  function aboveTrigger(): React.CSSProperties {
    const br = setBtnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: 10 }
    const vh = window.visualViewport?.height ?? window.innerHeight
    return { position: 'fixed', bottom: Math.max(8, Math.round(vh - br.top + 8)), left: Math.max(8, Math.round(br.left)) }
  }

  // Phone: everything ~25% bigger for comfortable tapping (the bar still fits the 60px row).
  const btnH = phone ? 'h-10' : 'h-8'
  const iconBtn = phone ? 'w-11 h-10' : 'w-9 h-8'
  const pill = `flex items-center justify-center ${btnH} px-2.5 rounded-full border text-sm font-serif transition-colors whitespace-nowrap`

  // Rendered INLINE as the second row of the main toolbar (merged rectangle). No portal, no fixed pill.
  return (
    <div
      className={`flex items-center ${phone ? 'gap-1.5 px-2' : 'gap-2 px-3'} py-1.5 border-t border-stone-200 iw-nightable`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Set (drop-up) — the trigger truncates long layer names so the nav cluster always fits */}
      <div className="relative">
        <button ref={setBtnRef} type="button" onClick={() => setSetMenu((o) => !o)}
          className={`${pill} text-stone-600 border-stone-200 hover:bg-stone-50`} title="Annotation set">
          <span style={{ color: reviewerColor(cur) }}>◆</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: phone ? '4.5em' : '5.5em', margin: '0 0.3em 0 0.3em' }}>{cur}</span>
          ▾
        </button>
        {setMenu && createPortal(
          <><div className="fixed inset-0 z-[98]" onMouseDown={() => setSetMenu(false)} />
          <div className="z-[99] min-w-[190px] iw-touch-guard iw-nightable bg-white rounded-lg shadow-lg py-1 text-sm"
            style={{ ...aboveTrigger(), border: `1px solid ${INK}33` }}
            onMouseDown={(e) => e.stopPropagation()}>
            {/* Global show/hide — the MS-Word markup toggle: clean (as-if-accepted) vs marked-up */}
            <button type="button"
              onClick={() => setShowChangesGlobal(!showAll)}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 flex items-center gap-2"
              style={{ color: showAll ? '#374151' : '#9ca3af' }}
              title={showAll ? 'Hide all changes (clean, as-if-accepted view — suggestions are kept)' : 'Show tracked changes'}>
              <Eye off={!showAll} />
              <span>{showAll ? 'Showing changes' : 'Changes hidden'}</span>
            </button>
            <div className="border-t border-stone-100 my-1" />
            {sets.map((s) => {
              const hidden = isSetHidden(s)
              return (
                <div key={s}
                  className="w-full px-3 py-1.5 hover:bg-stone-50 flex items-center justify-between gap-2 cursor-pointer"
                  onClick={() => { setActiveSet(s); setSetMenu(false) }}
                  style={{ color: s === cur ? INK : '#374151', fontWeight: s === cur ? 600 : 400 }}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ opacity: hidden || !showAll ? 0.45 : 1 }}>
                    <span style={{ color: reviewerColor(s) }}>◆</span> {s}
                  </span>
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    {/* Per-layer visibility eye (greyed while the global toggle hides everything) */}
                    <span role="button" title={hidden ? `Show "${s}"` : `Hide "${s}" (its suggestions stay, unmarked)`}
                      onClick={(e) => { e.stopPropagation(); setSetHidden(s, !hidden) }}
                      className="px-1 flex items-center"
                      style={{ color: hidden ? '#b8b0a4' : 'var(--iw-pill-fg, #78716c)', opacity: showAll ? 1 : 0.4 }}>
                      <Eye off={hidden} size={14} />
                    </span>
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
                  </span>
                </div>
              )
            })}
            <div className="border-t border-stone-100 my-1" />
            {/* ⚠ THE WAY OUT (2026-08-28, Peter: "stop the text from going red"). Until this, the
                ONLY way to clear tracked changes was ✓/✗ one at a time — so a writer who had been
                in suggestion mode without realising had to step through every insertion to get
                their prose back to black. A document-wide accept is what an unnoticed session in
                the mode actually needs, and its opposite (discard everything suggested) is what
                someone who never wanted the mode needs. Both are confirm()-gated because both
                change the document irreversibly, and both are hidden when there is nothing to
                resolve rather than sitting there as dead entries. */}
            {nChanges > 0 && (<>
            <button type="button"
              onClick={() => {
                if (!confirm(`Accept all ${nChanges} tracked change${nChanges === 1 ? '' : 's'}? The suggested text becomes ordinary text.`)) return
                resolveSuggestions(editor, 'accept'); setSetMenu(false); tick((x) => x + 1)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 flex items-center gap-2"
              style={{ color: '#374151' }}
              title="Accept every tracked change in this document">
              <span className="text-green-700">✓</span><span>Accept all changes</span>
            </button>
            <button type="button"
              onClick={() => {
                if (!confirm(`Discard all ${nChanges} tracked change${nChanges === 1 ? '' : 's'}? Suggested text is removed and suggested deletions are kept.`)) return
                resolveSuggestions(editor, 'reject'); setSetMenu(false); tick((x) => x + 1)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 flex items-center gap-2"
              style={{ color: '#374151' }}
              title="Discard every tracked change in this document">
              <span className="text-red-600">✗</span><span>Discard all changes</span>
            </button>
            <div className="border-t border-stone-100 my-1" />
            </>)}
            <button type="button"
              onClick={() => { const name = prompt('New annotation set name:')?.trim(); if (name) setActiveSet(name); setSetMenu(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 text-stone-500">＋ New set…</button>
          </div></>,
          document.body,
        )}
      </div>

      {/* Review nav — compact chevrons, tight cluster (Alt+A/S, Alt+←/→) */}
      {nChanges > 0 && (
        <div className="flex items-center pl-1" style={{ borderLeft: '1px solid #e5e5e8' }}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToChange(navIdxRef.current - 1)}
            className={`flex items-center justify-center ${phone ? 'w-6' : 'w-4'} ${btnH} rounded hover:bg-stone-100`} style={{ color: INK, fontSize: '1.25rem', lineHeight: 1 }} title="Previous change (Alt+←)">‹</button>
          <span className="tabular-nums font-serif" style={{ fontSize: '0.9rem', color: '#57534e', minWidth: '1.9em', textAlign: 'center' }}>{Math.min(navIdxRef.current + 1, nChanges)}<span style={{ color: '#b8b0a4' }}>/</span>{nChanges}</span>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToChange(navIdxRef.current + 1)}
            className={`flex items-center justify-center ${phone ? 'w-6' : 'w-4'} ${btnH} rounded hover:bg-stone-100`} style={{ color: INK, fontSize: '1.25rem', lineHeight: 1 }} title="Next change (Alt+→)">›</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => resolveCurrent('accept')}
            className={`flex items-center justify-center ${phone ? 'w-8' : 'w-6'} ${btnH} rounded text-green-700 hover:bg-green-50`} title="Accept (Alt+A)">✓</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => resolveCurrent('reject')}
            className={`flex items-center justify-center ${phone ? 'w-8' : 'w-6'} ${btnH} rounded text-red-600 hover:bg-red-50`} title="Discard (Alt+S)">✗</button>
        </div>
      )}

      {/* Suggest (track changes) toggle — icon only when expanded */}
      <button type="button" onClick={() => setSuggestOn(!suggest)}
        className={`flex items-center justify-center ${iconBtn} rounded-full border text-base transition-colors ${suggest ? 'text-white bg-[#5c2d8a] border-[#5c2d8a]' : 'text-stone-600 border-stone-200 hover:bg-stone-50'}`}
        title={`Live suggestion mode${suggest ? ' — on' : ''} (record edits as tracked changes)`}>
        ✎
      </button>

      {/* Comment on selection — icon only, pushed to the right edge of the bar */}
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addComment}
        disabled={!hasSelection}
        className={`ml-auto flex items-center justify-center ${iconBtn} rounded-full border text-lg ${hasSelection ? 'text-[#5c2d8a] border-[#5c2d8a]/40 hover:bg-stone-50' : 'text-stone-300 border-stone-200 cursor-default'}`}
        title={hasSelection ? 'Comment on the selected text' : 'Select text first, then comment'}>
        ＋
      </button>
    </div>
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
