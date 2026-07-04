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
                      title={`Go to reference: ${s.key}`}
                      onClick={e => { e.stopPropagation(); navigateToAnchor(bibAnchorId(s.key)) }}
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
    </NodeViewWrapper>
  )
}
