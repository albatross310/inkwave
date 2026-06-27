import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// Handles pasting copied math boxes back into the document.
// MathInlineView / MathBlockView write a special data-inkwave-math HTML marker
// to the clipboard alongside the plain-text LaTeX. This plugin intercepts that
// paste and recreates the correct math node instead of inserting raw LaTeX text.
export const MathPasteHandler = Extension.create({
  name: 'mathPasteHandler',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mathPasteHandler'),
        props: {
          handlePaste(view, event) {
            // MathLive owns paste when a math-field is focused
            if (document.activeElement?.tagName === 'MATH-FIELD') return false

            const html = event.clipboardData?.getData('text/html') ?? ''
            if (!html.includes('data-inkwave-math')) return false

            const parsed = new DOMParser().parseFromString(html, 'text/html')
            const el = parsed.querySelector('[data-inkwave-math]')
            if (!el) return false

            const mathType = el.getAttribute('data-inkwave-math') as 'inline' | 'block' | null
            const encoded  = el.getAttribute('data-latex')
            if (!mathType || !encoded) return false

            const latex    = decodeURIComponent(encoded)
            const { state, dispatch } = view
            const nodeType = mathType === 'inline'
              ? state.schema.nodes.mathInline
              : state.schema.nodes.mathBlock
            const attrs = mathType === 'inline' ? { latex } : { latex, align: 'aligned' }

            dispatch(state.tr.replaceSelectionWith(nodeType.create(attrs)))
            return true
          },
        },
      }),
    ]
  },
})
