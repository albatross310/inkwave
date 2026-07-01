// Inline atom node for in-text citations.
// attrs: { citekeys, prefix, suffix, locator, suppressAuthor }
// The NodeView renders the formatted citation from bibProvider + embedded data.
// The node itself stores only citekeys + locators — display is always derived.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CitationNodeView } from './CitationNodeView'
import { bibProvider } from '../../citations/bibProvider'
import { simpleInText } from '../../citations/format'

export interface CitationAttrs {
  citekeys: string[]
  prefix?: string | null
  suffix?: string | null
  locator?: string | null
  suppressAuthor?: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationAttrs) => ReturnType
    }
  }
}

export const CitationNode = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      citekeys: {
        default: [],
        parseHTML: el => {
          const raw = el.getAttribute('data-citekeys') ?? ''
          return raw ? raw.split(';').filter(Boolean) : []
        },
        renderHTML: attrs => ({ 'data-citekeys': (attrs.citekeys as string[]).join(';') }),
      },
      prefix:         { default: null },
      suffix:         { default: null },
      locator:        { default: null },
      suppressAuthor: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },

  // Emit a visible, resolved label into static HTML so exports / copy-paste / pmToText don't drop
  // citations. Uses the sync simple form (CSL is async and unavailable here); the live NodeView
  // renders the styled form. Falls back to the bare keys when the library isn't resolved.
  renderHTML({ node, HTMLAttributes }) {
    const keys = (node.attrs.citekeys as string[]) ?? []
    const items = keys.map(k => bibProvider.get(k)).filter((x): x is NonNullable<typeof x> => !!x)
    const label = items.length ? simpleInText(items) : (keys.length ? `(${keys.join('; ')})` : '')
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '' }), label]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView)
  },

  addCommands() {
    return {
      insertCitation: (attrs: CitationAttrs) => ({ commands }) => {
        return commands.insertContent({ type: this.name, attrs })
      },
    }
  },
})
