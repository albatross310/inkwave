// ClockMenu — the toolbar's clock button and the ledger DROP-UP (Peter, 2026-07-17):
// "a new button with a picture of a clock on it in the toolbar for all these new productivity
// features, with the ledger. Make the ledger a drop up rather than a new page."
//
// The ledger stops being a route and becomes part of the writing surface: a Pomodoro you must
// navigate away to reach is not one you would use while writing.
//
// THREE HOUSE RULES, all live bugs elsewhere before they were rules:
//  • `iw-touch-guard` on the panel — any tap outside the contenteditable blurs it on iOS, the
//    keyboard retracts, and the docked pill + its just-opened menu slide to the screen bottom.
//  • `iw-nightable` + theme tokens with day fallbacks, never a hard-coded hex. Nobody has looked at
//    these panels in night mode; Peter is about to.
//  • Nothing here ticks React. The face and the ring subscribe to the store's imperative tick
//    channel (TimeFace/TimeRing) — this component re-renders only on real state changes.
//
// TONE (§A5): a ritual, not a dashboard. Sexy here means considered — no red numbers, no scores,
// no streak-shaming. A quiet day reads as a quiet day.
//
// TYPE (Peter, 2026-07-17): "the entire text font of the panel needs to be increased. It's okay if
// users have to scroll." / "Every font proportionally up." Sizes come from the ONE ramp
// (`music/typeScale.ts`) — the same one `GoalsSection` below already uses. NOT a second scale: two
// lanes wrote competing ramps once and that is how this repo forks. A `text-[11px]`/`text-xs` class
// anywhere in this file is a regression; the steps are SEMANTIC (`TYPE.label` because the thing IS a
// label), which is what stops the ramp regrowing into nine near-identical sizes.
//
// SCROLLING IS NOT A COST TO MINIMISE HERE. The panel is `maxHeight: 72vh` and overflows — that is
// the accepted trade, not a bug. Do not shrink a step to kill a scrollbar.
//
// THE 16px FLOOR — and what is actually true about it (MEASURED, `scripts/cssfloor.prove.mjs`):
// iOS Safari zooms into any focused control under 16px and STAYS zoomed. But index.css ALREADY
// floors `input, select, textarea` at `max(16px, 1em) !important` inside
// `@media (pointer: coarse) and (hover: none)`, and the probe confirms in a real engine that this
// beats an inline 13px on an iPhone 12 (computed 16px; desktop correctly leaves it 13px). So the
// 13px inputs these panels shipped were NOT zooming Peter's phone — they were backstopped.
//
// The floor stays on the ramp regardless, for reasons the backstop does not cover:
//  • It is phone-ONLY. Any coarse device the query misses gets the authored size, unfloored.
//  • It is INVISIBLE HERE. A 13px in this file reads as 13px to everyone; that a stylesheet three
//    directories away silently rewrites it on one device class is exactly the kind of spooky action
//    that makes a number untrustworthy. The authored size should BE the shipped size.
//  • Peter asked for bigger text anyway. 16 is the ramp's floor because it is the ramp's floor.
// `prodType.test.ts` fails the build if any control here slips under it, and DERIVES the CSS
// backstop's 16 from this ramp rather than re-typing it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/Scroll'
import { LEDGER_ROW_EVENT, isLabelSuppressed, setLabelSuppressed } from '../productivity/capture'
import { CHIME_VOICES, chimeMuted, chimeVoiceId, previewChime, setChimeMuted, setChimeVoiceId } from '../productivity/chime'
import { prodLedgerEnabled, setProdLedgerEnabled } from '../productivity/ledgerFlag'
import { addPostHocRow, annotateRow, loadLedger, saveReflection } from '../productivity/ledgerStore'
import { activePdfs, type PdfReadingState } from '../productivity/pdfActivity'
import { currentPlace, recentPlaces, setCurrentPlace } from '../productivity/places'
import { isPaused, type PomodoroConfig } from '../productivity/pomodoro'
import {
  getPomodoroState, loadPomodoroConfig, pausePomodoro, resumePomodoro, setPomodoroConfig,
  startPomodoro, stopPomodoro, subscribe,
} from '../productivity/pomodoroStore'
import { isPostHoc, isoWithOffset, localDayOf, localMonthOf, shouldOfferReflection, splitByEntry } from '../productivity/sessionLogic'
import type { DocType, Reflection, SessionRow } from '../productivity/types'
import { TOUCH_MIN, TYPE } from '../music/typeScale'
import { bibProvider } from '../citations/bibProvider'
import type { DocGoals } from '../types/document'
import { countdownShown, setCountdownShown } from './CountdownOverlay'
import { GoalsSection } from './GoalsSection'
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
      stroke="currentColor" strokeWidth={running ? 2 : 1.6} strokeLinecap="round">
      {/* Hands only — the button's own border circle is the bezel. */}
      <line x1="12" y1="12" x2="12" y2="6.6" />
      <line x1="12" y1="12" x2="15.8" y2="13.8" />
      <circle cx="12" cy="12" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ─── Small, considered controls ──────────────────────────────────────────────

