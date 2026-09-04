// CommentNotes — review comments drawn as sticky notes in the parchment's right gutter (over the wave),
// aligned to the vertical position of the text they annotate. No side panel: the notes float beside
// their anchor and reposition on scroll/resize/edit. Click a note to edit its text (blank = delete).
// Only comments in the ACTIVE set are shown. Data lives on the CommentMark in the doc (see CommentMark).

import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { activeSet, onReviewChanged, isSetVisible } from '../editor/review/reviewState'
import { subscribe as subscribeMagnify } from '../editor/magnify'

const INK = '#35283e'

interface CommentInfo { id: string; body: string; from: number; to: number }

// Walk the doc, gathering every comment mark in the active set as { id, body, from..to }.
// A hidden layer (per-set eye / global show-changes off) shows no notes either.
function collectComments(editor: Editor): CommentInfo[] {
  const set = activeSet()
  if (!isSetVisible(set)) return []
  const byId: Record<string, CommentInfo> = {}
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      if (m.type.name === 'comment' && m.attrs.set === set && m.attrs.id) {
        const id = m.attrs.id as string
        if (!byId[id]) byId[id] = { id, body: m.attrs.body ?? '', from: pos, to: pos + node.nodeSize }
        else byId[id].to = pos + node.nodeSize
      }
    }
  })
  return Object.values(byId)
}

export function CommentNotes({ editor, paperRef }: { editor: Editor; paperRef: RefObject<HTMLDivElement> }) {
  const [comments, setComments] = useState<CommentInfo[]>([])
  const [, tick] = useState(0)          // bump to re-read DOM rects (scroll/resize)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapse = (id: string) => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Re-collect on edits (DEBOUNCED — the doc scan is O(n), so never run it per-keystroke) + set changes.
  useEffect(() => {
    const collect = () => setComments(collectComments(editor))
    collect()
    let t: ReturnType<typeof setTimeout> | undefined
    const debounced = () => { clearTimeout(t); t = setTimeout(collect, 250) }
    editor.on('update', debounced)
    const off = onReviewChanged(collect)
    return () => { clearTimeout(t); editor.off('update', debounced); off() }
  }, [editor])

  // A newly-added comment (from the ReviewBar) opens straight into edit mode so you can type the note.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) { setDraft(''); setEditingId(id) }
    }
    window.addEventListener('inkwave:edit-comment', onEdit)
    return () => window.removeEventListener('inkwave:edit-comment', onEdit)
  }, [])

  // Reposition (re-read anchor rects) on any scroll or resize — and on magnify changes (the notes
  // live in a fixed viewport-space overlay, so they must follow the paper's scaled rects).
  useEffect(() => {
    let raf = 0
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; tick(n => n + 1) }) }
    window.addEventListener('scroll', on, { capture: true, passive: true })
    window.addEventListener('resize', on)
    const unsubMagnify = subscribeMagnify(on)
    return () => {
      window.removeEventListener('scroll', on, { capture: true } as EventListenerOptions)
      window.removeEventListener('resize', on)
      unsubMagnify()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  function saveEdit(c: CommentInfo) {
    const body = draft.trim()
    setEditingId(null)
    if (body === (c.body ?? '')) return
    if (!body) { // blank → delete
      editor.chain().setTextSelection({ from: c.from, to: c.to }).unsetComment().run()
      return
    }
    editor.chain().setTextSelection({ from: c.from, to: c.to })
      .setComment({ id: c.id, body, set: activeSet(), createdAt: new Date().toISOString() }).run()
  }

  if (!comments.length && !editingId) return null

  const paperRight = paperRef.current?.getBoundingClientRect().right ?? 0
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const left = Math.min(paperRight + 12, vw - 236)   // clamp so the note never leaves the viewport
  const width = Math.max(150, Math.min(224, vw - left - 8))

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      {comments.map((c) => {
        const el = document.querySelector(`[data-comment-id="${CSS.escape(c.id)}"]`) as HTMLElement | null
        if (!el) return null
        const r = el.getBoundingClientRect()
        if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return null // off-screen
        const editing = editingId === c.id

        // Collapsed → a small yellow "+" circle on the right, clear of the text. Click to expand.
        if (collapsed.has(c.id) && !editing) {
          return (
            <button key={c.id} type="button" onMouseDown={(e) => e.stopPropagation()}
              onClick={() => toggleCollapse(c.id)} title={c.body ? c.body : 'Show comment'}
              style={{
                position: 'absolute', top: Math.round(r.top), left, width: 26, height: 26, borderRadius: '50%',
                pointerEvents: 'auto', background: '#fde047', border: `1px solid ${INK}66`, color: INK,
                boxShadow: '0 2px 6px rgba(80,50,10,0.22)', fontSize: 15, lineHeight: 1, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>+</button>
          )
        }
        return (
          <div
            key={c.id}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: Math.round(r.top), left, width,
              pointerEvents: 'auto',
              background: '#fffdf7', border: `1px solid ${INK}44`, borderLeft: `3px solid ${INK}`,
              borderRadius: 7, padding: '6px 8px', boxShadow: '0 2px 8px rgba(80,50,10,0.18)',
              fontFamily: "'EB Garamond', Georgia, serif", fontSize: '0.86rem', lineHeight: 1.4, color: '#3a2a1a',
            }}
          >
            {!editing && (
              <button type="button" onClick={() => toggleCollapse(c.id)} title="Collapse to a dot"
                style={{ position: 'absolute', top: 2, right: 4, border: 'none', background: 'transparent', color: '#b0a08c', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>−</button>
            )}
            {editing ? (
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => saveEdit(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(c) }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingId(null) }
                }}
                placeholder="Comment… (blank to delete)"
                style={{ width: '100%', minHeight: 46, resize: 'vertical', border: 'none', outline: 'none',
                  background: 'transparent', font: 'inherit', color: 'inherit' }}
              />
            ) : (
              <div
                onClick={() => { setDraft(c.body ?? ''); setEditingId(c.id) }}
                title="Click to edit (blank to delete)"
                style={{ cursor: 'text', whiteSpace: 'pre-wrap', minHeight: '1.2em' }}
              >
                {c.body || <span style={{ color: '#b0a08c', fontStyle: 'italic' }}>empty note</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
