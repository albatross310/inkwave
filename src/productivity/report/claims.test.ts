// The two client-side enforcements — and proof that each FIRES and each STAYS QUIET.
//
// A detector that never fires and a detector that always fires are equally useless, and both
// look like "working" from one side only. Every describe below has both halves.

import { describe, expect, it } from 'vitest'
import { findCausalClaims, findUnverifiedNumbers, numbersIn } from './claims'

describe('§A6.2 — cause and pattern claims on a daily report', () => {
  it('FIRES on causal claims', () => {
    const cases = [
      'You wrote more in the afternoon because you took a proper break at lunch.',
      'The long gap led to a slower start after it.',
      'Your best stretch came after the walk, which is why the evening went well.',
      'Taking the break early paid off.',
      'The morning session drove most of today\'s progress.',
      'You lost momentum due to the interruption at three.',
      'Therefore the shorter sessions suited you better.',
    ]
    for (const c of cases) {
      expect(findCausalClaims(c), c).toHaveLength(1)
    }
  })

  it('FIRES on pattern claims', () => {
    const cases = [
      'You always write best first thing in the morning.',
      'Your peak hours are clearly between nine and eleven.',
      'You tend to delete more in the evenings.',
      'This is the pattern across your work: short bursts, long breaks.',
      'Breaks and output correlate strongly for you.',
      'You typically slow down after ninety minutes.',
    ]
    for (const c of cases) {
      expect(findCausalClaims(c), c).toHaveLength(1)
    }
  })

  it('STAYS QUIET on a kind descriptive recap — the shape the prompt actually asks for', () => {
    const good = [
      '## Narrative',
      '',
      'A lighter day. You spent forty-five focused minutes on the seminar paper in the morning,',
      'then came back for a shorter stretch before lunch. Most of the work was adding rather than',
      'cutting.',
      '',
      'Later you wrote briefly in your journal. Two breaks, and a long one in the middle of the',
      'day. That is what today looked like.',
    ].join('\n')
    expect(findCausalClaims(good)).toEqual([])
  })

  it('STAYS QUIET on ordinary narration words that are not claims', () => {
    // "after", "then", "so" and friends must not fire, or every recap ever written is flagged.
    const narration = 'You started at nine, then took a break, and after that you came back to the '
      + 'introduction. It was a slower session than the first, so the words came more gradually.'
    expect(findCausalClaims(narration)).toEqual([])
  })

  it('never reads the CSV block or headings as prose', () => {
    const reply = '## Always start here\n\nA calm day.\n\n```csv\nday,note\n2026-07-06,'
      + '"you always do this"\n```'
    expect(findCausalClaims(reply)).toEqual([])
  })

  it('reports the marker that fired, so the panel can explain itself', () => {
    const [c] = findCausalClaims('The break helped a great deal.')
    expect(c.marker.toLowerCase()).toBe('helped')
    expect(c.sentence).toBe('The break helped a great deal.')
  })
})

describe('§A6.4 — numbers the model invented', () => {
  const payload = 'DAYS\nday             active_minutes  net_words\n2026-07-06      92              520\n'
    + '2026-07-07      24              -120'

  it('FIRES on a total the model computed for itself', () => {
    // 116 = 92 + 24. Exactly the "silently tidies and totals" failure §A6.4 names.
    expect(findUnverifiedNumbers('You worked 116 minutes across the week.', payload)).toEqual(['116'])
  })

  it('FIRES on a rounded number', () => {
    expect(findUnverifiedNumbers('You wrote about 500 words on Monday.', payload)).toEqual(['500'])
  })

  it('FIRES on an invented percentage', () => {
    expect(findUnverifiedNumbers('Roughly 70% of your time went to the essay.', payload)).toEqual(['70'])
  })

  it('STAYS QUIET on numbers Inkwave actually sent', () => {
    const narrative = 'On 2026-07-06 you managed 92 active minutes and 520 net words; '
      + 'on 2026-07-07, 24 minutes.'
    expect(findUnverifiedNumbers(narrative, payload)).toEqual([])
  })

  it('STAYS QUIET on a number written the other way round (1,240 vs 1240)', () => {
    expect(findUnverifiedNumbers('You added 1,240 words.', 'words_added 1240')).toEqual([])
    expect(findUnverifiedNumbers('You added 1240 words.', 'words_added 1,240')).toEqual([])
  })

  it('STAYS QUIET on markdown list numbering', () => {
    expect(findUnverifiedNumbers('1. First thing\n2. Second thing', payload)).toEqual([])
  })

  it('does not read the CSV block', () => {
    expect(findUnverifiedNumbers('A calm day.\n\n```csv\nday,note\n2026-07-06,"999"\n```', payload))
      .toEqual([])
  })

  it('reports each invented number once', () => {
    expect(findUnverifiedNumbers('116 minutes. Really, 116 minutes!', payload)).toEqual(['116'])
  })
})

describe('numbersIn', () => {
  it('normalises so both sides compare equal', () => {
    expect(numbersIn('1,240 and 07 and 3.5')).toEqual(['1240', '7', '3.5'])
  })
})
