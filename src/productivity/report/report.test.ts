// The whole round trip: compile → (a model replies) → paste → parse → merge → download.
//
// The replies below are the shapes a real model produces, including the bad ones.

import { describe, expect, it } from 'vitest'
import { compilePayload } from './compile'
import { parseReply } from './report'
import { toCsv, toMarkdown } from './download'
import { mergeReport, expectedKeys } from './merge'
import { fixtureWindow } from '../fixtures'

const weekly = fixtureWindow('weekly')
const payload = compilePayload({ agg: weekly }).text

const GOOD_REPLY = `## Narrative

A week with a real centre to it. Monday and Wednesday carried most of the writing, and you
spent 92 active minutes on the seminar paper on the first of them. Tuesday was short and
mostly cutting — 24 minutes, and the net went backwards, which is what restructuring looks
like. Thursday you didn't write, and Friday was a lighter, editing-shaped day.

Across the week you tended to do your adding early and your cutting late.

\`\`\`csv
day,phase,effort,momentum,character,note
2026-07-06,deep,steady,building,steady,"a full morning on the seminar paper"
2026-07-07,shallow,light,easing,grind,"a short evening, mostly cutting"
2026-07-08,deep,intense,building,breakthrough,the week's strongest stretch
2026-07-09,unclear,unclear,holding,away,a day away from it
2026-07-10,shallow,steady,easing,scattered,editing rather than drafting
\`\`\``

describe('the happy path', () => {
  const parsed = parseReply(GOOD_REPLY, { agg: weekly, payload })

  it('reads the table', () => {
    expect(parsed.judged.ok).toBe(true)
    expect(parsed.judged.issues).toHaveLength(0)
    expect(parsed.judged.rows).toHaveLength(5)
  })

  it('keeps the narrative and strips the table out of it', () => {
    expect(parsed.narrative).toContain('A week with a real centre')
    expect(parsed.narrative).not.toContain('day,phase,effort')
    expect(parsed.narrative).not.toContain('```')
  })

  it('merges measured and judged without mixing them', () => {
    const m = parsed.merged!
    expect(m.rows).toHaveLength(5)
    const mon = m.rows[0]
    expect(mon.key).toBe('2026-07-06')
    expect(mon.measured.active_minutes).toBe(92)      // MEASURED — from the fixture, untouched
    expect(mon.judged!.phase).toBe('deep')            // JUDGED — from the model, separate field
    expect(m.orphanJudged).toHaveLength(0)
  })

  it('does not run the daily causal check on a weekly report — patterns are legitimate there', () => {
    expect(parsed.causalClaims).toEqual([])           // despite "you tended to" in the narrative
  })

  it('confirms every number in the narrative against what was sent', () => {
    expect(parsed.unverifiedNumbers).toEqual([])
  })
})

describe('§A6.4 — the measured numbers are the fixture\'s, not the model\'s', () => {
  it('a model that lies about the numbers cannot change a single measured value', () => {
    const lying = GOOD_REPLY.replace('92 active minutes', '900 active minutes')
    const parsed = parseReply(lying, { agg: weekly, payload })
    // The lie is caught...
    expect(parsed.unverifiedNumbers).toContain('900')
    // ...and the measured data is untouched, because it never went anywhere to be changed.
    expect(parsed.merged!.rows[0].measured.active_minutes).toBe(92)
    expect(parsed.merged!.days.map(d => d.active_minutes)).toEqual([92, 24, 118, 0, 39])
  })

  it('the merged CSV keeps the two labelled apart', () => {
    const parsed = parseReply(GOOD_REPLY, { agg: weekly, payload })
    const csv = toCsv(parsed.merged!)
    const header = csv.split('\n')[0]
    expect(header).toContain('active_minutes')       // measured, plain
    expect(header).toContain('judged_phase')         // judged, prefixed
    expect(header).toContain('judged_note')
    expect(header).not.toContain('judged_active_minutes')
    expect(csv.split('\n')[1]).toContain('92')
  })

  it('an unjudged row exports as blank, never as zero', () => {
    const partial = GOOD_REPLY.replace(/2026-07-09,unclear,unclear,holding,away,a day away from it\n/, '')
    const parsed = parseReply(partial, { agg: weekly, payload })
    const row = toCsv(parsed.merged!).split('\n').find(l => l.startsWith('2026-07-09'))!
    expect(row.endsWith(',,,,')).toBe(true)
    expect(parsed.judged.issues.some(i => i.kind === 'missing-key')).toBe(true)
  })
})

