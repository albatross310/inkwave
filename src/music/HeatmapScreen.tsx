// ─── The practice heatmap screen (§A2 — distinctive, build order step 5) ─────
//
// "A dedicated heatmap screen where the student (or teacher) selects ranges of bars and assigns
// custom colours… On iPad it's a natural Apple Pencil interaction (sweep across bars, pick a
// colour)."
//
// THE SWEEP IS THE INTERACTION. You pick a colour, then drag across bars — through them, the way you
// would with a highlighter over a printed part. Release paints the range. Everything else on this
// screen is in service of that one gesture.
//
// ⚠️ MANUAL ANNOTATION, NOT AN AI JUDGEMENT (§A2, emphatic — "nothing opaque to defend"). Nothing
// here computes, suggests or scores a colour. The CV's only contribution is where the bars ARE.

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  barsOfPiece, colourAt, erase, historyAt, paint, recordHeatmapProvenance, HEATMAP_PALETTE,
  type BarAddress,
} from './heatmap'
import { assetUrl } from './store'
import type { Author, Piece } from './types'
import { TOUCH_MIN, TYPE } from './typeScale'

export function HeatmapScreen({ piece, onChange }: {
  piece: Piece
  onChange: (next: Piece) => void
}) {
  const [colour, setColour] = useState(HEATMAP_PALETTE[0].colour)
  const [label, setLabel] = useState('')
  const [author, setAuthor] = useState<Author>('student')
  const [sweep, setSweep] = useState<{ from: number; to: number } | null>(null)
  const [inspect, setInspect] = useState<number | null>(null)

  const bars = useMemo(() => barsOfPiece(piece), [piece])

  const commit = useCallback((from: number, to: number) => {
    const next = paint(piece.heatmap, { bars: [from, to], colour, author, label: label.trim() || undefined })
    // Anchor the record as it changes (§A2: "stored in the .studio provenance record"). The HASH is
    // computed here; OTS stamping is a separate, on-demand action — CLAUDE.md's rule is that nothing
    // touches the calendar on a load or a per-interaction path.
    void recordHeatmapProvenance({ ...piece, heatmap: next }).then(onChange)
  }, [piece, colour, author, label, onChange])

  if (!bars.length) return <NoBars piece={piece} />

  return (
    <div className="mx-auto w-full max-w-3xl pb-32">
      <header className="mb-3">
        <h2 className="font-serif" style={{ fontSize: TYPE.heading, color: 'var(--iw-ink, #302438)' }}>
          What needs work
        </h2>
        <p className="font-serif" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)' }}>
          {/* The copy must not imply Inkwave has an opinion — §A2's "nothing opaque to defend"
              is a PRODUCT promise, so the screen says whose map this is. */}
          Pick a colour, then sweep across the bars. Your map, your call — Inkwave never marks it for you.
        </p>
      </header>

      {bars.map(bar => (
        <BarRow
          key={bar.bar_index}
          bar={bar}
          piece={piece}
          entry={colourAt(piece.heatmap, bar.bar_index)}
          inSweep={!!sweep && bar.bar_index >= Math.min(sweep.from, sweep.to) && bar.bar_index <= Math.max(sweep.from, sweep.to)}
          sweepColour={colour}
          onSweepStart={i => setSweep({ from: i, to: i })}
          onSweepOver={i => setSweep(s => (s ? { ...s, to: i } : s))}
          onSweepEnd={() => {
            if (sweep) commit(sweep.from, sweep.to)
            setSweep(null)
          }}
          onInspect={() => setInspect(i => (i === bar.bar_index ? null : bar.bar_index))}
          expanded={inspect === bar.bar_index}
          onErase={id => {
            const r = erase(piece.heatmap, id, author)
            if (!r.removed && r.refusedAuthor) {
              // §A9's shape: never silently drop. A student's stray erase must not delete what the
              // teacher marked in the lesson — and must SAY so rather than appearing to no-op.
              alert(`That mark is your ${r.refusedAuthor === 'teacher' ? 'teacher’s' : 'student’s'}. Switch to “${r.refusedAuthor}” to remove it.`)
              return
            }
            void recordHeatmapProvenance({ ...piece, heatmap: r.heatmap }).then(onChange)
          }}
        />
      ))}

      <Toolbar {...{ colour, setColour, label, setLabel, author, setAuthor }} />
    </div>
  )
}

// ─── One bar ─────────────────────────────────────────────────────────────────

