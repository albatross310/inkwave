// ClockMenu — the toolbar's clock button and the ledger DROP-UP. Peter, 2026-07-17: "Make the
// ledger a drop up rather than a new page" — a Pomodoro you must navigate away to reach is not one
// you would use while writing. → docs/archive/panels-and-popovers.md#clock-why-a-dropup
//
// THREE HOUSE RULES, each a live bug elsewhere before it was a rule:
//  • `iw-touch-guard` on the panel, or a tap outside the contenteditable retracts the iOS keyboard
//    and the docked pill slides to the screen bottom with its just-opened menu.
//  • `iw-nightable` + theme tokens with day fallbacks, NEVER a hard-coded hex.
//  • ⚠ NOTHING HERE TICKS REACT: the face and ring subscribe to the store's IMPERATIVE tick channel
//    (TimeFace/TimeRing), so this component re-renders only on real state changes.
//
// TONE (§A5): a ritual, not a dashboard — no red numbers, no scores, no streak-shaming. A quiet day
// reads as a quiet day.
//
// ⚠ ONE TYPE RAMP (`music/typeScale.ts`), and its steps are SEMANTIC — `TYPE.label` because the
// thing IS a label. A `text-[11px]`/`text-xs` in this file is a regression, and a second ramp is how
// this repo forks. Scrolling is NOT a cost to minimise: the panel is 72vh and overflows by design,
// so never shrink a step to kill a scrollbar. The 16px floor is on the ramp because the AUTHORED
// size should BE the shipped size — index.css's phone-only backstop is real but invisible here, and
// a stylesheet three directories away silently rewriting a number is what makes it untrustworthy.
// `prodType.test.ts` derives its 16 from this ramp rather than re-typing it.
// → docs/archive/panels-and-popovers.md#clock-type-ramp

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/isTouchDevice'
import { LEDGER_ROW_EVENT, isLabelSuppressed, setLabelSuppressed } from '../productivity/capture'
import { CHIME_VOICES, chimeMuted, chimeVoiceId, previewChime, setChimeMuted, setChimeVoiceId } from '../productivity/chime'
import { prodLedgerEnabled, setProdLedgerEnabled } from '../productivity/ledgerFlag'
import { addPostHocRow, annotateRow, loadLedger, saveReflection } from '../productivity/ledgerStore'
import { activePdfs, type PdfReadingState } from '../productivity/pdfActivity'
import { currentPlace, recentPlaces } from '../productivity/places'
import { isPaused, sanitiseConfig, type PomodoroConfig } from '../productivity/pomodoro'
import {
  getPomodoroState, loadPomodoroConfig, pausePomodoro, resumePomodoro, setPomodoroConfig,
  stopPomodoro, subscribe,
} from '../productivity/pomodoroStore'
import { dismissSummary, pendingSummary, startWork, submitSummary, WORK_SUMMARY_EVENT, type PendingSummary } from '../productivity/workSession'
import { isPostHoc, isoWithOffset, localDayOf, localMonthOf, shouldOfferReflection, splitByEntry, unreflectedRows } from '../productivity/sessionLogic'
import type { DocType, Reflection, SessionRow } from '../productivity/types'
import { TOUCH_MIN, TYPE } from '../music/typeScale'
import { bibProvider } from '../citations/bibProvider'
import type { DocGoals } from '../types/document'
import { countdownShown, setCountdownShown } from './CountdownOverlay'
import { GoalsSection } from './GoalsSection'
import { ReflectionJournal } from './ReflectionJournal'
import { ReflectionPrompt } from './ReflectionPrompt'
import { TimeFace, TimeRing } from './TimeFace'

const nowIso = (): string => isoWithOffset(Date.now(), -new Date().getTimezoneOffset())
const timeOf = (iso: string): string => iso.slice(11, 16)

