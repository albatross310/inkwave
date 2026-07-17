// @vitest-environment jsdom
//
// The PDF reading/annotating signal — the pure rules, the store, and the perf guard.
//
// jsdom for `localStorage` alone: the store's persistence is the thing the data-minimisation and perf
// guards below actually interrogate, and node has no Storage to spy on.
//
// EVERY NEGATIVE HERE IS PROVED TO FIRE. "A negative that cannot fail is not a negative" (CLAUDE.md,
// ~19 instances). Where a test asserts something is ABSENT or UNCOUNTED, a sibling proves the same
// assertion CATCHES the thing it names.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PDF_ACTIVITY_WINDOW_MS,
  _resetPdfActivity,
  activePdfs,
  activityDuring,
  noteAnnotation,
  noteScroll,
  observedDocType,
  pdfReadingState,
  persist,
  readingStateOf,
} from './pdfActivity'

beforeEach(() => {
  _resetPdfActivity()
  localStorage.clear()
})

const T = 1_000_000_000

describe('readingStateOf — the three states (Peter: reading and annotating are 2 separate things)', () => {
  it('scrolling, no annotation → reading', () => {
    expect(readingStateOf({ scrollAt: T }, T + 1_000)).toBe('reading')
  })

  it('annotation in the last 5 minutes → annotating', () => {
    expect(readingStateOf({ annotateAt: T }, T + 4 * 60_000)).toBe('annotating')
  })

  it('annotation WINS over scroll — you scroll while you annotate; counting both double-counts', () => {
    expect(readingStateOf({ scrollAt: T + 500, annotateAt: T }, T + 1_000)).toBe('annotating')
  })

  it('THE ONE THAT KEEPS THE NUMBER TRUE: open, no scroll, no annotation → idle, never reading', () => {
    // An open PDF nobody is scrolling is a tab you forgot about. It must not read as work.
    expect(readingStateOf(undefined, T)).toBe('idle')
    expect(readingStateOf({}, T)).toBe('idle')
  })

  it('an annotation older than the window stops counting as annotating', () => {
    expect(readingStateOf({ annotateAt: T }, T + PDF_ACTIVITY_WINDOW_MS + 1)).toBe('idle')
  })

  it('a stale annotation falls back to reading when scroll is still live — not to idle', () => {
    const now = T + PDF_ACTIVITY_WINDOW_MS + 1
    expect(readingStateOf({ annotateAt: T, scrollAt: now - 1_000 }, now)).toBe('reading')
  })

  it('scroll that has gone quiet past the window → idle (they got up and left)', () => {
    expect(readingStateOf({ scrollAt: T }, T + PDF_ACTIVITY_WINDOW_MS + 1)).toBe('idle')
  })

  it('the window boundary is exclusive at exactly windowMs — one rule, stated', () => {
    expect(readingStateOf({ scrollAt: T }, T + PDF_ACTIVITY_WINDOW_MS)).toBe('idle')
    expect(readingStateOf({ scrollAt: T }, T + PDF_ACTIVITY_WINDOW_MS - 1)).toBe('reading')
  })
})

describe('observedDocType — reading/annotating may only ever REPLACE an admitted unknown', () => {
  it('a silent Pomodoro block spent scrolling a PDF becomes `reading` (was `misc`)', () => {
    expect(observedDocType('misc', 0, { scrolled: true, annotated: false })).toBe('reading')
  })

  it('a silent block with an annotation in it becomes `annotating`', () => {
    expect(observedDocType('misc', 0, { scrolled: true, annotated: true })).toBe('annotating')
  })

  it('NO ACTIVITY ⇒ `misc` STANDS — the block is still measured, we just never claim reading', () => {
    // Starting the timer IS the claim of work (capture.ts). "Not reading" and "not a session" are
    // different things and this must not collapse them.
    expect(observedDocType('misc', 0, { scrolled: false, annotated: false })).toBe('misc')
  })

  it('A SESSION WITH TYPING IS NEVER FILED AS READING — the conflation this feature exists to stop', () => {
    // Reading time must never end up in the same column as the words written.
    expect(observedDocType('misc', 1, { scrolled: true, annotated: true })).toBe('misc')
  })

  it('a DECLARED type is never overridden by an observation (the email layer owns its own doc)', () => {
    expect(observedDocType('email', 0, { scrolled: true, annotated: true })).toBe('email')
    expect(observedDocType('essay', 0, { scrolled: true, annotated: false })).toBe('essay')
  })

  it('THE NEGATIVE FIRES: a rule that ignored editEvents/declared would break these', () => {
    // Prove the two guard clauses are load-bearing rather than decorative — a rule with them removed
    // answers differently on exactly these inputs, so the tests above can genuinely fail.
    const withoutGuards = (declared: string, observed: { scrolled: boolean; annotated: boolean }) =>
      observed.annotated ? 'annotating' : observed.scrolled ? 'reading' : declared
    expect(withoutGuards('misc', { scrolled: true, annotated: true })).toBe('annotating')
    expect(observedDocType('misc', 1, { scrolled: true, annotated: true })).toBe('misc')
    expect(withoutGuards('email', { scrolled: true, annotated: false })).toBe('reading')
    expect(observedDocType('email', 0, { scrolled: true, annotated: false })).toBe('email')
  })
})

