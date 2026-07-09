// Windowed SCAS scan (phone round-2 lag, 2026-07-10): processDoc may scan only the tick's
// edit+caret window instead of the whole document. These tests pin the safety contract:
//   • windowed and full scans produce IDENTICAL state transitions for typing (kicks, resolutions)
//   • the cursor word stays committed:false through a window (no premature kick)
//   • the DELETION pass always sees the whole document — a window is IGNORED when hadDeletion is
//     set (the phantom-snapshot guard: a window must never hide a removal and cause a false lock)
//   • frozen verdicts outside the window never churn (the no-retroactive-reflag invariant)
import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { ScasController } from './controller'
import { emptyScasState } from './state'
import { deriveSet, lemmaOf } from './engine'
import type { WordNudgeEvent } from '../types/document'

const SEED = 'window-test-seed'
const DOC_ID = 'doc-window'
const SET = 300

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    scasSlot: {
      attrs: { original: { default: null }, locked: { default: false }, firstCommitAt: { default: null } },
    },
  },
})

function docOf(paras: string[]): PMNode {
  return schema.node('doc', null, paras.map((t) => (t ? schema.node('paragraph', null, [schema.text(t)]) : schema.node('paragraph'))))
}

function makeController(): ScasController {
  return new ScasController(emptyScasState(), SEED, DOC_ID, SET)
}

// Deterministic probe words: HOT/OTHER are drawn from this seed's own S_v (version 0), restricted
// to LEMMA-STABLE surfaces (lemmaOf(w) === w, so typing the word encounters exactly that S_v key);
// fillers are words verified OUTSIDE S_v so the surrounding prose never adds kicks of its own.
const S0 = [...deriveSet(SEED, DOC_ID, 0, SET)].filter((w) => lemmaOf(w) === w).sort()
const HOT = S0[0]
const OTHER = S0[1]
const probe = makeController()
const outOfS = (() => {
  const found: string[] = []
  for (const w of ['keep', 'here', 'some', 'text', 'calm', 'tail', 'alpha', 'beta', 'gamma', 'delta', 'writing', 'unrelated', 'the', 'and', 'with', 'this']) {
    if (!probe.inSv(lemmaOf(w))) found.push(w)
  }
  return found
})()
const F = (i: number) => outOfS[i % outOfS.length]

// Position of the END of paragraph i's text (a caret sitting after its last char).
function endOfPara(doc: PMNode, i: number): number {
  let pos = 0
  let seen = -1
  doc.forEach((node, offset) => {
    seen++
    if (seen === i) pos = offset + 1 + node.content.size
  })
  return pos
}

