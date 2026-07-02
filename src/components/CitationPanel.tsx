// Unified Citation Panel — opened by the ‟ toolbar button. One place for everything:
//   • a URL/DOI capture bar (paste a DOI/URL to add a source; free text filters the library)
//   • the master list of every saved citation, each with a "used in document?" flag, a source
//     badge (verified / AI / manual), a tick (manual-mode inclusion), cite + edit + delete actions
//   • the reference-list controls: the 3-mode toggle (Auto/All/Manual) + a style picker
// Replaces the old Zotero/BBT BibPanel + ZoteroSetup. See citations spec §10.

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { bibProvider } from '../citations/bibProvider'
import { CSL_STYLES } from '../citations/styles'
import { usedCitekeys, referenceListConfig, type RefMode } from '../citations/resolve'
import { captureFromInput, parseAuthor, parseDate } from '../citations/capture'
import { detectIdentifier, isUrl } from '../citations/identifiers'
import { addToLibrary, removeFromLibrary } from '../citations/library'
import { simpleInText } from '../citations/format'
import type { CSLItem, FieldSource, IwCitationMeta } from '../types/document'

const INK = '#5c2d8a'

interface Props {
  editor: Editor
  citationStyle: string
  onStyleChange: (s: string) => void
  onClose: () => void
  btnRef?: RefObject<HTMLElement | null>
  initialCapture?: string | null              // a shared URL (PWA share target) to auto-capture on open
  onInitialCaptureConsumed?: () => void
}

const SOURCE_BADGE: Record<FieldSource, { label: string; color: string }> = {
  crossref: { label: 'verified', color: '#15803d' },
  ai:       { label: 'AI',       color: '#b45309' },
  manual:   { label: 'manual',   color: '#6b7280' },
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  'article-journal': 'Journal article',
  'webpage':         'Webpage',
  'post-weblog':     'Blog post',
  'article-newspaper': 'News article',
  'report':          'Report',
  'book':            'Book',
  'chapter':         'Book chapter',
  'paper-conference':'Conference paper',
  'thesis':          'Thesis',
  'video':           'Video',
}

function itemSource(item: CSLItem): FieldSource {
  const meta = (item as { _iw?: IwCitationMeta })._iw
  const fields = meta?.fields
  if (!fields) return 'manual'
  const vals = Object.values(fields)
  if (vals.some(f => f.source === 'ai')) return 'ai'
  if (vals.some(f => f.source === 'crossref')) return 'crossref'
  return 'manual'
}

// Format CSL author array → "Given Family; Given2 Family2" for editing.
function authorsToString(authors: CSLItem['author']): string {
  if (!authors?.length) return ''
  return authors.map(a => {
    if (a.literal) return a.literal
    const parts = [a.given, a.family].filter(Boolean)
    return parts.join(' ')
  }).join('; ')
}

// ─── Edit dialog ────────────────────────────────────────────────────────────

interface EditDialogProps {
  item: CSLItem
  onSave: (updated: CSLItem) => void
  onClose: () => void
}

