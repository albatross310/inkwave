// Unified Citation Panel — opened by the ‟ toolbar button. One place for everything:
//   • a URL/DOI capture bar (paste a DOI/URL to add a source; free text filters the library)
//   • the master list of every saved citation with cite + edit + delete actions
//   • reference-list controls: 3-mode toggle + style picker
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
import { ITEM_TYPE_LABELS as TYPE_LABELS, REQUIRED_BY_TYPE, FIELD_LABELS as CSL_FIELD_LABELS_MAP } from '../citations/requiredFields'
import type { CSLItem, FieldSource, IwCitationMeta } from '../types/document'

const INK = '#5c2d8a'

interface Props {
  editor: Editor
  citationStyle: string
  onStyleChange: (s: string) => void
  onClose: () => void
  btnRef?: RefObject<HTMLElement | null>
  initialCapture?: string | null
  onInitialCaptureConsumed?: () => void
}

const SOURCE_BADGE: Record<FieldSource, { label: string; color: string }> = {
  crossref: { label: 'verified', color: '#15803d' },
  ai:       { label: 'AI',       color: '#b45309' },
  manual:   { label: 'manual',   color: '#6b7280' },
}

// Re-export for consumers that previously imported from here.
export { ITEM_TYPE_LABELS } from '../citations/requiredFields'

// Fields and their required status per type.
// Fields marked required: true are needed by at least one major style (APA 7, MLA 9, Chicago 17).
interface FieldDef {
  key: string
  label: string
  placeholder?: string
  required: boolean
  styles?: string   // which styles most need this (display hint only)
}

const TYPE_FIELDS: Record<string, FieldDef[]> = {
  'article-journal': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Article title',   required: true },
    { key: 'container-title', label: 'Journal name',    required: true },
    { key: 'year',            label: 'Year',            placeholder: '2024',  required: true },
    { key: 'volume',          label: 'Volume',          required: true,  styles: 'APA · MLA · Chicago' },
    { key: 'issue',           label: 'Issue',           required: false, styles: 'APA · MLA' },
    { key: 'page',            label: 'Pages',           placeholder: '123–145', required: true, styles: 'APA · MLA · Chicago' },
    { key: 'DOI',             label: 'DOI',             placeholder: '10.xxxx/…', required: false },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'webpage': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: false },
    { key: 'title',           label: 'Page title',      required: true },
    { key: 'container-title', label: 'Website name',    required: false, styles: 'MLA · Chicago' },
    { key: 'year',            label: 'Year published',  required: false },
    { key: 'URL',             label: 'URL',             required: true },
    { key: 'accessed',        label: 'Date accessed',   placeholder: 'YYYY-MM-DD', required: false, styles: 'MLA · Chicago' },
  ],
  'post-weblog': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Post title',      required: true },
    { key: 'container-title', label: 'Blog name',       required: false },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'URL',             label: 'URL',             required: true },
    { key: 'accessed',        label: 'Date accessed',   placeholder: 'YYYY-MM-DD', required: false, styles: 'MLA · Chicago' },
  ],
  'article-newspaper': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Article title',   required: true },
    { key: 'container-title', label: 'Newspaper name',  required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'page',            label: 'Page(s)',         required: false },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'book': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Book title',      required: true },
    { key: 'publisher',       label: 'Publisher',       required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'edition',         label: 'Edition',         placeholder: '2nd', required: false },
    { key: 'container-title', label: 'Series',          required: false },
    { key: 'DOI',             label: 'DOI',             required: false },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'chapter': [
    { key: 'author',          label: 'Chapter author(s)', placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Chapter title',   required: true },
    { key: 'container-title', label: 'Book title',      required: true },
    { key: 'editor',          label: 'Editor(s)',       placeholder: 'Given Family; Given2 Family2', required: false },
    { key: 'publisher',       label: 'Publisher',       required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'page',            label: 'Pages',           placeholder: '23–45', required: true },
    { key: 'DOI',             label: 'DOI',             required: false },
  ],
  'paper-conference': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Paper title',     required: true },
    { key: 'event-title',     label: 'Conference name', required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'page',            label: 'Pages',           required: false },
    { key: 'publisher',       label: 'Publisher / Proceedings', required: false },
    { key: 'DOI',             label: 'DOI',             required: false },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'thesis': [
    { key: 'author',          label: 'Author',          placeholder: 'Given Family', required: true },
    { key: 'title',           label: 'Thesis title',    required: true },
    { key: 'genre',           label: 'Degree type',     placeholder: 'PhD thesis, Masters dissertation…', required: true },
    { key: 'publisher',       label: 'Institution',     required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'URL',             label: 'URL / Repository', required: false },
  ],
  'report': [
    { key: 'author',          label: 'Author(s)',       placeholder: 'Given Family; Given2 Family2', required: true },
    { key: 'title',           label: 'Report title',    required: true },
    { key: 'publisher',       label: 'Institution / Publisher', required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'number',          label: 'Report number',   required: false },
    { key: 'URL',             label: 'URL',             required: false },
    { key: 'DOI',             label: 'DOI',             required: false },
  ],
  'video': [
    { key: 'author',          label: 'Director / Creator', placeholder: 'Given Family', required: true },
    { key: 'title',           label: 'Title',           required: true },
    { key: 'publisher',       label: 'Studio / Platform', required: false },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'broadcast': [
    { key: 'author',          label: 'Host / Director', placeholder: 'Given Family', required: false },
    { key: 'title',           label: 'Episode / Programme title', required: true },
    { key: 'container-title', label: 'Series name',     required: false },
    { key: 'publisher',       label: 'Network / Platform', required: true },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'URL',             label: 'URL',             required: false },
  ],
  'song': [
    { key: 'author',          label: 'Artist',          required: true },
    { key: 'title',           label: 'Song / Album title', required: true },
    { key: 'publisher',       label: 'Label / Platform', required: false },
    { key: 'year',            label: 'Year',            required: true },
    { key: 'URL',             label: 'URL',             required: false },
  ],
}

