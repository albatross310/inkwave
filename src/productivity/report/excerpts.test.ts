// THE LEDGER+DOC COMBO — pairing each session with the prose it produced.
//
// The failure mode this file exists to catch is not "wrong text"; it is CONFIDENT wrong text —
// an excerpt attributed to the wrong session reads exactly like a correct one, and the whole
// point of the feature is that the model can say "this session produced this paragraph" and be
// believed. So the baseline rule gets the most tests.

import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../types/document'
import type { SessionRow } from '../types'
import { excerptForSession, sessionExcerpts } from './excerpts'

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

function snap(id: string, createdAt: string, text: string): Snapshot {
  return {
    id, documentId: 'doc-essay', createdAt, trigger: 'paragraph',
    wordCount: text.split(/\s+/).length, contentHash: `h-${id}`, contentJson: doc(text),
  } as Snapshot
}

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: 's-1', doc_id: 'doc-essay', start: '2026-07-06T09:00:00+10:00',
    end: '2026-07-06T10:00:00+10:00', active_minutes: 45, words_start: 0, words_end: 0,
    words_added: 0, words_deleted: 0, net_words: 0, edit_events: 10, break_before_min: 0,
    pomodoro: false, doc_type: 'essay', entered: 'timer', ...over,
  }
}

describe('the baseline rule', () => {
  it('returns exactly the text added DURING the session', () => {
    const snaps = [
      snap('a', '2026-07-06T08:50:00+10:00', 'The opening paragraph.'),
      snap('b', '2026-07-06T09:40:00+10:00', 'The opening paragraph. And the new middle bit.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toBe('And the new middle bit.')
    expect(e.reason).toBeUndefined()
  })

  it('does NOT include text written before the session — the baseline is what bounds it', () => {
    // The trap: take the FIRST snapshot in the window as the baseline and yesterday's work
    // becomes this morning's excerpt. The baseline must be the last one AT OR BEFORE the start.
    const snaps = [
      snap('old', '2026-07-05T14:00:00+10:00', 'Yesterday I wrote this.'),
      snap('base', '2026-07-06T08:55:00+10:00', 'Yesterday I wrote this. Then early-morning work.'),
      snap('in', '2026-07-06T09:30:00+10:00',
        'Yesterday I wrote this. Then early-morning work. The session itself.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toBe('The session itself.')
    expect(e.added).not.toContain('Yesterday')
    expect(e.added).not.toContain('early-morning')
  })

  it('does NOT include text written after the session ends', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'Start.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'Start. During.'),
      snap('after', '2026-07-06T11:30:00+10:00', 'Start. During. Long after the session closed.'),
    ]
    expect(excerptForSession(session(), snaps).added).toBe('During.')
  })

  it('takes the LAST snapshot at or before the end, not the first in the window', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'One.'),
      snap('mid', '2026-07-06T09:20:00+10:00', 'One. Two.'),
      snap('last', '2026-07-06T09:50:00+10:00', 'One. Two. Three.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toContain('Two.')
    expect(e.added).toContain('Three.')
  })

  it('handles an unsorted snapshot list — the caller hands us the archive as it is', () => {
    const snaps = [
      snap('in', '2026-07-06T09:30:00+10:00', 'Base. Added.'),
      snap('base', '2026-07-06T08:55:00+10:00', 'Base.'),
    ]
    expect(excerptForSession(session(), snaps).added).toBe('Added.')
  })

  it('treats a session with NO baseline as starting from nothing', () => {
    // The writer's first ever session in a document: everything in it is new.
    const snaps = [snap('first', '2026-07-06T09:30:00+10:00', 'The very first words.')]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toBe('The very first words.')
    expect(e.baselineAgeMin).toBeUndefined()
  })
})

describe('the diffWords tokenisation artifact — the bug this module actually had', () => {
  // `diffWords` tokenises [word][trailing-whitespace], so appending to a paragraph re-emits the
  // OLD last token as del+add. A naive filter(type==='add') therefore credits this session with
  // the sentence before it. This is not hypothetical: it is what the first cut did, and these
  // are the shapes that caught it. Remove the reconciliation in excerpts.ts and they fail.
  it('does not credit the session with the re-spaced last token of the baseline', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'The opening paragraph.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'The opening paragraph. And the new middle bit.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toBe('And the new middle bit.')
    expect(e.added.startsWith('paragraph')).toBe(false)
  })

  it('survives a paragraph BREAK being added after the old last token', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'First para.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'First para.\n\nA whole new paragraph.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toContain('A whole new paragraph.')
    expect(e.added).not.toContain('First para.')
  })

  it('a genuine mid-sentence rewrite still reports only the new words', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'The cat sat on the mat.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'The cat sat on the extremely comfortable mat.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toContain('extremely comfortable')
    expect(e.added).not.toContain('The cat sat')
  })
})

