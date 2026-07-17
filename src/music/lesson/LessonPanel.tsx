// The lesson panel (§A3 + §A3b) — consent, bar-pinned notes, and the teacher's recap.
//
// THREE SCREENS, AND THE ORDER IS THE FEATURE:
//   'consent' → the teacher is asked, and nothing exists until they agree (§A3 "Consent first").
//   'notes'   → the student's own panel, each note pinned to a bar (§A3 "Pin feedback to bars").
//   'recap'   → the device is handed over; the teacher leaves a note (§A3b) — the STORABLE side.
//
// The panel never holds a transcript in React state. It renders `session.liveLines()` through a
// subscription, and every note goes into the session. That is deliberate: React state is
// serialisable, devtools-readable, and gets spread into logs — the exact accident session.ts's
// `#private` + `toJSON` firebreak exist to prevent would be reintroduced by lifting lines into
// useState. The session owns the words; this file owns the pixels.
//
// THEMING (CLAUDE.md, mandatory): the outer container carries `iw-nightable`, and every custom
// colour is a theme token with a day fallback — no hard-coded hex.

import { useCallback, useEffect, useRef, useState } from 'react'
import { LessonSession, startSession, type TranscriptLine } from './session'
import type { Assignment, BarAnchor, LessonNote, LessonRecord } from './types'
import * as copy from './copy'

/**
 * What the teacher typed → the note's anchor. §A3's "bar 24 — watch the dynamics".
 *
 * EXTRACTED FROM THE HANDLER SO THE GATE CAN HOLD IT (`LessonPanel.bar.test.ts`). It was inline,
 * and inline meant nothing in the suite could feel it — which is how the bug below stayed live.
 *
 * THE VALUE IS A LABEL, KEPT VERBATIM — never coerced through `Number()`. What a teacher says in a
 * lesson IS a printed bar number, and printed bar numbers are STRINGS by MusicXML spec (see
 * `music/types.ts` BarRef). The old gate — `const n = Number(bar); n > 0 ? {bar: n} : undefined` —
 * SILENTLY DROPPED the anchor for exactly the ordinary cases: **'8a' (a repeat ending) → NaN → no
 * anchor; '0' (a pickup) → not > 0 → no anchor**. The note attached to nothing, no error anywhere.
 * `Number(x)` here is a plausible "tidy-up"; the test is what stops it coming back.
 *
 * `bar_index` — the ordinal JOIN KEY — is deliberately ABSENT: a photo Piece mid-lesson has no bar
 * model to resolve the label against, and BarRef's rule is to carry what you know, resolve later,
 * and never fabricate the key. It fills in once barlines are tapped (§A4) or pre-detected.
 */
export function barAnchorFromInput(input: string): BarAnchor | undefined {
  const bar_label = input.trim()
  return bar_label ? { kind: 'bar', bar_label } : undefined
}

interface Props {
  /** The §1 Piece this lesson belongs to (§A3 organise-by-piece). */
  pieceId: string
  /** Called once, when the lesson ends, with everything that survives it. */
  onRecord: (record: LessonRecord) => void
  onClose: () => void
}

type Screen = 'consent' | 'notes' | 'recap'

export function LessonPanel({ pieceId, onRecord, onClose }: Props) {
  const [screen, setScreen] = useState<Screen>('consent')
  const sessionRef = useRef<LessonSession | null>(null)
  const [notes, setNotes] = useState<readonly LessonNote[]>([])
  const [lines, setLines] = useState<readonly TranscriptLine[]>([])

  // The session is a ref, not state. A live session is not a value to render — it is an object with
  // a lifetime, and putting it in state invites React to clone/serialise it.
  const session = sessionRef.current

  useEffect(() => {
    if (!session) return
    return session.subscribe(setLines)
  }, [session])

  // §A3: the transcript dies with the session — including when the student simply closes the tab or
  // navigates away. Without this the panel could unmount with the session still holding lines.
  useEffect(() => {
    return () => {
      sessionRef.current?.end()
    }
  }, [])

  const begin = useCallback(
    (who: string) => {
      // `piece_id` is §1's field name, verbatim — the schema is a contract shared with
      // `feat/music-piece-photo` and hashed into the provenance record (§A6). Don't tidy it.
      sessionRef.current = startSession({
        piece_id: pieceId,
        consent: { granted: true, granted_at: new Date().toISOString(), ...(who ? { who } : {}) },
      })
      setScreen('notes')
    },
    [pieceId],
  )

  const endLesson = useCallback(() => {
    const s = sessionRef.current
    if (!s) return onClose()
    s.end()
    onRecord(s.toRecord())
    onClose()
  }, [onRecord, onClose])

  return (
    <div
      className="iw-nightable bg-white rounded-lg shadow-lg p-4 max-w-2xl w-full"
      style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)' }}
    >
      {screen === 'consent' && <ConsentGate onBegin={begin} onCancel={onClose} />}
      {screen === 'notes' && session && (
        <NotesScreen
          session={session}
          notes={notes}
          lines={lines}
          onNotes={setNotes}
          onRecap={() => setScreen('recap')}
          onEnd={endLesson}
        />
      )}
      {screen === 'recap' && session && (
        <RecapScreen session={session} onDone={endLesson} onBack={() => setScreen('notes')} />
      )}
    </div>
  )
}

