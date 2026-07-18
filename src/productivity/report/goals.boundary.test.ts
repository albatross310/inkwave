// §A5b + §A7.3 — THE CONSENT BOUNDARY, PROVED BOTH WAYS.
//
// This file exists to answer ONE question: can a thing the writer did not tick reach the AI?
// Everything here is a negative, and CLAUDE.md's standing warning (round 12: "any cell whose PASS
// condition is satisfiable by the mechanism that disables the feature is not a control") is the
// whole design constraint. `expect(text).not.toContain('library')` passes on an empty string, on a
// thrown compile, on a renamed fixture, and on a payload that never had a place in it to begin
// with. So EVERY negative below is PAIRED with the positive arm that proves the same string CAN
// arrive through the same call — and the pairs are asserted to differ.
//
// The two tiers pinned here fail in DIFFERENT ways, which is why they are both here:
//   • PLACES (tier 2b) are gated STRUCTURALLY, at the read (`noteLines(agg, wantNotes, wantPlaces)`):
//     the label is never put into a line, so there is no downstream surface to leak from.
//   • GOALS (tier 2c) are gated at the CALLER — compile includes whatever `opts.goals` it is handed.
//     That is a real asymmetry and it is named, not glossed: the test suite pins the property that
//     is actually enforceable here (nothing arrives unless it is passed) and the window filter.
//
// Tested through `compilePayload` — the WHOLE payload text, prompt included — not `compileData`.
// The prompt is what the model reads, and a leak into the fixed prompt's own prose would be
// invisible to a data-only assertion.

import { describe, expect, it } from 'vitest'
import { compilePayload } from './compile'
import { fixtureWindow } from '../fixtures'
import type { WindowAggregate } from '../types'
import type { DocGoals } from '../../types/document'

// Distinctive strings. A fixture value that also occurs in the prompt's own prose ("library" nearly
// does) would make `not.toContain` unreadable — the excerpts probe hit exactly that (CLAUDE.md:
// "every section heading appears TWICE"), so these cannot collide with English.
const PLACE = 'Zetland-Annexe-Reading-Room'
const NOTE = 'Untangled the Leibniz footnote at last, Qwerty-Marker.'
const GOAL = 'Ship chapter three to my supervisor, Xanadu-Milestone.'
const PLAN = 'Draft ugly, cut hard, Plangent-Placeholder.'

/** A daily window whose single session carries BOTH prose fields. */
function daily(): WindowAggregate {
  const base = fixtureWindow('daily')
  return {
    ...base,
    sessions: [{ ...base.sessions[0], note: NOTE, place: PLACE }],
    note_digest: [{ day: base.days[0]?.day ?? '2026-07-06', notes: [NOTE], places: [PLACE] }],
  }
}

/** The goals map the caller passes when — and only when — the goals tick is on. */
function goalsFor(agg: WindowAggregate): Record<string, DocGoals> {
  return { [agg.docs[0].doc_id]: { goal: GOAL, plan: PLAN, updatedAt: '2026-07-06T09:00:00+10:00' } }
}

// ─── TIER 2b — THE PLACE LABEL ────────────────────────────────────────────────────────────────

