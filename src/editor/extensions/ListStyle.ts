import { Extension } from '@tiptap/core'

// Adds a `listType` attribute to orderedList nodes so we can render
// lower-roman (i, ii, iii) and lower-alpha (a, b, c) ordered lists.
export const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['orderedList'],
        attributes: {
          listType: {
            default: 'decimal',
            parseHTML: (el) => el.getAttribute('data-list-type') ?? 'decimal',
            renderHTML: (attrs) => {
              const t = attrs.listType as string
              if (!t || t === 'decimal') return {}
              return { 'data-list-type': t, style: `list-style-type: ${t}` }
            },
          },
        },
      },
    ]
  },
})