function BarRow({
  bar, piece, entry, inSweep, sweepColour, onSweepStart, onSweepOver, onSweepEnd, onInspect,
  expanded, onErase,
}: {
  bar: BarAddress
  piece: Piece
  entry: ReturnType<typeof colourAt>
  inSweep: boolean
  sweepColour: string
  onSweepStart: (i: number) => void
  onSweepOver: (i: number) => void
  onSweepEnd: () => void
  onInspect: () => void
  expanded: boolean
  onErase: (id: string) => void
}) {
  const fill = inSweep ? sweepColour : entry?.colour
  return (
    <div
      // POINTER EVENTS, and `onPointerEnter` is what makes the sweep a sweep: the gesture starts on
      // one bar and continues over its neighbours, so the range is discovered from the bars the
      // pointer CROSSES, not from coordinates. `touch-action: none` is mandatory and must sit on
      // this element — it does NOT inherit (CLAUDE.md, iOS invariants) — or the page scrolls instead
      // of painting.
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onSweepStart(bar.bar_index) }}
      onPointerEnter={e => { if (e.buttons > 0) onSweepOver(bar.bar_index) }}
      onPointerUp={onSweepEnd}
      onPointerCancel={onSweepEnd}
      style={{ touchAction: 'none' }}
      className="mb-1"
    >
      <div
        className="iw-nightable flex items-center gap-2 rounded px-2"
        style={{
          minHeight: TOUCH_MIN,              // a Pencil sweep still needs a fingertip-sized row
          background: fill ? `${fill}55` : 'transparent',
          border: `1px solid ${fill ?? 'var(--iw-nightable-border, rgba(0,0,0,0.12))'}`,
        }}
      >
        <span className="font-serif tabular-nums" style={{ fontSize: TYPE.label, color: 'var(--iw-pill-fg, #78716c)', minWidth: 34 }}>
          {/* The PRINTED label if the student gave one, else the ordinal — and the ordinal is shown
              1-based because a human counts from one, while `bar_index` stays 0-based internally
              (types.ts, BarRef). Never render a stored key as if it were a printed number. */}
          {bar.bar_label ?? bar.bar_index + 1}
        </span>
        <BarThumb piece={piece} bar={bar} />
        {entry?.label && (
          <span className="font-serif" style={{ fontSize: TYPE.meta, color: 'var(--iw-ink, #302438)' }}>{entry.label}</span>
        )}
        {entry?.author === 'teacher' && (
          // §A2: the teacher's marks are a shared lesson artifact — attributed, visibly.
          <span
            className="rounded-full px-1.5 font-serif"
            style={{ fontSize: TYPE.meta, background: 'var(--iw-light, #41425b)', color: '#fff' }}
            title={`Marked by your teacher, ${new Date(entry.ts).toLocaleString()}`}
          >
            teacher
          </span>
        )}
        <button
          onClick={onInspect}
          onPointerDown={e => e.stopPropagation()}   // inspecting is not the start of a sweep
          aria-label={`History for bar ${bar.bar_index + 1}`}
          className="ml-auto font-serif"
          style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #78716c)' }}
        >
          {historyAt(piece.heatmap, bar.bar_index).length || ''} ⌄
        </button>
      </div>

      {expanded && (
        <ul className="iw-nightable ml-9 mt-1 rounded p-2" style={{ border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}>
          {/* §A2: "a timestamped record of how the student saw the piece over time" — so the older
              marks a recolour covered are SHOWN, not silently replaced. */}
          {historyAt(piece.heatmap, bar.bar_index).map(e => (
            <li key={e.id} className="flex items-center gap-2 py-0.5 font-serif" style={{ fontSize: TYPE.meta }}>
              <span className="h-3 w-3 rounded-full" style={{ background: e.colour }} />
              <span style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
                {e.author} · {new Date(e.ts).toLocaleDateString()} {e.label ? `· ${e.label}` : ''}
              </span>
              <button
                onClick={() => onErase(e.id)}
                className="ml-auto"
                style={{ color: 'var(--iw-pill-fg, #78716c)' }}
                aria-label="Remove this mark"
              >
                ×
              </button>
            </li>
          ))}
          {!historyAt(piece.heatmap, bar.bar_index).length && (
            <li className="font-serif" style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #78716c)' }}>Not marked yet.</li>
          )}
        </ul>
      )}
    </div>
  )
}

