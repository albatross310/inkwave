// Block node that renders the document's reference-list ("References") section at the end of the
// document. It is an atom — its content is DERIVED (from the citation library + the chosen mode),
// never hand-edited. attrs:
//   mode: 'cited' | 'all' | 'manual'   (default 'cited' — Auto: only what's cited in the doc)
//   manualKeys: string[]               (the ticked set, used only in 'manual' mode)
// The mode/manualKeys live in contentJson and are therefore covered by contentHash. The rendered
// entries' metadata is covered by bibHash (via doc.bibliography). See citations spec §10/§12.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { RefMode } from '../../citations/resolve'
import { ReferenceListNodeView } from './ReferenceListNodeView'

export interface ReferenceListAttrs {
  mode: RefMode
  manualKeys: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    referenceList: {
      insertReferenceList: (attrs?: Partial<ReferenceListAttrs>) => ReturnType
      setReferenceListMode: (mode: RefMode) => ReturnType
      setReferenceListManualKeys: (keys: string[]) => ReturnType
    }
  }
}

export const ReferenceListNode = Node.create({
  name: 'referenceList',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      mode: {
        default: 'cited' as RefMode,
        parseHTML: el => (el.getAttribute('data-mode') as RefMode) ?? 'cited',
        renderHTML: attrs => ({ 'data-mode': attrs.mode as string }),
      },
      manualKeys: {
        default: [] as string[],
        parseHTML: el => {
          const raw = el.getAttribute('data-manual') ?? ''
          return raw ? raw.split(';').filter(Boolean) : []
        },
        renderHTML: attrs => ({ 'data-manual': (attrs.manualKeys as string[]).join(';') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-reference-list]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-reference-list': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferenceListNodeView)
  },

  addCommands() {
    return {
      insertReferenceList: (attrs = {}) => ({ commands, state }) => {
        // Only one reference list per document; if one exists, no-op.
        let exists = false
        state.doc.descendants(node => { if (node.type.name === 'referenceList') exists = true })
        if (exists) return false
        // Append at the very end of the document.
        return commands.insertContentAt(state.doc.content.size, {
          type: 'referenceList',
          attrs: { mode: 'cited', manualKeys: [], ...attrs },
        })
      },
      setReferenceListMode: (mode: RefMode) => ({ state, dispatch }) => {
        let pos = -1
        state.doc.descendants((node, p) => { if (node.type.name === 'referenceList') pos = p })
        if (pos < 0) return false
        if (dispatch) dispatch(state.tr.setNodeAttribute(pos, 'mode', mode))
        return true
      },
      setReferenceListManualKeys: (keys: string[]) => ({ state, dispatch }) => {
        let pos = -1
        state.doc.descendants((node, p) => { if (node.type.name === 'referenceList') pos = p })
        if (pos < 0) return false
        if (dispatch) dispatch(state.tr.setNodeAttribute(pos, 'manualKeys', keys))
        return true
      },
    }
  },
})
