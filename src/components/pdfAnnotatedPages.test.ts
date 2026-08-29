// THE MARKS HAVE TO COME OUT THE WAY THEY WENT IN.
//
// Print and Export share one painter, so a fault here is a fault in both. What is worth pinning is
// not "it draws something" but the handful of rules that were REASONED about and could silently
// regress: the single-fill union that stops a multi-line highlight double-darkening, the page
// filter, the note-above-rect order, and the refusal (rather than a silent downgrade) when a
// document is too large to render at readable resolution.

import { describe, it, expect } from 'vitest'
import {
  planAnnotatedRender, wrapNoteText, paintAnnotations, buildPrintHtml, marksWithoutGeometry,
  PRINT_SCALE, MIN_PRINT_SCALE, JPEG_BYTES_PER_PX,
  type PaintCtx,
} from './pdfAnnotatedPages'
import type { PdfHighlight } from '../citations/pdfHighlights'

// ── A recording 2D context ───────────────────────────────────────────────────────────────────────
type Style = CanvasFillStrokeStyles['fillStyle']
type Op = { op: string; args: unknown[]; state: { fillStyle: Style; globalAlpha: number; gco: string; font: string } }

function recorder(charWidth = 10) {
  const ops: Op[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '', textBaseline: 'alphabetic',
    measureText: (t: string) => ({ width: t.length * charWidth }),
  } as unknown as PaintCtx & { _ops: Op[] }
  const rec = (op: string) => (...args: unknown[]) => {
    ops.push({ op, args, state: { fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha, gco: ctx.globalCompositeOperation, font: ctx.font } })
  }
  for (const name of ['save', 'restore', 'beginPath', 'closePath', 'rect', 'moveTo', 'lineTo', 'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'fillText'] as const) {
    ;(ctx as unknown as Record<string, unknown>)[name] = rec(name)
  }
  ctx._ops = ops
  return { ctx, ops }
}

const mk = (h: Partial<PdfHighlight>): PdfHighlight => ({
  id: h.id ?? 'x', page: h.page ?? 1, rects: h.rects ?? [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }],
  color: h.color ?? '#ffe066', text: h.text ?? '', createdAt: '2026-08-29T00:00:00Z', ...h,
})

const GEOM = { width: 1224, height: 1584, scale: 2 }

// ── planAnnotatedRender ──────────────────────────────────────────────────────────────────────────

describe('planAnnotatedRender', () => {
  it('an ordinary source renders at full print resolution', () => {
    const plan = planAnnotatedRender(30, 612, 792)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.scale).toBe(PRINT_SCALE)
    expect(plan.degraded).toBe(false)
  })

  it('a long source drops resolution to fit the budget, and says so', () => {
    // Sized so 2× overruns but the floor is comfortably reachable.
    const budget = 30 * 612 * 792 * PRINT_SCALE * PRINT_SCALE * JPEG_BYTES_PER_PX
    const plan = planAnnotatedRender(90, 612, 792, budget)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.scale).toBeLessThan(PRINT_SCALE)
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_PRINT_SCALE)
    expect(plan.degraded).toBe(true)
    expect(plan.estBytes).toBeLessThanOrEqual(budget * 1.0001)
  })

  it('REFUSES rather than silently truncating or going unreadable', () => {
    // The failure this replaces is the tempting one: clamp to the floor and export anyway, or
    // export the first N pages. Both look like success. A mutant that clamps returns ok:true here.
    const plan = planAnnotatedRender(4000, 612, 792)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('4000 pages')
  })

  it('a document with no pages is refused, not divided by zero', () => {
    expect(planAnnotatedRender(0, 612, 792).ok).toBe(false)
  })
})

// ── wrapNoteText ─────────────────────────────────────────────────────────────────────────────────

