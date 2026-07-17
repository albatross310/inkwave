// The free paste-back AI report — spec §A7.1, Path 1 (free, no login, maximal privacy).
//
// The writer copies a compiled payload, runs it in their OWN AI session, and pastes the reply
// back. Inkwave sends nothing; there is no key, no account and no cost, and this path is never
// paywalled (§C6). Everything below is client-side.
//
// The three things this screen exists to make visible:
//   • THE PROMPT (§A7.1.2) — the fixed half is shown verbatim, not summarised. What you read is
//     the string that gets copied; compile.ts builds both from the same call.
//   • THE CONSENT — three tiers (Peter, 2026-07-17), each labelled at the point of consent:
//       1. session metadata (times, words, edits) — always included
//       2. place labels + diary notes — opt-in, OFF by default. Without this tier, "metadata
//          only" would quietly mean "and what I wrote about my day". The place label is a word
//          the writer TYPED — Inkwave has no geolocation and the copy must never imply it does.
//       3. per-document text — opt-in, OFF by default, per document (§A7.3)
//   • THE SPLIT (§A6.1) — measured bars are Inkwave's own numbers; judged fields are drawn as a
//     separate, hatched, explicitly-labelled series. They never share a bar.
//
// Theming: `iw-nightable` + token vars with day fallbacks (CLAUDE.md, mandatory).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DayAggregate, ReportWindow, WindowAggregate } from '../productivity/types'
import { compilePayload } from '../productivity/report/compile'
import { DEFAULT_USER_PROMPT, headerLine } from '../productivity/report/prompt'
import { parseReply, allIssues, type ParsedReply } from '../productivity/report/report'
import { toCsv, toMarkdown, download } from '../productivity/report/download'
import { loadContent, loadGoals, loadSnapshots, loadWindow } from '../productivity/source'
import { sessionExcerpts } from '../productivity/report/excerpts'
import type { CompiledPayload } from '../productivity/report/compile'
import { prodReportDemo } from '../productivity/flag'

// ─── THE TYPE RAMP (Peter, 2026-07-17: "the entire text font of the panel needs to be
// increased… Every font proportionally up." / "It's okay if users have to scroll.") ──────────
// PROPORTIONALLY is the operative word, so the scale has ONE root and every size is an `em`
// fraction of it: bump PANEL_ROOT_PX and the whole ramp moves together, labels included. The
// previous ramp was absolute Tailwind steps (text-xs/sm/lg), which is exactly how you end up
// scaling the body and leaving the labels behind.
//
// Root 18px, +~29% on the old 14px body. iOS FLOOR: Safari auto-zooms — and STAYS zoomed — on a
// focused control under 16px, so every INPUT must land ≥16px. `FS.body` (1em = 18px) and above
// are the only sizes used on inputs; the smallest size here (0.62em ≈ 11px) is chart tick labels,
// which are not focusable. Scrolling is explicitly acceptable, so nothing is shrunk to fit.
const PANEL_ROOT_PX = 18
const FS = {
  tick: '0.62em',    // chart day numbers — never focusable
  meta: '0.8em',     // muted secondary/help text
  mono: '0.72em',    // the verbatim prompt + format blocks
  body: '1em',       // body copy, controls, INPUTS (≥16px — the iOS floor)
  title: '1.3em',    // the panel title
} as const

const INK = '#5c2d8a'
const ink = `var(--iw-ink, ${INK})`
const muted = 'var(--iw-pill-fg, #78716c)'
const border = `var(--iw-nightable-border, ${INK}33)`

const WINDOWS: { id: ReportWindow; label: string }[] = [
  { id: 'daily', label: 'Day' },
  { id: 'weekly', label: 'Week' },
  { id: 'monthly', label: 'Month' },
]

