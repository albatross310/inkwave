// §A5b — "what did I actually do?" (Peter, 2026-07-17).
//
// ─── THE DESIGN, AND THE BAR ─────────────────────────────────────────────────────────────────
// THE CHART IS THE RECALL PROMPT. It shows the writer the stretch we MEASURED — an hour here,
// forty minutes there — and asks them to name it. That is why it fires while the stretch is warm
// (25 ACTIVE minutes, once, never re-prompted) and not at day's close, when nobody can remember.
//
// IT IS ALSO WHAT RESCUES `misc`. Nothing sets a type on an ordinary document, so most measured
// time is an honest unknown. This is the only place it becomes knowledge — and it becomes knowledge
// the way it should: the writer says so, rather than a heuristic guessing from length or title.
//
// §A5, and every word of copy here is bound by it:
//   · ALWAYS SKIPPABLE. Skip is a plain, equal button, not a grey escape hatch.
//   · A SKIPPED REFLECTION IS NOT A FAILURE, and nothing may ever count them.
//   · NEVER GRADE THE WRITING. We show minutes; we do not show a verdict.
//   · Ironic-but-warm, per Peter's register — a friend taking the mickey because they're on your
//     side. The wryness is aimed at the CLOCK, never at the work.
// THE BAR: would he fill this in on a bad Tuesday? If a line would make him close the panel on a
// bad day, it is wrong, however clever it is.

import { useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { DocType, Reflection, SessionRow } from '../productivity/types'
import { localDayOf } from '../productivity/sessionLogic'
// The drop-up's ONE ramp (Peter, 2026-07-17: "every font proportionally up"). This section renders
// INSIDE `LedgerDropUp`, so a private scale here would be a visible seam mid-panel.
import { TOUCH_MIN, TYPE } from '../music/typeScale'

/** What each category is called when we hand it back to the writer. Exported so the read-back
 *  journal (`ReflectionJournal`) names categories the SAME way it does here — one label table, so
 *  "reading" in the prompt and "reading" in the journal can never drift. */
export const CATEGORY_LABEL: Record<DocType, string> = {
  essay: 'the essay',
  note: 'notes',
  email: 'email',
  // A `music` document IS a Piece (§1) — a photographed score the writer is working on, not prose.
  music: 'the score',
  reading: 'reading',
  annotating: 'annotating',
  other: 'other work',
  // `misc` is the common case and must not read as an accusation ("unclassified", "unknown").
  // It is OUR ignorance, not his: we measured the time and simply do not know what it was.
  misc: 'that stretch',
}

const mins = (rows: SessionRow[]): number => Math.round(rows.reduce((a, r) => a + r.active_minutes, 0))

/**
 * The measured stretch, per category — the recall prompt itself.
 * Categories with under a minute are dropped: they are noise, not something to be asked about.
 */
export function stretchByCategory(rows: SessionRow[]): Array<{ doc_type: DocType; minutes: number }> {
  const by = new Map<DocType, SessionRow[]>()
  for (const r of rows) {
    const list = by.get(r.doc_type)
    if (list) list.push(r)
    else by.set(r.doc_type, [r])
  }
  return [...by.entries()]
    .map(([doc_type, rs]) => ({ doc_type, minutes: mins(rs) }))
    .filter((c) => c.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes)
}

/** A warm, wry opener that is TRUE on a bad Tuesday as well as a good Friday. */
function opener(total: number): string {
  if (total >= 120) return `${total} minutes. Before it all blurs — what was that?`
  if (total >= 50) return `${total} minutes in. What were you actually doing?`
  return `${total} focused minutes. What was that, while you remember?`
}

export function ReflectionPrompt({ rows, onSave, onSkip }: {
  rows: SessionRow[]
  onSave: (r: Reflection) => void
  onSkip: () => void
}): JSX.Element | null {
  const cats = useMemo(() => stretchByCategory(rows), [rows])
  const [text, setText] = useState<Partial<Record<DocType, string>>>({})

  if (!rows.length || !cats.length) return null

  const total = cats.reduce((a, c) => a + c.minutes, 0)
  // The bar chart's scale — the biggest stretch fills the track, the rest read against it. Peter's
  // "show the simple bar chart of each of these categories": a category IS its measured minutes, so
  // the bar is the thing being commented on, drawn beside the box the comment goes in.
  const maxMinutes = Math.max(1, ...cats.map((c) => c.minutes))

  const save = () => {
    // A category they said nothing about is ABSENT — never an empty string. Silence is not an answer
    // we get to record on their behalf.
    const notes = cats
      .map((c) => ({ doc_type: c.doc_type, text: (text[c.doc_type] ?? '').trim() }))
      .filter((n) => n.text.length > 0)
    const sorted = [...rows].sort((a, b) => (a.start < b.start ? -1 : 1))
    onSave({
      reflection_id: uuidv4(),
      day: localDayOf(sorted[0].start),
      from: sorted[0].start,
      to: sorted[sorted.length - 1].end,
      notes,
    })
  }

  return (
    <section className="px-4 py-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      <h3 className="mb-1 uppercase tracking-wider" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        While it&rsquo;s fresh
      </h3>
      <p className="mb-2.5 leading-relaxed" style={{ fontSize: TYPE.body, color: 'var(--iw-pill-fg, #78716c)' }}>
        {opener(total)}
      </p>

      <ul className="space-y-2">
        {cats.map((c) => (
          <li key={c.doc_type}>
            <label className="mb-1 flex items-baseline justify-between gap-2">
              <span style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #35283e)' }}>{CATEGORY_LABEL[c.doc_type]}</span>
              <span className="shrink-0 tabular-nums" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
                {c.minutes}m
              </span>
            </label>
            {/* The simple bar chart (Peter). Calm, no red: the track is the panel's own hairline, the
                fill the light accent — a measure, never a score. Proportional to the day's biggest
                stretch so the categories read against each other at a glance. */}
            <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--iw-nightable-border, #f0eeec)' }}>
              <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.round((c.minutes / maxMinutes) * 100)}%`, minWidth: 4, background: 'var(--iw-light, #484965)', opacity: 0.75 }} />
            </div>
            <input
              value={text[c.doc_type] ?? ''}
              onChange={(e) => setText((t) => ({ ...t, [c.doc_type]: e.target.value }))}
              placeholder={c.doc_type === 'misc' ? 'reading Leibniz, on paper…' : 'a line, if you like'}
              className="w-full rounded-md px-2 py-1.5"
              // TYPE.body — the writer types INTO this. At the old 13px iOS zoomed on focus and
              // STAYED zoomed, which on a recall prompt means it happened mid-thought.
              style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button" onClick={save}
          className="rounded-full px-4 py-1.5 transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, background: 'var(--iw-ink, #35283e)', color: 'var(--iw-on-ink, #fff)' }}
        >
          Save
        </button>
        {/* Skip is a PEER of Save, not a grey escape hatch. It must cost nothing to press. */}
        <button
          type="button" onClick={onSkip}
          // Skip stays a PEER of Save — same step on the ramp, same touch target. Making it smaller
          // would be exactly the grey escape hatch the header forbids.
          className="rounded-full px-4 py-1.5 transition-colors hover:bg-stone-50"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
        >
          Not now
        </button>
      </div>
    </section>
  )
}
