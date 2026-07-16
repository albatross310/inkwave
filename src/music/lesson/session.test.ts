import { describe, it, expect } from 'vitest'
import { LessonSession, startSession, SESSION_REDACTION } from './session'
import type { LessonConsent } from './types'

// §A3's guarantee, under test: "the raw transcript and the audio are deleted automatically; the
// student cannot save, export, or otherwise keep the verbatim transcript... there is provably no
// keepable recording of them."
//
// ─── THE TRAP THIS FILE IS BUILT AROUND, AND THE ONE IT ALMOST SHIPPED ───────────────────────
//
// "Assert the transcript is gone after end()" is the easiest vacuous pass in this repo's history.
// The first cut of this file scanned an ENDED session with `JSON.stringify` + a reflective walk,
// found nothing, and went green. THAT RESULT WAS WORTHLESS, and probing it is what caught it: the
// same scan finds nothing on a RUNNING session too, because `#lines` is a true private field —
// invisible to `stringify` (toJSON redacts) and absent from `Reflect.ownKeys`. Probed directly:
//
//     BEFORE end → stringify: {"_iw":"lesson-session","storable":false,…}   ← no transcript
//     BEFORE end → ownKeys:   [ 'id','piece_id','consent','source_id','started_at' ]
//     BEFORE end → liveLines: [ 'SENTINEL_ZQX' ]                            ← but it IS recording
//
// So the scanner scores an ended session and a live one IDENTICALLY, BY CONSTRUCTION — exactly the
// failure CLAUDE.md lists ("a known-negative scoring identically to the right answer BY
// CONSTRUCTION"). It cannot tell deletion from encapsulation, and read naively it would certify a
// deletion that never happened.
//
// So the two claims are separated, and each is tested by an instrument that can actually see it:
//
//   A. THE FIREBREAK (structures 2 + 1 in session.ts): the transcript is unreachable via
//      serialisation and reflection AT ALL TIMES — before end as much as after. This is the
//      STRONGER property and the one that protects against the accident (a stray stringify). Its
//      instrument is the scanner, and the scanner's positive control is `LeakySession`, which
//      proves it can see a transcript when one is reachable.
//   B. THE DELETION (structure 4): after end() the lines are dropped and every accessor is closed.
//      Its instrument is the session's OWN API — `liveLines()`, `append()`, `distil()` — which is
//      the only thing that can distinguish a live session from an ended one, and it is proved to
//      show the transcript BEFORE end so the emptiness after means something.
//
// A negative that cannot fail is not a negative; an instrument that cannot see the state it judges
// is worse, because it reports success.

const CONSENT: LessonConsent = {
  granted: true,
  granted_at: '2026-07-17T10:00:00+10:00',
  who: 'fixture teacher',
}

// Distinctive, and NOT English the code could produce by coincidence — a sentinel the thing under
// test could generate is not a sentinel.
const SENTINEL_A = 'zqxbarwatchthedynamicszqx'
const SENTINEL_B = 'zqxrelaxyourwristzqx'
const SENTINEL_KEPT = 'zqxstudentkeptthiszqx'

/**
 * THE ONE SCANNER both the real session and the known-negative are judged by. A negative proved on
 * a different code path proves nothing about the path that matters.
 *
 * It looks the way an ACCIDENT would look: `JSON.stringify` (what every OPFS write, cloud sync and
 * log line in this app actually calls) plus a reflective walk over own properties, recursively
 * (what a devtools dump, a structured clone, or a careless `{...session}` reaches — and what would
 * reach a TypeScript `private` field, which is not private at runtime at all).
 */
