// @vitest-environment jsdom
//
// The parser is checked against fixtures whose correct parse is known BY CONSTRUCTION (we wrote the
// notation), not against another parse of the same file. That distinction matters here: a check
// derived from the same structure as the thing it checks cannot fail (CLAUDE.md).

import { describe, expect, it } from 'vitest'
import { indicesOfPrintedBar, midiOf, parseMusicXml, printedBars } from './parse'
import {
  PIANO_SCORE,
  PICKUP_SCORE,
  SIMPLE_SCALE,
  SIMPLE_SCALE_FIXED,
  TEMPO_CHANGE_SCORE,
  TIED_SCORE,
} from './scoreFixtures'

describe('midiOf', () => {
  it('anchors middle C at 60', () => {
    expect(midiOf('C', 0, 4)).toBe(60)
  })

  it('reads accidentals and octaves', () => {
    expect(midiOf('A', 0, 4)).toBe(69)      // concert A440
    expect(midiOf('B', -1, 4)).toBe(70)     // B-flat below B natural
    expect(midiOf('B', 0, 4)).toBe(71)
    expect(midiOf('C', 1, 4)).toBe(61)      // C-sharp
    expect(midiOf('C', 0, 5)).toBe(72)      // an octave above middle C
  })

  it('rejects a step that is not a note name, rather than inventing a pitch', () => {
    expect(() => midiOf('H', 0, 4)).toThrow(/Unknown pitch step/)
  })
})

describe('parseMusicXml — structure', () => {
  it('reads the title, composer and bar count', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    expect(score.title).toBe('Ascending Scale')
    expect(score.composer).toBe('Inkwave Test Suite')
    expect(score.measureCount).toBe(4)
    expect(score.parts).toHaveLength(1)
    expect(score.parts[0].name).toBe('Piano')
  })

  it('reads the notes of a bar in order, with the pitches actually written', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    const bar1 = score.parts[0].measures[0]
    expect(bar1.notes.map(n => n.pitch?.midi)).toEqual([60, 62, 64, 65]) // C4 D4 E4 F4
  })

  it('places every bar on the timeline in quarter notes', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    // 4/4 → four quarter notes per bar.
    expect(score.parts[0].measures.map(m => m.onsetQuarters)).toEqual([0, 4, 8, 12])
  })

  it('reads the time signature', () => {
    expect(parseMusicXml(SIMPLE_SCALE).timeSignature).toEqual({ beats: 4, beatType: 4 })
  })
})

describe('parseMusicXml — bar numbering (printed vs index)', () => {
  it('keeps the printed number verbatim, including a pickup numbered 0', () => {
    const score = parseMusicXml(PICKUP_SCORE)
    expect(printedBars(score)).toEqual(['0', '1', '2', '3'])
  })

  it('marks an implicit pickup as implicit', () => {
    const score = parseMusicXml(PICKUP_SCORE)
    expect(score.parts[0].measures[0].implicit).toBe(true)
    expect(score.parts[0].measures[1].implicit).toBe(false)
  })

  it('PROVES printed number and index genuinely diverge across a pickup', () => {
    // This is the whole reason the model carries both. With a pickup at index 0, printed bar 1 is
    // the SECOND measure — so an addressing scheme that conflated them would be off by one for
    // every bar of the piece, on exactly the scores (anacrusis) where students cite bars most.
    const score = parseMusicXml(PICKUP_SCORE)
    expect(indicesOfPrintedBar(score, '1')).toEqual([1])
    expect(indicesOfPrintedBar(score, '2')).toEqual([2])
    // ...whereas in a score with no pickup they coincide, which is what makes the bug invisible
    // until a real score turns up.
    const plain = parseMusicXml(SIMPLE_SCALE)
    expect(indicesOfPrintedBar(plain, '1')).toEqual([0])
  })

  it('gives a pickup its ACTUAL length, so the next bar lands on the downbeat', () => {
    const score = parseMusicXml(PICKUP_SCORE)
    const [pickup, bar1] = score.parts[0].measures
    expect(pickup.durationQuarters).toBe(1)  // one quarter note, not a full 4/4 bar
    expect(bar1.onsetQuarters).toBe(1)
  })

  it('reports no index for a bar number the score does not have', () => {
    expect(indicesOfPrintedBar(parseMusicXml(SIMPLE_SCALE), '99')).toEqual([])
  })
})

describe('parseMusicXml — chords, voices and backup', () => {
  it('gives every note of a chord the SAME onset', () => {
    const score = parseMusicXml(PIANO_SCORE)
    const bar1 = score.parts[0].measures[0]
    const rh = bar1.notes.filter(n => n.staff === 1)
    expect(rh.map(n => n.pitch?.midi)).toEqual([60, 64, 67])  // C major triad
    expect(rh.map(n => n.onsetQuarters)).toEqual([0, 0, 0])   // sounded together, not arpeggiated
  })

  it('rewinds on <backup> so the left hand starts at the bar, not after the right hand', () => {
    const score = parseMusicXml(PIANO_SCORE)
    const lh = score.parts[0].measures[0].notes.filter(n => n.staff === 2)
    expect(lh).toHaveLength(1)
    expect(lh[0].pitch?.midi).toBe(36)     // C2
    expect(lh[0].onsetQuarters).toBe(0)    // NOT 4 — <backup> moved the cursor home
  })

  it('lets a rest advance the clock without sounding', () => {
    const score = parseMusicXml(PIANO_SCORE)
    const bar2 = score.parts[0].measures[1]
    const rest = bar2.notes.find(n => !n.pitch)
    expect(rest).toBeDefined()
    // The D4 after a half rest starts halfway through bar 2 (bar 2 begins at quarter 4).
    const d4 = bar2.notes.find(n => n.pitch?.midi === 62)
    expect(d4?.onsetQuarters).toBe(6)
  })

  it('records the voice and staff a note was written on', () => {
    const score = parseMusicXml(PIANO_SCORE)
    const notes = score.parts[0].measures[0].notes
    expect(notes.find(n => n.pitch?.midi === 36)?.voice).toBe('2')
    expect(notes.find(n => n.pitch?.midi === 60)?.staff).toBe(1)
  })
})

