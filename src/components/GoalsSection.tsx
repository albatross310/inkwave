// §A5b — goals, a rough plan, and a timeline, in the clock drop-up (Peter, 2026-07-17:
// "yes all in productivity clock icon button").
//
// ─── THE REGISTER, precisely ─────────────────────────────────────────────────────────────────
// Peter: "Hint of irony and sarcasm is encouraged, along with some genuine warmth."
// That is NARROWER than "not kind", and much narrower than blunt. It is a friend who takes the
// mickey BECAUSE they are on your side — not a drill sergeant, not a wellness app, not a coach.
// The wryness is only ever aimed at a deadline THE WRITER SET (§A5b: guilt is a standard imposed
// on you; accountability is a goal you set). Two hard limits, both live in this file:
//   • NEVER grade the writing. Nothing here reads the prose, and no copy may imply a judgement of
//     it. "Three days late" is about a date he chose; "this chapter is weak" is not ours to say.
//   • NO GOAL ⇒ NO STANDARD. The empty state offers; it does not nag. There is nothing to be late
//     for until he says there is.
// Warmth is what stops irony curdling: a missed date gets a raised eyebrow, never a red number.

import { useCallback, useEffect, useState } from 'react'
import type { DocGoals, DocMilestone } from '../types/document'
import {
  addMilestone, milestoneStatus, removeMilestone, setPlan, toggleMilestone, updateMilestone,
  type GoalStatus,
} from '../productivity/goals'
import { isoWithOffset, localDayOf } from '../productivity/sessionLogic'

const nowIso = (): string => isoWithOffset(Date.now(), -new Date().getTimezoneOffset())

const todayLocal = (): string => localDayOf(isoWithOffset(Date.now(), -new Date().getTimezoneOffset()))

/**
 * How a status reads on the writer's own screen. Wry, warm, and never red — the colour stays the
 * muted pill grey for everything except a met goal, which is allowed to look pleased with itself.
 */
function statusLine(status: GoalStatus, days?: number): { text: string; tone: 'good' | 'muted' } {
  switch (status) {
    case 'met':
      return { text: 'done, and on time', tone: 'good' }
    case 'met-late':
      // Warmth first: it got finished. The irony is gentle and aimed at the date, not the writer.
      return { text: 'done — fashionably late', tone: 'good' }
    case 'missed': {
      const d = Math.abs(days ?? 0)
      return {
        text: d === 1 ? 'a day past its date' : `${d} days past its date`,
        tone: 'muted',
      }
    }
    case 'due-today':
      return { text: 'due today. No pressure.', tone: 'muted' }
    case 'upcoming':
      return { text: days === 1 ? 'due tomorrow' : `due in ${days} days`, tone: 'muted' }
    case 'undated':
      return { text: 'someday', tone: 'muted' }
  }
}

/**
 * Goals live on the DOCUMENT (types/document.ts DocGoals) and are persisted by the editor's own
 * autosave — this component is a pure face over `goals` + `onChange`. It deliberately owns no
 * storage: a second writer for one field is how the UI and the report's seam end up disagreeing.
 */
