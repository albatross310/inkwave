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

/** A document range (PM positions) that bounds where this tick's edits/caret activity happened. */
export interface ScanWindow { from: number; to: number }

/**
 * Collect the document's *committed* words. A word is committed unless it is the one under the
 * cursor still being typed (no trailing boundary yet) — matching the renderer's definition, so a
 * word nudge fires exactly when the word turns red.
 *
 * `window` (phone input priority, 2026-07-10): scan only the paragraphs intersecting the given
 * range instead of the whole document. The full scan is O(doc) (~3ms/12k words in Node, tens of ms
 * on a phone CPU) and ran on EVERY 250ms typing pause; a caret/edit window is ~500× cheaper.
 * SAFE BY CONSTRUCTION for passes 1–2: words can only newly commit (caret leaves them) or newly
 * substitute (doc changes there) INSIDE the tick's edit+caret window, and verdicts for text outside
 * it are frozen state (never re-derived from S_v — the no-retroactive-reflag invariant). The
 * DELETION pass needs whole-document presence, so processDoc ignores the window when a deletion
 * happened (see below) — a window is never allowed to hide a removal.
 */
// Per-paragraph scan cache (2026-07-11 typing-lag ablation). ScannedWord is position-free and —
// for a paragraph NOT containing the cursor — a pure function of the paragraph node (persistent
// PM structure: same reference ⇔ identical text+marks), so its word list can be reused across
// ticks. The FULL scan stays semantically full (the deletion pass still sees whole-document word
// presence — the hard invariant); it's just assembled from cached per-paragraph arrays, so a
// desktop tick (or a phone deletion tick) costs O(changed paragraphs), not O(doc). The cursor's
// paragraph is never cached (the uncommitted-word test depends on cursorPos).
const _scanCache = new WeakMap<PMNode, ScannedWord[]>()

// ─── Whole-document lemma-presence index (2026-07-11, round-4 "deleting lags in waves") ────────
// The deletion pass needs whole-doc WORD PRESENCE, not a full rescan: the controller keeps two
// multisets — every word's lemma, and every slot-marked word's ORIGINAL lemma — updated per tick
// by a top-level block diff against the previous doc (persistent PM structures: identical
// reference ⇔ identical content, so only ADDED/REMOVED block identities contribute). A deletion
// tick then answers "is this nudged lemma still present anywhere" in O(changed blocks) and the
// scan itself can stay WINDOWED. Per-block contributions are position-free and cached by node
// identity; word definition matches scanCommitted exactly (paragraph descendants, [a-zA-Z]{2,}).
interface BlockLemmas { lemmas: string[]; slots: string[] }
const _blockLemmaCache = new WeakMap<PMNode, BlockLemmas>()

function blockLemmas(block: PMNode): BlockLemmas {
  const hit = _blockLemmaCache.get(block)
  if (hit) return hit
  const lemmas: string[] = []
  const slots: string[] = []
  const visitParagraph = (para: PMNode) => {
    para.forEach((child: PMNode) => {
      if (!child.isText || !child.text) return
      const slotMark = child.marks.find((m) => m.type.name === 'scasSlot')
      const slotOriginal = (slotMark?.attrs.original as string | null) ?? null
      const slotOriginalLemma = slotOriginal ? lemmaOf(slotOriginal) : null
      let match: RegExpExecArray | null
      WORD_RE.lastIndex = 0
      while ((match = WORD_RE.exec(child.text)) !== null) {
        if (match[0].length < 2) continue
        lemmas.push(lemmaOf(match[0]))
        if (slotOriginalLemma) slots.push(slotOriginalLemma)
      }
    })
  }
  if (block.type.name === 'paragraph') visitParagraph(block)
  else block.descendants((n: PMNode) => {
    if (n.type.name !== 'paragraph') return true
    visitParagraph(n)
    return false
  })
  const out = { lemmas, slots }
  _blockLemmaCache.set(block, out)
  return out
}

function bumpCounts(map: Map<string, number>, keys: string[], sign: 1 | -1): void {
  for (const k of keys) {
    const next = (map.get(k) ?? 0) + sign
    if (next <= 0) map.delete(k)
    else map.set(k, next)
  }
}