function Pill({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-3.5 py-1 rounded-full transition-colors"
      style={{
        background: on ? ink : 'transparent',
        color: on ? '#fff' : muted,
        fontSize: FS.body,
        border: `1px solid ${on ? 'transparent' : border}`,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  )
}

/**
 * One consent row (§A7.3). Five of these now, not three — Peter split notes from places
 * (2026-07-17) because they are one tier by provenance and two very different disclosures: a
 * place label is one word, a diary note is a paragraph about your day. Every row states plainly
 * what THAT box sends, at the point of consent, and every one is OFF by default.
 */
function ConsentRow({ on, onChange, label, children }: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex items-start gap-3 rounded px-3 py-2.5 cursor-pointer mb-2"
      style={{ fontSize: FS.body, border: `1px solid ${on ? ink : border}` }}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: INK, width: 16, height: 16, marginTop: 4 }} />
      <span className="flex-1">
        {label}
        <span className="block mt-1 leading-relaxed" style={{ fontSize: FS.meta, color: muted }}>
          {children}
        </span>
      </span>
      <span className="whitespace-nowrap" style={{ fontSize: FS.meta, color: on ? ink : muted }}>
        {on ? 'included' : 'not sent'}
      </span>
    </label>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="font-medium mb-2" style={{ color: ink, fontSize: FS.body }}>{children}</div>
}

// ─── The measured/judged graph (§A6.1, §A8) ─────────────────────────────────────────────────
// Solid bars = MEASURED. Hatched chips = JUDGED. The legend says which is which, and the two
// are never the same mark.
//
// SEAM: `feat/prod-graphs` owns the measured charts. This is a deliberately plain bar read of
// the same day rollups so the merge is visible end-to-end; when that branch lands, its chart
// replaces the bars here and the judged overlay stays.

const HATCH = 'repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 5px)'

function MeasuredJudgedChart({ days, judgedFor }: {
  days: DayAggregate[]
  judgedFor: (day: string) => { phase: string; effort: string } | null
}) {
  const max = Math.max(1, ...days.map(d => d.active_minutes))
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 120 }}>
        {days.map(d => {
          const j = judgedFor(d.day)
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1">
              {j && (
                <div title={`AI assessment: ${j.phase}, ${j.effort}`}
                  className="w-full rounded-sm"
                  style={{ height: 8, color: `var(--iw-light, #9b5ccc)`, backgroundImage: HATCH }} />
              )}
              <div className="w-full rounded-t-sm" title={`${d.active_minutes} active minutes (measured)`}
                style={{ height: `${(d.active_minutes / max) * 84}px`, background: ink, minHeight: 1 }} />
              <div className="tabular-nums" style={{ color: muted, fontSize: FS.tick }}>{d.day.slice(8)}</div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-3" style={{ color: muted, fontSize: FS.meta }}>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 14, height: 8, background: ink, borderRadius: 2, display: 'inline-block' }} />
          Measured by Inkwave — active minutes
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 14, height: 8, borderRadius: 2, display: 'inline-block', color: `var(--iw-light, #9b5ccc)`, backgroundImage: HATCH }} />
          AI assessment — interpretation, not measurement
        </span>
      </div>
    </div>
  )
}

// ─── The panel ──────────────────────────────────────────────────────────────────────────────

