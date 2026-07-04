// React NodeView for CitationNode.
// Renders in-text citations synchronously from bibProvider — no async CSL engine here.
// The CSL engine (citation-js) has a caching bug where engine.updateItems([]) clears
// registered items before rebuildProcessorState runs, causing stale "anonymous" output on
// re-renders. Since in-text labels only need "(Author, Year[, locator])", we compute them
// directly and stay instantly reactive to library edits.

import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle } from '../../citations/citationsBus'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

// Sync in-text formatter — produces "(Author1 & Author2, Year, locator)" for all styles.
// The CSL engine (formatInText) is intentionally NOT used here: it has a caching defect
// that causes stale data on repeated calls with the same citekey. The reference list uses
// the CSL engine for full bibliography formatting; in-text hooks only need author+year.
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
    return opts.suppressAuthor ? String(year) + loc : `${name}, ${year}${loc}`
  })

  const inner = parts.join('; ')
  const base = `(${inner})`
  const pre = opts.prefix ? `${opts.prefix} ` : ''
  const suf = opts.suffix ?? ''
  return `${pre}${base}${suf}`
}

export function CitationNodeView({ node, selected }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [label, setLabel] = useState('')
  const [missing, setMissing] = useState<string[]>([])

  // Keep attrs in a ref so the stable subscription closure always reads the latest values.
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  const buildLabel = () => {
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
  }

  const buildLabelRef = useRef(buildLabel)
  buildLabelRef.current = buildLabel

  useEffect(() => {
    // Subscribe once on mount. Belt-and-suspenders: module singleton + DOM event, because
    // Tiptap renders NodeViews in isolated React roots (createRoot) which can silently
    // sever module-singleton subscriptions in some bundler configurations.
    const run = () => buildLabelRef.current()
    run()
    const unsubBib = bibProvider.subscribe(run)
    const unsubStyle = subscribeCitationStyle(run)
    window.addEventListener('inkwave:bib-changed', run)
    return () => { unsubBib(); unsubStyle(); window.removeEventListener('inkwave:bib-changed', run) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-build when node attrs change (citekey added/removed, locator edited, etc.)
  useEffect(() => {
    buildLabelRef.current()
  }, [attrs.citekeys, attrs.suppressAuthor, attrs.locator, attrs.prefix, attrs.suffix]) // eslint-disable-line react-hooks/exhaustive-deps

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
