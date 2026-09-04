// Client-side charts for the productivity layer — build-spec §A8.
//
// Hand-rolled SVG, following the repo's existing `src/verify/ActivityGraph.tsx` precedent: vector
// (crisp at any zoom), no chart dependency (this app hard-minimises its bundle and hand-rolls its
// PWA), and themed entirely through CSS custom properties so night mode needs no JS.
//
// Every mark's appearance comes from SERIES_STYLE[series.provenance] — see series.ts for why there
// is no style prop.

import { JUDGED_FILL_OPACITY, SERIES_STYLE, type Series } from './series'

const AXIS = 'var(--iw-pill-fg, #78716c)'
const GRID = 'var(--iw-nightable-border, #eee)'

/** The diagonal hatch that marks judged (AI) marks. Rendered once per chart that needs it. */
function HatchDefs() {
  return (
    <defs>
      <pattern id="iw-hatch-judged" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--iw-badge-ai, #b45309)" fillOpacity={JUDGED_FILL_OPACITY} />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--iw-badge-ai, #b45309)" strokeWidth="2" strokeOpacity="0.9" />
      </pattern>
    </defs>
  )
}

/**
 * Distinguishing two series that share a provenance — "words written" vs "words cut" are BOTH
 * measured, so both are solid, and without this they paint identically and the chart is unreadable.
 *
 * The variation is TONE ONLY (fill opacity), never the provenance's identity (its colour, hatch and
 * dash are untouched). So a second measured series is still unmistakably measured, and no amount of
 * toning can make a measured bar look judged or vice versa — the §A6.1 guarantee is unaffected.
 */
const TONES = [1, 0.48, 0.26]

function toneFor(series: readonly Series[], i: number): number {
  const p = series[i].provenance
  let nth = 0
  for (let k = 0; k < i; k++) if (series[k].provenance === p) nth++
  return TONES[Math.min(nth, TONES.length - 1)]
}

/** Paint attributes for a mark of a given provenance. The single place style is decided. */
function markProps(s: Series, tone = 1): {
  fill: string; fillOpacity: number; stroke: string; strokeDasharray: string; strokeWidth: number
} {
  const st = SERIES_STYLE[s.provenance]
  return {
    fill: st.hatch ? `url(#${st.hatch})` : st.fill,
    // A hatch pattern carries its own opacity; toning it too would wash it out.
    fillOpacity: st.hatch ? 1 : tone,
    stroke: st.stroke,
    strokeDasharray: st.dash,
    strokeWidth: st.fill === 'none' || st.hatch ? 1.5 : 0,
  }
}

/**
 * The legend that says which series is which (§A8: "with a legend that says which is which").
 * Not optional decoration — it is the sentence that makes the distinction legible.
 *
 * One row per SERIES (so two measured series are individually identifiable), with the provenance's
 * gloss printed on its FIRST appearance only — the reader learns "measured = counted from your own
 * record" once, then just reads the labels.
 */
export function Legend({ series }: { series: Series[] }) {
  const glossed = new Set<string>()
  return (
    <ul className="mt-2 space-y-1 text-[11px]" style={{ color: AXIS }}>
      {series.map((s, i) => {
        const st = SERIES_STYLE[s.provenance]
        const showGloss = !glossed.has(s.provenance)
        glossed.add(s.provenance)
        return (
          <li key={`${s.provenance}-${s.label}`} className="flex items-start gap-2">
            <svg width="14" height="10" className="mt-[3px] shrink-0" aria-hidden="true">
              <HatchDefs />
              <rect x="0.75" y="0.75" width="12.5" height="8.5" rx="1.5" {...markProps(s, toneFor(series, i))} />
            </svg>
            <span>{s.label}{showGloss ? ` — ${st.legend}` : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Axis scaling ─────────────────────────────────────────────────────────────

/**
 * Round an axis maximum up to a readable number, so ticks read 0 / 125 / 250 rather than
 * 0 / 107.2 / 214.3. Cosmetic, but this panel is aimed at an academic reader and a axis labelled
 * to one decimal of an arbitrary maximum looks like a chart that wasn't finished.
 */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const n = v / base
  // A fine ladder on purpose: a coarse one (…, 5, 10) rounded a 580-minute week up to a 1000-minute
  // axis and left the trend line hugging the middle of an empty plot. Every rung halves cleanly, so
  // the mid gridline stays readable too.
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => n <= s) ?? 10
  return step * base
}

// ─── Bars ─────────────────────────────────────────────────────────────────────

export interface BarChartProps {
  categories: string[]
  series: Series[]
  /** Accessible summary — required; a chart nobody can read is not shipped. */
  ariaLabel: string
  /** Unit suffix for value labels, e.g. `m` or ` words`. */
  unit?: string
  height?: number
}

/**
 * Grouped bars — time and words per day/week (§A8).
 * Measured series render solid; a judged series in the same chart renders hatched and lighter, so it
 * reads as an overlay laid ON the data rather than as more data.
 */
export function BarChart({ categories, series, ariaLabel, unit = '', height = 150 }: BarChartProps) {
  const W = 640, H = height, L = 34, R = 8, TOP = 10, BOT = 22
  const plotW = W - L - R, plotH = H - TOP - BOT
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)))
  const slot = plotW / Math.max(1, categories.length)
  const barW = Math.max(2, Math.min(26, (slot * 0.68) / Math.max(1, series.length)))
  const y = (v: number) => TOP + plotH - (v / max) * plotH

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} style={{ overflow: 'visible' }}>
        <HatchDefs />
        {/* y grid — three lines is enough to read a bar against without fencing the data in */}
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} y1={y(max * f)} x2={W - R} y2={y(max * f)} stroke={GRID} strokeWidth="1" />
            <text x={L - 5} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill={AXIS}>{fmtNum(max * f)}{unit}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const groupX = L + i * slot + slot / 2 - (series.length * barW) / 2
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0
                const h = Math.max(0, y(0) - y(v))
                return (
                  <rect
                    key={s.label} x={groupX + si * barW} y={y(v)} width={barW - 1} height={h} rx="1.5"
                    {...markProps(s, toneFor(series, si))}
                  >
                    <title>{`${c} — ${s.label}: ${fmtNum(v)}${unit}`}</title>
                  </rect>
                )
              })}
              <text x={L + i * slot + slot / 2} y={H - 7} textAnchor="middle" fontSize="9" fill={AXIS}>{c}</text>
            </g>
          )
        })}
        <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke={AXIS} strokeOpacity="0.35" />
      </svg>
      <Legend series={series} />
    </div>
  )
}

