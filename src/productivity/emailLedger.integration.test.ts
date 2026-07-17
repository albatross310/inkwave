// @vitest-environment jsdom
//
// THE JOINT PROBE — email → ledger → aggregates → report payload (§B1's PRIMARY GOAL).
//
// WHY THIS FILE EXISTS. `feat/email-compose` closed its report with: "email session rows are
// unproven end-to-end — that needs both branches merged; worth a joint probe." It could not run it:
// it owns `docType: 'email'` but there was no ledger to tag. `feat/prod-ledger` could not run it
// either: it owns the row but nothing in its tree ever set `docType: 'email'`. So the single claim
// the whole email lane exists to serve —
//
//     §B1: "2h10m writing, of which 40m on email"
//
// — has never been verified by anything. Both halves shipped green. This drives the REAL modules
// across the seam: the email lane's `newEmailDocument` → the ledger lane's `SessionCapture` (real
// ProseMirror steps) → the real debounced `ledgerStore` on a real OPFS shim → the real §A3.3
// `aggregate` → the AI-report lane's real `compilePayload`. Nothing here hand-builds the record
// under test; hand-building it is how a suite comes to verify a fiction.
//
// PROVE THE PROBE FIRES BEFORE TRUSTING A PASS. A negative that cannot fail is not a negative, so
// every positive below is paired with a discriminating negative — see `THE PROBE'S OWN NEGATIVES`.
// The bug this is really hunting is a SILENT one: if the doc_type never reached the row, every
// email minute would land under 'essay', the ledger would still look perfectly healthy, and §B1
// would simply never be true. That failure has no error message, which is this house's disease.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import type { InkwaveDocument } from '../types/document'
import { installOpfsShim, resetOpfsShim } from '../email/testOpfsShim'

// EVERY module under test is imported DYNAMICALLY, after the shim is installed — see beforeEach.
// This is not ceremony. `storage/opfsWrite.ts` decides ONCE AT MODULE LOAD whether OPFS writes go
// through createWritable or the parse worker (`hasCreateWritable`), and node has neither
// FileSystemFileHandle nor a worker. Under static imports that constant is already `false` before
// any beforeEach can install the shim, so every ledger write routes to a worker that does not
// exist, throws, and is SWALLOWED by writeAppJson's catch — leaving the probe reading an empty
// ledger and concluding "the email row never arrives". That is a fiction, and it is the exact
// failure this probe exists to detect, which is how it would have been believed. (Cost me a real
// detour; `feat/email-compose`'s roundtrip.test.ts already does it this way — same reason.)
type Mods = {
  newEmailDocument: typeof import('../email/newEmail')['newEmailDocument']
  SessionCapture: typeof import('./capture')['SessionCapture']
  loadLedger: typeof import('./ledgerStore')['loadLedger']
  annotateRow: typeof import('./ledgerStore')['annotateRow']
  aggregateDays: typeof import('./aggregate')['aggregateDays']
  buildWindow: typeof import('./aggregate')['buildWindow']
  loadWindowFromLedger: typeof import('./aggregate')['loadWindowFromLedger']
  compilePayload: typeof import('./report/compile')['compilePayload']
  hasAggregateSource: typeof import('./source')['hasAggregateSource']
  installLedgerSource: typeof import('./installSource')['installLedgerSource']
  setProdLedgerEnabled: typeof import('./ledgerFlag')['setProdLedgerEnabled']
}
let M: Mods

// Real PM steps — countSteps() tests `instanceof ReplaceStep`, so a hand-rolled fake would be a
// fiction that agrees with itself. (Same construction the ledger lane's own capture.test.ts uses.)
const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
const insertStep = (chars: number): Step =>
  new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text('x'.repeat(chars))), 0, 0))

const T0 = Date.UTC(2026, 6, 17, 0, 0, 0) // 10:00 Brisbane (+10)
const MIN = 60_000
const BNE = 600

/** A plain (non-email) essay document — the contrast case. */
function essayDoc(text: string): InkwaveDocument {
  return {
    id: 'doc-essay',
    title: 'Seminar paper draft',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  } as InkwaveDocument
}