// ─── The clock face on the button ────────────────────────────────────────────
// Drawn, not an emoji: an emoji clock would render as someone else's artwork (and a different one
// per platform) inside a toolbar whose whole identity is thin ink strokes.
function ClockGlyph({ running }: { running: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden
      stroke="currentColor" strokeWidth={running ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      {/* A DIAL, not two bare strokes (Peter, 2026-07-17: "a new clock symbol… that looks more like a
          clock"). Four hour ticks at 12/3/6/9 read as a clock face even at 17px; the button's own
          border circle is the bezel. currentColor throughout, so it inverts with the button in night. */}
      <g strokeWidth={1.3}>
        <line x1="12" y1="3.7" x2="12" y2="5.3" />
        <line x1="20.3" y1="12" x2="18.7" y2="12" />
        <line x1="12" y1="20.3" x2="12" y2="18.7" />
        <line x1="3.7" y1="12" x2="5.3" y2="12" />
      </g>
      {/* Hands in clearly DIFFERENT directions read as a clock; two hands in one quadrant read as a
          tick/arrow (the old glyph's problem). Hour hand straight up (12), minute hand to the
          lower-right (~4 o'clock) — the canonical clock-icon pose. */}
      <line x1="12" y1="12" x2="12" y2="7.5" />
      <line x1="12" y1="12" x2="16.4" y2="14.2" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ─── Small, considered controls ──────────────────────────────────────────────

function Pill({ active, onClick, children, title }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; title?: string
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded-full px-3 py-1 transition-all active:scale-[0.97]"
      style={{
        fontSize: TYPE.meta,
        // A pill is a tap target, and it is the smallest one here — the HIG floor moves WITH the
        // ramp rather than being whatever the padding happened to add up to.
        minHeight: TOUCH_MIN,
        // A selected pill reads as chosen, not just tinted: medium weight + a soft purple lift. The
        // shadow tint works in both themes (the ink shifts, the shadow stays its family).
        fontWeight: active ? 500 : 400,
        border: '1px solid var(--iw-nightable-border, #e7e5e4)',
        background: active ? 'var(--iw-ink, #5c2d8a)' : 'transparent',
        // NOT #fff: --iw-ink is light purple in night, so white text on it is illegible (measured).
        color: active ? 'var(--iw-on-ink, #fff)' : 'var(--iw-pill-fg, #78716c)',
        borderColor: active ? 'var(--iw-ink, #5c2d8a)' : undefined,
        boxShadow: active ? '0 1px 5px rgb(var(--iw-ink-rgb) / 0.25)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

/** The primary action — filled, quiet, with a little lift. The one button that should feel good. */
function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      // The one button that should feel good (§A5's "sexy" = considered): an inset top highlight gives
      // it a little dimension, a soft purple cast lifts it off the panel, and it rises a hair on hover
      // and presses back on click. Nothing loud — the app's whole argument is calm.
      className="rounded-full px-6 py-2 transition-all hover:brightness-[1.07] hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
      style={{ fontSize: TYPE.label, fontWeight: 500, letterSpacing: '0.01em', minHeight: TOUCH_MIN, background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 10px rgb(var(--iw-ink-rgb) / 0.3)' }}
    >
      {children}
    </button>
  )
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      // The quiet sibling of PrimaryButton — same lift-on-hover motion, no fill. hover:bg-stone-50 is
      // remapped to a dark hover in the night block, so it themes for free.
      className="rounded-full px-5 py-2 transition-all hover:bg-stone-50 hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
      style={{ fontSize: TYPE.label, fontWeight: 500, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
    >
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="px-4 py-3" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      {/* TYPE.label matches GoalsSection's section heading — the drop-up reads as ONE panel. */}
      <h3 className="mb-2 uppercase tracking-wider" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #a8a29e)' }}>{title}</h3>
      {children}
    </section>
  )
}

/**
 * §A3.3's day summary, in the app's voice. Descriptive; never a score.
 *
 * ⚠ A SECOND PLACE THE DAY'S MINUTES ARE SUMMED — `aggregate.ts` is the other — and it is how
 * §A6.1's rule got broken once already: reducing over ALL rows reported 45 REMEMBERED minutes back
 * to the writer as "focused minutes", with every unit test green, because they guard `aggregate.ts`
 * and this panel never calls it. **A guard on one implementation of a rule says nothing about the
 * other.** So the split happens HERE too; a third summariser must do the same, or all three should
 * call one rule. → docs/archive/panels-and-popovers.md#clock-day-summary
 */
function daySummary(allRows: SessionRow[]): string {
  const { measured: rows, postHoc } = splitByEntry(allRows)
  const added = Math.round(postHoc.reduce((a, r) => a + r.active_minutes, 0))
  // §A5's register: stated plainly, neither praised nor apologised for. Adding time you forgot to
  // track is ordinary record-keeping, so this sentence does not editorialise about it.
  const addedClause = added > 0 ? ` You also added ${added} minute${added === 1 ? '' : 's'} from memory.` : ''

  if (rows.length === 0) {
    return added > 0
      ? `Nothing tracked today —${addedClause.replace(' You also added', ' but you added')}`
      : 'Nothing recorded yet today. Whenever you start, it will show up here.'
  }
  const mins = Math.round(rows.reduce((a, r) => a + r.active_minutes, 0))
  const net = rows.reduce((a, r) => a + r.net_words, 0)
  const shape = mins < 25 ? 'A short spell of work' : mins < 90 ? 'A steady stretch' : 'A long day at it'
  const words =
    net > 0 ? `, and the writing grew by ${net} word${net === 1 ? '' : 's'}` :
    net < 0 ? ', and you cut it back — editing is writing too' :
    ', spent shaping what was already there'
  return `${shape}: ${mins} focused minute${mins === 1 ? '' : 's'} across ${rows.length} session${rows.length === 1 ? '' : 's'}${words}.${addedClause}`
}

/** Test seam — `daySummary` is a pure function and the §A6.1 rule it carries must stay in the gate. */
export const _daySummaryForTest = daySummary

// The timer lengths, edited AS NUMBER INPUTS (Peter, 2026-07-18: "all customisable JUST BY CLICKING
// THE TIMER, as a NUMBER INPUT, not the purple selectables"). Each field carries its own sane bounds
// — the same clamp sanitiseConfig applies, surfaced here as the input's min/max so the browser guides
// the writer rather than silently correcting them afterwards. `unit` labels what the number means.
const LENGTH_FIELDS: Array<{ key: keyof PomodoroConfig; label: string; min: number; max: number; unit: string }> = [
  { key: 'workMin', label: 'Work', min: 1, max: 180, unit: 'min' },
  { key: 'breakMin', label: 'Break', min: 1, max: 60, unit: 'min' },
  { key: 'longBreakMin', label: 'Long break', min: 1, max: 120, unit: 'min' },
  { key: 'longBreakEvery', label: 'Long break every', min: 1, max: 12, unit: 'blocks' },
]

/**
 * The toolbar's clock — A TRIGGER, NEVER AN OWNER.
 *
 * ⚠ The panel's open state is LIFTED to the editor (`ledgerOpen`); this button only calls the
 * setter. `clock` competes for one of six row slots and lands in the ▲ overflow by default, so this
 * component is often NOT MOUNTED — an owned state would make the countdown's "click to open"
 * silently dead depending on where a button was dragged.
 * → docs/archive/panels-and-popovers.md#clock-trigger-not-owner
 */
export function ClockSlotButton({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element | null {
  const [, bump] = useState(0)
  // STATE changes only (start/stop/phase) — never the per-second tick.
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  if (!prodLedgerEnabled()) return null

  const running = getPomodoroState().phase !== 'idle'
  return (
    <button
      type="button"
      aria-pressed={open}
      // The drop-up finds its anchor by this attribute, so it works from the row OR from ▲.
      data-iw-ledger-btn=""
      onClick={onToggle}
      className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${open || running ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
      title={running ? 'Pomodoro running — your ledger' : 'Pomodoro & your ledger'}
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current">
        <ClockGlyph running={running} />
      </span>
    </button>
  )
}

// ─── The nav shell (Peter, 2026-07-18) ───────────────────────────────────────
// "The clock button opens a panel with FIVE buttons (more to add later)" — so a NAV SHELL, not one
// long scroll, and it reuses the existing pieces UNCHANGED behind those buttons (a second copy of
// the pomodoro, goals, report, charts or ledger is the failure). A sixth is one array entry.
//   1. Start / stop work  → WorkView (pomodoro + the WHERE/WHAT start flow + the end summary)
//   2. Goals              → GoalsSection
//   3. Reporting          → the AI report modal (a lifted opener; closes this panel)
//   4. Progress tracking  → the charts modal (a lifted opener; closes this panel)
//   5. Manage projects    → ProjectsView (today's sessions, notes, reading, reflections, titles)
// → docs/archive/panels-and-popovers.md#clock-nav-shell

type NavView = 'home' | 'work' | 'goals' | 'projects'

export function LedgerDropUp({ docLabel, goals, onGoalsChange, onOpenGraphs, onOpenReport, onClose }: {
  docId: string; docLabel?: string; goals?: DocGoals; onGoalsChange: (g: DocGoals) => void
  /** Open the measured writing-charts panel (P1a-viz). Absent when `?prodGraphs=off` — no button. */
  onOpenGraphs?: () => void
  /** Open the AI work-report modal (P1c). Absent when `?prodReport=off` — no button. */
  onOpenReport?: () => void
  onClose: () => void
}): JSX.Element {
  // Resolve the anchor at open time rather than holding a ref: the trigger may be in the row, in the
  // ▲ overflow, or not rendered at all (opened from the countdown). Absent → centred.
  const anchor = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-iw-ledger-btn]')
  const [rows, setRows] = useState<SessionRow[]>([])
  const [reflections, setReflections] = useState<Reflection[]>([])
  const month = localMonthOf(nowIso())
  const today = localDayOf(nowIso())
  const panelRef = useRef<HTMLDivElement>(null)

  // WHERE TO LAND. A pending end-of-block summary, or a running timer, both belong in the work view —
  // opening from the countdown of a running block should show the timer, not a menu. Otherwise home.
  const [view, setView] = useState<NavView>(() =>
    pendingSummary() || getPomodoroState().phase !== 'idle' ? 'work' : 'home',
  )

  const refresh = useCallback(async () => {
    const l = await loadLedger(month)
    setRows(l.rows)
    setReflections(l.reflections ?? [])
  }, [month])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const on = () => void refresh()
    window.addEventListener(LEDGER_ROW_EVENT, on)
    return () => window.removeEventListener(LEDGER_ROW_EVENT, on)
  }, [refresh])

  // A summary falling due while the panel is already open pulls us to the work view to ask for it.
  useEffect(() => {
    const on = () => setView('work')
    window.addEventListener(WORK_SUMMARY_EVENT, on)
    return () => window.removeEventListener(WORK_SUMMARY_EVENT, on)
  }, [])

  // Escape: step back to home from a sub-view, or close from home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setView((v) => { if (v === 'home') onClose(); return 'home' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close on an outside tap — but never on a tap INSIDE the panel (that would eat every control).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (panelRef.current?.contains(t as Node)) return
      if (anchor?.contains(t as Node)) return // the button toggles itself
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  const todays = useMemo(() => rows.filter((r) => localDayOf(r.start) === today).reverse(), [rows, today])

  // §A5b — the stretch since the last reflection, and whether to offer one. `skipped` holds for THIS
  // panel session only — "not now" means not now, not never, and it must not be recorded anywhere.
  const [skipped, setSkipped] = useState(false)
  const unreflected = useMemo(() => unreflectedRows(rows, reflections ?? [], today), [rows, reflections, today])
  const offerReflection = !skipped && shouldOfferReflection(
    unreflected.reduce((a, r) => a + r.active_minutes * 60_000, 0),
  )
  const docs = useMemo(() => {
    const seen = new Map<string, string | undefined>()
    for (const r of rows) if (!seen.has(r.doc_id)) seen.set(r.doc_id, r.doc_label)
    return [...seen.entries()].map(([id, label]) => ({ id, label }))
  }, [rows])

  const isPhone = isTouchDevice()
  const style: React.CSSProperties = isPhone
    ? { position: 'fixed', left: 8, right: 8, bottom: 68 }
    : (() => {
        const br = anchor?.getBoundingClientRect()
        const centre = br ? br.left + br.width / 2 : window.innerWidth / 2
        const HALF = 186
        return {
          position: 'fixed',
          bottom: 70,
          left: Math.round(Math.max(8 + HALF, Math.min(window.innerWidth - 8 - HALF, centre))),
          transform: 'translateX(-50%)',
          width: 372,
        }
      })()

  const title =
    view === 'work' ? 'Work' : view === 'goals' ? 'Goals' : view === 'projects' ? 'Your ledger' : null

  return createPortal(
    <div
      ref={panelRef}
      // iw-touch-guard: a portalled panel over the editor — taps must not blur the contenteditable
      // (iOS retracts the keyboard and the docked pill walks to the screen bottom).
      // iw-nightable: opts the whole panel into the themed surface.
      className="iw-nightable iw-touch-guard iw-no-print z-[60] flex flex-col overflow-hidden bg-white font-serif"
      style={{
        ...style,
        maxHeight: '72vh',
        borderRadius: 14,
        boxShadow: '0 10px 40px rgba(28,25,23,0.18)',
        border: '1px solid var(--iw-nightable-border, #ece9e6)',
      }}
    >
      {/* The header: a back affordance on a sub-view + the view's name. This is the one nav chrome;
          the views below never draw their own. Home shows no header (its buttons ARE the surface). */}
      {title !== null && (
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
          <button type="button" onClick={() => setView('home')} aria-label="Back"
            className="flex items-center justify-center rounded-full transition-colors hover:bg-stone-50"
            style={{ minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, fontSize: TYPE.heading, color: 'var(--iw-ink, #5c2d8a)' }}
          >
            ‹
          </button>
          <span className="flex-1" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>{title}</span>
        </div>
      )}

      <div className="overflow-y-auto">
        {view === 'home' && (
          <HomeView
            onNavigate={setView}
            onOpenGraphs={onOpenGraphs}
            onOpenReport={onOpenReport}
            reflection={offerReflection ? (
              <ReflectionPrompt
                rows={unreflected}
                onSave={async (r) => { await saveReflection(month, r); void refresh() }}
                onSkip={() => setSkipped(true)}
              />
            ) : null}
          />
        )}
        {view === 'work' && <WorkView onSummarised={refresh} />}
        {view === 'goals' && <GoalsSection goals={goals} docLabel={docLabel} onChange={onGoalsChange} />}
        {view === 'projects' && (
          <ProjectsView rows={todays} reflections={reflections} docs={docs} onSaved={refresh} />
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── Home: the five nav buttons (extensible — a sixth is one entry) ───────────

/** One tappable nav row: a drawn glyph, a label and a one-line description. */
function NavRow({ glyph, label, desc, accent, onClick }: {
  glyph: React.ReactNode; label: string; desc: string; accent?: boolean; onClick: () => void
}): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50"
      style={{ minHeight: TOUCH_MIN, borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}
    >
      <span className="flex shrink-0 items-center justify-center rounded-full"
        style={{ width: 38, height: 38, border: '1.5px solid var(--iw-ink, #5c2d8a)', color: 'var(--iw-ink, #5c2d8a)' }}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: TYPE.body, fontWeight: accent ? 500 : 400, color: 'var(--iw-ink, #5c2d8a)' }}>{label}</span>
        <span className="block truncate" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{desc}</span>
      </span>
      <span className="shrink-0" style={{ fontSize: TYPE.body, color: 'var(--iw-pill-fg, #a8a29e)' }}>›</span>
    </button>
  )
}

function HomeView({ onNavigate, onOpenGraphs, onOpenReport, reflection }: {
  onNavigate: (v: NavView) => void
  onOpenGraphs?: () => void
  onOpenReport?: () => void
  reflection: React.ReactNode
}): JSX.Element {
  // The running-timer strip: state changes only (never the tick), so this re-renders on start/stop.
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const running = getPomodoroState().phase !== 'idle'

  return (
    <div className="pb-2">
      {/* A quiet header + the running-timer glance, so opening from a running block shows its state. */}
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <span style={{ fontSize: TYPE.heading, color: 'var(--iw-ink, #5c2d8a)' }}>Your writing time</span>
        {running && (
          <button type="button" onClick={() => onNavigate('work')}
            className="flex items-center gap-1.5 rounded-full px-3 transition-colors hover:opacity-80"
            style={{ minHeight: TOUCH_MIN, background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)' }}
          >
            <TimeFace className="tabular-nums" style={{ fontSize: TYPE.label }} />
          </button>
        )}
      </div>

      {reflection}

      <div className="mt-1">
        <NavRow accent glyph={<ClockGlyph running={running} />} label={running ? 'Work in progress' : 'Start / stop work'}
          desc={running ? 'Your block is running — pause, stop or summarise' : 'A focused block, with a gentle timer'}
          onClick={() => onNavigate('work')} />
        <NavRow glyph={<GoalGlyph />} label="Goals" desc="What you’re aiming for, and by when"
          onClick={() => onNavigate('goals')} />
        {onOpenReport && (
          <NavRow glyph={<ReportGlyph />} label="Reporting"
            desc="A prompt for your own AI — and its coaching back" onClick={onOpenReport} />
        )}
        {onOpenGraphs && (
          <NavRow glyph={<ChartGlyph />} label="Progress tracking"
            desc="Your time, words and patterns, in charts" onClick={onOpenGraphs} />
        )}
        <NavRow glyph={<LedgerGlyph />} label="Manage projects"
          desc="Today’s sessions, notes and document titles" onClick={() => onNavigate('projects')} />
      </div>
    </div>
  )
}

// ─── Small drawn glyphs (thin ink strokes, currentColor — invert in night) ────

function GoalGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
function ReportGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5Z" /><path d="M14 3.5V8h4" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="15.5" x2="13" y2="15.5" />
    </svg>
  )
}
function ChartGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="11" width="3" height="6" /><rect x="11" y="7" width="3" height="10" /><rect x="16" y="13" width="3" height="4" />
    </svg>
  )
}
function LedgerGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="4" width="14" height="16" rx="1.5" /><line x1="8.5" y1="8" x2="15.5" y2="8" /><line x1="8.5" y1="12" x2="15.5" y2="12" /><line x1="8.5" y1="16" x2="12.5" y2="16" />
    </svg>
  )
}

// ─── Work: the pomodoro + the start flow + the end-of-block summary ───────────

function WorkView({ onSummarised }: { onSummarised: () => void }): JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const s = getPomodoroState()
  const paused = isPaused(s)
  const idle = s.phase === 'idle'

  // Two mutually-exclusive overlays over the timer: the start flow (idle, before a block) and the
  // lengths editor (click the timer). A summary offer sits ABOVE the timer when a block just ended.
  const [flowOpen, setFlowOpen] = useState(false)
  const [editLengths, setEditLengths] = useState(false)
  const [summary, setSummary] = useState<PendingSummary | null>(() => pendingSummary())
  useEffect(() => {
    const on = () => setSummary(pendingSummary())
    window.addEventListener(WORK_SUMMARY_EVENT, on)
    return () => window.removeEventListener(WORK_SUMMARY_EVENT, on)
  }, [])

  const phaseLabel =
    idle ? 'Ready when you are'
    : paused ? 'Paused'
    : s.phase === 'work' ? 'Writing'
    : s.phase === 'break' ? 'Break' : 'Long break'

  return (
    <section className="flex flex-col items-center px-4 pb-4 pt-4">
      {summary && (
        <SummaryPrompt
          pending={summary}
          onDone={() => { setSummary(null); onSummarised() }}
        />
      )}

      {/* Click the timer to edit the lengths as number inputs (Peter's spec). The whole ring+face is
          the target so it reads as "tap the clock". */}
      <button type="button" onClick={() => { setEditLengths((v) => !v); setFlowOpen(false) }}
        aria-label="Edit timer lengths"
        className="relative transition-transform active:scale-[0.99]" style={{ width: 132, height: 132 }}>
        <TimeRing size={132} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <TimeFace className="tabular-nums" style={{ fontSize: TYPE.title, color: 'var(--iw-ink, #5c2d8a)', letterSpacing: '0.01em' }} />
          <span className="mt-0.5" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{phaseLabel}</span>
        </div>
      </button>

      {editLengths ? (
        <LengthsEditor onClose={() => setEditLengths(false)} />
      ) : flowOpen ? (
        <StartWorkFlow onStart={() => setFlowOpen(false)} onCancel={() => setFlowOpen(false)} />
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {idle ? (
            <PrimaryButton onClick={() => setFlowOpen(true)}>Start work</PrimaryButton>
          ) : (
            <>
              {paused
                ? <PrimaryButton onClick={resumePomodoro}>Resume</PrimaryButton>
                : <GhostButton onClick={pausePomodoro}>Pause</GhostButton>}
              <GhostButton onClick={stopPomodoro}>Stop</GhostButton>
            </>
          )}
          <GhostButton onClick={() => setEditLengths(true)}>Lengths</GhostButton>
        </div>
      )}

      {s.completed > 0 && (
        // Reward showing up, not output (§A5). Dots, not a number to beat.
        <div className="mt-3 flex items-center gap-1.5" title={`${s.completed} block${s.completed === 1 ? '' : 's'} today`}>
          {Array.from({ length: Math.min(s.completed, 8) }).map((_, i) => (
            <span key={i} className="inline-block rounded-full"
              style={{ width: 5, height: 5, background: 'var(--iw-light, #9b5ccc)', opacity: 0.75 }} />
          ))}
          {s.completed > 8 && <span style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>+{s.completed - 8}</span>}
        </div>
      )}

      {/* The chime lives with the timer it belongs to — a dropdown, not a wall of preview buttons. */}
      <ChimeSelect />
    </section>
  )
}

// ─── The start-work flow: WHERE, WHAT, and an optional length ─────────────────

function StartWorkFlow({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }): JSX.Element {
  const [place, setPlace] = useState(() => currentPlace() ?? '')
  const [intention, setIntention] = useState('')
  const [workMin, setWorkMin] = useState<number>(() => loadPomodoroConfig().workMin)
  const recents = recentPlaces()

  const go = useCallback(() => {
    startWork({
      place: place.trim() || undefined,
      intention: intention.trim() || undefined,
      workMin,
    })
    onStart()
  }, [place, intention, workMin, onStart])

  return (
    <div className="mt-4 w-full rounded-lg px-3 py-3" style={{ border: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      {/* WHERE — reuses the typed place label (never geolocation). Opt-in: blank is fine. */}
      <label className="mb-1 block" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        Where are you working? <span style={{ opacity: 0.7 }}>(optional)</span>
      </label>
      <input
        value={place}
        onChange={(e) => setPlace(e.target.value)}
        placeholder="library, home, cafe…"
        className="w-full rounded-md px-2.5 py-1.5"
        style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
      />
      {recents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {recents.map((p) => <Pill key={p} active={p === place.trim()} onClick={() => setPlace(p)}>{p}</Pill>)}
        </div>
      )}

      {/* WHAT — the intention. Held as context for the end-of-block summary, never as a measurement. */}
      <label className="mb-1 mt-3 block" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        What are you going to do?
      </label>
      <textarea
        value={intention}
        onChange={(e) => setIntention(e.target.value)}
        rows={2}
        placeholder="draft the intro, read Leibniz, tidy the argument…"
        className="w-full resize-y rounded-md px-2 py-1.5"
        style={{ fontSize: TYPE.body, border: '1px solid var(--iw-nightable-border, #f0eeec)', background: 'transparent' }}
      />

      {/* Optionally set the block length for THIS block — a number input, not a preset chip. */}
      <div className="mt-3 flex items-center gap-2">
        <label style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>Block length</label>
        <input
          type="number" min={1} max={180} value={workMin}
          onChange={(e) => setWorkMin(sanitiseConfig({ workMin: Number(e.target.value) }).workMin)}
          className="w-16 rounded-md px-2 py-1 text-right tabular-nums"
          style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
        />
        <span style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>min</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <PrimaryButton onClick={go}>Start</PrimaryButton>
        <button type="button" onClick={onCancel}
          className="rounded-full px-3 py-1.5 transition-colors hover:bg-stone-50"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #78716c)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── The end-of-block summary (lands as the ledger row's note, §A5) ───────────

function SummaryPrompt({ pending, onDone }: { pending: PendingSummary; onDone: () => void }): JSX.Element {
  const [text, setText] = useState('')
  return (
    <div className="mb-4 w-full rounded-lg px-3 py-3" style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'var(--iw-slot-drag-bg, #faf8ff)' }}>
      <p className="mb-1" style={{ fontSize: TYPE.label, color: 'var(--iw-ink, #5c2d8a)' }}>Block done — what did you do?</p>
      {pending.intention && (
        <p className="mb-2" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
          You set out to: {pending.intention}
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="A line is plenty — it lands in this session’s ledger note."
        className="mb-2 w-full resize-y rounded-md px-2 py-1.5"
        style={{ fontSize: TYPE.body, border: '1px solid var(--iw-nightable-border, #f0eeec)', background: 'transparent' }}
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { void submitSummary(text); onDone() }}
          className="rounded-full px-4 py-1.5 transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)' }}
        >
          Save
        </button>
        <button type="button" onClick={() => { dismissSummary(); onDone() }}
          className="rounded-full px-3 py-1.5 transition-colors hover:bg-stone-50"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #78716c)' }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}

// ─── Lengths, as NUMBER INPUTS (Peter: "not the purple selectables") ──────────

function LengthsEditor({ onClose }: { onClose: () => void }): JSX.Element {
  const [cfg, setCfg] = useState<PomodoroConfig>(loadPomodoroConfig)
  const apply = (next: PomodoroConfig) => { setCfg(next); setPomodoroConfig(next) }

  return (
    <div className="mt-4 w-full rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      <div className="space-y-2">
        {LENGTH_FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <label style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>{f.label}</label>
            <span className="flex items-center gap-1.5">
              <input
                type="number" min={f.min} max={f.max} value={cfg[f.key]}
                // Clamp on change through the SAME sanitiser the store uses, so what the input shows
                // and what the timer runs cannot disagree; an empty/garbage value falls back sanely.
                onChange={(e) => apply(sanitiseConfig({ ...cfg, [f.key]: Number(e.target.value) }))}
                className="w-16 rounded-md px-2 py-1 text-right tabular-nums"
                style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
              />
              <span className="w-12" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{f.unit}</span>
            </span>
          </div>
        ))}
      </div>
      <button type="button" onClick={onClose}
        className="mt-2 transition-colors hover:opacity-80"
        style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #a8a29e)' }}
      >
        Done
      </button>
    </div>
  )
}

// ─── Chime, as a DROPDOWN (Peter: "should just be a DROP DOWN") ───────────────

function ChimeSelect(): JSX.Element {
  const [voice, setVoice] = useState(chimeVoiceId)
  const [muted, setMuted] = useState(chimeMuted)
  // 'silent' is a value of the same dropdown, not a separate toggle — the spec asks for the five
  // voices plus Silent in one dropdown.
  const value = muted ? 'silent' : voice
  const onPick = (v: string) => {
    if (v === 'silent') { setChimeMuted(true); setMuted(true); return }
    setChimeMuted(false); setMuted(false)
    setChimeVoiceId(v); setVoice(v)
    previewChime(v) // the pick is also the tap iOS needs to unlock audio for the real chime
  }
  return (
    <div className="mt-4 flex w-full items-center gap-2">
      <label style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>Chime</label>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="flex-1 rounded-md px-2 py-1.5"
        style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent', color: 'var(--iw-ink, #5c2d8a)' }}
      >
        {CHIME_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.hint}</option>)}
        <option value="silent">Silent</option>
      </select>
      {/* Preview affordance — a tap unlocks iOS audio and plays the current choice. Disabled on Silent. */}
      <button type="button" onClick={() => value !== 'silent' && previewChime(value)}
        title="Preview" disabled={value === 'silent'}
        className="shrink-0 rounded-full px-3 transition-colors hover:bg-stone-50 disabled:opacity-40"
        style={{ fontSize: TYPE.label, minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
      >
        ▶
      </button>
    </div>
  )
}

// ─── Reading (Peter: "a reading indicator on the ledger, next to a pdf name") ──
// ⚠ SHOWS ONLY WHAT WE SAW. An open but unscrolled PDF does not appear — that is the honest state,
// not a detection failure, so an empty section reads "no reading right now", never "0 minutes read".
// ⚠ NO PROGRESS BAR, considered and rejected (§A3.2): we hold WHETHER you scrolled, never where, so
// there is nothing to draw one from and a page-by-page trace of private PDFs would be far more
// sensitive for no gain. → docs/archive/panels-and-popovers.md#clock-reading-indicator

/** The two live states, in the app's ink. A dot, not a badge — this is a ritual, not a dashboard. */
function ReadingDot({ state }: { state: PdfReadingState }): JSX.Element {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: 6, height: 6,
        background: state === 'annotating' ? 'var(--iw-ink, #5c2d8a)' : 'var(--iw-light, #9b5ccc)',
        opacity: state === 'annotating' ? 0.9 : 0.6,
      }}
    />
  )
}

function ReadingSection(): JSX.Element | null {
  // Re-read on a slow beat, and ONLY while the drop-up is open (this component is unmounted
  // otherwise). The tick rule (`pomodoroStore`) bans a per-SECOND React render inside the editor's
  // tree; a 5s read of a Map in an open panel is a different order of thing entirely, and the state
  // it shows genuinely changes on a 5-minute window.
  const [, bump] = useState(0)
  useEffect(() => {
    const t = setInterval(() => bump((n) => n + 1), 5_000)
    return () => clearInterval(t)
  }, [])

  const pdfs = activePdfs()
  if (pdfs.length === 0) return null

  return (
    <Section title="Reading">
      <ul className="space-y-1.5">
        {pdfs.map((p) => (
          <li key={p.citekey} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <ReadingDot state={p.state} />
              <span className="truncate" style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #5c2d8a)' }}>{pdfNameOf(p.citekey)}</span>
            </span>
            <span className="shrink-0" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
              {p.state === 'annotating' ? 'annotating' : 'reading'}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** The PDF's name for the indicator — the bibliography's title if it has one, else the citekey. */
function pdfNameOf(citekey: string): string {
  const item = bibProvider.get(citekey) as { title?: string } | undefined
  const t = item?.title?.trim()
  return t && t.length ? t : citekey
}

// ─── Today ───────────────────────────────────────────────────────────────────

function TodaySection({ rows, summary, onSaved }: {
  rows: SessionRow[]; summary: string; onSaved: () => void
}): JSX.Element {
  return (
    <Section title="Today">
      <p className="mb-3 leading-relaxed" style={{ fontSize: TYPE.body, color: 'var(--iw-pill-fg, #78716c)' }}>{summary}</p>
      <ul className="space-y-2">
        {rows.map((r) => <SessionCard key={r.session_id} row={r} onSaved={onSaved} />)}
      </ul>
      <PostHocAdd onAdded={onSaved} />
    </Section>
  )
}

// ─── The post-hoc add (Peter: "a manual add for if you forget to use the timer") ──
// §A5's register decides every choice here: a friend letting you correct the record, not a
// supervisor auditing your timesheet. COLLAPSED by default (an always-open form is a standing
// question about what you failed to log), never nags, never scolds.
// ⚠ DO NOT MAKE HIM PRECISE — rough duration, rough category, done. PILLS, not number inputs: every
// answer is one tap, and a skipped note is not a failure. The honesty lives in the ROW
// (`entered: 'post-hoc'`), not in this form's copy, which is why it can afford to be relaxed.
// → docs/archive/panels-and-popovers.md#clock-posthoc-form

const POSTHOC_MINUTES = [15, 25, 45, 60, 90]
const POSTHOC_KINDS: Array<{ id: DocType; label: string }> = [
  { id: 'essay', label: 'writing' },
  { id: 'reading', label: 'reading' },
  { id: 'annotating', label: 'annotating' },
  { id: 'note', label: 'notes' },
  { id: 'email', label: 'email' },
  { id: 'other', label: 'something else' },
]

function PostHocAdd({ onAdded }: { onAdded: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(25)
  const [kind, setKind] = useState<DocType>('essay')
  const [note, setNote] = useState('')
  const [added, setAdded] = useState<number | null>(null)

  const submit = useCallback(async () => {
    await addPostHocRow({ minutes, docType: kind, note })
    setAdded(minutes)
    setOpen(false)
    setNote('')
    onAdded()
    setTimeout(() => setAdded(null), 3200)
  }, [kind, minutes, note, onAdded])

  if (!open) {
    return (
      <div className="mt-3">
        <button type="button" onClick={() => setOpen(true)}
          className="underline transition-colors hover:opacity-80"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #a8a29e)' }}
        >
          Add time you didn&rsquo;t track
        </button>
        {added !== null && (
          // States what landed, and that it is his word rather than ours — no praise, no reproach.
          <p className="mt-1.5" style={{ fontSize: TYPE.meta, color: 'var(--iw-verified, #15803d)' }}>
            Added {added} minutes from memory. It sits beside your tracked time, not inside it.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg px-3 py-2.5" style={{ border: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      <p className="mb-2" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
        Roughly is fine — we&rsquo;ll mark it as your recollection rather than something we timed.
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {POSTHOC_MINUTES.map((m) => (
          <Pill key={m} active={minutes === m} onClick={() => setMinutes(m)}>{m}m</Pill>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {POSTHOC_KINDS.map((k) => (
          <Pill key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</Pill>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What was it? (optional)"
        className="mb-2 w-full resize-y rounded-md px-2 py-1.5"
        // TYPE.body: the writer types INTO this, so it is prose — and ≥16px keeps iOS from zooming.
        style={{ fontSize: TYPE.body, border: '1px solid var(--iw-nightable-border, #f0eeec)', background: 'transparent' }}
      />

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void submit()}
          className="rounded-full px-4 py-1.5 transition-all hover:brightness-110 active:scale-[0.98]"
          // --iw-on-ink, never a literal white: --iw-ink is LIGHT purple in night mode, where white
          // text on it vanishes. A hard-coded #fff here is a night-mode bug by construction.
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)' }}
        >
          Add {minutes}m
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-full px-3 py-1.5 transition-colors hover:bg-stone-50"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #78716c)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SessionCard({ row, onSaved }: { row: SessionRow; onSaved: () => void }): JSX.Element {
  const postHoc = isPostHoc(row)
  const [note, setNote] = useState(row.note ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setNote(row.note ?? '') }, [row.note])

  const save = useCallback(async () => {
    if ((row.note ?? '') === note.trim()) return
    await annotateRow(localMonthOf(row.start), row.session_id, { note })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
    onSaved()
  }, [note, onSaved, row])

  return (
    <li className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate" style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #5c2d8a)' }}>
          {/* A post-hoc block has no document — `doc_id: 'post-hoc'` — so "A document" would be a
              small lie. It says what it is. THE FLAG IS THE FEATURE (Peter: "then it's flagged
              post-hoc"): a remembered block must never be able to pass for a timed one on screen. */}
          {postHoc ? 'Added from memory' : (row.doc_label ?? 'A document')}
          {row.pomodoro && <span className="ml-1.5" style={{ fontSize: TYPE.meta, color: 'var(--iw-light, #9b5ccc)' }}>●</span>}
        </span>
        <span className="shrink-0 tabular-nums" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
          {/* No start–end times on a remembered block: we derived that span from a rough duration,
              so printing "13:15–14:00" would dress testimony up as a measurement. */}
          {postHoc
            ? `about ${Math.round(row.active_minutes)}m`
            : <>{timeOf(row.start)}–{timeOf(row.end)} · {Math.round(row.active_minutes)}m</>}
          {!postHoc && row.net_words !== 0 && ` · ${row.net_words > 0 ? '+' : ''}${row.net_words}w`}
        </span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder="What did you do in this session? (optional)"
        className="w-full resize-y rounded-md px-2 py-1.5"
        style={{ fontSize: TYPE.body, border: '1px solid var(--iw-nightable-border, #f0eeec)', background: 'transparent' }}
      />
      {saved && <p className="mt-1" style={{ fontSize: TYPE.meta, color: 'var(--iw-verified, #15803d)' }}>Saved to your ledger.</p>}
    </li>
  )
}

// ─── Manage projects: the ledger (today's sessions, reading, reflections, titles) ──
// The OLD drop-up's ledger content, now behind its own nav button. ⚠ NOT a second implementation
// of the ledger — it renders the same pieces.

function ProjectsView({ rows, reflections, docs, onSaved }: {
  rows: SessionRow[]; reflections: Reflection[]; docs: Array<{ id: string; label?: string }>; onSaved: () => void
}): JSX.Element {
  const [countdown, setCountdown] = useState(countdownShown)

  return (
    <>
      <ReadingSection />
      <TodaySection rows={rows} summary={daySummary(rows)} onSaved={onSaved} />
      <ReflectionJournal reflections={reflections} />

      {docs.length > 0 && (
        <Section title="Titles">
          <p className="mb-2" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
            Your ledger records each document&rsquo;s title so you can tell sessions apart. If a title is
            private, hide it — future sessions record the work without the name.
          </p>
          <ul className="space-y-1.5">
            {docs.map((d) => <TitleRow key={d.id} docId={d.id} label={d.label} />)}
          </ul>
        </Section>
      )}

      <Section title="This device">
        <label className="flex items-center justify-between gap-2" style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #78716c)' }}>
          Countdown in the corner
          {/* A checkbox renders no text, so the 16px iOS rule cannot bite it — but it IS a tap
              target, and at the browser default it is ~13px square. Sized to the ramp's floor. */}
          <input type="checkbox" checked={countdown}
            style={{ width: TYPE.body, height: TYPE.body }}
            onChange={(e) => { setCountdownShown(e.target.checked); setCountdown(e.target.checked) }} />
        </label>
        <p className="mt-1" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
          {isTouchDevice() ? 'Shown on desktop only — on a phone the corner is your page.' : 'Shows while a block is running. Click it to open this panel.'}
        </p>
        <button type="button"
          onClick={() => { setProdLedgerEnabled(false); location.reload() }}
          className="mt-3 underline transition-colors hover:opacity-80"
          style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #a8a29e)' }}
        >
          Turn off session tracking
        </button>
      </Section>
    </>
  )
}

function TitleRow({ docId, label }: { docId: string; label?: string }): JSX.Element {
  const [hidden, setHidden] = useState(() => isLabelSuppressed(docId))
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="truncate" style={{ fontSize: TYPE.body, color: hidden ? 'var(--iw-pill-fg, #a8a29e)' : 'var(--iw-ink, #5c2d8a)' }}>
        {hidden ? <em>title hidden</em> : (label ?? <em>untitled</em>)}
      </span>
      <Pill onClick={() => { const next = !hidden; setLabelSuppressed(docId, next); setHidden(next) }}>
        {hidden ? 'Record' : 'Hide'}
      </Pill>
    </li>
  )
}