describe('wrapNoteText', () => {
  const measure = (s: string) => s.length * 10

  it('wraps at the box width', () => {
    const lines = wrapNoteText('aaa bbb ccc ddd', 70, measure)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(70)
  })

  it('KNOWN-NEGATIVE: a no-op wrapper would fail the line above', () => {
    // Guards against the assertion being satisfiable by returning the input unchanged.
    expect(measure('aaa bbb ccc ddd')).toBeGreaterThan(70)
  })

  it('keeps explicit newlines (the note is pre-wrap on screen)', () => {
    expect(wrapNoteText('one\ntwo', 1000, measure)).toEqual(['one', 'two'])
    expect(wrapNoteText('a\n\nb', 1000, measure)).toEqual(['a', '', 'b'])
  })

  it('breaks a word that cannot fit on a line of its own', () => {
    // break-word on screen; without this the glyphs render outside the note's box.
    const lines = wrapNoteText('supercalifragilistic', 50, measure)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(50)
    expect(lines.join('')).toBe('supercalifragilistic') // nothing dropped
  })

  it('empty text yields one empty line, not a crash', () => {
    expect(wrapNoteText('', 100, measure)).toEqual([''])
  })
})

// ── paintAnnotations ─────────────────────────────────────────────────────────────────────────────

describe('paintAnnotations', () => {
  it('a multi-line highlight is ONE fill of ONE path — not one fill per line', () => {
    // The double-darkening rule. On screen an opacity-isolation group buys this; on canvas it is
    // the single path. A mutant that fills per rect gives 3 fills and a visibly darker middle.
    const hl = mk({ kind: 'highlight', rects: [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.02 },
      { x: 0.1, y: 0.119, w: 0.8, h: 0.02 },
      { x: 0.1, y: 0.138, w: 0.4, h: 0.02 },
    ] })
    const { ctx, ops } = recorder()
    paintAnnotations(ctx, [hl], 1, GEOM)
    expect(ops.filter(o => o.op === 'rect')).toHaveLength(3)
    const fills = ops.filter(o => o.op === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].state.globalAlpha).toBeCloseTo(0.4, 5)
    expect(fills[0].state.gco).toBe('multiply')
    expect(fills[0].state.fillStyle).toBe('#ffe066')
  })

  it('paints only this page, and the alpha/composite are restored afterwards', () => {
    const marks = [mk({ id: 'a', page: 1 }), mk({ id: 'b', page: 2 }), mk({ id: 'c', page: 3 })]
    const { ctx, ops } = recorder()
    paintAnnotations(ctx, marks, 2, GEOM)
    expect(ops.filter(o => o.op === 'fill')).toHaveLength(1)
    expect(ops.filter(o => o.op === 'save')).toHaveLength(1)
    expect(ops.filter(o => o.op === 'restore')).toHaveLength(1)
  })

  it('underline sits at the bottom of the run and strike through its middle', () => {
    const rects = [{ x: 0.1, y: 0.5, w: 0.5, h: 0.02 }]
    const u = recorder(); paintAnnotations(u.ctx, [mk({ kind: 'underline', rects })], 1, GEOM)
    const s = recorder(); paintAnnotations(s.ctx, [mk({ kind: 'strike', rects })], 1, GEOM)
    const uy = u.ops.find(o => o.op === 'fillRect')!.args[1] as number
    const sy = s.ops.find(o => o.op === 'fillRect')!.args[1] as number
    const top = 0.5 * GEOM.height, h = 0.02 * GEOM.height
    expect(sy).toBeLessThan(uy)
    expect(sy).toBeGreaterThan(top)
    expect(uy + 2 * GEOM.scale).toBeCloseTo(top + h, 5)
  })

  it('a sticky note draws its sheet and one fillText per wrapped line', () => {
    const note = mk({ kind: 'text', color: '#ffe066', note: 'aaa bbb ccc ddd eee fff', size: 12,
      rects: [{ x: 0.1, y: 0.2, w: 0.2, h: 0 }] })
    const { ctx, ops } = recorder(10)
    paintAnnotations(ctx, [note], 1, GEOM)
    const texts = ops.filter(o => o.op === 'fillText')
    expect(texts.length).toBeGreaterThan(1)                       // 0.2 × 1224px box cannot hold it
    expect(ops.filter(o => o.op === 'fill')).toHaveLength(1)      // the sheet
    expect(ops.filter(o => o.op === 'stroke')).toHaveLength(1)    // its border
    expect(texts[0].state.font).toContain(`${12 * GEOM.scale}px`) // stored px are page-scale-1 px
    // Lines run down the box, in order.
    const ys = texts.map(t => t.args[2] as number)
    expect(ys.every((y, i) => i === 0 || y > ys[i - 1])).toBe(true)
  })

  it('an EMPTY note still prints its box — placing one is a mark', () => {
    const { ctx, ops } = recorder()
    paintAnnotations(ctx, [mk({ kind: 'text', note: '', text: '' })], 1, GEOM)
    expect(ops.filter(o => o.op === 'fill')).toHaveLength(1)
    expect(ops.filter(o => o.op === 'fillText')).toHaveLength(0)
  })

  it('notes are painted after rects, so a note over a highlight stays readable', () => {
    const marks = [
      mk({ id: 'n', kind: 'text', note: 'hi' }),          // deliberately FIRST in the array
      mk({ id: 'h', kind: 'highlight' }),
    ]
    const { ctx, ops } = recorder()
    paintAnnotations(ctx, marks, 1, GEOM)
    const firstRect = ops.findIndex(o => o.op === 'rect')       // only the highlight uses rect()
    const firstText = ops.findIndex(o => o.op === 'fillText')
    expect(firstRect).toBeGreaterThanOrEqual(0)
    expect(firstText).toBeGreaterThan(firstRect)
  })

  it('nothing is painted for a page with no marks', () => {
    const { ctx, ops } = recorder()
    paintAnnotations(ctx, [], 1, GEOM)
    expect(ops).toHaveLength(0)
  })
})

