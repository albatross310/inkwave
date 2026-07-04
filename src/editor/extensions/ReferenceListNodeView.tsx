// React NodeView for the reference-list section. Resolves the displayed keys (mode-driven) from the
// live document + bibProvider, then renders them with the real CSL engine in the doc's chosen style;
// falls back to a plain-text list if the CSL engine can't load. Re-renders on: document edits (the
// cited set changes), library changes, and style changes.
//
// Each entry carries a DOM anchor (iwbib-<key>) so in-text citations can scroll to it, a
// back-reference group ("↩ 1 2 3") linking back to each in-text occurrence, and a "+" button that
// opens an indented notes panel (persisted to the source's _iw.note). Navigation + note-toggle for
// the injected CSL html are event-delegated (React onClick can't bind inside dangerouslySetInnerHTML).

import { useEffect, useState, useCallback, useRef } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { addToLibrary } from '../../citations/library'
import { referenceListKeys } from '../../citations/resolve'
import { formatReferenceEntries, simpleRefList } from '../../citations/format'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import {
  bibAnchorId, citeAnchorId, navigateToAnchor, occurrenceCounts, ensureNavStyles,
} from '../../citations/citationNav'
import type { CSLItem, IwCitationMeta } from '../../types/document'
import type { RefMode } from '../../citations/resolve'

const INK = '#5c2d8a'

const MODE_LABEL: Record<RefMode, string> = {
  cited: 'auto — cited in this document',
  all: 'all library entries',
  manual: 'manually selected',
}

interface Entry { id: string; html: string; occ: number; note: string }

// Back-reference markers linking each reference entry to its in-text occurrences.
function backrefHtml(key: string, occ: number): string {
  if (occ <= 0) return ''
  const marks: string[] = []
  for (let n = 1; n <= occ; n++) {
    marks.push(`<a class="iw-cite-link" data-iw-nav="${citeAnchorId(key, n)}" title="Go to citation ${n}">${n}</a>`)
  }
  return `<span class="iw-backref-group" contenteditable="false"><span class="iw-backref-arrow">↩</span> ${marks.join(' ')}</span>`
}

// The "+" (add) / "✎" (edit) note toggle appended inline to each entry.
function noteButtonHtml(key: string, hasNote: boolean): string {
  return `<button type="button" class="iw-note-add" data-iw-note="${key}" contenteditable="false" title="${hasNote ? 'Edit note' : 'Add note'}">${hasNote ? '✎' : '+'}</button>`
}

// Inject the entry anchor id + back-refs + note button into a single `.csl-entry` html string.
function decorateEntry(id: string, html: string, occ: number, hasNote: boolean): string {
  let out = html.replace(/^(\s*<[a-z]+)/i, `$1 id="${bibAnchorId(id)}"`)
  const trailing = backrefHtml(id, occ) + noteButtonHtml(id, hasNote)
  out = out.replace(/<\/[a-z]+>\s*$/i, m => `${trailing}${m}`)
  return out
}

const noteOf = (item: CSLItem): string => ((item as { _iw?: IwCitationMeta })._iw?.note ?? '')

