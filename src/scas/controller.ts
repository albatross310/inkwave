// The SCAS controller — the seam between the live editor and the pure engine.
//
// It holds the per-session SCAS state (mirrored to doc.scasState for persistence), derives the
// current S_v, and on each document change scans the committed words to drive the state machine:
//   • a committed in-S lemma  → recordKick (turns purple, frozen)
//   • a completed substitution → resolve the ORIGINAL lemma (satisfied, or discharged if it was
//     locked) — inferred from the ScasSlotMark the popover writes, so no coupling to the popover
//   • a deleted nudged lemma   → lock (ban-credit) — inferred from a nudged lemma disappearing
// The editor wires onTransaction → processDoc, persists the new state, and forces a decoration
// rebuild; the RedHighlightExtension renders purely from the lookup this controller exposes.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { ScasState } from '../types/document'
import {
  deriveSet,
  lemmaOf,
  recordKick,
  markSatisfied,
  lock,
  discharge,
  resample,
  isLocked,
} from './engine'
import { buildLookup, type ScasLookup } from './state'
import { WordNudgeEmitter } from '../provenance/wordNudges'

const WORD_RE = /[a-zA-Z]+/g
const BOUNDARY_RE = /[\s.,;:!?)\-'"…]/

interface ScannedWord {
  lemma: string
  slotOriginalLemma: string | null
  isSubstitution: boolean // carries a slot mark whose current lemma differs from its original
  committed: boolean      // false = the word under the cursor, still being typed (no boundary yet)
}

/**
 * Collect the document's *committed* words. A word is committed unless it is the one under the
 * cursor still being typed (no trailing boundary yet) — matching the renderer's definition, so a
 * word nudge fires exactly when the word turns red.
 */
function scanCommitted(pmDoc: PMNode, cursorPos: number): ScannedWord[] {
  const out: ScannedWord[] = []
  pmDoc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'paragraph') return true
    node.forEach((child: PMNode, offset: number) => {
      if (!child.isText || !child.text) return
      const text = child.text
      const slotMark = child.marks.find((m) => m.type.name === 'scasSlot')
      const slotOriginal = (slotMark?.attrs.original as string | null) ?? null
      let match: RegExpExecArray | null
      WORD_RE.lastIndex = 0
      while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0]
        if (word.length < 2) continue
        const from = pos + 1 + offset + match.index
        const to = from + word.length
        // The word under the cursor (no boundary char after it yet) is UNCOMMITTED: excluded from
        // kick/resolution decisions, but still visible to the deletion pass — with the deferred
        // 120ms tick, treating it as absent made "backspace somewhere + cursor mid-word on a kicked
        // lemma" read as a deletion → spurious lock + snapshot.
        let committed = true
        if (cursorPos >= from && cursorPos <= to) {
          const nextChar = text[match.index + word.length] ?? null
          if (!nextChar || !BOUNDARY_RE.test(nextChar)) committed = false
        }
        const lemma = lemmaOf(word)
        const slotOriginalLemma = slotOriginal ? lemmaOf(slotOriginal) : null
        out.push({
          lemma,
          slotOriginalLemma,
          isSubstitution: committed && slotOriginalLemma !== null && slotOriginalLemma !== lemma,
          committed,
        })
      }
    })
    return false
  })
  return out
}

export class ScasController {
  state: ScasState
  /** Emits a WordNudgeEvent on each resolution (swap / discharge / delete→credit). */
  readonly nudges = new WordNudgeEmitter()
  private seedRef: string
  private docId: string
  private setSize: number
  private currentSet: Set<string>
  private commitIndex = 0 // monotonic order of resolved word nudges (for state-machine replay)

  constructor(state: ScasState, seedRef: string, docId: string, setSize: number) {
    this.state = state
    this.seedRef = seedRef
    this.docId = docId
    this.setSize = setSize
    this.currentSet = deriveSet(seedRef, docId, state.version, setSize)
  }

  /** Point the controller at a (possibly different) active document + state. */
  reseat(state: ScasState, seedRef: string, docId: string, setSize: number): void {
    this.state = state
    this.seedRef = seedRef
    this.docId = docId
    this.setSize = setSize
    this.currentSet = deriveSet(seedRef, docId, state.version, setSize)
  }

  /**
   * Remove from liveKicks any lemma that is no longer in the current S_v.
   * Call this after reseating with a new setSize so the display responds
   * immediately to N changes (words outside the new, smaller set go grey).
   */
  clearStaleKicks(): void {
    const filtered = this.state.liveKicks.filter((l) => this.currentSet.has(l))
    if (filtered.length !== this.state.liveKicks.length) {
      this.state = { ...this.state, liveKicks: filtered }
    }
  }

  inSv(lemma: string): boolean {
    return this.currentSet.has(lemma)
  }

  /** Epoch ms when `word`'s lemma first turned purple (was nudged), or undefined if unknown. */
  firstNudgeAt(word: string): number | undefined {
    return this.state.kickTimes?.[lemmaOf(word)]
  }

