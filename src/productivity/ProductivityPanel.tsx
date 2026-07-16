// The productivity report panel — build-spec §A3.3, §A5, §A6.1, §A6.2, §A8, §C3.
//
// THEMING (CLAUDE.md, mandatory): the outer container carries `iw-nightable`, and every custom
// colour is a theme token with a day fallback — `var(--iw-ink, #5c2d8a)` etc. A panel without
// `iw-nightable` renders white-on-white in night mode.
//
// LOAD PERFORMANCE (CLAUDE.md, sacred): nothing here runs on the load path. The panel is reached
// only from its own flag-gated route, the aggregation is pure and runs when the panel mounts, and
// it reads the LEDGER — never the .studio, never the doc.
//
// WHAT THIS PANEL WILL AND WON'T SAY:
//  • Measured numbers (solid) are computed client-side and are ground truth (§A6.4).
//  • The phase mix is a RULE (dashed outline) — an inference, labelled as one.
//  • AI judgements (hatched amber) are interpretation, and can never paint as a measured bar
//    (charts/series.ts makes that structural, not a convention).
//  • The daily window is a recap. Pattern/causal claims are gated out of it entirely (§A6.2).

import { useMemo, useState } from 'react'
import { BarChart, HourHistogram, Legend, LineChart, PhaseMixBar } from './charts/Charts'
import type { Series } from './charts/series'
import type { DayAggregate, LedgerAggregates, MonthAggregate, WeekAggregate } from './aggregate'
import { comparePhases, selectClaims, type JudgedReport, type ReportWindow } from './judged'
import type { LedgerSession } from './ledger'
import { classifySession } from './phase'
import { DAILY_CAVEAT, dayDetail, dayHeadline, describeCorrelation, formatMinutes } from './summary'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface ProductivityPanelProps {
  aggregates: LedgerAggregates
  /** The ledger rows the aggregates were built from — used only to compare the rule against the AI. */
  sessions?: readonly LedgerSession[]
  /** The AI half (§A6.1). Absent until the writer runs the AI path — the panel is complete without it. */
  judged?: JudgedReport
  /** Demo mode renders fixture data; the panel says so rather than implying it's the writer's record. */
  demo?: boolean
}

