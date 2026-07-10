import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { MathBlockView } from './MathBlockView'
import { requestMathEdit } from './mathActivation'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (latex?: string, align?: 'aligned' | 'center' | 'left') => ReturnType
    }
  }
}

// Display-mode math block. `align` controls rendering:
//   'aligned' (default) — wraps in \begin{aligned}…\end{aligned}; use & for = alignment
//   'center'            — standard KaTeX displayMode: centered
//   'left'              — display mode, CSS text-align: left
// Triggered by: Ctrl-Shift-= or Σ toolbar button.
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '' },
      align: { default: 'aligned' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView)
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '', align = 'aligned') =>
        ({ chain }) => {
          // Raise the edit-mode flag FIRST — the node view mounts during the dispatch
          // and opens MathLive with the caret inside, ready to type.
          requestMathEdit()
          return chain().focus().insertContent({ type: this.name, attrs: { latex, align } }).run()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-=': () => this.editor.commands.insertMathBlock(),
    }
  },

  addProseMirrorPlugins() {
    return [
      // Trailing-paragraph guarantee: the document must never END with a math block.
      // Without it, "click right of / below the block at doc end" has no text position
      // to land on and relies on the (easy-to-miss) gap cursor. Runs as appendTransaction
      // so paste / deletion of the trailing paragraph re-establishes the invariant too.
      new Plugin({
        key: new PluginKey('mathBlockTrailingParagraph'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(tr => tr.docChanged)) return null
          const last = newState.doc.lastChild
          if (!last || last.type.name !== 'mathBlock') return null
          const paragraph = newState.schema.nodes.paragraph
          if (!paragraph) return null
          return newState.tr.insert(newState.doc.content.size, paragraph.create())
        },
      }),
    ]
  },
})