// Fallback schema for any type not in the map above.
const GENERIC_FIELDS: FieldDef[] = [
  { key: 'author',    label: 'Author(s)', placeholder: 'Given Family; Given2 Family2', required: true },
  { key: 'title',     label: 'Title',     required: true },
  { key: 'year',      label: 'Year',      required: true },
  { key: 'publisher', label: 'Publisher', required: false },
  { key: 'URL',       label: 'URL',       required: false },
]

function itemSource(item: CSLItem): FieldSource {
  const meta = (item as { _iw?: IwCitationMeta })._iw
  const fields = meta?.fields
  if (!fields) return 'manual'
  const vals = Object.values(fields)
  if (vals.some(f => f.source === 'ai')) return 'ai'
  if (vals.some(f => f.source === 'crossref')) return 'crossref'
  return 'manual'
}

function authorsToString(authors: CSLItem['author']): string {
  if (!authors?.length) return ''
  return authors.map(a => {
    if (a.literal) return a.literal
    return [a.given, a.family].filter(Boolean).join(' ')
  }).join('; ')
}

// Read a simple string CSL field, or empty string.
function strField(item: CSLItem, key: string): string {
  const v = (item as Record<string, unknown>)[key]
  return v != null ? String(v) : ''
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────

interface EditDialogProps {
  item: CSLItem
  onSave: (updated: CSLItem) => void
  onClose: () => void
}

function EditDialog({ item, onSave, onClose }: EditDialogProps) {
  const [type, setType] = useState(item.type ?? 'webpage')
  const [values, setValues] = useState<Record<string, string>>(() => ({
    author:          authorsToString(item.author),
    title:           strField(item, 'title'),
    'container-title': strField(item, 'container-title'),
    year:            String(item.issued?.['date-parts']?.[0]?.[0] ?? ''),
    volume:          strField(item, 'volume'),
    issue:           strField(item, 'issue'),
    page:            strField(item, 'page'),
    DOI:             strField(item, 'DOI'),
    URL:             strField(item, 'URL'),
    publisher:       strField(item, 'publisher'),
    edition:         strField(item, 'edition'),
    'event-title':   strField(item, 'event-title'),
    genre:           strField(item, 'genre'),
    number:          strField(item, 'number'),
    editor:          authorsToString(item.author),  // note: editor uses same format
    accessed:        (() => {
      const dp = (item as Record<string, unknown>).accessed as { 'date-parts'?: number[][] } | undefined
      const parts = dp?.['date-parts']?.[0]
      return parts ? parts.join('-') : ''
    })(),
  }))
  const [saving, setSaving] = useState(false)

  // Reset editor field for editor (not author).
  useEffect(() => {
    const ed = (item as Record<string, unknown>).editor as CSLItem['author'] | undefined
    setValues(v => ({ ...v, editor: authorsToString(ed) }))
  }, [item])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const fields = TYPE_FIELDS[type] ?? GENERIC_FIELDS
  const missingRequired = fields.filter(f => f.required && !values[f.key]?.trim())

  async function save() {
    setSaving(true)
    const year = values.year?.trim()
    const accessed = values.accessed?.trim()
    const updated: CSLItem = {
      ...item,
      type,
      title:             values.title?.trim() || undefined,
      author:            values.author?.trim() ? parseAuthor(values.author) : undefined,
      issued:            year ? parseDate(year) : undefined,
      'container-title': values['container-title']?.trim() || undefined,
      URL:               values.URL?.trim() || undefined,
      DOI:               values.DOI?.trim() || undefined,
      volume:            values.volume?.trim() || undefined,
      issue:             values.issue?.trim() || undefined,
      page:              values.page?.trim() || undefined,
      publisher:         values.publisher?.trim() || undefined,
      edition:           values.edition?.trim() || undefined,
      'event-title':     values['event-title']?.trim() || undefined,
      genre:             values.genre?.trim() || undefined,
      number:            values.number?.trim() || undefined,
      editor:            values.editor?.trim() ? parseAuthor(values.editor) : undefined,
      accessed:          accessed ? parseDate(accessed) : undefined,
    }
    await onSave(updated)
    setSaving(false)
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues(v => ({ ...v, [key]: e.target.value }))

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] bg-black/20" onMouseDown={onClose} />
      <div
        role="dialog" aria-label="Edit citation"
        className="fixed z-[101] bg-white shadow-xl font-serif text-sm text-stone-600 flex flex-col"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(460px, 96vw)', maxHeight: '92vh', border: `1px solid ${INK}55`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-stone-400">Edit citation</div>
            <div className="text-[10px] text-stone-400 mt-0.5 font-mono">{item.id}</div>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

        {/* Type selector */}
        <div className="px-5 pt-3 pb-2 border-b border-stone-100">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-stone-400">Source type</span>
            <select value={type} onChange={e => setType(e.target.value)}
              className="text-xs border border-stone-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-[#5c2d8a]">
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <p className="text-[10px] text-stone-400 mt-1.5">
            Changing the type updates which fields are required for APA, MLA, and Chicago.
          </p>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2.5">
          {fields.map(f => {
            const val = values[f.key] ?? ''
            const missing = f.required && !val.trim()
            return (
              <label key={f.key} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-stone-400">{f.label}</span>
                  {f.required
                    ? <span className="text-[9px] px-1 rounded" style={{ color: missing ? '#b91c1c' : '#15803d', background: missing ? '#fef2f2' : '#f0fdf4' }}>
                        {missing ? 'required — missing' : 'required ✓'}
                      </span>
                    : <span className="text-[9px] text-stone-300">optional</span>}
                  {f.styles && <span className="text-[9px] text-stone-300">{f.styles}</span>}
                </div>
                <input
                  value={val}
                  onChange={set(f.key)}
                  placeholder={f.placeholder}
                  className={`text-xs border rounded px-2 py-1.5 focus:outline-none ${missing ? 'border-red-200 focus:border-red-400' : 'border-stone-200 focus:border-[#5c2d8a]'}`}
                />
              </label>
            )
          })}
        </div>

        {/* Completeness notice */}
        {missingRequired.length > 0 && (
          <div className="px-5 py-2 border-t border-stone-100 bg-red-50">
            <p className="text-[11px] text-red-700">
              Missing required fields: {missingRequired.map(f => f.label).join(', ')}.
              Citations may render incompletely in some styles.
            </p>
          </div>
        )}

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

// ─── Main panel ──────────────────────────────────────────────────────────────

export function CitationPanel({ editor, citationStyle, onStyleChange, onClose, initialCapture, onInitialCaptureConsumed }: Props) {
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

  function visitSource(item: CSLItem) {
    const url = String(item.URL ?? (item as { _iw?: IwCitationMeta })._iw?.sourceUrl ?? '')
    if (!url) return
    // Build a capture msg so the extension can show the panel on the source page.
    const type = item.type
    const required = (REQUIRED_BY_TYPE as Record<string, string[]>)[type] ?? []
    const issued = item.issued
    const hasYear = !!(issued?.['date-parts']?.[0]?.[0])
    const missingRequired = required.filter(f => {
      if (f === 'year') return !hasYear
      return !(item as Record<string, unknown>)[f]
    })
    const capture = {
      id: item.id,
      title: String(item.title ?? ''),
      itemType: type,
      typeLabel: TYPE_LABELS[type] ?? type,
      fields: {} as Record<string, { value?: string; quote?: string | null }>,
      missingRequired,
      missingLabels: missingRequired.map(f => (CSL_FIELD_LABELS_MAP as Record<string,string>)[f] ?? f),
      confidence: 'high',
    }
    window.postMessage({ source: 'inkwave-app', type: 'cite/visitSource', url, capture }, window.location.origin)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function panelStyle(): React.CSSProperties {
    // Position below toolbar (~56px) so the panel never overlaps it.
    return { position: 'fixed', top: 68, left: '50%', transform: 'translateX(-50%)' }
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
        style={{ ...panelStyle(), width: 'min(520px, 96vw)', maxHeight: '85vh', border: `1px solid ${INK}55`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-100">
          <span className="text-[12px] font-medium" style={{ color: INK }}>Inkwave Citations</span>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-lg leading-none">×</button>
        </div>

        {/* Extension promo — top of panel */}
        <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between bg-stone-50/60">
          <span className="text-xs text-stone-500">Download the Inkwave citation extension for single click import on any page</span>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <a href="https://chromewebstore.google.com/detail/inkwave-citation-capture/TODO"
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-stone-400 hover:text-[#5c2d8a] underline underline-offset-2">
              Chrome
            </a>
            <a href="https://addons.mozilla.org/en-US/firefox/addon/inkwave-citation-capture/"
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-stone-400 hover:text-[#5c2d8a] underline underline-offset-2">
              Firefox
            </a>
          </div>
        </div>

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

        <div className="px-4 py-2 border-b border-stone-100">
          <div className="flex items-center gap-1.5">
            {(['cited', 'all', 'manual'] as RefMode[]).map(m => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                className="text-[11px] px-2 py-1 rounded border"
                style={refMode === m
                  ? { background: `${INK}12`, borderColor: INK, color: INK }
                  : { borderColor: '#e7e5e4', color: '#78716c' }}
              >
                {m === 'cited' ? 'Auto' : m === 'all' ? 'All' : 'Manual'}
              </button>
            ))}
            <select value={citationStyle} onChange={e => onStyleChange(e.target.value)}
              className="text-[11px] text-stone-600 border border-stone-200 rounded px-2 py-1 bg-white flex-1 min-w-0">
              {CSL_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {!refCfg && (
              <button type="button" onClick={() => cmd(() => editor.chain().focus().insertReferenceList().run())}
                className="text-[11px] px-2 py-1 rounded border border-stone-200 text-stone-500 hover:border-stone-300 whitespace-nowrap">
                + Refs
              </button>
            )}
          </div>
        </div>

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
            const typeLabel = TYPE_LABELS[item.type] ?? item.type
            return (
              <div key={item.id} className="py-2.5 border-b border-stone-100 last:border-0">
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium truncate" style={{ color: INK }}>{item.id}</span>
                      <span className="text-[9px] px-1 rounded" style={{ color: src.color, border: `1px solid ${src.color}55` }}>{src.label}</span>
                      <span className="text-[9px] text-stone-300">{typeLabel}</span>
                      {used && <span className="text-[9px] text-green-600">● used</span>}
                    </div>
                    <div className="text-[11px] text-stone-500 leading-tight truncate mt-0.5">{String(item.title ?? '')}</div>
                    <div className="text-[10px] text-stone-400 mt-0.5">{simpleInText([item])}</div>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => cite(item)}
                      className="text-[10px] px-2 py-0.5 rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a]">cite</button>
                    {!!(item.URL || (item as { _iw?: IwCitationMeta })._iw?.sourceUrl) && (
                      <button type="button"
                        title="Open source page (shows verification panel if extension installed)"
                        className="text-[10px] px-2 py-0.5 rounded border border-stone-200 text-stone-400 hover:border-[#5c2d8a] hover:text-[#5c2d8a]"
                        onClick={e => { e.stopPropagation(); visitSource(item) }}
                      >↗</button>
                    )}
                    <button type="button" onClick={() => void del(item)}
                      className="text-[10px] px-2 py-0.5 rounded border border-stone-200 text-stone-400 hover:border-red-300 hover:text-red-500">del</button>
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
