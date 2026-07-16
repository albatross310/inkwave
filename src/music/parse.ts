// MusicXML → Inkwave's own Score model (build spec §B2).
//
// NO OMR, ever (§0 non-goal): this path exists precisely because Sibelius/MuseScore/Dorico/Finale
// already emit clean, machine-readable notation. We read what they wrote.
//
// The score is MARKUP-ONLY (§0): nothing here writes MusicXML back. This parser is read-only by
// construction — Inkwave consumes notation software's output and does not compete with it.
//
// TIME MODEL. MusicXML measures duration in `divisions` per quarter note, and `divisions` can change
// mid-part. Carrying raw ticks would make every downstream comparison depend on a per-part unit, so
// we normalise on the way in: everything is QUARTER NOTES (a float) from the score's start. That is
// part-independent, which is what lets several parts share one timeline and one cursor.

import type { Pitch, Score, ScoreMeasure, ScoreNote, ScorePart, TempoMark, TimeSignature } from './score'

const DEFAULT_BPM = 120
const DEFAULT_DIVISIONS = 1

// Semitone offset of each natural step above C, within an octave.
const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number for a pitch. Middle C (C4) = 60, so octave 4 sits at (4+1)*12 = 60. */
export function midiOf(step: string, alter: number, octave: number): number {
  const base = STEP_SEMITONES[step.toUpperCase()]
  if (base === undefined) throw new Error(`Unknown pitch step "${step}" in the MusicXML.`)
  return (octave + 1) * 12 + base + alter
}

const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? ''
const num = (el: Element | null | undefined, fallback: number): number => {
  const v = parseFloat(text(el))
  return Number.isFinite(v) ? v : fallback
}

