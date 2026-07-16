// The ledger — an openable surface (Peter, 2026-07-17): "users need to be able to open up the
// ledger ... to run the pomodoro from and put in notes like diary notes at the end of each session."
//
// §A5 IS THE BRIEF, and it is a hard constraint, not decoration: this is a RITUAL, not a report
// card. Every number here is descriptive; nothing is scored, ranked, or coloured red for being
// small. A quiet day reads as a quiet day ("a lighter day — 20 focused minutes on the Leibniz
// chapter"), never as a failure. Thinking-heavy, low-word sessions count the same as prolific ones,
// so the day summary leads with TIME and SESSIONS, not word count — words are shown, never judged.
// If you add anything here, it must pass that bar.
//
// THEMING (mandatory): every surface carries `iw-nightable`, and every custom colour is a theme
// token with a day fallback — never a hard-coded hex.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LEDGER_ROW_EVENT, isLabelSuppressed, setLabelSuppressed } from '../productivity/capture'
import { chimeMuted, setChimeMuted } from '../productivity/chime'
import { prodLedgerEnabled, setProdLedgerEnabled } from '../productivity/ledgerFlag'
import { installLedgerSource } from '../productivity/installSource'
import { annotateRow, loadLedger } from '../productivity/ledgerStore'
import { currentPlace, recentPlaces, setCurrentPlace } from '../productivity/places'
import { isoWithOffset, localDayOf, localMonthOf } from '../productivity/sessionLogic'
import type { SessionRow } from '../productivity/types'
import { formatRemaining, usePomodoro } from '../productivity/usePomodoro'
import { isPaused } from '../productivity/pomodoro'

const offsetMin = (): number => -new Date().getTimezoneOffset()
const nowIso = (): string => isoWithOffset(Date.now(), offsetMin())

const MONTH_LABEL = (month: string): string =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

const timeOf = (iso: string): string => iso.slice(11, 16)

// ─── Kind summary copy (§A5) ─────────────────────────────────────────────────
// Deliberately warm and factual. No "you only…", no streak-shaming, no red.
function daySummary(rows: SessionRow[]): string {
  if (rows.length === 0) return 'Nothing recorded yet today. Whenever you start, it will show up here.'
  const mins = Math.round(rows.reduce((a, r) => a + r.active_minutes, 0))
  const sessions = rows.length
  const net = rows.reduce((a, r) => a + r.net_words, 0)
  const shape =
    mins < 25 ? 'A short spell of work' : mins < 90 ? 'A steady stretch' : 'A long day at it'
  const words =
    net > 0 ? `, and the writing grew by ${net} word${net === 1 ? '' : 's'}` :
    net < 0 ? ', and you cut it back — editing is writing too' :
    ', spent shaping what was already there'
  return `${shape}: ${mins} focused minute${mins === 1 ? '' : 's'} across ${sessions} session${sessions === 1 ? '' : 's'}${words}.`
}

