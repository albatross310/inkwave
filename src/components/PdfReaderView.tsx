// THE PDF READER VIEW — the same source, re-set in the reader's own type instead of the
// publisher's.
//
// Peter asked, first: "do we have a way of altering the line spacing on the pdf to make it wider?
// Or to change the font" — and a fixed PDF layout structurally cannot answer that, because every
// glyph sits at a coordinate somebody else chose. Then: "yep build the reader view for pdfs. make
// sure highlights and text boxes translate between it… don't worry about the existing highlights.
// just change the whole layout and method for future ones… yes anchor text boxes at nearest text."
//
// So this is a MODE ALONGSIDE the page view, never a replacement: PdfViewer still renders pages
// exactly as it did, and this component is what it shows instead when the reader asks for it.
//
// THREE RULES, and they are the whole design:
//   1. A mark made here is identified by the TEXT IT COVERS (src/reader/marks.ts — the model, not a
//      copy of it), so it survives a font change, a line-spacing change and the page view's own
//      geometry. It ALSO carries page rects (pdfReflow.rectsForRange), so it appears in the page
//      view — one mapping read in two directions.
//   2. A text box anchors to the NEAREST PARAGRAPH, not to a point on a page that is no longer
//      being drawn.
//   3. A mark this view cannot place is NEVER dropped and never guessed at. It is counted, listed
//      and left alone; the page view still shows it. Peter accepted that pre-existing rect-only
//      marks go stale — stale is not deleted.

import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { locateAll, markRuns, type Located, type ReaderMark } from '../reader/marks'
import type { HighlightKind, PdfHighlight } from '../citations/pdfHighlights'
import { noteAnchorText, rectsForRange } from './pdfReflow'
import type { PageReflow } from './pdfReflow'
import { getPageReflow } from './pdfReflowStore'
import { isTouchDevice } from '../editor/Scroll'
import { FONTS } from './StyleBar'

// This whole view is reader PAPER (it is a reading column, not chrome), so every colour in it comes
// from the reader token family — the same one the source reader uses, because two reading columns
// themed by two rules is how they drift. See index.css's reader block for the night palette.
const INKP = 'var(--iw-reader-accent, #5c2d8a)'
const CTL = 'var(--iw-reader-ctl, #fff)'
const EDGE = 'var(--iw-reader-edge, #d6cfe0)'
const HAIR = 'var(--iw-reader-hair, rgba(92,45,138,0.13))'
const MUTED = 'var(--iw-reader-muted, #6b645f)'
// Ink laid ON a mark's own fill. A highlight or note card is an opaque PALE patch in both themes,
// so its text is dark in both — day is byte-unchanged, night stops it turning to pale-on-pale.
const ON_MARK = 'var(--iw-reader-on-mark, #2c2a28)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any> }
type ToolKind = HighlightKind | 'erase'

export const READER_FONT_KEY = 'inkwave:pdfReaderFont'
export const READER_SIZE_KEY = 'inkwave:pdfReaderSize'
export const READER_LEAD_KEY = 'inkwave:pdfReaderLeading'

/** ⚠ `wash()` IS GONE, AND ITS PREMISE WITH IT. It faded a highlight to 55% alpha because "a solid
 *  fill over body text is unreadable" — true only while nothing set the ink ON the fill, which the
 *  source reader has always done (it paints the mark at full strength and reads perfectly). Over a
 *  NIGHT reading column the wash is worse than merely dim: rgba(255,224,102,.55) over #26241f
 *  composites to #9d8b46, a muddy olive that no longer looks yellow at all.
 *  So the strength is a token (`--iw-reader-wash`, 55% by day and opaque at night) applied in CSS
 *  via `.iw-mark-fill`, and the ink on top is `--iw-reader-on-mark`. The mark's own colour is handed
 *  in as `--iw-mark` and is never reinterpreted by either theme. Day renders byte-identically. */
const markFill = (hex: string) => ({ ['--iw-mark' as string]: hex })

