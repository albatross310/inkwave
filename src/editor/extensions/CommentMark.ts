import { Mark, mergeAttributes } from '@tiptap/react'

// CommentMark — a review comment anchored to a text range. The comment BODY lives in the mark attrs,
// so comments travel with the document (snapshots + export) with no separate store — like ScasSlotMark.
// Each comment belongs to a named annotation `set` (e.g. "supervisor pass 1") so a whole set can be
// shown/hidden/deleted together. inclusive:false so typing at the edge of a commented span doesn't
// extend the comment. pmToText ignores marks, so adding comments never changes the provenance TEXT.

const str = (data: string, key: string, dflt = '') => ({
  default: dflt,
  parseHTML: (el: HTMLElement) => el.getAttribute(data) ?? dflt,
  renderHTML: (attrs: Record<string, unknown>) => (attrs[key] != null ? { [data]: String(attrs[key]) } : {}),
})

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (attrs: { id: string; body: string; set: string; createdAt: string }) => ReturnType
      unsetComment: () => ReturnType
    }
  }
}

export interface CommentAttrs { id: string; body: string; set: string; createdAt: string }

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,

  addAttributes() {
    return {
      id:        str('data-comment-id', 'id'),
      body:      str('data-comment-body', 'body'),
      set:       str('data-comment-set', 'set', 'default'),
      createdAt: str('data-comment-at', 'createdAt'),
    }
  },

  parseHTML() { return [{ tag: 'span[data-comment-id]' }] },

  renderHTML({ HTMLAttributes }) {
    // The visible span is a faint underline (see .iw-comment in index.css); the sticky note is drawn
    // separately in the gutter by CommentNotes, positioned from this span's data-comment-id.
    return ['span', mergeAttributes(HTMLAttributes, { class: 'iw-comment' }), 0]
  },

  addCommands() {
    return {
      setComment: (attrs) => ({ commands }) => commands.setMark('comment', attrs),
      unsetComment: () => ({ commands }) => commands.unsetMark('comment'),
    }
  },
})
