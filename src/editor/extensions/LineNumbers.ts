import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const lineNumbersKey = new PluginKey('lineNumbers')

// Adds sequential line numbers to every top-level block via Decoration.node.
// The attribute `data-line-num` is applied to each block's outer DOM element
// (the <p> for paragraphs, the node-view wrapper div for React node views).
// CSS renders the number via ::before, positioned in the right margin.
export const LineNumbers = Extension.create({
  name: 'lineNumbers',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: lineNumbersKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            let lineNum = 1

            state.doc.forEach((node, pos) => {
              if (!node.isBlock) return
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  'data-line-num': String(lineNum++),
                }),
              )
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
