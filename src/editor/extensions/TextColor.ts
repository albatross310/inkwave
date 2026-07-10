// TextColor — registers a `color` attribute on the textStyle mark so text colour can be applied
// per selection (same pattern as FontSize; Tiptap's official @tiptap/extension-color is a trivial
// wrapper over exactly this). Apply via editor.chain().setMark('textStyle', { color: '#991b1b' })
// and read via editor.getAttributes('textStyle').color; null removes the inline colour.

import { Extension } from '@tiptap/react'

export const TextColor = Extension.create({
  name: 'textColor',

  addOptions() {
    return { types: ['textStyle'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.color || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.color ? { style: `color: ${attrs.color}` } : {},
          },
        },
      },
    ]
  },
})
