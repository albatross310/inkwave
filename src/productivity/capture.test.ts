import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument } from '../types/document'
import { diffStats, diffWords } from '../provenance/diff'
import { countWords } from '../provenance/snapshots'
import { SessionCapture, resolveDocType, setLabelSuppressed, wordDiffStats } from './capture'
import type { SessionRow } from './types'

// Real PM steps — countSteps() tests `instanceof ReplaceStep`, so a hand-rolled fake would be a
// fiction that agrees with itself. These are the same step objects the editor produces.
const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
const insertStep = (chars: number): Step =>
  new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text('x'.repeat(chars))), 0, 0))
const deleteStep = (chars: number): Step => new ReplaceStep(1, 1 + chars, Slice.empty)
/** A step that changes no content — the selection/mark/decoration traffic that must NOT count. */
const noopStep = (): Step => new ReplaceStep(1, 1, Slice.empty)

function docOf(text: string, over: Partial<InkwaveDocument> = {}): InkwaveDocument {
  return {
    id: 'd1',
    title: 'My Essay',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] },
    ...over,
  } as InkwaveDocument
}

const T0 = Date.UTC(2026, 6, 17, 0, 0, 0)
const MIN = 60_000

function harness(opts: { doc?: () => InkwaveDocument } = {}) {
  const rows: SessionRow[] = []
  let now = T0
  let n = 0
  let doc = docOf('one two three')
  const cap = new SessionCapture({
    clock: () => now,
    offsetMin: () => 600,
    newId: () => `s${++n}`,
    sink: (_month, row) => rows.push(row),
  })
  return {
    cap,
    rows,
    setDoc: (d: InkwaveDocument) => { doc = d },
    at: (ms: number) => { now = ms },
    advance: (ms: number) => { now += ms },
    bind: (docId = 'd1') => cap.bindDoc({ docId, getDoc: opts.doc ?? (() => doc) }),
    month: (i = 0) => rows[i],
  }
}

describe('wordDiffStats — measured, not merely plausible', () => {
  it('counts a plain addition exactly', () => {
    expect(wordDiffStats('one two three', 'one two three four five')).toEqual({ added: 2, removed: 0 })
  })

  it('KNOWN-NEGATIVE: the raw display diff gets this wrong — which is why the normalisation exists', () => {
    // The bug this module was written to fix, pinned live. diffWords tokenises as
    // [word][trailing-whitespace], so appending makes the old last token differ from the new one:
    // a 2-word addition reads as 3 added + 1 deleted. If this ever stops reproducing, the
    // normalisation above has become unnecessary — but until then it is load-bearing.
    const raw = diffStats(diffWords('one two three\n', 'one two three four five\n'))
    expect(raw).toEqual({ added: 3, removed: 1 })
    expect(raw).not.toEqual(wordDiffStats('one two three\n', 'one two three four five\n'))
  })

  it('is insensitive to whitespace and paragraph reflow, which are not word changes', () => {
    expect(wordDiffStats('one two three', 'one  two\n\nthree')).toEqual({ added: 0, removed: 0 })
    expect(wordDiffStats('a b\n', 'a b')).toEqual({ added: 0, removed: 0 })
  })

  it('counts a replacement as both an add and a delete (the restructuring signal)', () => {
    expect(wordDiffStats('alpha beta gamma', 'alpha zulu gamma')).toEqual({ added: 1, removed: 1 })
  })

  it('counts a pure deletion', () => {
    expect(wordDiffStats('one two three', 'one')).toEqual({ added: 0, removed: 2 })
  })

  it('handles the empty-document edges', () => {
    expect(wordDiffStats('', 'hello world')).toEqual({ added: 2, removed: 0 })
    expect(wordDiffStats('hello world', '')).toEqual({ added: 0, removed: 2 })
    expect(wordDiffStats('', '')).toEqual({ added: 0, removed: 0 })
  })

  it('agrees with countWords\' word notion, so added-removed reconciles with net_words', () => {
    // The second failure mode: diffStats counts \S+ while countWords counts [\p{L}\p{N}]+. If they
    // disagree, one row shows net_words and added-removed contradicting each other on one graph.
    const before = 'The essay — draft one; it works.'
    const after = 'The essay — draft two; it works, mostly.'
    const { added, removed } = wordDiffStats(before, after)
    const net = countWords({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: after }] }] })
      - countWords({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: before }] }] })
    expect(added - removed).toBe(net)
  })
})

describe('resolveDocType', () => {
  it('defaults to the prose default when the document says nothing', () => {
    expect(resolveDocType({ id: 'd' })).toBe('essay')
  })
  it('honours an explicit docType — the email layer sets this (§B2.1)', () => {
    expect(resolveDocType({ id: 'd', docType: 'email' })).toBe('email')
    expect(resolveDocType({ id: 'd', docType: 'note' })).toBe('note')
  })
  it('ignores a bogus docType rather than writing it into the contract', () => {
    expect(resolveDocType({ id: 'd', docType: 'nonsense' })).toBe('essay')
    expect(resolveDocType({ id: 'd', docType: 42 })).toBe('essay')
  })
})

