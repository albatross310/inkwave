// Inline atom node for in-text citations.
// attrs: { citekeys, prefix, suffix, locator, suppressAuthor }
// The NodeView renders the formatted citation from bibProvider + embedded data.
// The node itself stores only citekeys + locators — display is always derived.

import { Node, mergeAttributes } from '@tiptap/core'
import { v4 as uuidv4 } from 'uuid'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CitationNodeView } from './CitationNodeView'
import { bibProvider } from '../../citations/bibProvider'
import { simpleInText } from '../../citations/format'

export interface CitationAttrs {
  citekeys: string[]
  prefix?: string | null
  suffix?: string | null
  locator?: string | null
  /** What the locator counts (citations/locator.ts). null = page — the default every existing
   *  citation keeps. DISPLAY ONLY: never read by citationText, so never in a hash. */
  locatorKind?: string | null
  suppressAuthor?: boolean
  quote?: string | null   // pinpoint sentence selected in the source PDF (for open-at + highlight)
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
      // WHAT the locator counts — pages, sections, paragraphs… (citations/locator.ts). DISPLAY
      // ONLY: `citationText` emits the locator VALUE verbatim and never reads this, so a label
      // cannot move a byte of pmToText, the contentHash, or anything anchored to Bitcoin.
      locatorKind:    { default: null,
        parseHTML: el => el.getAttribute('data-loc-kind') || null,
        renderHTML: attrs => (attrs.locatorKind ? { 'data-loc-kind': String(attrs.locatorKind) } : {}) },
      suppressAuthor: { default: false },
      quote:          { default: null },
      // Stable per-INSTANCE id (set on insert). Lets pinpoints/highlights be scoped to THIS citation
      // occurrence, not shared across every citation of the same source. Not part of pmToText.
      instanceId:     { default: null,
        parseHTML: el => el.getAttribute('data-iid') || null,
        renderHTML: attrs => (attrs.instanceId ? { 'data-iid': String(attrs.instanceId) } : {}) },
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
        // Stamp a per-instance id so this occurrence's pinpoints/highlights are its own.
        return commands.insertContent({ type: this.name, attrs: { instanceId: uuidv4(), ...attrs } })
      },
    }
  },
})
