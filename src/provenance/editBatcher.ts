// Small-edit batching for automatic provenance snapshots (Peter, 2026-09-17, rule 3).
//
// Completing a paragraph (or, in sentence mode, a sentence) takes a snapshot on its own. Edits to
// EXISTING text do not: they accumulate here, and one snapshot is taken when the pending set grows
// past a character budget, spreads across too many paragraphs, or a completion event flushes it.
// Pure bookkeeping — no document, no storage — so it is unit-pinned and cheap on the keystroke.

/** Total inserted+deleted characters that, once reached, force a snapshot of pending edits. */
export const SMALL_EDIT_CHAR_BUDGET = 200
/** Distinct paragraphs a pending edit set may touch; exceeding it forces a snapshot. */
export const PARA_RANGE_LIMIT = 5

export type FlushReason = 'chars' | 'range' | 'completion'

export interface PendingEdits {
  chars: number
  paragraphs: Set<number>
}

export class EditBatcher {
  private chars = 0
  private paragraphs = new Set<number>()

  constructor(
    private readonly charBudget = SMALL_EDIT_CHAR_BUDGET,
    private readonly paraLimit = PARA_RANGE_LIMIT,
  ) {}

  /** Record one transaction's insert/delete counts and the top-level paragraphs it touched. */
  record(ins: number, del: number, paragraphIndices: Iterable<number>): void {
    this.chars += Math.max(0, ins) + Math.max(0, del)
    for (const p of paragraphIndices) this.paragraphs.add(p)
  }

  get pending(): PendingEdits {
    return { chars: this.chars, paragraphs: new Set(this.paragraphs) }
  }

  get isEmpty(): boolean {
    return this.chars === 0 && this.paragraphs.size === 0
  }

  /** Why the pending set should be snapshotted now, or null if it may keep accumulating. */
  flushReason(): Exclude<FlushReason, 'completion'> | null {
    if (this.chars >= this.charBudget) return 'chars'
    if (this.paragraphs.size > this.paraLimit) return 'range'
    return null
  }

  /** Empty the pending set (call once the snapshot that covers it has been queued). */
  reset(): void {
    this.chars = 0
    this.paragraphs.clear()
  }
}
