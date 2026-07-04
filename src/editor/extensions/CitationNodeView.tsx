// React NodeView for CitationNode.
// Renders the in-text citation with the real CSL engine in the doc's current style.
// Falls back to simpleInText if citation-js hasn't loaded yet. Falls back to [?key] when unresolved.

import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { formatInText, simpleInText } from '../../citations/format'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

export function CitationNodeView({ node, selected }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [label, setLabel] = useState('')
  const [missing, setMissing] = useState<string[]>([])

  // Keep attrs in a ref so the stable subscription closure always reads the latest values
  // (node.attrs is a fresh object on every render so useCallback([attrs]) would recreate
  // buildLabel — and the useEffect([buildLabel]) would re-subscribe — on every editor update,
  // risking missed notifications during the cleanup/re-subscribe cycle).
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  const buildLabel = async () => {
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
    let text: string
    try {
      text = await formatInText(items, getCitationStyle(), {
        suppressAuthor: a.suppressAuthor,
        locator: a.locator ?? undefined,
        prefix: a.prefix ?? undefined,
        suffix: a.suffix ?? undefined,
      })
    } catch {
      // CSL engine not loaded yet — fall back to simple format
      text = simpleInText(items)
      if (a.locator) text = text.replace(/\)$/, `, ${a.locator})`)
      if (a.prefix) text = `${a.prefix} ${text}`
      if (a.suffix) text = text.replace(/\)$/, `${a.suffix})`)
    }
    setLabel(text)
  }

  // Keep buildLabel in a ref so the stable subscription closure always calls the latest version.
  const buildLabelRef = useRef(buildLabel)
  buildLabelRef.current = buildLabel

  useEffect(() => {
    // Subscribe once on mount. Belt-and-suspenders: both the module singleton (bibProvider.subscribe)
    // and the DOM event (inkwave:bib-changed) are used — NodeViews live in separate React roots and
    // the module singleton can silently fail if the module is duplicated by the bundler.
    const schedule = () => queueMicrotask(() => void buildLabelRef.current())
    schedule()
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    window.addEventListener('inkwave:bib-changed', schedule)
    return () => { unsubBib(); unsubStyle(); window.removeEventListener('inkwave:bib-changed', schedule) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-build when node attrs change (citekey added/removed, locator edited, etc.)
  useEffect(() => {
    void buildLabelRef.current()
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
