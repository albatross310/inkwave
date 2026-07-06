// Live suggestion mode (track changes). Two marks — insertion (proposed new text, shown underlined)
// and deletion (proposed removal, kept but struck-through) — and a plugin that, ONLY while suggest
// mode is on (see reviewState.suggestOn), routes edits into those marks instead of applying them:
//   • typing → the text is inserted carrying an `insertion` mark (handleTextInput).
//   • Backspace/Delete → the target text is marked `deletion` and kept (not removed); deleting your
//     OWN pending insertion just removes it (rejecting your own suggestion).
// Everything is gated behind suggestOn(), so with the toggle OFF the editor behaves exactly as before.
// Accept/reject commands materialise or drop the suggestions. pmToText ignores marks, so the
// provenance TEXT of a doc with pending suggestions is the text INCLUDING deletions (struck words) and
// insertions — i.e. the working copy; accept/reject then settle it.

import { Mark, mergeAttributes, Extension } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { suggestOn, activeSet } from '../review/reviewState'

const mk = () => ({ set: { default: 'Notes' as string } })

export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: true,
  addAttributes: mk,
  parseHTML() { return [{ tag: 'ins[data-iw-ins]' }] },
  renderHTML({ HTMLAttributes }) { return ['ins', mergeAttributes(HTMLAttributes, { 'data-iw-ins': '', class: 'iw-ins' }), 0] },
})

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,
  addAttributes: mk,
  parseHTML() { return [{ tag: 'del[data-iw-del]' }] },
  renderHTML({ HTMLAttributes }) { return ['del', mergeAttributes(HTMLAttributes, { 'data-iw-del': '', class: 'iw-del' }), 0] },
})

const KEY = new PluginKey('trackChanges')

// True if the whole range [from,to) is text carrying `markName` (used to detect "this selection is
// entirely my own pending insertion", so deleting it just removes it rather than marking a deletion).
function rangeAllHasMark(view: EditorView, from: number, to: number, markName: string): boolean {
  let all = true, sawText = false
  view.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    sawText = true
    if (!node.marks.some((m) => m.type.name === markName)) all = false
  })
  return sawText && all
}

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        props: {
          // Typed text → inserted with the insertion mark. Only for a collapsed cursor; typing over a
          // selection falls through so ProseMirror's own replace runs (the selected text gets handled
          // as a deletion by the keydown path when the user deletes it first).
          handleTextInput(view, from, to, text) {
            if (!suggestOn() || from !== to) return false
            const insType = view.state.schema.marks.insertion
            if (!insType) return false
            const tr = view.state.tr.insertText(text, from, from)
            tr.addMark(from, from + text.length, insType.create({ set: activeSet() }))
            tr.setSelection(TextSelection.create(tr.doc, from + text.length))
            view.dispatch(tr.scrollIntoView())
            return true
          },
          handleKeyDown(view, event) {
            if (!suggestOn()) return false
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false
            const { state } = view
            const delType = state.schema.marks.deletion
            if (!delType) return false
            const sel = state.selection

            // Selection: mark it all as deletion (or, if it's entirely your own pending insertion, drop it).
            if (!sel.empty) {
              const { from, to } = sel
              if (rangeAllHasMark(view, from, to, 'insertion')) {
                view.dispatch(state.tr.delete(from, to).scrollIntoView()) // reject own insertion
              } else {
                view.dispatch(state.tr.addMark(from, to, delType.create({ set: activeSet() }))
                  .setSelection(TextSelection.create(state.tr.doc, event.key === 'Backspace' ? from : to)).scrollIntoView())
              }
              event.preventDefault()
              return true
            }

            // Collapsed cursor: target the single character to the left (Backspace) or right (Delete).
            const pos = sel.from
            const target = event.key === 'Backspace' ? { from: pos - 1, to: pos } : { from: pos, to: pos + 1 }
            if (target.from < 0 || target.to > state.doc.content.size) return false
            // Only handle when the target is inline text on the same block (leave block-joining to PM).
            const node = state.doc.nodeAt(target.from)
            if (!node || !node.isText) return false
            if (node.marks.some((m) => m.type.name === 'insertion')) {
              view.dispatch(state.tr.delete(target.from, target.to).scrollIntoView()) // reject own insertion char
            } else if (node.marks.some((m) => m.type.name === 'deletion')) {
              // already marked deleted → step the cursor past it without changing anything
              view.dispatch(state.tr.setSelection(TextSelection.create(state.tr.doc, target.from)).scrollIntoView())
            } else {
              view.dispatch(state.tr.addMark(target.from, target.to, delType.create({ set: activeSet() }))
                .setSelection(TextSelection.create(state.tr.doc, target.from)).scrollIntoView())
            }
            event.preventDefault()
            return true
          },
        },
      }),
    ]
  },
})

// ── Accept / reject (whole document or a range) ──────────────────────────────────────────────────
// accept: insertions become normal text (drop the mark); deletion-marked text is removed.
// reject: insertion-marked text is removed; deletions become normal text (drop the mark).
import type { Editor } from '@tiptap/react'

export function resolveSuggestions(editor: Editor, mode: 'accept' | 'reject', range?: { from: number; to: number }) {
  const insType = editor.schema.marks.insertion
  const delType = editor.schema.marks.deletion
  if (!insType || !delType) return
  const from = range?.from ?? 0
  const to = range?.to ?? editor.state.doc.content.size
  // Collect target ranges first (positions shift as we edit, so gather then apply back-to-front).
  const removals: Array<{ from: number; to: number }> = []
  const unmarks: Array<{ from: number; to: number; type: typeof insType }> = []
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return
    const a = pos, b = pos + node.nodeSize
    const isIns = node.marks.some((m) => m.type.name === 'insertion')
    const isDel = node.marks.some((m) => m.type.name === 'deletion')
    if (mode === 'accept') {
      if (isDel) removals.push({ from: a, to: b })
      else if (isIns) unmarks.push({ from: a, to: b, type: insType })
    } else {
      if (isIns) removals.push({ from: a, to: b })
      else if (isDel) unmarks.push({ from: a, to: b, type: delType })
    }
  })
  const tr = editor.state.tr
  // Unmark first (doesn't shift positions), then remove back-to-front.
  for (const u of unmarks) tr.removeMark(u.from, u.to, u.type)
  for (const r of removals.sort((x, y) => y.from - x.from)) tr.delete(r.from, r.to)
  editor.view.dispatch(tr)
}