describe('§A6.2 — the daily window', () => {
  const daily = fixtureWindow('daily')
  const dailyPayload = compilePayload({ agg: daily }).text
  const dailyReply = `## Narrative

A steady morning. You spent 45 minutes on the seminar paper, came back for 30 more, and
finished with a short note to yourself. The break in the middle was a long one.

You wrote more in the second session because the first one warmed you up.

\`\`\`csv
session_id,phase,effort,note
s-1,deep,steady,a settled opening stretch
s-2,mixed,steady,"picking up where you left off, more slowly"
s-3,shallow,light,a few lines in the journal
\`\`\``

  it('flags the causal sentence rather than presenting it as a finding', () => {
    const parsed = parseReply(dailyReply, { agg: daily, payload: dailyPayload })
    expect(parsed.judged.ok).toBe(true)
    expect(parsed.causalClaims).toHaveLength(1)
    expect(parsed.causalClaims[0].marker.toLowerCase()).toBe('because')
  })

  it('does not flag the same narrative with the causal sentence removed', () => {
    const clean = dailyReply.replace(/You wrote more in the second session because.*?\n/s, '')
    const parsed = parseReply(clean, { agg: daily, payload: dailyPayload })
    expect(parsed.causalClaims).toEqual([])
  })

  it('merges per-session for a daily window', () => {
    const parsed = parseReply(dailyReply, { agg: daily, payload: dailyPayload })
    expect(parsed.merged!.rows.map(r => r.key)).toEqual(['s-1', 's-2', 's-4', 's-3'])
    expect(parsed.merged!.rows[0].measured.active_minutes).toBe(45)
  })
})

describe('§A9 — graceful failure never loses the writer\'s reply', () => {
  it('keeps the narrative when the table is unreadable', () => {
    const broken = GOOD_REPLY.replace('day,phase,effort,momentum,character,note', 'day,vibe')
    const parsed = parseReply(broken, { agg: weekly, payload })
    expect(parsed.judged.ok).toBe(false)
    expect(parsed.merged).toBeNull()
    expect(parsed.narrative).toContain('A week with a real centre')   // not thrown away
  })

  it('keeps the narrative when there is no table at all', () => {
    const parsed = parseReply('## Narrative\n\nJust some prose about your week.', { agg: weekly, payload })
    expect(parsed.judged.issues[0].kind).toBe('no-block')
    expect(parsed.narrative).toContain('Just some prose')
  })

  it('handles a reply truncated mid-table', () => {
    // Cut after the 07-08 row: three rows survive, two days go unjudged, no closing fence.
    const cut = GOOD_REPLY.slice(0, GOOD_REPLY.indexOf('2026-07-09'))
    const parsed = parseReply(cut, { agg: weekly, payload })
    expect(parsed.judged.ok).toBe(true)
    expect(parsed.judged.rows.map(r => r.key)).toEqual(['2026-07-06', '2026-07-07', '2026-07-08'])
    expect(parsed.judged.issues[0].kind).toBe('truncated')
    expect(parsed.judged.issues.some(i => i.kind === 'missing-key')).toBe(true)
    expect(parsed.narrative).toContain('A week with a real centre')
  })

  it('handles an empty paste without throwing', () => {
    const parsed = parseReply('', { agg: weekly, payload })
    expect(parsed.judged.ok).toBe(false)
    expect(parsed.narrative).toBe('')
  })
})

describe('the downloads', () => {
  const parsed = parseReply(GOOD_REPLY, { agg: weekly, payload })

  it('marks the narrative as an assessment in the markdown', () => {
    const md = toMarkdown(parsed)
    expect(md).toContain('## Narrative — AI ASSESSMENT')
    expect(md).toContain('Measured figures are Inkwave\'s own')
    expect(md).toContain('not a measurement')
    expect(md).toContain('A week with a real centre')
  })

  it('carries the flags into the file, so the caveat travels with the report', () => {
    const lying = parseReply(GOOD_REPLY.replace('92 active', '900 active'), { agg: weekly, payload })
    expect(toMarkdown(lying)).toContain('Numbers Inkwave couldn\'t confirm')
    expect(toMarkdown(lying)).toContain('900')
  })

  it('round-trips through CSV with the right number of rows', () => {
    const lines = toCsv(parsed.merged!).trim().split('\n')
    expect(lines).toHaveLength(6)     // header + 5 days
  })
})

describe('merge', () => {
  it('asks about sessions on daily and days on weekly', () => {
    // s-4 is the fixture's honest-gap session (no snapshot boundary) — it is still a session and
    // must still be judged, or the model silently stops seeing a quarter of the day.
    expect(expectedKeys(fixtureWindow('daily'))).toEqual(['s-1', 's-2', 's-4', 's-3'])
    expect(expectedKeys(weekly)).toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'])
  })

  it('a judged row can never conjure a measured row', () => {
    const m = mergeReport(weekly, [
      { key: '2026-07-06', phase: 'deep', effort: 'steady', momentum: 'building', note: 'n' },
      { key: '2099-01-01', phase: 'deep', effort: 'steady', momentum: 'building', note: 'invented' },
    ])
    expect(m.rows).toHaveLength(5)                       // the fixture's days, no more
    expect(m.rows.some(r => r.key === '2099-01-01')).toBe(false)
    expect(m.orphanJudged.map(j => j.key)).toEqual(['2099-01-01'])
  })
})