/** A crop of the bar's own music — so the map is of the SCORE, not of a list of numbers. */
function BarThumb({ piece, bar }: { piece: Piece; bar: BarAddress }) {
  const [url, setUrl] = useState<string | null>(null)
  const revoke = useRef<(() => void) | null>(null)
  const ref = piece.pages[bar.page]?.image_ref

  // Resolve lazily and revoke on unmount — an object URL pins its blob for the document's lifetime,
  // and this component can exist once per bar.
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el || url || !ref) return
    void assetUrl(piece.id, ref).then(r => {
      if (!r) return
      revoke.current = r.revoke
      setUrl(r.url)
    })
  }, [piece.id, ref, url])

  const aspect = (piece.pages[bar.page]?.source_width ?? 1) / (piece.pages[bar.page]?.source_height ?? 1)
  // The thumbnail scales WITH the type ramp (Peter: "every font proportionally up"). The words
  // getting bigger while the music stayed at 34px would have inverted the hierarchy of a screen
  // whose whole subject IS the music — and the reading distance here is a music stand, not a desk.
  const H = TYPE.title * 2
  const pageW = H / (bar.region.h / aspect)     // page width in px such that the bar's band is H tall

  return (
    <div ref={attach} className="overflow-hidden rounded" style={{ height: H, width: bar.region.w * pageW, maxWidth: 320, flexShrink: 0 }}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className="max-w-none"
          style={{
            width: pageW,
            marginLeft: -bar.region.x * pageW,
            marginTop: -bar.region.y * (pageW / aspect),
          }}
        />
      )}
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function Toolbar({ colour, setColour, label, setLabel, author, setAuthor }: {
  colour: string; setColour: (c: string) => void
  label: string; setLabel: (s: string) => void
  author: Author; setAuthor: (a: Author) => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center p-3">
      {/* iw-touch-guard is MANDATORY on a footer drop-up: without it a tap here blurs the editor on
          iOS, the keyboard retracts and the docked bar slides away mid-tap (CLAUDE.md 2026-07-12). */}
      <div
        className="iw-nightable iw-touch-guard flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 shadow-lg"
        style={{ background: 'var(--iw-paper, #fff)', border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
      >
        {HEATMAP_PALETTE.map(s => (
          <button
            key={s.colour}
            onClick={() => { setColour(s.colour); if (!label) setLabel(s.suggested) }}
            aria-label={s.suggested}
            aria-pressed={colour === s.colour}
            title={s.suggested}
            className="h-9 w-9 rounded-full"
            style={{ background: s.colour, outline: colour === s.colour ? '2px solid var(--iw-ink, #302438)' : 'none', outlineOffset: 2 }}
          />
        ))}
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="your word for it"
          aria-label="Label for this colour"
          className="iw-nightable rounded px-2 font-serif"
          // 16px FLOOR — iOS auto-zooms (and STAYS zoomed) on any control under 16px.
          style={{ fontSize: TYPE.body, height: 36, width: 150, border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
        />
        {/* §A2: the teacher recolours mid-lesson ON THE STUDENT'S iPAD. This is the hand-over — it
            is a deliberate, visible switch, because every mark it makes is attributed and
            timestamped, and a mode that could be entered by accident would forge attribution. */}
        <button
          onClick={() => setAuthor(author === 'student' ? 'teacher' : 'student')}
          aria-pressed={author === 'teacher'}
          className="h-9 rounded-full px-3 font-serif"
          style={{
            fontSize: TYPE.label,
            background: author === 'teacher' ? 'var(--iw-light, #41425b)' : 'transparent',
            color: author === 'teacher' ? '#fff' : 'var(--iw-ink, #302438)',
            border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))',
          }}
        >
          {author === 'teacher' ? 'teacher is marking' : 'I’m marking'}
        </button>
      </div>
    </div>
  )
}

// ─── No bars yet ─────────────────────────────────────────────────────────────

function NoBars({ piece }: { piece: Piece }) {
  const anyGrand = piece.pages.some(p => p.systems.some(s => s.is_grand_stave))
  return (
    <div className="mx-auto max-w-md py-10 text-center font-serif" style={{ color: 'var(--iw-pill-fg, #78716c)' }}>
      <p style={{ fontSize: TYPE.body, color: 'var(--iw-ink, #302438)' }}>No bars to colour yet</p>
      {/* HONEST, and specific about WHY — "no bars" on a page full of bars would read as a bug.
          Inkwave finds barlines only where it can be certain (a grand stave's barlines cross between
          the staves; on a single stave a note stem looks the same). Tapping is §A4's own MVP. */}
      <p className="mt-1" style={{ fontSize: TYPE.label }}>
        {piece.pages.length === 0
          ? 'Add a page of your score first.'
          : anyGrand
            ? 'Inkwave couldn’t make out the barlines on this photo. You can tap them in yourself.'
            : 'Inkwave only picks out barlines it’s sure of — on a single stave a note’s stem looks just like one. Tap your barlines in and the map is yours.'}
      </p>
    </div>
  )
}
