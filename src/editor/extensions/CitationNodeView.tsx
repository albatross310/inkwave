// React NodeView for CitationNode.
// Renders the in-text citation from bibProvider (live) or embedded bibliography (offline).
// Falls back to [?key] when the key is unresolved.

import { useEffect, useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { simpleInText } from '../../citations/format'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

export function CitationNodeView({ node, selected }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [label, setLabel] = useState('')
  const [missing, setMissing] = useState<string[]>([])

  function buildLabel() {
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
    let text = simpleInText(items)
    if (attrs.locator) text = text.replace(/\)$/, `, ${attrs.locator})`)
    if (attrs.prefix) text = `${attrs.prefix} ${text}`
    if (attrs.suffix) text = text.replace(/\)$/, `${attrs.suffix})`)
    setLabel(text)
  }

  useEffect(() => {
    buildLabel()
    return bibProvider.subscribe(buildLabel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs])

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
