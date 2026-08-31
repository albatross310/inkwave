// THE ?snapThumbs=debug OVERLAY for the fast snapshot scrubbing.
//
// Extracted from SnapshotView.tsx verbatim. It is a diagnostic: `?snapThumbs=debug` only, never on
// a writer's screen, aria-hidden and pointer-events:none. It comes out because it is 120 lines and
// a `setInterval` that the route it lived in never consulted — and because leaving it there kept a
// dead exemption alive in snapshotPalette.test.ts (see that file).

import { useEffect, useRef, useState } from 'react'
import { summariseRecord, type ScrubPresenter } from '../editor/scrubRaster'
import { snapThumbsEnabled, thumbStats, thumbPaneCounts } from '../editor/snapThumbs'

// ── ?snapThumbs=debug overlay ─────────────────────────────────────────────────────────────────
// The wave-video lesson: an on-device readout beats hours of guessing. One glance must separate
// the three failure modes: (1) the rAF flipbook never ran (legacy per-notch goTo → live renders a
// few times a second), (2) it ran but the cache was EMPTY (show() had nothing → frozen pane), or
// (3) it presented into an INVISIBLE node (the video's transparent-element bug). Read PAINTED.
//
// ITS PALETTE IS DELIBERATELY THE SAME IN BOTH THEMES — a black instrument panel, because a HUD
// that changed colour with the theme would be harder to read a burst off, not easier. It is tokens
// rather than literals anyway, and the reason is worth the six lines: a bare `#ffd479` in a
// component is indistinguishable at a glance from one nobody has audited yet, which is exactly how
// the PDF toolbar sat unthemed for two months looking like a choice. The token STATES the
// invariance where a literal merely fails to theme. Declared in index.css beside --iw-score-gap,
// which is the same idea ("paper, both themes").
const HUD = {
  bg: 'var(--iw-hud-bg, rgba(0,0,0,0.86))',
  fg: 'var(--iw-hud-fg, #ffffff)',
  edge: 'var(--iw-hud-edge, #444444)',
  head: 'var(--iw-hud-head, #ffd479)',
  ok: 'var(--iw-hud-ok, #c8ffc8)',
  bad: 'var(--iw-hud-bad, #ff8080)',
}
export function ScrubDebugOverlay({ presenter, dbg, docId, snapCount }: {
  presenter: ScrubPresenter
  dbg: React.MutableRefObject<{ engaged: boolean; events: number; legacy: number; lands: number; commanded: Set<string> }>
  docId: string | null
  snapCount: number // library size — the sweep's denominator
}) {
  const [, force] = useState(0)
  // RECORDED burst (round 10). This overlay repaints on the SAME main thread the scrub saturates,
  // so anything it draws MID-burst is a stale render of the instrument itself — Peter's mid-scrub
  // capture came back byte-identical to his idle one, which is why every number we had was really
  // an at-rest sample. So: while a burst runs, say RECORDING and show nothing; the moment it
  // settles, serialise the presenter's ring buffer and print THAT. Never trust the live counters.
  const [burst, setBurst] = useState<ReturnType<typeof summariseRecord> | null>(null)
  const wasActive = useRef(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      const act = presenter.isActive()
      if (wasActive.current && !act) setBurst(summariseRecord(presenter.record())) // settled → dump
      wasActive.current = act
      force((n) => n + 1)
    }, 200)
    return () => window.clearInterval(id)
  }, [presenter])
  const recording = presenter.isActive()
  const info = presenter.debugInfo()
  const d = dbg.current
  const st = docId ? thumbStats(docId) : { entries: 0, bytes: 0, loaded: false }
  const bake = docId ? thumbPaneCounts(docId) : { doc: 0, diff: 0, map: 0 }
  const on = snapThumbsEnabled()
  const row = (k: string, v: string, bad?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: bad ? HUD.bad : HUD.ok }}>
      <span style={{ opacity: 0.75 }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span>
    </div>
  )
  return (
    <div style={{
      position: 'fixed', top: 6, left: 6, zIndex: 99999, pointerEvents: 'none',
      background: HUD.bg, color: HUD.fg, font: '11px/1.35 ui-monospace, monospace',
      padding: '7px 9px', borderRadius: 6, minWidth: 268, border: `1px solid ${HUD.edge}`,
    }}>
      {/* THE RECORDED BURST — the only numbers on this overlay that a burst can't lie about. */}
      <div style={{ fontWeight: 800, marginBottom: 3, color: HUD.head }}>
        last burst — RECORDED {recording && <span style={{ color: HUD.bad }}>● REC…</span>}
      </div>
      {!burst && row('recorded bursts', 'none yet — scrub once', true)}
      {burst && (<>
        {row('presents', String(burst.presents), burst.presents === 0)}
        {row('commanded distinct', String(burst.commandedDistinct))}
        {row('presented distinct', String(burst.presentedDistinct), burst.presentedDistinct < burst.commandedDistinct)}
        {row('rate', `${burst.perSec.toFixed(0)}/s over ${burst.spanMs.toFixed(0)}ms`)}
        {burst.panes.map((p) => row(
          `${p.kind} hit/thumb/near/none`, `${p.hit}/${p.thumb}/${p.near}/${p.none}  ${(p.exactRate * 100).toFixed(0)}% real`,
          p.exactRate < 0.5,
        ))}
        <div style={{ fontWeight: 800, margin: '4px 0 2px', color: HUD.head }}>registration — content held?</div>
        {burst.panes.map((p) => row(
          `${p.kind} centre held`,
          p.registered < 0 ? 'n/a' : `${(p.registered * 100).toFixed(0)}% of ${p.centreSteps}`,
          p.registered >= 0 && p.registered < 0.8,
        ))}
      </>)}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: HUD.head }}>live (AT REST ONLY — stale mid-burst)</div>
      {row('flipbook DRIVER', d.engaged ? 'ENGAGED (rAF)' : 'idle', !d.engaged)}
      {row('wheel events', String(d.events))}
      {row('legacy goTo (live)', String(d.legacy), d.legacy > 0)}
      {row('lands (live render)', String(d.lands), d.lands > 1)}
      {row('commanded distinct', String(d.commanded.size))}
      {row('show() calls', String(info.shows), info.shows === 0)}
      {row('presented/commanded', d.commanded.size ? `${(info.shows / d.commanded.size).toFixed(2)}×` : '—',
        d.commanded.size > 0 && info.shows < d.commanded.size)}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: HUD.head }}>per pane — hit/thumb/near/none</div>
      {info.panes.map((p) => (
        <div key={p.kind} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: p.visible ? HUD.ok : HUD.bad }}>
          <span style={{ opacity: 0.75 }}>{p.kind}{p.visible ? '' : ' ⚠NOT PAINTED'}</span>
          <span style={{ fontWeight: 700 }}>{p.hitCapture}/{p.hitThumb}/{p.nearest}/{p.none}</span>
        </div>
      ))}
      {info.panes.map((p) => (
        <div key={p.kind + 'v'} style={{ opacity: 0.6, fontSize: 10 }}>
          {p.kind}: disp={p.display} op={p.opacity} vis={p.visibility} z={p.zIndex} box={p.rectW}×{p.rectH} cv={p.canvasW}×{p.canvasH}
        </div>
      ))}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: HUD.head }}>sweep — versions baked</div>
      {(['doc', 'diff', 'map'] as const).map((k) => row(
        k, `${bake[k]}/${snapCount}`, snapCount > 0 && bake[k] < snapCount,
      ))}
      {row('bytes/version', bake.doc ? `${(st.bytes / Math.max(1, bake.doc) / 1024).toFixed(1)}KB` : '—')}
      <div style={{ fontWeight: 800, margin: '4px 0 2px', color: HUD.head }}>store</div>
      {row('snapThumbs flag', on ? 'ON' : 'OFF', !on)}
      {row('OPFS thumbs', st.loaded ? `${st.entries} · ${(st.bytes / 1e6).toFixed(1)}MB` : 'index loading…', st.entries === 0)}
      {/* SHOW THE CAP NEXT TO THE NUMBER. `62.9MB and climbing` read as a runaway and cost a
          whole investigation — it is DESKTOP_BUDGET exactly: 60 MiB is 62.9 decimal MB, and this
          row prints bytes/1e6. Filling to the cap and holding there is the eviction rule WORKING.
          Rendered as used/cap so "at the cap" is legible, and only flagged when genuinely OVER. */}
      {row('mem bitmaps', `${info.entries} · ${(info.bytes / 1e6).toFixed(1)}/${(info.budget / 1e6).toFixed(1)}MB`, info.bytes > info.budget)}
    </div>
  )
}

