// ─── One reflowed, markable score page (§A1 + §A2) ───────────────────────────
//
// The page is rendered as a stack of BANDS: slices of the source image, with blank writing space
// inserted between the systems (`reflow.ts` buildLayout). The image is never rewritten — each slice
// is the same <img> shifted under its own window, so adjusting a gap re-lays-out instantly and
// nothing is re-encoded.
//
// COORDINATES: annotations are stored in SOURCE space (or gap space) and converted to LAYOUT space
// for painting on every render. That is what makes a handle-drag move the music without moving any
// mark off it — see types.ts, RegionAnchor.
//
// PENCIL-FIRST (the platform brief): drawing is driven by PointerEvents. A `pen` pointer always
// draws, with pressure. Touch draws only on devices where no pen has ever been seen — otherwise a
// resting palm would scribble, and on an iPad the finger's job is to scroll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { buildLayout, gapAt, type Layout } from './reflow'
import { routeLeader, type Obstacle } from './leader'
import { isoWithOffset, type Annotation, type AnnotationContent, type Piece, type PiecePage } from './types'
import { TOUCH_MIN, TYPE } from './typeScale'

export type Tool = 'pan' | 'freehand' | 'highlight' | 'text' | 'sticky' | 'symbol' | 'leader' | 'erase'

export interface ScorePageProps {
  piece: Piece
  page: PiecePage
  pageIndex: number
  imageUrl: string | null
  tool: Tool
  colour: string
  symbol: string
  onChange: (annotations: Annotation[]) => void
  onReflow: (reflow: NonNullable<PiecePage['reflow']>) => void
}

// The gap handle's grab height, in px. 44 is Apple's minimum touch target and this is dragged with a
// finger as often as a Pencil.
const HANDLE_H = 44

