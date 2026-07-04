// React NodeView for CitationNode.
// Mirrors the subscription pattern from ReferenceListNodeView (which demonstrably works):
// queueMicrotask-deferred setState, bibProvider.subscribe, subscribeCitationStyle, and
// editor.on('update'). The microtask deferral avoids calling setState synchronously inside
// Tiptap's flushSync-driven render cycle, which causes React's "flushSync during render" error.

import { useEffect, useState, useCallback, useRef } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle } from '../../citations/citationsBus'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

// Sync in-text formatter — bypasses citation-js to avoid the fetchEngine/updateItems([]) bug
// where citeproc-js loses its item registry and falls back to "anonymous".
function inTextLabel(items: CSLItem[], opts: {
  suppressAuthor?: boolean
  locator?: string | null
  prefix?: string | null
  suffix?: string | null
}): string {
  if (items.length === 0) return ''
  const parts = items.map(item => {
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
  })
  const inner = parts.join('; ')
  const base = `(${inner})`
  const pre = opts.prefix ? `${opts.prefix} ` : ''
  const suf = opts.suffix ?? ''
  return `${pre}${base}${suf}`
}

export function CitationNodeView({ node, editor, selected }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [label, setLabel] = useState('')
  const [missing, setMissing] = useState<string[]>([])

  // Always-current ref — avoids stale closure inside the subscription callback.
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  const buildLabel = useCallback(() => {
    const a = attrsRef.current
    const items: CSLItem[] = []
    const miss: string[] = []
    for (const key of a.citekeys) {
      const item = bibProvider.get(key)
      if (item) items.push(item)
      else miss.push(key)
    }
    setMissing(miss)
    if (items.length === 0) {
      setLabel(miss.map(k => `[?${k}]`).join(' '))
      return
    }
    setLabel(inTextLabel(items, {
      suppressAuthor: a.suppressAuthor,
      locator: a.locator,
      prefix: a.prefix,
      suffix: a.suffix,
    }))
  }, []) // stable — reads from attrsRef

  // Keep a ref so the subscription closure always calls the current version.
  const buildLabelRef = useRef(buildLabel)
  buildLabelRef.current = buildLabel

  useEffect(() => {
    // queueMicrotask: defer setState so it never runs synchronously inside Tiptap's flushSync
    // render cycle (mirrors ReferenceListNodeView's proven subscription pattern).
    const schedule = () => queueMicrotask(() => buildLabelRef.current())
    schedule() // initial build on mount / re-mount
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', schedule)           // safety net: rebuild on any doc change
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

  const hasMissing = missing.length > 0

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
        title={hasMissing ? `Unresolved: ${missing.join(', ')}` : attrs.citekeys.join('; ')}
      >
        {label || `[${attrs.citekeys.join('; ')}]`}
      </span>
    </NodeViewWrapper>
  )
}
