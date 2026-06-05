// FontSize — registers a `fontSize` attribute on the textStyle mark so font size can be
// applied per selection. Tiptap 2.x ships no official font-size extension; apply via
// editor.chain().setMark('textStyle', { fontSize: '18px' }) and read via
// editor.getAttributes('textStyle').fontSize.

import { Extension } from '@tiptap/react'

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ]
  },
})
