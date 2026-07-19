// The START-WORK FLOW's brain (Peter, 2026-07-18): "'Start work' opens the pomodoro and ASKS you
// WHERE you are and WHAT you're gonna do, and optionally set a pomodoro. At the END of the pomodoro,
// asks you to briefly SUMMARISE what you did."
//
// This module coordinates the pieces — it does NOT own any of them. It reuses:
//   • places.ts        — WHERE (a word the writer types; never geolocation).
//   • pomodoroStore    — the timer (optionally with a chosen work length).
//   • capture.ts       — the session the timer opens; its row is what a summary annotates.
//   • ledgerStore      — annotateRow lands the summary as the row's diary note (§A5).
//   • notify.ts        — asks for OS-notification permission on the gesture, lazily.
//
// MATCHING OUR BLOCK WITHOUT A RACE. We need the session_id of the block Start-work opened, but the
// capture engine opens it ASYNCHRONOUSLY (pomodoroStart awaits closing any prior draft first), so it
// is not available synchronously at start. And pomodoroStart's prior-session flush ALSO fires
// LEDGER_ROW_EVENT — so "grab the next row event" would grab the wrong session. Instead we stamp the
// start time and, when a row event fires, load that row and claim it only if it is a POMODORO row
// that STARTED AT OR AFTER our start. The prior flush started before us and is filtered out. This is
// timing-tolerant (a slack window), reads the real row, and never guesses.

import { annotateRow, loadLedger } from './ledgerStore'
import { requestNotificationPermission } from './notify'
import { setCurrentPlace } from './places'
import { LEDGER_ROW_EVENT } from './capture'
import { getPomodoroState, setPomodoroConfig, startPomodoro } from './pomodoroStore'

/** Fired when a Start-work block has ended and a summary is due. The editor opens the drop-up on it. */
export const WORK_SUMMARY_EVENT = 'inkwave:work-summary-due'

export interface WorkStart {
  /** The place label ("library") — optional, opt-in. Applied to the session as it closes. */
  place?: string
  /** WHAT the writer set out to do. Held as context for the end-of-block summary; never stored as a measurement. */
  intention?: string
  /** An optional custom work length (minutes) for THIS block. Absent keeps the saved default. */
  workMin?: number
}

/** A block that has ended and is waiting to be summarised. */
export interface PendingSummary {
  sessionId: string
  month: string
  /** What the writer said they'd do — shown above the summary box so the prompt has context. */
  intention?: string
}

interface Awaiting {
  startedAtMs: number
  intention?: string
}

// Slack: a row's `start` is stamped when the session opens, a hair after our start call. Allow a
// small negative window so clock rounding can't filter out our own block.
const START_SLACK_MS = 5_000

let awaiting: Awaiting | null = null
let pending: PendingSummary | null = null
let listening = false

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener(LEDGER_ROW_EVENT, (e) => {
    const detail = (e as CustomEvent<{ sessionId?: string; month?: string }>).detail
    if (!detail?.sessionId || !detail.month) return
    void tryClaim(detail.sessionId, detail.month)
  })
}

async function tryClaim(sessionId: string, month: string): Promise<void> {
  const a = awaiting
  if (!a) return
  try {
    const l = await loadLedger(month)
    const row = l.rows.find((r) => r.session_id === sessionId)
    if (!row || !row.pomodoro) return
    // Only OUR block: a pomodoro row that started at/after we pressed Start. The prior-session flush
    // that pomodoroStart triggers started before us and is skipped.
    if (Date.parse(row.start) < a.startedAtMs - START_SLACK_MS) return
    awaiting = null
    pending = { sessionId, month, intention: a.intention }
    try { window.dispatchEvent(new Event(WORK_SUMMARY_EVENT)) } catch { /* no-op */ }
  } catch { /* a read failure just means no summary is offered — never a broken close */ }
}

/**
 * Start a work block from the flow. Applies the place and (optionally) a chosen work length, asks for
 * notification permission on this gesture, starts the pomodoro, and arms the end-of-block summary.
 */
export function startWork(opts: WorkStart): void {
  ensureListener()
  if (opts.place !== undefined) setCurrentPlace(opts.place)
  if (typeof opts.workMin === 'number') {
    const s = getPomodoroState()
    // Merge onto the saved config so the other lengths are untouched. sanitiseConfig (inside
    // setPomodoroConfig) clamps it; an out-of-range value falls back to the default rather than
    // running a 0-minute block.
    setPomodoroConfig({ ...s.config, workMin: opts.workMin })
  }
  // Lazy permission ask — this is a user gesture (the Start tap), the honest moment to offer it.
  void requestNotificationPermission()
  awaiting = { startedAtMs: Date.now(), intention: opts.intention }
  startPomodoro()
}

/** The block awaiting a summary, if any. */
export function pendingSummary(): PendingSummary | null {
  return pending
}

/** Land the writer's summary as the block's ledger note (the existing annotate path). */
export async function submitSummary(text: string): Promise<void> {
  const p = pending
  pending = null
  if (!p) return
  const note = text.trim()
  if (note) await annotateRow(p.month, p.sessionId, { note })
}

/** Dismiss the summary offer — "not now" is not a datum; nothing is recorded. */
export function dismissSummary(): void {
  pending = null
}

/** Test seam. */
export function _resetWorkSession(): void {
  awaiting = null
  pending = null
}

/** Test seam — drive the claim path directly (the editor drives it via the row event). */
export function _armForTest(a: Awaiting): void {
  awaiting = a
}

/** Test seam — run the claim rule as the row-event listener would. */
export function _claimForTest(sessionId: string, month: string): Promise<void> {
  return tryClaim(sessionId, month)
}
