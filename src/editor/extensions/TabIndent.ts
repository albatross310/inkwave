// TabIndent — intercept Tab/Shift-Tab so they indent/dedent list items rather than
// moving focus. In regular (non-list) paragraphs Tab inserts a short non-breaking space
// sequence so it behaves like a mild indent character (without reflowing anything).
import { Extension } from '@tiptap/core'

export const TabIndent = Extension.create({
  name: 'tabIndent',

  addKeyboardShortcuts() {
    return {
      // Sink list item (Tab) or lift list item (Shift-Tab); fall through to default otherwise.
      Tab: () => {
        if (this.editor.commands.sinkListItem('listItem')) return true
        // Outside a list: insert a thin indent space rather than moving browser focus
        return this.editor.commands.insertContent(' ')  // em space as tab stand-in
      },
      'Shift-Tab': () => {
        return this.editor.commands.liftListItem('listItem')
      },
    }
  },
})
