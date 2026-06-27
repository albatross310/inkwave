import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathBlockView } from './MathBlockView'

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
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex, align } }),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Ctrl-Shift-=': () => this.editor.commands.insertMathBlock(),
    }
  },
})