export function GoalsSection({ goals: g, docLabel, onChange }: {
  goals?: DocGoals; docLabel?: string; onChange: (next: DocGoals) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [plan, setPlanText] = useState(g?.plan ?? '')

  useEffect(() => { setPlanText(g?.plan ?? '') }, [g?.plan])

  const add = useCallback(() => {
    if (!text.trim()) return
    onChange(addMilestone(g, text, due || undefined, nowIso()))
    setText('')
    setDue('')
  }, [g, onChange, text, due])

  const today = todayLocal()
  const goals = g?.milestones ?? []

  return (
    <>
      <section className="px-4 py-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
        <h3 className="mb-2 text-[11px] uppercase tracking-wider" style={{ color: 'var(--iw-pill-fg, #a8a29e)' }}>
          Goals — {docLabel ?? 'this document'}
        </h3>

        {goals.length === 0 && (
          // The empty state OFFERS. It does not nag: with nothing set there is nothing to be late
          // for, and §A5b forbids inventing a standard he never asked for.
          <p className="mb-2 text-[12px] leading-relaxed" style={{ color: 'var(--iw-pill-fg, #a8a29e)' }}>
            Nothing set — which is a perfectly good way to live. A date, though, is harder to argue
            with later.
          </p>
        )}

        <ul className="space-y-1.5">
          {goals.map((goal) => (
            <GoalRow key={goal.id} goals={g} goal={goal} today={today} onChange={onChange} />
          ))}
        </ul>

        <div className="mt-2 flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="finish the lit review…"
            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[13px]"
            style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
          />
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            title="By when? (optional — but it's the whole point)"
            className="rounded-md px-1.5 py-1.5 text-[12px]"
            style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent', color: 'var(--iw-pill-fg, #78716c)' }}
          />
          <button
            type="button" onClick={add} title="Add goal"
            className="shrink-0 rounded-md px-2.5 text-[13px] transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)' }}
          >
            +
          </button>
        </div>
      </section>

      <section className="px-4 py-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
        <h3 className="mb-1.5 text-[11px] uppercase tracking-wider" style={{ color: 'var(--iw-pill-fg, #a8a29e)' }}>The rough plan</h3>
        <textarea
          value={plan}
          onChange={(e) => setPlanText(e.target.value)}
          onBlur={() => onChange(setPlan(g, plan, nowIso()))}
          rows={3}
          // §A5b: informal on purpose — a plan nobody writes is worse than a vague one.
          placeholder="Roughly how this gets done. Bullet points, half-sentences, wishful thinking — all fine."
          className="w-full resize-y rounded-md px-2 py-1.5 text-[13px]"
          style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--iw-pill-fg, #a8a29e)' }}>
          Your goals stay on this device. They only reach an AI if you tick them on when you run a
          report — and then it&rsquo;ll have opinions about how you&rsquo;re tracking.
        </p>
      </section>
    </>
  )
}

function GoalRow({ goals, goal, today, onChange }: {
  goals?: DocGoals; goal: DocMilestone; today: string; onChange: (g: DocGoals) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.text)
  const [draftDue, setDraftDue] = useState(goal.due ?? '')
  const { status, days_remaining } = milestoneStatus(goal, today)
  const line = statusLine(status, days_remaining)
  const done = !!goal.done_at

  const save = () => {
    setEditing(false)
    onChange(updateMilestone(goals, goal.id, { text: draft, due: draftDue }, nowIso()))
  }

  if (editing) {
    return (
      <li className="flex gap-1.5">
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-[13px]"
          style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
        />
        <input
          type="date" value={draftDue} onChange={(e) => setDraftDue(e.target.value)}
          className="rounded-md px-1.5 py-1 text-[12px]"
          style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent', color: 'var(--iw-pill-fg, #78716c)' }}
        />
        <button type="button" onClick={save} className="shrink-0 px-1.5 text-[12px]" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>✓</button>
      </li>
    )
  }

  return (
    <li className="group flex items-baseline gap-2">
      <button
        type="button"
        onClick={() => onChange(toggleMilestone(goals, goal.id, nowIso()))}
        title={done ? 'Not done after all?' : 'Done'}
        className="shrink-0 text-[12px] leading-none"
        style={{ color: done ? 'var(--iw-verified, #15803d)' : 'var(--iw-pill-fg, #a8a29e)' }}
      >
        {done ? '☑' : '☐'}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onDoubleClick={() => setEditing(true)} className="block w-full truncate text-left text-[13px]"
          title="Double-click to edit"
          style={{ color: done ? 'var(--iw-pill-fg, #a8a29e)' : 'var(--iw-ink, #5c2d8a)', textDecoration: done ? 'line-through' : undefined }}
        >
          {goal.text}
        </button>
        <span className="text-[11px]" style={{ color: line.tone === 'good' ? 'var(--iw-verified, #15803d)' : 'var(--iw-pill-fg, #a8a29e)' }}>
          {goal.due ? `${goal.due} · ` : ''}{line.text}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(removeMilestone(goals, goal.id, nowIso()))}
        title="Remove"
        className="shrink-0 text-[12px] opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: 'var(--iw-pill-fg, #a8a29e)' }}
      >
        ×
      </button>
    </li>
  )
}
