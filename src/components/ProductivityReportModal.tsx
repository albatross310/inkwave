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
import { loadContent, loadWindow } from '../productivity/source'
import { prodReportDemo } from '../productivity/flag'

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
      className="px-3.5 py-1 rounded-full text-sm transition-colors"
      style={{
        background: on ? ink : 'transparent',
        color: on ? '#fff' : muted,
        border: `1px solid ${on ? 'transparent' : border}`,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium mb-2" style={{ color: ink }}>{children}</div>
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
              <div className="text-[10px] tabular-nums" style={{ color: muted }}>{d.day.slice(8)}</div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: muted }}>
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
  const [includeNotes, setIncludeNotes] = useState(false)      // tier 2 — OFF by default
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT)
  const [showPrompt, setShowPrompt] = useState(false)
  const [payload, setPayload] = useState<string | null>(null)
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
    setPayload(null)
    setParsed(null)
    loadWindow(window_).then(a => { if (live) { setAgg(a); setLoading(false) } })
    return () => { live = false }
  }, [window_])

  const preview = useMemo(
    () => (agg ? compilePayload({ agg, contentDocIds: contentIds, includeNotes, userPrompt }) : null),
    [agg, contentIds, includeNotes, userPrompt],
  )

  const compile = useCallback(async () => {
    if (!agg) return
    // Text is fetched HERE and only for ticked docs — nothing is read until the moment it is
    // consented to and compiled.
    const contentText = await loadContent(contentIds)
    const p = compilePayload({ agg, contentDocIds: contentIds, includeNotes, contentText, userPrompt })
    setPayload(p.text)
    try {
      await navigator.clipboard.writeText(p.text)
      setCopied(true)
      globalThis.setTimeout(() => setCopied(false), 2000)
    } catch { /* no clipboard permission — the textarea below still holds it */ }
  }, [agg, contentIds, includeNotes, userPrompt])

  const read = useCallback(() => {
    if (!agg || !payload) return
    setParsed(parseReply(reply, { agg, payload }))
  }, [agg, payload, reply])

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
          width: 'min(46rem, calc(100vw - 2rem))', maxHeight: 'calc(100vh - 3rem)',
          borderRadius: 12, padding: '1.4rem 1.6rem', border: `1px solid ${border}`,
        }}
        onMouseDown={e => e.stopPropagation()}>

        <div className="flex items-center gap-3">
          <div className="text-lg" style={{ color: ink, fontWeight: 600 }}>How you worked</div>
          <div className="ml-auto flex gap-1.5">
            {WINDOWS.map(w => (
              <Pill key={w.id} on={window_ === w.id} onClick={() => setWindow(w.id)}>{w.label}</Pill>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none px-1" style={{ color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {prodReportDemo() && (
          <div className="mt-3 text-xs rounded px-3 py-2" style={{ background: `${INK}11`, color: muted, border: `1px dashed ${border}` }}>
            Demo mode (<code>?prodReport=demo</code>) — the figures below are synthetic sample data,
            not your work. The real ledger is not wired up yet.
          </div>
        )}

        {loading && <p className="mt-6 text-sm" style={{ color: muted }}>Reading your ledger…</p>}

        {!loading && !agg && (
          <p className="mt-6 text-sm leading-relaxed" style={{ color: muted }}>
            There's no work ledger on this device yet, so there's nothing to report on. The ledger
            records how you worked — minutes, words, breaks — as you write.
          </p>
        )}

        {agg && (
          <>
            <p className="mt-4 text-sm leading-relaxed">
              Inkwave compiles your figures into a prompt. You run it in your own AI session and
              paste the reply back here. <strong>Inkwave sends nothing</strong> — no account, no
              key, no cost, and this way of doing it will never be paywalled.
            </p>

            {/* ── Tier 1: always included, stated plainly so the baseline isn't a mystery ── */}
            <div className="mt-5">
              <Heading>What gets included</Heading>
              <p className="text-xs leading-relaxed mb-3" style={{ color: muted }}>
                <strong>Always sent:</strong> how you worked — minutes, word counts, edits, breaks,
                and which document each session was in. Nothing else, unless you tick it below.
              </p>

              {/* ── Tier 2: the writer's own words. OFF by default. ── */}
              <label className="flex items-start gap-3 rounded px-3 py-2.5 text-sm cursor-pointer mb-3"
                style={{ border: `1px solid ${includeNotes ? ink : border}` }}>
                <input type="checkbox" checked={includeNotes}
                  onChange={e => setIncludeNotes(e.target.checked)}
                  style={{ accentColor: INK, width: 15, height: 15, marginTop: 3 }} />
                <span className="flex-1">
                  Include my session notes and places
                  <span className="block text-xs mt-1 leading-relaxed" style={{ color: muted }}>
                    <strong>This sends the diary lines you wrote at the end of each session, and the
                    place you typed for each one, to your AI.</strong> They're your words about your
                    own day, so they're left out unless you say otherwise. (Places are only what you
                    typed — Inkwave doesn't know or track where you are.)
                  </span>
                </span>
                <span className="text-xs whitespace-nowrap" style={{ color: includeNotes ? ink : muted }}>
                  {includeNotes ? 'included' : 'not sent'}
                </span>
              </label>

              {/* ── Tier 3 (§A7.3): document text, per document, OFF by default ── */}
              <p className="text-xs leading-relaxed mb-2" style={{ color: muted }}>
                <strong>Ticking a document below sends the text of that document to your AI.</strong>{' '}
                Tick the essay, leave the journal alone.
              </p>
              <div className="rounded" style={{ border: `1px solid ${border}` }}>
                {agg.docs.map((d, i) => {
                  const on = contentIds.includes(d.doc_id)
                  return (
                    <label key={d.doc_id}
                      className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer"
                      style={{ borderTop: i ? `1px solid ${border}` : 'none' }}>
                      <input type="checkbox" checked={on}
                        onChange={e => setContentIds(ids => e.target.checked
                          ? [...ids, d.doc_id]
                          : ids.filter(x => x !== d.doc_id))}
                        style={{ accentColor: INK, width: 15, height: 15 }} />
                      <span className="flex-1">
                        {d.doc_label || d.doc_id}
                        <span className="text-xs ml-2" style={{ color: muted }}>
                          {d.doc_type} · {d.active_minutes} min · {d.session_count} session{d.session_count === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="text-xs" style={{ color: on ? ink : muted }}>
                        {on ? 'text included' : 'how you worked only'}
                      </span>
                    </label>
                  )
                })}
              </div>
              {contentIds.length > 0 && window_ !== 'daily' && (
                <p className="text-xs mt-2" style={{ color: ink }}>
                  Including full text over a {window_ === 'weekly' ? 'week' : 'month'} makes for a
                  very long prompt. Text works best on a single day.
                </p>
              )}
            </div>

            {/* ── §A7.1.2 the transparent prompt ── */}
            <div className="mt-5">
              <Heading>The prompt</Heading>
              <p className="text-xs leading-relaxed mb-2" style={{ color: muted }}>
                This is exactly what Inkwave asks your AI to do — the whole fixed half, word for
                word. Anything you add below is appended to it; the rules above win where they
                conflict.
              </p>
              <button type="button" onClick={() => setShowPrompt(s => !s)}
                className="text-xs underline mb-2" style={{ color: ink, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {showPrompt ? 'Hide' : 'Show'} the fixed prompt
              </button>
              {showPrompt && preview && (
                <pre className="text-[11px] leading-snug rounded p-3 overflow-x-auto whitespace-pre-wrap"
                  style={{ background: `${INK}0d`, border: `1px solid ${border}`, maxHeight: 260, fontFamily: 'ui-monospace, monospace' }}>
                  {preview.fixed}
                </pre>
              )}
              <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)}
                rows={2} placeholder="Anything you'd like to add (optional)"
                className="w-full text-sm rounded p-2 mt-1"
                style={{ border: `1px solid ${border}`, background: 'transparent', resize: 'vertical' }} />
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button type="button" onClick={compile}
                className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors hover:brightness-110"
                style={{ background: ink, color: '#fff', border: 'none', cursor: 'pointer' }}>
                {copied ? 'Copied ✓' : 'Copy the prompt'}
              </button>
              <span className="text-xs" style={{ color: muted }}>
                Paste it into Claude (or any AI), then bring the whole reply back.
              </span>
            </div>

            {/* ── §A7.1.5 paste-back ── */}
            {payload && (
              <div className="mt-5">
                <Heading>Paste the reply</Heading>
                <textarea value={reply} onChange={e => setReply(e.target.value)}
                  rows={4} placeholder="Paste the AI's whole reply here — narrative and table."
                  className="w-full text-sm rounded p-2"
                  style={{ border: `1px solid ${border}`, background: 'transparent', resize: 'vertical' }} />
                <button type="button" onClick={read} disabled={!reply.trim()}
                  className="mt-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors hover:brightness-110"
                  style={{ background: reply.trim() ? ink : 'transparent', color: reply.trim() ? '#fff' : muted, border: reply.trim() ? 'none' : `1px solid ${border}`, cursor: reply.trim() ? 'pointer' : 'default' }}>
                  Read the reply
                </button>
              </div>
            )}

            {/* ── §A7.1.5 graceful failure ── */}
            {parsed && !parsed.judged.ok && (
              <div className="mt-4 rounded p-3 text-sm" style={{ border: `1px solid ${border}`, background: `${INK}0d` }}>
                <div className="font-medium mb-1" style={{ color: ink }}>Couldn't read the table</div>
                <p className="text-xs leading-relaxed m-0">{parsed.judged.issues[0]?.message}</p>
                <p className="text-xs leading-relaxed mt-2 mb-1" style={{ color: muted }}>
                  Paste the whole reply, including the fenced block. Inkwave is looking for:
                </p>
                <pre className="text-[11px] rounded p-2 m-0 overflow-x-auto" style={{ background: `${INK}11`, fontFamily: 'ui-monospace, monospace' }}>
                  {'```csv\n' + headerLine(window_) + '\n…one row per item, judged fields only\n```'}
                </pre>
                {parsed.narrative && (
                  <p className="text-xs mt-2 mb-0" style={{ color: muted }}>
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
                  <div className="mt-4 rounded p-3 text-xs leading-relaxed" style={{ border: `1px dashed ${border}` }}>
                    <div className="font-medium mb-1" style={{ color: ink }}>
                      Flagged: {parsed.causalClaims.length} claim{parsed.causalClaims.length === 1 ? '' : 's'} about cause or pattern
                    </div>
                    <p className="m-0 mb-2" style={{ color: muted }}>
                      This is one day, and one day can't show a pattern or a cause — so these read as
                      guesses, not findings. A week has enough to go on.
                    </p>
                    <ul className="list-disc pl-4 m-0 space-y-1">
                      {parsed.causalClaims.map((c, i) => (
                        <li key={i}><em>“{c.marker}”</em> — {c.sentence}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {parsed.unverifiedNumbers.length > 0 && (
                  <div className="mt-3 rounded p-3 text-xs leading-relaxed" style={{ border: `1px dashed ${border}` }}>
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
                    <div className="text-xs uppercase tracking-wide mb-1" style={{ color: `var(--iw-light, #9b5ccc)` }}>
                      AI assessment — your AI's words, not a measurement
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap rounded p-3"
                      style={{ borderLeft: `3px solid var(--iw-light, #9b5ccc)`, background: `${INK}08` }}>
                      {parsed.narrative}
                    </div>
                  </div>
                )}

                {issues.length > 0 && (
                  <details className="mt-3 text-xs" style={{ color: muted }}>
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
                    className="px-3.5 py-1 rounded-full text-sm transition-colors hover:bg-stone-100"
                    style={{ color: ink, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer' }}>
                    Download .md
                  </button>
                  {parsed.merged && (
                    <button type="button" onClick={() => download(`inkwave-${window_}-report.csv`, toCsv(parsed.merged!), 'text/csv')}
                      className="px-3.5 py-1 rounded-full text-sm transition-colors hover:bg-stone-100"
                      style={{ color: ink, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer' }}>
                      Download .csv
                    </button>
                  )}
                  <span className="text-xs" style={{ color: muted }}>Yours to keep — opens in Excel.</span>
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