/** Grow an email document's body — the writer composing. */
function withBody(email: InkwaveDocument, text: string): InkwaveDocument {
  return {
    ...email,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  }
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

/**
 * Drive one real session to `activeMinutes` of measured active time.
 *
 * The first edit OPENS the draft at activeMs 0; each later edit adds its gap capped at 60s
 * (ACTIVE_GAP_CAP_MS). So N edits at 60s spacing after the open = exactly N active minutes — real
 * arithmetic from the real rule, not a number we asserted into existence.
 */
async function writeFor(
  cap: InstanceType<Mods['SessionCapture']>,
  clock: { now: number },
  activeMinutes: number,
): Promise<void> {
  cap.record([insertStep(5)]) // opens the session
  for (let i = 0; i < activeMinutes; i++) {
    clock.now += MIN
    cap.record([insertStep(5)])
  }
}

function harness() {
  const clock = { now: T0 }
  let doc: InkwaveDocument = essayDoc(words(10))
  let n = 0
  const cap = new M.SessionCapture({
    clock: () => clock.now,
    offsetMin: () => BNE,
    newId: () => `s${++n}`,
    // NOTE: no `sink` override — this is the DEFAULT sink (queueRow), so rows travel the real
    // debounced ledgerStore write path onto the real OPFS shim. A test sink would have skipped
    // exactly the persistence this probe is meant to cross.
    placeFn: () => undefined,
  })
  return {
    cap,
    clock,
    setDoc: (d: InkwaveDocument) => { doc = d },
    bind: (docId: string) => cap.bindDoc({ docId, getDoc: () => doc }),
  }
}

beforeEach(async () => {
  vi.resetModules()   // fresh module singletons: ledger buffer, aggregate source, flag cache
  resetOpfsShim()
  installOpfsShim()   // MUST precede the imports below — see the note at the top of this file
  localStorage.clear()

  const [email, capture, store, agg, compile, source, install, flag] = await Promise.all([
    import('../email/newEmail'), import('./capture'), import('./ledgerStore'), import('./aggregate'),
    import('./report/compile'), import('./source'), import('./installSource'), import('./ledgerFlag'),
  ])
  M = {
    newEmailDocument: email.newEmailDocument,
    SessionCapture: capture.SessionCapture,
    loadLedger: store.loadLedger,
    annotateRow: store.annotateRow,
    aggregateDays: agg.aggregateDays,
    buildWindow: agg.buildWindow,
    loadWindowFromLedger: agg.loadWindowFromLedger,
    compilePayload: compile.compilePayload,
    hasAggregateSource: source.hasAggregateSource,
    installLedgerSource: install.installLedgerSource,
    setProdLedgerEnabled: flag.setProdLedgerEnabled,
  }
})

// ═══ THE PRIMARY GOAL (§B1) ══════════════════════════════════════════════════════════════════════

describe('§B1 — "2h10m writing, of which 40m on email"', () => {
  it('THE CROSS-BRANCH SEAM: composing an email produces a ledger row tagged doc_type email', async () => {
    const h = harness()
    const email = M.newEmailDocument({ to: ['ada@example.edu'], subject: 'Draft chapter for Thursday' })
    let live: InkwaveDocument = email
    await h.cap.bindDoc({ docId: email.id, getDoc: () => live })

    await writeFor(h.cap, h.clock, 40)
    live = withBody(email, words(220)) // the composed message
    await h.cap.closeAndFlush('exit')

    const ledger = await M.loadLedger('2026-07')
    expect(ledger.rows).toHaveLength(1)
    const row = ledger.rows[0]

    // THE claim: the email lane's docType reached the ledger lane's row. Neither branch could
    // assert this alone.
    expect(row.doc_type).toBe('email')
    expect(row.active_minutes).toBe(40)
    // The subject rides as doc_label (titleForEmail's rule, via the document title).
    expect(row.doc_label).toBe('Draft chapter for Thursday')
    // Data minimisation (§A3.2): the message itself never enters the ledger.
    expect(JSON.stringify(ledger)).not.toContain('ada@example.edu')
    expect(JSON.stringify(ledger)).not.toContain('w219')
  })

  it('the split reaches the AGGREGATES — 130 active minutes, of which 40 are email', async () => {
    const h = harness()

    h.setDoc(essayDoc(words(10)))
    await h.bind('doc-essay')
    await writeFor(h.cap, h.clock, 90)
    h.setDoc(essayDoc(words(400)))
    await h.cap.close('doc-switch')

    h.clock.now += 20 * MIN
    const email = M.newEmailDocument({ to: ['ada@example.edu'], subject: 'Draft chapter for Thursday' })
    let live: InkwaveDocument = email
    await h.cap.bindDoc({ docId: email.id, getDoc: () => live })
    await writeFor(h.cap, h.clock, 40)
    live = withBody(email, words(220))
    await h.cap.closeAndFlush('exit')

    const rows = (await M.loadLedger('2026-07')).rows
    expect(rows).toHaveLength(2)

    // §A3.3 day rollup, through the REAL aggregate (the chart lane's rollup, over the ledger
    // lane's rows — the two modules this merge unified onto one schema).
    const [day] = M.aggregateDays(rows)
    expect(day.activeMinutes).toBe(130)          // 2h10m — the spec's sentence, measured
    expect(day.minutesByDocType.email).toBe(40)  // "of which 40m on email"
    expect(day.minutesByDocType.essay).toBe(90)
    // The parts are the whole: nothing invented, nothing lost.
    expect(day.minutesByDocType.email + day.minutesByDocType.essay).toBe(day.activeMinutes)

    // And the per-document view the report's tick-box screen reads (§A7.3).
    const w = M.buildWindow('daily', '2026-07-17', rows)
    const emailDoc = w.docs.find((d) => d.doc_type === 'email')!
    expect(emailDoc.active_minutes).toBe(40)
    expect(emailDoc.doc_label).toBe('Draft chapter for Thursday')
  })

  it('the email session reaches the REPORT PAYLOAD, tagged, with no message text', async () => {
    const h = harness()
    const email = M.newEmailDocument({ to: ['ada@example.edu'], subject: 'Draft chapter for Thursday' })
    let live: InkwaveDocument = email
    await h.cap.bindDoc({ docId: email.id, getDoc: () => live })
    await writeFor(h.cap, h.clock, 40)
    live = withBody(email, words(220))
    await h.cap.closeAndFlush('exit')

    const agg = M.buildWindow('daily', '2026-07-17', (await M.loadLedger('2026-07')).rows)
    const payload = M.compilePayload({ agg })

    // The model is told this time was email — that is what lets it say "40m on email".
    expect(payload.data).toContain('email')
    expect(payload.data).toContain('Draft chapter for Thursday')
    // §A7.3: the writer opted into NOTHING, so no prose — not the message, not the address.
    expect(payload.data).not.toContain('ada@example.edu')
    expect(payload.data).not.toContain('w219')
    expect(payload.contentIncluded).toBe(false)
    expect(payload.notesIncluded).toBe(false)
  })

  it('reaches the report through the INSTALLED source — the seam the app actually uses', async () => {
    M.setProdLedgerEnabled(true) // the app's own gate; see the negative below
    const h = harness()
    const email = M.newEmailDocument({ to: ['ada@example.edu'], subject: 'Draft chapter for Thursday' })
    let live: InkwaveDocument = email
    await h.cap.bindDoc({ docId: email.id, getDoc: () => live })
    await writeFor(h.cap, h.clock, 40)
    live = withBody(email, words(220))
    await h.cap.closeAndFlush('exit')

    M.installLedgerSource()
    expect(M.hasAggregateSource()).toBe(true)

    const w = await M.loadWindowFromLedger('daily', '2026-07-17')
    expect(w!.docs.find((d) => d.doc_type === 'email')!.active_minutes).toBe(40)
  })
})

// ═══ THE TIER-2 CARRIER ACROSS THE SEAM (§A7.3 + §A6.4) ═════════════════════════════════════════
//
// The ledger lane DECIDED (answering prod-ai-report's open contract question) that `sessions` is []
// at weekly/monthly and opted-in notes travel as `note_digest` instead — because session rows at
// monthly would put a SECOND copy of every measured number beside the day rollups. The AI-report
// lane was built BEFORE that answer existed, against the assumption it could read notes off
// `agg.sessions` at every window. Both are green in isolation. Together, the writer's notes had
// nowhere to arrive from at weekly/monthly.

describe('the writer\'s opted-in notes survive the ledger→report seam at EVERY window', () => {
  async function ledgerWithANote() {
    const h = harness()
    const email = M.newEmailDocument({ to: ['ada@example.edu'], subject: 'Draft chapter for Thursday' })
    let live: InkwaveDocument = email
    await h.cap.bindDoc({ docId: email.id, getDoc: () => live })
    await writeFor(h.cap, h.clock, 40)
    live = withBody(email, words(220))
    await h.cap.closeAndFlush('exit')
    // The writer's diary line, written through the REAL annotate path the ledger view uses.
    const row = (await M.loadLedger('2026-07')).rows[0]
    await M.annotateRow('2026-07', row.session_id, { note: 'Wrote the supervisor note at last.', place: 'library' })
  }

  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    it(`carries the note at ${window} when the writer opts in`, async () => {
      await ledgerWithANote()
      const agg = (await M.loadWindowFromLedger(window, '2026-07-17'))!
      // Notes and places are SEPARATE ticks (Peter, 2026-07-17) — opt into both here; the
      // independence of the two is pinned in report/compile.test.ts.
      const payload = M.compilePayload({ agg, includeNotes: true, includePlaces: true })

      expect(payload.notesIncluded).toBe(true)
      expect(payload.placesIncluded).toBe(true)
      expect(payload.data).toContain('Wrote the supervisor note at last.')
      expect(payload.data).toContain('library')
    })

    it(`carries the note but NOT the place at ${window} with only the notes tick`, async () => {
      // The seam-level proof of the split: the ledger→report path must honour each tick on its
      // own, not just the pure compile step.
      await ledgerWithANote()
      const agg = (await M.loadWindowFromLedger(window, '2026-07-17'))!
      const payload = M.compilePayload({ agg, includeNotes: true })
      expect(payload.notesIncluded).toBe(true)
      expect(payload.placesIncluded).toBe(false)
      expect(payload.data).toContain('Wrote the supervisor note at last.')
      expect(payload.data).not.toContain('library')
    })

    it(`does NOT carry the note at ${window} without the opt-in (§A7.3)`, async () => {
      // The negative for the above: tier 2 is off by default, so the same ledger must yield a
      // payload with no prose at all. Without this, "carries the note" would pass for a payload
      // that always leaked it.
      await ledgerWithANote()
      const agg = (await M.loadWindowFromLedger(window, '2026-07-17'))!
      const payload = M.compilePayload({ agg })
      expect(payload.notesIncluded).toBe(false)
      expect(payload.placesIncluded).toBe(false)
      expect(payload.data).not.toContain('Wrote the supervisor note at last.')
      expect(payload.data).not.toContain('library')
    })
  }

  it('§A6.4 HOLDS: weekly/monthly still send ONE copy of the measured numbers', async () => {
    await ledgerWithANote()
    for (const window of ['weekly', 'monthly'] as const) {
      const agg = (await M.loadWindowFromLedger(window, '2026-07-17'))!
      expect(agg.sessions).toEqual([]) // the ledger's decided contract
      const payload = M.compilePayload({ agg, includeNotes: true })
      // The note arrives, but NOT a second copy of every measured number beside the day rollups.
      expect(payload.data).toContain('Wrote the supervisor note at last.')
      expect(payload.data).not.toContain('SESSIONS\n')
      expect(payload.data).not.toContain('words_start')
    }
  })
})

