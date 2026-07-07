// React NodeView for CitationNode.
// Mirrors the subscription pattern from ReferenceListNodeView (which demonstrably works):
// queueMicrotask-deferred setState, bibProvider.subscribe, subscribeCitationStyle, and
// editor.on('update'). The microtask deferral avoids calling setState synchronously inside
// Tiptap's flushSync-driven render cycle, which causes React's "flushSync during render" error.
//
// Each citekey renders as its own clickable segment: it carries the occurrence anchor id
// (iwcite-<key>-<n>) that reference back-refs scroll to, and clicking it scrolls to that source's
// entry in the reference list. See citationNav.ts.

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle } from '../../citations/citationsBus'
import {
  citeAnchorId, navigateToBibEntry, goToLastPosition, occurrencesAt, ensureNavStyles, mergePages,
} from '../../citations/citationNav'
import { openPdf, pageFromLocator } from '../../citations/pdfViewer'
import { highlightPages } from '../../citations/pdfHighlights'
import { pageOffsetOf } from '../../citations/pageOffset'
import { hasPdf } from '../../citations/pdfSource'
import { sourceUrlOf, openSourceAtPinpoint } from '../../citations/sourceLink'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

// The page input lives inside the editor DOM, so native editing events must be stopped before they
// bubble to ProseMirror (React handlers fire too late). Same fix as the bibliography notes field.
const STOP_TYPES = ['keydown', 'keyup', 'cut', 'copy', 'paste', 'drop', 'dragstart', 'mousedown', 'pointerdown', 'click']
function bindStopPM(el: HTMLInputElement | null): void {
  const marked = el as (HTMLInputElement & { _iwStopBound?: boolean }) | null
  if (!marked || marked._iwStopBound) return
  marked._iwStopBound = true
  const stop = (e: Event) => e.stopPropagation()
  for (const t of STOP_TYPES) marked.addEventListener(t, stop)
}

// One item's in-text text — "Bacon, 2004" / "Smith et al., 2004, 2–4" / (suppressAuthor) "2004".
// `pages` is the already-merged page string (manual locator ∪ pages carrying a PDF highlight).
function oneCiteText(item: CSLItem, opts: { suppressAuthor?: boolean; pages?: string }): string {
  const authors = item.author ?? []
  let name: string
  if (authors.length === 0) {
    name = opts.suppressAuthor ? '' : (typeof item.title === 'string' ? item.title.slice(0, 20) : '?')
  } else if (opts.suppressAuthor) {
    name = ''
  } else if (authors.length === 1) {
    name = authors[0].family ?? authors[0].literal ?? '?'
  } else if (authors.length === 2) {
    const a = authors[0].family ?? authors[0].literal ?? '?'
    const b = authors[1].family ?? authors[1].literal ?? '?'
    name = `${a} & ${b}`
  } else {
    name = `${authors[0].family ?? authors[0].literal ?? '?'} et al.`
  }
  const year = item.issued?.['date-parts']?.[0]?.[0] ?? 'n.d.'
  const loc = opts.pages ? `, ${opts.pages}` : ''
  return opts.suppressAuthor ? `${year}${loc}` : `${name}, ${year}${loc}`
}

interface Seg {
  key: string
  text: string       // author-year WITHOUT the page (the page is a separate link now)
  pages: string      // "p. 5" / "pp. 3–7" — clickable, opens the source at that page
  pageNum: number | null
  hasPdf: boolean
  occ: number
  found: boolean
}