// ── marksWithoutGeometry ─────────────────────────────────────────────────────────────────────────

describe('marksWithoutGeometry', () => {
  it('finds the marks that have no rectangle to paint', () => {
    const orphan = mk({ id: 'orphan', rects: [] })
    const found = marksWithoutGeometry([mk({ id: 'ok' }), orphan])
    expect(found.map(m => m.id)).toEqual(['orphan'])
  })

  it('a reader-made mark is NOT an orphan — it carries page rects too', () => {
    // The assumption worth pinning, because it is the one a reader of PdfReaderView's header makes
    // and it is wrong: marks made in the reader view are anchored by TEXT, but createFromSelection
    // also stores rects from rectsForRange "so the two views agree by construction". Only an EMPTY
    // rects array puts a mark beyond this exporter.
    const readerMade = mk({ id: 'r', anchor: { block: 2, start: 10, text: 'the categorical' },
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] } as never)
    expect(marksWithoutGeometry([readerMade])).toHaveLength(0)
  })

  it('KNOWN-NEGATIVE: it is not simply returning everything, or nothing', () => {
    expect(marksWithoutGeometry([mk({}), mk({})])).toHaveLength(0)
    expect(marksWithoutGeometry([mk({ rects: [] }), mk({ rects: [] })])).toHaveLength(2)
    expect(marksWithoutGeometry([])).toHaveLength(0)
  })

  it('a mark that reached storage with no rects at all is caught, not thrown on', () => {
    expect(marksWithoutGeometry([{ ...mk({}), rects: undefined } as never])).toHaveLength(1)
  })
})

// ── buildPrintHtml ───────────────────────────────────────────────────────────────────────────────

describe('buildPrintHtml', () => {
  const pages = [
    { url: 'blob:one', widthPt: 612, heightPt: 792 },
    { url: 'blob:two', widthPt: 612, heightPt: 792 },
  ]

  it('one sheet per page, at the source page size, with no browser margins', () => {
    const html = buildPrintHtml(pages, 'Kant')
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(html).toContain('@page { size: 612pt 792pt; margin: 0 }')
    expect(html).toContain('page-break-after: always')
    expect(html).toContain('src="blob:one"')
  })

  it('escapes the title — a source name is not markup', () => {
    expect(buildPrintHtml(pages, 'a <script>b</script> & "c"'))
      .toContain('<title>a &lt;script&gt;b&lt;/script&gt; &amp; &quot;c&quot;</title>')
  })
})