export function ScorePage({
  piece, page, pageIndex, imageUrl, tool, colour, symbol, onChange, onReflow,
}: ScorePageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<{ points: number[]; pressure: number[] } | null>(null)
  const penSeen = useRef(false)
  const drawing = useRef<{ id: number } | null>(null)

  // ─── Layout ────────────────────────────────────────────────────────────────

  const reflow = page.reflow ?? { enabled: false, default_gap: 0.06, gaps: {} }
  const cuts = useMemo(() => {
    // A cut sits at the midpoint of the whitespace between consecutive systems — the same rule the
    // detector used, recomputed from the stored regions so a manual system edit is honoured.
    const out: number[] = []
    for (let i = 1; i < page.systems.length; i++) {
      const prev = page.systems[i - 1], cur = page.systems[i]
      out.push((prev.region.y + prev.region.h + cur.region.y) / 2)
    }
    return out
  }, [page.systems])

  const layout: Layout = useMemo(
    () => buildLayout(reflow.enabled ? cuts : [], i => reflow.gaps[i] ?? reflow.default_gap),
    [cuts, reflow.enabled, reflow.default_gap, reflow.gaps],
  )

  const aspect = (page.source_width ?? 1) / (page.source_height ?? 1)
  const pageH = width / aspect            // px height of ONE source page height
  const totalH = pageH * layout.height

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // ─── Coordinate helpers ────────────────────────────────────────────────────

  /** Client point → LAYOUT space (x normalised to width; y normalised to source page height). */
  const toLayout = useCallback((e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / pageH }
  }, [pageH])

  /** Layout point → the anchor we STORE: source space, or gap space if it landed in inserted room. */
  const toAnchor = useCallback((p: { x: number; y: number }) => {
    const g = gapAt(layout, p.y)
    if (g) {
      // In a gap: pin it to the system it follows, proportionally down the gap. Resizing the gap then
      // moves it with the gap instead of stranding it on the music below.
      const cut = cuts[g.afterSystem] ?? 0
      return {
        region: { x: p.x, y: cut, w: 0, h: 0 },
        gap: { after_system: g.afterSystem, t: g.t },
      }
    }
    // On the music: convert back through the layout so the mark is stored where the INK is.
    let srcY = p.y
    for (const b of layout.bands) {
      if (b.kind === 'slice' && p.y >= b.outY0 && p.y <= b.outY1) { srcY = b.srcY0 + (p.y - b.outY0); break }
    }
    return { region: { x: p.x, y: srcY, w: 0, h: 0 }, gap: undefined }
  }, [layout, cuts])

  /** A stored anchor → LAYOUT space, for painting. The inverse of `toAnchor`. */
  const anchorToLayout = useCallback((a: Annotation): { x: number; y: number } | null => {
    if (a.anchor.kind !== 'region') return null
    if (a.anchor.page !== pageIndex) return null
    const { region, gap } = a.anchor
    if (gap) {
      for (const b of layout.bands) {
        if (b.kind === 'gap' && b.afterSystem === gap.after_system) {
          return { x: region.x, y: b.outY0 + gap.t * (b.outY1 - b.outY0) }
        }
      }
      return null   // its gap is closed (reflow off) — the mark is hidden, not misplaced
    }
    for (const b of layout.bands) {
      if (b.kind === 'slice' && region.y >= b.srcY0 && region.y <= b.srcY1) {
        return { x: region.x, y: b.outY0 + (region.y - b.srcY0) }
      }
    }
    return null
  }, [layout, pageIndex])

  // ─── Drawing ───────────────────────────────────────────────────────────────

  const commit = useCallback((content: AnnotationContent, at: { x: number; y: number }) => {
    const { region, gap } = toAnchor(at)
    const system = page.systems.findIndex(s => region.y >= s.region.y && region.y <= s.region.y + s.region.h)
    const ann: Annotation = {
      id: uuidv4(),
      kind: content.kind,
      content,
      anchor: {
        kind: 'region',
        page: pageIndex,
        region,
        ...(system >= 0 ? { system } : {}),
        ...(gap ? { gap } : {}),
      },
      author: 'student',
      created_at: isoWithOffset(),
    }
    onChange([...piece.annotations, ann])
  }, [toAnchor, onChange, piece.annotations, pageIndex, page.systems])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = true
    // Finger = scroll, always, once a Pencil has been used on this device. Otherwise a palm draws.
    if (e.pointerType === 'touch' && penSeen.current) return
    if (tool === 'pan') return

    const p = toLayout(e)
    if (tool === 'freehand' || tool === 'highlight') {
      e.currentTarget.setPointerCapture(e.pointerId)
      drawing.current = { id: e.pointerId }
      setDraft({ points: [p.x, p.y], pressure: [e.pressure || 0.5] })
      return
    }
    if (tool === 'sticky') {
      commit({ kind: 'sticky', text: '', colour, at: undefined }, p)
      return
    }
    if (tool === 'symbol') {
      commit({ kind: 'symbol', symbol, size: 0.03, colour }, p)
      return
    }
    if (tool === 'text') {
      commit({ kind: 'text', text: '', colour }, p)
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return
    const p = toLayout(e)
    setDraft(d => (d ? {
      points: [...d.points, p.x, p.y],
      // Apple Pencil reports real pressure; a mouse reports 0.5 while down, and 0 on some engines —
      // a zero-width stroke reads as "the app ignored me", so floor it.
      pressure: [...d.pressure, e.pressure || 0.5],
    } : d))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return
    drawing.current = null
    const d = draft
    setDraft(null)
    if (!d || d.points.length < 4) return

    // Convert the whole stroke to SOURCE space, point by point. A stroke drawn across a gap boundary
    // is stored against the music it started on; strokes are not split at bands (a hand-drawn mark
    // that crosses into the writing space is one mark, and splitting it would be a lie about what
    // the student drew).
    const src: number[] = []
    for (let i = 0; i < d.points.length; i += 2) {
      const a = toAnchor({ x: d.points[i], y: d.points[i + 1] })
      src.push(a.region.x, a.region.y)
    }
    const start = toAnchor({ x: d.points[0], y: d.points[1] })
    commit(
      tool === 'highlight'
        ? { kind: 'freehand', points: src, pressure: d.pressure, colour, width: 0.02 }
        : { kind: 'freehand', points: src, pressure: d.pressure, colour, width: 0.004 },
      { x: d.points[0], y: d.points[1] },
    )
    void start
  }

  // ─── Painting ──────────────────────────────────────────────────────────────

  const obstacles: Obstacle[] = useMemo(
    () => page.systems.map(s => {
      const y0 = anchorToLayoutY(layout, s.region.y)
      const y1 = anchorToLayoutY(layout, s.region.y + s.region.h)
      return { y0, y1 }
    }),
    [page.systems, layout],
  )

  const strokePath = (pts: number[], mapY: (y: number) => number) => {
    let d = ''
    for (let i = 0; i < pts.length; i += 2) {
      d += `${i === 0 ? 'M' : 'L'} ${pts[i].toFixed(4)} ${mapY(pts[i + 1]).toFixed(4)} `
    }
    return d
  }

  const mine = piece.annotations.filter(a => a.anchor.kind === 'region' && a.anchor.page === pageIndex)

  return (
    <div
      ref={hostRef}
      className="relative w-full select-none"
      style={{
        height: totalH || undefined,
        // The canvas owns its gestures: without this the browser pans/zooms instead of drawing, and
        // touch-action does NOT inherit (CLAUDE.md, iOS invariants) — it must sit on this element.
        touchAction: tool === 'pan' ? 'pan-x pan-y' : 'none',
        background: 'var(--iw-paper, #fcfaf6)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* ── The image, in slices ── */}
      {layout.bands.map((b, i) =>
        b.kind === 'slice' ? (
          <div
            key={i}
            className="absolute left-0 w-full overflow-hidden"
            style={{ top: b.outY0 * pageH, height: (b.srcY1 - b.srcY0) * pageH }}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                className="absolute left-0 w-full max-w-none"
                style={{ top: -b.srcY0 * pageH, height: pageH }}
              />
            )}
          </div>
        ) : (
          <GapBand
            key={i}
            top={b.outY0 * pageH}
            height={(b.outY1 - b.outY0) * pageH}
            index={b.afterSystem!}
            confidence={page.systems[b.afterSystem!]?.confidence ?? 1}
            onResize={dy => {
              const cur = reflow.gaps[b.afterSystem!] ?? reflow.default_gap
              onReflow({ ...reflow, gaps: { ...reflow.gaps, [b.afterSystem!]: Math.max(0, cur + dy / pageH) } })
            }}
          />
        ),
      )}

      {/* ── Annotations ── */}
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 1 ${layout.height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: totalH }}
      >
        {/* Strokes are painted in a NON-scaling space: viewBox y is in source-page units while x is
            0..1, so a uniform stroke-width would render as an ellipse. vectorEffect keeps the pen
            width honest regardless. */}
        {mine.map(a => {
          if (a.content.kind === 'freehand') {
            const c = a.content
            return (
              <path
                key={a.id}
                d={strokePath(c.points, y => sourceYToLayout(layout, y))}
                fill="none"
                stroke={c.colour}
                strokeWidth={Math.max(1.2, c.width * 600)}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                opacity={c.width > 0.01 ? 0.35 : 1}
              />
            )
          }
          if (a.content.kind === 'leader') {
            const c = a.content
            const from = { x: c.from.region.x, y: sourceYToLayout(layout, c.from.region.y) }
            const to = { x: c.to.region.x, y: sourceYToLayout(layout, c.to.region.y) }
            const r = routeLeader({ from, to, obstacles, aspect, side: c.side })
            return (
              <path key={a.id} d={r.path} fill="none" stroke={c.colour} strokeWidth={1.5}
                vectorEffect="non-scaling-stroke" />
            )
          }
          return null
        })}
        {draft && (
          <path
            d={strokePath(draft.points, y => y)}
            fill="none"
            stroke={colour}
            strokeWidth={tool === 'highlight' ? 12 : 2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={tool === 'highlight' ? 0.35 : 1}
          />
        )}
      </svg>

      {/* ── Sticky notes / symbols / text — HTML, so they are editable and accessible ── */}
      {mine.map(a => {
        const p = anchorToLayout(a)
        if (!p) return null
        if (a.content.kind === 'sticky') {
          return (
            <StickyNote
              key={a.id}
              x={p.x} y={p.y * pageH}
              colour={a.content.colour}
              text={a.content.text}
              author={a.author}
              onText={t => onChange(piece.annotations.map(x =>
                x.id === a.id && x.content.kind === 'sticky'
                  ? { ...x, content: { ...x.content, text: t } } : x))}
              onDelete={() => onChange(piece.annotations.filter(x => x.id !== a.id))}
            />
          )
        }
        if (a.content.kind === 'symbol') {
          return (
            <span
              key={a.id}
              className="absolute font-serif"
              style={{
                left: `${a.content ? p.x * 100 : 0}%`, top: p.y * pageH,
                transform: 'translate(-50%,-50%)', color: a.content.colour,
                fontSize: Math.max(TYPE.meta, a.content.size * (width || 600)), fontStyle: 'italic', fontWeight: 700,
              }}
            >
              {SYMBOL_GLYPHS[a.content.symbol] ?? a.content.symbol}
            </span>
          )
        }
        return null
      })}
    </div>
  )
}