// ─── Histogram ────────────────────────────────────────────────────────────────

/**
 * The busiest-hours histogram (§A3.3, §A8) — 24 buckets of active minutes by local hour.
 * Descriptive at every window: it shows when you wrote. Any claim ABOUT it ("mornings are your deep
 * hours") is a pattern claim and goes through the §A6.2 gate in judged.ts — never rendered here.
 */
export function HourHistogram({ hours, ariaLabel }: { hours: number[]; ariaLabel: string }) {
  const W = 640, H = 110, L = 30, R = 8, TOP = 8, BOT = 20
  const plotW = W - L - R, plotH = H - TOP - BOT
  const max = niceMax(Math.max(1, ...hours))
  const bw = plotW / 24
  const style = SERIES_STYLE.measured

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <line x1={L} y1={TOP + plotH} x2={W - R} y2={TOP + plotH} stroke={AXIS} strokeOpacity="0.35" />
        <text x={L - 5} y={TOP + 7} textAnchor="end" fontSize="9" fill={AXIS}>{fmtNum(max)}m</text>
        {hours.map((v, h) => {
          const bh = (v / max) * plotH
          return (
            <rect key={h} x={L + h * bw + 1} y={TOP + plotH - bh} width={bw - 2} height={bh} rx="1.5" fill={style.fill}>
              <title>{`${String(h).padStart(2, '0')}:00 — ${fmtNum(v)} min`}</title>
            </rect>
          )
        })}
        {[0, 6, 12, 18, 23].map(h => (
          <text key={h} x={L + h * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={AXIS}>
            {h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ─── Line ─────────────────────────────────────────────────────────────────────

/** Trend line for monthly views (§A3.3 trend lines, §A8 "line for trends"). */
export function LineChart({ categories, series, ariaLabel, unit = '', height = 140 }: BarChartProps) {
  const W = 640, H = height, L = 34, R = 8, TOP = 10, BOT = 22
  const plotW = W - L - R, plotH = H - TOP - BOT
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)))
  const x = (i: number) => L + (categories.length === 1 ? plotW / 2 : (i / (categories.length - 1)) * plotW)
  const y = (v: number) => TOP + plotH - (v / max) * plotH

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} style={{ overflow: 'visible' }}>
        <HatchDefs />
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} y1={y(max * f)} x2={W - R} y2={y(max * f)} stroke={GRID} strokeWidth="1" />
            <text x={L - 5} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill={AXIS}>{fmtNum(max * f)}{unit}</text>
          </g>
        ))}
        {series.map(s => {
          const st = SERIES_STYLE[s.provenance]
          const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={st.stroke} strokeWidth="2" strokeDasharray={st.dash} strokeLinejoin="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--iw-paper, #fff)" stroke={st.stroke} strokeWidth="1.6">
                  <title>{`${categories[i]} — ${s.label}: ${fmtNum(v)}${unit}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
        {categories.map((c, i) => (
          <text key={c} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill={AXIS}>{c}</text>
        ))}
      </svg>
      <Legend series={series} />
    </div>
  )
}

// ─── Phase mix bar ────────────────────────────────────────────────────────────

/**
 * The deep-vs-shallow mix as a single stacked bar — drafting / editing / unclear.
 * `unclear` is drawn, labelled and counted. It is not a rendering failure: it is the rule declining
 * to call a session, and showing it is what stops the other two shares from being read as certainty.
 */
export function PhaseMixBar({ drafting, editing, unclear, total }: { drafting: number; editing: number; unclear: number; total: number }) {
  if (total === 0) return null
  const W = 640, H = 26
  const seg = [
    { n: drafting, label: 'drafting', fill: 'var(--iw-light, #484965)', op: 0.85 },
    { n: editing, label: 'editing', fill: 'var(--iw-light, #484965)', op: 0.42 },
    { n: unclear, label: 'unclear', fill: 'var(--iw-pill-fg, #78716c)', op: 0.22 },
  ]
  let cursor = 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Session mix by rule: ${drafting} drafting, ${editing} editing, ${unclear} unclear, of ${total} sessions`}>
      {seg.map(s => {
        const w = (s.n / total) * W
        const x = cursor
        cursor += w
        if (w <= 0) return null
        return (
          <g key={s.label}>
            <rect x={x} y="0" width={Math.max(0, w - 1)} height={H} rx="2" fill={s.fill} fillOpacity={s.op}
              stroke="var(--iw-light, #484965)" strokeOpacity="0.5" strokeDasharray="3 2" strokeWidth="1" />
            {w > 58 && (
              <text x={x + w / 2} y={17} textAnchor="middle" fontSize="10" fill="var(--iw-ink, #35283e)">
                {s.label} {Math.round((s.n / total) * 100)}%
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n * 10) / 10)
}
