// Compile + the content tick-box. The tests that matter here are the ones about what does NOT
// go into the payload — a leak is invisible from inside the app.

import { describe, expect, it } from 'vitest'
import { compileData, compilePayload } from './compile'
import { fixedPrompt, headerLine } from './prompt'
import { DEMO_TEXT, fixtureWindow } from '../fixtures'
import type { SessionRow } from '../types'

// ─── THE ALLOW-LIST PROPERTY (§A7.3) ─────────────────────────────────────────────────────────────
// These replace `ledger.test.ts`'s `stripPrivateFields` suite, deleted 2026-07-17 with the
// deny-list it tested: that mechanism had ZERO non-test callers, so its green suite proved only
// that a function nobody called did what it said. The property it GESTURED at is real and is
// enforced by this module's allow-list — so it is pinned HERE, against the live mechanism, and
// pinned STRONGER: the deny-list could only ever protect the two fields someone remembered to name.
describe('the payload is an ALLOW-LIST — a field nobody foresaw cannot ride out', () => {
  const NOTE = 'Finally got the third step of the argument down.'

  /** A row carrying BOTH the known prose fields and an unforeseen one. */
  function rowWithSurprise(): SessionRow {
    return {
      ...fixtureWindow('daily').sessions[0],
      note: NOTE,
      place: 'library',
      // The field the ledger "gains tomorrow". Typed as the schema does not know it, which is
      // exactly the point: no deny-list can name it, and the allow-list does not have to.
      mood_journal: 'anxious about the deadline, wrote anyway',
      device_name: "Peter's MacBook",
    } as unknown as SessionRow
  }

  it('omits an unforeseen prose field at every window, even with tier 2 ON', () => {
    for (const window of ['daily', 'weekly', 'monthly'] as const) {
      const agg = { ...fixtureWindow(window), sessions: [rowWithSurprise()] }
      // includeNotes: true is the MOST permissive tier-2 state — if anything leaks, it leaks here.
      const { data } = compileData({ agg, includeNotes: true })
      expect(data).not.toContain('anxious about the deadline')
      expect(data).not.toContain("Peter's MacBook")
      expect(data).not.toContain('mood_journal')
      expect(data).not.toContain('device_name')
    }
  })

  it('KNOWN-POSITIVE: the same payload DOES carry what the writer opted into', () => {
    // Without this, the assertions above would pass on an empty payload — i.e. on a broken
    // compileData — and prove nothing at all.
    const agg = { ...fixtureWindow('daily'), sessions: [rowWithSurprise()] }
    const { data, notesIncluded } = compileData({ agg, includeNotes: true })
    expect(notesIncluded).toBe(true)
    expect(data).toContain(NOTE)      // the opted-in note arrives...
    expect(data).toContain('library') // ...and the opted-in place
  })
})

describe('§A7.3 — the content tick-box', () => {
  const weekly = fixtureWindow('weekly')

  it('sends metadata only by default — no tick, no text', () => {
    const { data, includedDocIds } = compileData({ agg: weekly })
    expect(includedDocIds).toEqual([])
    expect(data).not.toContain(DEMO_TEXT['doc-essay'])
    expect(data).not.toContain(DEMO_TEXT['doc-journal'])
    expect(data).not.toContain('DOCUMENT TEXT')
    // ...but the metadata IS there: how you worked is always included.
    expect(data).toContain('Seminar paper draft')
    expect(data).toContain('metadata only')
  })

  it('is PER-DOCUMENT: the ticked essay goes, the unticked journal stays', () => {
    const { data } = compileData({
      agg: weekly, contentDocIds: ['doc-essay'], contentText: DEMO_TEXT,
    })
    expect(data).toContain(DEMO_TEXT['doc-essay'])
    expect(data).not.toContain(DEMO_TEXT['doc-journal'])
    expect(data).not.toContain(DEMO_TEXT['doc-mail'])
  })

  it('never includes text for a doc outside the window, even if it is ticked', () => {
    const { data, includedDocIds } = compileData({
      agg: weekly,
      contentDocIds: ['doc-essay', 'doc-not-in-window'],
      contentText: { ...DEMO_TEXT, 'doc-not-in-window': 'SECRET TEXT THAT MUST NOT TRAVEL' },
    })
    expect(includedDocIds).toEqual(['doc-essay'])
    expect(data).not.toContain('SECRET TEXT THAT MUST NOT TRAVEL')
  })

  it('never includes text the caller did not supply, and does not substitute other text', () => {
    const { data } = compileData({ agg: weekly, contentDocIds: ['doc-essay'], contentText: {} })
    expect(data).toContain('(this document has no text)')
    expect(data).not.toContain(DEMO_TEXT['doc-journal'])
  })
})

