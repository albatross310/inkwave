import { Mark, mergeAttributes } from '@tiptap/react'

// ScasSlotMark — a persistent "SCAS slot" marker.
//
// Once the writer cycles a flagged word, the chosen replacement carries this mark
// so the text position stays SCAS-managed for the rest of its life:
//   • it keeps rendering red (changeable) regardless of vocabulary membership —
//     so picking an in-vocab synonym doesn't "escape" the slot, and
//   • `original` retains the word the slot started from, so reopening the cycle
//     re-offers the SAME synonym list (the original's), with the original as slot 0.
//
// The mark travels with its text through edits (it's stored on the text node and
// serialised into the document JSON), so the slot survives reflow and reload.
// inclusive:false so typing immediately after the word doesn't extend the slot.
export const ScasSlotMark = Mark.create({
  name: 'scasSlot',
  inclusive: false,

  addAttributes() {
    return {
      original: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-scas-original'),
        renderHTML: attrs => (attrs.original ? { 'data-scas-original': attrs.original } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-scas-slot]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-scas-slot': '' }), 0]
  },
})