describe('§A7.3 tier 2b — a place label cannot reach the AI with the tick OFF', () => {
  it('DEFAULT (no options at all): the place is absent from the whole payload', () => {
    // The default matters more than any explicit `false`: it is what every caller gets by
    // forgetting. `includePlaces` is not passed here AT ALL.
    const { text, placesIncluded } = compilePayload({ agg: daily() })
    expect(placesIncluded).toBe(false)
    expect(text).not.toContain(PLACE)
  })

  it('EXPLICIT false, and with every OTHER tick ON — the place still cannot ride out', () => {
    // The adversarial case: a leak is likeliest where a neighbouring tier builds the same lines.
    // Notes ON + content ON + goals ON is the most permissive state the panel can produce.
    const agg = daily()
    const { text, placesIncluded, notesIncluded } = compilePayload({
      agg,
      includeNotes: true,
      includePlaces: false,
      contentDocIds: [agg.docs[0].doc_id],
      contentText: { [agg.docs[0].doc_id]: 'the document text' },
      goals: goalsFor(agg),
    })
    expect(placesIncluded).toBe(false)
    expect(notesIncluded).toBe(true)         // the neighbour IS on — so the lines were built...
    expect(text).toContain(NOTE)             // ...and carried the note...
    expect(text).not.toContain(PLACE)        // ...without the place riding along in the same row.
  })

  it('KNOWN-POSITIVE: the SAME call with the tick ON does carry the place', () => {
    // Without this arm the two tests above are decoration: they would pass identically against a
    // compilePayload that returned '' forever, or against a fixture whose place was never set.
    const { text, placesIncluded } = compilePayload({ agg: daily(), includePlaces: true })
    expect(placesIncluded).toBe(true)
    expect(text).toContain(PLACE)
  })

  it('the payload STATES the absence, so the model cannot invent a place', () => {
    // The structural half stops the leak; this half stops the fabrication. A model told nothing
    // about where someone worked will fill the gap — and "you write best in cafés" would then be a
    // claim WE invented (§A6.1). CLAUDE.md: "a model told only what it HAS will fill the gap".
    const { text } = compilePayload({ agg: daily(), includeNotes: true })
    expect(text).toContain('did NOT share their place labels')
  })

  it('at WEEKLY the digest carrier is gated too — the tier does not reopen off the daily path', () => {
    // `sessions: []` at weekly+ (§A6.4), so places travel via `note_digest` instead. That is a
    // SECOND carrier, and a second carrier is exactly where a gate gets applied once and forgotten.
    const base = fixtureWindow('weekly')
    const week: WindowAggregate = {
      ...base,
      sessions: [],
      note_digest: [{ day: '2026-07-06', notes: [NOTE], places: [PLACE] }],
    }
    const off = compilePayload({ agg: week, includeNotes: true })
    expect(off.text).toContain(NOTE)         // the note arrives through the digest...
    expect(off.text).not.toContain(PLACE)    // ...and the place does not.
    // The positive arm on the SAME carrier, or the line above proves only that weekly is broken.
    const on = compilePayload({ agg: week, includePlaces: true })
    expect(on.text).toContain(PLACE)
  })
})

// ─── TIER 2c — THE GOALS (§A5b) ───────────────────────────────────────────────────────────────

describe('§A5b tier 2c — goals reach the AI only on their own tick', () => {
  it('with no goals passed, NOTHING of the writer\'s intent is in the payload', () => {
    const { text, goalsIncluded } = compilePayload({ agg: daily() })
    expect(goalsIncluded).toBe(false)
    expect(text).not.toContain(GOAL)
    expect(text).not.toContain(PLAN)
  })

  it('the goals tick is INDEPENDENT of the notes and places ticks', () => {
    // Peter split these deliberately. A goal is the writer's intent; a note is their diary; a place
    // is where they sat. Three disclosures, three decisions — so ticking notes must not smuggle in
    // a goal, which is what a shared boolean would do the day someone "simplified" the options.
    const agg = daily()
    const notesOnly = compilePayload({ agg, includeNotes: true, includePlaces: true })
    expect(notesOnly.goalsIncluded).toBe(false)
    expect(notesOnly.text).not.toContain(GOAL)

    const goalsOnly = compilePayload({ agg, goals: goalsFor(agg) })
    expect(goalsOnly.goalsIncluded).toBe(true)
    expect(goalsOnly.text).toContain(GOAL)
    expect(goalsOnly.text).not.toContain(NOTE)   // ...and the diary stays home.
    expect(goalsOnly.text).not.toContain(PLACE)
  })

  it('KNOWN-POSITIVE: goal AND plan arrive verbatim, unparaphrased', () => {
    // Verbatim is load-bearing, not stylistic: §A5's reversed tone is legitimate ONLY because the
    // model quotes the writer's own standard back. A goal we summarised is no longer theirs, and
    // holding someone to a paraphrase is the imposed standard §A5b bans.
    const agg = daily()
    const { text, goalsIncluded } = compilePayload({ agg, goals: goalsFor(agg) })
    expect(goalsIncluded).toBe(true)
    expect(text).toContain(GOAL)
    expect(text).toContain(PLAN)
  })

  it('a goal for a document OUTSIDE the window never travels', () => {
    // The stale-tick case: the panel holds a goals map keyed by doc id, and the writer is looking
    // at one week. A goal belonging to a document they did not touch is not evidence about this
    // window — and it is a disclosure they made for a different screen.
    const agg = daily()
    const { text, goalsIncluded } = compilePayload({
      agg,
      goals: { 'doc-not-in-this-window': { goal: GOAL, plan: PLAN } },
    })
    expect(goalsIncluded).toBe(false)
    expect(text).not.toContain(GOAL)
  })

  it('NO GOALS ⇒ the prompt tells the model it has no standard to measure against', () => {
    // §A5b's honesty boundary, and the half that cannot be structural: the goal text is genuinely
    // absent, but absence alone is what a model FILLS. This is the instruction that stops it.
    const { text } = compilePayload({ agg: daily() })
    expect(text).toContain('NO GOALS WERE SHARED')
    expect(text).toContain('DESCRIBE, DO NOT PUSH')
  })

  it('WITH goals, the no-standard branch is GONE — the two are mutually exclusive', () => {
    // Both branches shipping at once would tell the model to hold them to a goal and, four lines
    // later, that it has no standard. The negative above cannot see that; this one can.
    const agg = daily()
    const { text } = compilePayload({ agg, goals: goalsFor(agg) })
    expect(text).not.toContain('NO GOALS WERE SHARED')
    expect(text).not.toContain('DESCRIBE, DO NOT PUSH')
    expect(text).toContain('WHAT THE WRITER SAID THEY WERE DOING')
  })
})