describe('tier 2 — the writer\'s diary notes and place labels', () => {
  const daily = fixtureWindow('daily')
  const weekly = fixtureWindow('weekly')
  const NOTE = 'Finally got the third step of the argument down.'
  const TIRED = 'Tired by the end of this one.'

  it('sends NOTHING of them by default — this is the leak test', () => {
    for (const agg of [daily, weekly, fixtureWindow('monthly')]) {
      const { data, notesIncluded } = compileData({ agg })
      expect(notesIncluded).toBe(false)
      expect(data).not.toContain(NOTE)
      expect(data).not.toContain(TIRED)
      expect(data).not.toContain('library')       // the place label the writer typed
      expect(data).not.toContain('THE WRITER\'S OWN NOTES')
    }
  })

  it('is not implied by the content tick — the two tiers are independent', () => {
    const { data, notesIncluded } = compileData({
      agg: daily, contentDocIds: ['doc-essay'], contentText: DEMO_TEXT,
    })
    expect(notesIncluded).toBe(false)
    expect(data).toContain(DEMO_TEXT['doc-essay'])   // tier 3 on...
    expect(data).not.toContain(NOTE)                 // ...tier 2 still off
    expect(data).not.toContain('library')
  })

  it('sends them — and only them — on an explicit opt-in', () => {
    const { data, notesIncluded } = compileData({ agg: daily, includeNotes: true })
    expect(notesIncluded).toBe(true)
    expect(data).toContain(NOTE)
    expect(data).toContain('library')
    expect(data).toContain('THE WRITER\'S OWN NOTES')
    expect(data).not.toContain(DEMO_TEXT['doc-essay'])   // tier 3 stays off
  })

  it('carries notes at weekly WITHOUT turning the payload into raw session logs', () => {
    const { data } = compileData({ agg: weekly, includeNotes: true })
    expect(data).toContain(NOTE)
    // The measured data is still day rollups only — no SESSIONS table (§A3.3).
    expect(data).not.toContain('SESSIONS\n')
    expect(data).not.toContain('words_start')
  })

  it('omits the section entirely when the writer has written no notes', () => {
    const bare = {
      ...daily,
      sessions: daily.sessions.map(s => ({ ...s, note: undefined, place: undefined })),
    }
    const { data, notesIncluded } = compileData({ agg: bare, includeNotes: true })
    expect(notesIncluded).toBe(false)
    expect(data).not.toContain('THE WRITER\'S OWN NOTES')
  })

  it('the fixed prompt only mentions the notes when they are actually there', () => {
    expect(fixedPrompt({ window: 'daily', contentIncluded: false })).not.toContain('THE WRITER\'S NOTES')
    const p = fixedPrompt({ window: 'daily', contentIncluded: false, notesIncluded: true })
    expect(p).toContain('THE WRITER\'S NOTES')
    expect(p).toMatch(/Do not grade a note/i)
    // §C1.4 — the prompt must not describe the place label as anything but a typed word.
    expect(p).toMatch(/not read a place label as anything more than a word they typed/i)
  })

  it('the allow-list holds: a new ledger field cannot leak by riding along', () => {
    // A field nobody has chosen a consent tier for yet. compileData names every field it emits,
    // so an unknown one is simply never written — the failure mode is silence, not disclosure.
    const withSecret = {
      ...daily,
      sessions: daily.sessions.map(s => ({ ...s, mood_rating: 'MUST NOT TRAVEL' })),
    }
    const { data } = compileData({ agg: withSecret, includeNotes: true })
    expect(data).not.toContain('MUST NOT TRAVEL')
    expect(data).not.toContain('mood_rating')
  })
})

describe('§A3.3 — compact rollups, not raw logs', () => {
  it('sends day rollups and NO session rows for a weekly window', () => {
    const { data } = compileData({ agg: fixtureWindow('weekly') })
    expect(data).toContain('DAYS')
    expect(data).not.toContain('SESSIONS')
    expect(data).not.toContain('s-1')
  })

  it('sends session rows for a daily window, whose judged rows are per-session', () => {
    const { data } = compileData({ agg: fixtureWindow('daily') })
    expect(data).toContain('SESSIONS')
    expect(data).toContain('s-1')
  })

  it('keeps a month from blowing up: monthly is not bigger than weekly per day', () => {
    const week = compileData({ agg: fixtureWindow('weekly') }).data
    const month = compileData({ agg: fixtureWindow('monthly') }).data
    // Same rollup shape → the month costs no raw-log tail.
    expect(month.includes('SESSIONS')).toBe(false)
    expect(Math.abs(month.length - week.length)).toBeLessThan(200)
  })

  it('omits empty hours instead of sending a 24-column histogram of zeros', () => {
    const { data } = compileData({ agg: fixtureWindow('weekly') })
    expect(data).toContain('09h 45m')
    expect(data).toContain('no active minutes recorded')   // the empty day, shown honestly
  })
})