export function Ledger(): JSX.Element {
  const [enabled, setEnabled] = useState(() => prodLedgerEnabled())
  const [month, setMonth] = useState(() => localMonthOf(nowIso()))
  const [rows, setRows] = useState<SessionRow[]>([])
  const [place, setPlace] = useState(() => currentPlace() ?? '')
  const [recents, setRecents] = useState<string[]>(() => recentPlaces())
  const [muted, setMuted] = useState(() => chimeMuted())
  const [showConfig, setShowConfig] = useState(false)
  const pom = usePomodoro()

  const today = localDayOf(nowIso())

  const refresh = useCallback(async () => {
    const l = await loadLedger(month)
    setRows(l.rows)
  }, [month])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (enabled) installLedgerSource() }, [enabled])

  // A session closing is exactly when the diary note wants writing — refresh so it appears.
  useEffect(() => {
    const on = () => void refresh()
    window.addEventListener(LEDGER_ROW_EVENT, on)
    return () => window.removeEventListener(LEDGER_ROW_EVENT, on)
  }, [refresh])

  const todays = useMemo(() => rows.filter((r) => localDayOf(r.start) === today).reverse(), [rows, today])

  // The documents this month's ledger has recorded, newest first — the list the title control acts on.
  const docs = useMemo(() => {
    const seen = new Map<string, string | undefined>()
    for (const r of rows) if (!seen.has(r.doc_id)) seen.set(r.doc_id, r.doc_label)
    return [...seen.entries()].map(([id, label]) => ({ id, label }))
  }, [rows])

  const applyPlace = useCallback((label: string) => {
    setCurrentPlace(label)
    setPlace(label)
    setRecents(recentPlaces())
  }, [])

  const saveNote = useCallback(async (row: SessionRow, note: string) => {
    await annotateRow(localMonthOf(row.start), row.session_id, { note })
    void refresh()
  }, [refresh])

  if (!enabled) {
    return (
      <main className="iw-nightable min-h-screen bg-white px-6 py-16">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="mb-3 text-2xl" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Your ledger</h1>
          <p className="mb-6 text-stone-600">
            A Pomodoro rhythm, a record of how you worked, and a place to note what you did — kept in
            your own storage. Inkwave&rsquo;s servers never hold it.
          </p>
          <button
            onClick={() => { setProdLedgerEnabled(true); setEnabled(true) }}
            className="rounded-full px-5 py-2 text-white"
            style={{ background: 'var(--iw-ink, #5c2d8a)' }}
          >
            Turn on session tracking
          </button>
          <p className="mt-4 text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            Off by default. You can turn it off again at any time.
          </p>
        </div>
      </main>
    )
  }

  const phaseLabel =
    pom.state.phase === 'idle' ? 'Ready when you are'
    : pom.state.phase === 'work' ? 'Writing'
    : pom.state.phase === 'break' ? 'Break' : 'Long break'

  return (
    <main className="iw-nightable min-h-screen bg-white px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-2xl" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Your ledger</h1>
          <p className="text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            {MONTH_LABEL(month)} — kept in your own storage, never on our servers.
          </p>
        </header>

        {/* ── Pomodoro ────────────────────────────────────────────────── */}
        <section className="mb-8 rounded-2xl border p-6 text-center" style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}>
          <p className="mb-1 text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{phaseLabel}</p>
          <p className="mb-4 font-mono text-5xl tabular-nums" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
            {pom.state.phase === 'idle' ? formatRemaining(pom.state.config.workMin * 60_000) : formatRemaining(pom.remaining)}
          </p>

          <div className="mb-3 flex justify-center gap-2">
            {pom.state.phase === 'idle' ? (
              <button onClick={pom.start} className="rounded-full px-5 py-2 text-white" style={{ background: 'var(--iw-ink, #5c2d8a)' }}>
                Start
              </button>
            ) : (
              <>
                <button
                  onClick={isPaused(pom.state) ? pom.resume : pom.pause}
                  className="rounded-full border px-5 py-2"
                  style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-ink, #5c2d8a)' }}
                >
                  {isPaused(pom.state) ? 'Resume' : 'Pause'}
                </button>
                <button onClick={pom.stop} className="rounded-full border px-5 py-2" style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}>
                  Stop
                </button>
              </>
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            {pom.state.completed > 0 && `${pom.state.completed} block${pom.state.completed === 1 ? '' : 's'} today · `}
            <button onClick={() => setShowConfig((s) => !s)} className="underline">lengths</button>
            {' · '}
            <button onClick={() => { const m = !muted; setChimeMuted(m); setMuted(m) }} className="underline">
              {muted ? 'chime off' : 'chime on'}
            </button>
          </p>

          {showConfig && (
            <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm">
              {([
                ['workMin', 'Work'], ['breakMin', 'Break'], ['longBreakMin', 'Long break'], ['longBreakEvery', 'Long every'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
                  {label}
                  <input
                    type="number"
                    min={1}
                    value={pom.state.config[key]}
                    onChange={(e) => pom.setConfig({ ...pom.state.config, [key]: Number(e.target.value) })}
                    className="w-16 rounded border px-2 py-1"
                    style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        {/* ── Place (user-typed; never auto-detected) ─────────────────── */}
        <section className="mb-8">
          <label className="mb-1 block text-sm" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Where are you working?</label>
          <p className="mb-2 text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
            Optional. A word you choose — we never read your location.
          </p>
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => applyPlace(place)}
            placeholder="library, home, cafe…"
            className="w-full rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
          />
          {recents.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {recents.map((p) => (
                <button
                  key={p}
                  onClick={() => applyPlace(p)}
                  className="rounded-full border px-3 py-1 text-xs"
                  style={{
                    borderColor: 'var(--iw-nightable-border, #e7e5e4)',
                    color: p === place ? 'var(--iw-ink, #5c2d8a)' : 'var(--iw-pill-fg, #78716c)',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Today ───────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-1 text-lg" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Today</h2>
          <p className="mb-4 text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>{daySummary(todays)}</p>

          <ul className="space-y-3">
            {todays.map((r) => (
              <SessionCard key={r.session_id} row={r} onSaveNote={saveNote} />
            ))}
          </ul>
        </section>

        {/* ── Titles (§A3.2: doc_label is suppressible per-doc) ──────────── */}
        {docs.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-1 text-lg" style={{ color: 'var(--iw-ink, #5c2d8a)' }}>Titles</h2>
            <p className="mb-3 text-sm" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
              Your ledger records each document&rsquo;s title so you can tell your sessions apart. If a
              title is private, hide it — future sessions record the work without the name.
            </p>
            <ul className="space-y-2">
              {docs.map((d) => (
                <TitleRow key={d.id} docId={d.id} label={d.label} />
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-10 text-center text-xs" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          <button
            onClick={() => { setProdLedgerEnabled(false); setEnabled(false) }}
            className="underline"
          >
            Turn off session tracking
          </button>
          {' · '}
          <button onClick={() => setMonth(localMonthOf(nowIso()))} className="underline">this month</button>
        </footer>
      </div>
    </main>
  )
}

// ─── One document's title, and whether it is recorded (§A3.2) ────────────────
// The mechanism was wired into capture.ts's close path from the start, but NOTHING turned it on —
// so in practice every title travelled. This is the missing control. It is deliberately honest
// about its scope: it changes what FUTURE sessions record, because rows already written are inside
// an attested daily block and silently rewriting history is exactly what the ledger exists to make
// impossible.

function TitleRow({ docId, label }: { docId: string; label?: string }): JSX.Element {
  const [hidden, setHidden] = useState(() => isLabelSuppressed(docId))
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}>
      <span className="truncate text-sm" style={{ color: hidden ? 'var(--iw-pill-fg, #78716c)' : 'var(--iw-ink, #5c2d8a)' }}>
        {hidden ? <em>title hidden</em> : (label ?? <em>untitled</em>)}
      </span>
      <button
        onClick={() => { const next = !hidden; setLabelSuppressed(docId, next); setHidden(next) }}
        className="shrink-0 rounded-full border px-3 py-1 text-xs"
        style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-pill-fg, #78716c)' }}
      >
        {hidden ? 'Record title' : 'Hide title'}
      </button>
    </li>
  )
}

// ─── One session, and its diary note ─────────────────────────────────────────

function SessionCard({
  row,
  onSaveNote,
}: {
  row: SessionRow
  onSaveNote: (row: SessionRow, note: string) => Promise<void>
}): JSX.Element {
  const [note, setNote] = useState(row.note ?? '')
  const [saved, setSaved] = useState(false)

  // The row can be re-read from disk (another device, a refresh) — follow it.
  useEffect(() => { setNote(row.note ?? '') }, [row.note])

  const save = useCallback(async () => {
    if ((row.note ?? '') === note.trim()) return
    await onSaveNote(row, note)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [note, onSaveNote, row])

  return (
    <li className="rounded-xl border p-4" style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span style={{ color: 'var(--iw-ink, #5c2d8a)' }}>
          {row.doc_label ?? 'A document'}
          {row.pomodoro && <span className="ml-2 text-xs" style={{ color: 'var(--iw-light, #9b5ccc)' }}>pomodoro</span>}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
          {timeOf(row.start)}–{timeOf(row.end)} · {Math.round(row.active_minutes)} min
          {row.net_words !== 0 && ` · ${row.net_words > 0 ? '+' : ''}${row.net_words} words`}
          {row.place && ` · ${row.place}`}
        </span>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder="What did you do in this session? (optional)"
        className="w-full resize-y rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}
      />
      {saved && (
        <p className="mt-1 text-xs" style={{ color: 'var(--iw-verified, #15803d)' }}>Saved to your ledger.</p>
      )}
    </li>
  )
}
