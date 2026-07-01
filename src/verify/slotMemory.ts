// Extract per-word "memory slot" data from a Tiptap document JSON (P4 of scas-memory-slots-design).
// This data lives on scasSlot marks in contentJson, is hash-bound via contentHash, and requires no
// new signed data — timing + history are read directly from the mark attrs.

import type { TiptapJSON } from '../types/document'

export interface SlotRecord {
  original: string          // the kicked word (synonym group root)
  finalWord: string         // the live text at the mark position
  firstWord: string | null  // what it was first committed as
  kickedAt: string | null
  firstCommitAt: string | null
  lastCommitAt: string | null
  history: string[]         // last ≤3 committed values
  changes: number           // total commit count
  locked: boolean
}

export interface SlotMemory {
  slots: SlotRecord[]
  // Derived summary stats
  total: number
  changed: number           // replacement !== original at first commit
  acceptedOriginal: number  // firstWord === original (justified/dismissed)
  locked: number
  avgFirstCommitMs: number | null   // avg (firstCommitAt - kickedAt) across slots with both times
  avgChanges: number | null
}

// Walk a Tiptap JSON tree and collect all scasSlot marks.
export function extractSlotMemory(contentJson: TiptapJSON): SlotMemory {
  const slots: SlotRecord[] = []
  const seen = new Set<string>() // dedupe by original (last one wins if the word appears twice)

  function walk(node: TiptapJSON) {
    if (node.type === 'text' && Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type !== 'scasSlot') continue
        const a = mark.attrs ?? {}
        const original = String(a.original ?? '')
        const finalWord = String(node.text ?? '')
        if (!original || !finalWord) continue
        const rec: SlotRecord = {
          original,
          finalWord,
          firstWord: a.firstWord != null ? String(a.firstWord) : null,
          kickedAt: a.kickedAt != null ? String(a.kickedAt) : null,
          firstCommitAt: a.firstCommitAt != null ? String(a.firstCommitAt) : null,
          lastCommitAt: a.lastCommitAt != null ? String(a.lastCommitAt) : null,
          history: Array.isArray(a.history) ? a.history.map(String) : [],
          changes: typeof a.changes === 'number' ? a.changes : 0,
          locked: a.locked === true || a.locked === 1,
        }
        // Dedupe by original: later occurrence (further in doc) overwrites earlier.
        seen.add(original)
        const idx = slots.findIndex(s => s.original === original)
        if (idx >= 0) slots[idx] = rec; else slots.push(rec)
      }
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child)
  }

  walk(contentJson)

  // Summary stats
  const changed = slots.filter(s => s.firstWord !== null && s.firstWord !== s.original).length
  const acceptedOriginal = slots.filter(s => s.firstWord === null || s.firstWord === s.original).length
  const locked = slots.filter(s => s.locked).length

  const deliberations: number[] = []
  for (const s of slots) {
    if (s.kickedAt && s.firstCommitAt) {
      const d = new Date(s.firstCommitAt).getTime() - new Date(s.kickedAt).getTime()
      if (d >= 0) deliberations.push(d)
    }
  }
  const avgFirstCommitMs = deliberations.length
    ? Math.round(deliberations.reduce((a, b) => a + b, 0) / deliberations.length)
    : null

  const avgChanges = slots.length
    ? +(slots.reduce((a, s) => a + s.changes, 0) / slots.length).toFixed(1)
    : null

  return { slots, total: slots.length, changed, acceptedOriginal, locked, avgFirstCommitMs, avgChanges }
}
