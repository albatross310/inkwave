// @vitest-environment jsdom
//
// THE JOINT PROBE for the PDF reading signal: does a silent Pomodoro block spent scrolling a PDF
// actually come out of the REAL SessionCapture as a `reading` row?
//
// This is the seam nothing else tests. `pdfActivity.test.ts` proves the RULE; `capture.test.ts`
// proves the ENGINE; neither drives the two together, and the `misc`-vs-`reading` decision lives
// exactly between them. The email/ledger lane hit the identical gap (its §B1 goal "40m on email" had
// never been verified by anything because each half owned only its own side).
//
// PROVED TO FIRE IN BOTH DIRECTIONS at the bottom: with the rule mutated to ignore PDF activity the
// reading row reverts to `misc`; hard-wired to 'reading' the known-negative fails. No constant passes
// both — which is what makes the green above mean something.

import { beforeEach, describe, expect, it } from 'vitest'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument } from '../types/document'
import { SessionCapture } from './capture'
import { _resetPdfActivity, noteAnnotation, noteScroll } from './pdfActivity'
import type { SessionRow } from './types'

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
const insertStep = (chars: number): Step =>
  new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text('x'.repeat(chars))), 0, 0))

const T0 = Date.UTC(2026, 6, 17, 0, 0, 0)
const MIN = 60_000

function docOf(over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  return {
    id: 'd1',
    title: 'My Essay',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }] },
    ...over,
  } as InkwaveDocument
}

function harness(doc: InkwaveDocument = docOf()) {
  const rows: SessionRow[] = []
  let now = T0
  let n = 0
  const cap = new SessionCapture({
    clock: () => now,
    offsetMin: () => 600,
    newId: () => `s${++n}`,
    sink: (_m, row) => rows.push(row),
  })
  return {
    cap, rows,
    at: (ms: number) => { now = ms },
    advance: (ms: number) => { now += ms },
    bind: () => cap.bindDoc({ docId: 'd1', getDoc: () => doc }),
  }
}

beforeEach(() => {
  _resetPdfActivity()
  localStorage.clear()
})

describe('a Pomodoro block spent reading a PDF (Peter: "treat inkwave as a pdf reader")', () => {
  it('25 minutes of scrolling, no typing → a MEASURED row typed `reading`', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()

    // He reads. The PDF's scroller reports; the editor sees nothing at all.
    h.advance(2 * MIN); noteScroll('smith2020', T0 + 2 * MIN)
    h.advance(10 * MIN); noteScroll('smith2020', T0 + 12 * MIN)
    h.advance(13 * MIN)
    await h.cap.pomodoroStop()

    expect(h.rows).toHaveLength(1)
    const row = h.rows[0]
    expect(row.doc_type).toBe('reading')
    // The four stacked faults the ledger lane fixed must stay fixed: the block is RECORDED, and all
    // 25 minutes of it are active. A silent read producing nothing at all is the bug.
    expect(row.active_minutes).toBe(25)
    expect(row.edit_events).toBe(0)
    expect(row.pomodoro).toBe(true)
  })

  it('a block with an annotation in it is typed `annotating`, not `reading`', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    h.advance(3 * MIN); noteScroll('smith2020', T0 + 3 * MIN)
    h.advance(2 * MIN); noteAnnotation('smith2020', T0 + 5 * MIN)
    h.advance(20 * MIN)
    await h.cap.pomodoroStop()

    expect(h.rows[0].doc_type).toBe('annotating')
    expect(h.rows[0].active_minutes).toBe(25)
  })

  it('THE ONE THAT KEEPS THE NUMBER TRUE: a PDF open but never scrolled is NOT reading', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    h.advance(25 * MIN) // a PDF is on screen. Nobody touched it.
    await h.cap.pomodoroStop()

    // Still MEASURED and still recorded — starting the timer IS the claim of work. We simply never
    // claim it was reading. "Not reading" and "not a session" are different things.
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0].active_minutes).toBe(25)
    expect(h.rows[0].doc_type).toBe('misc')
  })

  it('READING TIME IS NEVER SUMMED INTO WORDS WRITTEN — a typing session is never `reading`', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    // He scrolls the PDF AND types. This is a writing session, whatever else happened alongside.
    noteScroll('smith2020', T0)
    h.advance(MIN)
    h.cap.record([insertStep(20)])
    h.advance(5 * MIN)
    await h.cap.pomodoroStop()

    expect(h.rows[0].doc_type).not.toBe('reading')
    expect(h.rows[0].doc_type).not.toBe('annotating')
    expect(h.rows[0].edit_events).toBeGreaterThan(0)
  })

  it('an email document is never re-typed as reading by an observation', async () => {
    const h = harness(docOf({ docType: 'email' } as Partial<InkwaveDocument>))
    await h.bind()
    await h.cap.pomodoroStart()
    noteScroll('smith2020', T0)
    h.advance(10 * MIN)
    await h.cap.pomodoroStop()

    expect(h.rows[0].doc_type).toBe('email')
  })

  it('scrolling a PDF OUTSIDE the block does not make the block a reading block', async () => {
    // Attribution is by the session's own span. Reading yesterday is not reading now.
    noteScroll('smith2020', T0 - 60 * MIN)
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    h.advance(25 * MIN)
    await h.cap.pomodoroStop()

    expect(h.rows[0].doc_type).toBe('misc')
  })
})

describe('THE FIXTURE CAN TELL THE RULES APART (not a tautology)', () => {
  it('the reading case and the no-activity case differ ONLY in the scroll signal', async () => {
    // If both cells answered the same, every assertion above would be a property of the harness
    // rather than of the rule. They differ, and on exactly the one input under test.
    const read = harness(); await read.bind(); await read.cap.pomodoroStart()
    noteScroll('smith2020', T0); read.advance(25 * MIN); await read.cap.pomodoroStop()

    _resetPdfActivity()

    const silent = harness(); await silent.bind(); await silent.cap.pomodoroStart()
    silent.advance(25 * MIN); await silent.cap.pomodoroStop()

    expect(read.rows[0].doc_type).toBe('reading')
    expect(silent.rows[0].doc_type).toBe('misc')
    expect(read.rows[0].active_minutes).toBe(silent.rows[0].active_minutes) // same block, same minutes
  })
})