export function ReferenceListNodeView({ node, editor, selected }: NodeViewProps) {
  const mode = (node.attrs.mode as RefMode) ?? 'cited'
  const [entries, setEntries] = useState<Entry[]>([])
  const [plain, setPlain] = useState<Array<{ id: string; text: string; occ: number; note: string }>>([])
  const [usingCsl, setUsingCsl] = useState(true)
  const [count, setCount] = useState(0)

  // Notes UI state. openNotes = which panels are shown; draft = live textarea text (survives rebuilds
  // so typing never jumps); autoOpened guards one-time auto-open of entries that already have a note.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<Record<string, string>>({})
  const autoOpenedRef = useRef<Set<string>>(new Set())
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const rebuild = useCallback(async () => {
    const keys = referenceListKeys(editor.getJSON())
    const items: CSLItem[] = []
    for (const k of keys) { const it = bibProvider.get(k); if (it) items.push(it) }
    const counts = occurrenceCounts(editor.state.doc)
    setCount(items.length)
    if (items.length === 0) { setEntries([]); setPlain([]); return }

    // Auto-open (once) any entry that already has a saved note.
    const toAutoOpen: string[] = []
    for (const it of items) {
      if (noteOf(it).trim() && !autoOpenedRef.current.has(it.id)) {
        autoOpenedRef.current.add(it.id)
        toAutoOpen.push(it.id)
      }
    }
    if (toAutoOpen.length) setOpenNotes(prev => { const n = new Set(prev); toAutoOpen.forEach(id => n.add(id)); return n })

    try {
      const formatted = await formatReferenceEntries(items, getCitationStyle())
      const noteById = new Map(items.map(it => [it.id, noteOf(it)]))
      setEntries(formatted.map(([id, html]) => {
        const note = noteById.get(id) ?? ''
        return { id, html: decorateEntry(id, html, counts.get(id) ?? 0, !!note.trim()), occ: counts.get(id) ?? 0, note }
      }))
      setUsingCsl(true)
      setPlain([])
    } catch {
      setUsingCsl(false)
      setEntries([])
      setPlain(items.map(it => ({ id: it.id, text: simpleRefList([it]), occ: counts.get(it.id) ?? 0, note: noteOf(it) })))
    }
  }, [editor])

  useEffect(() => { ensureNavStyles() }, [])

  useEffect(() => {
    // Defer rebuilds to a microtask so the setState never runs synchronously inside a ProseMirror
    // transaction dispatch (which would provoke React's flushSync-during-render warning).
    const schedule = () => queueMicrotask(() => void rebuild())
    schedule()
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', schedule)
    return () => { unsubBib(); unsubStyle(); editor.off('update', schedule) }
  }, [rebuild, editor, node.attrs])

  // ── Notes ──────────────────────────────────────────────────────────────────
  const toggleNote = useCallback((id: string) => {
    setOpenNotes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const onNoteChange = useCallback((id: string, value: string) => {
    setDraft(d => ({ ...d, [id]: value }))
    clearTimeout(persistTimers.current[id])
    persistTimers.current[id] = setTimeout(() => {
      const item = bibProvider.get(id)
      if (!item) return
      const iw: IwCitationMeta = { ...((item as { _iw?: IwCitationMeta })._iw ?? {}) }
      if (value.trim()) iw.note = value; else delete iw.note
      void addToLibrary({ ...item, _iw: iw })
    }, 500)
  }, [])
  useEffect(() => () => { Object.values(persistTimers.current).forEach(clearTimeout) }, [])

  // Event-delegated nav + note-toggle for the injected CSL html.
  const onBodyClick = (e: React.MouseEvent) => {
    const nav = (e.target as HTMLElement).closest('[data-iw-nav]')
    if (nav) {
      e.preventDefault(); e.stopPropagation()
      const id = nav.getAttribute('data-iw-nav'); if (id) navigateToAnchor(id)
      return
    }
    const noteBtn = (e.target as HTMLElement).closest('[data-iw-note]')
    if (noteBtn) {
      e.preventDefault(); e.stopPropagation()
      const id = noteBtn.getAttribute('data-iw-note'); if (id) toggleNote(id)
    }
  }

  // Hanging-indent styling on the rendered CSL entry (citeproc sets it inline on .csl-entry).
  const styleEntry = (el: HTMLDivElement | null) => {
    if (!el) return
    el.querySelectorAll<HTMLElement>('.csl-entry').forEach(e => { e.style.margin = '0'; e.style.display = 'inline' })
  }

  const NotePanel = ({ id, note }: { id: string; note: string }) => (
    <div style={{
      margin: '0.25em 0 0 1.6em', paddingLeft: '0.7em',
      borderLeft: `2px solid ${INK}44`,
    }}>
      <textarea
        value={draft[id] ?? note}
        onChange={e => onNoteChange(id, e.target.value)}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        placeholder="Notes on this source…"
        rows={2}
        style={{
          width: '100%', resize: 'vertical', boxSizing: 'border-box',
          fontFamily: 'inherit', fontSize: '0.9em', lineHeight: 1.5, color: '#4a4a4a',
          background: 'rgba(92,45,138,0.03)', border: `1px solid ${INK}22`, borderRadius: 6,
          padding: '0.4em 0.55em', outline: 'none',
        }}
      />
    </div>
  )

  return (
    <NodeViewWrapper
      as="section"
      contentEditable={false}
      style={{
        marginTop: '2.5em',
        paddingTop: '1em',
        borderTop: `1px solid ${INK}33`,
        outline: selected ? `2px solid ${INK}55` : 'none',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6em' }}>
        <h2 style={{ fontSize: '1.15em', fontWeight: 600, color: INK, margin: 0 }}>References</h2>
        <span style={{ fontSize: '0.7em', color: '#9ca3af', fontStyle: 'italic' }}>{MODE_LABEL[mode]}</span>
      </div>
      {count === 0 ? (
        <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '0.9em' }}>
          No references yet — cite a source and it will appear here.
        </p>
      ) : usingCsl ? (
        <div className="csl-bib-body" style={{ fontSize: '0.92em', lineHeight: 1.5 }} onClick={onBodyClick}>
          {entries.map(e => (
            <div key={e.id} className="iw-bib-entry" style={{ marginBottom: '0.75em' }}>
              <div ref={styleEntry} dangerouslySetInnerHTML={{ __html: e.html }} />
              {openNotes.has(e.id) && <NotePanel id={e.id} note={e.note} />}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '0.92em', lineHeight: 1.5 }} onClick={onBodyClick}>
          {plain.map(p => (
            <div key={p.id} className="iw-bib-entry" style={{ marginBottom: '0.6em' }}>
              <p id={bibAnchorId(p.id)} style={{ margin: 0, paddingLeft: '1.5em', textIndent: '-1.5em' }}>
                {p.text}
                {p.occ > 0 && (
                  <span className="iw-backref-group" style={{ textIndent: 0 }}>
                    {' '}<span className="iw-backref-arrow">↩</span>{' '}
                    {Array.from({ length: p.occ }, (_, i) => (
                      <a key={i} className="iw-cite-link" data-iw-nav={citeAnchorId(p.id, i + 1)}
                        title={`Go to citation ${i + 1}`}>{i + 1}{i < p.occ - 1 ? ' ' : ''}</a>
                    ))}
                  </span>
                )}
                <button type="button" className="iw-note-add" data-iw-note={p.id}
                  title={p.note.trim() ? 'Edit note' : 'Add note'}>{p.note.trim() ? '✎' : '+'}</button>
              </p>
              {openNotes.has(p.id) && <NotePanel id={p.id} note={p.note} />}
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}