/** Parse a MusicXML document string into a Score. Throws (loudly, specifically) on unusable input. */
export function parseMusicXml(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')

  // DOMParser reports XML syntax errors as a <parsererror> node instead of throwing.
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`That file isn’t valid XML — ${text(parseError).split('\n')[0] || 'the parser rejected it'}.`)
  }

  const root = doc.documentElement
  if (!root) throw new Error('That file is empty.')
  if (root.nodeName === 'score-timewise') {
    // Legal MusicXML, but organised measure-major. Vanishingly rare in exporter output; refuse
    // clearly rather than half-read it.
    throw new Error('This is a timewise MusicXML file, which Inkwave can’t read yet. Re-export it as partwise (every major notation app does this by default).')
  }
  if (root.nodeName !== 'score-partwise') {
    throw new Error(`That doesn’t look like MusicXML (its root element is <${root.nodeName}>).`)
  }

  const warnings: string[] = []

  const title = text(doc.querySelector('work > work-title')) ||
    text(doc.querySelector('movement-title')) || ''
  const composer = text(doc.querySelector('identification > creator[type="composer"]')) || ''

  // part-list gives each part a human name; fall back to the id.
  const partNames = new Map<string, string>()
  for (const sp of Array.from(doc.querySelectorAll('part-list > score-part'))) {
    const id = sp.getAttribute('id') ?? ''
    partNames.set(id, text(sp.querySelector('part-name')) || id)
  }

  const tempos: TempoMark[] = []
  let timeSignature: TimeSignature = { beats: 4, beatType: 4 }
  let sawTimeSignature = false

  const partEls = Array.from(doc.querySelectorAll('score-partwise > part'))
  if (partEls.length === 0) throw new Error('This MusicXML has no parts in it.')

  const parts: ScorePart[] = partEls.map((partEl, partIdx) => {
    const id = partEl.getAttribute('id') ?? `P${partIdx + 1}`
    const measures: ScoreMeasure[] = []

    // Carried ACROSS measures — MusicXML states these only when they change.
    let divisions = DEFAULT_DIVISIONS
    let sawDivisions = false
    let beats = 4, beatType = 4
    // Absolute position of the measure start, in quarter notes.
    let measureStart = 0

    const measureEls = Array.from(partEl.children).filter(c => c.nodeName === 'measure')

    measureEls.forEach((mEl, measureIndex) => {
      // `number` is a STRING by spec ('0' pickup, '8a' repeat ending). Keep it verbatim.
      const number = mEl.getAttribute('number') ?? ''
      const implicit = mEl.getAttribute('implicit') === 'yes'

      const notes: ScoreNote[] = []
      // The measure-local cursor, in DIVISIONS. <backup>/<forward> move it; <chord/> rewinds it.
      let cursor = 0
      let lastOnset = 0          // onset of the previous note, for <chord/>
      let lastDuration = 0
      let maxCursor = 0

      for (const el of Array.from(mEl.children)) {
        switch (el.nodeName) {
          case 'attributes': {
            const d = el.querySelector('divisions')
            if (d) {
              const v = num(d, DEFAULT_DIVISIONS)
              if (v > 0) { divisions = v; sawDivisions = true }
            }
            const t = el.querySelector('time')
            if (t) {
              beats = num(t.querySelector('beats'), beats)
              beatType = num(t.querySelector('beat-type'), beatType)
              if (partIdx === 0 && !sawTimeSignature) {
                timeSignature = { beats, beatType }
                sawTimeSignature = true
              }
            }
            break
          }
          // Tempo lives on <sound tempo="…">, either nested in a <direction> or bare in the measure.
          // Only the first part contributes: a tempo change is a property of the score, and every
          // part restates it, so reading them all would stack duplicates at the same onset.
          case 'direction':
          case 'sound': {
            if (partIdx !== 0) break
            const sound = el.nodeName === 'sound' ? el : el.querySelector('sound[tempo]')
            const bpm = parseFloat(sound?.getAttribute('tempo') ?? '')
            if (Number.isFinite(bpm) && bpm > 0) {
              tempos.push({ onsetQuarters: measureStart + cursor / divisions, bpm })
            }
            break
          }
          case 'backup': {
            cursor -= num(el.querySelector('duration'), 0)
            if (cursor < 0) cursor = 0
            break
          }
          case 'forward': {
            cursor += num(el.querySelector('duration'), 0)
            break
          }
          case 'note': {
            const isChord = !!el.querySelector(':scope > chord')
            const isGrace = !!el.querySelector(':scope > grace')
            const durTicks = num(el.querySelector(':scope > duration'), 0)

            // Grace notes carry no <duration> and must not advance the cursor. Playing them would
            // need an ornament model we don't have; skip, but say so rather than silently drop.
            if (isGrace) {
              if (!warnings.includes(GRACE_WARNING)) warnings.push(GRACE_WARNING)
              break
            }

            const onsetTicks = isChord ? lastOnset : cursor
            const pitchEl = el.querySelector(':scope > pitch')
            const isRest = !!el.querySelector(':scope > rest')

            let pitch: Pitch | null = null
            if (pitchEl && !isRest) {
              const step = text(pitchEl.querySelector('step'))
              const octave = num(pitchEl.querySelector('octave'), 4)
              const alter = num(pitchEl.querySelector('alter'), 0)
              pitch = { step, alter, octave, midi: midiOf(step, alter, octave) }
            }

            const voice = text(el.querySelector(':scope > voice')) || '1'
            const staff = num(el.querySelector(':scope > staff'), 1)

            notes.push({
              id: `${id}:${measureIndex}:${notes.length}`,
              onsetQuarters: measureStart + onsetTicks / divisions,
              durationQuarters: durTicks / divisions,
              pitch,
              voice,
              staff,
              measureIndex,
            })

            if (!isChord) {
              lastOnset = cursor
              cursor += durTicks
            } else {
              // A chord member's duration still defines the chord's length.
              lastOnset = onsetTicks
            }
            lastDuration = durTicks
            maxCursor = Math.max(maxCursor, cursor)
            break
          }
          default:
            break
        }
      }
      void lastDuration

      // The measure's nominal length comes from the time signature, not from how full it is —
      // an under-filled pickup bar is still followed by a bar starting on the downbeat.
      const nominal = (beats * 4) / beatType
      // ...but never let a nominal length swallow a measure that actually contains more (bad export,
      // or a cadenza bar). Trust the content when it exceeds the signature.
      const actual = maxCursor / divisions
      const durationQuarters = implicit ? actual : Math.max(nominal, actual)

      measures.push({
        index: measureIndex,
        number,
        implicit,
        onsetQuarters: measureStart,
        durationQuarters,
        notes,
      })
      measureStart += durationQuarters
    })

    if (!sawDivisions && measures.some(m => m.notes.length > 0)) {
      warnings.push(`Part "${partNames.get(id) ?? id}" never declared <divisions>; assuming ${DEFAULT_DIVISIONS} per quarter note.`)
    }

    return { id, name: partNames.get(id) ?? id, measures }
  })

  // A score with no tempo at all still has to play: MusicXML's own convention is quarter = 120.
  if (!tempos.some(t => t.onsetQuarters === 0)) {
    tempos.unshift({ onsetQuarters: 0, bpm: DEFAULT_BPM })
  }
  tempos.sort((a, b) => a.onsetQuarters - b.onsetQuarters)

  const measureCount = parts.reduce((n, p) => Math.max(n, p.measures.length), 0)
  if (measureCount === 0) throw new Error('This MusicXML has no measures in it.')

  // Repeats/voltas are RENDERED by OSMD but not unfolded for playback yet — the synth plays straight
  // through. Say so; a student comparing the cursor to a recording would otherwise think it drifted.
  if (doc.querySelector('repeat, ending')) {
    warnings.push('This score has repeats. The notation shows them, but playback goes straight through without repeating.')
  }

  const score: Score = { title, composer, parts, tempos, timeSignature, measureCount, warnings }
  mergeTies(doc, score)
  return score
}

