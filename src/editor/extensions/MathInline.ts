import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathInlineView } from './MathInlineView'
import { requestMathEdit } from './mathActivation'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      insertMathInline: (latex?: string) => ReturnType
    }
  }
}

// Inline math node — renders KaTeX when not focused; shows a text input when selected.
// Triggered by: Ctrl-= keyboard shortcut or Σ toolbar button.
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView)
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = '') =>
        ({ chain }) => {
          // Raise the edit-mode flag FIRST — the node view mounts during the dispatch
          // and opens MathLive with the caret inside, ready to type.
          requestMathEdit()
          return chain().focus().insertContent({ type: this.name, attrs: { latex } }).run()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Alt-=': () => this.editor.commands.insertMathInline(),
    }
  },

})