function scanForSentinels(value: unknown, sentinels: string[]): string[] {
  const found = new Set<string>()
  const seen = new WeakSet<object>()

  const text = (s: string) => {
    for (const sent of sentinels) if (s.includes(sent)) found.add(sent)
  }

  try {
    const json = JSON.stringify(value)
    if (typeof json === 'string') text(json)
  } catch { /* circular or unserialisable — the reflective walk still runs */ }

  const walk = (v: unknown): void => {
    if (typeof v === 'string') return text(v)
    if (!v || typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key === 'string') text(key)
      let child: unknown
      try {
        child = (v as Record<string | symbol, unknown>)[key]
      } catch { continue }
      walk(child)
    }
  }
  walk(value)

  return [...found]
}

/** Drive a real session up to (but not through) end(). Shared so every test records identically. */
function recordedSession(): LessonSession {
  const s = startSession({ piece_id: 'piece-1', consent: CONSENT })
  const a = s.append(SENTINEL_A)
  s.append(SENTINEL_B)
  // The student distils ONE line, in their own words — the §A3 workflow, and the reason the
  // "nothing survives" verdicts below are about a session that genuinely HAD a transcript.
  s.distil(a.id, { text: SENTINEL_KEPT, anchor: { bar: 24 } })
  return s
}

// ─── 0. Prove the instruments BEFORE reading any verdict ─────────────────────

/**
 * The known-negative for the SCANNER: the same shape built the way it would be if the structure
 * were "improved" away — the transcript in an ordinary property, no `toJSON` firebreak, and an
 * `end()` that flips a flag without dropping anything (the "we delete it on end" POLICY, faithfully
 * implemented, and useless).
 *
 * Not a strawman: it is the natural implementation, and it is what session.ts's structures exist to
 * rule out.
 */
class LeakySession {
  lines: { id: string; text: string }[] = []
  ended = false
  append(text: string) {
    const l = { id: String(this.lines.length), text }
    this.lines.push(l)
    return l
  }
  end() {
    this.ended = true // "deleted automatically" — the flag says so, the heap disagrees
  }
}

function leakyRecorded(): LeakySession {
  const s = new LeakySession()
  s.append(SENTINEL_A)
  s.append(SENTINEL_B)
  s.end()
  return s
}

describe('instrument A — the scanner FIRES on a reachable transcript', () => {
  it('catches a leaky session even after its end() claims deletion', () => {
    // If this fails, every "unreachable" verdict below is a scanner that sees nothing anywhere.
    const found = scanForSentinels(leakyRecorded(), [SENTINEL_A, SENTINEL_B])
    expect(found.sort()).toEqual([SENTINEL_A, SENTINEL_B].sort())
  })

  it('JSON.stringify of a leaky session spills the transcript', () => {
    expect(JSON.stringify(leakyRecorded())).toContain(SENTINEL_A)
  })

  it('finds nothing on an empty object (it is not simply always-true)', () => {
    expect(scanForSentinels({}, [SENTINEL_A, SENTINEL_B])).toEqual([])
  })

  it('THE LIMIT OF THIS INSTRUMENT, pinned: it cannot see a #private field', () => {
    // This is the assertion that documents why the scanner may NOT be used to prove deletion. A
    // LIVE session — transcript very much alive — scores exactly like an ended one. Anyone who
    // later "strengthens" the deletion test by scanning must read this first.
    const live = recordedSession()
    expect(live.liveLines()).toHaveLength(2)                                  // it IS recording
    expect(scanForSentinels(live, [SENTINEL_A, SENTINEL_B])).toEqual([])      // and the scan is blind
  })
})

describe('instrument B — the API can see the transcript before it is dropped', () => {
  it('liveLines() shows the recorded lines while the session runs', () => {
    // The trace behind every "it's empty after end" below: it was NOT empty before.
    expect(recordedSession().liveLines().map((l) => l.text)).toEqual([SENTINEL_A, SENTINEL_B])
  })

  it('liveLines() is empty on a session that never recorded (not always-non-empty)', () => {
    expect(startSession({ piece_id: 'p', consent: CONSENT }).liveLines()).toEqual([])
  })
})

// ─── 1. Claim A — the firebreak (holds at ALL times, stated as such) ─────────