export function ProductivityPanel({ aggregates, sessions, judged, demo }: ProductivityPanelProps) {
  const [window, setWindow] = useState<ReportWindow>('week')
  const { days, weeks, months } = aggregates

  // Latest of each — the window a writer actually wants on opening.
  const day = days[days.length - 1]
  const week = weeks[weeks.length - 1]
  const month = months[months.length - 1]

  const claims = useMemo(() => selectClaims(judged?.claims ?? [], window), [judged, window])

  return (
    <div
      // iw-nightable: the single most important line in this file (CLAUDE.md THEMING).
      className="iw-nightable bg-white rounded-lg shadow-lg p-5 font-serif max-w-3xl mx-auto"
      style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)' }}
    >
      <header className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h1 className="text-lg" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Your writing</h1>
        <nav className="flex gap-1" role="tablist" aria-label="Report window">
          {(['day', 'week', 'month'] as ReportWindow[]).map(w => (
            <button
              key={w} type="button" role="tab" aria-selected={window === w}
              onClick={() => setWindow(w)}
              className="px-3 py-1 text-xs rounded-full border transition-colors"
              style={{
                borderColor: 'var(--iw-nightable-border, #e7e5e4)',
                background: window === w ? 'var(--iw-ink, #5c2d8a)' : 'transparent',
                color: window === w ? 'var(--iw-paper, #fff)' : 'var(--iw-pill-fg, #78716c)',
              }}
            >
              {w === 'day' ? 'Today' : w === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </nav>
      </header>

      {demo && (
        <p className="mb-3 text-[11px] px-2 py-1 rounded" style={{ color: 'var(--iw-pill-fg, #78716c)', border: '1px dashed var(--iw-nightable-border, #e7e5e4)' }}>
          Demo — synthetic sample data, not your writing.
        </p>
      )}

      {window === 'day' && (day ? <DayView day={day} /> : <Empty what="today" />)}
      {window === 'week' && (week ? <WeekView week={week} sessions={sessions} judged={judged} /> : <Empty what="this week" />)}
      {window === 'month' && (month ? <MonthView month={month} /> : <Empty what="this month" />)}

      {/* The AI half — always in its own labelled region, never interleaved with the measured charts. */}
      <JudgedSection window={window} narrative={judged?.narrative} shown={claims.shown} withheld={claims.withheld} />
    </div>
  )
}

// ─── Day: descriptive recap ONLY (§A6.2) ──────────────────────────────────────

function DayView({ day }: { day: DayAggregate }) {
  return (
    <section aria-label="Today">
      <p className="text-base mb-1" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>{dayHeadline(day)}</p>
      <ul className="text-xs mb-4 space-y-0.5" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {dayDetail(day).map(line => <li key={line}>{line}</li>)}
      </ul>

      <Block title="When you wrote">
        <HourHistogram hours={day.hourHistogram} ariaLabel="Active minutes by hour of day" />
      </Block>

      <PhaseBlock phases={day.phases} />

      {/* The daily window's standing caveat. Not fine print — it is the reason this view carries no
          pattern claim, and it stays visible so the reader never has to infer that for themselves. */}
      <p className="mt-4 text-[11px] italic" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{DAILY_CAVEAT}</p>
    </section>
  )
}

// ─── Week: the default window, where patterns become permissible ───────────────

function WeekView({ week, sessions, judged }: { week: WeekAggregate; sessions?: readonly LedgerSession[]; judged?: JudgedReport }) {
  const labels = week.days.map(d => WEEKDAYS[(new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7])

  const timeSeries: Series[] = [{ provenance: 'measured', label: 'active minutes', values: week.days.map(d => d.activeMinutes) }]
  const wordSeries: Series[] = [
    { provenance: 'measured', label: 'words written', values: week.days.map(d => d.wordsAdded) },
    { provenance: 'measured', label: 'words cut', values: week.days.map(d => d.wordsDeleted) },
  ]

  return (
    <section aria-label="This week">
      <p className="text-base mb-3" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
        {formatMinutes(week.activeMinutes)} of focused writing over {week.daysWritten} {week.daysWritten === 1 ? 'day' : 'days'} · {week.wordsAdded.toLocaleString()} words written
      </p>

      <Block title="Time per day">
        <BarChart categories={labels} series={timeSeries} unit="m" ariaLabel="Active minutes per day this week" />
      </Block>

      <Block title="Words per day — written and cut">
        {/* Both series are measured, so both are solid. Cutting is not styled as damage: there is no
            red in this chart set, because a day spent cutting is a day's work (§A5). */}
        <BarChart categories={labels} series={wordSeries} ariaLabel="Words written and cut per day this week" />
      </Block>

      <Block title="When you wrote">
        <HourHistogram hours={week.hourHistogram} ariaLabel="Active minutes by hour of day this week" />
      </Block>

      <PhaseBlock phases={week.phases} sessions={sessions} judged={judged} />

      {/* Descriptive only, and only when the sample supports it (§A3.3). */}
      {week.breakVsOutput.reportable && (
        <Block title="Breaks and output">
          <p className="text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            {describeCorrelation(week.breakVsOutput.r, week.breakVsOutput.n)}
          </p>
        </Block>
      )}
    </section>
  )
}

// ─── Month: trends ────────────────────────────────────────────────────────────

function MonthView({ month }: { month: MonthAggregate }) {
  const labels = month.weeks.map((_, i) => `wk ${i + 1}`)
  const minutes: Series[] = [{ provenance: 'measured', label: 'active minutes', values: month.weeks.map(w => w.activeMinutes) }]
  const words: Series[] = [{ provenance: 'measured', label: 'words written', values: month.weeks.map(w => w.wordsAdded) }]

  return (
    <section aria-label="This month">
      <p className="text-base mb-3" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
        {formatMinutes(month.activeMinutes)} across {month.daysWritten} {month.daysWritten === 1 ? 'day' : 'days'} · {month.wordsAdded.toLocaleString()} words written
      </p>

      <Block title="Time by week">
        <LineChart categories={labels} series={minutes} unit="m" ariaLabel="Active minutes per week this month" />
      </Block>

      <Block title="Words by week">
        <LineChart categories={labels} series={words} ariaLabel="Words written per week this month" />
      </Block>

      {month.weekOverWeekMinutes.length > 0 && (
        <Block title="Week over week">
          <ul className="text-xs space-y-0.5" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            {month.weekOverWeekMinutes.map((d, i) => (
              // A delta is stated, not scored: no arrows-as-verdicts, no red, no "down 40%".
              <li key={i}>
                wk {i + 1} → wk {i + 2}: {d >= 0 ? '+' : '−'}{formatMinutes(Math.abs(d))} · {fmtSigned(month.weekOverWeekWords[i])} words
              </li>
            ))}
          </ul>
        </Block>
      )}

      <PhaseBlock phases={month.phases} />
    </section>
  )
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function PhaseBlock({ phases, sessions, judged }: {
  phases: { drafting: number; editing: number; unclear: number; total: number }
  /** The rows behind `phases` — needed to compare the rule against the AI, per session. */
  sessions?: readonly LedgerSession[]
  judged?: JudgedReport
}) {
  if (phases.total === 0) return null

  // The rule-vs-AI comparison (§A6.1). Two INDEPENDENT estimates of the same thing: where they
  // disagree, that disagreement is information and is shown, not averaged away.
  const comparison = useMemo(() => {
    if (!judged?.sessions?.length || !sessions?.length) return null
    const ruled = new Map(sessions.map(s => [s.session_id, classifySession(s).phase]))
    return comparePhases(ruled, judged.sessions)
  }, [sessions, judged])

  const agreed = comparison?.filter(c => c.agrees).length ?? 0

  return (
    <Block title="Drafting or editing?">
      <PhaseMixBar {...phases} />
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {/* The honest gloss. The rule is named as a rule, its input is named, and `unclear` is
            explained rather than left looking like a bug. */}
        Estimated by a rule — how much you added versus cut in each session, not a measurement.
        {phases.unclear > 0 && ` ${phases.unclear} of ${phases.total} ${phases.unclear === 1 ? 'session sits' : 'sessions sit'} between the two, so the rule doesn't call ${phases.unclear === 1 ? 'it' : 'them'}.`}
      </p>
      {/* Only the `estimated` mark is drawn here, so only it is glossed — a legend entry for a mark
          that isn't on the chart is its own small dishonesty. */}
      <Legend series={[{ provenance: 'estimated', label: 'session phase', values: [] }]} />

      {comparison && comparison.length > 0 && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--iw-badge-ai, #b45309)' }}>
          The AI read {comparison.length} of these sessions and agreed with the rule on {agreed}.
          {agreed < comparison.length && ' Where they differ, neither is a measurement — the rule counts words, the AI reads context.'}
        </p>
      )}
    </Block>
  )
}

/**
 * The AI region (§A6.1). Physically separated from the measured charts, labelled at the top, and
 * hosting the §A6.2 gate's withheld notice.
 */
function JudgedSection({ window, narrative, shown, withheld }: {
  window: ReportWindow
  narrative?: string
  shown: { id: string; text: string; kind: string }[]
  withheld: { id: string; text: string; kind: string }[]
}) {
  if (!narrative && shown.length === 0 && withheld.length === 0) return null
  return (
    <section
      className="mt-5 pt-4"
      aria-label="AI interpretation"
      style={{ borderTop: '1px dashed var(--iw-nightable-border, #e7e5e4)' }}
    >
      <h2 className="text-xs mb-2 flex items-center gap-1.5" style={{ color: 'var(--iw-badge-ai, #b45309)' }}>
        <svg width="12" height="10" aria-hidden="true">
          <pattern id="iw-hatch-legend" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--iw-badge-ai, #b45309)" fillOpacity="0.22" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--iw-badge-ai, #b45309)" strokeWidth="2" strokeOpacity="0.9" />
          </pattern>
          <rect x="0.5" y="0.5" width="11" height="9" rx="1.5" fill="url(#iw-hatch-legend)" stroke="var(--iw-badge-ai, #b45309)" strokeWidth="1" strokeDasharray="2 2" />
        </svg>
        AI interpretation — an opinion about the numbers above, not a measurement
      </h2>

      {narrative && (
        <p className="text-xs whitespace-pre-wrap mb-2" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{narrative}</p>
      )}

      <ul className="text-xs space-y-1" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
        {shown.map(c => <li key={c.id}>· {c.text}</li>)}
      </ul>

      {/* THE GATE, MADE VISIBLE. Withheld claims are not silently dropped (§A9) — the reader is told
          a pattern claim exists and why one day can't support it. */}
      {withheld.length > 0 && (
        <p className="mt-2 text-[11px] italic" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          {withheld.length === 1 ? 'One pattern claim was' : `${withheld.length} pattern claims were`} held back
          {window === 'day' ? ' — a single day is too little to support them. Open the weekly view to see them.' : '.'}
        </p>
      )}
    </section>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h2 className="text-xs mb-1.5" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{title}</h2>
      {children}
    </div>
  )
}

function Empty({ what }: { what: string }) {
  return (
    <p className="text-sm py-6 text-center" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
      Nothing recorded for {what} yet — it'll appear here as you write.
    </p>
  )
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`
}
