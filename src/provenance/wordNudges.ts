// WordNudgeEvent emitter (v4 spec §7). A word nudge is a constraint encounter; on resolve
// (swap / justify / delete→credit / discharge) the controller emits a synchronous WordNudgeEvent.
// Subscribers: the snapshot trigger (M1) and the cadence tap (M6). Kept tiny and framework-free.

import type { WordNudgeEvent } from '../types/document'

export type WordNudgeListener = (event: WordNudgeEvent) => void

export class WordNudgeEmitter {
  private listeners = new Set<WordNudgeListener>()

  /** Subscribe; returns an unsubscribe function. */
  on(listener: WordNudgeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(event: WordNudgeEvent): void {
    for (const fn of this.listeners) fn(event)
  }
}

// Backward-compat aliases (used by tests and legacy import paths)
export { WordNudgeEmitter as KickEmitter }
export type { WordNudgeListener as KickListener }