// ─── §A3: Consent first ──────────────────────────────────────────────────────

function ConsentGate({ onBegin, onCancel }: { onBegin: (who: string) => void; onCancel: () => void }) {
  const [who, setWho] = useState('')
  return (
    <div>
      <h2 className="text-lg mb-2" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
        {copy.CONSENT_TITLE}
      </h2>
      {/* The explainer and its limit sit at the SAME weight — a limit the reader has to go looking
          for is a limit the product is hiding (the email lane's rule, and it applies double here,
          where the person being reassured is not the person who chose to install this). */}
      <p className="text-sm mb-2 text-stone-700">{copy.CONSENT_EXPLAINER}</p>
      <p className="text-sm mb-3 text-stone-700">{copy.CONSENT_LIMIT}</p>
      <label className="block text-sm mb-1 text-stone-600" htmlFor="iw-lesson-who">
        Who is teaching today? (optional, for your own record)
      </label>
      <input
        id="iw-lesson-who"
        className="w-full mb-3 px-2 py-1 rounded border text-base"
        style={{ borderColor: 'var(--iw-nightable-border, #d6d3d1)' }}
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder="Ms Tran"
      />
      <div className="flex gap-2 justify-end">
        <button className="px-3 py-1 text-sm text-stone-600" onClick={onCancel}>
          Not now
        </button>
        <button
          className="px-3 py-1 text-sm rounded"
          style={{ background: 'var(--iw-ink, #5c2d8a)', color: '#fff' }}
          onClick={() => onBegin(who.trim())}
        >
          {copy.CONSENT_CONFIRM}
        </button>
      </div>
    </div>
  )
}

// ─── §A3: the notes panel, pinned to bars ────────────────────────────────────

