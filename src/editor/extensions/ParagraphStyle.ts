// ParagraphStyle — per-paragraph inline styling attributes.
// Supersedes LineHeight.ts. All attributes stored as CSS value strings (with units):
//   lineHeight: "1.618" (unitless)
//   marginBottom / marginTop: "0.5em" or "24px"
//   paddingLeft / paddingRight: "24px"

import { Extension } from '@tiptap/react'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      setLineHeight: (v: string) => ReturnType
      setParaStyle: (attrs: Partial<ParagraphStyleAttrs>) => ReturnType
    }
  }
}

export interface ParagraphStyleAttrs {
  lineHeight: string | null
  marginBottom: string | null
  marginTop: string | null
  paddingLeft: string | null
  paddingRight: string | null
}

function attr(cssProp: string) {
  const cssName = cssProp.replace(/([A-Z])/g, c => `-${c.toLowerCase()}`)
  return {
    default: null,
    parseHTML: (el: HTMLElement) => (el.style as unknown as Record<string, string>)[cssProp] || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs[cssProp] ? { style: `${cssName}: ${attrs[cssProp]}` } : {},
  }
}

export const ParagraphStyle = Extension.create({
  name: 'paragraphStyle',

  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        lineHeight:   attr('lineHeight'),
        marginBottom: attr('marginBottom'),
        marginTop:    attr('marginTop'),
        paddingLeft:  attr('paddingLeft'),
        paddingRight: attr('paddingRight'),
      },
    }]
  },

  addCommands() {
    return {
      setLineHeight:
        (v: string) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { lineHeight: v }),

      setParaStyle:
        (attrs: Partial<ParagraphStyleAttrs>) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', attrs),
    }
  },
})
