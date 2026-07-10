// Live suggestion mode (track changes). Two marks — insertion (proposed new text, shown underlined)
// and deletion (proposed removal, kept but struck-through) — and a plugin that, ONLY while suggest
// mode is on (see reviewState.suggestOn), routes edits into those marks instead of applying them:
//   • typing → the text is inserted carrying an `insertion` mark (handleTextInput); typing over a
//     selection suggestion-deletes the selection first, then inserts.
//   • Backspace/Delete/cut → the target text is marked `deletion` and kept (not removed); deleting
//     your OWN pending insertion just removes it (rejecting your own suggestion).
// Everything is gated behind suggestOn(), so with the toggle OFF the editor behaves exactly as before.
// Accept/reject commands materialise or drop the suggestions. pmToText ignores marks, so the
// provenance TEXT of a doc with pending suggestions is the text INCLUDING deletions (struck words) and
// insertions — i.e. the working copy; accept/reject then settle it.

import { Mark, mergeAttributes, Extension } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Schema } from '@tiptap/pm/model'
import { suggestOn, activeSet } from '../review/reviewState'

// The layer name rides on the mark as data-set (valid HTML + a stable hook for the per-layer
// show/hide CSS in reviewState.syncReviewVisibilityStyles).
const mk = () => ({
  set: {
    default: 'Notes' as string,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-set') || 'Notes',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-set': String(attrs.set ?? 'Notes') }),
  },
})

// Each reviewer (= annotation set) gets its own colour. The first/default set is a warm red (slightly
// orange); further sets take the next palette entry by name, so a new reviewer reads in a new colour.
const REVIEWER_PALETTE = ['#e03a26', '#1d6fb8', '#0f8a5f', '#c2410c', '#7c3aed', '#b8117a', '#0891b2', '#a16207']
export function reviewerColor(set: string): string {
  if (!set || set === 'Notes') return REVIEWER_PALETTE[0] // warm red — the default reviewer
  let h = 0
  for (let i = 0; i < set.length; i++) h = (h * 31 + set.charCodeAt(i)) >>> 0
  return REVIEWER_PALETTE[h % REVIEWER_PALETTE.length]
}
// A slightly darker shade of a hex colour (for the bottom of the vertical text gradient).
function shade(hex: string, f: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16)
  const s = (x: number) => Math.max(0, Math.min(255, Math.round(x * f))).toString(16).padStart(2, '0')
  return `#${s(r)}${s(g)}${s(b)}`
}
// A gentle top-to-bottom gradient clipped to the glyphs. CSS `background-clip: text` is GPU-composited,
// so it's cheap even across many marks.
function gradientStyle(c: string, extra: string): string {
  return `background:linear-gradient(180deg,${c},${shade(c, 0.68)});-webkit-background-clip:text;background-clip:text;color:${c};-webkit-text-fill-color:transparent;${extra}`
}

export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: true,
  addAttributes: mk,
  parseHTML() { return [{ tag: 'ins[data-iw-ins]' }] },
  renderHTML({ HTMLAttributes }) {
    const c = reviewerColor((HTMLAttributes as { 'data-set'?: string })['data-set'] || 'Notes')
    return ['ins', mergeAttributes(HTMLAttributes, { 'data-iw-ins': '', class: 'iw-ins', style: gradientStyle(c, 'text-decoration:none;') }), 0]
  },
})

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,
  addAttributes: mk,
  parseHTML() { return [{ tag: 'del[data-iw-del]' }] },
  renderHTML({ HTMLAttributes }) {
    const c = reviewerColor((HTMLAttributes as { 'data-set'?: string })['data-set'] || 'Notes')
    return ['del', mergeAttributes(HTMLAttributes, { 'data-iw-del': '', class: 'iw-del', style: gradientStyle(c, `text-decoration-line:line-through;text-decoration-color:${c};`) }), 0]
  },
})

const KEY = new PluginKey('trackChanges')

// Suggestion-mode "delete" of a range, segment-wise: your own pending insertions are simply removed
// (rejecting your own suggestion); everything else is KEPT and marked `deletion` (the strikethrough
// in the layer's colour) — text never hard-deletes while suggesting. Marks first (addMark doesn't
// shift positions), then removals back-to-front. Callers map their caret through tr.mapping after.
function applySuggestedDeletion(tr: Transaction, schema: Schema, from: number, to: number): void {
  const delType = schema.marks.deletion
  if (!delType) return
  const removals: Array<{ from: number; to: number }> = []
  const marksAdd: Array<{ from: number; to: number }> = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return
    const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize)
    if (a >= b) return
    if (node.marks.some((m) => m.type.name === 'insertion')) removals.push({ from: a, to: b })
    else if (!node.marks.some((m) => m.type.name === 'deletion')) marksAdd.push({ from: a, to: b })
  })
  for (const m of marksAdd) tr.addMark(m.from, m.to, delType.create({ set: activeSet() }))
  for (const r of removals.sort((x, y) => y.from - x.from)) tr.delete(r.from, r.to)
}

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        props: {
          // Typed text → inserted with the insertion mark. Typing OVER a selection must not hard-
          // delete it: the selection is suggestion-deleted (kept + struck) and the typed text lands
          // after it as an insertion — the standard Word replace-while-tracking shape.
          handleTextInput(view, from, to, text) {
            if (!suggestOn()) return false
            const insType = view.state.schema.marks.insertion
            if (!insType) return false
            const tr = view.state.tr
            let at = from
            if (from !== to) {
              applySuggestedDeletion(tr, view.state.schema, from, to)
              at = tr.mapping.map(to, -1)
            }
            tr.insertText(text, at, at)
            tr.addMark(at, at + text.length, insType.create({ set: activeSet() }))
            tr.setSelection(TextSelection.create(tr.doc, at + text.length))
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

            // Selection: segment-wise suggestion-delete (own insertions drop; the rest is struck).
            if (!sel.empty) {
              const { from, to } = sel
              const tr = state.tr
              applySuggestedDeletion(tr, state.schema, from, to)
              const caret = tr.mapping.map(event.key === 'Backspace' ? from : to, -1)
              tr.setSelection(TextSelection.create(tr.doc, caret))
              view.dispatch(tr.scrollIntoView())
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
          // Cut must not hard-delete either: keep the copy half, then suggestion-delete the range.
          handleDOMEvents: {
            cut(view, event) {
              if (!suggestOn()) return false
              const { state } = view
              const sel = state.selection
              if (sel.empty || !state.schema.marks.deletion) return false
              event.clipboardData?.setData('text/plain', state.doc.textBetween(sel.from, sel.to, '\n'))
              event.preventDefault()
              const tr = state.tr
              applySuggestedDeletion(tr, state.schema, sel.from, sel.to)
              tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(sel.from, -1)))
              view.dispatch(tr.scrollIntoView())
              return true
            },
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