function NotesScreen({
  session,
  notes,
  lines,
  onNotes,
  onRecap,
  onEnd,
}: {
  session: LessonSession
  notes: readonly LessonNote[]
  lines: readonly TranscriptLine[]
  onNotes: (n: readonly LessonNote[]) => void
  onRecap: () => void
  onEnd: () => void
}) {
  const [text, setText] = useState('')
  const [bar, setBar] = useState('')

  const add = () => {
    if (!text.trim()) return
    // §A3's differentiator: "bar 24 — watch the dynamics" → a LessonNote anchored to bar 24.
    // The label rule (and the bug it replaced) lives in `barAnchorFromInput`, above.
    session.note(text, barAnchorFromInput(bar))
    onNotes(session.notes())
    setText('')
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
          {copy.PANEL_TITLE}
        </h2>
        <button className="text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }} onClick={onEnd}>
          {copy.END_LESSON}
        </button>
      </div>
      <p className="text-sm mb-1 text-stone-700">{copy.PANEL_EXPLAINER}</p>
      {/* The session-scoped promise is stated ON the panel it describes, not in a settings page. */}
      <p className="text-xs mb-3" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {copy.SESSION_SCOPE_NOTE}
      </p>

      {/* The live source panel (§A3). On the 'no-audio' source there are no lines and this renders
          nothing — the panel simply IS the student's notes, which §A3 already says is the only
          thing that survives. When a provable local model lands (stt.ts 'local-model'), its lines
          appear here and `distil` is the per-line button. */}
      {lines.length > 0 && (
        <ul className="mb-3 max-h-40 overflow-y-auto text-sm">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-2 py-0.5">
              <span className="flex-1">{l.text}</span>
              <button
                className="text-xs"
                style={{ color: 'var(--iw-light, #9b5ccc)' }}
                onClick={() => {
                  session.distil(l.id)
                  onNotes(session.notes())
                }}
              >
                keep
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 mb-3">
        <input
          className="w-16 px-2 py-1 rounded border text-base"
          style={{ borderColor: 'var(--iw-nightable-border, #d6d3d1)' }}
          value={bar}
          onChange={(e) => setBar(e.target.value)}
          placeholder="bar"
          inputMode="numeric"
          aria-label="Bar number"
        />
        <input
          className="flex-1 px-2 py-1 rounded border text-base"
          style={{ borderColor: 'var(--iw-nightable-border, #d6d3d1)' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="watch the dynamics"
          aria-label="Lesson note"
        />
        <button
          className="px-3 py-1 text-sm rounded"
          style={{ background: 'var(--iw-ink, #5c2d8a)', color: '#fff' }}
          onClick={add}
        >
          Add
        </button>
      </div>

      <ul className="text-sm mb-3">
        {notes.map((n) => (
          <li key={n.id} className="py-0.5">
            {/* The bar rides INSIDE the note's own anchor now (§1's shape), so `PinnedLessonNote`
                is gone. Show the LABEL the teacher gave — never `bar_index`, which is a 0-based
                machine key and would read as the wrong bar number to a human. */}
            {n.anchor?.kind === 'bar' && n.anchor.bar_label && (
              <span className="mr-2 text-xs" style={{ color: 'var(--iw-light, #9b5ccc)' }}>
                bar {n.anchor.bar_label}
              </span>
            )}
            {n.snippet}
          </li>
        ))}
      </ul>

      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          {copy.ORGANISE_NOTE}
        </span>
        <button
          className="px-3 py-1 text-sm rounded"
          style={{ border: '1px solid var(--iw-ink, #5c2d8a)', color: 'var(--iw-ink, #5c2d8a)' }}
          onClick={onRecap}
        >
          Hand to your teacher →
        </button>
      </div>
    </div>
  )
}

// ─── §A3b: the recap — addressed to the teacher, because they are holding the device ──

function RecapScreen({
  session,
  onDone,
  onBack,
}: {
  session: LessonSession
  onDone: () => void
  onBack: () => void
}) {
  const [summary, setSummary] = useState(() => session.recap()?.summary ?? '')
  const [assignments, setAssignments] = useState<readonly Assignment[]>(
    () => session.recap()?.assignments ?? [],
  )
  const [ref, setRef] = useState('')

  const addAssignment = (kind: 'youtube' | 'note') => {
    if (!ref.trim()) return
    session.addAssignment(kind, ref)
    setAssignments(session.recap()?.assignments ?? [])
    setRef('')
  }

  const finish = () => {
    if (summary.trim()) session.setRecap(summary, [...assignments])
    onDone()
  }

  return (
    <div>
      <h2 className="text-lg mb-2" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
        {copy.RECAP_TITLE}
      </h2>
      <p className="text-sm mb-2 text-stone-700">{copy.RECAP_EXPLAINER}</p>
      <textarea
        className="w-full mb-1 px-2 py-1 rounded border text-base"
        style={{ borderColor: 'var(--iw-nightable-border, #d6d3d1)' }}
        rows={4}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Good progress on the Chopin — slow practice on the left hand this week."
        aria-label="Summary for your student"
      />
      {/* The dictation hint points at the TEACHER'S OWN keyboard. Inkwave neither runs nor claims
          anything about that pipeline — their device shows its own indicator and their OS vendor
          makes its own disclosure. See stt.ts for why this is the honest shape. */}
      <p className="text-xs mb-1" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {copy.RECAP_DICTATE_HINT}
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {copy.RECAP_STORABLE_NOTE}
      </p>

      <div className="mb-2">
        <div className="text-sm mb-1" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
          {copy.ASSIGNMENT_ADD}
        </div>
        <p className="text-xs mb-1" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          {copy.ASSIGNMENT_EXPLAINER}
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-2 py-1 rounded border text-base"
            style={{ borderColor: 'var(--iw-nightable-border, #d6d3d1)' }}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="A YouTube link, or a practice note"
            aria-label="For next week"
          />
          <button
            className="px-2 py-1 text-sm rounded"
            style={{ border: '1px solid var(--iw-nightable-border, #d6d3d1)' }}
            onClick={() => addAssignment('youtube')}
          >
            + link
          </button>
          <button
            className="px-2 py-1 text-sm rounded"
            style={{ border: '1px solid var(--iw-nightable-border, #d6d3d1)' }}
            onClick={() => addAssignment('note')}
          >
            + note
          </button>
        </div>
      </div>

      <ul className="text-sm mb-3">
        {assignments.map((a, i) => (
          // §1's Assignment has no id — keyed by position, which is stable here because the list is
          // append-only within a recap and is never reordered.
          <li key={`${a.kind}:${i}`} className="py-0.5">
            <span className="mr-2 text-xs" style={{ color: 'var(--iw-light, #9b5ccc)' }}>
              {a.kind}
            </span>
            {a.ref}
          </li>
        ))}
      </ul>

      <div className="flex justify-between">
        <button className="px-3 py-1 text-sm text-stone-600" onClick={onBack}>
          ← Back
        </button>
        <button
          className="px-3 py-1 text-sm rounded"
          style={{ background: 'var(--iw-ink, #5c2d8a)', color: '#fff' }}
          onClick={finish}
        >
          Done — hand back
        </button>
      </div>
    </div>
  )
}
