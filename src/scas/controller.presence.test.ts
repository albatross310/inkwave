// Round-4 presence index: deletion ticks stay WINDOWED because the controller maintains a
// whole-document lemma-presence multiset (top-level block identity diff per tick). These tests
// pin the phantom-snapshot guard under the new mechanism:
//   • a kicked word deleted OUTSIDE the window still locks (the index is global)
//   • a duplicate lemma elsewhere prevents the lock (multiset, not boolean)
//   • a slot-marked substitution elsewhere still protects its original lemma
//   • paragraph split/join (Enter / backspace-over-return) keeps the index exact
//   • windowed-with-index ≡ full-scan behaviour across an edit sequence
import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { ScasController } from './controller'
import { emptyScasState } from './state'
import { deriveSet, lemmaOf } from './engine'

const SEED = 'presence-test-seed'
const DOC_ID = 'doc-presence'
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

function docOf(paras: Array<string | PMNode>): PMNode {
  return schema.node('doc', null, paras.map((t) =>
    typeof t === 'string'
      ? (t ? schema.node('paragraph', null, [schema.text(t)]) : schema.node('paragraph'))
      : t,
  ))
}

function makeController(): ScasController {
  return new ScasController(emptyScasState(), SEED, DOC_ID, SET)
}

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
const endPos = (d: PMNode) => d.content.size - 1
// A window pinned to the LAST paragraph only — deliberately far from paragraph 0.
const lastParaWindow = (d: PMNode) => ({ from: d.content.size - 3, to: d.content.size - 1 })

describe('presence index — deletion ticks stay windowed', () => {
  it('sanity: probes drawn', () => {
    expect(probe.inSv(HOT)).toBe(true)
    expect(probe.inSv(OTHER)).toBe(true)
    expect(outOfS.length).toBeGreaterThanOrEqual(6)
  })

  it('locks a kicked lemma deleted OUTSIDE the window (index is global)', () => {
    const ctl = makeController()
    const d0 = docOf([`${F(0)} ${HOT} ${F(1)}.`, `${F(2)} ${F(3)}.`])
    ctl.processDoc(d0, endPos(d0), false, lastParaWindow(d0)) // windowed insert tick — index builds
    // HOT is outside the window, so it kicks only when its paragraph is scanned; force one
    // full-ish tick over paragraph 0 to record the kick (window over the whole doc).
    ctl.processDoc(d0, endPos(d0), false, { from: 1, to: endPos(d0) })
    expect(ctl.state.liveKicks).toContain(HOT)
    // delete HOT from paragraph 0; the tick's window covers only the LAST paragraph
    const d1 = docOf([`${F(0)} ${F(1)}.`, `${F(2)} ${F(3)}.`])
    ctl.processDoc(d1, endPos(d1), true, lastParaWindow(d1))
    expect(ctl.state.locked).toContain(HOT)
    expect(ctl.state.liveKicks).not.toContain(HOT)
  })

  it('does NOT lock when the lemma survives elsewhere (multiset count)', () => {
    const ctl = makeController()
    const d0 = docOf([`${F(0)} ${HOT} ${F(1)}.`, `${F(2)} ${HOT} also.`])
    ctl.processDoc(d0, endPos(d0), false, { from: 1, to: endPos(d0) })
    expect(ctl.state.liveKicks).toContain(HOT)
    // delete only paragraph 0's instance — an instance survives in paragraph 1
    const d1 = docOf([`${F(0)} ${F(1)}.`, `${F(2)} ${HOT} also.`])
    ctl.processDoc(d1, endPos(d1), true, lastParaWindow(d1))
    expect(ctl.state.locked).not.toContain(HOT)
    expect(ctl.state.liveKicks).toContain(HOT)
  })

  it('slot-marked substitution elsewhere protects its original from the deletion lock', () => {
    const ctl = makeController()
    const slot = schema.mark('scasSlot', { original: HOT })
    const slotted = schema.node('paragraph', null, [schema.text(`${F(0)} `), schema.text('beacon', [slot]), schema.text('.')])
    const d0 = docOf([`${F(1)} ${HOT}.`, slotted])
    ctl.processDoc(d0, endPos(d0), false, { from: 1, to: endPos(d0) })
    // the raw HOT instance is deleted, but the slot's original still references it
    const d1 = docOf([`${F(1)}.`, slotted])
    ctl.processDoc(d1, endPos(d1), true, lastParaWindow(d1))
    expect(ctl.state.locked).not.toContain(HOT)
  })

  it('paragraph split then join (Enter / backspace-over-return) keeps presence exact', () => {
    const ctl = makeController()
    const d0 = docOf([`${F(0)} ${HOT} ${F(1)} tailwords.`])
    ctl.processDoc(d0, endPos(d0), false, { from: 1, to: endPos(d0) })
    expect(ctl.state.liveKicks).toContain(HOT)
    // Enter: split into two paragraphs (both new node identities)
    const d1 = docOf([`${F(0)} ${HOT}`, `${F(1)} tailwords.`])
    ctl.processDoc(d1, endPos(d1), false, lastParaWindow(d1))
    // join back (backspace over the return) — deletion tick, windowed
    const d2 = docOf([`${F(0)} ${HOT} ${F(1)} tailwords.`])
    ctl.processDoc(d2, endPos(d2), true, lastParaWindow(d2))
    expect(ctl.state.locked).not.toContain(HOT) // HOT never vanished across the split/join
    expect(ctl.state.liveKicks).toContain(HOT)
    // now delete it for real, still windowed elsewhere
    const d3 = docOf([`${F(0)} ${F(1)} tailwords.`])
    ctl.processDoc(d3, endPos(d3), true, { from: 1, to: 3 })
    expect(ctl.state.locked).toContain(HOT)
  })

  it('windowed-with-index ≡ full-scan across an edit sequence', () => {
    const ctlWin = makeController()
    const ctlFull = makeController()
    const steps: Array<{ doc: PMNode; del: boolean }> = [
      { doc: docOf([`${F(0)} ${HOT}.`, `${F(1)} ${OTHER}.`, `${F(2)} end.`]), del: false },
      { doc: docOf([`${F(0)} ${HOT}.`, `${F(1)} ${OTHER} more.`, `${F(2)} end.`]), del: false },
      { doc: docOf([`${F(0)} ${HOT}.`, `${F(1)} more.`, `${F(2)} end.`]), del: true },   // OTHER deleted
      { doc: docOf([`${F(0)} ${HOT}.`, `${F(1)} more.`]), del: true },                    // paragraph removed
      { doc: docOf([`${F(0)}.`, `${F(1)} more.`]), del: true },                           // HOT deleted
    ]
    for (const s of steps) {
      // window = whole doc for the scan passes (identical pass-1/2 inputs); the DELETION pass is
      // what differs: index (win driver) vs the historical full-scan Sets (full driver had the
      // same index now — this pins that windowed never diverges from unwindowed)
      ctlWin.processDoc(s.doc, endPos(s.doc), s.del, { from: 1, to: endPos(s.doc) })
      ctlFull.processDoc(s.doc, endPos(s.doc), s.del)
      expect(ctlWin.state.locked.sort()).toEqual(ctlFull.state.locked.sort())
      expect(ctlWin.state.liveKicks.sort()).toEqual(ctlFull.state.liveKicks.sort())
      expect(ctlWin.state.satisfied).toEqual(ctlFull.state.satisfied)
    }
    expect(ctlFull.state.locked).toContain(OTHER)
    expect(ctlFull.state.locked).toContain(HOT)
  })
})
