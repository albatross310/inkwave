// Unified Citation Panel — opened by the ‟ toolbar button. One place for everything:
//   • a URL/DOI capture bar (paste a DOI/URL to add a source; free text filters the library)
//   • the master list of every saved citation with cite + edit + delete actions
//   • reference-list controls: 3-mode toggle + style picker
// Replaces the old Zotero/BBT BibPanel + ZoteroSetup. See citations spec §10.

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/Scroll'
import type { Editor } from '@tiptap/react'
import { bibProvider } from '../citations/bibProvider'
import { CSL_STYLES } from '../citations/styles'
import { usedCitekeys, referenceListConfig, type RefMode } from '../citations/resolve'
import { captureFromInput, isUrlCapture, parseAuthor, parseDate } from '../citations/capture'
import { detectIdentifier, isUrl } from '../citations/identifiers'
import { urlLookupEnabled, setUrlLookup, markAiConsent } from '../editor/aiSettings'
import { AiConsentDialog } from './AiConsentDialog'
import { addToLibrary, removeFromLibrary } from '../citations/library'
import { savePdf, deletePdf } from '../citations/pdfStore'
import { openPdf } from '../citations/pdfViewer'
import { maybeShowCitationToast } from '../citations/citationToast'
import { detectPageOffset } from '../citations/pageOffset'
import { makeCitekey } from '../citations/cslMap'
import { reverifyEntry, applyReverify, revertField } from '../citations/reverify'
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
  crossref: { label: 'verified', color: 'var(--iw-verified, #15803d)' },
  ai:       { label: 'AI',       color: 'var(--iw-badge-ai, #b45309)' },
  manual:   { label: 'M',        color: 'var(--iw-badge-manual, #6b7280)' },
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
    { key: 'translator',      label: 'Translator(s)',   placeholder: 'Given Family; Given2 Family2', required: false },
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
    { key: 'translator',      label: 'Translator(s)',   placeholder: 'Given Family; Given2 Family2', required: false },
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