export function CitationNodeView({ node, editor, selected, getPos, updateAttributes }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [segs, setSegs] = useState<Seg[]>([])
  const [pdfKey, setPdfKey] = useState<string | null>(null)  // first cited source with an embedded PDF
  const [pageEdit, setPageEdit] = useState<{ key: string; x: number; y: number } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)

  useEffect(() => {
    if (!pageEdit) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest?.('[data-iw-pagepop]')) return
      setPageEdit(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [pageEdit])

  // Always-current ref — avoids stale closure inside the subscription callback.
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  const buildLabel = useCallback(() => {
    const a = attrsRef.current
    const pos = typeof getPos === 'function' ? getPos() : null
    const occMap = pos != null ? occurrencesAt(editor.state.doc, pos) : new Map<string, number>()
    let firstPdf: string | null = null
    const next: Seg[] = a.citekeys.map(key => {
      const item = bibProvider.get(key)
      if (item && !firstPdf && hasPdf(item)) firstPdf = key
      // Displayed pages = manual locator ∪ printed pages that carry a highlight (PDF sheet + offset).
      const off = pageOffsetOf(item)
      const pages = item ? mergePages(a.locator, highlightPages(item).map(p => p + off)) : ''
      const pageLabel = pages ? (/[–-]/.test(pages) || /,/.test(pages) ? `pp. ${pages}` : `p. ${pages}`) : ''
      return item
        // text is author-year only (pages passed empty) so the page can be its OWN clickable link.
        ? { key, text: oneCiteText(item, { suppressAuthor: a.suppressAuthor, pages: '' }), pages: pageLabel, pageNum: pageFromLocator(pages) ?? null, hasPdf: hasPdf(item), occ: occMap.get(key) ?? 1, found: true }
        : { key, text: `?${key}`, pages: '', pageNum: null, hasPdf: false, occ: occMap.get(key) ?? 1, found: false }
    })
    setSegs(next)
    setPdfKey(firstPdf)
  }, [editor, getPos]) // reads attrs from attrsRef

  // Keep a ref so the subscription closure always calls the current version.
  const buildLabelRef = useRef(buildLabel)
  buildLabelRef.current = buildLabel

  useEffect(() => { ensureNavStyles() }, [])

  useEffect(() => {
    // queueMicrotask: defer setState so it never runs synchronously inside Tiptap's flushSync
    // render cycle (mirrors ReferenceListNodeView's proven subscription pattern).
    const schedule = () => queueMicrotask(() => buildLabelRef.current())
    // DEBOUNCED rebuild for doc edits: every citation node subscribes to 'update', and each rebuild
    // walks the whole doc (occurrencesAt) to re-number — so rebuilding all of them on EVERY keystroke
    // is O(citations × docSize) per keystroke, the mid-editing lag on a citation-heavy thesis. Occurrence
    // numbering only needs to catch up shortly after typing settles, so debounce it. (bib/style changes
    // stay immediate — they're rare.)
    let updTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleFromEdit = () => { if (updTimer) clearTimeout(updTimer); updTimer = setTimeout(schedule, 350) }
    schedule() // initial build on mount / re-mount
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', scheduleFromEdit)
    window.addEventListener('inkwave:bib-changed', schedule)
    return () => {
      unsubBib()
      unsubStyle()
      editor.off('update', scheduleFromEdit)
      if (updTimer) clearTimeout(updTimer)
      window.removeEventListener('inkwave:bib-changed', schedule)
    }
  }, [editor]) // re-subscribe if editor instance changes

  // Also rebuild when node attrs change (e.g., different citekeys after editing a citation).
  useEffect(() => {
    queueMicrotask(() => buildLabelRef.current())
  }, [attrs.citekeys, attrs.suppressAuthor, attrs.locator, attrs.prefix, attrs.suffix])

  const hasMissing = segs.some(s => !s.found)
  const pre = attrs.prefix ? `${attrs.prefix} ` : ''
  const suf = attrs.suffix ?? ''
  const pageEditUrl = pageEdit ? sourceUrlOf(bibProvider.get(pageEdit.key)) : null

  // Navigate to the cited sentence: PDF (at the quote) when this source has one, else the web source.
  function goToPinpoint() {
    if (!pageEdit) return
    const key = pageEdit.key
    if (pdfKey === key) {
      openPdf({
        citekey: key, page: pageFromLocator(attrs.locator), quote: attrs.quote,
        label: segs.find(s => s.key === key)?.text ?? key,
        onLink: (quote) => updateAttributes({ quote }),
      })
    } else if (pageEditUrl) {
      openSourceAtPinpoint(pageEditUrl, { quote: attrs.quote, page: pageFromLocator(attrs.locator) })
    }
    setPageEdit(null)
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        contentEditable={false}
        style={{
          // via a CSS var so night mode can recolour citations (light blue) without an inline override.
          color: hasMissing ? '#b91c1c' : 'var(--iw-cite-color, #5c2d8a)',
          background: selected ? `${INK}18` : undefined,
          borderRadius: 3,
          padding: '0 2px',
          cursor: 'default',
          userSelect: 'none',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      >
        {segs.length === 0
          ? `[${attrs.citekeys.join('; ')}]`
          : (
            <>
              {pre}(
              {segs.map((s, i) => (
                <span key={s.key + i}>
                  {s.found ? (
                    <>
                      {/* Author-year — click RETURNS the reader to where they last were; click & hold sets pages. */}
                      <span
                        id={citeAnchorId(s.key, s.occ)}
                        className="iw-cite-link"
                        style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                        title="Click: back to where you were · Click & hold: set page(s)"
                        onPointerDown={e => {
                          e.stopPropagation()
                          heldRef.current = false
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          holdTimer.current = setTimeout(() => {
                            heldRef.current = true
                            setPageEdit({ key: s.key, x: r.left + r.width / 2, y: r.top })
                          }, 450)
                        }}
                        onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                        onPointerLeave={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                        onClick={e => {
                          e.stopPropagation()
                          if (heldRef.current) { heldRef.current = false; return } // opened the popover — don't navigate
                          goToLastPosition()
                        }}
                      >
                        {s.text}
                      </span>
                      {/* Page(s) — clickable link that opens the SOURCE (PDF) at that page. */}
                      {s.pages && (
                        s.hasPdf ? (
                          <>
                            {', '}
                            <span className="iw-cite-link" style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                              title="Open the source at this page"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => {
                                e.stopPropagation()
                                openPdf({ citekey: s.key, page: s.pageNum ?? pageFromLocator(attrs.locator), quote: attrs.quote, label: s.text, onLink: (quote) => updateAttributes({ quote }) })
                              }}
                            >{s.pages}</span>
                          </>
                        ) : <>{', '}{s.pages}</>
                      )}
                      {/* Side button → the bibliography entry (moved off the whole inline). */}
                      <button type="button" contentEditable={false} className="iw-cite-biblink"
                        title="Go to the reference-list entry"
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); navigateToBibEntry(s.key, s.occ) }}
                      >⤵</button>
                    </>
                  ) : (
                    <span id={citeAnchorId(s.key, s.occ)} style={{ color: '#b91c1c' }} title={`Unresolved: ${s.key}`}>
                      {s.text}
                    </span>
                  )}
                  {i < segs.length - 1 ? '; ' : ''}
                </span>
              ))}
              ){suf}
            </>
          )}
      </span>
      {/* 📄 opens the PDF — only when there's no page shown (else the page number itself is the link). */}
      {pdfKey && !segs.some(s => s.pages) && (
        <button
          type="button"
          contentEditable={false}
          onClick={e => {
            e.stopPropagation()
            openPdf({
              citekey: pdfKey,
              page: pageFromLocator(attrs.locator),
              quote: attrs.quote,
              label: segs.find(s => s.key === pdfKey)?.text ?? pdfKey,
              // Selecting a sentence in the PDF sets this citation's pinpoint (quote + page).
              // Only store the quote; the page shows via the highlight (offset-corrected), so we
              // don't also write a raw-PDF-page locator that would double-count.
              onLink: (quote) => updateAttributes({ quote }),
            })
          }}
          title={attrs.quote ? 'Open PDF at the linked sentence' : `Open PDF${attrs.locator ? ` at ${attrs.locator}` : ''} — select a sentence to link it`}
          style={{
            marginLeft: 2, padding: '0 2px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontSize: '0.82em', lineHeight: 1, verticalAlign: 'baseline',
            userSelect: 'none',
          }}
        >
          📄
        </button>
      )}
      {pageEdit && createPortal(
        <span
          data-iw-pagepop=""
          className="iw-nightable"
          contentEditable={false}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: pageEdit.x, top: pageEdit.y, zIndex: 300,
            transform: 'translate(-50%, calc(-100% - 8px))', // centred directly above the citation
            background: '#fff', border: `1px solid ${INK}55`, borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)', padding: '6px 8px',
            display: 'flex', flexDirection: 'column', gap: 6, fontSize: '12px', color: '#57534e',
            fontFamily: 'system-ui, sans-serif', userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>p.</span>
            <input
              ref={bindStopPM}
              autoFocus
              value={attrs.locator ?? ''}
              onChange={e => updateAttributes({ locator: e.target.value || null })}
              placeholder="2, 4–6"
              style={{ width: 60, fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 5px', outline: 'none' }}
            />
          </div>
          {/* Go to the cited sentence: opens the embedded PDF at that quote if there is one, otherwise
              deep-links the web source (#:~:text=). Enter in the box or the → go button both navigate —
              typing a quote alone used to just STORE it (nothing happened), which is the bug Peter hit. */}
          {(pdfKey === pageEdit.key || pageEditUrl) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                ref={bindStopPM}
                value={attrs.quote ?? ''}
                onChange={e => updateAttributes({ quote: e.target.value || null })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goToPinpoint() } }}
                placeholder={pdfKey === pageEdit.key ? 'cited sentence (opens the PDF there)' : 'cited sentence (opens the source there)'}
                style={{ flex: 1, minWidth: 150, fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 5px', outline: 'none' }}
              />
              <button type="button"
                title={pdfKey === pageEdit.key ? 'Open the PDF at this sentence' : 'Open the source in your browser at this sentence'}
                onClick={goToPinpoint}
                style={{ fontSize: '11px', color: '#fff', background: INK, border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                → go
              </button>
            </div>
          )}
        </span>,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
