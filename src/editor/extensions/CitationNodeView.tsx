// React NodeView for CitationNode.
// Uses useSyncExternalStore to subscribe to bibProvider — React 18's designed-for-purpose API
// for external store subscriptions. It forces synchronous, tear-free re-renders when the store
// changes, even inside Tiptap's isolated createRoot. No async state, no subscription races.

import { useSyncExternalStore } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle, getCitationStyle as _getCitationStyle } from '../../citations/citationsBus'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

// Sync in-text formatter. The CSL engine (formatInText) is intentionally NOT used:
// citation-js's fetchEngine calls engine.updateItems([]) before rebuildProcessorState,
// leaving the engine with no items, so citeproc-js falls back to "anonymous".
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

// Stable subscribe function for useSyncExternalStore: bib changes + style changes + DOM event.
const subscribeBibAndStyle = (callback: () => void) => {
  const unsubBib = bibProvider.subscribe(callback)
  const unsubStyle = subscribeCitationStyle(callback)
  window.addEventListener('inkwave:bib-changed', callback)
  return () => { unsubBib(); unsubStyle(); window.removeEventListener('inkwave:bib-changed', callback) }
}

export function CitationNodeView({ node, selected }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs

  // useSyncExternalStore: subscribes to external store, forces a synchronous re-render when the
  // version changes. Computed directly in render — no setState, no async, no batching surprises.
  useSyncExternalStore(
    subscribeBibAndStyle,
    () => bibProvider.getVersion(), // snapshot = version counter; changes on every library edit
  )

  // Compute label synchronously from the current (always fresh) bibProvider state.
  const items: CSLItem[] = []
  const missing: string[] = []
  for (const key of attrs.citekeys) {
    const item = bibProvider.get(key)
    if (item) items.push(item)
    else missing.push(key)
  }

  const label = items.length > 0
    ? inTextLabel(items, {
        suppressAuthor: attrs.suppressAuthor,
        locator: attrs.locator,
        prefix: attrs.prefix,
        suffix: attrs.suffix,
      })
    : missing.map(k => `[?${k}]`).join(' ')

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
