// THE UNSYNCED-WORK NOTICE — Peter's explicit ask (2026-07-17), alongside the tab-identity fix:
//   "We need: 1 a warning that comes up if working for more than 5 minutes without syncing
//    activated"
//
// The rule lives here, PURE, for two reasons:
//  1. It is the whole feature. Everything else is a div. A pure rule can be pinned by cheap unit
//     tests that run in 14ms with no browser — CLAUDE.md's "when a probe establishes an invariant,
//     ask what cheap UNIT-level assertion keeps it true". `diffCache.test.ts` is the worked example
//     this follows, mutation-testing included (see unsyncedWatch.test.ts).
//  2. "Must not fire when sync IS active" and "must not become a nag" are exactly the kind of
//     conditions that rot into a check that cannot fail. Written as data-in/boolean-out, both are
//     stated once and asserted directly.
//
// IT IS READ, NOT AWAITED. Every input is state the editor already holds (a linked folder name, a
// OneDrive account, the Drive flag) — never a one-shot event we might have missed. That is the
// lesson from the two races on Peter's iPhone: an async signal with no "has it already happened?"
// check. `shouldWarnUnsynced` can be evaluated at any moment, from cold, and give the right answer.
//
// AFFECT: this app is calm and its productivity layer has a non-shaming rule. The notice this
// drives says the writer's work is safe on this device and offers to back it up. It is not a
// scolding modal, it does not block, and once waved away it stays away for the session.

export const UNSYNCED_WARN_MS = 5 * 60_000 // "more than 5 minutes" — Peter

export interface UnsyncedInputs {
  /** Is any sync destination live for THIS document (local folder / OneDrive / Google Drive)? */
  syncActive: boolean
  /** When the writer first edited with no sync active. null ⇒ nothing unsynced has been written. */
  firstUnsyncedEditAt: number | null
  /** The writer has waved the notice away this session. */
  dismissed: boolean
  now: number
  warnAfterMs?: number
}

/**
 * Should the unsynced-work notice be showing right now?
 *
 * Order matters and each clause is a requirement, not an optimisation:
 *  - syncActive     ⇒ never. Sync being on is the whole point; a warning here would be a lie.
 *  - dismissed      ⇒ never again this session. This is the anti-nag clause.
 *  - no first edit  ⇒ never. Opening the app and walking away is not unsynced WORK; the clock
 *                     starts at the first edit, not at load, or we would warn about an empty page.
 */
export function shouldWarnUnsynced(o: UnsyncedInputs): boolean {
  if (o.syncActive) return false
  if (o.dismissed) return false
  if (o.firstUnsyncedEditAt === null) return false
  return o.now - o.firstUnsyncedEditAt >= (o.warnAfterMs ?? UNSYNCED_WARN_MS)
}

export interface UnsyncedState {
  firstUnsyncedEditAt: number | null
  dismissed: boolean
}

export const initialUnsyncedState: UnsyncedState = { firstUnsyncedEditAt: null, dismissed: false }

export type UnsyncedEvent =
  | { type: 'edit'; now: number; syncActive: boolean }
  | { type: 'sync-active' } // a destination went live (or the doc was saved/synced somewhere)
  | { type: 'dismiss' }
  | { type: 'doc-switch' } // a different document — a fresh judgement, fresh clock

/** The clock, as a reducer: also pure, also directly assertable. */
export function unsyncedReducer(s: UnsyncedState, e: UnsyncedEvent): UnsyncedState {
  switch (e.type) {
    case 'edit':
      // The clock starts at the FIRST unsynced edit and does not restart on later ones — otherwise
      // a writer typing steadily for an hour would reset it forever and never be warned, which is
      // precisely the person the warning is for.
      if (e.syncActive || s.firstUnsyncedEditAt !== null) return s
      return { ...s, firstUnsyncedEditAt: e.now }
    case 'sync-active':
      // Their work is safe now. Clear the clock AND the dismissal: if sync later lapses, this is a
      // genuinely new situation and the writer deserves to hear about it once more.
      if (s.firstUnsyncedEditAt === null && !s.dismissed) return s
      return initialUnsyncedState
    case 'dismiss':
      return { ...s, dismissed: true }
    case 'doc-switch':
      return initialUnsyncedState
  }
}