describe('§A9 — honest gaps, never a fabricated zero', () => {
  it('reports no-snapshots rather than an empty excerpt that reads as "did nothing"', () => {
    // Snapshots are event-triggered, so a real session can produce none. The measured
    // words_added may be large — saying "nothing" here would contradict the ledger.
    const e = excerptForSession(session({ words_added: 400 }), [
      snap('before', '2026-07-06T08:00:00+10:00', 'Earlier.'),
    ])
    expect(e.added).toBe('')
    expect(e.reason).toBe('no-snapshots')
  })

  it('reports no-snapshots when the document has no snapshots at all', () => {
    expect(excerptForSession(session(), []).reason).toBe('no-snapshots')
  })

  it('distinguishes no-change (editing) from no-snapshots (no record)', () => {
    const snaps = [
      snap('base', '2026-07-06T08:55:00+10:00', 'Identical text.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'Identical text.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.added).toBe('')
    expect(e.reason).toBe('no-change')
  })

  it('reports a wide baseline so a session cannot be credited with an untracked afternoon', () => {
    const snaps = [
      snap('old', '2026-07-06T06:00:00+10:00', 'Base.'),          // 3 hours before the session
      snap('in', '2026-07-06T09:30:00+10:00', 'Base. Everything since six a.m.'),
    ]
    const e = excerptForSession(session(), snaps)
    expect(e.baselineAgeMin).toBe(180)
    expect(e.added).toBe('Everything since six a.m.')
  })

  it('a tight baseline reports a small age — the warning must DISCRIMINATE', () => {
    const snaps = [
      snap('base', '2026-07-06T08:58:00+10:00', 'Base.'),
      snap('in', '2026-07-06T09:30:00+10:00', 'Base. New.'),
    ]
    expect(excerptForSession(session(), snaps).baselineAgeMin).toBe(2)
  })
})

describe('§A7.3 — the tick gates every word', () => {
  const sessions = [
    session({ session_id: 's-1', doc_id: 'doc-essay' }),
    session({ session_id: 's-2', doc_id: 'doc-journal' }),
  ]
  const snaps = {
    'doc-essay': [
      snap('a', '2026-07-06T08:55:00+10:00', 'Base.'),
      snap('b', '2026-07-06T09:30:00+10:00', 'Base. Essay prose.'),
    ],
  }

  it('a document with no snapshots supplied contributes NOTHING — not another doc\'s text', () => {
    const out = sessionExcerpts(sessions, snaps)
    expect(out.map(e => e.session_id)).toEqual(['s-1'])
    expect(out[0].added).toBe('Essay prose.')
  })

  it('supplying no documents at all yields no excerpts', () => {
    expect(sessionExcerpts(sessions, {})).toEqual([])
  })

  it('an explicitly empty snapshot list yields an honest gap, not a skip', () => {
    // Different from "not ticked": the doc WAS ticked, the archive is just empty.
    const out = sessionExcerpts(sessions, { 'doc-journal': [] })
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('no-snapshots')
  })
})