describe('the store', () => {
  it('records scroll and annotation per citekey, and keeps them apart', () => {
    noteScroll('smith2020', T)
    noteAnnotation('jones2019', T)
    expect(pdfReadingState('smith2020', T + 1_000)).toBe('reading')
    expect(pdfReadingState('jones2019', T + 1_000)).toBe('annotating')
    expect(pdfReadingState('never-opened', T + 1_000)).toBe('idle')
  })

  it('activePdfs omits idle PDFs entirely and sorts most-recent first', () => {
    noteScroll('old', T)
    noteScroll('recent', T + 60_000)
    noteScroll('stale', T - PDF_ACTIVITY_WINDOW_MS * 2)
    const list = activePdfs(T + 61_000)
    expect(list.map((p) => p.citekey)).toEqual(['recent', 'old'])
  })

  it('activityDuring answers the session-span question as a BOOLEAN PAIR — never a quantity', () => {
    noteScroll('a', T + 10_000)
    noteAnnotation('a', T + 20_000)
    expect(activityDuring(T, T + 30_000)).toEqual({ scrolled: true, annotated: true })
    // Outside the span: we saw nothing in that window.
    expect(activityDuring(T + 40_000, T + 50_000)).toEqual({ scrolled: false, annotated: false })
    // Scroll only.
    expect(activityDuring(T, T + 15_000)).toEqual({ scrolled: true, annotated: false })
  })

  it('activityDuring sees a 25-minute block whose reading ended minutes ago (an in-memory map, unpruned)', () => {
    // The reason the in-memory map is NOT pruned to the window: a block that closes six minutes after
    // the last scroll must still be attributable, or the rule forgets exactly the reading it exists
    // to find.
    const start = T, end = T + 25 * 60_000
    noteScroll('smith2020', start + 60_000)
    expect(activityDuring(start, end)).toEqual({ scrolled: true, annotated: false })
  })
})

describe('DATA MINIMISATION (§A3.2) — a boolean, not a trace', () => {
  it('stores ONLY two timestamps per PDF: no page, no offset, no count, no history', () => {
    // The clock must agree with the observations: `persist` prunes against `Date.now()`, so writing
    // at a fixed past epoch under the real clock would prune everything away and this test would
    // "pass" by measuring an empty store. (It did exactly that on first writing.)
    vi.useFakeTimers()
    vi.setSystemTime(T + 4_000)
    let stored: Record<string, Record<string, number>>
    try {
      noteScroll('smith2020', T)
      noteAnnotation('smith2020', T + 1_000)
      noteScroll('smith2020', T + 2_000)
      noteScroll('smith2020', T + 3_000)
      persist()
      stored = JSON.parse(localStorage.getItem('inkwave:pdfActivity') ?? '{}')
    } finally {
      vi.useRealTimers()
    }
    expect(Object.keys(stored)).toEqual(['smith2020'])
    // The ENTIRE record for a PDF read four times. If a field is ever added here, it had better
    // clear §A3.2's "does a real feature need this?" bar.
    expect(Object.keys(stored.smith2020).sort()).toEqual(['annotateAt', 'scrollAt'])
  })

  it('persistence PRUNES, so the store cannot become a record of which PDFs were opened', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T)
      noteScroll('long-ago')
      vi.setSystemTime(T + PDF_ACTIVITY_WINDOW_MS + 60_000)
      noteScroll('right-now')
      persist()
      const stored = JSON.parse(localStorage.getItem('inkwave:pdfActivity') ?? '{}')
      expect(Object.keys(stored)).toEqual(['right-now'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('THE NEGATIVE FIRES: the prune assertion catches an unpruned store', () => {
    // Prove the test above can fail — write both entries by hand and watch the same assertion reject.
    localStorage.setItem('inkwave:pdfActivity', JSON.stringify({ 'long-ago': { scrollAt: 1 }, 'right-now': { scrollAt: 2 } }))
    const stored = JSON.parse(localStorage.getItem('inkwave:pdfActivity') ?? '{}')
    expect(Object.keys(stored)).not.toEqual(['right-now'])
  })
})

describe('THE PERF GUARD — structural, not timed', () => {
  // CLAUDE.md: "A measurement whose verdict depends on who else is running is not a guard." The
  // ledger's own guard counts `binding.getDoc()` calls rather than microseconds, because that call is
  // the ONLY route from capture to the document. The analogue here: `localStorage` is the only route
  // from a scroll frame to the disk, so counting writes is an exact proxy — decidable at any load,
  // on any box, with any number of other lanes running.
  it('A SCROLL BURST NEVER TOUCHES STORAGE', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      // 600 scroll reports = ~10 seconds of rAF-coalesced scrolling at 60fps.
      for (let i = 0; i < 600; i++) noteScroll('smith2020', T + i * 16)
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
      vi.useRealTimers()
    }
  })

  it('THE NEGATIVE FIRES: the spy CAN see a write, so "not called" is a real observation', () => {
    // Without this, `not.toHaveBeenCalled()` would pass just as happily against a broken spy — the
    // exact shape of the blind detector CLAUDE.md records ~19 times.
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      noteScroll('smith2020', T)
      persist()
      expect(setItem).toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
      vi.useRealTimers()
    }
  })

  it('the write happens on the debounce timer, not on the scroll', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      vi.setSystemTime(T)
      for (let i = 0; i < 600; i++) noteScroll('smith2020')
      expect(setItem).not.toHaveBeenCalled()
      vi.advanceTimersByTime(11_000)
      expect(setItem).toHaveBeenCalledTimes(1) // 600 scrolls ⇒ exactly ONE write
    } finally {
      setItem.mockRestore()
      vi.useRealTimers()
    }
  })
})
