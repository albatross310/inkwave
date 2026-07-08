// Dependency-LIGHT document defaults for SCAS — split from state.ts so the shell chunk
// (Edit.tsx needs withScasDefaults at doc load) doesn't drag engine → pool → the 30k-word
// frequency list (~292KB of preloaded JS) onto the load critical path. Everything here touches
// only types + the frozen pool id.

import type { InkwaveDocument, ScasState } from '../types/document'
import { POOL_ID_STATIC } from './poolId'

/** Default |S| in N-mode (v4 spec §4.2: start ~300 of ~4,500). */
export const DEFAULT_SET_SIZE = 300

export function emptyScasState(): ScasState {
  return { version: 0, locked: [], satisfied: [], liveKicks: [], kickTimes: {} }
}

/** Coerce possibly-missing/partial persisted state into a valid ScasState. */
export function normalizeScasState(s: Partial<ScasState> | undefined | null): ScasState {
  if (!s) return emptyScasState()
  return {
    version: Number.isFinite(s.version) ? (s.version as number) : 0,
    locked: Array.isArray(s.locked) ? [...new Set(s.locked)] : [],
    satisfied: Array.isArray(s.satisfied)
      ? s.satisfied.filter((e) => e && typeof e.lemma === 'string')
      : [],
    liveKicks: Array.isArray(s.liveKicks) ? [...new Set(s.liveKicks)] : [],
    kickTimes: s.kickTimes && typeof s.kickTimes === 'object' ? { ...s.kickTimes } : {},
  }
}

/**
 * Ensure a document carries the M0 SCAS fields, filling defaults without clobbering existing
 * values. Called when opening/creating a document (Edit.tsx migrateDocument) so pre-M0 docs and
 * fresh docs both end up with a valid engine state. `seedRef` defaults to the existing
 * per-document session seed (the local stand-in for the server-held seed until M3).
 */
export function withScasDefaults(doc: InkwaveDocument): InkwaveDocument {
  return {
    ...doc,
    scasMode: doc.scasMode ?? 'n',
    scasSetSize: doc.scasSetSize ?? DEFAULT_SET_SIZE,
    scasSeedRef: doc.scasSeedRef ?? doc.scasSessionSeed,
    scasPoolId: doc.scasPoolId ?? POOL_ID_STATIC,
    scasState: normalizeScasState(doc.scasState),
  }
}

