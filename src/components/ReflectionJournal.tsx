// The reflective journal (Peter, 2026-07-17: the per-category comments "become a reflective
// journal"). ReflectionPrompt WRITES a reflection; nothing on master ever READ one back, so the
// journal existed on disk and nowhere on screen. This is the read side — the writer's own words,
// kept and revisitable, so the reflection is a journal and not a form they fill and never see again.
//
// READ-ONLY, and that is the whole register (§A5). Nothing here is editable, graded, scored or
// counted; there is no input, so the iOS 16px trap cannot bind it (prodType.test.ts). It is a quiet
// record of what the writer said they were doing, in the order they said it.

import type { Reflection } from '../productivity/types'
import { TYPE } from '../music/typeScale'
import { CATEGORY_LABEL } from './ReflectionPrompt'

// Enough to feel like a record without turning the drop-up into an archive. The panel scrolls, so
// this is about weight, not fit: a month of daily reflections beneath today's work is noise.
const MAX_SHOWN = 12

/** 'YYYY-MM-DD' → "Thu 17 Jul", in the writer's own locale. Falls back to the raw day on a bad parse. */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function ReflectionJournal({ reflections }: { reflections: Reflection[] }): JSX.Element | null {
  // Most recent first. An entry with no notes is not a journal entry — the writer opened the prompt
  // and said nothing, which is theirs to do and not something to display back at them as blank.
  const entries = reflections
    .filter((r) => r.notes.length > 0)
    .sort((a, b) => (a.to < b.to ? 1 : -1))
    .slice(0, MAX_SHOWN)

  if (entries.length === 0) return null

  return (
    <section className="px-4 py-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      <h3 className="mb-1 uppercase tracking-wider" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        Journal
      </h3>
      <p className="mb-2.5 leading-relaxed" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        Your own words, kept. Nothing here is graded or sent anywhere.
      </p>
      <ul className="space-y-3">
        {entries.map((r) => (
          <li key={r.reflection_id}>
            <div className="mb-1" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{formatDay(r.day)}</div>
            <ul className="space-y-1.5">
              {r.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0" style={{ fontSize: TYPE.meta, color: 'var(--iw-light, #9b5ccc)' }}>
                    {CATEGORY_LABEL[n.doc_type]}
                  </span>
                  <span className="leading-relaxed" style={{ fontSize: TYPE.body, color: 'var(--iw-pill-fg, #78716c)' }}>
                    {n.text}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
