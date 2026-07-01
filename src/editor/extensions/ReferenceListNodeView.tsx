// React NodeView for the reference-list section. Resolves the displayed keys (mode-driven) from the
// live document + bibProvider, then renders them with the real CSL engine in the doc's chosen style;
// falls back to a plain-text list if the CSL engine can't load. Re-renders on: document edits (the
// cited set changes), library changes, and style changes.

import { useEffect, useState, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { referenceListKeys } from '../../citations/resolve'
import { formatReferenceList, simpleRefList } from '../../citations/format'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import type { CSLItem } from '../../types/document'
import type { RefMode } from '../../citations/resolve'

const INK = '#5c2d8a'

const MODE_LABEL: Record<RefMode, string> = {
  cited: 'auto — cited in this document',
  all: 'all library entries',
  manual: 'manually selected',
}

export function ReferenceListNodeView({ node, editor, selected }: NodeViewProps) {
  const mode = (node.attrs.mode as RefMode) ?? 'cited'
  const [html, setHtml] = useState('')
  const [plain, setPlain] = useState<string[]>([])
  const [count, setCount] = useState(0)

  const rebuild = useCallback(async () => {
    const keys = referenceListKeys(editor.getJSON())
    const items: CSLItem[] = []
    for (const k of keys) { const it = bibProvider.get(k); if (it) items.push(it) }
    items.sort((a, b) => a.id.localeCompare(b.id))
    setCount(items.length)
    if (items.length === 0) { setHtml(''); setPlain([]); return }
    try {
      const rendered = await formatReferenceList(items, getCitationStyle())
      setHtml(rendered)
      setPlain([])
    } catch {
      setHtml('')
      setPlain(items.map(it => simpleRefList([it])))
    }
  }, [editor])

  useEffect(() => {
    // Defer rebuilds to a microtask so the setState never runs synchronously inside a ProseMirror
    // transaction dispatch (which would provoke React's flushSync-during-render warning).
    const schedule = () => queueMicrotask(() => void rebuild())
    schedule()
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', schedule)
    return () => { unsubBib(); unsubStyle(); editor.off('update', schedule) }
  }, [rebuild, editor, node.attrs])

  return (
    <NodeViewWrapper
      as="section"
      contentEditable={false}
      style={{
        marginTop: '2.5em',
        paddingTop: '1em',
        borderTop: `1px solid ${INK}33`,
        outline: selected ? `2px solid ${INK}55` : 'none',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6em' }}>
        <h2 style={{ fontSize: '1.15em', fontWeight: 600, color: INK, margin: 0 }}>References</h2>
        <span style={{ fontSize: '0.7em', color: '#9ca3af', fontStyle: 'italic' }}>{MODE_LABEL[mode]}</span>
      </div>
      {count === 0 ? (
        <p style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '0.9em' }}>
          No references yet — cite a source and it will appear here.
        </p>
      ) : html ? (
        <div className="csl-bib-body" style={{ fontSize: '0.92em', lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div style={{ fontSize: '0.92em', lineHeight: 1.5 }}>
          {plain.map((p, i) => <p key={i} style={{ margin: '0 0 0.6em', paddingLeft: '1.5em', textIndent: '-1.5em' }}>{p}</p>)}
        </div>
      )}
    </NodeViewWrapper>
  )
}