describe('the transcript is unreachable by serialisation or reflection (§A3, structural)', () => {
  it('JSON.stringify emits a redaction marker on a LIVE session', () => {
    // The firebreak's real job: protect the mistake of serialising a live session — the only moment
    // a transcript exists to spill. Every writer in this app goes through toJSON.
    expect(JSON.parse(JSON.stringify(recordedSession()))).toEqual(SESSION_REDACTION)
  })

  it('JSON.stringify emits a redaction marker on an ENDED session', () => {
    const s = recordedSession()
    s.end()
    expect(JSON.parse(JSON.stringify(s))).toEqual(SESSION_REDACTION)
  })

  it('a spread/clone of a live session carries no transcript', () => {
    expect(scanForSentinels({ ...recordedSession() }, [SENTINEL_A, SENTINEL_B])).toEqual([])
  })

  it('the session exposes no accessor that returns the transcript as one value', () => {
    // §A3: the student "cannot save, export, or otherwise keep the verbatim transcript". There is
    // no bulk path — not by rule, by absence. This asserts the absence so adding one is a decision.
    const s = recordedSession()
    const surface = [
      ...Object.getOwnPropertyNames(LessonSession.prototype),
      ...Object.keys(s),
    ]
    for (const name of surface) {
      expect(name).not.toMatch(/^(export|save|download|toText|transcript|getAll|distilAll|selectAll)/i)
    }
  })
})

// ─── 2. Claim B — the deletion (proved through the API, which can see it) ────

describe('after end(), the raw transcript is gone (§A3)', () => {
  it('liveLines() empties — and it was full one line earlier', () => {
    const s = recordedSession()
    expect(s.liveLines()).toHaveLength(2)
    s.end()
    expect(s.liveLines()).toEqual([])
  })

  it('append() throws rather than silently no-oping', () => {
    // A source still pushing into a dead session is a real bug; a silent no-op is how it runs for
    // months unnoticed.
    const s = recordedSession()
    s.end()
    expect(() => s.append('anything')).toThrow(/ended/i)
  })

  it('distil() throws — there is nothing left to distil from', () => {
    const s = recordedSession()
    const lineId = s.liveLines()[0].id
    s.end()
    expect(() => s.distil(lineId)).toThrow(/ended/i)
  })

  it('ending twice is not an error (the postcondition is already true)', () => {
    const s = recordedSession()
    s.end()
    expect(() => s.end()).not.toThrow()
  })

  it('subscribers are flushed with [] and then dropped', () => {
    // A retained subscriber closure is how a "deleted" transcript stays alive in a heap.
    const s = startSession({ piece_id: 'piece-1', consent: CONSENT })
    const seen: number[] = []
    s.subscribe((lines) => seen.push(lines.length))
    s.append(SENTINEL_A)
    s.end()
    expect(seen).toEqual([0, 1, 0])
  })
})

// ─── 3. What DOES survive — and that it is only that ─────────────────────────

describe('only the student’s curated notes persist (§A3)', () => {
  it('the record carries the kept note, pinned to its bar', () => {
    const s = recordedSession()
    s.end()
    const rec = s.toRecord()
    expect(rec.lesson_notes).toHaveLength(1)
    expect(rec.lesson_notes[0].snippet).toBe(SENTINEL_KEPT)
    expect(rec.lesson_notes[0].anchor).toEqual({ bar: 24 })
    expect(rec.piece_id).toBe('piece-1')
  })

  it('the SERIALISED record contains the kept note and NOT the transcript', () => {
    // The record is the thing that actually reaches storage, so it is the thing to scan — and here
    // the scanner IS the right instrument, because a record is a plain object with nothing hidden.
    // This is the assertion that catches a future field quietly carrying a transcript along.
    const s = recordedSession()
    s.end()
    const json = JSON.stringify(s.toRecord())
    expect(json).toContain(SENTINEL_KEPT)
    expect(json).not.toContain(SENTINEL_A)
    expect(json).not.toContain(SENTINEL_B)
  })

  it('a record cannot be taken while the transcript still exists', () => {
    // The ordering IS the guarantee: no storable value is produced in a window where the raw
    // transcript is alive.
    expect(() => recordedSession().toRecord()).toThrow(/End the session/i)
  })

  it('the record has no transcript-shaped field at all', () => {
    const s = recordedSession()
    s.end()
    for (const k of Object.keys(s.toRecord())) {
      expect(k).not.toMatch(/transcript|audio|recording|raw/i)
    }
  })
})

