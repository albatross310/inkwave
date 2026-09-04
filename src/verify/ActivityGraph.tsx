// The provenance activity graph on /verify. Pure SVG (vector — crisp at any browser zoom) with its
// own wheel-to-zoom + drag-to-pan on the time axis, so a reader can zoom into any moment of the
// composition. Two stacked panels share the time axis:
//   • top — cumulative word count over time, with a dot at every snapshot and the old→new word
//     written above each kick/swap;
//   • bottom — per-0.5s characters inserted (up, green) and deleted (down, red), the paid cadence.
// Everything is derived from the signed/anchored data (see computeAnalytics); it shows the record,
// it doesn't assert anything beyond it.

import { useMemo, useRef, useState } from 'react'
import type { Analytics } from './analytics'

const INK = '#302438'
const LIGHT = '#41425b'
const ADD = '#2f8f4e'
const DEL = '#b3402f'

// SVG user-space canvas (the viewBox); the element scales to its container, staying crisp.
const W = 1000, H = 360, L = 12, R = 12, TOP = 36, BOT = 26
const PLOT_W = W - L - R
const WORDS_H = 168
const ACT_TOP = TOP + WORDS_H + 20
const ACT_H = H - ACT_TOP - BOT

function fmtElapsed(msFromStart: number): string {
  const s = Math.max(0, Math.round(msFromStart / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60)
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

export function ActivityGraph({ a }: { a: Analytics }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<[number, number]>([a.tMin, a.tMax])
  const drag = useRef<{ x: number; v0: number; v1: number } | null>(null)
  const [v0, v1] = view
  const span = Math.max(1, v1 - v0)
  const full = a.tMax - a.tMin

  const xs = (t: number) => L + ((t - v0) / span) * PLOT_W
  const inView = (t: number) => t >= v0 - span * 0.02 && t <= v1 + span * 0.02

  const maxWords = useMemo(() => Math.max(1, ...a.words.map((p) => p.words)), [a.words])
  const wy = (w: number) => TOP + WORDS_H - (w / maxWords) * WORDS_H

  const maxBar = useMemo(() => Math.max(1, ...a.intervals.map((b) => Math.max(b.added, b.removed))), [a.intervals])
  const actMid = ACT_TOP + ACT_H / 2
  const ah = (n: number) => (n / maxBar) * (ACT_H / 2)
  const barW = 7

  const wordsPath = useMemo(() => {
    const pts = a.words.filter((p, i) => i === 0 || i === a.words.length - 1 || inView(p.t))
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(p.t).toFixed(1)},${wy(p.words).toFixed(1)}`).join(' ')
  }, [a.words, v0, v1]) // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    const tAt = v0 + ((px - L) / PLOT_W) * span
    const f = e.deltaY > 0 ? 1.25 : 0.8
    let n0 = tAt - (tAt - v0) * f, n1 = tAt + (v1 - tAt) * f
    n0 = Math.max(a.tMin, n0); n1 = Math.min(a.tMax, n1)
    if (n1 - n0 > 800) setView([n0, n1])
  }
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, v0, v1 }; (e.target as Element).setPointerCapture?.(e.pointerId) }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, rect = svgRef.current?.getBoundingClientRect(); if (!d || !rect) return
    const dt = ((e.clientX - d.x) / rect.width) * span
    let n0 = d.v0 - dt, n1 = d.v1 - dt
    if (n0 < a.tMin) { n1 += a.tMin - n0; n0 = a.tMin }
    if (n1 > a.tMax) { n0 -= n1 - a.tMax; n1 = a.tMax }
    setView([Math.max(a.tMin, n0), Math.min(a.tMax, n1)])
  }
  const onUp = () => { drag.current = null }

  // X-axis ticks: 5 evenly across the view.
  const ticks = Array.from({ length: 5 }, (_, i) => v0 + (span * i) / 4)
  const zoomed = v1 - v0 < full - 1
  // Limit word-nudge labels to what's readable in view.
  const viewKicks = a.nudges.filter((k) => inView(k.t))
  const showLabels = viewKicks.length <= 28

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-1 text-xs text-stone-400">
        <span>Composition over time {zoomed ? '(zoomed — scroll to zoom, drag to pan)' : '(scroll to zoom in, drag to pan)'}</span>
        {zoomed && <button onClick={() => setView([a.tMin, a.tMax])} className="underline" style={{ color: LIGHT }}>reset</button>}
      </div>
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="Graph of word count and typing activity over the writing session"
        style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab', background: '#fcfaf6', borderRadius: 8, border: '1px solid #eee' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <defs>
          <clipPath id="plot"><rect x={L} y={0} width={PLOT_W} height={H} /></clipPath>
          <linearGradient id="wfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIGHT} stopOpacity="0.18" />
            <stop offset="100%" stopColor={LIGHT} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* x grid + elapsed labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={xs(t)} y1={TOP} x2={xs(t)} y2={H - BOT} stroke="#eee" />
            <text x={xs(t)} y={H - 8} textAnchor="middle" fontSize="11" fill="#b0a898">{fmtElapsed(t - a.tMin)}</text>
          </g>
        ))}

        <g clipPath="url(#plot)">
          {/* words area + line */}
          <path d={`${wordsPath} L${xs(a.words[a.words.length - 1]?.t ?? v1).toFixed(1)},${TOP + WORDS_H} L${xs(a.words[0]?.t ?? v0).toFixed(1)},${TOP + WORDS_H} Z`} fill="url(#wfill)" />
          <path d={wordsPath} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />

          {/* snapshot dots + word-count labels */}
          {a.snapshots.filter((s) => inView(s.t)).map((s, i) => (
            <g key={i}>
              <circle cx={xs(s.t)} cy={wy(s.words)} r="3.5" fill="#fff" stroke={INK} strokeWidth="1.6" />
              <text x={xs(s.t)} y={wy(s.words) - 7} textAnchor="middle" fontSize="10" fill={INK}>{s.words}</text>
            </g>
          ))}

          {/* kick markers: tick on the timeline + old→new written above */}
          {viewKicks.map((k, i) => (
            <g key={i}>
              <line x1={xs(k.t)} y1={TOP} x2={xs(k.t)} y2={TOP + WORDS_H} stroke={LIGHT} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />
              {showLabels && (
                <text x={xs(k.t)} y={TOP - 6 - (i % 2) * 13} textAnchor="middle" fontSize="10" fill={LIGHT}>
                  <tspan fill="#9b2226">{k.old}</tspan>{k.replacement ? <tspan>{` → ${k.replacement}`}</tspan> : null}
                </text>
              )}
            </g>
          ))}

          {/* per-snapshot words added (up) / deleted (down) — lower bound */}
          {a.intervals.filter((b) => inView(b.t)).map((b, i) => (
            <g key={i}>
              {b.added > 0 && <rect x={xs(b.t) - barW / 2} y={actMid - ah(b.added)} width={barW} height={ah(b.added)} fill={ADD} opacity="0.85" rx="1" />}
              {b.removed > 0 && <rect x={xs(b.t) - barW / 2} y={actMid} width={barW} height={ah(b.removed)} fill={DEL} opacity="0.8" rx="1" />}
            </g>
          ))}
        </g>

        {/* panel labels + activity baseline */}
        <text x={L} y={TOP - 22} fontSize="11" fill="#b0a898">words</text>
        <line x1={L} y1={actMid} x2={W - R} y2={actMid} stroke="#ddd" />
        <text x={L} y={ACT_TOP - 6} fontSize="11" fill={ADD}>words added ▲</text>
        <text x={L} y={H - BOT + 0} fontSize="11" fill={DEL}>words deleted ▼ (per snapshot, ≥ lower bound)</text>
      </svg>
    </div>
  )
}
