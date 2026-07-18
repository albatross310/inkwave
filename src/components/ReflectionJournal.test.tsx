// @vitest-environment jsdom
//
// THE REFLECTIVE JOURNAL RENDERS THE WRITER'S OWN WORDS BACK.
//
// ReflectionPrompt has always WRITTEN reflections; nothing on master READ one, so "the comments become
// a reflective journal" (Peter) was true on disk and false on screen. This pins the read side: an entry
// with notes shows its category labels and its text; an entry with no notes is not shown; an empty
// journal renders nothing. Without the render assertion, the journal could silently return null forever
// and the gate would stay green — the exact "a browser probe that ran once is not a guard" shape.
//
// afterEach(cleanup) is MANDATORY here — this repo does not set globals:true, so without it every test
// measures the previous test's still-mounted DOM (CLAUDE.md, the ScoreView note).

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReflectionJournal } from './ReflectionJournal'
import type { Reflection } from '../productivity/types'

afterEach(cleanup)

const reflection = (over: Partial<Reflection> = {}): Reflection => ({
  reflection_id: `r-${Math.random().toString(36).slice(2, 8)}`,
  day: '2026-07-17',
  from: '2026-07-17T09:00:00+10:00',
  to: '2026-07-17T10:00:00+10:00',
  notes: [{ doc_type: 'essay', text: 'wrestled the intro into shape' }],
  ...over,
})

describe('ReflectionJournal', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<ReflectionJournal reflections={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows an entry with notes — the writer\'s text and the category label', () => {
    render(<ReflectionJournal reflections={[reflection()]} />)
    expect(screen.getByText('wrestled the intro into shape')).toBeTruthy()
    // 'essay' is labelled "the essay" via the SHARED CATEGORY_LABEL (imported from ReflectionPrompt,
    // never re-typed) — so the journal and the prompt can't drift on how a category reads.
    expect(screen.getByText('the essay')).toBeTruthy()
  })

  it('does NOT show an entry the writer left blank (no notes)', () => {
    render(<ReflectionJournal reflections={[reflection({ notes: [] })]} />)
    // Blank reflections are not journal entries — the header would render, so its absence proves the
    // whole section is suppressed, not merely the row.
    expect(screen.queryByText('Journal')).toBeNull()
  })

  it('orders most-recent-first', () => {
    const older = reflection({ to: '2026-07-15T10:00:00+10:00', notes: [{ doc_type: 'note', text: 'older thought' }] })
    const newer = reflection({ to: '2026-07-17T10:00:00+10:00', notes: [{ doc_type: 'essay', text: 'newer thought' }] })
    render(<ReflectionJournal reflections={[older, newer]} />)
    const html = document.body.innerHTML
    expect(html.indexOf('newer thought')).toBeLessThan(html.indexOf('older thought'))
  })
})