// First author's family (or literal) name, lowercased — the sort key for "Author" order.
function authorFamily(item: CSLItem): string {
  const a = item.author?.[0]
  return (a?.family || a?.literal || (a ? [a.given, a.family].filter(Boolean).join(' ') : '') || '￿').toLowerCase()
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

// Render a changelog value (author array / date-parts / plain) for the old→new diff display.
function fmtVal(field: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (field === 'author' || field === 'editor' || field === 'translator') return authorsToString(v as CSLItem['author'])
  if (field === 'issued' || field === 'accessed') {
    const dp = (v as { 'date-parts'?: number[][] })?.['date-parts']?.[0]
    return dp ? dp.join('-') : String(v)
  }
  return String(v)
}

// Coarse "checked N ago" for the last-verified stamp.
function relTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────

interface EditDialogProps {
  item: CSLItem
  isNew?: boolean
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
    editor:          authorsToString(item.author),  // corrected by useEffect below
    translator:      authorsToString((item as Record<string, unknown>).translator as CSLItem['author']),
    accessed:        (() => {
      const dp = (item as Record<string, unknown>).accessed as { 'date-parts'?: number[][] } | undefined
      const parts = dp?.['date-parts']?.[0]
      return parts ? parts.join('-') : ''
    })(),
  }))
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState<null | 'DOI' | 'URL'>(null)
  // URL-lookup consent within the edit dialog (mirrors the panel's flow).
  const [urlConsentKind, setUrlConsentKind] = useState<null | 'URL'>(null)

  // Fetch/scrape metadata from a DOI or URL and fill the form. DOI → Crossref; URL → the AI scraper (Sonnet).
  async function fetchFields(kind: 'DOI' | 'URL') {
    const v = (values[kind] ?? '').trim()
    if (!v || fetching) return
    // The AI scraper path is opt-in (sends the page to Anthropic via our server).
    if (kind === 'URL' && isUrlCapture(v) && !urlLookupEnabled()) { setUrlConsentKind(kind); return }
    setFetching(kind)
    try {
      const res = await captureFromInput(v)
      const it = res.item
      setValues(prev => ({
        ...prev,
        author: it.author ? authorsToString(it.author) : prev.author,
        title: strField(it, 'title') || prev.title,
        'container-title': strField(it, 'container-title') || prev['container-title'],
        year: String(it.issued?.['date-parts']?.[0]?.[0] ?? '') || prev.year,
        volume: strField(it, 'volume') || prev.volume,
        issue: strField(it, 'issue') || prev.issue,
        page: strField(it, 'page') || prev.page,
        DOI: strField(it, 'DOI') || prev.DOI,
        URL: strField(it, 'URL') || prev.URL,
        publisher: strField(it, 'publisher') || prev.publisher,
      }))
      if (it.type) setType(it.type)
    } catch { /* leave the form as-is on failure */ }
    setFetching(null)
  }

  // Correct author-list fields that can't be initialized cleanly from item in useState.
  useEffect(() => {
    const ed = (item as Record<string, unknown>).editor as CSLItem['author'] | undefined
    const tr = (item as Record<string, unknown>).translator as CSLItem['author'] | undefined
    setValues(v => ({ ...v, editor: authorsToString(ed), translator: authorsToString(tr) }))
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
      translator:        values.translator?.trim() ? parseAuthor(values.translator) : undefined,
      accessed:          accessed ? parseDate(accessed) : undefined,
    }
    await onSave(updated)
    setSaving(false)
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues(v => ({ ...v, [key]: e.target.value }))

  return createPortal(
    <>
      {urlConsentKind && (
        <AiConsentDialog
          feature="url"
          onYes={() => {
            setUrlLookup(true); markAiConsent('url')
            setUrlConsentKind(null)
            void fetchFields('URL')
          }}
          onNo={() => setUrlConsentKind(null)}
        />
      )}
      <div className="fixed inset-0 z-[100] bg-black/20" onMouseDown={onClose} />
      <div
        role="dialog" aria-label="Edit citation"
        className="iw-nightable fixed z-[101] bg-white shadow-xl font-serif text-sm text-stone-600 flex flex-col"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(460px, 96vw)', maxHeight: '92vh', border: `1px solid ${INK}55`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Type selector — the titled header bar is gone; close (×) sits next to the dropdown. */}
        <div className="px-5 pt-4 pb-2 border-b border-stone-100">
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[11px] uppercase tracking-wide text-stone-500">Source type</span>
              <select value={type} onChange={e => setType(e.target.value)}
                className="text-sm border border-stone-200 rounded px-2 py-2 bg-white focus:outline-none focus:border-[#5c2d8a]">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button type="button" onClick={onClose} aria-label="Close"
              className="flex-shrink-0 w-9 h-9 rounded border border-stone-200 text-stone-400 hover:text-stone-600 hover:border-stone-300 text-2xl leading-none flex items-center justify-center">×</button>
          </div>
          <p className="text-[11px] text-stone-500 mt-1.5">
            Changing the type updates which fields are required for APA, MLA, and Chicago.
          </p>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-3 grid grid-cols-2 gap-x-3 gap-y-2.5 content-start">
          {fields.map(f => {
            const val = values[f.key] ?? ''
            const missing = f.required && !val.trim()
            const fetchable = f.key === 'DOI' || f.key === 'URL'
            // Long fields span both columns; short ones sit two-per-row so the form rarely scrolls.
            const wide = ['title', 'container-title', 'author', 'editor', 'translator', 'URL', 'event-title'].includes(f.key)
            return (
              <label key={f.key} className={`flex flex-col gap-0.5 min-w-0 ${wide ? 'col-span-2' : ''}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-stone-500">{f.label}</span>
                  {f.required
                    ? <span title={missing ? 'required — still missing' : 'required — provided'}
                        className="inline-flex items-center justify-center rounded-full flex-shrink-0"
                        style={{ width: 15, height: 15, fontSize: '11px', lineHeight: 1, color: missing ? '#dc2626' : '#15803d', border: `1.5px solid ${missing ? '#dc2626' : '#15803d'}` }}>∗</span>
                    : <span className="text-[10px] text-stone-400">optional</span>}
                  {f.styles && <span className="text-[10px] text-stone-400">{f.styles}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={val}
                    onChange={set(f.key)}
                    placeholder={f.placeholder}
                    className={`flex-1 text-sm border rounded px-2 py-2 focus:outline-none ${missing ? 'border-red-200 focus:border-red-400' : 'border-stone-200 focus:border-[#5c2d8a]'}`}
                  />
                  {fetchable && (
                    <button type="button" onClick={() => void fetchFields(f.key as 'DOI' | 'URL')}
                      disabled={!val.trim() || !!fetching}
                      title={f.key === 'DOI' ? 'Fetch the fields from this DOI (Crossref)' : 'Scrape the fields from this URL — uses Claude Sonnet'}
                      className="flex-shrink-0 w-9 h-9 rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a] disabled:opacity-40 flex items-center justify-center text-base">
                      {fetching === f.key ? '…' : (f.key === 'DOI' ? '⤓' : '✦')}
                    </button>
                  )}
                </div>
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
  const [isNewRef, setIsNewRef] = useState(false)
  // URL-lookup consent: holds the input that triggered the dialog so "yes" resumes the capture.
  const [urlConsentPending, setUrlConsentPending] = useState<string | null>(null)
  const [recheckingAll, setRecheckingAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Dismissible helper banners (persisted) + library sort.
  const [extDismissed, setExtDismissed] = useState(() => { try { return localStorage.getItem('inkwave:citeExtDismissed') === '1' } catch { return false } })
  const [helpDismissed, setHelpDismissed] = useState(() => { try { return localStorage.getItem('inkwave:citeHelpDismissed') === '1' } catch { return false } })
  const [sortBy, setSortBy] = useState<'added' | 'alpha' | 'author'>(() => { try { return (localStorage.getItem('inkwave:citeSortBy') as 'added' | 'alpha' | 'author') || 'added' } catch { return 'added' } })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => { try { return (localStorage.getItem('inkwave:citeSortDir') as 'asc' | 'desc') || 'desc' } catch { return 'desc' } })
  const dismissExt = () => { setExtDismissed(true); try { localStorage.setItem('inkwave:citeExtDismissed', '1') } catch { /* private */ } }
  const dismissHelp = () => { setHelpDismissed(true); try { localStorage.setItem('inkwave:citeHelpDismissed', '1') } catch { /* private */ } }
  const changeSort = (by: 'added' | 'alpha' | 'author') => { setSortBy(by); try { localStorage.setItem('inkwave:citeSortBy', by) } catch { /* private */ } }
  const toggleSortDir = () => setSortDir(d => { const n = d === 'asc' ? 'desc' : 'asc'; try { localStorage.setItem('inkwave:citeSortDir', n) } catch { /* private */ }; return n })

  useEffect(() => {
    const unsub = bibProvider.subscribe(rerender)
    const onUpdate = () => rerender()
    editor.on('update', onUpdate)
    return () => { unsub(); editor.off('update', onUpdate) }
  }, [editor, rerender])

  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editItem) onClose()
      // Ctrl/Cmd+F while the panel is open → focus the library search instead of the browser find.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && !editItem) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
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
  const base = query && !captureable ? bibProvider.search(query) : bibProvider.getAll()
  // Sort the library: 'added' preserves natural (insertion) order, so desc = most-recent-first.
  const entries = base
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const cmp = sortBy === 'alpha' ? a.item.id.localeCompare(b.item.id)
        : sortBy === 'author' ? authorFamily(a.item).localeCompare(authorFamily(b.item))
        : a.i - b.i
      return sortDir === 'desc' ? -cmp : cmp
    })
    .map(x => x.item)

  async function doCapture(value = query) {
    if (!value || busy) return
    // URL captures go to Anthropic via our server — opt-in. First use pops the consent dialog;
    // the input value is held so a "yes" resumes the capture seamlessly.
    if (isUrlCapture(value) && !urlLookupEnabled()) { setUrlConsentPending(value); return }
    setBusy(true); setNotice(null)
    try {
      const res = await captureFromInput(value)
      const stored = await addToLibrary(res.item)
      setInput('')
      setNotice(res.warning
        ? { text: res.warning, kind: 'warn' }
        : { text: `Added "${stored.id}" — click cite to insert`, kind: 'ok' })
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Capture failed', kind: 'err' })
    } finally {
      setBusy(false)
    }
  }

  const cmd = (fn: () => void) => queueMicrotask(fn)

  function cite(item: CSLItem) {
    cmd(() => editor.chain().focus().insertCitation({ citekeys: [item.id] }).run())
    maybeShowCitationToast()
    setNotice({ text: `Cited "${item.id}"`, kind: 'ok' })
  }

  async function del(item: CSLItem) {
    if (usedKeys.has(item.id)) {
      setNotice({ text: `"${item.id}" is cited in the document — remove the in-text citation first.`, kind: 'err' })
      return
    }
    await deletePdf(item.id).catch(() => {})
    await removeFromLibrary(item.id)
  }

  // Rename a citation's key. If it's cited in the document, every in-text @old instance is rewritten to
  // @new in the same pass (the citation nodes reference the key by citekeys), so nothing is left dangling.
  async function renameCitation(item: CSLItem) {
    const next = window.prompt('Rename citation to:', item.id)?.trim()
    if (!next || next === item.id) return
    if (bibProvider.get(next)) { setNotice({ text: `"${next}" already exists.`, kind: 'err' }); return }

    // Rewrite in-text citation nodes that reference the old key.
    let changed = 0
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'citation') return
      const keys = (node.attrs.citekeys as string[] | undefined) ?? []
      if (keys.includes(item.id)) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, citekeys: keys.map(k => (k === item.id ? next : k)) })
        changed++
      }
    })
    if (changed) editor.view.dispatch(tr)

    await removeFromLibrary(item.id)
    await addToLibrary({ ...item, id: next })
    setNotice({ text: `Renamed to "${next}"${changed ? ` — ${changed} in-text ${changed === 1 ? 'citation' : 'citations'} updated` : ''}.`, kind: 'ok' })
  }

  // ── Embedded PDFs ────────────────────────────────────────────────────────────
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const pdfTargetRef = useRef<string | null>(null)

  function attachPdf(item: CSLItem) {
    // Already attached → say so instead of silently opening the picker (Peter, 2026-07-10).
    if ((item as { _iw?: IwCitationMeta })._iw?.pdfName) {
      setNotice({ text: 'A PDF is already attached for this item.', kind: 'err' })
      return
    }
    pdfTargetRef.current = item.id
    pdfInputRef.current?.click()
  }

  async function onPdfChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const key = pdfTargetRef.current
    e.target.value = '' // allow re-choosing the same file later
    if (!file || !key) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setNotice({ text: 'That file is not a PDF.', kind: 'err' }); return
    }
    try {
      await savePdf(key, file)
      const item = bibProvider.get(key)
      if (item) {
        const iw: IwCitationMeta = { ...((item as { _iw?: IwCitationMeta })._iw ?? {}), pdfName: file.name }
        await addToLibrary({ ...item, _iw: iw })
      }
      void detectPageOffset(key) // one-time: reconcile PDF sheet index with the book's printed pages
      setNotice({ text: `Embedded PDF for "${key}" — click 📄 next to its citations to open at the cited page.`, kind: 'ok' })
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Could not embed the PDF.', kind: 'err' })
    }
  }

  // Mark a source's PDF "publicly available" → the public-strip export can drop it (it's re-fetchable
  // from its open source).
  async function togglePublic(item: CSLItem) {
    const cur = bibProvider.get(item.id) ?? item
    const iw: IwCitationMeta = { ...((cur as { _iw?: IwCitationMeta })._iw ?? {}) }
    if (iw.publiclyAvailable) delete iw.publiclyAvailable; else iw.publiclyAvailable = true
    await addToLibrary({ ...cur, _iw: iw })
  }

  async function removePdf(item: CSLItem) {
    await deletePdf(item.id).catch(() => {})
    const cur = bibProvider.get(item.id)
    if (cur) {
      const iw = { ...((cur as { _iw?: IwCitationMeta })._iw ?? {}) }
      delete (iw as IwCitationMeta).pdfName
      delete (iw as IwCitationMeta).pdfUrl
      delete (iw as IwCitationMeta).highlights   // annotations belonged to the old PDF
      delete (iw as IwCitationMeta).pageOffset
      delete (iw as IwCitationMeta).pageOffsetFlag
      await addToLibrary({ ...cur, _iw: iw })
    }
    setNotice({ text: `Removed the PDF for "${item.id}".`, kind: 'ok' })
  }

  async function saveEdit(updated: CSLItem) {
    let item = updated
    if (isNewRef) {
      const key = makeCitekey(updated)
      item = { ...updated, id: key }
    }
    await addToLibrary(item)
    setEditItem(null)
    setIsNewRef(false)
    setNotice({ text: `Saved "${item.id}"`, kind: 'ok' })
  }

  function openNewRef() {
    setIsNewRef(true)
    setEditItem({ id: '__new__', type: 'article-journal' } as unknown as CSLItem)
  }

  function toggleExpand(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Re-verify EVERY source in one go (the single top button replaces the per-row ↻). Sequential so we
  // don't hammer the network; the per-item notices are superseded by a final summary.
  async function recheckAll() {
    if (recheckingAll) return
    setRecheckingAll(true)
    let changed = 0, dead = 0
    try {
      for (const item of bibProvider.getAll()) {
        const cur = bibProvider.get(item.id) ?? item
        try {
          const result = await reverifyEntry(cur)
          if (result.deadUrl) { dead++; await addToLibrary(applyReverify(cur, result)) }
          else if (result.ok) { if (result.diffs.length) changed += result.diffs.length; await addToLibrary(applyReverify(cur, result)) }
        } catch { /* skip unreachable */ }
      }
      setNotice({ text: `Re-verified library — ${changed} field${changed === 1 ? '' : 's'} updated${dead ? `, ${dead} dead link${dead === 1 ? '' : 's'}` : ''}.`, kind: dead ? 'warn' : 'ok' })
    } finally {
      setRecheckingAll(false)
    }
  }

  async function revert(item: CSLItem, index: number) {
    await addToLibrary(revertField(item, index))
    setNotice({ text: `Reverted a change in "${item.id}".`, kind: 'ok' })
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

  // Drag state — null means use default centered position.
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [recheckTip, setRecheckTip] = useState(false)

  function panelStyle(): React.CSSProperties {
    if (dragPos) return { position: 'fixed', top: dragPos.top, left: dragPos.left }
    // Default: 18px below top, centred over the writing area (shift left by half the PDF panel width
    // when it's open so the panel doesn't sit under it).
    return { position: 'fixed', top: 18, left: 'calc(50% - var(--iw-pdf-room, 0px) / 2 + var(--iw-pdf-room-left, 0px) / 2)', transform: 'translateX(-50%)' }
  }

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const panel = panelRef.current
    if (!panel) return
    const r = panel.getBoundingClientRect()
    const left = r.left
    const top = r.top
    setDragPos({ left, top })
    dragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: left, origTop: top }

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      setDragPos({
        left: dragRef.current.origLeft + (ev.clientX - dragRef.current.startX),
        top:  dragRef.current.origTop  + (ev.clientY - dragRef.current.startY),
      })
    }
    function onUp() {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return createPortal(
    <>
      {editItem && (
        <EditDialog
          item={editItem}
          isNew={isNewRef}
          onSave={saveEdit}
          onClose={() => { setEditItem(null); setIsNewRef(false) }}
        />
      )}
      {urlConsentPending !== null && (
        <AiConsentDialog
          feature="url"
          onYes={() => {
            setUrlLookup(true); markAiConsent('url')
            const pending = urlConsentPending
            setUrlConsentPending(null)
            void doCapture(pending)
          }}
          onNo={() => setUrlConsentPending(null)}
        />
      )}
      {/* Backdrop — in fullscreen it becomes the aquamarine wave surround (paper floats over it). */}
      <div className={`fixed inset-0 z-[90] ${fullscreen ? 'inkwave-editor-surface' : ''}`} aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog" aria-label="Citations"
        className="iw-nightable z-[91] bg-white shadow-xl font-serif text-sm text-stone-600 flex flex-col"
        style={fullscreen
          ? { position: 'fixed', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)', width: isTouchDevice() ? '100vw' : 'min(1080px, 96vw)', overflow: 'hidden', borderRadius: 0, ...(isTouchDevice() ? {} : { borderLeft: `1px solid var(--iw-nightable-border, ${INK}55)`, borderRight: `1px solid var(--iw-nightable-border, ${INK}55)` }) }
          : { ...panelStyle(), width: 384, height: '80vh', minWidth: 300, minHeight: 320, maxWidth: '96vw', maxHeight: '92vh', resize: 'both', overflow: 'hidden', border: `1px solid var(--iw-nightable-border, ${INK}55)`, borderRadius: 14 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Slim drag grip (fullscreen toggle lives beside the × in the Add row). */}
        <div
          className="flex items-center justify-center pt-2 pb-1"
          style={{ cursor: fullscreen ? 'default' : 'grab' }}
          onMouseDown={fullscreen ? undefined : onHeaderMouseDown}
        >
          {!fullscreen && <div className="w-9 h-1 rounded-full bg-stone-200" />}
        </div>

        {/* Hidden input for embedding source PDFs (📎 on a library row triggers it) */}
        <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={e => void onPdfChosen(e)} />

        {/* Extension promo — top of panel (dismissible) */}
        {!extDismissed && (
          <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between bg-stone-50/60">
            <span className="text-xs text-stone-500">Download the Inkwave citation extension for single-click import on any page, using Claude Sonnet</span>
            <div className="flex gap-2 flex-shrink-0 ml-3 items-center">
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
              <button type="button" onClick={dismissExt} title="Dismiss"
                className="text-stone-400 hover:text-stone-600 text-sm leading-none ml-1 flex items-center">×</button>
            </div>
          </div>
        )}

        <div className={isTouchDevice() ? 'order-3 px-4 pt-2 pb-3 border-t border-stone-100' : 'px-4 pt-3 pb-2 border-b border-stone-100'}>
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && captureable) { e.preventDefault(); void doCapture() } }}
              placeholder="Paste a DOI, arXiv, URL, or search… (Ctrl+F)"
              className="flex-1 text-sm border border-stone-200 rounded px-3 py-2 focus:outline-none focus:border-[#5c2d8a]"
            />
            <button
              type="button" disabled={!captureable || busy} onClick={() => void doCapture()}
              className="text-sm px-3.5 py-1.5 rounded disabled:opacity-40"
              style={{ background: 'var(--iw-addbtn-bg, #5c2d8a)', color: 'var(--iw-addbtn-fg, #fff)', border: '1px solid var(--iw-addbtn-border, transparent)' }}
            >
              {busy ? '…' : 'Add'}
            </button>
            {/* Close — big ×, next to Add (the old titled header bar is gone). */}
            <button type="button" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit full screen' : 'Full screen'}
              className="flex-shrink-0 w-9 rounded border border-stone-200 text-stone-400 hover:text-[#5c2d8a] hover:border-stone-300 text-base leading-none flex items-center justify-center">{fullscreen ? '🗗' : '⛶'}</button>
            <button type="button" onClick={onClose} title="Close (Esc)"
              className="flex-shrink-0 w-9 rounded border border-stone-200 text-stone-400 hover:text-stone-600 hover:border-stone-300 text-2xl leading-none flex items-center justify-center">×</button>
          </div>
          {notice && (
            <div className="mt-1.5 text-[11px]" style={{ color: notice.kind === 'err' ? '#b91c1c' : notice.kind === 'warn' ? '#b45309' : '#15803d' }}>
              {notice.text}
            </div>
          )}
        </div>

        <div className={isTouchDevice() ? 'order-2 px-4 py-2 border-t border-stone-100' : 'px-4 py-2 border-b border-stone-100'}>
          {/* All controls share h-7 so they line up; wrap (never clip) if the panel is narrow.
              Phone: this row + the paste bar sit BELOW the list (order-2/-3), search at the very
              bottom — thumb-reachable (Peter, 2026-07-10). The list is order-1. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['cited', 'all', 'manual'] as RefMode[]).map(m => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                className="h-8 text-[13px] w-14 justify-center rounded border flex items-center"
                style={refMode === m
                  ? { background: `${INK}12`, borderColor: 'var(--iw-cite-color, #5c2d8a)', color: 'var(--iw-cite-color, #5c2d8a)' }
                  : { borderColor: 'var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
              >
                {m === 'cited' ? 'Auto' : m === 'all' ? 'All' : 'Man'}
              </button>
            ))}
            <select value={citationStyle} onChange={e => onStyleChange(e.target.value)}
              className="h-8 text-[13px] text-stone-600 border border-stone-200 rounded px-2 bg-white flex-1 min-w-0">
              {CSL_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {/* Sort — sits just left of + New, per Peter's spec. */}
            <select value={sortBy} onChange={e => changeSort(e.target.value as 'added' | 'alpha' | 'author')}
              title="Sort the library"
              className="h-8 text-[13px] text-stone-600 border border-stone-200 rounded px-1.5 bg-white">
              {/* Three letters + '..' — the select sizes to its longest option (Peter, 2026-07-10). */}
              <option value="added">Rec..</option>
              <option value="alpha">Alp..</option>
              <option value="author">Aut..</option>
            </select>
            <button type="button" onClick={toggleSortDir}
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              className="h-8 w-8 flex items-center justify-center rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a]">
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
            {/* Re-verify all — with a CUSTOM styled tooltip (bigger, deep royal blue). */}
            <div className="relative flex-shrink-0" onMouseEnter={() => setRecheckTip(true)} onMouseLeave={() => setRecheckTip(false)}>
              <button type="button" onClick={() => void recheckAll()} disabled={recheckingAll}
                className="h-8 w-8 flex items-center justify-center rounded border border-stone-300 disabled:opacity-50 hover:bg-[#5c2d8a0d]"
                style={{ color: 'var(--iw-pill-fg, #5c2d8a)' }}>
                {recheckingAll ? '…' : '↻'}
              </button>
              {recheckTip && (
                <div className="absolute z-[95] pointer-events-none" style={{ top: 'calc(100% + 8px)', right: 0, width: 200 }}>
                  <div style={{ background: '#1e3a8a', color: '#fff', fontSize: '0.9rem', lineHeight: 1.35, padding: '8px 11px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.22)' }}>
                    Re-verify all sources against their origins (built on Claude Sonnet)
                  </div>
                </div>
              )}
            </div>
            {/* ↻ before + New (swapped per Peter, 2026-07-10). */}
            <button type="button" onClick={openNewRef}
              className="h-7 px-2 rounded border flex items-center whitespace-nowrap"
              style={{ background: '#e0f2fe', borderColor: '#7dd3fc', color: 'var(--iw-newbtn-fg, #0369a1)' }}>
              + New
            </button>
          </div>
        </div>

        <div className={`iw-snap-scroll flex-1 overflow-y-auto px-4 py-2 ${isTouchDevice() ? 'order-1' : ''} ${fullscreen ? 'grid grid-cols-2 gap-x-6 content-start items-start' : ''}`}>
          {!helpDismissed && (
            <div className={`flex items-start gap-2 mb-2 ${fullscreen ? 'col-span-2' : ''}`}>
              <div className="text-[11px] text-stone-400">
                type <kbd className="font-mono bg-stone-100 border border-stone-200 rounded px-0.5">@</kbd> in the editor to insert · <span className="text-[#5c2d8a]">📎</span> embed a PDF, then <span className="text-[#5c2d8a]">📄</span> next to an in-text citation opens it at the cited page.
              </div>
              <button type="button" onClick={dismissHelp} title="Hide these tips"
                className="ml-auto text-stone-400 hover:text-stone-600 text-base leading-none flex-shrink-0">×</button>
            </div>
          )}
          {entries.length === 0 ? (
            <div className={`py-6 text-center text-xs text-stone-400 ${fullscreen ? 'col-span-2' : ''}`}>
              {query ? 'No matches.' : 'Paste a DOI or URL above to add your first source.'}
            </div>
          ) : entries.map(item => {
            const used = usedKeys.has(item.id)
            const src = SOURCE_BADGE[itemSource(item)]
            const typeLabel = TYPE_LABELS[item.type] ?? item.type
            return (
              <div key={item.id} className="py-1 border-b border-stone-100 last:border-0 cursor-pointer hover:bg-stone-50/60 rounded transition-colors"
                onClick={() => setEditItem(item)}>
                {/* Top line: key + badges on the left, action buttons on the right. */}
                <div className="flex items-center gap-2">
                  {refMode === 'manual' && (
                    <input type="checkbox" checked={manualKeys.has(item.id)} onClick={e => e.stopPropagation()} onChange={() => toggleManual(item)}
                      aria-label={`Include ${item.id} in references`} />
                  )}
                  <div className="flex-1 min-w-0 text-left rounded px-1 -mx-1">
                    <div className="flex items-center gap-1.5">
                      {/* The PURPLE KEY renames on click; everything else in the row (that isn't a
                          button) falls through to the row's click → the ref editor (Peter, 2026-07-10). */}
                      <button type="button" title="Click to rename"
                        className="text-[13px] font-medium truncate hover:underline"
                        style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                        onClick={e => { e.stopPropagation(); void renameCitation(item) }}>{item.id}</button>
                      {/* Verified sources → a compact ✓ box (tooltip on hover); others keep their label. */}
                      {itemSource(item) === 'crossref'
                        ? <span title="verified" className="inline-flex items-center justify-center text-[11px] leading-none rounded flex-shrink-0" style={{ width: 16, height: 16, color: 'var(--iw-verified, #15803d)', border: `1px solid var(--iw-verified, #15803d)` }}>✓</span>
                        : <span className="text-[11px] px-1 rounded flex-shrink-0" style={{ color: src.color, borderColor: src.color, borderWidth: 1, borderStyle: 'solid' }}>{src.label}</span>}
                      <span className="text-[13px] text-stone-600 flex-shrink-0">{typeLabel}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 max-w-[48%]">
                   <div className="flex flex-wrap items-center justify-end gap-1">
                    {(() => {
                      const iw = (item as { _iw?: IwCitationMeta })._iw
                      return iw?.pdfName ? (
                        <>
                          <button type="button"
                            title={`Open embedded PDF (${iw.pdfName})`}
                            className="text-[11px] px-2 py-0.5 rounded border border-[#5c2d8a55] text-[#5c2d8a] hover:border-[#5c2d8a] hover:bg-[#5c2d8a0d] whitespace-nowrap"
                            onClick={e => { e.stopPropagation(); openPdf({ citekey: item.id, page: 1, label: item.id }) }}
                          >📄 PDF</button>
                          <label title='"Publicly available" — this source can be stripped on export (it stays fetchable from its open URL)'
                            className="h-7 px-1.5 flex items-center gap-1 rounded border border-stone-200 text-[11px] text-stone-500 cursor-pointer select-none" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={!!iw.publiclyAvailable} onChange={() => void togglePublic(item)} style={{ width: 13, height: 13 }} />pub
                          </label>
                          <button type="button"
                            title="Remove this PDF (and its annotations)"
                            className="text-[11px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-400 hover:border-red-300 hover:text-red-500"
                            onClick={e => { e.stopPropagation(); if (confirm('Remove this PDF and its annotations?')) void removePdf(item) }}
                          >✕</button>
                        </>
                      ) : (
                        <button type="button"
                          title="Embed a PDF file for this source"
                          className="text-[11px] px-2 py-0.5 rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a] whitespace-nowrap"
                          onClick={e => { e.stopPropagation(); attachPdf(item) }}
                        >📎 PDF</button>
                      )
                    })()}
                    {/* "ren" button removed — rename is click-and-hold on the purple citekey. */}
                    <button type="button" onClick={e => { e.stopPropagation(); void del(item) }}
                      className="text-[11px] px-2 py-0.5 rounded border border-stone-200 text-stone-400 hover:border-red-300 hover:text-red-500">del</button>
                   </div>
                   {/* Second row: cite + visit source */}
                   <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={e => { e.stopPropagation(); cite(item) }} title="Cite inline in the document at the cursor"
                      className="w-7 h-7 flex items-center justify-center rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a] text-[15px] leading-none">@</button>
                    {!!(item.URL || (item as { _iw?: IwCitationMeta })._iw?.sourceUrl) && (
                      <button type="button"
                        title="Open source page (shows verification panel if extension installed)"
                        className="w-7 h-7 flex items-center justify-center rounded border border-stone-200 text-stone-400 hover:border-[#5c2d8a] hover:text-[#5c2d8a] text-[13px]"
                        onClick={e => { e.stopPropagation(); visitSource(item) }}
                      >↗</button>
                    )}
                   </div>
                  </div>
                </div>
                {/* Title on ONE line, truncated with an ellipsis; full title on hover. */}
                {!!String(item.title ?? '') && (
                  <div title={String(item.title ?? '')}
                    className="block max-w-full text-left rounded px-1 -mx-1">
                    <div className="text-[16px] text-stone-500 leading-snug truncate">{String(item.title ?? '')}</div>
                  </div>
                )}
                {(() => {
                  const iw = (item as { _iw?: IwCitationMeta })._iw
                  const changelog = iw?.changelog ?? []
                  const open = expanded.has(item.id)
                  const authorYear = simpleInText([item])
                  return (
                    <>
                      {/* author/year + history + used all on ONE line, to save vertical space */}
                      <div className="mt-0.5 pl-1 flex items-center gap-2">
                        {!!authorYear && (
                          <span title="Click to edit"
                            className="text-[15px] text-stone-400 leading-snug truncate min-w-0 flex-1 text-left">{authorYear}</span>
                        )}
                        {iw?.deadUrl && <span className="text-[12px] text-red-500 border border-red-200 rounded px-1 flex-shrink-0">⚠ dead link</span>}
                        {changelog.length > 0 && (
                          <button type="button" onClick={e => { e.stopPropagation(); toggleExpand(item.id) }}
                            title="Show the correction history (old → new) for this citation"
                            className="text-[12px] px-1 rounded border border-stone-200 text-stone-500 hover:border-[#5c2d8a] hover:text-[#5c2d8a] flex-shrink-0">
                            {open ? '▾' : '▸'} history ({changelog.length})
                          </button>
                        )}
                        {used && <span className="text-[14px] text-green-600 flex-shrink-0">● used</span>}
                        {iw?.lastVerified && !iw?.deadUrl && <span className="text-[12px] text-stone-400 flex-shrink-0" title={`Last re-verified ${new Date(iw.lastVerified).toLocaleString()}`}>✓ {relTime(iw.lastVerified)}</span>}
                      </div>
                      {open && changelog.length > 0 && (
                        <div className="mt-1 ml-1 border-l-2 border-stone-100 pl-2 space-y-1">
                          {changelog.map((c, i) => (
                            <div key={i} className="text-[12px] text-stone-500 flex items-center gap-1.5">
                              <span className="font-medium text-stone-600 flex-shrink-0">{(CSL_FIELD_LABELS_MAP as Record<string, string>)[c.field] ?? c.field}</span>
                              <span className="text-stone-400 line-through truncate max-w-[80px]">{fmtVal(c.field, c.old)}</span>
                              <span className="text-stone-300 flex-shrink-0">→</span>
                              <span className="truncate max-w-[80px]" style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}>{fmtVal(c.field, c.new)}</span>
                              <span className="text-[11px] text-stone-300 flex-shrink-0">{c.source}</span>
                              <button type="button" onClick={() => void revert(item, i)}
                                className="text-[11px] text-stone-400 hover:text-[#5c2d8a] ml-auto flex-shrink-0">revert</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )
          })}
        </div>

      </div>
    </>,
    document.body,
  )
}
