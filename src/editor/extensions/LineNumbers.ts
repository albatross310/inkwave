import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const lineNumbersKey = new PluginKey('lineNumbers')

// Equation numbers for math blocks (data-eq-num="N"), rendered as "(N)" in the right margin.
// Paragraph line numbers have been removed — only math/equation blocks are numbered.
export const LineNumbers = Extension.create({
  name: 'lineNumbers',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: lineNumbersKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            let eqNum = 1

            state.doc.forEach((node, pos) => {
              if (!node.isBlock) return
              if (node.type.name === 'mathBlock') {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    'data-eq-num': String(eqNum++),
                  }),
                )
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