type PageState = { n: number; reflow: PageReflow | null }
type Mk = ReaderMark & { hl: PdfHighlight }
type Pl = Located & { hl: PdfHighlight }

/** A PdfHighlight expressed in the reader-mark model — only the ones that carry a text anchor. */
function toReaderMarks(hls: PdfHighlight[]): { anchored: Mk[]; unanchored: PdfHighlight[] } {
  const anchored: Mk[] = []
  const unanchored: PdfHighlight[] = []
  for (const h of hls) {
    if (!h.anchor || !h.anchor.text) { unanchored.push(h); continue }
    anchored.push({
      id: h.id, kind: (h.kind ?? 'highlight') === 'text' ? 'note' : 'highlight', color: h.color,
      block: h.anchor.block, start: h.anchor.start, text: h.anchor.text,
      body: h.note, createdAt: h.createdAt, hl: h,
    })
  }
  return { anchored, unanchored }
}

export function PdfReaderView({
  doc, highlights, rev, tool, color, noteSize, pageOffset = 0, onCreate, onPatch, onRemove,
}: {
  doc: PdfDoc | null
  highlights: PdfHighlight[]
  /** Bumped by the owner whenever `highlights` is mutated in place — the page view keeps the list in
   *  a ref (it draws imperatively), so identity cannot be the signal here. */
  rev: number
  tool: ToolKind | null
  color: string
  noteSize: number
  pageOffset?: number
  onCreate: (made: PdfHighlight[]) => void
  onPatch: (id: string, patch: Partial<PdfHighlight>) => void
  onRemove: (id: string) => void
}) {
  const [pages, setPages] = useState<PageState[]>([])
  const [done, setDone] = useState(false)
  const [showOrphans, setShowOrphans] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const [font, setFont] = useState<string>(() => {
    try { return localStorage.getItem(READER_FONT_KEY) || FONTS[1].css } catch { return FONTS[1].css }
  })
  const [size, setSize] = useState<number>(() => {
    try { return Number(localStorage.getItem(READER_SIZE_KEY)) || 19 } catch { return 19 }
  })
  const [lead, setLead] = useState<number>(() => {
    try { return Number(localStorage.getItem(READER_LEAD_KEY)) || 1.7 } catch { return 1.7 }
  })
  useEffect(() => { try { localStorage.setItem(READER_FONT_KEY, font) } catch { /* private */ } }, [font])
  useEffect(() => { try { localStorage.setItem(READER_SIZE_KEY, String(size)) } catch { /* private */ } }, [size])
  useEffect(() => { try { localStorage.setItem(READER_LEAD_KEY, String(lead)) } catch { /* private */ } }, [lead])

  // ── extraction, page by page ───────────────────────────────────────────────────────────────────
  // Progressive on purpose: a long source must start reading before its last page is parsed, and a
  // synchronous loop over 400 getTextContent calls is a main-thread freeze on exactly the device
  // (iOS) where this file's rules say never to take one.
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    setPages([]); setDone(false)
    void (async () => {
      const out: PageState[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const reflow = await getPageReflow(doc, n)
        if (cancelled) return
        out.push({ n, reflow })
        // Flush the first page immediately, then in small batches — one setState per page on a
        // 400-page source is 400 renders of a growing tree.
        if (n === 1 || n % 4 === 0 || n === doc.numPages) {
          setPages([...out])
          await new Promise<void>(r => setTimeout(r, 0))
          if (cancelled) return
        }
      }
      if (!cancelled) { setPages([...out]); setDone(true) }
    })()
    return () => { cancelled = true }
  }, [doc])

  // ── placing the marks ──────────────────────────────────────────────────────────────────────────
  const placement = useMemo(() => {
    const byPage = new Map<number, Pl[]>()
    const notesByBlock = new Map<string, Pl[]>()
    const lost: PdfHighlight[] = []
    const { anchored, unanchored } = toReaderMarks(highlights)
    lost.push(...unanchored)
    const perPage = new Map<number, Mk[]>()
    for (const m of anchored) {
      const arr = perPage.get(m.hl.page) ?? []
      arr.push(m); perPage.set(m.hl.page, arr)
    }
    for (const p of pages) {
      const mine = perPage.get(p.n) ?? []
      if (!mine.length) continue
      if (!p.reflow) { lost.push(...mine.map(m => m.hl)); continue }
      const texts = p.reflow.blocks.map(b => b.text)
      const { placed, orphaned } = locateAll(mine, texts)
      lost.push(...(orphaned as Mk[]).map(m => m.hl))
      const hi: Pl[] = []
      for (const l of placed as Pl[]) {
        if ((l.hl.kind ?? 'highlight') === 'text') {
          const k = `${p.n}:${l.block}`
          const arr = notesByBlock.get(k) ?? []
          arr.push(l); notesByBlock.set(k, arr)
        } else hi.push(l)
      }
      byPage.set(p.n, hi)
    }
    // Pages that have not been extracted yet are not LOST — they are not read yet. Only count a
    // mark as unplaceable once its page has actually been looked at.
    const seen = new Set(pages.map(p => p.n))
    return { byPage, notesByBlock, lost: lost.filter(h => !h.anchor || seen.has(h.page)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, highlights, rev])

  // ── creating a mark from a selection ───────────────────────────────────────────────────────────
  /**
   * Which characters of which blocks does the current selection cover?
   *
   * Read off the RUN SPANS (each carries `data-from`, its offset in the block), not off the DOM
   * text nodes' positions — the runs are exactly the units markRuns produced, so an offset here is
   * the same integer the anchor will store. Deriving it any other way is a second implementation of
   * "where in the block is this".
   */
  function selectionRanges(): Array<{ page: number; block: number; start: number; end: number }> {
    const sel = window.getSelection()
    const root = rootRef.current
    if (!sel || sel.isCollapsed || !sel.rangeCount || !root) return []
    const range = sel.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return []
    const acc = new Map<string, { page: number; block: number; start: number; end: number }>()
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('span[data-from]'))) {
      if (!range.intersectsNode(el)) continue
      const tn = el.firstChild
      if (!tn || tn.nodeType !== 3) continue
      const from = Number(el.dataset.from)
      const len = (tn as Text).length
      let s = 0, e = len
      if (range.startContainer === tn) s = range.startOffset
      else if (el.contains(range.startContainer) && range.startContainer !== el) s = 0
      if (range.endContainer === tn) e = range.endOffset
      if (e <= s) continue
      const blockEl = el.closest<HTMLElement>('[data-block]')
      const pageEl = el.closest<HTMLElement>('[data-page]')
      if (!blockEl || !pageEl) continue
      const block = Number(blockEl.dataset.block), page = Number(pageEl.dataset.page)
      const key = `${page}:${block}`
      const cur = acc.get(key)
      const start = from + s, end = from + e
      if (!cur) acc.set(key, { page, block, start, end })
      else { cur.start = Math.min(cur.start, start); cur.end = Math.max(cur.end, end) }
    }
    return [...acc.values()].sort((a, b) => a.page - b.page || a.block - b.block)
  }

  function createFromSelection(kind: HighlightKind, c: string) {
    const ranges = selectionRanges()
    if (!ranges.length) return false
    const made: PdfHighlight[] = []
    for (const r of ranges) {
      const p = pages.find(q => q.n === r.page)
      if (!p?.reflow) continue
      const text = p.reflow.blocks[r.block]?.text.slice(r.start, r.end) ?? ''
      if (!text.trim()) continue
      made.push({
        id: uuidv4(), page: r.page, kind,
        // The rects are what the PAGE view draws. Derived from the same segs the anchor came from,
        // so the two views agree by construction rather than by both being maintained.
        rects: rectsForRange(p.reflow, r.block, r.start, r.end),
        anchor: { block: r.block, start: r.start, text },
        color: c, text, createdAt: new Date().toISOString(),
      })
    }
    if (!made.length) return false
    onCreate(made)
    window.getSelection()?.removeAllRanges()
    return true
  }

  function addNote(page: number, block: number, at?: { x: number; y: number }) {
    const p = pages.find(q => q.n === page)
    if (!p?.reflow) return
    const bt = p.reflow.blocks[block]?.text ?? ''
    if (!bt) return
    const anchorText = noteAnchorText(bt)
    const start = bt.indexOf(anchorText)
    onCreate([{
      id: uuidv4(), page, kind: 'text',
      // A note still gets page rects so the PAGE view can draw it where it has always drawn notes.
      // Its box there is the head of its paragraph, which is the honest translation of "anchored to
      // this paragraph" back into a geometry that has no concept of one.
      rects: (() => {
        const rr = rectsForRange(p.reflow!, block, start < 0 ? 0 : start, (start < 0 ? 0 : start) + Math.min(24, anchorText.length))
        const r0 = rr[0]
        return r0 ? [{ x: Math.min(0.92, r0.x), y: r0.y, w: 0.22, h: 0.06 }] : [{ x: at?.x ?? 0.7, y: at?.y ?? 0.1, w: 0.22, h: 0.06 }]
      })(),
      anchor: { block, start: start < 0 ? 0 : start, text: anchorText },
      color, text: '', note: '', size: noteSize, createdAt: new Date().toISOString(),
    }])
  }

  function onMouseUp(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    const markEl = target.closest<HTMLElement>('[data-mark-id]')
    if (tool === 'erase') {
      if (markEl?.dataset.markId) onRemove(markEl.dataset.markId)
      window.getSelection()?.removeAllRanges()
      return
    }
    if (tool === 'text') {
      const blockEl = target.closest<HTMLElement>('[data-block]')
      const pageEl = target.closest<HTMLElement>('[data-page]')
      if (blockEl && pageEl && !target.closest('[data-note-id]')) {
        addNote(Number(pageEl.dataset.page), Number(blockEl.dataset.block))
      }
      window.getSelection()?.removeAllRanges()
      return
    }
    if (tool === 'highlight' || tool === 'underline' || tool === 'strike') {
      createFromSelection(tool, color)
    }
  }

  // The bare-selection path (no tool armed) offers the same colour card the page view offers.
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null)
  function onMouseUpOuter(e: React.MouseEvent) {
    onMouseUp(e)
    if (tool) { setPending(null); return }
    const box = rootRef.current?.parentElement?.getBoundingClientRect()
    setPending(selectionRanges().length && box ? { x: e.clientX - box.left, y: e.clientY - box.top } : null)
  }

  // ── render ─────────────────────────────────────────────────────────────────────────────────────
  const lost = placement.lost
  // A <select> is a replaced element: no pseudo-element, so it cannot borrow the `.iw-tap` hit
  // region and its BOX has to be the target. 34px is also what the app-wide 16px iOS input floor
  // (index.css) needs in order not to clip its own line.
  const touch = isTouchDevice()
  // ⚠ THE TWO SLIDERS ARE THE REASON THIS VIEW EXISTS (Peter asked for font, size and line spacing
  // first) AND THEY WERE THE LEAST USABLE THING IN IT ON A PHONE. Measured 86×16 at 375px:
  //  • 16px tall is a drag target you miss, and
  //  • a range input owns a HORIZONTAL drag while the app-wide phone rule is `touch-action: pan-x
  //    pan-y` — which does NOT inherit, and which no UA stylesheet overrides for `type=range`. So a
  //    finger dragging the thumb sideways was a candidate PAN: the browser could take the gesture
  //    and scroll instead. Same class as the PDF text note's drag; same fix.
  const RANGE: React.CSSProperties = touch
    ? { width: 110, height: 40, touchAction: 'none' }
    : { width: 86 }
  return (
    <div className="iw-pdf-reader" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--iw-reader-paper, #fbfaf7)' }}>
      {/* THE CONTROLS PETER ASKED FOR FIRST — font, size, line spacing. They are the reason this
          view exists, so they are in it rather than buried in the viewer's already-full toolbar. */}
      <div className="iw-tap-row" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '6px 10px', borderBottom: `1px solid ${EDGE}`, background: 'var(--iw-reader-bar, #faf8fc)', fontSize: '0.78rem', color: INKP,
        ['--iw-tap-x' as string]: '8px' }}>
        <select value={font} onChange={e => setFont(e.target.value)} title="Reading font"
          className="iw-reader-field"
          style={{ height: touch ? 40 : 26, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, fontSize: '0.78rem', padding: '0 4px' }}>
          {FONTS.map(f => <option key={f.label} value={f.css}>{f.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Text size">
          <span aria-hidden="true">A</span>
          <input type="range" min={13} max={34} step={1} value={size} onChange={e => setSize(Number(e.target.value))}
            style={RANGE} aria-label="Text size" />
          <span style={{ minWidth: 22, textAlign: 'right' }}>{size}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Line spacing">
          <span aria-hidden="true">↕</span>
          <input type="range" min={11} max={30} step={1} value={Math.round(lead * 10)}
            onChange={e => setLead(Number(e.target.value) / 10)} style={RANGE} aria-label="Line spacing" />
          <span style={{ minWidth: 26, textAlign: 'right' }}>{lead.toFixed(1)}</span>
        </label>
        <span style={{ marginLeft: 'auto' }} />
        {/* THE HONEST COUNT. Never a deletion, never a silent drop — this is the whole of rule 3. */}
        {lost.length > 0 && (
          <button type="button" onClick={() => setShowOrphans(v => !v)}
            title="Marks this view cannot place. They are untouched and still show in the page view."
            style={{ border: `1px solid #b4530955`, background: '#fff7ed', color: '#9a3412', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: '0.74rem' }}>
            {lost.length} mark{lost.length === 1 ? '' : 's'} not placed here
          </button>
        )}
        {!done && <span style={{ color: '#8d7ba3' }}>reading… {pages.length}</span>}
      </div>

      {showOrphans && lost.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: 150, overflow: 'auto', padding: '8px 12px', background: '#fff7ed',
          borderBottom: '1px solid #fed7aa', fontSize: '0.78rem', color: '#7c2d12' }}>
          <p style={{ margin: '0 0 6px' }}>
            These were placed by rectangle on the printed page, so this view has no text to hang them on.
            Nothing has been deleted — switch to the page view to see them where they were made.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {lost.slice(0, 40).map(h => (
              <li key={h.id} style={{ marginBottom: 2 }}>
                p.{h.page + pageOffset} · {(h.kind ?? 'highlight') === 'text' ? (h.note?.trim() || 'empty note') : (h.text?.trim().slice(0, 90) || 'no text recorded')}
              </li>
            ))}
            {lost.length > 40 && <li>…and {lost.length - 40} more</li>}
          </ul>
        </div>
      )}

      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div ref={rootRef} onMouseUp={onMouseUpOuter} className="iw-pdf-reader-page"
          style={{ maxWidth: Math.min(760, 46 * size), margin: '0 auto', padding: '26px 22px 90px',
            fontFamily: font, fontSize: size, lineHeight: lead, color: 'var(--iw-reader-ink, #241f2b)',
            cursor: tool === 'text' ? 'crosshair' : tool === 'erase' ? 'not-allowed' : undefined }}>
          {!pages.length && <p style={{ color: MUTED }}>Reading the text…</p>}
          {pages.map(p => (
            <section key={p.n} data-page={p.n}>
              <div style={{ margin: '26px 0 12px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: '0.68em', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--iw-reader-muted, #6b645f)' }}>
                <span style={{ flex: 1, height: 1, background: HAIR }} />
                page {p.n + pageOffset}
                <span style={{ flex: 1, height: 1, background: HAIR }} />
              </div>
              {!p.reflow && (
                <p style={{ color: '#9a3412', fontStyle: 'italic', fontSize: '0.85em' }}>
                  This page has no text layer — it is a scanned image. Use the page view to read it.
                </p>
              )}
              {p.reflow?.blocks.map((b, bi) => (
                <Block key={bi} page={p.n} bi={bi} text={b.text} heading={b.heading}
                  marks={(placement.byPage.get(p.n) ?? []).filter(m => m.block === bi)}
                  notes={placement.notesByBlock.get(`${p.n}:${bi}`) ?? []}
                  onPatch={onPatch} onRemove={onRemove} />
              ))}
            </section>
          ))}
        </div>

        {pending && (
          <div style={{ position: 'absolute', left: Math.max(8, pending.x - 100), top: pending.y + 8, zIndex: 20,
            background: CTL, border: `1px solid ${EDGE}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            padding: '6px 8px', display: 'flex', gap: 6 }}>
            {['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6'].map(c => (
              <button key={c} type="button" title="Highlight" onMouseDown={ev => ev.preventDefault()}
                onClick={() => { createFromSelection('highlight', c); setPending(null) }}
                style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer' }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One reflowed paragraph, its highlight runs, and the notes anchored to it. */
function Block({ page, bi, text, heading, marks, notes, onPatch, onRemove }: {
  page: number; bi: number; text: string; heading: boolean
  marks: Pl[]; notes: Pl[]
  onPatch: (id: string, patch: Partial<PdfHighlight>) => void
  onRemove: (id: string) => void
}) {
  const runs = markRuns(text.length, marks)
  return (
    <div data-page-block={`${page}:${bi}`}>
      <p data-block={bi} style={{
        margin: heading ? '1.1em 0 0.4em' : '0 0 0.85em',
        fontWeight: heading ? 600 : undefined, fontSize: heading ? '1.12em' : undefined,
        whiteSpace: 'pre-wrap', textAlign: heading ? undefined : 'justify', hyphens: 'auto',
      }}>
        {runs.map((r, i) => {
          const top = r.marks[r.marks.length - 1] as Pl | undefined
          const kind = top?.hl.kind ?? 'highlight'
          const filled = !!top && kind === 'highlight'
          return (
            <span key={i} data-from={r.from} data-mark-id={top?.id}
              className={filled ? 'iw-mark-fill' : undefined}
              style={top ? {
                ...(filled ? markFill(top.hl.color) : null),
                // The fill is pale in both themes, so the ink on it is dark in both. An underline or
                // a strike is a STROKE over ordinary prose and keeps the page's own ink.
                color: filled ? ON_MARK : undefined,
                borderBottom: kind === 'underline' ? `2px solid ${top.hl.color}` : undefined,
                textDecoration: kind === 'strike' ? 'line-through' : undefined,
                textDecorationColor: kind === 'strike' ? top.hl.color : undefined,
                borderRadius: filled ? 2 : undefined,
              } : undefined}>
              {text.slice(r.from, r.to)}
            </span>
          )
        })}
      </p>
      {notes.map(n => (
        <div key={n.id} data-note-id={n.id} style={{
          margin: '0 0 0.9em', padding: '7px 10px', borderRadius: 8, background: n.hl.color,
          border: '1px solid rgba(0,0,0,0.14)', fontSize: `${n.hl.size ?? 12}px`, lineHeight: 1.4,
          color: ON_MARK, position: 'relative', fontFamily: 'system-ui, sans-serif',
        }}>
          <div contentEditable suppressContentEditableWarning spellCheck={false}
            onBlur={e => onPatch(n.id, { note: e.currentTarget.textContent ?? '' })}
            style={{ outline: 'none', minHeight: '1.2em', whiteSpace: 'pre-wrap' }}>
            {n.hl.note ?? ''}
          </div>
          <button type="button" title="Remove this note" onClick={() => onRemove(n.id)} className="iw-tap"
            style={{ position: 'absolute', top: -8, right: -8, width: 18, height: 18, borderRadius: '50%',
              border: '1px solid rgba(0,0,0,0.2)', background: CTL, color: 'var(--iw-reader-ink-red, #991b1b)', cursor: 'pointer',
              fontSize: 11, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  )
}