  /**
   * Adopt a server-issued exclusion set (M3): the live signing session is authoritative for S_v, so
   * this replaces the locally-derived set. Advancing the version expires stale immunity (same as a
   * local resample); locked + liveKicks persist, so committed verdicts never churn.
   */
  useServerSet(lemmas: Set<string>, version: number): void {
    if (version !== this.state.version) this.state = resample(this.state, version)
    this.currentSet = lemmas
  }

  lookup(): ScasLookup {
    if (this.setSize === 0) {
      // Infinite mode: no words are in S_v — return an empty lookup so no words are highlighted.
      return { version: this.state.version, locked: new Set(), liveKicks: new Set(), immune: new Set() }
    }
    return buildLookup(this.state)
  }

  /**
   * Process a document change: fire word nudges, resolve substitutions, and (only when content was
   * removed) lock deleted nudged lemmas. Returns true if the state changed.
   */
  processDoc(pmDoc: PMNode, cursorPos: number, hadDeletion: boolean): boolean {
    if (this.setSize === 0) return false // Infinite mode: no constraint encounters
    const words = scanCommitted(pmDoc, cursorPos)
    const before = this.state
    let st = this.state

    // 1. Resolutions — a completed substitution resolves the ORIGINAL lemma. Edge-triggered:
    //    only act (and emit) when the original is currently outstanding (locked or a live nudge),
    //    so a persisting slot word doesn't re-resolve/re-emit on every later keystroke.
    for (const w of words) {
      if (w.isSubstitution && w.slotOriginalLemma) {
        const o = w.slotOriginalLemma
        const wasLocked = isLocked(st, o)
        const wasLive = st.liveKicks.includes(o)
        if (wasLocked || wasLive) {
          st = wasLocked ? discharge(st, o) : markSatisfied(st, o)
          this.nudges.emit({
            lemma: o,
            commitIndex: this.commitIndex++,
            setVersion: st.version,
            trigger: wasLocked ? 'locked' : 'in-S',
            response: wasLocked ? 'credit-discharged' : 'swapped',
            replacement: w.lemma,
            deliberationMs: 0, // selectable→resolved timing arrives with the popover tap (later)
          })
        }
      }
    }

    // 2. Fresh word nudges — a committed in-S lemma (not immune/locked) becomes an outstanding nudge.
    //    Stamp the moment it FIRST turns purple (kickTimes) — the slot's true "first-written" time,
    //    persisted with the state so it survives reload (read later via firstNudgeAt).
    //    Set views built ONCE per pass: classifyCommit's array scans (locked.includes +
    //    satisfied.find) made this loop O(words × session-state) on every keystroke. The inline
    //    checks below are classifyCommit's exact decision order — locked → skip (loop 2 only acts
    //    on 'in-S'), immune-this-version → skip, in-S → kick, else pass. locked/satisfied can't
    //    change inside this loop (recordKick touches only liveKicks/kickTimes), so the views hold.
    const lockedSet = new Set(st.locked)
    const immuneSet = new Set(st.satisfied.filter((s) => s.satisfiedAtVersion === st.version).map((s) => s.lemma))
    const liveKickSet = new Set(st.liveKicks)
    for (const w of words) {
      if (!w.committed) continue // still being typed — not a commit yet
      if (lockedSet.has(w.lemma) || immuneSet.has(w.lemma) || !this.inSv(w.lemma)) continue
      const fresh = !liveKickSet.has(w.lemma)
      st = recordKick(st, w.lemma)
      liveKickSet.add(w.lemma)
      if (fresh && !st.kickTimes?.[w.lemma]) {
        st = { ...st, kickTimes: { ...st.kickTimes, [w.lemma]: Date.now() } }
      }
    }

    // 3. Deletions — a nudged lemma that vanished (and wasn't resolved via a slot) is a dodge → lock.
    //    Gated on an actual deletion so merely-not-yet-committed words aren't mistaken for deletes.
    if (hadDeletion) {
      const present = new Set(words.map((w) => w.lemma)) // includes the uncommitted cursor word
      const slotRefs = new Set(words.map((w) => w.slotOriginalLemma).filter(Boolean) as string[])
      for (const L of before.liveKicks) {
        if (!present.has(L) && !slotRefs.has(L)) {
          st = lock(st, L)
          this.nudges.emit({
            lemma: L,
            commitIndex: this.commitIndex++,
            setVersion: st.version,
            trigger: 'in-S',
            response: 'deleted->credit',
            deliberationMs: 0,
          })
        }
      }
    }

    this.state = st
    return st !== before
  }

  /** Advance to the next S-version (a resample): re-derive S_v and expire stale immunity. */
  resampleNow(): boolean {
    const nextVersion = this.state.version + 1
    this.state = resample(this.state, nextVersion)
    this.currentSet = deriveSet(this.seedRef, this.docId, nextVersion, this.setSize)
    return true
  }
}
