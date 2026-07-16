// Validation — the module that has to say NO.
//
// THE HOUSE DISEASE (CLAUDE.md): "a negative that cannot fail is not a negative." A validator
// that rejected everything would pass every rejection test below, so every reject case is paired
// with an accept case built from the SAME fixture, differing only in the thing under test. If
// `extractJudged` ever returns ok:false unconditionally, the accept tests fail loudly.

import { describe, expect, it } from 'vitest'
import { extractJudged, MEASURED_COLUMNS, validateJudgedRows } from './judged'
import { parseDelimited } from './csv'

const WEEK = { window: 'weekly' as const, expectedKeys: ['2026-07-06', '2026-07-07'] }
const DAY = { window: 'daily' as const, expectedKeys: ['s-1', 's-2'] }

const GOOD_WEEK = [
  'day,phase,effort,momentum,note',
  '2026-07-06,deep,steady,building,"a full morning on the seminar paper"',
  '2026-07-07,shallow,light,easing,a lighter evening',
].join('\n')

const reply = (csv: string) => `## Narrative\n\nA good week.\n\n\`\`\`csv\n${csv}\n\`\`\``

describe('the accept path (the control for every rejection below)', () => {
  it('accepts the table it asked for', () => {
    const r = extractJudged(reply(GOOD_WEEK), WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual({
      key: '2026-07-06', phase: 'deep', effort: 'steady', momentum: 'building',
      note: 'a full morning on the seminar paper',
    })
    expect(r.issues).toHaveLength(0)
  })

  it('accepts columns in a different order — order is not identity', () => {
    const shuffled = [
      'note,day,momentum,phase,effort',
      '"a full morning",2026-07-06,building,deep,steady',
      'a lighter evening,2026-07-07,easing,shallow,light',
    ].join('\n')
    const r = extractJudged(reply(shuffled), WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows[0].phase).toBe('deep')
    expect(r.rows[0].note).toBe('a full morning')
  })

  it('accepts a daily table keyed by session_id', () => {
    const csv = 'session_id,phase,effort,note\ns-1,deep,intense,good stretch\ns-2,mixed,steady,ok'
    const r = extractJudged(reply(csv), DAY)
    expect(r.ok).toBe(true)
    expect(r.rows.map(x => x.key)).toEqual(['s-1', 's-2'])
    expect(r.rows[0].momentum).toBeUndefined()   // daily has no momentum column
  })
})

describe('§A6.4 — a judged table may never carry measured numbers back', () => {
  it('REJECTS a table containing measured columns', () => {
    const csv = [
      'day,active_minutes,net_words,phase,effort,momentum,note',
      '2026-07-06,92,520,deep,steady,building,a full morning',
    ].join('\n')
    const r = extractJudged(reply(csv), WEEK)
    expect(r.ok).toBe(false)
    expect(r.rows).toHaveLength(0)
    expect(r.issues[0].kind).toBe('measured-column')
    expect(r.issues[0].message).toContain('active_minutes')
    expect(r.issues[0].message).toContain('net_words')
  })

  it('rejects EVERY measured column name individually — the list is live, not decorative', () => {
    // Without this guard the loop below is VACUOUS: empty the list and it passes by iterating
    // nothing. Probed — that is exactly what happened on the first run of this suite.
    expect(MEASURED_COLUMNS.length).toBeGreaterThan(15)
    expect(MEASURED_COLUMNS).toContain('active_minutes')
    expect(MEASURED_COLUMNS).toContain('net_words')
    expect(MEASURED_COLUMNS).toContain('place')
    for (const col of MEASURED_COLUMNS) {
      const csv = `day,${col},phase,effort,momentum,note\n2026-07-06,x,deep,steady,building,n`
      const r = extractJudged(reply(csv), WEEK)
      expect(r.ok, `${col} should have been rejected`).toBe(false)
      expect(r.issues[0].kind, `${col} should be a measured-column rejection`).toBe('measured-column')
    }
  })

  it('rejects a measured column even when every judged column is also correct', () => {
    // The convenient case — the one the rule exists to refuse.
    const csv = [
      'day,phase,effort,momentum,note,active_minutes',
      '2026-07-06,deep,steady,building,a full morning,92',
      '2026-07-07,shallow,light,easing,a lighter evening,24',
    ].join('\n')
    expect(extractJudged(reply(csv), WEEK).ok).toBe(false)
  })
})

describe('§A7.1.5 — a wrong header is rejected, not coerced', () => {
  it('REJECTS a missing column and names it', () => {
    const csv = 'day,phase,effort,note\n2026-07-06,deep,steady,a full morning'
    const r = extractJudged(reply(csv), WEEK)
    expect(r.ok).toBe(false)
    expect(r.issues[0].kind).toBe('header-mismatch')
    expect(r.issues[0].message).toContain('momentum')
  })

  it('REJECTS an extra column and names it', () => {
    const csv = 'day,phase,effort,momentum,note,confidence\n2026-07-06,deep,steady,building,n,high'
    const r = extractJudged(reply(csv), WEEK)
    expect(r.ok).toBe(false)
    expect(r.issues[0].kind).toBe('header-mismatch')
    expect(r.issues[0].message).toContain('confidence')
  })

  it('REJECTS a renamed column', () => {
    const csv = 'day,mode,effort,momentum,note\n2026-07-06,deep,steady,building,n'
    const r = extractJudged(reply(csv), WEEK)
    expect(r.ok).toBe(false)
    expect(r.issues[0].kind).toBe('header-mismatch')
  })

  it('REJECTS the daily table when the weekly one was asked for (and vice versa)', () => {
    const daily = 'session_id,phase,effort,note\ns-1,deep,steady,n'
    expect(extractJudged(reply(daily), WEEK).ok).toBe(false)
    expect(extractJudged(reply(GOOD_WEEK), DAY).ok).toBe(false)
  })

  it('reports "no table" distinctly from "wrong table"', () => {
    const r = extractJudged('## Narrative\n\nJust prose, no block at all.', WEEK)
    expect(r.ok).toBe(false)
    expect(r.issues[0].kind).toBe('no-block')
    const r2 = extractJudged('```csv\nhello,world\nfoo,bar\n```', WEEK)
    expect(r2.issues[0].kind).toBe('no-header')
  })
})

describe('forgiveness that does not cost meaning', () => {
  it('finds the table in an untagged block when no csv-tagged one validates', () => {
    const r = extractJudged(`Sure!\n\n\`\`\`\n${GOOD_WEEK}\n\`\`\``, WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
  })

  it('skips prose lines above the header inside the block', () => {
    const r = extractJudged(reply(`Here are my judgements:\n${GOOD_WEEK}`), WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
  })

  it('prefers a valid block over an earlier invalid one, and never lowers the bar', () => {
    const bad = '```csv\nday,active_minutes\n2026-07-06,92\n```'
    const r = extractJudged(`${bad}\n\n\`\`\`\n${GOOD_WEEK}\n\`\`\``, WEEK)
    expect(r.ok).toBe(true)
    // ...but if the good block is ALSO wrong, the first failure is what's reported.
    const r2 = extractJudged(`${bad}\n\n\`\`\`\nday,mode\n2026-07-06,deep\n\`\`\``, WEEK)
    expect(r2.ok).toBe(false)
  })

  it('flags a truncated table but still uses the rows it got', () => {
    const r = extractJudged(`\`\`\`csv\n${GOOD_WEEK}`, WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
    expect(r.issues[0].kind).toBe('truncated')
  })

  it('reads a markdown pipe table the model emitted instead', () => {
    const md = [
      '| day | phase | effort | momentum | note |',
      '|---|---|---|---|---|',
      '| 2026-07-06 | deep | steady | building | a full morning |',
      '| 2026-07-07 | shallow | light | easing | a lighter evening |',
    ].join('\n')
    const r = extractJudged('```csv\n' + md + '\n```', WEEK)
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
  })
})

describe('§A9 — nothing is dropped silently', () => {
  it('reports and excludes a row with the wrong number of cells', () => {
    const csv = `${GOOD_WEEK}\n2026-07-08,deep`
    const r = validateJudgedRows(parseDelimited(csv), { ...WEEK, expectedKeys: [] })
    expect(r.rows).toHaveLength(2)
    expect(r.issues.some(i => i.kind === 'row-shape')).toBe(true)
  })

  it('reports and coerces an enum value we never offered', () => {
    const csv = 'day,phase,effort,momentum,note\n2026-07-06,turbo,steady,building,n'
    const r = validateJudgedRows(parseDelimited(csv), { ...WEEK, expectedKeys: ['2026-07-06'] })
    expect(r.rows[0].phase).toBe('unclear')
    const issue = r.issues.find(i => i.kind === 'unknown-value')
    expect(issue?.message).toContain('turbo')
  })

  it('reports a row the model invented, and does not merge it', () => {
    const csv = `${GOOD_WEEK}\n2026-07-99,deep,steady,building,a day that does not exist`
    const r = validateJudgedRows(parseDelimited(csv), WEEK)
    expect(r.rows).toHaveLength(2)
    expect(r.issues.some(i => i.kind === 'unknown-key' && i.message.includes('2026-07-99'))).toBe(true)
  })

  it('reports a duplicate rather than letting the second overwrite the first', () => {
    const csv = `${GOOD_WEEK}\n2026-07-06,shallow,light,easing,a contradictory second judgement`
    const r = validateJudgedRows(parseDelimited(csv), WEEK)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].phase).toBe('deep')
    expect(r.issues.some(i => i.kind === 'duplicate-key')).toBe(true)
  })

  it('reports a gap — a day the model did not judge — rather than filling it in', () => {
    const csv = 'day,phase,effort,momentum,note\n2026-07-06,deep,steady,building,n'
    const r = validateJudgedRows(parseDelimited(csv), WEEK)
    expect(r.rows).toHaveLength(1)
    expect(r.issues.some(i => i.kind === 'missing-key' && i.message.includes('2026-07-07'))).toBe(true)
  })
})