function Pill({ active, onClick, children, title }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; title?: string
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title}
      className="rounded-full px-3 py-1 transition-colors"
      style={{
        fontSize: TYPE.meta,
        // A pill is a tap target, and it is the smallest one here — the HIG floor moves WITH the
        // ramp rather than being whatever the padding happened to add up to.
        minHeight: TOUCH_MIN,
        border: '1px solid var(--iw-nightable-border, #e7e5e4)',
        background: active ? 'var(--iw-ink, #5c2d8a)' : 'transparent',
        // NOT #fff: --iw-ink is light purple in night, so white text on it is illegible (measured).
        color: active ? 'var(--iw-on-ink, #fff)' : 'var(--iw-pill-fg, #78716c)',
        borderColor: active ? 'var(--iw-ink, #5c2d8a)' : undefined,
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
      className="rounded-full px-6 py-2 transition-all hover:brightness-110 active:scale-[0.98]"
      style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, background: 'var(--iw-ink, #5c2d8a)', color: 'var(--iw-on-ink, #fff)', boxShadow: '0 1px 6px rgba(92,45,138,0.28)' }}
    >
      {children}
    </button>
  )
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className="rounded-full px-5 py-2 transition-colors hover:bg-stone-50 active:scale-[0.98]"
      style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
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
 * ⚠ THIS IS A SECOND PLACE THE DAY'S MINUTES ARE SUMMED — `aggregate.ts` is the other — and it is
 * exactly how §A6.1's rule got broken once already. THE BUG, caught live by `pdfposthoc.prove.mjs`
 * driving the real panel: this function reduced over ALL rows, so the moment the post-hoc add landed,
 * 45 remembered minutes were reported back to the writer as "focused minutes". Every unit test was
 * green — they guard `aggregate.ts`, and the drop-up never calls it. **A guard on one implementation
 * of a rule says nothing about the other.**
 *
 * So the split happens HERE too, and the two numbers are spoken as different KINDS of thing. If a
 * third summariser ever appears, it must do the same — or better, all three should call one rule.
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

const WORK_PRESETS = [15, 25, 50]
const BREAK_PRESETS = [5, 10]
const LONG_PRESETS = [15, 30]
const EVERY_PRESETS = [3, 4, 5]

