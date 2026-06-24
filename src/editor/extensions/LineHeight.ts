import { Extension } from '@tiptap/react'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType
    }
  }
}

// Adds a lineHeight attribute to paragraph nodes so line spacing can be applied to
// selected paragraphs independently, stored in the document content itself.
export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: el => el.style.lineHeight || null,
            renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { lineHeight }),
    }
  },
})