describe('parseMusicXml — ties', () => {
  it('merges a tie across a barline into ONE sounding note', () => {
    const score = parseMusicXml(TIED_SCORE)
    const all = score.parts[0].measures.flatMap(m => m.notes)
    expect(all).toHaveLength(1)                 // not two notes re-struck
    expect(all[0].durationQuarters).toBe(8)     // held across both whole bars
    expect(all[0].onsetQuarters).toBe(0)
  })

  it('does not merge notes that merely repeat the same pitch', () => {
    // A negative that must FIRE: SIMPLE_SCALE has no ties at all, so nothing may be swallowed.
    const score = parseMusicXml(SIMPLE_SCALE)
    const all = score.parts[0].measures.flatMap(m => m.notes)
    expect(all).toHaveLength(15) // 4+4+4+3
  })
})

describe('parseMusicXml — tempo', () => {
  it('defaults to quarter = 120 when the score states no tempo', () => {
    const score = parseMusicXml(PICKUP_SCORE)
    expect(score.tempos).toEqual([{ onsetQuarters: 0, bpm: 120 }])
  })

  it('reads a tempo from <sound> inside a <direction>', () => {
    const score = parseMusicXml(SIMPLE_SCALE)
    expect(score.tempos[0]).toEqual({ onsetQuarters: 0, bpm: 60 })
  })

  it('builds a tempo MAP when the tempo changes mid-score', () => {
    const score = parseMusicXml(TEMPO_CHANGE_SCORE)
    expect(score.tempos).toEqual([
      { onsetQuarters: 0, bpm: 60 },
      { onsetQuarters: 4, bpm: 120 },
    ])
  })
})

describe('parseMusicXml — refuses bad input loudly', () => {
  it('rejects XML that is not well formed', () => {
    expect(() => parseMusicXml('<score-partwise><part>')).toThrow(/isn’t valid XML/)
  })

  it('rejects a file that is not MusicXML at all', () => {
    expect(() => parseMusicXml('<html><body>not a score</body></html>')).toThrow(/doesn’t look like MusicXML/)
  })

  it('rejects timewise MusicXML with an actionable message', () => {
    expect(() => parseMusicXml('<score-timewise version="4.0"></score-timewise>'))
      .toThrow(/timewise/)
  })

  it('rejects a partwise score with no parts', () => {
    expect(() => parseMusicXml('<score-partwise version="4.0"></score-partwise>'))
      .toThrow(/no parts/)
  })

  it('rejects a part with no measures rather than returning an empty score', () => {
    // The silent-empty failure this codebase keeps re-learning: an empty parse looks exactly like
    // a score that has no notes.
    expect(() => parseMusicXml('<score-partwise version="4.0"><part id="P1"></part></score-partwise>'))
      .toThrow(/no measures/)
  })
})

describe('parseMusicXml — warnings are surfaced, not swallowed', () => {
  it('warns that playback ignores repeats', () => {
    const withRepeat = SIMPLE_SCALE.replace(
      '<measure number="2">',
      '<measure number="2"><barline location="left"><repeat direction="forward"/></barline>',
    )
    const score = parseMusicXml(withRepeat)
    expect(score.warnings.join(' ')).toMatch(/repeats/i)
  })

  it('warns that grace notes are not played, and does not let them shift the beat', () => {
    const withGrace = SIMPLE_SCALE.replace(
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>',
      '<note><grace/><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><type>eighth</type></note>' +
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>',
    )
    const score = parseMusicXml(withGrace)
    expect(score.warnings.join(' ')).toMatch(/grace/i)
    // The bar still holds its four real notes on the beat.
    expect(score.parts[0].measures[0].notes.map(n => n.onsetQuarters)).toEqual([0, 1, 2, 3])
  })

  it('reports no warnings for a clean score (so a warning MEANS something)', () => {
    expect(parseMusicXml(SIMPLE_SCALE).warnings).toEqual([])
  })
})

describe('the corrected-master fixture', () => {
  it('differs from the original, and ONLY in bar 3', () => {
    // Guards the §B6 test's premise. If these two were equal — which a fragile string-replacement
    // fixture could silently make them — "does the excerpt update?" would be asserting against an
    // unchanged master and could never fail honestly.
    expect(SIMPLE_SCALE_FIXED).not.toBe(SIMPLE_SCALE)

    const before = parseMusicXml(SIMPLE_SCALE).parts[0].measures
    const after = parseMusicXml(SIMPLE_SCALE_FIXED).parts[0].measures
    const midis = (ms: typeof before) => ms.map(m => m.notes.map(n => n.pitch?.midi))

    expect(midis(before)[0]).toEqual(midis(after)[0])
    expect(midis(before)[1]).toEqual(midis(after)[1])
    expect(midis(before)[3]).toEqual(midis(after)[3])
    // Bar 3: B natural (71) → B flat (70).
    expect(midis(before)[2]).toEqual([71, 69, 67, 65])
    expect(midis(after)[2]).toEqual([70, 69, 67, 65])
  })
})