describe('windowed scan ≡ full scan (typing, no deletion)', () => {
  it('draws distinct in-S probes and enough out-of-S fillers', () => {
    expect(HOT).toBeTruthy()
    expect(OTHER).toBeTruthy()
    expect(HOT).not.toBe(OTHER)
    expect(probe.inSv(HOT)).toBe(true)
    expect(probe.inSv(OTHER)).toBe(true)
    expect(outOfS.length).toBeGreaterThanOrEqual(6)
  })

  it('kicks a committed in-S word identically when the window covers only its paragraph', () => {
    const ctlFull = makeController()
    const ctlWin = makeController()
    const doc = docOf([`${F(0)} ${F(1)} ${F(2)}.`, `${F(3)} ${HOT} ${F(4)}.`, `${F(5)} ${F(6)}.`])
    const caret = endOfPara(doc, 1)
    ctlFull.processDoc(doc, caret, false)
    const p1From = endOfPara(doc, 0) + 2
    ctlWin.processDoc(doc, caret, false, { from: p1From, to: caret })
    expect(ctlWin.state.liveKicks).toEqual(ctlFull.state.liveKicks)
    expect(ctlWin.state.liveKicks).toContain(HOT)
    expect(ctlWin.state.locked).toEqual(ctlFull.state.locked)
    expect(ctlWin.state.satisfied).toEqual(ctlFull.state.satisfied)
  })

  it('keeps the cursor word UNCOMMITTED inside a window (no premature kick mid-typing)', () => {
    const ctl = makeController()
    // caret at the very end of the hot word, no boundary after it → still being typed
    const doc = docOf([`${F(0)} ${HOT}`])
    const caret = endOfPara(doc, 0)
    ctl.processDoc(doc, caret, false, { from: caret - HOT.length, to: caret })
    expect(ctl.state.liveKicks).not.toContain(HOT)
    // a boundary lands after it (space) → commits on the next windowed tick
    const doc2 = docOf([`${F(0)} ${HOT} `])
    ctl.processDoc(doc2, endOfPara(doc2, 0), false, { from: caret - HOT.length, to: caret + 1 })
    expect(ctl.state.liveKicks).toContain(HOT)
  })

  it('resolves a slot substitution inside the window (nudge emitted once, edge-triggered)', () => {
    const ctl = makeController()
    const doc0 = docOf([`${F(0)} ${HOT} ${F(1)}.`])
    ctl.processDoc(doc0, endOfPara(doc0, 0), false, { from: 1, to: doc0.content.size - 1 })
    expect(ctl.state.liveKicks).toContain(HOT)
    // the popover swapped it: replacement text carries the slot mark with the original word
    const events: WordNudgeEvent[] = []
    const off = ctl.nudges.on((ev) => events.push(ev))
    const slot = schema.mark('scasSlot', { original: HOT })
    const swapped = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text(`${F(0)} `), schema.text('beacon', [slot]), schema.text(` ${F(1)}.`)]),
    ])
    ctl.processDoc(swapped, swapped.content.size - 1, false, { from: 1, to: swapped.content.size - 1 })
    off()
    expect(ctl.state.liveKicks).not.toContain(HOT)
    expect(ctl.state.satisfied.map((s) => s.lemma)).toContain(HOT)
    expect(events.filter((ev) => ev.lemma === HOT && ev.response === 'swapped')).toHaveLength(1)
  })

  it('never re-derives verdicts for committed text OUTSIDE the window (freeze holds)', () => {
    const ctl = makeController()
    const doc = docOf([`${F(0)} ${HOT} ${F(1)}.`, `${F(2)} ${OTHER} ${F(3)}.`])
    ctl.processDoc(doc, doc.content.size - 1, false)
    const frozen = [...ctl.state.liveKicks]
    expect(frozen).toEqual(expect.arrayContaining([HOT, OTHER]))
    // a windowed tick over paragraph 1 only must not touch paragraph 0's verdicts
    const p1From = endOfPara(doc, 0) + 2
    const changed = ctl.processDoc(doc, doc.content.size - 1, false, { from: p1From, to: doc.content.size - 1 })
    expect(changed).toBe(false)
    expect(ctl.state.liveKicks).toEqual(frozen)
  })
})

describe('deletion pass — the window is IGNORED (phantom-snapshot guard)', () => {
  it('locks a vanished nudged lemma even when the passed window excludes the deletion site', () => {
    const ctl = makeController()
    const doc = docOf([`${F(0)} ${HOT} ${F(1)}.`, `${F(2)} ${F(3)}.`])
    ctl.processDoc(doc, doc.content.size - 1, false)
    expect(ctl.state.liveKicks).toContain(HOT)
    // the hot word is deleted from paragraph 0, but the (buggy-caller) window points at paragraph 1
    const after = docOf([`${F(0)} ${F(1)}.`, `${F(2)} ${F(3)}.`])
    const p1From = endOfPara(after, 0) + 2
    const events: WordNudgeEvent[] = []
    const off = ctl.nudges.on((ev) => events.push(ev))
    ctl.processDoc(after, after.content.size - 1, true, { from: p1From, to: after.content.size - 1 })
    off()
    expect(ctl.state.locked).toContain(HOT)
    expect(events.some((ev) => ev.lemma === HOT && ev.response === 'deleted->credit')).toBe(true)
  })

  it('a windowed no-deletion tick can NOT lock lemmas outside the window (no false vanishing)', () => {
    const ctl = makeController()
    const doc = docOf([`${F(0)} ${HOT} ${F(1)}.`, `${F(2)} ${F(3)}.`])
    ctl.processDoc(doc, doc.content.size - 1, false)
    expect(ctl.state.liveKicks).toContain(HOT)
    // windowed tick over paragraph 1 only, no deletion flag — paragraph 0's kick must stay live
    const p1From = endOfPara(doc, 0) + 2
    ctl.processDoc(doc, doc.content.size - 1, false, { from: p1From, to: doc.content.size - 1 })
    expect(ctl.state.locked).not.toContain(HOT)
    expect(ctl.state.liveKicks).toContain(HOT)
  })
})
