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
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle } from '../../citations/citationsBus'
import {
  bibAnchorId, citeAnchorId, navigateToAnchor, occurrencesAt, ensureNavStyles,
} from '../../citations/citationNav'
import { openPdf, pageFromLocator } from '../../citations/pdfViewer'
import type { CSLItem, InkwaveDocument, IwCitationMeta } from '../../types/document'
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

// One item's in-text text — "Bacon, 2004" / "Smith et al., 2004" / (suppressAuthor) "2004".
function oneCiteText(item: CSLItem, opts: { suppressAuthor?: boolean; locator?: string | null }): string {
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
  const loc = opts.locator ? `, ${opts.locator}` : ''
  return opts.suppressAuthor ? `${year}${loc}` : `${name}, ${year}${loc}`
}

interface Seg {
  key: string
  text: string
  occ: number
  found: boolean
}

export function CitationNodeView({ node, editor, selected, getPos, updateAttributes }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [segs, setSegs] = useState<Seg[]>([])
  const [pdfKey, setPdfKey] = useState<string | null>(null)  // first cited source with an embedded PDF
  const [pageEdit, setPageEdit] = useState<{ key: string; x: number; y: number } | null>(null)

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
      if (item && !firstPdf && (item as { _iw?: IwCitationMeta })._iw?.pdfName) firstPdf = key
      return item
        ? { key, text: oneCiteText(item, a), occ: occMap.get(key) ?? 1, found: true }
        : { key, text: `?${key}`, occ: occMap.get(key) ?? 1, found: false }
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
    schedule() // initial build on mount / re-mount
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', schedule)           // safety net: rebuild on any doc change (also re-numbers)
    window.addEventListener('inkwave:bib-changed', schedule)
    return () => {
      unsubBib()
      unsubStyle()
      editor.off('update', schedule)
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

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        contentEditable={false}
        style={{
          color: hasMissing ? '#b91c1c' : INK,
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
                    <span
                      id={citeAnchorId(s.key, s.occ)}
                      className="iw-cite-link"
                      style={{ color: INK }}
                      title="Set page(s) · go to reference"
                      onClick={e => {
                        e.stopPropagation()
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setPageEdit({ key: s.key, x: r.left, y: r.bottom })
                      }}
                    >
                      {s.text}
                    </span>
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
      {pdfKey && (
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
              onLink: (quote, page) => updateAttributes({ quote, locator: String(page) }),
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
      {pageEdit && (
        <span
          data-iw-pagepop=""
          contentEditable={false}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: pageEdit.x, top: pageEdit.y + 4, zIndex: 300,
            background: '#fff', border: `1px solid ${INK}55`, borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)', padding: '6px 8px',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', color: '#57534e',
            fontFamily: 'system-ui, sans-serif', userSelect: 'none',
          }}
        >
          <span>p.</span>
          <input
            ref={bindStopPM}
            autoFocus
            value={attrs.locator ?? ''}
            onChange={e => updateAttributes({ locator: e.target.value || null })}
            placeholder="2, 4–6"
            style={{ width: 64, fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 5px', outline: 'none' }}
          />
          <button type="button"
            onClick={() => { navigateToAnchor(bibAnchorId(pageEdit.key)); setPageEdit(null) }}
            style={{ fontSize: '11px', color: INK, background: 'transparent', border: `1px solid ${INK}44`, borderRadius: 4, padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            → refs
          </button>
          {pdfKey === pageEdit.key && (
            <button type="button"
              onClick={() => {
                openPdf({ citekey: pageEdit.key, page: pageFromLocator(attrs.locator), quote: attrs.quote,
                  label: segs.find(s => s.key === pageEdit.key)?.text ?? pageEdit.key,
                  onLink: (quote, page) => updateAttributes({ quote, locator: String(page) }) })
                setPageEdit(null)
              }}
              style={{ fontSize: '11px', color: '#fff', background: INK, border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              📄 PDF
            </button>
          )}
        </span>
      )}
    </NodeViewWrapper>
  )
}
