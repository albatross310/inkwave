// React NodeView for CitationNode.
// Renders the in-text citation with the real CSL engine in the doc's current style.
// Falls back to simpleInText if citation-js hasn't loaded yet. Falls back to [?key] when unresolved.

import { useEffect, useState, useCallback } from 'react'
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

  const buildLabel = useCallback(async () => {
    const items: CSLItem[] = []
    const miss: string[] = []
    for (const key of attrs.citekeys) {
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
        suppressAuthor: attrs.suppressAuthor,
        locator: attrs.locator ?? undefined,
        prefix: attrs.prefix ?? undefined,
        suffix: attrs.suffix ?? undefined,
      })
    } catch {
      // CSL engine not loaded yet — fall back to simple format
      text = simpleInText(items)
      if (attrs.locator) text = text.replace(/\)$/, `, ${attrs.locator})`)
      if (attrs.prefix) text = `${attrs.prefix} ${text}`
      if (attrs.suffix) text = text.replace(/\)$/, `${attrs.suffix})`)
    }
    setLabel(text)
  }, [attrs])

  useEffect(() => {
    const schedule = () => queueMicrotask(() => void buildLabel())
    schedule()
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    return () => { unsubBib(); unsubStyle() }
  }, [buildLabel])

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