// ─── The gap and its handle (§A1 "manual adjust handles") ────────────────────

function GapBand({ top, height, index, confidence, onResize }: {
  top: number; height: number; index: number; confidence: number; onResize: (dy: number) => void
}) {
  const last = useRef(0)
  const dragging = useRef(false)

  return (
    <div
      className="absolute left-0 w-full"
      style={{
        top, height,
        // ⚠️ DELIBERATELY **NOT** `iw-nightable` — and this is the one panel in the module where the
        // theming rule is wrong. FOUND BY EYEBALLING IT (Peter's night-mode pass): with the class on,
        // the gap took the dolphin-grey chrome surface and rendered as a DARK BAND slicing through a
        // white photograph of a page. It looked like a rendering fault.
        //
        // The gap is not chrome. It is PAPER — it is the space the student writes on, inserted into
        // their own photograph, and the photograph does not have a night mode (we cannot invert a
        // picture of a page and still call it their score). So the gap matches the paper beside it,
        // in both themes, because that is what it IS. The theme token exists for the day we support
        // scanned-on-black or inverted scores; until then it resolves to paper in both.
        background: 'var(--iw-score-gap, #fdfdfb)',
        boxShadow: 'inset 0 0 0 9999px transparent',
      }}
    >
      {/* Faint rules — it should read as room to write, not as an empty error. Painted as a child so
          they sit ON the paper rather than being composited with a themed surface behind them. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(to bottom, transparent, transparent 11px, var(--iw-gap-rule, rgba(92,45,138,0.10)) 11px, var(--iw-gap-rule, rgba(92,45,138,0.10)) 12px)',
        }}
      />
      {/* A boundary the detector was unsure about is SHOWN as unsure rather than applied silently —
          §A1's manual handles exist for exactly these, and a quiet wrong cut is worse than a marked one. */}
      {confidence < 0.5 && (
        <span
          className="absolute left-1 top-0 font-serif"
          style={{ fontSize: TYPE.meta, color: 'var(--iw-pill-fg, #78716c)' }}
          title="Inkwave wasn’t sure this is a break between systems — drag to adjust."
        >
          ?
        </span>
      )}
      <div
        role="separator"
        aria-label={`Writing space after system ${index + 1} — drag to resize`}
        className="absolute left-0 w-full cursor-ns-resize"
        style={{ bottom: -HANDLE_H / 2, height: HANDLE_H, touchAction: 'none' }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          last.current = e.clientY
        }}
        onPointerMove={e => {
          if (!dragging.current) return
          onResize(e.clientY - last.current)
          last.current = e.clientY
        }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
      >
        <div
          className="absolute left-1/2 h-[3px] w-10 -translate-x-1/2 rounded-full"
          style={{ top: HANDLE_H / 2 - 1.5, background: 'var(--iw-light, #9b5ccc)', opacity: 0.5 }}
        />
      </div>
    </div>
  )
}