// ═══ THE PROBE'S OWN NEGATIVES — it must be able to FAIL ═════════════════════════════════════════
//
// Each of these fails the merge if the corresponding wire is cut. Without them a green run above
// would prove only that the test file executed.

describe('THE PROBE FIRES (a negative that cannot fail is not a negative)', () => {
  it('KNOWN-NEGATIVE: a non-email document does NOT produce an email row', async () => {
    // The discriminator. This positive/negative PAIR is what makes the doc_type assertion mean
    // something: a `doc_type` hard-wired to 'email' passes the tests above and fails here; a
    // doc_type that never reads the document (the real bug — every email minute silently filed as
    // 'essay') passes here and fails above. No constant satisfies both.
    const h = harness()
    h.setDoc(essayDoc(words(10)))
    await h.bind('doc-essay')
    await writeFor(h.cap, h.clock, 40)
    h.setDoc(essayDoc(words(200)))
    await h.cap.closeAndFlush('exit')

    const rows = (await M.loadLedger('2026-07')).rows
    expect(rows[0].doc_type).toBe('essay')
    expect(rows[0].doc_type).not.toBe('email')

    const [day] = M.aggregateDays(rows)
    expect(day.minutesByDocType.email).toBeUndefined() // no email minutes invented from nowhere
  })

  it('KNOWN-NEGATIVE: with the ledger flag OFF, no source is installed', async () => {
    // The app-level gate (`prodLedgerEnabled`) is what keeps this whole lane default-OFF. If it
    // could not fire, the flag would be decorative — and per installSource.ts's own reasoning, a
    // source installed with capture off would make the panel report "you did nothing" instead of
    // "tracking is off": a false statement dressed as a measurement.
    M.setProdLedgerEnabled(false)
    M.installLedgerSource()
    expect(M.hasAggregateSource()).toBe(false)
    expect(await M.loadWindowFromLedger('daily', '2026-07-17')).toBeNull() // and no ledger to read
  })

  it('KNOWN-NEGATIVE: an empty ledger yields NO window — it never invents a zero day', async () => {
    expect(await M.loadWindowFromLedger('daily', '2026-07-17')).toBeNull()
  })

  it('the probe would SEE a lost row: the ledger is empty until the session actually closes', async () => {
    // Proves the persistence leg is real rather than incidentally satisfied: before close there is
    // nothing on disk, so the rows read above genuinely travelled the write path.
    const h = harness()
    const email = M.newEmailDocument({ subject: 'Draft chapter for Thursday' })
    await h.cap.bindDoc({ docId: email.id, getDoc: () => email })
    await writeFor(h.cap, h.clock, 5)
    expect((await M.loadLedger('2026-07')).rows).toHaveLength(0) // open session — nothing written yet
    await h.cap.closeAndFlush('exit')
    expect((await M.loadLedger('2026-07')).rows).toHaveLength(1)
  })
})
