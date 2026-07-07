// React NodeView for the reference-list section. Resolves the displayed keys (mode-driven) from the
// live document + bibProvider, then renders them with the real CSL engine in the doc's chosen style;
// falls back to a plain-text list if the CSL engine can't load. Re-renders on: document edits (the
// cited set changes), library changes, and style changes.
//
// Each entry carries a DOM anchor (iwbib-<key>) so in-text citations can scroll to it, a
// back-reference group ("↩ 1 2 3") linking back to each in-text occurrence, and a "+" button that
// opens an indented notes panel (persisted to the source's _iw.note). Navigation + note-toggle for
// the injected CSL html are event-delegated (React onClick can't bind inside dangerouslySetInnerHTML).

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { gappedPagesEnabled } from '../pageView'
import { MARGIN_TOP, MARGIN_BOTTOM } from './PaginationExtension'
import { bibProvider } from '../../citations/bibProvider'
import { addToLibrary } from '../../citations/library'
import { referenceListKeys } from '../../citations/resolve'
import { formatReferenceEntries, simpleRefList } from '../../citations/format'
import { highlightPages } from '../../citations/pdfHighlights'
import { pageOffsetOf } from '../../citations/pageOffset'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import {
  bibAnchorId, citeAnchorId, navigateToAnchor, occurrenceCounts, ensureNavStyles,
  citedPages, formatPages, occurrencePages,
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
function NotePanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ margin: '0.25em 0 0 1.6em', paddingLeft: '0.7em', borderLeft: `2px solid ${INK}44` }}>
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
          padding: '0.4em 0.55em', outline: 'none',
        }}
      />
    </div>
  )
}

// Back-reference markers — the DOCUMENT pages where a source is cited (from the pagination guides),
// each snapping back to that in-text citation. Falls back to occurrence ordinals when pages can't be
// measured (scroll / gapped mode). Pages are deduped so each appears once.
function backrefHtml(key: string, occPages: Array<{ occ: number; page: number | null }>): string {
  if (!occPages.length) return ''
  const anyPage = occPages.some(o => o.page != null)
  const seen = new Set<number>()
  const marks: string[] = []
  for (const { occ, page } of occPages) {
    if (anyPage) {
      if (page == null || seen.has(page)) continue
      seen.add(page)
      marks.push(`<a class="iw-cite-link" data-iw-nav="${citeAnchorId(key, occ)}" title="Go to page ${page}">${page}</a>`)
    } else {
      marks.push(`<a class="iw-cite-link" data-iw-nav="${citeAnchorId(key, occ)}" title="Go to citation ${occ}">${occ}</a>`)
    }
  }
  if (!marks.length) return ''
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
function decorateEntry(id: string, html: string, occPages: Array<{ occ: number; page: number | null }>, hasNote: boolean, pages: number[], raw: boolean): string {
  let out = html.replace(/^(\s*<[a-z]+)/i, `$1 id="${bibAnchorId(id)}"`)
  const trailing = espHtml(pages, raw) + backrefHtml(id, occPages) + noteButtonHtml(id, hasNote)
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
        return { id, html: decorateEntry(id, html, occPages, !!note.trim(), pages, raw), occ: counts.get(id) ?? 0, note }
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

  // ── Self-paginate the bibliography (gapped mode) ──────────────────────────────
  // The reference list is a single atom node, so the paginator can't insert a page break INSIDE it — a
  // long bibliography would spill across the sheet gaps. Fix (Peter's "break it where the page break is"):
  // read the already-painted sheet grid (.inkwave-sheet panels) and nudge any entry that would overflow a
  // sheet's text area down to the top of the next sheet's text area, via margin-top. Pure DOM styling in
  // gapped mode only — no effect on the doc content, pmToText, or provenance. Idempotent + convergence-
  // guarded (re-applying the same margins doesn't resize, so the ResizeObserver settles).
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const body = bodyRef.current
    const clear = () => body?.querySelectorAll<HTMLElement>('.iw-bib-entry').forEach(e => { e.style.marginTop = '' })
    if (!body || !gappedPagesEnabled()) { clear(); return }
    const paper = body.closest('.scroll-paper') as HTMLElement | null
    if (!paper) return
    let raf = 0
    const relayout = () => {
      raf = 0
      const sheets = Array.from(paper.querySelectorAll<HTMLElement>('.inkwave-sheet'))
      const entries = Array.from(body.querySelectorAll<HTMLElement>('.iw-bib-entry'))
      if (!sheets.length || !entries.length) return
      entries.forEach(e => { e.style.marginTop = '' })       // reset, then measure natural flow
      void body.offsetHeight
      const sr = sheets.map(s => s.getBoundingClientRect())
      for (const entry of entries) {
        const r = entry.getBoundingClientRect()
        // The sheet this entry currently starts on (top within [sheetTop, sheetBottom)).
        const si = sr.findIndex(s => r.top >= s.top - 1 && r.top < s.bottom - 1)
        if (si < 0 || si + 1 >= sr.length) continue
        const contentBottom = sr[si].bottom - MARGIN_BOTTOM  // last usable Y on this sheet
        if (r.bottom > contentBottom) {
          const push = Math.round((sr[si + 1].top + MARGIN_TOP) - r.top)
          if (push > 0) { entry.style.marginTop = `${push}px`; void body.offsetHeight } // reflow so the next entry measures post-push
        }
      }
      // No manual reschedule: if these margins grew the page, the paginator repaints (adds a sheet) and
      // the ResizeObserver below fires one more pass. When the margins stop changing the layout, the RO
      // goes quiet — a natural fixed point (no rAF loop).
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(relayout) }
    schedule()
    const ro = new ResizeObserver(() => schedule())
    ro.observe(paper)
    window.addEventListener('inkwave:page-settings-changed', schedule)
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('inkwave:page-settings-changed', schedule); clear() }
  }, [entries, plain, usingCsl, openNotes])

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
        <div ref={bodyRef} className="csl-bib-body" style={{ fontSize: '0.92em', lineHeight: 1.5 }} onClick={onBodyClick}>
          {entries.map(e => (
            <div key={e.id} className="iw-bib-entry" style={{ marginBottom: '0.75em' }}>
              <div ref={styleEntry} dangerouslySetInnerHTML={{ __html: e.html }} />
              {openNotes.has(e.id) && <NotePanel value={draft[e.id] ?? e.note} onChange={v => onNoteChange(e.id, v)} />}
            </div>
          ))}
        </div>
      ) : (
        <div ref={bodyRef} style={{ fontSize: '0.92em', lineHeight: 1.5 }} onClick={onBodyClick}>
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
              {openNotes.has(p.id) && <NotePanel value={draft[p.id] ?? p.note} onChange={v => onNoteChange(p.id, v)} />}
            </div>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}