export function ProductivityReportModal({ onClose }: { onClose: () => void }) {
  const [window_, setWindow] = useState<ReportWindow>('weekly')
  const [agg, setAgg] = useState<WindowAggregate | null>(null)
  const [loading, setLoading] = useState(true)
  const [contentIds, setContentIds] = useState<string[]>([])   // §A7.3 — OFF by default
  // Every consent tick — all OFF by default, all reset when the window changes.
  const [includeNotes, setIncludeNotes] = useState(false)      // tier 2a — diary notes
  const [includePlaces, setIncludePlaces] = useState(false)    // tier 2b — place labels
  const [includeGoals, setIncludeGoals] = useState(false)      // tier 2c — §A5b goals + plan
  const [table, setTable] = useState('')                       // the "paste the table" box
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT)
  const [showPrompt, setShowPrompt] = useState(false)
  const [payload, setPayload] = useState<string | null>(null)
  const [compiled, setCompiled] = useState<CompiledPayload | null>(null)
  const [copied, setCopied] = useState(false)
  const [reply, setReply] = useState('')
  const [parsed, setParsed] = useState<ParsedReply | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setAgg(null)
    // Every tick starts OFF again — consent is given for a payload, and a new window is a new
    // payload. A tick must never survive a change of what it consents to.
    setContentIds([])
    setIncludeNotes(false)
    setIncludePlaces(false)
    setIncludeGoals(false)
    setTable('')
    setPayload(null)
    setCompiled(null)
    setParsed(null)
    loadWindow(window_).then(a => { if (live) { setAgg(a); setLoading(false) } })
    return () => { live = false }
  }, [window_])

  const preview = useMemo(
    () => (agg
      ? compilePayload({
        agg, contentDocIds: contentIds, includeNotes, includePlaces, userPrompt,
        // The PREVIEW cannot know whether goals/excerpts exist without fetching, so it shows the
        // prompt for what the ticks ASK for. compile() below re-derives from what actually
        // loaded — a doc with no goal set must not make the payload claim one.
        goals: includeGoals ? { preview: { goal: 'preview' } } : undefined,
      })
      : null),
    [agg, contentIds, includeNotes, includePlaces, includeGoals, userPrompt],
  )

  const compile = useCallback(async () => {
    if (!agg) return
    // Text is fetched HERE and only for ticked docs — nothing is read until the moment it is
    // consented to and compiled.
    const contentText = await loadContent(contentIds)
    // §A5b + the ledger+doc combo: each is fetched ONLY for ticked documents, and only now —
    // nothing is read until the moment it is consented to and compiled.
    // Goals are tier 2c and INDEPENDENT of the content tick: a goal is the writer's intent, not
    // the document's prose, so it is fetched for every doc in the window when that box is on.
    const goals = includeGoals ? await loadGoals(agg.docs.map(d => d.doc_id)) : {}
    const snaps = contentIds.length ? await loadSnapshots(contentIds) : {}
    const excerpts = agg.window === 'daily' ? sessionExcerpts(agg.sessions, snaps) : []
    const p = compilePayload({
      agg, contentDocIds: contentIds, includeNotes, includePlaces, contentText, goals, excerpts,
      userPrompt,
    })
    setCompiled(p)
    setPayload(p.text)
    try {
      await navigator.clipboard.writeText(p.text)
      setCopied(true)
      globalThis.setTimeout(() => setCopied(false), 2000)
    } catch { /* no clipboard permission — the textarea below still holds it */ }
  }, [agg, contentIds, includeNotes, includePlaces, includeGoals, userPrompt])

  const read = useCallback(() => {
    if (!agg || !payload) return
    // contentIncluded comes from the COMPILED payload, not from what is ticked now: the reply
    // must be judged against what was actually sent (§A6.1), or re-ticking a box after copying
    // would change whether a quality verdict is admissible.
    setParsed(parseReply(reply, {
      agg, payload, table, contentIncluded: compiled?.contentIncluded ?? false,
    }))
  }, [agg, payload, reply, table, compiled])

  const judgedByDay = useCallback((day: string) => {
    const r = parsed?.merged?.rows.find(x => x.key === day)
    return r?.judged ? { phase: r.judged.phase, effort: r.judged.effort } : null
  }, [parsed])

  const issues = parsed ? allIssues(parsed) : []

  return createPortal(
    <>
      <div className="fixed inset-0 z-[130]" style={{ background: 'rgba(35,25,50,0.35)' }} aria-hidden="true" onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Work report"
        className="iw-nightable fixed z-[131] bg-white shadow-lg font-serif text-stone-700 overflow-y-auto"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(48rem, calc(100vw - 2rem))', maxHeight: 'calc(100vh - 3rem)',
          borderRadius: 12, padding: '1.4rem 1.6rem', border: `1px solid ${border}`,
          // The one place the ramp is anchored — every FS.* below is an em of this.
          fontSize: PANEL_ROOT_PX,
        }}
        onMouseDown={e => e.stopPropagation()}>

        <div className="flex items-center gap-3">
          <div style={{ color: ink, fontWeight: 600, fontSize: FS.title }}>How you worked</div>
          <div className="ml-auto flex gap-1.5">
            {WINDOWS.map(w => (
              <Pill key={w.id} on={window_ === w.id} onClick={() => setWindow(w.id)}>{w.label}</Pill>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none px-1" style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {prodReportDemo() && (
          <div className="mt-3 rounded px-3 py-2" style={{ fontSize: FS.meta, background: `${INK}11`, color: muted, border: `1px dashed ${border}` }}>
            Demo mode (<code>?prodReport=demo</code>) — the figures below are synthetic sample data,
            not your work. The real ledger is not wired up yet.
          </div>
        )}

        {loading && <p className="mt-6" style={{ fontSize: FS.body, color: muted }}>Reading your ledger…</p>}

        {!loading && !agg && (
          <p className="mt-6 leading-relaxed" style={{ fontSize: FS.body, color: muted }}>
            There's no work ledger on this device yet, so there's nothing to report on. The ledger
            records how you worked — minutes, words, breaks — as you write.
          </p>
        )}

        {agg && (
          <>
            <p className="mt-4 leading-relaxed" style={{ fontSize: FS.body }}>
              Inkwave compiles your figures into a prompt. You run it in your own AI session and
              paste the reply back here. <strong>Inkwave sends nothing</strong> — no account, no
              key, no cost, and this way of doing it will never be paywalled.
            </p>

            {/* ── Tier 1: always included, stated plainly so the baseline isn't a mystery ── */}
            <div className="mt-5">
              <Heading>What gets included</Heading>
              <p className=" leading-relaxed mb-3" style={{ fontSize: FS.meta, color: muted }}>
                <strong>Always sent:</strong> how you worked — minutes, word counts, edits, breaks,
                and which document each session was in. Nothing else, unless you tick it below.
              </p>

              {/* ── Tier 2a/2b/2c: the writer's own words. Each its own tick, all OFF. ── */}
              <ConsentRow on={includeNotes} onChange={setIncludeNotes}
                label="Include my session notes">
                <strong>This sends the diary lines you wrote at the end of each session to your
                AI.</strong> They're your words about your own day, so they're left out unless you
                say so.
              </ConsentRow>

              <ConsentRow on={includePlaces} onChange={setIncludePlaces}
                label="Include where I worked">
                <strong>This sends the place labels you typed — "library", "home" — to your
                AI.</strong> Only the words you typed: Inkwave has no idea where you are and never
                asks.
              </ConsentRow>

              <ConsentRow on={includeGoals} onChange={setIncludeGoals}
                label="Include my goals and plans">
                <strong>This sends the goals and rough plans you wrote for your documents to your
                AI.</strong> It's what lets the report hold you to what you said you'd do, instead
                of making up a standard of its own. Without them it'll describe your work and leave
                the verdicts alone.
              </ConsentRow>

              {/* ── Tier 3 (§A7.3): document text, per document, OFF by default ── */}
              <p className=" leading-relaxed mb-2" style={{ fontSize: FS.meta, color: muted }}>
                <strong>Ticking a document below sends the text of that document to your AI.</strong>{' '}
                Tick the essay, leave the journal alone.
              </p>
              <div className="rounded" style={{ border: `1px solid ${border}` }}>
                {agg.docs.map((d, i) => {
                  const on = contentIds.includes(d.doc_id)
                  return (
                    <label key={d.doc_id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                      style={{ fontSize: FS.body, borderTop: i ? `1px solid ${border}` : 'none' }}>
                      <input type="checkbox" checked={on}
                        onChange={e => setContentIds(ids => e.target.checked
                          ? [...ids, d.doc_id]
                          : ids.filter(x => x !== d.doc_id))}
                        style={{ accentColor: INK, width: 15, height: 15 }} />
                      <span className="flex-1">
                        {d.doc_label || d.doc_id}
                        <span className=" ml-2" style={{ fontSize: FS.meta, color: muted }}>
                          {d.doc_type} · {d.active_minutes} min · {d.session_count} session{d.session_count === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="" style={{ fontSize: FS.meta, color: on ? ink : muted }}>
                        {on ? 'text included' : 'how you worked only'}
                      </span>
                    </label>
                  )
                })}
              </div>
              {contentIds.length > 0 && window_ !== 'daily' && (
                <p className=" mt-2" style={{ fontSize: FS.meta, color: ink }}>
                  Including full text over a {window_ === 'weekly' ? 'week' : 'month'} makes for a
                  very long prompt. Text works best on a single day.
                </p>
              )}
            </div>

            {/* ── §A7.1.2 the transparent prompt ── */}
            <div className="mt-5">
              <Heading>The prompt</Heading>
              <p className=" leading-relaxed mb-2" style={{ fontSize: FS.meta, color: muted }}>
                This is exactly what Inkwave asks your AI to do — the whole fixed half, word for
                word. Anything you add below is appended to it; the rules above win where they
                conflict.
              </p>
              <button type="button" onClick={() => setShowPrompt(s => !s)}
                className="underline mb-2" style={{ fontSize: FS.meta, color: ink, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {showPrompt ? 'Hide' : 'Show'} the fixed prompt
              </button>
              {showPrompt && preview && (
                <pre className=" leading-snug rounded p-3 overflow-x-auto whitespace-pre-wrap"
                  style={{ fontSize: FS.mono, background: `${INK}0d`, border: `1px solid ${border}`, maxHeight: 260, fontFamily: 'ui-monospace, monospace' }}>
                  {preview.fixed}
                </pre>
              )}
              <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)}
                rows={2} placeholder="Anything you'd like to add (optional)"
                className="w-full rounded p-2 mt-1"
                style={{ fontSize: FS.body, border: `1px solid ${border}`, background: 'transparent', resize: 'vertical' }} />
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button type="button" onClick={compile}
                className="px-4 py-1.5 rounded-full font-medium transition-colors hover:brightness-110"
                style={{ fontSize: FS.body, background: ink, color: '#fff', border: 'none', cursor: 'pointer' }}>
                {copied ? 'Copied ✓' : 'Copy the prompt'}
              </button>
              <span className="" style={{ fontSize: FS.meta, color: muted }}>
                Paste it into whatever you use — Claude, ChatGPT, anything — then bring the reply back.
              </span>
            </div>

            {/* ── §A7.1.5 paste-back — TWO boxes (Peter, 2026-07-17: "it also needs to
                 incorporate a 'copy the report back' and 'copy the csv back' into the same
                 window"). The round-trip used to make him select the whole reply by hand; the AI
                 gives him a copy button on the report and another on the code block, so this
                 takes them the way they actually arrive. Either box alone works. ── */}
            {payload && (
              <div className="mt-5">
                <Heading>Paste the reply back</Heading>
                <p className="leading-relaxed mb-2" style={{ fontSize: FS.meta, color: muted }}>
                  Copy the report into the first box and the table into the second — or drop the
                  whole reply into the first and Inkwave will find the table itself.
                </p>
                <textarea value={reply} onChange={e => setReply(e.target.value)}
                  rows={4} placeholder="The report — paste the AI's narrative here (or its whole reply)."
                  className="w-full rounded p-2"
                  style={{ fontSize: FS.body, border: `1px solid ${border}`, background: 'transparent', resize: 'vertical' }} />
                <textarea value={table} onChange={e => setTable(e.target.value)}
                  rows={3} placeholder="The table — paste the csv here (the AI's copy button on the code block)."
                  className="w-full rounded p-2 mt-2"
                  style={{ fontSize: FS.body, border: `1px solid ${border}`, background: 'transparent', resize: 'vertical' }} />
                <button type="button" onClick={read} disabled={!reply.trim() && !table.trim()}
                  className="mt-2 px-4 py-1.5 rounded-full font-medium transition-colors hover:brightness-110"
                  style={{
                    fontSize: FS.body,
                    background: (reply.trim() || table.trim()) ? ink : 'transparent',
                    color: (reply.trim() || table.trim()) ? '#fff' : muted,
                    border: (reply.trim() || table.trim()) ? 'none' : `1px solid ${border}`,
                    cursor: (reply.trim() || table.trim()) ? 'pointer' : 'default',
                  }}>
                  Read it back
                </button>
              </div>
            )}

            {/* ── §A7.1.5 graceful failure ── */}
            {parsed && !parsed.judged.ok && (
              <div className="mt-4 rounded p-3" style={{ fontSize: FS.body, border: `1px solid ${border}`, background: `${INK}0d` }}>
                <div className="font-medium mb-1" style={{ color: ink }}>Couldn't read the table</div>
                <p className=" leading-relaxed m-0" style={{ fontSize: FS.meta }}>{parsed.judged.issues[0]?.message}</p>
                <p className=" leading-relaxed mt-2 mb-1" style={{ fontSize: FS.meta, color: muted }}>
                  Paste the whole reply, including the fenced block. Inkwave is looking for:
                </p>
                <pre className=" rounded p-2 m-0 overflow-x-auto" style={{ fontSize: FS.mono, background: `${INK}11`, fontFamily: 'ui-monospace, monospace' }}>
                  {'```csv\n' + headerLine(window_) + '\n…one row per item, judged fields only\n```'}
                </pre>
                {parsed.narrative && (
                  <p className=" mt-2 mb-0" style={{ fontSize: FS.meta, color: muted }}>
                    The narrative came through and is shown below — nothing was thrown away.
                  </p>
                )}
              </div>
            )}

            {/* ── §A7.1.6 merge & graph ── */}
            {parsed && (
              <div className="mt-5">
                <Heading>Your {window_ === 'daily' ? 'day' : window_ === 'weekly' ? 'week' : 'month'}</Heading>
                <MeasuredJudgedChart days={agg.days} judgedFor={judgedByDay} />

                {parsed.causalClaims.length > 0 && (
                  <div className="mt-4 rounded p-3 leading-relaxed" style={{ fontSize: FS.meta, border: `1px dashed ${border}` }}>
                    <div className="font-medium mb-1" style={{ color: ink }}>
                      Flagged: {parsed.causalClaims.length} line{parsed.causalClaims.length === 1 ? '' : 's'} explaining the day rather than describing it
                    </div>
                    <p className="m-0 mb-2" style={{ color: muted }}>
                      Noticing what happened together today is fair — that's what a daily is for.
                      But one day can't show <em>why</em>, or whether it ever happens again, so
                      these are guesses rather than findings. The weekly report is where they get
                      tested.
                    </p>
                    <ul className="list-disc pl-4 m-0 space-y-1">
                      {parsed.causalClaims.map((c, i) => (
                        <li key={i}><em>“{c.marker}”</em> — {c.sentence}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {parsed.personVerdicts.length > 0 && (
                  <div className="mt-3 rounded p-3 leading-relaxed" style={{ fontSize: FS.meta, border: `1px dashed ${border}` }}>
                    <div className="font-medium mb-1" style={{ color: ink }}>
                      Flagged: {parsed.personVerdicts.length} line{parsed.personVerdicts.length === 1 ? '' : 's'} judging you rather than the work
                    </div>
                    <p className="m-0 mb-2" style={{ color: muted }}>
                      This report is meant to be honest about your week — including the bad days —
                      but not to hand down verdicts on you. Holding you to a goal you set is the
                      point; scoring you against a standard it invented isn't.
                    </p>
                    <ul className="list-disc pl-4 m-0 space-y-1">
                      {parsed.personVerdicts.map((v, i) => (
                        <li key={i}><em>“{v.marker}”</em> — {v.sentence}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {parsed.unverifiedNumbers.length > 0 && (
                  <div className="mt-3 rounded p-3 leading-relaxed" style={{ fontSize: FS.meta, border: `1px dashed ${border}` }}>
                    <div className="font-medium mb-1" style={{ color: ink }}>Numbers Inkwave can't confirm</div>
                    <p className="m-0" style={{ color: muted }}>
                      {parsed.unverifiedNumbers.join(', ')} — {parsed.unverifiedNumbers.length === 1 ? 'this numeral appears' : 'these numerals appear'} in
                      the narrative but not in what Inkwave sent. Inkwave's own figures, above, are
                      unaffected: they never went through the AI.
                    </p>
                  </div>
                )}

                {parsed.narrative && (
                  <div className="mt-4">
                    <div className=" uppercase tracking-wide mb-1" style={{ fontSize: FS.meta, color: `var(--iw-light, #9b5ccc)` }}>
                      AI assessment — your AI's words, not a measurement
                    </div>
                    <div className=" leading-relaxed whitespace-pre-wrap rounded p-3"
                      style={{ fontSize: FS.body, borderLeft: `3px solid var(--iw-light, #9b5ccc)`, background: `${INK}08` }}>
                      {parsed.narrative}
                    </div>
                  </div>
                )}

                {issues.length > 0 && (
                  <details className="mt-3" style={{ fontSize: FS.meta, color: muted }}>
                    <summary style={{ cursor: 'pointer', color: ink }}>
                      {issues.length} thing{issues.length === 1 ? '' : 's'} Inkwave noticed in the reply
                    </summary>
                    <ul className="list-disc pl-4 mt-2 space-y-1">
                      {issues.map((it, i) => <li key={i}>{it.message}</li>)}
                    </ul>
                  </details>
                )}

                <div className="mt-4 flex items-center gap-2.5">
                  <button type="button" onClick={() => download(`inkwave-${window_}-report.md`, toMarkdown(parsed), 'text/markdown')}
                    className="px-3.5 py-1 rounded-full transition-colors hover:bg-stone-100"
                    style={{ fontSize: FS.body, color: ink, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer' }}>
                    Download .md
                  </button>
                  {parsed.merged && (
                    <button type="button" onClick={() => download(`inkwave-${window_}-report.csv`, toCsv(parsed.merged!), 'text/csv')}
                      className="px-3.5 py-1 rounded-full transition-colors hover:bg-stone-100"
                      style={{ fontSize: FS.body, color: ink, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer' }}>
                      Download .csv
                    </button>
                  )}
                  <span className="" style={{ fontSize: FS.meta, color: muted }}>Yours to keep — opens in Excel.</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