/**
 * The toolbar's clock — A TRIGGER, NEVER AN OWNER.
 *
 * The panel's open state is LIFTED to the editor (`ledgerOpen`), and this button only calls the
 * setter. That is load-bearing now that Peter has ruled the row stays SIX ("it fits well on phone,
 * and we want to keep the phone and desktop experience continuous"): `clock` competes for a slot and
 * lands in the ▲ overflow by default, so this component is often NOT MOUNTED. If it owned the state,
 * the countdown's "click to open" would silently do nothing whenever the clock sat in ▲ — a feature
 * that vanishes depending on where a button was dragged. Two access paths, one owner.
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

// ─── The drop-up ─────────────────────────────────────────────────────────────

export function LedgerDropUp({ docLabel, goals, onGoalsChange, onClose }: {
  docId: string; docLabel?: string; goals?: DocGoals; onGoalsChange: (g: DocGoals) => void; onClose: () => void
}): JSX.Element {
  // Resolve the anchor at open time rather than holding a ref: the trigger may be in the row, in the
  // ▲ overflow, or not rendered at all (opened from the countdown). Absent → centred.
  const anchor = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-iw-ledger-btn]')
  const [rows, setRows] = useState<SessionRow[]>([])
  const [reflections, setReflections] = useState<Reflection[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const month = localMonthOf(nowIso())
  const today = localDayOf(nowIso())
  const panelRef = useRef<HTMLDivElement>(null)

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

  // Escape closes, wherever the trigger lives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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

  // §A5b — the stretch since the last reflection, and whether to offer one. Rows already reflected
  // on are those ending at/before the newest reflection's `to`: the writer has spoken for that span,
  // so it is never raised again. `skipped` holds for THIS panel session only — "not now" means not
  // now, not never, and it must not be recorded anywhere (a skip is not a datum about him).
  const [skipped, setSkipped] = useState(false)
  const unreflected = useMemo(() => {
    const last = (reflections ?? []).reduce<string>((a, r) => (r.to > a ? r.to : a), '')
    return rows.filter((r) => localDayOf(r.start) === today && r.end > last)
  }, [rows, reflections, today])
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
      <div className="overflow-y-auto">
        <PomodoroHero />
        <ReadingSection />
        {offerReflection && (
          <ReflectionPrompt
            rows={unreflected}
            onSave={async (r) => { await saveReflection(month, r); void refresh() }}
            onSkip={() => setSkipped(true)}
          />
        )}
        <TodaySection rows={todays} summary={daySummary(todays)} onSaved={refresh} />
        <GoalsSection goals={goals} docLabel={docLabel} onChange={onGoalsChange} />
        <div className="px-4 py-2" style={{ borderTop: '1px solid var(--iw-nightable-border, #f0eeec)' }}>
          <button type="button" onClick={() => setShowSettings((s) => !s)}
            className="w-full text-left transition-colors hover:opacity-80"
            style={{ fontSize: TYPE.label, minHeight: TOUCH_MIN, color: 'var(--iw-pill-fg, #a8a29e)' }}
          >
            {showSettings ? '▾' : '▸'} Settings — lengths, chime, place, titles
          </button>
        </div>
        {showSettings && <SettingsSections docs={docs} />}
      </div>
    </div>,
    document.body,
  )
}

// ─── The hero: ring, face, and the one good button ───────────────────────────

function PomodoroHero(): JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const s = getPomodoroState()
  const paused = isPaused(s)

  const phaseLabel =
    s.phase === 'idle' ? 'Ready when you are'
    : paused ? 'Paused'
    : s.phase === 'work' ? 'Writing'
    : s.phase === 'break' ? 'Break' : 'Long break'

  return (
    <section className="flex flex-col items-center px-4 pb-4 pt-5">
      <div className="relative" style={{ width: 132, height: 132 }}>
        <TimeRing size={132} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* The countdown IS the title of this panel — the one big thing on screen. It was already
              30px by eye; now it is 30px because the ramp says so, and it moves if the ramp moves. */}
          <TimeFace className="tabular-nums" style={{ fontSize: TYPE.title, color: 'var(--iw-ink, #5c2d8a)', letterSpacing: '0.01em' }} />
          <span className="mt-0.5" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{phaseLabel}</span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {s.phase === 'idle' ? (
          <PrimaryButton onClick={startPomodoro}>Start</PrimaryButton>
        ) : (
          <>
            {paused
              ? <PrimaryButton onClick={resumePomodoro}>Resume</PrimaryButton>
              : <GhostButton onClick={pausePomodoro}>Pause</GhostButton>}
            <GhostButton onClick={stopPomodoro}>Stop</GhostButton>
          </>
        )}
      </div>

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
    </section>
  )
}

// ─── Reading (Peter: "a reading indicator on the ledger, next to a pdf name") ──
//
// SHOWS ONLY WHAT WE SAW. A PDF that is open but unscrolled does not appear — that is the honest
// state, not a detection failure: an open PDF nobody is scrolling is a tab you forgot about, and
// counting it is exactly how a reading number stops being true. So an empty section reads "no reading
// right now", never "0 minutes read".
//
// NO PROGRESS BAR — considered and rejected (§A3.2). We hold whether you scrolled, never where, so
// there is nothing to draw a progress bar FROM, and a page-by-page trace of the writer's private PDFs
// would be a far more sensitive object for no feature gain. If a progress reading ever seems needed,
// that is Peter's call, not a field to add here.

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
//
// §A5's register, and it decides every choice below: **a friend letting you correct the record, not a
// supervisor auditing your timesheet.** So it is COLLAPSED by default (an always-open form is a
// standing question about what you failed to log), it never nags, and using it is never scolded — the
// confirmation says what landed and stops talking.
//
// **DO NOT MAKE HIM PRECISE.** Rough duration, rough category, done. A form demanding start and end
// times won't get used on a Tuesday, and this whole feature dies if the ritual becomes data entry.
// Hence PILLS, not number inputs: every answer is one tap. The note is optional and a skipped note is
// not a failure.
//
// The honesty lives in the ROW (`entered: 'post-hoc'`), not in this form's copy — which is why the
// form can afford to be this relaxed. See types.ts.

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