// ─── Sticky note (§A2) ───────────────────────────────────────────────────────

function StickyNote({ x, y, colour, text, author, onText, onDelete }: {
  x: number; y: number; colour: string; text: string; author: 'student' | 'teacher'
  onText: (t: string) => void; onDelete: () => void
}) {
  return (
    <div
      className="absolute iw-nightable iw-touch-guard rounded-md p-1 shadow-sm"
      style={{
        left: `${x * 100}%`, top: y, width: 190, transform: 'translate(-6px,-6px)',
        background: colour, border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))',
      }}
    >
      <textarea
        value={text}
        onChange={e => onText(e.target.value)}
        placeholder={author === 'teacher' ? 'Teacher’s note…' : 'Note…'}
        className="w-full resize-none bg-transparent font-serif outline-none"
        // 16px FLOOR: iOS auto-zooms (and stays zoomed) on any control under 16px. CLAUDE.md's iOS
        // invariants — this is a real bug, not a preference.
        style={{ fontSize: TYPE.body, minHeight: TOUCH_MIN, color: 'var(--iw-ink, #5c2d8a)' }}
        rows={2}
      />
      <button
        onClick={onDelete}
        aria-label="Delete note"
        className="absolute -right-2 -top-2 h-6 w-6 rounded-full leading-none"
        style={{ fontSize: TYPE.meta, background: 'var(--iw-paper, #fcfaf6)', color: 'var(--iw-pill-fg, #78716c)', border: '1px solid var(--iw-nightable-border, rgba(0,0,0,0.12))' }}
      >
        ×
      </button>
    </div>
  )
}

// ─── The small musical-symbol palette (§A2) ──────────────────────────────────
//
// Palette IDS, not bare glyphs (types.ts, SymbolContent): the palette has to be able to name, search
// and re-style its own marks, and a raw codepoint carries no meaning. These render as text today;
// they are the marks a student actually adds to a score they are practising.

export const SYMBOL_GLYPHS: Record<string, string> = {
  pianissimo: 'pp', piano: 'p', mezzopiano: 'mp', mezzoforte: 'mf', forte: 'f', fortissimo: 'ff',
  crescendo: '<', diminuendo: '>',
  fermata: '𝄐', accent: '>', staccato: '.', tenuto: '–',
  breath: ',', upbow: '⋁', downbow: '⊓', pedal: '𝄢', trill: 'tr',
}

export const SYMBOL_ORDER = Object.keys(SYMBOL_GLYPHS)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sourceYToLayout(layout: Layout, srcY: number): number {
  for (const b of layout.bands) {
    if (b.kind === 'slice' && srcY >= b.srcY0 && srcY <= b.srcY1) return b.outY0 + (srcY - b.srcY0)
  }
  const last = layout.bands[layout.bands.length - 1]
  return last ? last.outY1 : srcY
}

function anchorToLayoutY(layout: Layout, srcY: number): number {
  return sourceYToLayout(layout, srcY)
}
