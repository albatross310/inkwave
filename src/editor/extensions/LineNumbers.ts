import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const lineNumbersKey = new PluginKey('lineNumbers')

// Adds sequential global line numbers to the right margin of every block node.
// Numbers are right-aligned at a fixed distance from the paragraph's right edge.
// Relies on the paragraph's `contain: layout` making it the absolute-positioning
// context, and on `overflow: visible` (the default) allowing paint outside the box.
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
              const num = lineNum++
              const widget = Decoration.widget(
                pos + 1,
                () => {
                  const span = document.createElement('span')
                  span.className = 'inkwave-line-num'
                  span.textContent = String(num)
                  span.setAttribute('contenteditable', 'false')
                  span.setAttribute('aria-hidden', 'true')
                  return span
                },
                { side: -1, key: `ln-${pos}-${num}` },
              )
              decorations.push(widget)
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