// ─── §A5b — THE DATED TIMELINE (the "kick up the butt") ────────────────────────────────────────
// The milestones were authored (GoalsSection) and stored on the document, then SILENTLY DROPPED in
// compile.ts's goalsSection before the model ever saw them — so the report could not hold the writer
// to a single deadline. These pin that the milestone TEXT and Inkwave's OWN verdict (§A6.4 — never
// two dates for the model to compare) reach the payload. Break the emission and the text vanishes.

const M_MISSED = 'Finish-the-lit-review-Frobnitz'
const M_UPCOMING = 'Draft-chapter-two-Grumbo'
const M_MET = 'Outline-done-Wibble'

/** A goal carrying three milestones whose verdicts are DETERMINISTIC regardless of the run day:
 *  a long-past undated-done one (MISSED), a far-future one (not yet due), and a done-before-due one. */
function goalsWithTimeline(agg: WindowAggregate): Record<string, DocGoals> {
  return {
    [agg.docs[0].doc_id]: {
      goal: GOAL,
      milestones: [
        { id: 'm1', text: M_MISSED, due: '2020-01-01' },                                     // past, not done ⇒ MISSED
        { id: 'm2', text: M_UPCOMING, due: '2099-12-31' },                                    // far future ⇒ not yet due
        { id: 'm3', text: M_MET, due: '2099-12-31', done_at: '2026-07-06T09:00:00+10:00' },   // done before due ⇒ MET
      ],
    },
  }
}

describe('§A5b — the dated timeline reaches the model as text + Inkwave\'s verdict', () => {
  it('carries every milestone\'s text (the silent drop was the bug)', () => {
    const agg = daily()
    const { text, goalsIncluded } = compilePayload({ agg, goals: goalsWithTimeline(agg) })
    expect(goalsIncluded).toBe(true)
    expect(text).toContain(M_MISSED)
    expect(text).toContain(M_UPCOMING)
    expect(text).toContain(M_MET)
  })

  it('hands the model a COMPUTED verdict, not two dates to judge (§A6.4)', () => {
    const agg = daily()
    const { text } = compilePayload({ agg, goals: goalsWithTimeline(agg) })
    expect(text).toContain('MISSED')
    expect(text).toContain('not yet due')
    expect(text).toContain('MET')
    // ...and it tells the model the verdict is Inkwave's, so it reports rather than recomputes.
    expect(text).toMatch(/Inkwave computed each verdict/i)
  })

  it('KNOWN-NEGATIVE: a goal with NO milestones carries no timeline block', () => {
    // Proves the assertions above are reading the milestones, not some always-present prose: the same
    // call with goal+plan and no milestones must NOT emit the MILESTONES block.
    const agg = daily()
    const { text } = compilePayload({ agg, goals: goalsFor(agg) })
    expect(text).not.toContain('MILESTONES (')
    expect(text).not.toContain(M_MISSED)
  })
})

// ─── THE PAIRS ARE REAL ───────────────────────────────────────────────────────────────────────

describe('the boundary discriminates — off and on are not the same payload', () => {
  it('every tick changes the payload it gates, and no tick changes another\'s', () => {
    // The suite's own validity check. If any pair below were identical, the corresponding negative
    // above would be passing by construction — the exact failure the round-12 probe shipped.
    const agg = daily()
    const off = compilePayload({ agg }).text
    const places = compilePayload({ agg, includePlaces: true }).text
    const notes = compilePayload({ agg, includeNotes: true }).text
    const goals = compilePayload({ agg, goals: goalsFor(agg) }).text

    for (const [name, on] of [['places', places], ['notes', notes], ['goals', goals]] as const) {
      expect(on, `${name}: the tick must CHANGE the payload`).not.toBe(off)
    }
    // ...and each carries only its own disclosure.
    expect(places).toContain(PLACE); expect(places).not.toContain(GOAL)
    expect(notes).toContain(NOTE); expect(notes).not.toContain(PLACE)
    expect(goals).toContain(GOAL); expect(goals).not.toContain(NOTE)
  })
})
