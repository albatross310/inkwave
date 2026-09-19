import { Fragment, type ReactNode } from 'react'
import type { TiptapJSON, CSLItem } from '../types/document'
import { bibProvider } from '../citations/bibProvider'
import { simpleInText } from '../citations/format'
import { StoredMediaFigureContents, storedMediaFigureStyle, type StoredMediaImageAttrs } from './StoredMediaImage'

// A small, read-only renderer for a TiptapJSON document — used by the snapshot viewer to show an
// old version exactly as written, with no editor/ProseMirror machinery. Handles the node + mark
// types Inkwave produces (paragraphs, headings, lists, blockquote, code, inline marks, citations).

export type SnapshotMark = { type: string; attrs?: Record<string, unknown> }
type Node = { type?: string; text?: string; marks?: SnapshotMark[]; attrs?: Record<string, unknown>; content?: Node[] }

// In-text citation → "(Author, Year)" from the loaded library, falling back to the bare citekeys.
// Without this a citation (a leaf atom with no text/content) would render as nothing.
function citationInline(attrs: Node['attrs'], key: number): ReactNode {
  const keys = (attrs?.citekeys as string[] | undefined) ?? []
  if (!keys.length) return null
  const items = keys.map(k => bibProvider.get(k)).filter((x): x is CSLItem => !!x)
  const label = items.length ? simpleInText(items) : `(${keys.join('; ')})`
  // The citation token, not a literal: this renders inside /snapshot's doc pane, whose paper is
  // charcoal at night — the editor's own in-text hooks already resolve through --iw-cite-color.
  return <span key={key} style={{ color: 'var(--iw-cite-color, #302438)' }}>{label}</span>
}

/** Render persisted PM marks without mounting an EditorView. Snapshot and rich-diff views share
 * this exact function so a historical font cannot silently fall back in one of the two paths. */
export function applySnapshotMarks(content: ReactNode, marks: SnapshotMark[] | undefined): ReactNode {
  let el: ReactNode = content
  for (const m of marks ?? []) {
    if (m.type === 'bold') el = <strong>{el}</strong>
    else if (m.type === 'italic') el = <em>{el}</em>
    else if (m.type === 'underline') el = <u>{el}</u>
    else if (m.type === 'strike') el = <s>{el}</s>
    else if (m.type === 'code') el = <code>{el}</code>
    else if (m.type === 'textStyle') {
      const attrs = m.attrs ?? {}
      const style: React.CSSProperties = {}
      if (typeof attrs.fontFamily === 'string') style.fontFamily = attrs.fontFamily
      if (typeof attrs.fontSize === 'string') style.fontSize = attrs.fontSize
      if (typeof attrs.color === 'string') style.color = attrs.color
      if (Object.keys(style).length) el = <span style={style}>{el}</span>
    } else if (m.type === 'highlight') {
      // This fallback is persisted document ink, not application chrome: old Tiptap highlight
      // marks may omit attrs.color and mean the extension's canonical yellow default.
      const color = typeof m.attrs?.color === 'string' ? m.attrs.color : '#ffff00'
      el = <mark style={{ backgroundColor: color }}>{el}</mark>
    }
  }
  return el
}

function applyMarks(text: string, marks: Node['marks'], key: number): ReactNode {
  return <Fragment key={key}>{applySnapshotMarks(text, marks)}</Fragment>
}

function inline(nodes: Node[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />
    if (n.type === 'text') return applyMarks(n.text ?? '', n.marks, i)
    if (n.type === 'citation') return citationInline(n.attrs, i)
    return <Fragment key={i}>{inline(n.content)}</Fragment>
  })
}

function block(node: Node, key: number): ReactNode {
  const kids = node.content
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2)
      const Tag = (`h${Math.min(6, Math.max(1, level))}`) as keyof JSX.IntrinsicElements
      return <Tag key={key}>{inline(kids)}</Tag>
    }
    case 'bulletList':
      return <ul key={key}>{(kids ?? []).map((c, i) => block(c, i))}</ul>
    case 'orderedList':
      return <ol key={key}>{(kids ?? []).map((c, i) => block(c, i))}</ol>
    case 'listItem':
      return <li key={key}>{(kids ?? []).map((c, i) => block(c, i))}</li>
    case 'blockquote':
      return <blockquote key={key}>{(kids ?? []).map((c, i) => block(c, i))}</blockquote>
    case 'codeBlock':
      return <pre key={key}><code>{inline(kids)}</code></pre>
    case 'paragraph':
      return <p key={key}>{inline(kids)}</p>
    case 'mediaImage':
      return <figure key={key} className="iw-media-image" style={storedMediaFigureStyle(node.attrs as unknown as StoredMediaImageAttrs)}><StoredMediaFigureContents attrs={node.attrs as unknown as StoredMediaImageAttrs} /></figure>
    default:
      // Unknown container — render its children if any, else nothing.
      return kids ? <Fragment key={key}>{kids.map((c, i) => block(c, i))}</Fragment> : null
  }
}

export function DocView({ doc }: { doc: TiptapJSON }) {
  const top = (doc as Node).content ?? []
  return <>{top.map((n, i) => block(n, i))}</>
}
