import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathInlineView } from './MathInlineView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      insertMathInline: (latex?: string) => ReturnType
    }
  }
}

// Inline math node — renders KaTeX when not focused; shows a text input when selected.
// Triggered by: Ctrl-= keyboard shortcut, Σ toolbar button, or the $...$ input rule.
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
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl-= is the physical =/+ key with Ctrl held.
      'Ctrl-=': () => this.editor.commands.insertMathInline(),
    }
  },

  addInputRules() {
    // Converts $latex$ → inline math node on closing $.
    return [
      nodeInputRule({
        find: /(?<!\$)\$([^$\n]+)\$(?!\$)$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ]
  },
})
