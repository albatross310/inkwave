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
import { highlightPages } from '../../citations/pdfHighlights'
import { hasPdf } from '../../citations/pdfSource'
import { openPdf, getLastPdfPage } from '../../citations/pdfViewer'
import { pageOffsetOf } from '../../citations/pageOffset'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import {
  bibAnchorId, citeAnchorId, navigateToAnchor, occurrenceCounts, ensureNavStyles,
  citedPages, formatPages, occurrencePages, occurrenceQuotes,
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

// The notes textarea lives INSIDE the editor DOM (the reference list is a document node), so editing
// events bubble up to ProseMirror's listener on view.dom. React's onKeyDown/onPaste fire too late to
// stop that (React delegates at the app root, ABOVE view.dom), so a Backspace/Enter/cut/paste in the
// notes field would ALSO run ProseMirror's keymap on the document — silently deleting or splitting the
// real prose. Binding NATIVE listeners on the textarea stops those events before they reach PM.
// input/beforeinput are deliberately left alone — React's onChange needs them to bubble to its root.
const STOP_TYPES = ['keydown', 'keyup', 'cut', 'copy', 'paste', 'drop', 'dragstart', 'mousedown', 'pointerdown', 'click']
function bindStopPM(el: HTMLTextAreaElement | null): void {
  const marked = el as (HTMLTextAreaElement & { _iwStopBound?: boolean }) | null
  if (!marked || marked._iwStopBound) return
  marked._iwStopBound = true
  const stop = (e: Event) => e.stopPropagation()
  for (const t of STOP_TYPES) marked.addEventListener(t, stop)
}

// Module-scope so its component identity is STABLE across the parent's re-renders. Defining it inside
// ReferenceListNodeView made it a fresh type on every setState (i.e. every keystroke → setDraft),
// which remounts the textarea and drops focus after one character.
function NotePanel({ value, onChange, onDelete }: { value: string; onChange: (v: string) => void; onDelete: () => void }) {
  return (
    <div style={{ margin: '0.25em 0 0 1.6em', paddingLeft: '0.7em', borderLeft: `2px solid ${INK}44`, position: 'relative' }}>
      <button
        type="button" contentEditable={false} onClick={onDelete} title="Delete note" aria-label="Delete note"
        style={{ position: 'absolute', top: 2, right: 4, background: 'transparent', border: 'none', color: '#9d174d', fontWeight: 700, fontSize: '1.15rem', lineHeight: 1, cursor: 'pointer', padding: '0 3px', zIndex: 1 }}
      >×</button>
      <textarea
        ref={bindStopPM}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Notes on this source…"
        rows={2}
        style={{
          width: '100%', resize: 'vertical', boxSizing: 'border-box',
          fontFamily: 'inherit', fontSize: '0.9em', lineHeight: 1.5, color: '#4a4a4a',
          background: 'rgba(92,45,138,0.03)', border: `1px solid ${INK}22`, borderRadius: 6,
          padding: '0.4em 1.6em 0.4em 0.55em', outline: 'none',
        }}
      />
    </div>
  )
}

// Back-reference markers — the DOCUMENT pages where a source is cited (from the pagination guides),
// each snapping back to that in-text citation. Falls back to occurrence ordinals when pages can't be
// measured (scroll / gapped mode). Pages are deduped so each appears once.
const escHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const firstWords = (q: string, n = 3) => q.trim().split(/\s+/).filter(Boolean).slice(0, n).join(' ')

// Back-refs label each in-text occurrence by its DOCUMENT PAGE (falling back to occurrence ordinal when
// pages can't be measured). Two citations on the same page become "3.1", "3.2" — both hyperlinked. Each
// shows the first few words of its pinpoint quote (if any) so the reader recalls which one it is.
function backrefHtml(key: string, occPages: Array<{ occ: number; page: number | null }>, quotes: string[]): string {
  if (!occPages.length) return ''
  const anyPage = occPages.some(o => o.page != null)
  const total = new Map<number, number>()
  if (anyPage) for (const o of occPages) if (o.page != null) total.set(o.page, (total.get(o.page) ?? 0) + 1)
  const running = new Map<number, number>()
  const marks = occPages.map(({ occ, page }) => {
    let label: string
    if (anyPage && page != null) {
      if ((total.get(page) ?? 1) > 1) { const i = (running.get(page) ?? 0) + 1; running.set(page, i); label = `${page}.${i}` }
      else label = `${page}`
    } else label = `${occ}`
    const words = firstWords(quotes[occ - 1] ?? '')
    const preview = words ? ` <span class="iw-backref-quote">${escHtml(words)}…</span>` : ''
    return `<a class="iw-cite-link iw-backref-mark" data-iw-nav="${citeAnchorId(key, occ)}" title="Go to ${anyPage && page != null ? `p. ${page}` : `citation ${occ}`}">${label}${preview}</a>`
  })
  return `<span class="iw-backref-group" contenteditable="false"><span class="iw-backref-arrow">↩</span> ${marks.join(' ')}</span>`
}

// The "+" (add) / "✎" (edit) note toggle appended inline to each entry.
function noteButtonHtml(key: string, hasNote: boolean): string {
  return `<button type="button" class="iw-note-add" data-iw-note="${key}" contenteditable="false" title="${hasNote ? 'Edit note' : 'Add note'}">${hasNote ? '✎' : '+'}</button>`
}

// "esp. pp 2, 4–6" — the pages this source is pinpointed to across its in-text citations. `raw` marks
// pages that are the PDF's own sheet numbers (Haiku page-offset detection failed) with a "†".
function espHtml(pages: number[], raw: boolean): string {
  if (!pages.length) return ''
  const label = pages.length === 1 ? 'esp. p' : 'esp. pp'
  const dagger = raw ? '<span title="These are the PDF’s own page numbers — automatic page-number detection was unavailable."> †</span>' : ''
  return `<span class="iw-esp" contenteditable="false"> ${label} ${formatPages(pages)}${dagger}.</span>`
}

// Inject the entry anchor id + esp-pages + back-refs + note button into a single `.csl-entry` html.
function decorateEntry(id: string, html: string, occPages: Array<{ occ: number; page: number | null }>, hasNote: boolean, pages: number[], raw: boolean, quotes: string[]): string {
  let out = html.replace(/^(\s*<[a-z]+)/i, `$1 id="${bibAnchorId(id)}"`)
  const trailing = espHtml(pages, raw) + backrefHtml(id, occPages, quotes) + noteButtonHtml(id, hasNote)
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
      const itemById = new Map(items.map(it => [it.id, it]))
      setEntries(formatted.map(([id, html]) => {
        const note = noteById.get(id) ?? ''
        const it = itemById.get(id)
        const off = pageOffsetOf(it)
        // esp. pp = pages cited in-text ∪ printed pages carrying a highlight (PDF sheet + offset).
        const pages = [...new Set([...citedPages(editor.state.doc, id), ...highlightPages(it).map(p => p + off)])].sort((a, b) => a - b)
        const raw = pages.length > 0 && (it as { _iw?: IwCitationMeta })?._iw?.pageOffsetFlag === 'raw'
        const occPages = occurrencePages(id, counts.get(id) ?? 0)
        const quotes = occurrenceQuotes(editor.state.doc, id)
        return { id, html: decorateEntry(id, html, occPages, !!note.trim(), pages, raw, quotes), occ: counts.get(id) ?? 0, note }
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
    // Editor UPDATES (typing) get a 350ms debounce on top — same fix CitationNodeView already has:
    // a rebuild is O(entries × docSize) (getJSON + occurrence/quote walks per entry + citeproc),
    // which is real mid-typing lag on a citation-heavy doc. Bib/style changes stay immediate.
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleDebounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(schedule, 350) }
    schedule()
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', scheduleDebounced)
    return () => { unsubBib(); unsubStyle(); editor.off('update', scheduleDebounced); if (timer) clearTimeout(timer) }
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

  const onDeleteNote = useCallback((id: string) => {
    clearTimeout(persistTimers.current[id])
    setDraft(d => ({ ...d, [id]: '' }))
    setOpenNotes(prev => { const n = new Set(prev); n.delete(id); return n })
    const item = bibProvider.get(id)
    if (item) {
      const iw: IwCitationMeta = { ...((item as { _iw?: IwCitationMeta })._iw ?? {}) }
      delete iw.note
      void addToLibrary({ ...item, _iw: iw })
    }
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
      return
    }
    // Clicking the reference entry itself opens its PDF where the reader last left off. Opened from the
    // bib → noRef, so any annotations made here never create inline page references (R6).
    const entry = (e.target as HTMLElement).closest('[id^="iwbib-"]') as HTMLElement | null
    if (entry) {
      const key = entry.id.slice('iwbib-'.length)
      const item = bibProvider.get(key)
      if (key && hasPdf(item)) {
        e.preventDefault(); e.stopPropagation()
        openPdf({ citekey: key, page: getLastPdfPage(key), label: key, noRef: true, instanceId: null })
      }
    }
  }

  // Hanging-indent styling on the rendered CSL entry (citeproc sets it inline on .csl-entry).
  const styleEntry = (el: HTMLDivElement | null) => {
    if (!el) return
    el.querySelectorAll<HTMLElement>('.csl-entry').forEach(e => { e.style.margin = '0'; e.style.display = 'inline' })
  }

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
              {openNotes.has(e.id) && <NotePanel value={draft[e.id] ?? e.note} onChange={v => onNoteChange(e.id, v)} onDelete={() => onDeleteNote(e.id)} />}
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
              {openNotes.has(p.id) && <NotePanel value={draft[p.id] ?? p.note} onChange={v => onNoteChange(p.id, v)} onDelete={() => onDeleteNote(p.id)} />}
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}