function scanCommitted(pmDoc: PMNode, cursorPos: number, window?: ScanWindow): ScannedWord[] {
  const out: ScannedWord[] = []
  const scanParagraph = (node: PMNode, pos: number) => {
    const cursorInside = cursorPos >= pos && cursorPos <= pos + node.nodeSize
    if (!cursorInside) {
      const hit = _scanCache.get(node)
      if (hit) { for (const w of hit) out.push(w); return }
    }
    const startLen = out.length
    scanParagraphFresh(node, pos)
    if (!cursorInside) _scanCache.set(node, out.slice(startLen))
  }
  const scanParagraphFresh = (node: PMNode, pos: number) => {
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
  }
  if (window) {
    // Windowed: whole paragraphs only (nodesBetween yields every paragraph INTERSECTING the range,
    // and scanParagraph reads the entire paragraph), so a window never splits a word or misses the
    // committed-word boundary test. ±1 keeps a collapsed (from === to) window from vanishing.
    const from = Math.max(0, Math.min(window.from - 1, pmDoc.content.size))
    const to = Math.max(from, Math.min(window.to + 1, pmDoc.content.size))
    pmDoc.nodesBetween(from, to, (node: PMNode, pos: number) => {
      if (node.type.name !== 'paragraph') return true
      scanParagraph(node, pos)
      return false
    })
  } else {
    pmDoc.descendants((node: PMNode, pos: number) => {
      if (node.type.name !== 'paragraph') return true
      scanParagraph(node, pos)
      return false
    })
  }
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
  // Presence index (see blockLemmas above): whole-doc lemma/slot-original multisets + the doc
  // they describe. null presence = never built (rebuilt from scratch on the next tick).
  private presence: Map<string, number> | null = null
  private slotPresence: Map<string, number> = new Map()
  private lastDoc: PMNode | null = null

  /** Bring the presence multisets up to `pmDoc` — O(changed top-level blocks) via identity diff. */
  private syncIndex(pmDoc: PMNode): void {
    if (this.presence && this.lastDoc === pmDoc) return
    if (!this.presence || !this.lastDoc) {
      this.presence = new Map()
      this.slotPresence = new Map()
      pmDoc.forEach((block: PMNode) => {
        const bl = blockLemmas(block)
        bumpCounts(this.presence!, bl.lemmas, 1)
        bumpCounts(this.slotPresence, bl.slots, 1)
      })
      this.lastDoc = pmDoc
      return
    }
    // Top-level identity diff: shared prefix + suffix contribute unchanged; the middle region's
    // old blocks are subtracted and new blocks added. Worst case (whole-doc paste) = a rebuild.
    const oldCh: PMNode[] = []
    const newCh: PMNode[] = []
    this.lastDoc.forEach((n: PMNode) => { oldCh.push(n) })
    pmDoc.forEach((n: PMNode) => { newCh.push(n) })
    let s = 0
    while (s < oldCh.length && s < newCh.length && oldCh[s] === newCh[s]) s++
    let eo = oldCh.length - 1
    let en = newCh.length - 1
    while (eo >= s && en >= s && oldCh[eo] === newCh[en]) { eo--; en-- }
    for (let i = s; i <= eo; i++) {
      const bl = blockLemmas(oldCh[i])
      bumpCounts(this.presence, bl.lemmas, -1)
      bumpCounts(this.slotPresence, bl.slots, -1)
    }
    for (let i = s; i <= en; i++) {
      const bl = blockLemmas(newCh[i])
      bumpCounts(this.presence, bl.lemmas, 1)
      bumpCounts(this.slotPresence, bl.slots, 1)
    }
    this.lastDoc = pmDoc
  }

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
    this.presence = null // new document → the presence index rebuilds on the next tick
    this.lastDoc = null
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
   *
   * `window` (optional): bound the scan to the tick's edit+caret range — the O(doc)-off-the-
   * typing-path optimisation. DELETION ticks stay windowed too (round-4 "deleting lags in
   * waves"): the vanished-lemma pass needs whole-document WORD PRESENCE, not a full rescan, and
   * the presence INDEX (syncIndex above — O(changed blocks) per tick) answers it exactly. The
   * phantom-snapshot guard holds because the index is global by construction: a removal anywhere
   * decrements it whether or not the window saw it.
   */
  processDoc(pmDoc: PMNode, cursorPos: number, hadDeletion: boolean, window?: ScanWindow | null): boolean {
    if (this.setSize === 0) return false // Infinite mode: no constraint encounters
    this.syncIndex(pmDoc) // presence multisets track EVERY tick (cheap identity diff when clean)
    const words = scanCommitted(pmDoc, cursorPos, window ?? undefined)
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
    //    Presence comes from the whole-document INDEX (multiset counts include the uncommitted
    //    cursor word and every slot-marked word's original — the exact sets the old full scan
    //    built), so this pass is O(liveKicks) map lookups regardless of document size.
    if (hadDeletion) {
      for (const L of before.liveKicks) {
        if (!this.presence!.has(L) && !this.slotPresence.has(L)) {
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