const GRACE_WARNING = 'This score has grace notes. They’re shown in the notation but aren’t played.'

/**
 * Merge tied notes so a tie sounds as ONE note (§B3's "the cursor follows the synth precisely" needs
 * the played event to match what the eye reads as a single sustained note).
 *
 * We walk `<tie type="start">` → the next same-pitch note in the same voice carrying `type="stop"`,
 * extend the first, and drop the second from playback.
 */
function mergeTies(doc: Document, score: Score): void {
  // Build a lookup from our generated note ids back to the XML notes, in document order per part.
  for (const [partIdx, partEl] of Array.from(doc.querySelectorAll('score-partwise > part')).entries()) {
    const part = score.parts[partIdx]
    if (!part) continue
    const measureEls = Array.from(partEl.children).filter(c => c.nodeName === 'measure')

    // Flatten (measureIndex, noteIndexWithinMeasure) → the XML element, skipping graces exactly as
    // the parser did, so the indices line up with ScoreNote.id.
    const flat: { el: Element; note: ScoreNote }[] = []
    measureEls.forEach((mEl, mi) => {
      const measure = part.measures[mi]
      if (!measure) return
      let n = 0
      for (const el of Array.from(mEl.children)) {
        if (el.nodeName !== 'note') continue
        if (el.querySelector(':scope > grace')) continue
        const note = measure.notes[n]
        if (note) flat.push({ el, note })
        n++
      }
    })

    const dropped = new Set<string>()
    for (let i = 0; i < flat.length; i++) {
      const { el, note } = flat[i]
      if (dropped.has(note.id)) continue
      if (!el.querySelector(':scope > tie[type="start"]')) continue
      if (!note.pitch) continue

      // Follow the chain: start → stop(→ start) → stop …
      let current = note
      for (let j = i + 1; j < flat.length; j++) {
        const next = flat[j]
        if (dropped.has(next.note.id)) continue
        if (!next.note.pitch) continue
        if (next.note.pitch.midi !== current.pitch?.midi) continue
        if (next.note.voice !== current.voice) continue
        if (!next.el.querySelector(':scope > tie[type="stop"]')) continue

        current.durationQuarters = (next.note.onsetQuarters + next.note.durationQuarters) - note.onsetQuarters
        dropped.add(next.note.id)
        // Keep going only if this note ALSO starts a further tie.
        if (!next.el.querySelector(':scope > tie[type="start"]')) break
        current = next.note
      }
    }

    if (dropped.size > 0) {
      for (const measure of part.measures) {
        measure.notes = measure.notes.filter(n => !dropped.has(n.id))
      }
    }
  }
}

/**
 * Map a PRINTED bar number to its 0-based index, using this score's own numbering.
 *
 * Returns every match. Printed numbers are NOT guaranteed unique (repeat endings write '8a'/'8b';
 * multi-movement files restart at 1), so an ambiguous reference must be reported, not silently
 * resolved to the first hit — that is how an excerpt would quietly render the wrong bars.
 */
export function indicesOfPrintedBar(score: Score, printed: string, partIndex = 0): number[] {
  const part = score.parts[partIndex]
  if (!part) return []
  return part.measures.filter(m => m.number === printed).map(m => m.index)
}

/** The printed bar numbers of a part, in order — the vocabulary a writer can cite. */
export function printedBars(score: Score, partIndex = 0): string[] {
  return score.parts[partIndex]?.measures.map(m => m.number) ?? []
}
