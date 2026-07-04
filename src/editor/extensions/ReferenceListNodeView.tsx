// React NodeView for the reference-list section. Resolves the displayed keys (mode-driven) from the
// live document + bibProvider, then renders them with the real CSL engine in the doc's chosen style;
// falls back to a plain-text list if the CSL engine can't load. Re-renders on: document edits (the
// cited set changes), library changes, and style changes.
//
// Each entry carries a DOM anchor (iwbib-<key>) so in-text citations can scroll to it, and a
// back-reference group ("↩ 1 2 3") — one marker per place the source is cited — that scrolls back to
// each in-text occurrence. Navigation is event-delegated (the CSL html is injected, so React onClick
// can't bind inside it). See citationNav.ts.

import { useEffect, useState, useCallback } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { bibProvider } from '../../citations/bibProvider'
import { referenceListKeys } from '../../citations/resolve'
import { formatReferenceEntries, simpleRefList } from '../../citations/format'
import { getCitationStyle, subscribeCitationStyle } from '../../citations/citationsBus'
import {
  bibAnchorId, citeAnchorId, navigateToAnchor, occurrenceCounts, ensureNavStyles,
} from '../../citations/citationNav'
import type { CSLItem } from '../../types/document'
import type { RefMode } from '../../citations/resolve'

const INK = '#5c2d8a'

const MODE_LABEL: Record<RefMode, string> = {
  cited: 'auto — cited in this document',
  all: 'all library entries',
  manual: 'manually selected',
}

// Back-reference markers linking each reference entry to its in-text occurrences.
function backrefHtml(key: string, occ: number): string {
  if (occ <= 0) return ''
  const marks: string[] = []
  for (let n = 1; n <= occ; n++) {
    marks.push(`<a class="iw-cite-link" data-iw-nav="${citeAnchorId(key, n)}" title="Go to citation ${n}">${n}</a>`)
  }
  return `<span class="iw-backref-group" contenteditable="false">↩ ${marks.join(' ')}</span>`
}

// Inject the entry anchor id + back-refs into a single `.csl-entry` html string.
function decorateEntry(id: string, html: string, occ: number): string {
  // Add id to the entry's outer element (it already carries data-csl-entry-id).
  let out = html.replace(/^(\s*<[a-z]+)/i, `$1 id="${bibAnchorId(id)}"`)
  // Append the back-ref group just before the entry's closing tag.
  const refs = backrefHtml(id, occ)
  if (refs) out = out.replace(/<\/[a-z]+>\s*$/i, m => `${refs}${m}`)
  return out
}

export function ReferenceListNodeView({ node, editor, selected }: NodeViewProps) {
  const mode = (node.attrs.mode as RefMode) ?? 'cited'
  const [html, setHtml] = useState('')
  const [plain, setPlain] = useState<Array<{ id: string; text: string; occ: number }>>([])
  const [count, setCount] = useState(0)

  const rebuild = useCallback(async () => {
    const keys = referenceListKeys(editor.getJSON())
    const items: CSLItem[] = []
    for (const k of keys) { const it = bibProvider.get(k); if (it) items.push(it) }
    const counts = occurrenceCounts(editor.state.doc)
    setCount(items.length)
    if (items.length === 0) { setHtml(''); setPlain([]); return }
    try {
      const entries = await formatReferenceEntries(items, getCitationStyle())
      const body = entries.map(([id, entryHtml]) => decorateEntry(id, entryHtml, counts.get(id) ?? 0)).join('')
      setHtml(body) // container div below already carries .csl-bib-body
      setPlain([])
    } catch {
      setHtml('')
      setPlain(items.map(it => ({ id: it.id, text: simpleRefList([it]), occ: counts.get(it.id) ?? 0 })))
    }
  }, [editor])

  useEffect(() => { ensureNavStyles() }, [])

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

  // Event-delegated navigation: the CSL html is injected, so bind clicks on the container.
  const onBodyClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-iw-nav]')
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    const id = target.getAttribute('data-iw-nav')
    if (id) navigateToAnchor(id)
  }

  // Hanging-indent + inter-entry spacing on the rendered CSL entries.
  const styleEntries = (el: HTMLDivElement | null) => {
    if (!el) return
    el.querySelectorAll<HTMLElement>('.csl-entry').forEach(e => { e.style.marginBottom = '0.75em' })
  }

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
          onClick={onBodyClick}
          dangerouslySetInnerHTML={{ __html: html }}
          ref={styleEntries} />
      ) : (
        <div style={{ fontSize: '0.92em', lineHeight: 1.5 }} onClick={onBodyClick}>
          {plain.map(p => (
            <p key={p.id} id={bibAnchorId(p.id)} style={{ margin: '0 0 0.6em', paddingLeft: '1.5em', textIndent: '-1.5em' }}>
              {p.text}
              {p.occ > 0 && (
                <span className="iw-backref-group" style={{ textIndent: 0 }}>
                  {' ↩ '}
                  {Array.from({ length: p.occ }, (_, i) => (
                    <a key={i} className="iw-cite-link" data-iw-nav={citeAnchorId(p.id, i + 1)}
                      title={`Go to citation ${i + 1}`}>{i + 1}{i < p.occ - 1 ? ' ' : ''}</a>
                  ))}
                </span>
              )}
            </p>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  )
}