// ─── 4. Consent is a precondition, not a step ────────────────────────────────

describe('consent first (§A3)', () => {
  it('a session cannot start unconsented', () => {
    expect(() =>
      startSession({ piece_id: 'p', consent: { granted: false, granted_at: 'x' } }),
    ).toThrow(/consent/i)
  })

  it('there is no window in which an unconsented session holds lines', () => {
    // The throw is in the CONSTRUCTOR, so the object never exists to append to.
    let s: LessonSession | null = null
    try {
      s = startSession({ piece_id: 'p', consent: { granted: false, granted_at: 'x' } })
    } catch { /* expected */ }
    expect(s).toBeNull()
  })

  it('a session must be attached to a Piece (organise-by-piece)', () => {
    expect(() => startSession({ piece_id: '', consent: CONSENT })).toThrow(/Piece/i)
  })

  it('the record states which source it ran on, and it defaults to no-audio', () => {
    const s = startSession({ piece_id: 'p', consent: CONSENT })
    s.end()
    expect(s.toRecord().source_id).toBe('no-audio')
  })

  it('an unregistered source is refused, not defaulted', () => {
    // A session that silently ran on a different pipeline than it recorded is the fiction this
    // module exists to prevent.
    expect(() =>
      startSession({ piece_id: 'p', consent: CONSENT, source_id: 'webkit-speech' }),
    ).toThrow(/Unknown speech source/i)
  })
})

// ─── 5. §A3b — the storable side of the line ─────────────────────────────────

describe('the recap is storable BECAUSE it was authored (§A3b)', () => {
  it('a recap and its assignments survive the session', () => {
    const s = startSession({ piece_id: 'p', consent: CONSENT })
    s.append(SENTINEL_A)
    s.setRecap('Good progress on the Chopin. Slow practice on the left hand.')
    s.addAssignment('youtube', 'https://www.youtube.com/watch?v=fixture', { bar: 24 })
    s.addAssignment('note', 'Hands separately, quarter = 60.')
    s.end()
    const rec = s.toRecord()
    expect(rec.recap?.summary).toMatch(/Good progress/)
    expect(rec.recap?.assignments).toHaveLength(2)
    expect(rec.recap?.assignments[0].due).toBe('next_week')
    expect(rec.recap?.assignments[0].anchor).toEqual({ bar: 24 })
    // The storable side must not have laundered the transcript into itself.
    expect(JSON.stringify(rec)).not.toContain(SENTINEL_A)
  })

  it('a "+"-only recap with no summary is DROPPED, not persisted half-made', () => {
    // "Everything stored was deliberately left" has to be literally true, including in the order
    // where the teacher adds a link then hands the device back without writing anything.
    const s = startSession({ piece_id: 'p', consent: CONSENT })
    s.addAssignment('note', 'stray')
    s.end()
    expect(s.toRecord().recap).toBeUndefined()
  })

  it('a recap cannot be set after the session ends', () => {
    const s = startSession({ piece_id: 'p', consent: CONSENT })
    s.end()
    expect(() => s.setRecap('too late')).toThrow(/ended/i)
  })

  it('an empty recap is refused', () => {
    const s = startSession({ piece_id: 'p', consent: CONSENT })
    expect(() => s.setRecap('   ')).toThrow(/empty/i)
  })
})