describe('the edit stream (§A4 — derived from steps already emitted)', () => {
  it('does nothing before a document is bound', () => {
    const h = harness()
    h.cap.record([insertStep(1)])
    expect(h.cap.openSessionId).toBeNull()
  })

  it('opens a session on the first real edit', async () => {
    const h = harness()
    await h.bind()
    h.cap.record([insertStep(1)])
    expect(h.cap.openSessionId).toBe('s1')
    expect(h.cap.editEvents).toBe(1)
  })

  it('IGNORES content-free transactions — selection/mark/decoration traffic is not an edit', async () => {
    const h = harness()
    await h.bind()
    h.cap.record([noopStep()])
    h.cap.record([])
    expect(h.cap.openSessionId).toBeNull()
    // PROVE THE POSITIVE in the same test, so "ignores everything" cannot pass as success.
    h.cap.record([insertStep(1)])
    expect(h.cap.openSessionId).toBe('s1')
  })

  it('counts deletions as edit events too', async () => {
    const h = harness()
    await h.bind()
    h.cap.record([insertStep(5)])
    h.advance(1000)
    h.cap.record([deleteStep(2)])
    expect(h.cap.editEvents).toBe(2)
  })

  it('many keystrokes stay ONE session while the writer keeps typing', async () => {
    const h = harness()
    await h.bind()
    for (let i = 0; i < 50; i++) { h.cap.record([insertStep(1)]); h.advance(500) }
    expect(h.cap.openSessionId).toBe('s1')
    expect(h.cap.editEvents).toBe(50)
    expect(h.rows).toHaveLength(0) // nothing is written until the session closes
  })
})

describe('session boundaries close a row (§A4)', () => {
  it('an explicit close writes the row with the measured numbers', async () => {
    const h = harness()
    h.setDoc(docOf('one two three')) // 3 words at open → the baseline
    await h.bind()
    h.cap.record([insertStep(1)])
    h.advance(2 * MIN)
    h.cap.record([insertStep(1)])
    h.setDoc(docOf('one two three four five')) // the writer added two words
    await h.cap.close('manual')

    expect(h.rows).toHaveLength(1)
    const r = h.month()
    expect(r.session_id).toBe('s1')
    expect(r.doc_id).toBe('d1')
    expect(r.words_start).toBe(3)
    expect(r.words_end).toBe(5)
    expect(r.net_words).toBe(2)
    expect(r.words_added).toBe(2)
    expect(r.words_deleted).toBe(0)
    expect(r.edit_events).toBe(2)
    expect(r.pomodoro).toBe(false)
    expect(r.doc_type).toBe('essay')
    expect(r.start).toBe('2026-07-17T10:00:00.000+10:00')
  })

  it('words_start is carried from the baseline — EXACT, and free on the keystroke', async () => {
    // This is the claim the whole design rests on: a session's start count is the previous close's
    // count, because the document cannot change while nobody is editing.
    const h = harness()
    h.setDoc(docOf('a b c d e')) // 5 words
    await h.bind()
    h.cap.record([insertStep(1)])
    h.setDoc(docOf('a b c d e f g')) // → 7 words
    await h.cap.close('idle')
    expect(h.month().words_end).toBe(7)

    // Second session: its start MUST be the previous close's end (7), with no re-measure at open.
    h.advance(10 * MIN)
    h.cap.record([insertStep(1)])
    h.setDoc(docOf('a b c d e f g h'))
    await h.cap.close('idle')
    expect(h.rows[1].words_start).toBe(7)
    expect(h.rows[1].net_words).toBe(1)
  })

  it('measures gross adds AND deletes across a restructuring session', async () => {
    const h = harness()
    h.setDoc(docOf('alpha beta gamma delta'))
    await h.bind()
    h.cap.record([insertStep(1)])
    h.setDoc(docOf('alpha zulu gamma omega epsilon')) // beta→zulu, delta→omega, +epsilon
    await h.cap.close('manual')
    const r = h.month()
    expect(r.words_added).toBe(3) // zulu, omega, epsilon
    expect(r.words_deleted).toBe(2) // beta, delta
    expect(r.net_words).toBe(1)
  })

  it('a document switch closes the outgoing session (§A4)', async () => {
    const h = harness()
    await h.bind('d1')
    h.cap.record([insertStep(1)])
    h.advance(MIN)
    await h.bind('d2')
    expect(h.rows).toHaveLength(1)
    expect(h.month().doc_id).toBe('d1')
    expect(h.cap.openSessionId).toBeNull()
  })

  it('closing with nothing open is a no-op (no phantom rows)', async () => {
    const h = harness()
    await h.bind()
    await h.cap.close('idle')
    await h.cap.close('exit')
    expect(h.rows).toEqual([])
  })

  it('the idle watcher closes an abandoned session', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      await h.bind()
      h.cap.record([insertStep(1)])
      h.cap.startIdleWatch()
      h.advance(6 * MIN) // the writer walked away
      await vi.advanceTimersByTimeAsync(31_000)
      expect(h.rows).toHaveLength(1)
      expect(h.cap.openSessionId).toBeNull()
      h.cap.stopIdleWatch()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('breaks are global across documents (§A4: capture is global)', () => {
  it('break_before_min measures the gap since the previous session in ANY document', async () => {
    const h = harness()
    await h.bind('d1')
    h.cap.record([insertStep(1)]) // the only edit, at T0
    h.advance(MIN)
    // A session ENDS at its last edit (T0), not when the close was noticed (T0+1min) — otherwise
    // every session would bank the idle time it took to detect the boundary.
    await h.cap.close('idle')
    expect(h.rows[0].end).toBe('2026-07-17T10:00:00.000+10:00')

    h.advance(20 * MIN) // now T0+21min
    await h.bind('d2')
    h.cap.record([insertStep(1)])
    await h.cap.close('idle')

    expect(h.rows[0].break_before_min).toBe(0) // first session in the ledger
    expect(h.rows[1].doc_id).toBe('d2')
    // 21 min since the previous session's LAST EDIT — measured from work, not from detection.
    expect(h.rows[1].break_before_min).toBe(21)
  })
})

describe('pomodoro framing (§A4: a Pomodoro block writes pomodoro: true)', () => {
  it('sessions started under a running Pomodoro are flagged', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    h.cap.record([insertStep(1)])
    h.advance(MIN)
    await h.cap.close('pomodoro')
    expect(h.month().pomodoro).toBe(true)
  })

  it('sessions outside a Pomodoro are NOT flagged (the flag is not always-true)', async () => {
    const h = harness()
    await h.bind()
    await h.cap.pomodoroStart()
    h.cap.record([insertStep(1)])
    await h.cap.pomodoroStop() // closes the timed block
    h.advance(MIN)
    h.cap.record([insertStep(1)]) // free-form writing after
    await h.cap.close('idle')
    expect(h.rows).toHaveLength(2)
    expect(h.rows[0].pomodoro).toBe(true)
    expect(h.rows[1].pomodoro).toBe(false)
  })

  it('starting a Pomodoro mid-flow closes the untimed session first', async () => {
    const h = harness()
    await h.bind()
    h.cap.record([insertStep(1)])
    h.advance(MIN)
    await h.cap.pomodoroStart()
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0].pomodoro).toBe(false)
  })
})