describe('§A7.1.2 — the transparent prompt', () => {
  it('shows the writer the SAME fixed half it copies', () => {
    const p = compilePayload({ agg: fixtureWindow('weekly'), userPrompt: 'be brief' })
    expect(p.text).toContain(p.fixed)
    expect(p.fixed).toBe(fixedPrompt({ window: 'weekly', contentIncluded: false }))
  })

  it('puts the user half after the fixed half, and the data last', () => {
    const p = compilePayload({ agg: fixtureWindow('weekly'), userPrompt: 'Write it as a limerick.' })
    expect(p.text.indexOf('WHAT THE WRITER ASKED FOR')).toBeGreaterThan(p.text.indexOf('HOW TO REPLY'))
    expect(p.text.indexOf('Write it as a limerick.')).toBeLessThan(p.text.indexOf('DATA — measured'))
    // ...and says which wins, so a user prompt can't quietly override the honesty rules.
    expect(p.text).toContain('the rules above win')
  })

  it('omits the user section entirely when there is no user prompt', () => {
    const p = compilePayload({ agg: fixtureWindow('weekly'), userPrompt: '   ' })
    expect(p.text).not.toContain('WHAT THE WRITER ASKED FOR')
  })

  it('asks for the exact header the validator demands — the contract cannot drift', () => {
    for (const w of ['daily', 'weekly', 'monthly'] as const) {
      expect(fixedPrompt({ window: w, contentIncluded: false })).toContain(headerLine(w))
    }
  })

  it('adds the document-text section only when content is included', () => {
    expect(fixedPrompt({ window: 'daily', contentIncluded: false })).not.toContain('DOCUMENT TEXT')
    expect(fixedPrompt({ window: 'daily', contentIncluded: true })).toContain('DOCUMENT TEXT')
  })
})

describe('§A6.2 / §A5 — what the fixed prompt commits to', () => {
  it('forbids cause and pattern claims on the daily window', () => {
    const p = fixedPrompt({ window: 'daily', contentIncluded: false })
    expect(p).toContain('SINGLE DAY')
    expect(p).toContain('describe, do not explain')
    expect(p).toMatch(/do not claim that anything caused/i)
  })

  it('permits pattern claims at weekly and monthly', () => {
    for (const w of ['weekly', 'monthly'] as const) {
      const p = fixedPrompt({ window: w, contentIncluded: false })
      expect(p).toMatch(/enough sessions to support genuine pattern claims/i)
      expect(p).not.toContain('SINGLE DAY')
    }
  })

  // The prompt is hard-wrapped for legibility, so these read it with newlines flattened: the
  // assertion is about what it COMMITS TO, not where the lines happen to break.
  const flat = (w: 'daily' | 'weekly' | 'monthly', notesIncluded = false) =>
    fixedPrompt({ window: w, contentIncluded: false, notesIncluded }).replace(/\s+/g, ' ')

  it('states the kind, non-shaming rule as a rule, in every window', () => {
    for (const w of ['daily', 'weekly', 'monthly'] as const) {
      const p = flat(w)
      expect(p).toContain('a hard rule, not a preference')
      expect(p).toMatch(/never as a scolding/i)
      expect(p).toMatch(/do not score, rank or grade the writer/i)
      expect(p).toMatch(/a low-output day is a lighter day/i)
      expect(p).toMatch(/thinking-heavy days with few words are real work/i)
      // The vocabulary of productivity guilt is named explicitly, not gestured at.
      expect(p).toMatch(/"only", "just", "failed to", "should have", "fell short"/i)
    }
  })

  it('tells the model not to hand measured numbers back', () => {
    const p = flat('weekly')
    expect(p).toMatch(/Do not put any measured number in the CSV/i)
    expect(p).toMatch(/recompute, total, average, round, tidy or estimate/i)
    expect(p).toMatch(/use a number only if it appears verbatim in the data/i)
  })
})
