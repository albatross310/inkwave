import { Mark, mergeAttributes } from '@tiptap/react'

// ScasSlotMark — a persistent "SCAS slot" / memory marker on a once-kicked word.
//
// When the writer resolves a flagged word, the word carries this mark so the position stays
// SCAS-managed for the rest of its life: it persists as a (re-cyclable) purple slot, re-offers the
// SAME synonym list (the original's, with the original as slot 0), and remembers where it came from.
//
// The mark travels with its text through edits (stored on the text node + serialised into the
// document JSON, so it rides along in snapshots and the export bundle) and survives reflow/reload.
// inclusive:false so typing immediately after the word doesn't extend the slot.
//
// Memory fields (see scas-memory-slots-design.md). All optional with safe defaults, so documents
// written before this extension still parse cleanly:
//   original       — the kicked word (pre-resolution); drives the synonym group.
//   firstWord      — what it was first committed as (== original if justified/dismissed).
//   originSnapshot — id of the snapshot the first commit landed in.
//   kickedAt / firstCommitAt / lastCommitAt — ISO times (→ time-to-first/final-commit on /verify).
//   history        — committed word values, capped at 3 (a 4th+ change bumps `changes`, not history).
//   changes        — total number of commits (so a change past the cap is still known).
//   locked         — locked in (normal colour, un-cyclable); the glyph "fired" state.
const str = (data: string, key: string) => ({
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute(data),
  renderHTML: (attrs: Record<string, unknown>) => (attrs[key] != null ? { [data]: String(attrs[key]) } : {}),
})

export const ScasSlotMark = Mark.create({
  name: 'scasSlot',
  inclusive: false,

  addAttributes() {
    return {
      original: str('data-scas-original', 'original'),
      firstWord: str('data-scas-first', 'firstWord'),
      originSnapshot: str('data-scas-snap', 'originSnapshot'),
      kickedAt: str('data-scas-kicked-at', 'kickedAt'),
      firstCommitAt: str('data-scas-first-at', 'firstCommitAt'),
      lastCommitAt: str('data-scas-last-at', 'lastCommitAt'),
      changes: {
        default: 0,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-scas-changes')) || 0,
        renderHTML: (attrs: Record<string, unknown>) => (attrs.changes ? { 'data-scas-changes': String(attrs.changes) } : {}),
      },
      locked: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-scas-locked') === '1',
        renderHTML: (attrs: Record<string, unknown>) => (attrs.locked ? { 'data-scas-locked': '1' } : {}),
      },
      history: {
        default: null as string[] | null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-scas-history')
          if (!v) return null
          try { const a = JSON.parse(v); return Array.isArray(a) ? a : null } catch { return null }
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          Array.isArray(attrs.history) && attrs.history.length ? { 'data-scas-history': JSON.stringify(attrs.history) } : {},
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