describe('doc_label suppression (§A3.2)', () => {
  beforeEach(() => setLabelSuppressed('d1', false))

  it('carries the title by default', async () => {
    const h = harness()
    await h.bind()
    h.cap.record([insertStep(1)])
    await h.cap.close('manual')
    expect(h.month().doc_label).toBe('My Essay')
  })

  it('OMITS the title when the document is suppressed — the private journal case', async () => {
    setLabelSuppressed('d1', true)
    const h = harness()
    await h.bind()
    h.cap.record([insertStep(1)])
    await h.cap.close('manual')
    const r = h.month()
    expect('doc_label' in r).toBe(false)
    expect(JSON.stringify(r)).not.toContain('My Essay')
    // ...but the session is still counted: suppressing a title must not erase the work.
    expect(r.doc_id).toBe('d1')
    expect(r.edit_events).toBe(1)
    setLabelSuppressed('d1', false)
  })
})

describe('the place label (user-typed; never auto-detected)', () => {
  function placed(place: () => string | undefined) {
    const rows: SessionRow[] = []
    let now = T0
    const doc = docOf('one two')
    const cap = new SessionCapture({
      clock: () => now, offsetMin: () => 600, newId: () => 's1', placeFn: place,
      sink: (_m, r) => rows.push(r),
    })
    return { cap, rows, doc, tick: (ms: number) => { now += ms } }
  }

  it('stamps the sticky label onto sessions as they close', async () => {
    const h = placed(() => 'library')
    await h.cap.bindDoc({ docId: 'd1', getDoc: () => h.doc })
    h.cap.record([insertStep(1)])
    await h.cap.close('idle')
    expect(h.rows[0].place).toBe('library')
  })

  it('OMITS place entirely when the writer set none — the default is no place at all', async () => {
    const h = placed(() => undefined)
    await h.cap.bindDoc({ docId: 'd1', getDoc: () => h.doc })
    h.cap.record([insertStep(1)])
    await h.cap.close('idle')
    expect('place' in h.rows[0]).toBe(false)
  })

  it('a blank label is absence, not an empty string', async () => {
    const h = placed(() => '   ')
    await h.cap.bindDoc({ docId: 'd1', getDoc: () => h.doc })
    h.cap.record([insertStep(1)])
    await h.cap.close('idle')
    expect('place' in h.rows[0]).toBe(false)
  })
})

describe('the ledger holds no prose (§A3.2, §C1.3)', () => {
  it('a row never contains the text that was written', async () => {
    const h = harness()
    h.setDoc(docOf('Kierkegaard on repetition and recollection'))
    await h.bind()
    h.cap.record([insertStep(20)])
    h.setDoc(docOf('Kierkegaard on repetition and recollection, and the aesthetic stage'))
    await h.cap.close('manual')
    const blob = JSON.stringify(h.month())
    for (const word of ['Kierkegaard', 'repetition', 'recollection', 'aesthetic']) {
      expect(blob).not.toContain(word)
    }
  })
})
