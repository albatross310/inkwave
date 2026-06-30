// Tiptap suggestion extension that fires a custom DOM event when the user types "@<query>".
// The CiteAutocomplete component listens for this event and renders the popup.
// Using a custom event (rather than the suggestion renderItem/destroyItem callbacks)
// lets the popup live in React-land while the trigger logic stays in ProseMirror-land.

import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

export const CiteSuggestion = Extension.create({
  name: 'citeSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => {
          // props is the item passed from onSelect; handled via DOM event instead
          editor.chain().focus().deleteRange(range).run()
          if (props && typeof props === 'object' && 'citekeys' in props) {
            const cks = (props as { citekeys: string[] }).citekeys
            editor.chain().insertCitation({ citekeys: cks }).run()
          }
        },
        items: ({ query }) => {
          // We emit a DOM event instead of returning items here;
          // returning a dummy array so Suggestion doesn't bail out.
          return [{ query }]
        },
        render: () => {
          let viewDom: HTMLElement | null = null
          const emit = (detail: { query: string; rect: DOMRect; active: boolean }) => {
            viewDom?.dispatchEvent(new CustomEvent('citeautocomplete', { detail, bubbles: true }))
          }
          return {
            onStart: ({ editor: e, query, clientRect }) => {
              viewDom = e.view.dom as HTMLElement
              const rect = clientRect?.() ?? new DOMRect()
              emit({ query, rect, active: true })
            },
            onUpdate: ({ query, clientRect }) => {
              const rect = clientRect?.() ?? new DOMRect()
              emit({ query, rect, active: true })
            },
            onExit: () => {
              emit({ query: '', rect: new DOMRect(), active: false })
            },
            onKeyDown: () => false, // keyboard navigation handled by CiteAutocomplete
          }
        },
      }),
    ]
  },
})