// ─── Settings ────────────────────────────────────────────────────────────────

function SettingsSections({ docs }: { docs: Array<{ id: string; label?: string }> }): JSX.Element {
  const [cfg, setCfg] = useState<PomodoroConfig>(loadPomodoroConfig)
  const [voice, setVoice] = useState(chimeVoiceId)
  const [muted, setMuted] = useState(chimeMuted)
  const [place, setPlace] = useState(() => currentPlace() ?? '')
  const [recents, setRecents] = useState<string[]>(recentPlaces)
  const [countdown, setCountdown] = useState(countdownShown)

  const apply = (next: PomodoroConfig) => { setCfg(next); setPomodoroConfig(next) }
  const applyPlace = (label: string) => { setCurrentPlace(label); setPlace(label); setRecents(recentPlaces()) }

  return (
    <>
      <Section title="Lengths">
        <div className="space-y-2">
          {([
            ['Work', 'workMin', WORK_PRESETS],
            ['Break', 'breakMin', BREAK_PRESETS],
            ['Long break', 'longBreakMin', LONG_PRESETS],
            ['Long every', 'longBreakEvery', EVERY_PRESETS],
          ] as const).map(([label, key, presets]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>{label}</span>
              <div className="flex gap-1.5">
                {presets.map((v) => (
                  <Pill key={v} active={cfg[key] === v} onClick={() => apply({ ...cfg, [key]: v })}>
                    {v}{key === 'longBreakEvery' ? '' : 'm'}
                  </Pill>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Chime">
        <ul className="space-y-1">
          {CHIME_VOICES.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <button type="button"
                onClick={() => { setChimeVoiceId(v.id); setVoice(v.id); setChimeMuted(false); setMuted(false); previewChime(v.id) }}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-stone-50"
                style={{ minHeight: TOUCH_MIN }}
              >
                <span style={{ fontSize: TYPE.body, color: voice === v.id && !muted ? 'var(--iw-ink, #5c2d8a)' : 'var(--iw-pill-fg, #78716c)' }}>
                  {voice === v.id && !muted ? '◉' : '○'} {v.label}
                </span>
                <span className="truncate" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>{v.hint}</span>
              </button>
              {/* Preview: a tap is also the gesture iOS needs to unlock audio for the real chime. */}
              <button type="button" onClick={() => previewChime(v.id)} title={`Preview ${v.label}`}
                className="shrink-0 rounded-full px-2 py-1 transition-colors hover:bg-stone-50"
                style={{ fontSize: TYPE.label, minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
              >
                ▶
              </button>
            </li>
          ))}
          <li className="pt-1">
            <button type="button" onClick={() => { const m = !muted; setChimeMuted(m); setMuted(m) }}
              className="rounded-md px-2 py-1 transition-colors hover:bg-stone-50"
              style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, color: muted ? 'var(--iw-ink, #5c2d8a)' : 'var(--iw-pill-fg, #78716c)' }}
            >
              {muted ? '◉' : '○'} Silent
            </button>
          </li>
        </ul>
      </Section>

      <Section title="Where are you working?">
        <p className="mb-2" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #a8a29e)' }}>
          Optional. A word you choose — we never read your location.
        </p>
        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          onBlur={() => applyPlace(place)}
          placeholder="library, home, cafe…"
          className="w-full rounded-md px-2.5 py-1.5"
          style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, border: '1px solid var(--iw-nightable-border, #e7e5e4)', background: 'transparent' }}
        />
        {recents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recents.map((p) => <Pill key={p} active={p === place} onClick={() => applyPlace(p)}>{p}</Pill>)}
          </div>
        )}
      </Section>

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