function EditDialog({ item, onSave, onClose }: EditDialogProps) {
  const [title, setTitle] = useState(String(item.title ?? ''))
  const [authors, setAuthors] = useState(authorsToString(item.author))
  const [year, setYear] = useState(String(item.issued?.['date-parts']?.[0]?.[0] ?? ''))
  const [url, setUrl] = useState(String(item.URL ?? ''))
  const [container, setContainer] = useState(String(item['container-title'] ?? ''))
  const [type, setType] = useState(item.type ?? 'webpage')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    const updated: CSLItem = {
      ...item,
      type,
      title: title || undefined,
      author: authors ? parseAuthor(authors) : undefined,
      issued: year ? parseDate(year) : undefined,
      URL: url || undefined,
      'container-title': container || undefined,
    }
    await onSave(updated)
    setSaving(false)
  }

  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-400">{label}</span>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={hint}
        className="text-xs border border-stone-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#5c2d8a]"
      />
    </label>
  )

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] bg-black/20" onMouseDown={onClose} />
      <div
        role="dialog" aria-label="Edit citation"
        className="fixed z-[101] bg-white shadow-xl font-serif text-sm text-stone-600 flex flex-col"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(440px, 94vw)', maxHeight: '90vh', border: `1px solid ${INK}55`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400">Edit citation</div>
            <div className="text-xs text-stone-500 mt-0.5 font-mono">{item.id}</div>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-400">Type</span>
            <select value={type} onChange={e => setType(e.target.value)}
              className="text-xs border border-stone-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-[#5c2d8a]">
              {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {field('Title', title, setTitle, 'Article or page title')}
          {field('Author(s)', authors, setAuthors, 'Given Family; Given2 Family2')}
          {field('Year', year, setYear, '2024')}
          {field('Journal / Publisher', container, setContainer, 'Nature, MIT Press…')}
          {field('URL', url, setUrl, 'https://…')}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-100">
          <button type="button" onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-stone-200 text-stone-500 hover:border-stone-300">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}
            className="text-xs px-4 py-1.5 rounded text-white disabled:opacity-40"
            style={{ background: INK }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export function CitationPanel({ editor, citationStyle, onStyleChange, onClose, btnRef, initialCapture, onInitialCaptureConsumed }: Props) {
  const [, force] = useState(0)
  const rerender = useCallback(() => force(n => n + 1), [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'warn' | 'err' } | null>(null)
  const [editItem, setEditItem] = useState<CSLItem | null>(null)

  useEffect(() => {
    const unsub = bibProvider.subscribe(rerender)
    const onUpdate = () => rerender()
    editor.on('update', onUpdate)
    return () => { unsub(); editor.off('update', onUpdate) }
  }, [editor, rerender])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editItem) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, editItem])

  // Auto-capture a URL handed in via the PWA share target (once, on open).
  const consumedRef = useRef(false)
  useEffect(() => {
    if (initialCapture && !consumedRef.current) {
      consumedRef.current = true
      setInput(initialCapture)
      void doCapture(initialCapture)
      onInitialCaptureConsumed?.()
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const json = editor.getJSON()
  const usedKeys = new Set(usedCitekeys(json))
  const refCfg = referenceListConfig(json)
  const refMode: RefMode | null = refCfg?.mode ?? null
  const manualKeys = new Set(refCfg?.manualKeys ?? [])
  const query = input.trim()
  const captureable = !!(detectIdentifier(query) || isUrl(query))
  const entries = query && !captureable ? bibProvider.search(query) : bibProvider.getAll()

  async function doCapture(value = query) {
    if (!value || busy) return
    setBusy(true); setNotice(null)
    try {
      const res = await captureFromInput(value)
      const stored = await addToLibrary(res.item)
      editor.chain().focus().insertCitation({ citekeys: [stored.id] }).run()
      setInput('')
      setNotice(res.warning
        ? { text: res.warning, kind: 'warn' }
        : { text: `Added & cited "${stored.id}"`, kind: 'ok' })
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Capture failed', kind: 'err' })
    } finally {
      setBusy(false)
    }
  }

  // Editor mutations from click handlers are deferred to a microtask so the ProseMirror transaction
  // (and the flushSync ReactNodeViewRenderer runs to sync a NodeView) never fires synchronously
  // inside React's event dispatch — which would provoke a flushSync-during-render warning.
  const cmd = (fn: () => void) => queueMicrotask(fn)

  function cite(item: CSLItem) {
    cmd(() => editor.chain().focus().insertCitation({ citekeys: [item.id] }).run())
    setNotice({ text: `Cited "${item.id}"`, kind: 'ok' })
  }

  async function del(item: CSLItem) {
    if (usedKeys.has(item.id)) {
      setNotice({ text: `"${item.id}" is cited in the document — remove the in-text citation first.`, kind: 'err' })
      return
    }
    await removeFromLibrary(item.id)
  }

  async function saveEdit(updated: CSLItem) {
    await addToLibrary(updated)
    setEditItem(null)
    setNotice({ text: `Saved "${updated.id}"`, kind: 'ok' })
  }

  function setMode(mode: RefMode) {
    cmd(() => {
      if (!refCfg) editor.chain().focus().insertReferenceList({ mode }).run()
      else editor.chain().focus().setReferenceListMode(mode).run()
    })
  }

  function toggleManual(item: CSLItem) {
    cmd(() => {
      if (!refCfg) editor.chain().focus().insertReferenceList({ mode: 'manual', manualKeys: [item.id] }).run()
      else {
        const next = manualKeys.has(item.id)
          ? [...manualKeys].filter(k => k !== item.id)
          : [...manualKeys, item.id]
        editor.chain().focus().setReferenceListManualKeys(next).run()
      }
    })
  }

  function panelStyle(): React.CSSProperties {
    const br = btnRef?.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, right: 16 }
    const right = Math.max(8, window.innerWidth - br.right)
    return { position: 'fixed', bottom: Math.round(window.innerHeight - br.top + 8), right }
  }

  return createPortal(
    <>
      {editItem && (
        <EditDialog
          item={editItem}
          onSave={saveEdit}
          onClose={() => setEditItem(null)}
        />
      )}
      <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={onClose} />
      <div
        role="dialog" aria-label="Citations"
        className="z-[91] bg-white shadow-xl font-serif text-sm text-stone-600 flex flex-col"
        style={{ ...panelStyle(), width: 'min(380px, 96vw)', maxHeight: '82vh', border: `1px solid ${INK}55`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-100">
          <span className="text-[11px] uppercase tracking-wide text-stone-400">Citations</span>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

        {/* Capture bar */}
        <div className="px-4 pt-3 pb-2 border-b border-stone-100">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && captureable) { e.preventDefault(); void doCapture() } }}
              placeholder="Paste a DOI, arXiv, URL, or search…"
              className="flex-1 text-xs border border-stone-200 rounded px-2 py-1.5 focus:outline-none focus:border-[#5c2d8a]"
            />
            <button
              type="button" disabled={!captureable || busy} onClick={() => void doCapture()}
              className="text-xs px-3 py-1.5 rounded text-white disabled:opacity-40"
              style={{ background: INK }}
            >
              {busy ? '…' : 'Add'}
            </button>
          </div>
          {notice && (
            <div className="mt-1.5 text-[11px]" style={{ color: notice.kind === 'err' ? '#b91c1c' : notice.kind === 'warn' ? '#b45309' : '#15803d' }}>
              {notice.text}
            </div>
          )}
        </div>

        {/* Reference-list controls */}
        <div className="px-4 py-2.5 border-b border-stone-100">
          <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-1.5">Reference list</div>
          <div className="flex gap-1 mb-2">
            {(['cited', 'all', 'manual'] as RefMode[]).map(m => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                className="text-[11px] px-2 py-1 rounded border flex-1"
                style={refMode === m
                  ? { background: `${INK}12`, borderColor: INK, color: INK }
                  : { borderColor: '#e7e5e4', color: '#78716c' }}
              >
                {m === 'cited' ? 'Auto' : m === 'all' ? 'All' : 'Manual'}
              </button>
            ))}
          </div>
          {!refCfg && (
            <button type="button" onClick={() => cmd(() => editor.chain().focus().insertReferenceList().run())}
              className="text-[11px] w-full px-2 py-1 rounded border border-stone-200 text-stone-500 hover:border-stone-300">
              + Insert References section
            </button>
          )}
          <div className="mt-2">
            <select value={citationStyle} onChange={e => onStyleChange(e.target.value)}
              className="text-xs text-stone-600 border border-stone-200 rounded px-2 py-1 w-full bg-white">
              {CSL_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {/* Master list */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-2">
            Library ({bibProvider.getAll().length})
          </div>
          {entries.length === 0 ? (
            <div className="py-6 text-center text-xs text-stone-400">
              {query ? 'No matches.' : 'Paste a DOI or URL above to add your first source.'}
            </div>
          ) : entries.map(item => {
            const used = usedKeys.has(item.id)
            const src = SOURCE_BADGE[itemSource(item)]
            return (
              <div key={item.id} className="py-2 border-b border-stone-50 last:border-0">
                <div className="flex items-start gap-2">
                  {refMode === 'manual' && (
                    <input type="checkbox" checked={manualKeys.has(item.id)} onChange={() => toggleManual(item)}
                      className="mt-1" aria-label={`Include ${item.id} in references`} />
                  )}
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left hover:bg-stone-50 rounded px-1 -mx-1 transition-colors"
                    onClick={() => setEditItem(item)}
                    title="Click to edit"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate" style={{ color: INK }}>{item.id}</span>
                      <span className="text-[9px] px-1 rounded" style={{ color: src.color, border: `1px solid ${src.color}55` }}>{src.label}</span>
                      {used && <span className="text-[9px] text-green-600" title="cited in this document">● used</span>}
                    </div>
                    <div className="text-[11px] text-stone-500 leading-tight truncate">{String(item.title ?? '')}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{simpleInText([item])}</div>
                  </button>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => cite(item)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a]">cite</button>
                    <button type="button" onClick={() => void del(item)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-400 hover:border-red-300 hover:text-red-500">del</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}
