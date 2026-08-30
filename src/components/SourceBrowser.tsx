// THE IN-APP SOURCE READER — read the page a citation points at, and cite what you select in it.
//
// Peter, 2026-08-28: "let's build a browser inside our app like ChatGPT does", after being shown
// that an iframe can display a page but can never let us see a selection inside it. That is true of
// an iframe and only of an iframe. So the page is FETCHED (api/_reader-core.mjs — read its header
// for the privacy posture, which Peter authorised explicitly) and arrives as STRUCTURED BLOCKS,
// which are rendered as React elements here. Two consequences, both the point:
//   • the text is in OUR document, so `window.getSelection()` works and "highlight the heading and
//     cite it" is finally expressible;
//   • no HTML string exists anywhere in the path, so injection into an origin holding the writer's
//     thesis and signing session is unrepresentable rather than merely filtered.
//
// The iframe survives as the FALLBACK. Some pages defeat extraction (a JS-rendered app has no prose
// in its HTML) and some hosts refuse framing (JSTOR sends X-Frame-Options: DENY — checked). Between
// them the panel always has something to offer, and it SAYS which mode it is in rather than leaving
// the reader to guess why selection does or doesn't work.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReaderBlock, ReaderDoc, Run } from '../reader/types'
import { locatorForHeading } from '../reader/types'
import { splitMath, hasMath } from '../reader/readerMath'
import { liveFrameEnabled } from '../reader/liveFrameFlag'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { anchorSlice, locateAll, markRuns, pointAt, type ReaderMark, type MarkKind, type Located } from '../reader/marks'
import { readerInk } from '../reader/markInk'
import { pdfZoomFactor } from './zoomGesture'
import {
  clampLiveZoom, liveFrameGeom, liveZoomStep, panAfterZoom, ZOOM_STEP_FACTOR, type PageWidth,
} from './liveFrameZoom'
import {
  allowFramingVia, extensionState, loadSource, openExtensionPopup, releaseFraming, windowPort,
  type ExtensionState, type Via,
} from '../reader/pageSource'
import { v4 as uuidv4 } from 'uuid'
import type { LocatorKind } from '../citations/locator'
import {
  applyDockRoom, dockHandlePos, dockPanelPos, dockResize, dockRoom, NO_DOCK_ROOM,
  readStoredDockSide, readStoredOrientation, resolveOrientation, writeStoredDockSide,
  writeStoredOrientation, WIDE_QUERY, type DockOrientation,
} from './dockLayout'
import { isTouchDevice } from '../editor/isTouchDevice'
import { tabDocId } from '../storage/tabDoc'
import { OPEN_PDF_EVENT } from '../citations/pdfViewer'

const INK = '#5c2d8a'
// ── TWO SURFACES, TWO PALETTES, AND EVERY COLOUR HERE BELONGS TO EXACTLY ONE OF THEM ────────────
// This panel is not one surface. Its HEADER is chrome (the dolphin-grey `.iw-nightable` panel);
// its ARTICLE, its MARKUP BAR and every control face in that bar are reader PAPER, which now has
// its own night (index.css, the reader token block). Getting a control's surface wrong is not a
// near-miss — it produced BOTH of Peter's 2026-08-30 complaints at once, in opposite directions:
// a literal `#5c2d8a` left on the night HEADER measured 1.13:1 (invisible), and chrome tokens
// leaking onto the near-white markup BAR washed its labels out to ~1.2:1.
// So: ask which surface the control sits on FIRST, then take that surface's token.
const INKC = 'var(--iw-ink, #5c2d8a)'                     // purple inside a floating chrome bubble
const CHROME_FG = 'var(--iw-reader-chrome-fg, #5c2d8a)'   // the header strip's own ink
const CHROME_DIM = 'var(--iw-reader-chrome-dim, #d6d3d1)' // …and its disabled glyphs
const INKP = 'var(--iw-reader-accent, #5c2d8a)'           // purple ON reader paper / the markup bar
const CTL = 'var(--iw-reader-ctl, #fff)'                  // a control FACE on a reader surface
const EDGE = 'var(--iw-reader-edge, #d6cfe0)'             // …its border
// The filled "open it in a tab" action, declared ONCE. It appeared as an inline literal in each of
// the four dead-end cards, which is four chances for one of them to drift — and a fifth card
// (Inkwave-in-Inkwave, 2026-08-30) would have made five.
const OPEN_TAB_FILL = `linear-gradient(135deg, #7a4fb0, ${INK})`
const HAIR = 'var(--iw-reader-hair, rgba(92,45,138,0.13))'// hairline rules/dividers on paper
const TINT = 'var(--iw-reader-tint, rgba(92,45,138,0.08))'// the lit-tool fill
// Ink laid ON a mark's own fill. A highlight/note/box is an opaque PALE patch in both themes, so
// its text is dark in both — stated here rather than inherited from a page that now inverts.
const ON_MARK = 'var(--iw-reader-on-mark, #2c2a28)'
// Two muted greys, because there are two kinds of surface.
const MUTED_CHROME = 'var(--iw-pill-fg, #78716c)'
const MUTED_PAPER = 'var(--iw-reader-muted, #6b645f)'

// ── TOUCH SIZING ────────────────────────────────────────────────────────────────────────────────
// The ICON buttons keep their painted size on every device and grow only their HIT REGION, via the
// `.iw-tap` rule in index.css — see its header for why (a dense bar cannot grow to 44px per control
// without wrapping to three rows inside a 50dvh phone dock).
// A control you TYPE IN is the exception, and it is not a taste call: the global phone rule floors
// every input/select at 16px (`input, select, textarea { font-size: max(16px, 1em) }` — iOS zooms
// the whole page to anything smaller and STAYS zoomed), so a 22px box is shorter than the line it
// now has to hold. The FONT was floored months ago and the BOXES were never grown with it.
// 40, not 34: a `<select>` cannot borrow the `.iw-tap` hit region (a replaced element renders no
// pseudo-element in Chrome or Safari), so for these controls the painted box IS the target and it
// has to carry the whole size on its own.
const TOUCH_FIELD_H = 40

/**
 * Keep a `translateX(-50%)` popover anchored near `x` but never hanging off a screen edge.
 *
 * ⚠ THIS IS A PHONE BUG, NOT A POLISH ITEM. Both floating boxes here are centred on the point you
 * touched — which is fine on a 1500px panel and not on a 375px one: the composer is ~354px wide, so
 * ANY selection in the left or right third of an iPhone screen put half of it (and the ✓/✕ that
 * commit or cancel a half-typed note) past the edge, unreachable. A layout effect, so the clamp
 * lands before paint rather than as a visible jump.
 */
function useClampedX(x: number | null | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || x == null) return
    const half = el.offsetWidth / 2
    const vw = window.innerWidth
    // A box wider than the viewport has no satisfying position; centre it rather than pick an edge.
    const left = half * 2 >= vw - 16 ? vw / 2 : Math.min(Math.max(x, half + 8), vw - half - 8)
    el.style.left = `${left}px`
  }, [x])
  return ref
}

/** One formula. A KaTeX failure renders the SOURCE, never a gap: unreadable LaTeX still tells the
 *  reader what the argument's step was; a hole does not. */
function Katex({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false }) }
    catch { return null }
  }, [tex, display])
  if (!html) return <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }}>{tex}</code>
  return <span style={display ? { display: 'block', margin: '0.8em 0', textAlign: 'center' } : undefined}
    // KaTeX's own output, from a string we control the shape of — this is the one place markup is
    // generated rather than described, and it is generated HERE, not fetched.
    dangerouslySetInnerHTML={{ __html: html }} />
}

// Reader-mode faces (Peter, 2026-08-28: "an option to change the font in the second mode to a
// number of preset sexy fonts"). Drawn from the app's own certified set — these are already
// fetched for the editor, so choosing one costs no new download and they sit beside the writing
// rather than against it. Reader mode only: LIVE mode is the publisher's page and its typography
// is theirs.
// The PDF viewer's own palette, so a highlight means the same colour in both readers.
const MARK_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']
// No dark pair: a sticky note in maroon or navy is a note you cannot read (Peter, 2026-08-28).
const NOTE_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']
// ⚠ COLOURED TEXT NEEDS ITS OWN PALETTE — INKS, NOT WASHES (Peter: "an input text which allows us
// to input coloured text at the cursor"). Reusing the highlighter four would put pale yellow words
// on cream: text you cannot read is not an annotation. These are the PDF's own dark pair plus a
// green and the app's ink, so a written-in word is as legible as the prose it sits beside.
const TEXT_COLORS = ['#991b1b', '#1e3a8a', '#166534', INK]
// A textbox is the PDF's sticky note, so it takes the sticky note's colours — same object, same
// vocabulary, both readers.
const BOX_COLORS = NOTE_COLORS

// ── READER ZOOM (Peter, 2026-08-28: "and all the same zoom settings etc") ───────────────────────
// SAME GESTURE, DIFFERENT SUBJECT. The PDF zooms a RASTER, so it re-renders and grows a horizontal
// scrollbar; the reader owns its own text, so zooming means growing the TYPE and letting the
// article reflow to the panel — no second axis, ever. The ⌘/ctrl-wheel curve is imported rather
// than re-tuned (see zoomGesture.ts) so the two readers cannot drift apart under the same finger.
const READER_ZOOM_MIN = 0.6, READER_ZOOM_MAX = 3, READER_BASE_PX = 17
export function clampReaderZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(READER_ZOOM_MAX, Math.max(READER_ZOOM_MIN, z))
}
/** One −/+ press. A fixed ×1.15 rather than a ladder: the ladder and the wheel would be two rules
 *  for one question, and the writer would meet both. The FACTOR is imported (liveFrameZoom.ts) so
 *  reader mode and live mode step by the same amount under the same button. */
export function readerZoomStep(z: number, dir: 1 | -1): number {
  return clampReaderZoom(z * (dir === 1 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR))
}

// A textbox anchors to the OPENING of the paragraph it was dropped on — the one part of a block
// that a reader would recognise, and the part an author is least likely to rewrite.
const BOX_ANCHOR_LEN = 60

const READER_FONTS: Array<{ label: string; css: string }> = [
  { label: 'Garamond', css: "'EB Garamond', Georgia, serif" },
  { label: 'Fell',     css: "'IM Fell DW Pica', Georgia, serif" },
  { label: 'Spectral', css: "'Spectral', Georgia, serif" },
  { label: 'Lora',     css: "'Lora', Georgia, serif" },
  { label: 'Crimson',  css: "'Crimson Pro', Georgia, serif" },
  { label: 'Carlito',  css: "'Carlito', system-ui, sans-serif" },
  { label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
]

// The address layer lives in `reader/address.ts` — pure URL rules with no React in them, tested
// next to the module in `reader/address.test.ts`.
import {
  isInkwaveItself, embeddableUrl, isPlayable, isSearch, queryOf,
  mustUseReader, addressToUrl, stripTracking, unwrapRedirect, likelyRefusesFraming, hostOf,
} from '../reader/address'


const ERRORS: Record<string, string> = {
  'blocked host': 'That address points somewhere Inkwave won’t fetch.',
  'bad url': 'That doesn’t look like a web address.',
  'not html': 'That link isn’t a web page (it may be a PDF — attach it to the source instead).',
  'too large': 'That page is unusually large and wasn’t fetched.',
  'no readable text': 'No article text could be found on that page.',
  'fetch failed': 'That page couldn’t be reached.',
  rate: 'Too many pages fetched just now — try again in a moment.',
}

/** Paint the mark runs over a block's text. Splitting happens on PLAIN-TEXT offsets, so the block's
 *  own runs (links, emphasis) are walked in step and a mark that starts mid-link still paints. */
function markedStyle(ms: Located[]): React.CSSProperties | undefined {
  if (!ms.length) return undefined
  const hl = ms.find((m) => m.kind === 'highlight')
  const note = ms.find((m) => m.kind === 'note')
  return {
    background: hl ? hl.color : undefined,
    // ⚠ A HIGHLIGHTED RUN CARRIES ITS OWN INK. The fill is an opaque PALE colour — the mark's, at
    // its stored value, in both themes — so the text on it must be dark whatever the page behind is
    // doing. Day is byte-unchanged (--iw-reader-on-mark's day value IS the day paper ink); at night
    // this is what keeps the highlight looking like a highlighter instead of turning into pale ink
    // on pale yellow the moment the reading column went dark.
    color: hl ? ON_MARK : undefined,
    // A sticky note is a STROKE under ordinary text, so it needs no ink of its own — a pale rule on
    // a dark page reads better than it ever did on a light one.
    borderBottom: note ? `2px solid ${note.color}` : undefined,
    borderRadius: hl ? 2 : undefined,
  }
}

/**
 * The reader's own words, written INTO the article at a point (D1). It is rendered as an ordinary
 * inline span of coloured text — deliberately not a badge or a bubble: Peter asked to "input
 * coloured text", and a note that reads as part of the sentence is the thing he described.
 * `data-iw-ins` marks it as ours so it can never be mistaken for the publisher's prose by a reader,
 * a screenshot, or a future selection rule.
 */
function InsertedText({ mark, onErase }: { mark: Located; onErase?: (id: string) => void }) {
  return (
    // ⚠ THE ONE MARK WHOSE COLOUR IS THE READABLE ELEMENT, so it is the one that must be cast for
    // the surface — see reader/markInk.ts. The STORED value is untouched; this is paint only.
    <span data-iw-ins={mark.id} title="Your note — armed eraser removes it"
      onClick={onErase ? (e) => { e.stopPropagation(); onErase(mark.id) } : undefined}
      style={{ color: readerInk(mark.color), fontWeight: 600, whiteSpace: 'pre-wrap',
        borderBottom: `1px dotted ${readerInk(mark.color)}`, padding: '0 0.15em' }}>
      {mark.body}
    </span>
  )
}

/**
 * A textbox (D2) — the PDF's sticky note, hung under the paragraph it belongs to.
 *
 * ⚠ IT IS NOT PLACED AT COORDINATES, and the PDF's version is. That difference is forced: a PDF
 * page is a fixed rectangle forever, while this article is re-fetched, re-wrapped at whatever width
 * the panel happens to be, and re-typeset at whatever zoom the reader chose — so (x, y) would point
 * at different words every visit. Anchoring to the paragraph is the same concession Lane B accepted
 * for the reflowed PDF view, and it is the honest one: the box says which paragraph it is about,
 * which is the only thing it could ever have truthfully claimed.
 */
function BoxCard({ mark, editing, onOpen, onChange, onDone, onDelete }: {
  mark: Located
  editing: boolean
  onOpen: () => void
  onChange: (v: string) => void
  onDone: () => void
  onDelete: () => void
}) {
  return (
    <div data-iw-box={mark.id}
      style={{ margin: '0.4em 0 0.9em', padding: '6px 9px', borderRadius: 8, position: 'relative',
        // A textbox is a FILL of the mark's own pale colour: stored value, dark ink on top, both themes.
        background: mark.color, color: ON_MARK, border: '1px solid rgba(0,0,0,0.16)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.16)', fontFamily: 'system-ui, sans-serif',
        fontSize: '0.8em', lineHeight: 1.4 }}>
      {editing ? (
        <textarea autoFocus value={mark.body ?? ''} rows={2}
          onChange={(e) => onChange(e.target.value)}
          // Esc commits too — the PDF's notes behave the same way, and a note you cannot get out of
          // without finding the right pixel is a note you stop making.
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}
          onBlur={onDone}
          style={{ width: '100%', resize: 'vertical', background: 'transparent', border: 'none',
            outline: 'none', font: 'inherit', color: 'inherit' }} />
      ) : (
        <div onClick={onOpen} style={{ whiteSpace: 'pre-wrap', cursor: 'pointer', minHeight: '1.2em' }}>
          {mark.body || <span style={{ opacity: 0.55 }}>empty note — click to write</span>}
        </div>
      )}
      <button type="button" title="Delete this note" aria-label="Delete this note"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        style={{ position: 'absolute', top: -7, right: -7, width: 16, height: 16, borderRadius: '50%',
          // The delete badge sits on a CONTROL FACE, not on the note's own fill — so its red is the
          // paper-cast ink, or it disappears into the night control face.
          border: `1px solid ${readerInk('#991b1b')}`, background: CTL, color: readerInk('#991b1b'), fontSize: '11px',
          lineHeight: '13px', padding: 0, cursor: 'pointer' }}>×</button>
    </div>
  )
}

function Runs({ runs, onNavigate, marks, points, onEraseMark }: {
  runs: Run[]
  onNavigate?: (url: string) => void
  marks?: Located[]
  /** Point-anchored insertions rendered at a seam INSIDE this block (D1's coloured text). */
  points?: Located[]
  onEraseMark?: (id: string) => void
}) {
  const ranges = marks ?? []
  const pts = points ?? []
  if (ranges.length || pts.length) {
    // Walk the runs and the mark boundaries together on one plain-text cursor.
    const total = runs.reduce((n, r) => n + r.text.length, 0)
    // A point mark has no width, so it would fall inside whatever run happened to contain it and
    // never get emitted. Its position becomes a CUT, which guarantees a seam exists exactly there.
    const segs = markRuns(total, ranges, pts.map((p) => pointAt(p, total)))
    const out: React.ReactNode[] = []
    const done = new Set<string>()
    const emitPoints = (at: number) => {
      for (const p of pts) {
        if (done.has(p.id) || pointAt(p, total) !== at) continue
        done.add(p.id)
        out.push(<InsertedText key={`ins-${p.id}`} mark={p} onErase={onEraseMark} />)
      }
    }
    let cur = 0
    for (const r of runs) {
      const rStart = cur, rEnd = cur + r.text.length
      cur = rEnd
      for (const g of segs) {
        const from = Math.max(g.from, rStart), to = Math.min(g.to, rEnd)
        if (to <= from) continue
        emitPoints(from)
        const piece = { ...r, text: r.text.slice(from - rStart, to - rStart) }
        const st = markedStyle(g.marks)
        out.push(
          <span key={`${rStart}-${from}`} style={st}
            onClick={g.marks.length && onEraseMark ? () => onEraseMark(g.marks[0].id) : undefined}
            title={g.marks.find((m) => m.kind === 'note')?.body || undefined}>
            <Runs runs={[piece]} onNavigate={onNavigate} />
          </span>,
        )
      }
    }
    emitPoints(total)   // an insertion at the very end of the block has no following seam
    return <>{out}</>
  }
  return (
    <>
      {runs.map((r, i) => {
        // LaTeX arrives RAW because the publisher typesets it with MathJax in the browser and we
        // fetched the page before any script ran (reader/readerMath.ts). KaTeX is already bundled.
        let node: React.ReactNode = hasMath(r.text)
          ? splitMath(r.text).map((seg, k) => seg.kind === 'text'
              ? <span key={k}>{seg.value}</span>
              : <Katex key={k} tex={seg.value} display={!!seg.display} />)
          : r.text
        if (r.code) node = <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{node}</code>
        if (r.em) node = <em>{node}</em>
        if (r.strong) node = <strong>{node}</strong>
        // href is validated on BOTH sides (the server refuses anything but http/s, and so does this)
        // — one rule in two places is how a hole opens, so neither trusts the other.
        if (r.href && /^https?:\/\//i.test(r.href)) {
          const href = r.href
          node = (
            <a href={href} rel="noreferrer noopener" style={{ color: INKP, textDecoration: 'underline' }}
              // Plain click = follow it HERE. ⌘/Ctrl/middle-click keeps the browser's own meaning
              // (a real tab), because a panel that swallows every modifier is not a browser either.
              onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onNavigate?.(href) }}>
              {node}
            </a>
          )
        }
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

export function SourceBrowser({ url, title, onClose, onCite, onQuote }: {
  url: string
  title?: string | null
  onClose: () => void
  /** Cite a part of the source — a section number from a heading, or whatever was selected. */
  onCite?: (loc: { kind: LocatorKind; value: string }) => void
  /** Use the selection as the citation's pinpoint sentence. */
  onQuote?: (quote: string) => void
}) {
  // ── IN-PANEL NAVIGATION (Peter, 2026-08-28: "can we make it a fully functioning browser … so you
  // can navigate to new tabs and so on") ────────────────────────────────────────────────────────
  // A link in the reader loads INSIDE the reader, with real back/forward, instead of throwing the
  // writer out to a new tab. The stack is the panel's own history — deliberately not the browser's,
  // because this is a panel over a document the writer must not lose their place in.
  const [stack, setStack] = useState<string[]>([url])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setStack([url]); setIdx(0) }, [url])
  const here = stack[idx] ?? url
  /** Inkwave, in Inkwave's own panel — refused in BOTH modes. See `isInkwaveItself`. */
  const selfOpen = isInkwaveItself(here)
  const [addr, setAddr] = useState(url)
  useEffect(() => { setAddr(here) }, [here])

  const docKey = (() => { try { return tabDocId() ?? 'global' } catch { return 'global' } })()
  // ── MARKUP (Peter: "roughly the same markup tools as for the pdfs … reproduce the same
  // ecosystem") ─────────────────────────────────────────────────────────────────────────────────
  // Highlights and sticky notes over the fetched text. Anchored by the TEXT they cover, not by an
  // offset — see reader/marks.ts for why that distinction is load-bearing on a page the publisher
  // can edit between visits.
  const [tool, setTool] = useState<MarkKind | 'erase' | null>(null)
  const [markColor, setMarkColor] = useState(MARK_COLORS[0])
  const markColorRef = useRef(markColor); markColorRef.current = markColor
  // Per-tool colour memory. Highlights and text-ink are different palettes with different jobs, so
  // one shared "current colour" would make arming the T tool silently recolour the highlighter (and
  // vice versa) — the writer's chosen ink must survive them switching tools.
  const [textColor, setTextColor] = useState(TEXT_COLORS[0])
  const textColorRef = useRef(textColor); textColorRef.current = textColor
  const [boxColor, setBoxColor] = useState(BOX_COLORS[0])
  const boxColorRef = useRef(boxColor); boxColorRef.current = boxColor
  const [paletteOpen, setPaletteOpen] = useState<MarkKind | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const [marks, setMarks] = useState<ReaderMark[]>([])
  const [leading, setLeading] = useState(() => {
    try { return Number(localStorage.getItem('inkwave:readerLeading')) || 1.62 } catch { return 1.62 }
  })
  const [font, setFont] = useState(() => {
    try { return localStorage.getItem('inkwave:readerFont') || READER_FONTS[0].css } catch { return READER_FONTS[0].css }
  })
  // Zoom (D3). Remembered like the face and the leading — how big a source needs to be is a
  // property of your eyes and your screen, not of the page you happen to have open.
  const [zoom, setZoom] = useState(() => {
    try { return clampReaderZoom(Number(localStorage.getItem('inkwave:readerZoom')) || 1) } catch { return 1 }
  })
  const applyZoom = (next: number) => {
    const z = clampReaderZoom(next)
    setZoom(z)
    try { localStorage.setItem('inkwave:readerZoom', String(z)) } catch { /* private */ }
  }
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const marksStoreKey = `inkwave:readerMarks:${docKey}:${here}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(marksStoreKey)
      setMarks(raw ? (JSON.parse(raw) as ReaderMark[]) : [])
    } catch { setMarks([]) }
  }, [marksStoreKey])
  const writeMarks = (next: ReaderMark[]) => {
    setMarks(next)
    try { localStorage.setItem(marksStoreKey, JSON.stringify(next)) } catch { /* private / full */ }
  }
  /** Same page, different #fragment — SEP's section links, and every "contents" list on the web. */
  const sameDocHash = (a: string, bStr: string): string | null => {
    try {
      const x = new URL(a), y = new URL(bStr)
      if (x.origin !== y.origin || x.pathname !== y.pathname || x.search !== y.search) return null
      return y.hash ? y.hash.slice(1) : null
    } catch { return null }
  }

  const go = (raw: string) => {
    const next = stripTracking(unwrapRedirect(raw))
    if (!/^https?:\/\//i.test(next)) return
    // ⚠ AN IN-PAGE ANCHOR IS NOT A NAVIGATION (2026-08-28, Peter: "on SEP these hyperlinks don't
    // work in reader mode"). SEP's contents list is `#Intr`, `#RelaIden`… — the SAME page with a
    // fragment. Pushing that onto the history stack refetches the whole article and lands you back
    // at the top, which is indistinguishable from the link doing nothing. The extractor already
    // keeps each heading's own id from the source (`b.id`), so the anchor has somewhere real to go.
    const frag = sameDocHash(here, next)
    if (frag) {
      const el = document.getElementById(`iw-rd-${frag}`)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
      // No heading with that id — fall through and let it navigate rather than silently doing
      // nothing, which is the failure being fixed.
    }
    // A search (or a search engine) can only ever be READ — see the note on SEARCH_URL. Switching
    // here rather than letting the live frame show a refusal is the difference between a browser
    // and a browser-shaped disappointment.
    if (mustUseReader(next, canFrameRef.current)) setFramed(false)
    // …and a search we CAN frame belongs in the frame: that is the only place Google's own
    // JavaScript runs, and its results do not exist without it.
    else if (isSearch(next) && canFrameRef.current) setFramed(true)
    // A video has no article to extract — the reader would fetch it and find nothing. Play it.
    else if (isPlayable(next)) setFramed(true)
    setStack((st) => [...st.slice(0, idx + 1), next])
    setIdx((i) => i + 1)
  }
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ⚠ THE MODE IS REMEMBERED (Peter, 2026-08-28: "clicking the link goes straight to the website no
  // delay"). Reader mode has to FETCH before it can show anything — perhaps a second — and once
  // someone is using this as a browser that second is the whole complaint. So the mode is sticky per
  // document: choose Live once and every link opens straight into the live site.
  const [framed, setFramed] = useState(() => {
    try { return localStorage.getItem('inkwave:readerLive') === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('inkwave:readerLive', framed ? '1' : '0') } catch { /* private */ } }, [framed])
  // ── PAGE WIDTH IN LIVE MODE (Peter, 2026-08-28: "it's not using the whole space") ────────────
  // The iframe's width IS the CSS viewport the site lays out for, so "not using the whole space" is
  // not something we can fix by stretching anything — it is the site's own responsive layout at
  // whatever width we hand it. Britannica at ~900px picks its DESKTOP layout, right rail and all,
  // and leaves the rail empty; the same site at ~500px picks its phone layout and fills the width.
  // So this is a CHOICE, and it belongs to the reader:
  //   auto   — the panel's real width, 1:1 (what it did before)
  //   narrow — lay out at 520px and scale UP: the phone layout, big text, no empty rails
  //   wide   — lay out at 1400px and scale DOWN: the full desktop layout, smaller text
  // Implemented by sizing the iframe to the chosen viewport and transform-scaling it to fit, which
  // is the only way to give a cross-origin document a viewport it did not ask for.
  const [pageWidth, setPageWidth] = useState<PageWidth>(() => {
    try { return (localStorage.getItem('inkwave:readerPageWidth') as PageWidth) || 'auto' } catch { return 'auto' }
  })
  // ── LIVE ZOOM (Peter, 2026-08-30: "need zoom and left right two finger scroll to work on the
  // windowed browser") ────────────────────────────────────────────────────────────────────────────
  // A MULTIPLIER ON THE PAGE-WIDTH FIT, never a second transform beside it — see liveFrameZoom.ts
  // for why one scale, why the floor is 1, and why this is buttons rather than a pinch (measured:
  // a wheel over a cross-origin frame reaches our handler 0 times out of 0).
  const [liveZoom, setLiveZoom] = useState(() => {
    try { return clampLiveZoom(Number(localStorage.getItem('inkwave:readerLiveZoom')) || 1) } catch { return 1 }
  })
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  const handingOverRef = useRef(false)
  const frameHostRef = useRef<HTMLDivElement>(null)
  const [hostBox, setHostBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = frameHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setHostBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [framed])
  const frameGeom = liveFrameGeom({ hostW: hostBox.w, hostH: hostBox.h, pageWidth, zoom: liveZoom })
  // ⚠ THE PAN IS RE-CENTRED HERE, NOT IN A LAYOUT EFFECT READING THE NEW GEOMETRY. The host's
  // scrollLeft still describes the OLD painted width at the moment the button is pressed, so the
  // ratio is applied while both numbers are consistent; a next-frame correction would be comparing
  // an old offset against a new range. `panAfterZoom`'s header records why the simple form is legal
  // in this host and would not be in the PDF's.
  const applyLiveZoom = (next: number) => {
    const z = clampLiveZoom(next)
    const el = frameHostRef.current
    if (el && z !== liveZoom) {
      const ratio = z / liveZoom
      const nextMax = Math.max(0, frameGeom.paintedW * ratio - el.clientWidth)
      el.scrollLeft = panAfterZoom(el.scrollLeft, el.clientWidth, ratio, nextMax)
    }
    setLiveZoom(z)
    try { localStorage.setItem('inkwave:readerLiveZoom', String(z)) } catch { /* private */ }
  }

  // Live view through the extension. The STATE is declared here because the refusal detector just
  // below reads it; the EFFECT that installs the rule lives after `extState`, since it cannot run
  // before we know whether there is an extension to ask.
  const [framingOn, setFramingOn] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  // ⚠ A REF, NOT THE STATE. `go` and the address-bar handler are both defined ABOVE where
  // `extState` is declared, and both need the same answer to "can this browser frame a site that
  // refuses?" — which decides whether a typed query becomes Google (framed) or DuckDuckGo (read).
  // A second copy of that decision is how the address bar and the navigator start disagreeing.
  const canFrameRef = useRef(false)

  const [frameRefused, setFrameRefused] = useState(false)
  // ⚠ ASK THE SERVER; `onLoad` LIES (2026-08-28, Peter: "we need to replace this with a proper
  // error message that explains some pages can't be read in their original form"). A refused frame
  // FIRES `load` — on Chrome's own "refused to connect" page — so the deadline-cancelled-by-onLoad
  // detector written earlier never fired at all, and the grey broken-page icon kept showing. I had
  // written that exact trap down in a probe ("onLoad is worthless on its own") and then relied on it
  // in the component anyway. Nothing INSIDE the page discriminates either: contentWindow and
  // contentDocument throw identically for a real cross-origin document and for the error page.
  // The HEADERS do, and only the server can read them (/api/reader?probe=1 → checkFramable).
  // The probe runs IN PARALLEL with the frame, so a page that works is never delayed by the question.
  useEffect(() => {
    if (!framed) { setFrameRefused(false); return }
    if (isPlayable(here)) { setFrameRefused(false); return }   // an embed endpoint — known frameable
    // The extension has stripped this page's framing headers, so the server's answer about what
    // those headers SAY is no longer a prediction about what this browser will DO. Asking anyway
    // would show "this page can't be framed" over a page that is, at that moment, framing.
    if (framingOn) { setFrameRefused(false); return }
    let live = true
    setFrameRefused(likelyRefusesFraming(here))                 // the hosts we already know, instantly
    fetch(`/api/reader?probe=1&url=${encodeURIComponent(here)}`)
      .then((r) => r.json())
      .then((j) => { if (live && j && j.framable === false) setFrameRefused(true) })
      .catch(() => { /* the probe failing is not evidence of refusal — let the frame try */ })
    return () => { live = false }
  }, [framed, here, framingOn])

  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  // The open coloured-text composer (D1): an anchor already resolved, waiting for the words. It
  // carries the RESOLVED anchor rather than a DOM position, so nothing about it can go stale while
  // the writer is typing into it.
  const [composer, setComposer] = useState<
    { x: number; y: number; block: number; start: number; text: string; before: boolean; value: string } | null
  >(null)
  /** The textbox currently being typed into (D2), by mark id. */
  const [editingBox, setEditingBox] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Both floating boxes are centred on the touched point; on a 375px screen that is off the edge
  // for anything you select near a margin. See useClampedX.
  const selBoxRef = useClampedX(sel?.x)
  const composerBoxRef = useClampedX(composer?.x)

  // ── THE DOCK — the PDF panel's rules, not a copy of them (components/dockLayout.ts) ──────────
  // Peter: "can you get it to open in the side or below with same width and placing as the pdf
  // reader?" Shared preferences too, so moving one moves both.
  const [width, setWidth] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.5))
  const [height, setHeight] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ axis: 'x' | 'y'; start: number; size: number } | null>(null)
  const [storedOrient, setStoredOrient] = useState<'bottom' | 'side'>(readStoredOrientation)
  const [dockSide, setDockSide] = useState(readStoredDockSide)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const isPhone = isTouchDevice()
  const orientation: DockOrientation = resolveOrientation(isPhone, isWide, storedOrient)

  // The section list and the privacy footer are both dismissible, and both remember PER DOCUMENT
  // (Peter, 2026-08-28: "You need an x to get rid of this — and save per document", "a button to
  // hide the menu"). Per document rather than per origin because which sources you are reading, and
  // how much room you want for them, is a property of the piece you are writing.
  const [showNav, setShowNav] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNav:${docKey}`) !== '0' } catch { return true }
  })
  const [showNotice, setShowNotice] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNotice:${docKey}`) !== '0' } catch { return true }
  })
  const toggleNav = () => setShowNav((v) => {
    const n = !v
    try { localStorage.setItem(`inkwave:readerNav:${docKey}`, n ? '1' : '0') } catch { /* private */ }
    return n
  })
  const dismissNotice = () => {
    setShowNotice(false)
    try { localStorage.setItem(`inkwave:readerNotice:${docKey}`, '0') } catch { /* private */ }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = (d.axis === 'x' ? e.clientX : e.clientY) - d.start
      // The panel grows toward the editor, so a LEFT dock and a BOTTOM dock read the drag in
      // opposite senses from a right dock — same arithmetic, one sign.
      const sign = d.axis === 'x' ? (dockSide === 'left' ? 1 : -1) : -1
      const next = dockResize(d.axis, d.size, delta * sign)
      if (d.axis === 'x') setWidth(next); else setHeight(next)
    }
    const up = () => { drag.current = null; setDragging(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [dragging, dockSide])

  // Carve the room out of the editor — the SAME four CSS variables the PDF panel writes, so the
  // editor surface and every floating pill already know how to get out of the way.
  useEffect(() => {
    applyDockRoom(dockRoom({ open: true, fullscreen: false, orientation, dockSide, width, height }))
    return () => {
      // Hand the strip over rather than blanking it: if a PDF is opening into the same dock, the
      // editor must not snap wide for a frame and back again.
      if (!handingOverRef.current) applyDockRoom(NO_DOCK_ROOM)
      handingOverRef.current = false
    }
  }, [orientation, dockSide, width, height])

  // ── WHO FETCHES THIS PAGE ────────────────────────────────────────────────────────────────────
  // Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" — yes, through
  // the extension this repo already ships (reader/pageSource.ts). MEASURED, from the DEPLOYED
  // function and not from a laptop: duckduckgo, lite-ddg and mojeek answer "fetch failed", searx.be
  // answers "Verifying your browser…", priv.au a captcha, marginalia 5 blocks and zero links, while
  // wikipedia and plato.stanford.edu are served normally. Search engines serve people, not data
  // centres — so the fetch moves to the writer's own browser when there is one to move it to.
  //
  // ⚠ THE PANEL MUST SAY WHICH HAPPENED. `via` is rendered, never inferred: a privacy posture the
  // writer cannot see is a privacy posture they do not have, and this reader has already shipped
  // two controls that looked identical whether or not they did anything.
  const [via, setVia] = useState<Via | null>(null)
  const [extState, setExtState] = useState<ExtensionState>('absent')
  // Bumped to re-run the load after the permission is granted, so the page in front of the writer
  // comes back through their own connection rather than waiting for the next navigation.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    setDoc(null); setError(null); setVia(null)
    // Our own app is refused in both modes, so do not spend a fetch (or the writer's own
    // connection) asking a server to extract prose from a client-rendered SPA shell.
    if (selfOpen) return
    void (async () => {
      // Asked ONCE per page load and memoised (reader/pageSource.ts) — otherwise this deadline
      // would sit in front of every link the reader follows.
      const st = await extensionState()
      if (!live) return
      setExtState(st)
      try {
        const { doc: d, via: v } = await loadSource(here, { port: st === 'ready' ? windowPort() : null })
        if (!live) return
        setDoc(d); setVia(v)
      } catch (e) {
        if (!live) return
        setError(ERRORS[(e as Error)?.message] ?? 'That page couldn’t be read here.')
      }
    })()
    return () => { live = false }
  }, [here, reloadKey, selfOpen])

  // ⚠ THE GRANT HAPPENS SOMEWHERE WE CANNOT WATCH. `permissions.request()` is only honoured inside
  // an extension page, so the writer turns page fetching on in the popup and this page is told
  // nothing at all. Re-asking when the window regains focus is the reconcile: coming back from the
  // popup is exactly that event. Only while `blocked`, so a settled reader re-asks nothing.
  useEffect(() => {
    if (extState !== 'blocked') return
    const recheck = () => {
      void extensionState(true).then((st) => {
        setExtState(st)
        if (st === 'ready') setReloadKey((k) => k + 1)   // re-read THIS page through the extension
      })
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [extState])

  // ── LIVE VIEW THROUGH THE EXTENSION ───────────────────────────────────────────────────────────
  // Peter, 2026-08-30: "build the extension." X-Frame-Options and CSP frame-ancestors are enforced
  // by the BROWSER, so no page can opt out of another site's refusal — but an extension can strip
  // them before the browser reads them. Measured headed, with a canary proving the ruleset live and
  // a control proving refusals were detectable at all: google / youtube-watch / abc.net.au /
  // facebook all go REFUSED → framed (docs/SEARCH-AND-THE-EXTENSION.md).
  //
  // ⚠ THE RULE MUST BE INSTALLED BEFORE THE FRAME LOADS, which is what `frameKey` is for: it
  // remounts the iframe once the rule lands. Without it the frame is refused first and the rule
  // arrives at an error page that will not retry itself — the feature would appear to work only on
  // the second attempt, which reads as flakiness rather than as ordering.
  useEffect(() => {
    // ⚠ DO NOT SKIP `isPlayable` PAGES. It used to short-circuit here on the reasoning that an
    // embed endpoint already frames, so a rule for it "buys nothing" — which ignored that the early
    // return happens AFTER the previous run's cleanup ran. Opening one video tore down framing for
    // the whole tab ("youtube stopped working… it just never loads"): worked once, then never,
    // which is the signature of STATE rather than a race.
    // DEFAULT OFF — see src/reader/liveFrameFlag.ts for why, and for what it does not fix.
    if (!liveFrameEnabled() || !framed || extState !== 'ready') { setFramingOn(false); return }
    // ⚠ AN EMBED NEEDS NO RULE, AND ASKING FOR ONE KILLED A PLAYING VIDEO. Peter, watching a cat
    // video: "youtube was working a minute ago." youtube-nocookie /embed/ sends no framing headers,
    // so the rule buys nothing there — but installing it bumps `frameKey`, which REMOUNTS the
    // iframe, which restarts the player under him.
    //
    // This skip existed before and I removed it, correctly at the time: back then the early return
    // sat above a cleanup that RELEASED the tab's rule, so skipping also tore down framing for
    // every other page. Now that teardown lives in its own effect below, the skip is inert rather
    // than destructive — it declines to install and removes nothing. Both facts had to be true
    // before this line was safe, which is why it is worth the paragraph.
    if (isPlayable(here)) { setFramingOn(false); return }
    const port = windowPort()
    if (!port) { setFramingOn(false); return }
    let live = true
    void allowFramingVia(port, here).then((ok) => {
      if (!live || !ok) return                 // a refusal is ordinary: the frame behaves as before
      setFramingOn((was) => {
        // ⚠ REMOUNT ONLY ON THE FIRST INSTALL OF THIS LIVE SESSION. `frameKey` exists so the rule
        // lands BEFORE the frame tries; bumping it on every navigation instead remounts an iframe
        // that has already begun loading the new URL, which is a second load racing the first.
        if (!was) setFrameKey((k) => k + 1)
        return true
      })
    }).catch(() => { /* likewise — never a thrown error in front of the writer */ })
    // ⚠ NO RELEASE HERE, AND THAT IS THE FIX FOR "a lot of things are never loading now".
    // This effect re-runs on every navigation, so releasing in its cleanup meant each new page
    // fired BOTH a release and an install — two independent async chains to the worker
    // (`releaseFraming` is fire-and-forget by design, `allowFramingVia` awaits a reply) with no
    // ordering guarantee between them. When the release landed second it removed the rule that had
    // just been installed, and the page never loaded. Intermittent, and worse the more the writer
    // clicked, which is exactly how it was reported.
    // Nothing needs releasing between pages anyway: the rule is per-tab and each install REPLACES
    // it. Teardown belongs to leaving live view, which is the effect below.
    return () => { live = false }
  }, [framed, here, extState])

  // Teardown, separated from installation ON PURPOSE — it must run when the writer LEAVES live view
  // or the panel unmounts, and NOT on every navigation within it. Depending only on `framed` is
  // what makes that true: `here` changing cannot trigger it.
  useEffect(() => {
    if (!framed) return
    const port = windowPort()
    return () => { setFramingOn(false); releaseFraming(port) }
  }, [framed])

  // Keep the ref in step. `ready` means the extension answered AND holds the <all_urls> grant, so
  // it is exactly the condition under which a framing rule can be installed.
  // ⚠ THIS MUST AGREE WITH THE INSTALL EFFECT OR SEARCH BREAKS. `canFrame` decides that a typed
  // query becomes the REAL duckduckgo.com opened in the live frame rather than the no-JS endpoint
  // read in the panel — so if it says yes while framing is disabled, every search routes to a page
  // we then refuse to show. Peter hit exactly that within a minute of the flag landing: "not
  // working", on a search, with the refusal card. `liveFrameEnabled()` is not optional here.
  useEffect(() => { canFrameRef.current = liveFrameEnabled() && extState === 'ready' }, [extState])

  // ⚠ READER-ONLY IS AN INVARIANT, NOT A DECISION TAKEN AT NAVIGATION TIME. `go()` applies
  // `mustUseReader` when the writer navigates — but the live/reader toggle is PERSISTED
  // (`inkwave:readerLive`), so a reload restores live view without going through `go()` at all.
  // Land on a reader-only address in that state and the panel shows the framing-refusal card for a
  // page it was never going to frame, with no way out but the toggle. Peter hit it twice in a row
  // on a search: "grr".
  //
  // It also has to be a live rule rather than a one-shot, because `canFrame` CHANGES underneath the
  // panel — the extension can be granted mid-session, and `liveFrameEnabled()` can be flipped — and
  // each change moves the answer for the page already on screen.
  useEffect(() => {
    if (framed && mustUseReader(here, canFrameRef.current)) setFramed(false)
  }, [here, framed, extState])

  // ── A READABLE DIAGNOSTIC, BECAUSE "still broken" IS NOT A STAGE ─────────────────────────────
  // Live view through the extension has FIVE places it can fail and they are indistinguishable
  // from the panel: no content script in this tab (the commonest — Chrome injects them on page
  // load, so a tab open before the install has no bridge), the extension present but not granted
  // <all_urls>, the worker missing declarativeNetRequest, the rule refused, or the site refusing in
  // its body afterwards. Each needs a different fix and they all look like one refusal message.
  // window.__iwReader reports the stage instead of making the writer describe a screenshot.
  useEffect(() => {
    ;(window as unknown as { __iwReader?: unknown }).__iwReader = {
      extension: extState,            // 'absent' | 'blocked' | 'ready'
      bridge: !!windowPort(),         // is a content script listening in THIS tab?
      liveMode: framed,
      framingInstalled: framingOn,    // did the worker actually install the rule?
      framingRefusedAnyway: frameRefused,
      here,
      via,                            // who fetched the article text: 'server' | 'extension'
    }
  }, [extState, framed, framingOn, frameRefused, here, via])

  // The offer, at the moment it would help. `openExtensionPopup` returns false when the browser
  // refuses — a real outcome, not a bug — so the instruction is shown either way and the button is
  // only ever a shortcut to it.
  const [grantHint, setGrantHint] = useState(false)
  const askForFetchPermission = () => {
    setGrantHint(true)
    const port = windowPort()
    if (port) void openExtensionPopup(port)
  }

  // ── "GET THE EXTENSION", AT THE WALL (Peter, 2026-08-30: "can we build a little 'download the
  // extension' prompt for whenever the user hits a link or tries to search etc. to something not
  // supported without the extension") ────────────────────────────────────────────────────────────
  // There are exactly THREE walls it removes, and the panel already knows which one it is standing
  // at: a site that refuses framing, a search our server is not served, and an article our server
  // cannot fetch. So the offer goes INSIDE each of those three cards rather than floating as a
  // banner — an offer that appears where the disappointment is, and nowhere else.
  //
  // ⚠ THREE RULES, AND EACH ONE IS THE DIFFERENCE BETWEEN AN OFFER AND A NAG:
  //  1. ONLY WHEN IT IS GENUINELY ABSENT. `extState` is 'absent' | 'blocked' | 'ready', and
  //     'blocked' means INSTALLED BUT NOT GRANTED — which already has its own correct affordance
  //     (askForFetchPermission + the printed instruction). Offering a download to someone who has
  //     it installed is telling them to install what they have.
  //  2. DISMISSIBLE AND REMEMBERED — the anti-nag clause the unsynced-work notice established:
  //     never again once waved away. Keyed per ORIGIN, not per document: whether you have a browser
  //     extension is a fact about your browser, not about the essay you are writing.
  //  3. NO DEAD "DOWNLOAD" BUTTON. It is in no store: it is built from the repo and loaded
  //     unpacked. A button labelled Download that opens instructions is the dead control this panel
  //     has already shipped twice, so the button says what it does — it shows the instructions.
  const [extOffer, setExtOffer] = useState(() => {
    try { return localStorage.getItem('inkwave:readerExtOffer') !== '0' } catch { return true }
  })
  const [extHow, setExtHow] = useState(false)
  const dismissExtOffer = () => {
    setExtOffer(false)
    try { localStorage.setItem('inkwave:readerExtOffer', '0') } catch { /* private */ }
  }
  /** The offer itself. Rendered inside a dead end, never on its own. */
  const extensionOffer = (): React.ReactNode => {
    if (extState !== 'absent' || !extOffer) return null
    return (
      <div style={{ maxWidth: 470, width: '100%', textAlign: 'left', borderRadius: 10,
        border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', background: `${INK}0a`,
        padding: '10px 12px', fontSize: '12.5px', lineHeight: 1.55, ['--iw-tap-x' as string]: '8px' }}>
        <div className="flex items-start gap-2">
          <span style={{ flex: 1 }}>
            {/* ⚠ WHAT IT BUYS, AND WHAT IT DOES NOT. The second sentence is not hedging: MEASURED,
                a framed page does not carry your session — SameSite=Lax is the default a cookie
                gets when it says nothing, and Lax and Strict are both dropped in a third-party
                frame. So a site you are signed in to renders signed out, and no header the
                extension removes can change that. Saying it here is the difference between a known
                limit and Inkwave looking broken the first time he tries it on a journal. */}
            <strong style={{ color: CHROME_FG }}>The Inkwave extension fixes this.</strong>{' '}
            It fetches sources from your own connection instead of Inkwave’s server, which is what
            makes web search work here and lets sites that refuse to be shown inside another page
            open live. It doesn’t sign you in to anything — a page in a panel never carries your
            browser’s session, so a site you’re logged into still shows as logged out.
          </span>
          <button type="button" onClick={dismissExtOffer} title="Don’t offer this again"
            aria-label="Don’t offer this again" className="iw-tap"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED_CHROME, fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
        </div>
        {/* NOT "Download" — there is nowhere to download it from. It is built from the Inkwave
            repository and loaded unpacked, so the only honest action is to show how. */}
        {!extHow ? (
          <button type="button" onClick={() => setExtHow(true)} data-iw-ext-how
            className="rounded-full px-3 py-1.5 iw-tap"
            style={{ marginTop: 8, border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: CHROME_FG, fontSize: '12px', background: 'transparent', cursor: 'pointer' }}>
            How to install it
          </button>
        ) : (
          <ol style={{ marginTop: 8, paddingLeft: 18, listStyle: 'decimal' }}>
            <li>Build it from the Inkwave repository: <code>pnpm ext:build</code></li>
            <li>Open <code>chrome://extensions</code> and turn on Developer mode</li>
            <li>Choose <strong>Load unpacked</strong> and pick <code>extension-src/.output/chrome-mv3</code></li>
            <li>It opens its own page on install — turn on <strong>Fetch pages for the reader</strong> there</li>
          </ol>
        )}
      </div>
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ⚠ ONE DOCK, ONE OCCUPANT (2026-08-28, Peter: "clicking a pdf when browser is open doesn't
  // replace it. They should seamlessly replace each other with the same page sizing etc"). Both
  // panels write the SAME four room variables (components/dockLayout.ts) — that is what makes their
  // placement identical — which also means two open at once fight over one strip and the second one
  // to write wins. So the reader stands down the moment a PDF is opened. It does NOT clear the room
  // on the way out: the PDF panel is about to claim the same geometry, and blanking it first is a
  // frame of the editor snapping wide and back, which is the opposite of seamless.
  useEffect(() => {
    const onPdf = () => { handingOverRef.current = true; onCloseRef.current() }
    window.addEventListener(OPEN_PDF_EVENT, onPdf)
    return () => window.removeEventListener(OPEN_PDF_EVENT, onPdf)
  }, [])

  // THE SELECTION. Read on pointerup inside the reader body only — a selection made in the writer's
  // own document must never be mistaken for one made in the source.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const read = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return }
      const range = s.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) { setSel(null); return }
      const text = s.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 2) { setSel(null); return }
      // ⚠ AN ARMED TOOL MARKS ON SELECT (Peter, 2026-08-28: "switching on highlight mode should
      // mean anything we highlight gets highlighted"). A mode that still made you press a button
      // afterwards was not a mode, it was a button with extra steps.
      if (toolRef.current === 'highlight' || toolRef.current === 'note') { markSelectionRef.current(toolRef.current); return }
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top })
    }
    const t = () => window.setTimeout(read, 0) // let the browser finish the selection first
    el.addEventListener('pointerup', t)
    el.addEventListener('keyup', t)
    return () => { el.removeEventListener('pointerup', t); el.removeEventListener('keyup', t) }
  }, [doc])

  // Blocks as plain text, for anchoring. `list` blocks join their items — a list is one block for
  // marking purposes, which is the same granularity the extractor produced.
  const blockTexts = useMemo(
    () => (doc?.blocks ?? []).map((b) => ('text' in b ? b.text : b.items.map((i) => i.map((r) => r.text).join('')).join('\n'))),
    [doc],
  )
  const located = useMemo(() => locateAll(marks, blockTexts), [marks, blockTexts])
  // THREE POPULATIONS, ONE ANCHORING RULE. They are split here rather than in marks.ts because the
  // difference is purely about WHERE each is drawn: ranges paint over the block's own text, points
  // are inserted at a seam inside it, boxes hang beneath it. All three came out of the same
  // `locateAll`, so a lost anchor is reported the same way whatever the tool was.
  const { byBlock, pointsByBlock, boxesByBlock } = useMemo(() => {
    const rangeM = new Map<number, Located[]>()
    const pointM = new Map<number, Located[]>()
    const boxM = new Map<number, Located[]>()
    for (const l of located.placed) {
      const m = l.kind === 'box' ? boxM : l.kind === 'text' ? pointM : rangeM
      const a = m.get(l.block) ?? []; a.push(l); m.set(l.block, a)
    }
    return { byBlock: rangeM, pointsByBlock: pointM, boxesByBlock: boxM }
  }, [located])

  const headings = useMemo(
    () => (doc?.blocks ?? []).filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading'),
    [doc],
  )

  const toolRef = useRef(tool); toolRef.current = tool
  const markSelectionRef = useRef<(k: MarkKind) => void>(() => {})

  // ⚠ REMEMBER WHERE YOU WERE WHEN SWITCHING MODES (Peter, 2026-08-28: "we also want the browser
  // to remember where we were on the page when we hit change between read mode and original mode").
  // Reader mode only, and that is not a shortcut — a live page is a cross-origin document, and the
  // browser will not let us read or set its scroll. What we CAN do is return you to your place in
  // the reader, which is the half that involves our own scroller.
  const readerScrollRef = useRef(new Map<string, number>())
  const [sectionNow, setSectionNow] = useState(0)
  const [readPct, setReadPct] = useState(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || framed) return
    let raf = 0
    const read = () => {
      raf = 0
      const range = Math.max(1, el.scrollHeight - el.clientHeight)
      setReadPct(Math.min(100, Math.round((el.scrollTop / range) * 100)))
      // The last heading whose top has passed the pane's upper third — the section you are IN.
      const mark = el.getBoundingClientRect().top + el.clientHeight * 0.33
      const hs = el.querySelectorAll('[id^="iw-rd-"]')
      let n = 0
      hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= mark) n = i })
      setSectionNow(n)
    }
    // ⚠ A SCROLL TO 0 BECAUSE THE ARTICLE VANISHED IS NOT THE READER GOING TO THE TOP — and until
    // 2026-08-30 the two were the same write. MEASURED by `prove:reader`'s new refresh cell: the
    // refresh button sets `doc` to null, the article is replaced by "reading…", the pane loses its
    // height, the BROWSER clamps scrollTop to 0 and fires a real scroll event — which landed here
    // and overwrote the remembered offset with 0 before anything could restore it. So refresh (and
    // any re-render that shrinks the pane) silently sent the writer back to the top. Same family as
    // this repo's other absence-vs-failure distinctions: the offset of a placeholder is not a
    // reading position, so it is not recorded as one.
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read)
      if (doc) readerScrollRef.current.set(here, el.scrollTop)
    }
    read()
    // Restore the place we left this article at, once it has its height. `Math.min` rather than a
    // refusal: landing as close as the article allows beats not moving at all, and before layout
    // the max is 0, so an early frame is a harmless no-op rather than a jump.
    const want = readerScrollRef.current.get(here)
    if (want && want > 8) requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight
      if (max > 8) el.scrollTop = Math.min(want, max)
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [doc, framed, here])

  const eraseMark = (id: string) => { if (tool === 'erase') writeMarks(marks.filter((m) => m.id !== id)) }

  // ⌘/Ctrl + wheel zooms the article (D3). A NATIVE listener, not React's `onWheel`: React registers
  // wheel passively at the root, so preventDefault there is silently ignored and the browser zooms
  // the whole app instead — the same trap PdfViewer records for its own zoom.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || framed) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      applyZoom(zoomRef.current * pdfZoomFactor(e.deltaY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [framed, doc])

  /** One shape for every header action — that is what "symmetric" means here. */
  const btn = (glyph: string, title: string, onPress: () => void, lit: boolean) => (
    <button type="button" title={title} aria-label={title} onClick={onPress} className="iw-tap"
      style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', fontSize: '13px', lineHeight: 1,
        border: `1px solid ${lit ? CHROME_FG : 'var(--iw-nightable-border, #d6cfe0)'}`,
        background: lit ? `${INK}14` : 'transparent', color: CHROME_FG }}>{glyph}</button>
  )

  /** below → side-right → side-left → below. Two controls' worth of state on one button. */
  const cycleDock = () => {
    if (orientation !== 'side') { setStoredOrient('side'); writeStoredOrientation('side'); setDockSide('right'); writeStoredDockSide('right'); return }
    if (dockSide === 'right') { setDockSide('left'); writeStoredDockSide('left'); return }
    setStoredOrient('bottom'); writeStoredOrientation('bottom')
  }

  /** The nearest heading ABOVE the block this text sits in — the section a reader would name. */
  const sectionFor = (text: string): string | null => {
    let bi = -1
    for (let i = 0; i < blockTexts.length; i++) if (blockTexts[i].includes(text)) { bi = i; break }
    if (bi < 0) return null
    const blocks = doc?.blocks ?? []
    for (let i = bi; i >= 0; i--) {
      const b = blocks[i]
      if (!b || b.kind !== 'heading' || !b.text.trim()) continue
      // ⚠ THE ARTICLE'S OWN TITLE IS NOT A SECTION (2026-08-29, found by the end-to-end probe, not
      // by Peter — the first one this session that way round). Text before the first real heading
      // has no section above it but DOES have the h1, so "cite §" offered the piece's own title as
      // the locator: "(Sider 2001, Identity Over Time)". Citing a work's title inside a citation of
      // that work says nothing. There is nothing honest to cite there, so nothing is offered.
      if (b.level <= 1) return null
      if (doc?.title && b.text.trim() === doc.title.trim()) return null
      return b.text
    }
    return null
  }
  const formatSection = (loc: { kind: string; value: string }) =>
    loc.kind === 'section' ? `§${loc.value}` : loc.kind === 'chapter' ? `ch. ${loc.value}` : `“${loc.value.slice(0, 24)}”`

  // ⚠ AN ACTION WITH NO FEEDBACK READS AS A DEAD BUTTON (Peter: "clicking the left option doesn't
  // do anything"). It DID do something — it wrote the quote onto the citation, out of sight in the
  // document behind the panel — which is indistinguishable from nothing at all.
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2200) }

  const citeHeading = (text: string) => { onCite?.(locatorForHeading(text)); setSel(null) }

  /** Turn the live selection into a mark. The BLOCK is found by the selected text, not by walking
   *  the DOM — the same identification the mark is stored under, so creating and re-finding can
   *  never disagree about what a mark covers. */
  const markSelection = (kind: MarkKind) => {
    const s2 = window.getSelection()
    if (!s2 || s2.isCollapsed) return
    const text = s2.toString().replace(/\s+/g, ' ').trim()
    if (text.length < 2) return
    let block = -1, start = -1
    for (let i = 0; i < blockTexts.length; i++) {
      const at = blockTexts[i].indexOf(text)
      if (at >= 0) { block = i; start = at; break }
    }
    if (block < 0) return  // the selection spans blocks — refuse rather than mark the wrong words
    const m: ReaderMark = {
      id: uuidv4(), kind, color: markColorRef.current, block, start, text,
      body: kind === 'note' ? '' : undefined, createdAt: new Date().toISOString(),
    }
    writeMarks([...marks, m])
    s2.removeAllRanges()
    setSel(null)
  }
  markSelectionRef.current = markSelection

  // ── POINT TOOLS: coloured text at the cursor (D1) and a textbox (D2) ─────────────────────────
  // Both are placed by CLICK rather than by selection, which is what makes them different tools
  // rather than two more things the highlight gesture does. Both resolve their anchor the same way
  // `markSelection` does — find the remembered TEXT in `blockTexts` — so creating a mark and
  // re-finding it on the next visit can never disagree about where it belongs.

  /** Which block a DOM node sits in, from the index the renderer stamped on it. */
  const blockIndexOf = (node: Node | null): number => {
    const el = (node instanceof Element ? node : node?.parentElement) ?? null
    const host = el?.closest?.('[data-iw-blk]') as HTMLElement | null
    const n = host ? Number(host.dataset.iwBlk) : NaN
    return Number.isInteger(n) ? n : -1
  }

  /** Resolve an anchor phrase to (block, start). Prefers the block the caret was actually in, so
   *  a phrase that also occurs elsewhere cannot pull the mark across the article. */
  const resolveAnchor = (phrase: string, preferBlock: number): { block: number; start: number } | null => {
    if (preferBlock >= 0) {
      const at = blockTexts[preferBlock]?.indexOf(phrase) ?? -1
      if (at >= 0) return { block: preferBlock, start: at }
    }
    for (let i = 0; i < blockTexts.length; i++) {
      const at = blockTexts[i].indexOf(phrase)
      if (at >= 0) return { block: i, start: at }
    }
    return null
  }

  /** Open the composer at the caret the click just placed. */
  const openComposerAtCaret = (x: number, y: number) => {
    const s = window.getSelection()
    const node = s?.focusNode
    // The caret must be in real article TEXT. Landing on an element (a gap between blocks, a
    // rendered formula's internals) gives nothing to anchor to, so we decline rather than pick a
    // nearby position that the reader did not choose.
    if (!node || node.nodeType !== Node.TEXT_NODE || !bodyRef.current?.contains(node)) {
      flash('Click on the words you want to write next to'); return
    }
    const a = anchorSlice(node.textContent ?? '', s?.focusOffset ?? 0)
    if (!a) { flash('Click on the words you want to write next to'); return }
    // KaTeX output and other generated text is not in `blockTexts` at all, so this legitimately
    // fails there — and failing is right: a mark whose anchor is not in the source text could never
    // be re-found on the next visit.
    const at = resolveAnchor(a.phrase, blockIndexOf(node))
    if (!at) { flash('That spot can’t be written on — try the prose beside it'); return }
    // ⚠ NOT INSIDE A LIST. A list block's plain text joins its items with newlines, but each item
    // renders its own runs — so an offset into the block does not address a position inside any one
    // bullet, and the insertion would appear in the wrong one. Refusing is the only honest answer
    // available until list items are blocks in their own right. (A TEXTBOX on a list is fine: it
    // hangs under the whole list, which is exactly what it claims.)
    if (doc?.blocks[at.block]?.kind === 'list') { flash('Coloured text can’t go inside a list yet — try a textbox'); return }
    setComposer({ x, y, block: at.block, start: at.start, text: a.phrase, before: a.before, value: '' })
  }

  const commitComposer = () => {
    if (!composer) return
    const body = composer.value.trim()
    if (!body) { setComposer(null); return }
    writeMarks([...marks, {
      id: uuidv4(), kind: 'text', color: textColorRef.current, block: composer.block,
      start: composer.start, text: composer.text, before: composer.before, body,
      createdAt: new Date().toISOString(),
    }])
    setComposer(null)
    setTool(null)   // one placement per arming: a click-to-place tool left armed writes on the next stray tap
  }

  /** Drop a textbox on the paragraph that was clicked. */
  const placeBoxAt = (target: EventTarget | null) => {
    const bi = blockIndexOf(target as Node | null)
    // ⚠ A BOX HAS NO PLACE IN A REFLOWED COLUMN except relative to its paragraph. Page coordinates
    // are meaningless here: the article is re-fetched, re-wrapped at the panel's width and re-typeset
    // at whatever zoom the reader has chosen, so a box at (x, y) would point at different words every
    // visit. It anchors to the paragraph's OPENING and hangs beneath it.
    const t = bi >= 0 ? (blockTexts[bi] ?? '') : ''
    const phrase = t.slice(0, BOX_ANCHOR_LEN)
    if (phrase.trim().length < 3) { flash('Click on a paragraph to put a textbox under it'); return }
    const id = uuidv4()
    writeMarks([...marks, {
      id, kind: 'box', color: boxColorRef.current, block: bi, start: 0, text: phrase, body: '',
      createdAt: new Date().toISOString(),
    }])
    setEditingBox(id)
    setTool(null)
  }

  const setBoxBody = (id: string, body: string) =>
    writeMarks(marks.map((m) => (m.id === id ? { ...m, body } : m)))

  /** Every tool that places by CLICK routes through here, in the capture phase — so a click meant
   *  to drop a note can never also follow the link it landed on. */
  const onBodyClickCapture = (e: React.MouseEvent) => {
    const t = toolRef.current
    if (t !== 'text' && t !== 'box') return
    e.preventDefault()
    e.stopPropagation()
    if (t === 'box') placeBoxAt(e.target)
    // The caret is placed by the browser during the pointer-down default action, which we have NOT
    // suppressed — so by the time this click fires the selection is already where the reader aimed.
    else openComposerAtCaret(e.clientX, e.clientY)
  }

  return createPortal(
    // ⚠ THE DIVIDING LINE (Peter, 2026-08-30: "there's a dividing line between"). `dockPanelPos`
    // already draws it on the edge facing the editor — it just drew it in a 20%-alpha DARK purple
    // that vanished into the night panel. The colour is a token now (see dockLayout.ts), and
    // `iw-dock-panel` is what lets that token beat `.iw-nightable`'s !important border-color.
    // Do NOT add a competing border here: dockPanelPos is spread AFTER this style object, so an
    // inline `border` would be half-overridden per edge and the two rules would drift.
    <div className="iw-nightable iw-touch-guard iw-dock-panel flex flex-col bg-white"
      style={{ position: 'fixed', zIndex: 80, ...dockPanelPos({ orientation, dockSide, width, height }) }}
      onMouseDown={(e) => e.stopPropagation()}>
      {/* Resize handle on the edge facing the editor — the same rule and the same 10px grab strip
          the PDF panel uses (components/dockLayout.ts). */}
      {orientation !== 'top' && (
        <div title="Drag to resize"
          onPointerDown={(e) => {
            e.preventDefault()
            const axis = orientation === 'side' ? 'x' : 'y'
            drag.current = { axis, start: axis === 'x' ? e.clientX : e.clientY, size: axis === 'x' ? width : height }
            setDragging(true)
          }}
          style={{ position: 'absolute', zIndex: 2, background: dragging ? `${INK}22` : 'transparent', ...dockHandlePos(orientation, dockSide) }} />
      )}
      <div className="flex flex-col flex-1 min-h-0">

        {/* `--iw-tap-x` = this row's own gap (gap-2 → 8px): each `.iw-tap` control claims half of it
            per side, so neighbours never contend. See the rule's header in index.css. */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200"
          style={{ fontSize: '13px', ['--iw-tap-x' as string]: '8px' }}>
          {/* ⚠ THE ENABLED ARROW WAS THE LITERAL #5c2d8a ON THE NIGHT HEADER — 1.13:1, invisible,
              and no gate ever saw it: with a one-entry history BOTH arrows are disabled, and a
              disabled control is exempt from contrast auditing by WCAG 1.4.3. It only appears once
              the reader has actually navigated, which a probe has to do on purpose. */}
          <button type="button" title="Back" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="iw-tap"
            style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? CHROME_DIM : CHROME_FG, fontSize: '15px', padding: '0 2px' }}>←</button>
          <button type="button" title="Forward" disabled={idx >= stack.length - 1} onClick={() => setIdx((i) => Math.min(stack.length - 1, i + 1))}
            className="iw-tap"
            style={{ background: 'transparent', border: 'none', cursor: idx >= stack.length - 1 ? 'default' : 'pointer', color: idx >= stack.length - 1 ? CHROME_DIM : CHROME_FG, fontSize: '15px', padding: '0 2px' }}>→</button>
          {/* REFRESH (Peter, 2026-08-30). Ordinary browser furniture, and its absence is felt
              exactly when a page half-loads — which is when he asked for it.
              ⚠ THE TWO MODES RELOAD BY DIFFERENT MECHANISMS AND IT REUSES BOTH RATHER THAN ADDING A
              THIRD. Live: bump `frameKey`, which REMOUNTS the iframe — assigning the same `src` does
              not reliably re-fetch, and `frameKey` already exists for exactly this (it is how the
              framing rule gets to land before the frame tries). Reader: bump `reloadKey`, the same
              re-fetch the extension-permission grant uses.
              ⚠ AND THEY KEEP THE READER'S PLACE ON PURPOSE, WHILE LIVE RESETS. Reader mode is the
              same article re-fetched, so losing your place would be a punishment for a slow network:
              `readerScrollRef` is keyed by URL and the restore effect re-runs when the new doc
              arrives, so the position comes back for free. A live reload is a fresh navigation of a
              document we do not own — where it lands is the site's decision, not ours to fake. */}
          <button type="button" title="Reload this page" aria-label="Reload this page" data-iw-reader-refresh
            onClick={() => { if (framed) setFrameKey((k) => k + 1); else setReloadKey((k) => k + 1) }}
            className="iw-tap"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: CHROME_FG, fontSize: '14px', padding: '0 2px' }}>⟳</button>
          {/* The title is the FIRST thing to go on a phone (Peter's iPhone 8 is 375px): four header
              actions, a back/forward pair and a usable address bar do not fit beside it, and the
              address bar already says where you are. Desktop keeps it. */}
          {!isPhone && (
          <span style={{ color: CHROME_FG, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc?.title || title || hostOf(here)}
          </span>
          )}
          {/* ADDRESS BAR (Peter, 2026-08-28: "we should be able to search the web by url"). It is
              an address bar in the ordinary sense: a URL goes there, a bare host gets https://, and
              words with no dot go to GOOGLE (Peter named it) — a reader who types
              words expects to find something, not an error. */}
          <input value={addr} onChange={(e) => setAddr(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const next = addressToUrl(addr, canFrameRef.current)
              if (next) { go(next); (e.currentTarget as HTMLInputElement).blur() }
            }}
            placeholder="address or search"
            title={framed
              ? 'The page this panel loaded. Links you follow inside the live page are the site’s own — Inkwave can’t see where they go.'
              : 'Type an address, or words to search'}
            spellCheck={false}
            className="iw-nightable"
            style={{ flex: 1, minWidth: 80, height: isPhone ? TOUCH_FIELD_H : 22, fontSize: '11px', padding: '0 7px', borderRadius: 999,
              border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', background: 'transparent',
              color: 'inherit', outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
          {/* FOUR SYMMETRIC BUTTONS (Peter, 2026-08-28: "this could be reduced down to a button.
              Four symmetric buttons"). "open in a tab ↗" was a wide underlined link sitting among
              icons; it is an action like the others and now looks like one. The dock button CYCLES
              (below → right → left) so the two separate dock controls collapse into one, which is
              what makes four the right number rather than a number things were squeezed into. */}
          {/* ⚠ THE TOGGLE NAMES THE PAGE IT WILL SHOW (Peter, 2026-08-28: "when I click the house
              button at the top it goes to wikipedia.com not the current page"). Following a link
              INSIDE the live frame is a cross-origin navigation: the browser tells us nothing about
              it — not the URL, not that it happened — so switching to Reader can only go back to the
              page we loaded. That is a boundary, not a bug we can close, and the tooltip says so
              rather than letting the button look broken. */}
          {btn(framed ? '⌂' : '⛶',
            framed ? `Reader view — shows ${hostOf(here)}${new URL(here).pathname.length > 1 ? new URL(here).pathname : ''} (the page this panel loaded; links you followed inside the live page aren’t visible to Inkwave)` : 'Live page — the real site, with its own navigation',
            () => setFramed((f) => !f), framed)}
          {btn('▤', `Dock: ${orientation === 'side' ? (dockSide === 'left' ? 'left' : 'right') : 'below'} — click to move`, cycleDock, false)}
          {btn('↗', 'Open in a browser tab', () => window.open(here, '_blank', 'noopener,noreferrer'), false)}
          {btn('✕', 'Close (Esc)', onClose, false)}
        </div>

        <div className="flex flex-1 min-h-0" style={{ position: 'relative' }}>
          {/* Section list — the fastest way to cite a section is to not have to find it first. */}
          {/* ☰ SITS OVER THE NAVIGATOR (Peter, 2026-08-28: "this button needs to be over the
              navigator"), not adrift in the header — a control that hides a column belongs at the
              top of that column, where what it acts on is unambiguous. When the column is hidden it
              becomes a thin re-open tab in its place, so the action stays reversible in situ. */}
          {/* A BUTTON, NOT A COLUMN (Peter, 2026-08-28: "move this little bar thing up to the top
              and make it not a whole column just a little button at the top"). A full-height strip
              to re-open a list is a piece of furniture standing in for a control; it also stole
              22px of reading width down the entire article for a click you make once. */}
          {!framed && headings.length > 1 && !showNav && (
            <button type="button" title="Show the section list" onClick={toggleNav} className="iw-tap"
              style={{ position: 'absolute', left: 6, top: 6, zIndex: 5, width: 24, height: 24,
                borderRadius: 6, border: `1px solid ${EDGE}`,
                background: CTL, color: INKP, cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}>☰</button>
          )}
          {!framed && showNav && headings.length > 1 && (
            <nav className="hidden md:flex flex-col overflow-hidden border-r border-stone-200" style={{ width: 220, fontSize: '12px' }}>
              {/* ☰ at the RIGHT END of its own row (Peter, 2026-08-28: "put this button over to the
                  right of the column … the cell that it's in"). It closes the column leftward, so
                  it belongs on the edge it collapses toward — and it sits where the re-open tab
                  will appear, so the control does not jump across the panel when you use it. */}
              <div className="flex items-center gap-1 px-2 py-1 border-b border-stone-100" style={{ flexShrink: 0 }}>
                <span className="text-stone-500" style={{ fontSize: '11px' }}>Sections</span>
                <button type="button" title="Hide the section list" onClick={toggleNav}
                  className="ml-auto iw-tap"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: INKC, fontSize: '13px', padding: '0 2px' }}>☰</button>
              </div>
              <div className="overflow-y-auto py-1">
              {headings.map((h, hi) => (
                <button key={h.id} type="button"
                  onClick={() => document.getElementById(`iw-rd-${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full text-left px-3 py-1 hover:bg-stone-50 flex items-center gap-1 group"
                  // WHERE YOU ARE (Peter, 2026-08-28: "this lhs panel also needs to highlight where
                  // we're currently at"). Driven by the same reading position the § n/x readout
                  // uses, so the list and the counter can never disagree.
                  style={{ paddingLeft: 8 + Math.min(3, Math.max(0, h.level - 1)) * 10,
                    color: hi === sectionNow ? INKC : MUTED_CHROME,
                    fontWeight: hi === sectionNow ? 600 : 400,
                    background: hi === sectionNow ? `${INK}12` : undefined,
                    borderLeft: `2px solid ${hi === sectionNow ? INKC : 'transparent'}` }}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{h.text}</span>
                  {onCite && h.level > 1 && h.text.trim() !== (doc?.title ?? '').trim() && (
                    <span role="button" title={`Cite this section`}
                      onClick={(e) => { e.stopPropagation(); citeHeading(h.text) }}
                      className="opacity-0 group-hover:opacity-100 px-1 flex-shrink-0"
                      style={{ color: INKC, fontWeight: 700 }}>§</span>
                  )}
                </button>
              ))}
              </div>
            </nav>
          )}

          {/* ⚠ NO PADDING (AND NO SCROLLER) IN LIVE MODE (2026-08-28, Peter: "nevertheless it has
              this weird white space around it"). The reading column's px-8/py-6 is right for OUR
              typography and wrong for a real web page, which brings its own margins and its own
              scrollbar — so the site rendered inside a cream frame with a second scroller around
              it. The iframe fills the pane edge to edge and scrolls itself. */}
          <div ref={bodyRef} data-iw-selectable=""
            className={`flex-1 min-w-0 ${framed ? 'overflow-hidden' : 'iw-reader-page overflow-y-auto px-8 py-6'}`}
            // EVERY TOOL CHANGES THE CURSOR (Peter: "each button needs to change the cursor"). An
            // armed mode you cannot see is a mode you will forget you are in.
            // ⚠ THE ATTRIBUTE IS ONLY HALF OF IT — it was written here for months with NOTHING
            // reading it, which is a mechanism with no surface: indistinguishable, from the writer's
            // chair, from the feature never having been built. The rules live in index.css under
            // `[data-iw-tool]`; if you add a tool, add its cursor in the same commit.
            data-iw-tool={tool ?? undefined}
            onClickCapture={framed ? undefined : onBodyClickCapture}
            // ⚠ NO `color` HERE. The article's ink is `.iw-reader-page`'s (index.css), because it
            // must survive night mode: an inline colour on this div was the whole bug — nothing
            // overrode it, so night rendered near-black prose on the dolphin-grey panel. Headings and
            // quotes below inherit for the same reason.
            style={framed ? undefined : {
              fontFamily: font, fontSize: `${Math.round(READER_BASE_PX * zoom)}px`,
              lineHeight: leading,
            }}>
            {/* ⚠ A SEARCH THAT COULD NOT RUN SAYS WHY (2026-08-28). MEASURED from the deployed
                function, not from a laptop: DuckDuckGo, Mojeek and the public SearX instances all
                refuse or captcha requests from a datacenter IP, while ordinary sites (SEP,
                Wikipedia) are served normally. My earlier verification ran from Peter's own machine
                and could not see this — the same class of error as testing a local build and calling
                the deploy healthy. Search worked in my terminal and never once worked in production.
                Wikipedia's search DOES serve us, so it is offered as the one that works here; the
                writer's own browser is not blocked by anyone, so a tab always works. */}
            {/* ⚠ INKWAVE IN INKWAVE — REFUSED, AND SAID PLAINLY (2026-08-30, Peter loaded
                iwzero.me here and got Chrome's broken-page icon). The reason he saw it is that the
                app sends X-Frame-Options: DENY — but the extension STRIPS that, so this is on its
                way to working, and working is the failure. See `isInkwaveItself` for the mechanism.
                It deliberately does NOT say "this site refuses to be framed": that sentence is
                false about our own app and would send the next reader hunting a header. */}
            {selfOpen && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-8" style={{ fontSize: '14px', color: 'var(--iw-pill-fg, #57534e)' }}>
                <div style={{ color: framed ? CHROME_FG : INKP, fontSize: '15px' }}>Inkwave can’t open Inkwave in its own panel.</div>
                <div style={{ maxWidth: 470, lineHeight: 1.55 }}>
                  The copy inside would be a second, complete editor — and it would claim the same
                  document as this one, so the two would compete over the same file. Your work is in
                  the window behind this panel already.
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose}
                    className="rounded-full px-3 py-1.5" style={{ border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: framed ? CHROME_FG : INKP, fontSize: '13px' }}>
                    Close this panel
                  </button>
                  <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                    style={{ background: OPEN_TAB_FILL, fontSize: '13px' }}>Open it in a tab ↗</a>
                </div>
              </div>
            )}
            {!selfOpen && error && !framed && isSearch(here) && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-8" style={{ fontSize: '14px', color: 'var(--iw-pill-fg, #57534e)' }}>
                <div style={{ color: CHROME_FG, fontSize: '15px' }}>Search engines don’t answer Inkwave’s server.</div>
                {/* ⚠ THE REMEDY IS NAMED, AND IT DEPENDS ON WHAT THE WRITER ALREADY HAS. The
                    extension fetches from their own address, which is the whole reason a search
                    engine refuses us and serves them — so where it is installed-but-unpermitted the
                    fix is one click and this says so; where it is absent, saying "install the
                    extension" is the honest answer rather than a shrug toward a browser tab. */}
                <div style={{ maxWidth: 470, lineHeight: 1.55 }}>
                  They serve people, not data centres, so the request is refused before any results
                  exist. Your own browser isn’t blocked — opening the search in a tab always works.
                  {extState === 'blocked'
                    ? ' The Inkwave extension can fetch it from your own connection instead, but hasn’t been given permission yet.'
                    : ''}
                </div>
                {/* WALL 1 of 3 — a search our server is not served. */}
                {extensionOffer()}
                <div className="flex gap-2 flex-wrap justify-center">
                  {extState === 'blocked' && (
                    <button type="button" onClick={askForFetchPermission}
                      className="rounded-full px-3 py-1.5" style={{ border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: CHROME_FG, fontSize: '13px' }}>
                      Use my own connection
                    </button>
                  )}
                  <button type="button" onClick={() => go(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(queryOf(here))}`)}
                    className="rounded-full px-3 py-1.5" style={{ border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: CHROME_FG, fontSize: '13px' }}>
                    Search Wikipedia here
                  </button>
                  <a href={`https://duckduckgo.com/?q=${encodeURIComponent(queryOf(here))}`} target="_blank" rel="noreferrer noopener"
                    className="rounded-full px-3 py-1.5 text-white" style={{ background: OPEN_TAB_FILL, fontSize: '13px' }}>
                    Search the web in a tab ↗
                  </a>
                </div>
              </div>
            )}
            {!selfOpen && error && !framed && !isSearch(here) && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center" style={{ fontSize: '14px', color: 'var(--iw-pill-fg, #57534e)' }}>
                <div style={{ color: CHROME_FG, fontSize: '15px' }}>{error}</div>
                {/* WALL 2 of 3 — an article our server cannot fetch at all. */}
                <div className="px-8" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>{extensionOffer()}</div>
                {!likelyRefusesFraming(here) && (
                  <button type="button" onClick={() => setFramed(true)}
                    className="rounded-full px-3 py-1.5" style={{ border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: CHROME_FG, fontSize: '13px' }}>
                    Try showing the live page instead
                  </button>
                )}
                <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                  style={{ background: OPEN_TAB_FILL, fontSize: '13px' }}>Open it in a tab ↗</a>
              </div>
            )}
            {!selfOpen && !error && !doc && !framed && (
              <div className="flex items-center justify-center h-full" style={{ color: MUTED_PAPER, fontSize: '13px' }}>reading…</div>
            )}
            {!selfOpen && framed && frameRefused && (
              // ⚠ SAY IT, DON'T SHOW CHROME'S GREY FACE (2026-08-28, Peter: "it's not working for
              // this abc website" — iview.abc.net.au sends X-Frame-Options and the panel showed the
              // browser's "refused to connect" error, which reads as OUR bug). A refused frame
              // fires no error event, so the detector is a deadline; generous, because a slow site
              // called "refused" would be the worse lie.
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-8" style={{ fontSize: '14px', color: 'var(--iw-pill-fg, #57534e)' }}>
                <div style={{ color: CHROME_FG, fontSize: '15px' }}>{hostOf(here)} can’t be shown in its original form here.</div>
                <div style={{ maxWidth: 470, lineHeight: 1.55 }}>
                  Some sites send a header telling browsers not to display them inside another page. It’s
                  what stops a page wrapping your bank in a disguise, so nothing in Inkwave can override
                  it. Reader view usually still works — it fetches the article text and shows it here,
                  where you can highlight and cite it.
                </div>
                {/* WALL 3 of 3 — a site that refuses framing. The extension strips those headers
                    before the browser reads them, which is the one thing that opens this page live;
                    the copy above still stands, because nothing in the PAGE can override it. */}
                {extensionOffer()}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFramed(false)}
                    className="rounded-full px-3 py-1.5" style={{ border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.33))', color: CHROME_FG, fontSize: '13px' }}>
                    Read it here instead
                  </button>
                  <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                    style={{ background: OPEN_TAB_FILL, fontSize: '13px' }}>Open in a tab ↗</a>
                </div>
              </div>
            )}
            {!selfOpen && framed && !frameRefused && (
              // Live page: readable, but the browser keeps its text out of our reach — so the
              // selection actions are absent here rather than present and silently inert.
              // ⚠ A REAL HORIZONTAL SCROLLER, AND THAT IS THE WHOLE PAN MECHANISM. MEASURED before
              // it was built: a two-finger horizontal gesture over a cross-origin frame CHAINS out
              // of it into the nearest scrollable ancestor (360px in six notches) while our own
              // wheel listener is called ZERO times. So the browser pans this for free the moment
              // the host can scroll — and a JS handler here would be a mechanism with no surface,
              // which this repo has shipped before and had to go looking for.
              // Vertical stays HIDDEN on purpose: the frame is sized so its painted height is
              // exactly the host's, so the site keeps its own vertical scrolling and the reader
              // never meets a second scrollbar wrapped around the first.
              <div ref={frameHostRef}
                style={{ width: '100%', height: '100%', background: CTL,
                  overflowX: frameGeom.pannable ? 'auto' : 'hidden', overflowY: 'hidden' }}>
                {/* A transform does not change layout, so the scrollable extent has to be declared:
                    this spacer is the PAINTED size and the frame is drawn inside it. */}
                <div style={{ width: frameGeom.paintedW, height: frameGeom.paintedH }}>
                <iframe key={frameKey} src={embeddableUrl(here)} title={doc?.title || here}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
                  // NO referrerPolicy override: many image CDNs use the referer for hotlink
                  // protection, and stripping it is a plausible cause of the missing pictures Peter
                  // saw. The default (strict-origin-when-cross-origin) sends the origin only —
                  // enough for those checks, and it leaks no path.
                  style={{ display: 'block', border: 'none', background: CTL,
                    width: frameGeom.w, height: frameGeom.h,
                    transform: frameGeom.scale === 1 ? undefined : `scale(${frameGeom.scale})`,
                    transformOrigin: '0 0' }} />
                </div>
              </div>
            )}
            {!selfOpen && doc && !framed && doc.blocks.map((b, i) => {
              // `data-iw-blk` is how a CLICK finds its block. The point tools resolve their anchor
              // by TEXT like every other mark, but they consult the clicked block FIRST, so a
              // phrase that also occurs elsewhere in the article cannot drag the mark across it.
              const blk = { 'data-iw-blk': i }
              const pts = pointsByBlock.get(i)
              // Boxes hang under their block, outside it — a note inside a <p> would be inside the
              // sentence for selection and for copying.
              const boxes = (boxesByBlock.get(i) ?? []).map((bx) => (
                <BoxCard key={bx.id} mark={bx} editing={editingBox === bx.id}
                  onOpen={() => { if (toolRef.current === 'erase') eraseMark(bx.id); else setEditingBox(bx.id) }}
                  onChange={(v) => setBoxBody(bx.id, v)}
                  // An empty box left behind is litter, not a note (the PDF's own rule: "empty
                  // textboxes/comments need to delete").
                  onDone={() => { setEditingBox(null); if (!(bx.body ?? '').trim()) writeMarks(marks.filter((m) => m.id !== bx.id)) }}
                  onDelete={() => { setEditingBox(null); writeMarks(marks.filter((m) => m.id !== bx.id)) }} />
              ))
              const wrap = (node: React.ReactNode) =>
                boxes.length ? <Fragment key={i}>{node}{boxes}</Fragment> : node

              if (b.kind === 'heading') {
                const Tag = (`h${Math.min(4, Math.max(1, b.level))}`) as 'h1'
                return wrap(
                  <Tag key={i} id={`iw-rd-${b.id}`} className="group" {...blk}
                    style={{ fontSize: b.level <= 1 ? '1.5em' : b.level === 2 ? '1.22em' : '1.06em', fontWeight: 600, margin: '1.4em 0 0.5em', color: 'inherit' }}>
                    <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} points={pts} onEraseMark={eraseMark} />
                    {/* No "cite §" on the article's own TITLE — citing a work's title inside a
                        citation of that work says nothing. Same rule as sectionFor. */}
                    {onCite && b.level > 1 && b.text.trim() !== (doc?.title ?? '').trim() && (
                      <button type="button" title="Cite this section" onClick={() => citeHeading(b.text)}
                        className="opacity-0 group-hover:opacity-100"
                        // ⚠ NOT `.iw-tap` — this button sits INSIDE the prose. A 44px hit zone
                        // around it would reach over the lines above and below and take taps away
                        // from the article's own text, which must stay selectable (that selection
                        // is the entire reason the page is fetched rather than framed). So it grows
                        // for real, in the space a heading's line box already has.
                        style={{ marginLeft: '0.5em', fontSize: '0.6em', color: INKP, border: `1px solid ${EDGE}`, borderRadius: 6, padding: isPhone ? '9px 10px' : '2px 7px', background: 'transparent', cursor: 'pointer', verticalAlign: 'middle' }}>
                        cite §
                      </button>
                    )}
                  </Tag>,
                )
              }
              if (b.kind === 'list') {
                const L = b.ordered ? 'ol' : 'ul'
                // ⚠ NO `points` HERE, DELIBERATELY. A list block's plain text is its items joined by
                // newlines, but each <li> renders its own runs — so a plain-text offset does not
                // address a position inside any one item, and an insertion would be drawn in the
                // wrong bullet. openComposerAtCaret refuses on lists for the same reason; a mark
                // that renders somewhere other than where it was made is worse than one refused.
                return wrap(
                  <L key={i} {...blk} style={{ margin: '0.7em 0 0.7em 1.4em', listStyle: b.ordered ? 'decimal' : 'disc' }}>
                    {b.items.map((it, j) => <li key={j} style={{ margin: '0.25em 0' }}><Runs onNavigate={go} runs={it} /></li>)}
                  </L>,
                )
              }
              if (b.kind === 'quote') {
                return wrap(
                  <blockquote key={i} {...blk} style={{ margin: '0.9em 0', paddingLeft: '1em', borderLeft: `3px solid ${HAIR}`, opacity: 0.85 }}>
                    <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} points={pts} onEraseMark={eraseMark} />
                  </blockquote>,
                )
              }
              if (b.kind === 'code') {
                return wrap(
                  <pre key={i} {...blk} style={{ margin: '0.9em 0', padding: '0.7em', background: '#00000008', borderRadius: 6, overflowX: 'auto', fontSize: '0.88em' }}>
                    <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} points={pts} onEraseMark={eraseMark} />
                  </pre>,
                )
              }
              return wrap(
                <p key={i} {...blk} style={{ margin: '0.85em 0' }}>
                  <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} points={pts} onEraseMark={eraseMark} />
                </p>,
              )
            })}
          </div>
        </div>

        {/* ── THE COLOURED-TEXT COMPOSER (D1) ──────────────────────────────────────────────────
            Peter: "an input text which allows us to input coloured text at the cursor". It opens AT
            the click, because that is where the words will land — a panel at the bottom of the
            screen would make you look away from the place you were writing about. The ink swatches
            live in it rather than under a hold-to-open palette: the colour IS the note here (it is
            all you can see of it later), so choosing one must not be a hidden gesture. */}
        {composer && !framed && (
          <div ref={composerBoxRef} className="iw-nightable fixed z-[402] flex items-center gap-1.5 bg-white rounded-full shadow-lg px-2 py-1.5"
            style={{ left: composer.x, top: Math.max(8, composer.y - 46), transform: 'translateX(-50%)',
              maxWidth: 'calc(100vw - 16px)',
              border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', fontSize: '12px', ['--iw-tap-x' as string]: '6px' }}>
            {TEXT_COLORS.map((c) => (
              <button key={c} type="button" title="Ink" className="iw-tap"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setTextColor(c); textColorRef.current = c }}
                style={{ width: 16, height: 16, borderRadius: '50%', background: readerInk(c), cursor: 'pointer',
                  flexShrink: 0, border: textColor === c ? `2px solid ${INKC}` : '1px solid rgba(0,0,0,0.2)' }} />
            ))}
            <input autoFocus value={composer.value} placeholder="your words…"
              onChange={(e) => setComposer((c) => (c ? { ...c, value: e.target.value } : c))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitComposer() }
                // Esc must not reach the panel's own handler, which would close the whole reader —
                // cancelling a half-typed note is not a request to shut the source.
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setComposer(null) }
              }}
              className="iw-nightable"
              style={{ width: 190, height: isPhone ? TOUCH_FIELD_H : 22, fontSize: '12px', padding: '0 8px', borderRadius: 999,
                border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', background: 'transparent',
                color: readerInk(textColor), fontWeight: 600, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
            <button type="button" title="Write it in" onMouseDown={(e) => e.preventDefault()} onClick={commitComposer}
              className="rounded-full px-2 py-0.5 iw-tap" style={{ color: INKC, background: 'transparent', border: 'none', cursor: 'pointer' }}>↵</button>
            <button type="button" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => setComposer(null)}
              className="iw-tap"
              style={{ color: 'var(--iw-pill-fg, #78716c)', background: 'transparent', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Floating actions over a selection — the whole reason the page is fetched rather than framed. */}
        {sel && !framed && (onCite || onQuote) && (
          <div ref={selBoxRef} className="iw-nightable fixed z-[401] flex items-center gap-1 bg-white rounded-full shadow-lg px-1.5 py-1"
            style={{ left: sel.x, top: Math.max(8, sel.y - 42), transform: 'translateX(-50%)',
              maxWidth: 'calc(100vw - 16px)', border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', fontSize: '12px', ['--iw-tap-x' as string]: '4px' }}
            onMouseDown={(e) => e.preventDefault()}>
            {/* THE SAME COLOURED DOTS AS THE PDF (Peter: "highlighting text without any mode on
                should put up the coloured dots and link to citation panel"). One gesture, one
                vocabulary, in both readers — a dot highlights in that colour immediately. */}
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" title="Highlight" className="iw-tap"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setMarkColor(c); markColorRef.current = c; markSelection('highlight') }}
                style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', flexShrink: 0 }} />
            ))}
            <span style={{ width: 1, height: 16, background: 'var(--iw-nightable-border, rgba(92,45,138,0.28))', margin: '0 2px' }} />
            {onQuote && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onQuote(sel.text); setSel(null); flash('Saved as the cited sentence') }}
                className="rounded-full px-2.5 py-1 iw-tap" style={{ color: INKC, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                quote this
              </button>
            )}
            {onCite && (() => {
              // ⚠ CITE THE SECTION THE SELECTION IS IN — not the selection (Peter, 2026-08-28: "if
              // we cite as locator what we really want is for it to cite the heading or section
              // number as the locator"). It used to hand the SELECTED SENTENCE to
              // locatorForHeading, which of course found no number in it and returned the whole
              // sentence verbatim as the locator: "(Smith 2005, Each object is, at the later time,
              // composed…)". Nonsense, and my mistake — the function was built for headings and I
              // fed it prose.
              const sec = sectionFor(sel.text)
              if (!sec) return null            // no heading above it ⇒ nothing honest to cite
              const loc = locatorForHeading(sec)
              return (
                <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onCite(loc); setSel(null); flash(`Cited ${formatSection(loc)}`) }}
                  className="rounded-full px-2.5 py-1 iw-tap" style={{ color: INKC, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  title={`Use "${sec}" as this citation's locator`}>
                  cite {formatSection(loc)}
                </button>
              )
            })()}
          </div>
        )}

        {/* ⚠ THE GRANT LIVES IN THE EXTENSION, AND SAYING SO IS THE FEATURE. `permissions.request()`
            is honoured only inside an extension page, so no button here can open the browser's own
            dialog — the most this can do is ask the extension to raise its popup, which recent
            Chrome allows and older browsers refuse. So the INSTRUCTION is always printed and the
            button is only a shortcut to it. A control whose whole behaviour depends on an API that
            may quietly decline is the dead button this reader has already shipped twice. */}
        {!framed && grantHint && extState === 'blocked' && (
          <div className="flex items-start gap-2 px-3 py-1.5 border-t"
            style={{ fontSize: '11px', background: `${INK}0a`, borderColor: `${INK}22`, color: 'var(--iw-pill-fg, #57534e)' }}>
            <span style={{ flex: 1, lineHeight: 1.5 }}>
              Open the Inkwave extension (its icon in your browser’s toolbar) and turn on
              <strong> Fetch pages for the reader</strong>. Sources will then load from your own
              connection instead of Inkwave’s server — which is also what makes web search work here.
            </span>
            <button type="button" onClick={() => setGrantHint(false)} title="Hide this"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED_CHROME, fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        )}

        {/* ── THE MARKUP BAR (Peter, 2026-08-28: "a tab at the bottom with roughly the same markup
            tools as for the pdfs … reproduce the same ecosystem") ────────────────────────────────
            Same three tools, same gesture (click arms, HOLD opens the colours), same palette, so a
            highlight means the same thing in both readers. READER MODE ONLY: a live page is the
            publisher's document and the browser seals it off from us — we cannot mark what we
            cannot read, and offering a tool that silently does nothing is worse than not offering
            it, so the bar renders the reason instead.
            ⚠ THIS BAR READ `var(--iw-panel-bg, …)` AND THAT TOKEN IS DEFINED NOWHERE IN THE REPO —
            so it painted the #faf8fc fallback in BOTH themes (measured byte-identical), which is the
            near-white slab Peter saw under a night reading column, with chrome rescues washing its
            labels out on top of it. The bar belongs to the PAPER: it wears the marks' own colours,
            and a swatch has to be shown against the surface its mark lands on. */}
        {!framed && !selfOpen && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-t flex-wrap"
            style={{ fontSize: '12px', background: 'var(--iw-reader-bar, #faf8fc)', borderTopColor: EDGE,
              ['--iw-tap-x' as string]: '6px' }}>
            {/* TWO GESTURES, AND THE TOOL DECIDES WHICH. A highlight and a sticky note act on a
                SELECTION; coloured text and a textbox are placed by a CLICK, because they add words
                the page never had and so have nothing to select. Giving the placing tools the
                selection gesture would mean "select some text to write something that isn't in it",
                which is why they arm and wait instead. */}
            {([
              { kind: 'highlight' as const, mode: 'select' as const, label: '▮', title: 'Highlight — select text, then click · hold for colours', palette: MARK_COLORS, color: markColor, setColor: setMarkColor, glyph: readerInk('#8a6a04') },
              { kind: 'note' as const, mode: 'select' as const, label: '🗒', title: 'Sticky note — select text, then click · hold for colours', palette: NOTE_COLORS, color: markColor, setColor: setMarkColor, glyph: INKP },
              { kind: 'text' as const, mode: 'place' as const, label: 'T', title: 'Coloured text — click, then click where the words should go · hold for inks', palette: TEXT_COLORS, color: textColor, setColor: setTextColor, glyph: readerInk(textColor) },
              { kind: 'box' as const, mode: 'place' as const, label: '▭', title: 'Textbox — click, then click a paragraph to hang a note under it · hold for colours', palette: BOX_COLORS, color: boxColor, setColor: setBoxColor, glyph: INKP },
            ]).map((t) => (
              <div key={t.kind} style={{ position: 'relative' }}>
                <button type="button" title={t.title} className="iw-tap"
                  onPointerDown={() => { holdRef.current = setTimeout(() => { heldRef.current = true; setPaletteOpen(t.kind) }, 400) }}
                  onPointerUp={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onPointerLeave={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  // ⚠ POINTERCANCEL IS NOT OPTIONAL ON TOUCH, and it was missing here while the PDF
                  // toolbar's identical gesture has always had it. A finger that drifts enough for
                  // the browser to claim the gesture as a scroll gets `pointercancel` and NO
                  // `pointerup`, so the 400ms timer went on to fire: the palette opened under a
                  // finger that had already left, and `heldRef` stayed true and swallowed the NEXT
                  // tap on the tool. Two wrong outcomes from one missing line.
                  onPointerCancel={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onClick={() => {
                    if (heldRef.current) { heldRef.current = false; return }
                    // Text already selected → mark it now. Nothing selected → arm the tool. A
                    // PLACING tool always arms: there is nothing for it to do to a selection.
                    const sel2 = window.getSelection()
                    if (t.mode === 'select' && sel2 && !sel2.isCollapsed) { markSelection(t.kind as MarkKind); return }
                    setComposer(null)
                    setTool((cur) => (cur === t.kind ? null : t.kind))
                  }}
                  style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
                    // AN ELEMENT THAT OWNS A GESTURE OWNS ITS OWN touch-action (CLAUDE.md — it does
                    // NOT inherit, and the app-wide phone rule is `pan-x pan-y`). Under that rule a
                    // hold on this button is also a candidate PAN, so the browser may claim the
                    // gesture mid-hold and cancel it; `none` says the hold is ours. There is nothing
                    // to scroll under a toolbar button, so nothing is lost.
                    touchAction: 'none',
                    fontWeight: t.kind === 'text' ? 700 : undefined,
                    border: `1px solid ${tool === t.kind ? INKP : EDGE}`, background: tool === t.kind ? TINT : CTL,
                    color: t.glyph }}>{t.label}</button>
                {paletteOpen === t.kind && (
                  <>
                    {/* ⚠ POINTERDOWN, NOT MOUSEDOWN. A tap only produces a synthetic mousedown if
                        iOS decides the gesture was a click — and it withholds one whenever the
                        touch is treated as a scroll or a touchmove was preventDefaulted, which this
                        panel's own `.iw-touch-guard` handler (TiptapEditor) does. So the dismiss
                        scrim was listening for an event a finger is not guaranteed to send. */}
                    <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onPointerDown={() => setPaletteOpen(null)} />
                    <div className="iw-nightable" style={{ position: 'absolute', bottom: 32, left: 0, zIndex: 21, display: 'flex', gap: 6, padding: '7px 8px', borderRadius: 10, background: CTL, border: `1px solid ${EDGE}`, boxShadow: '0 4px 16px rgba(0,0,0,0.16)', ['--iw-tap-x' as string]: '6px' }}>
                      {t.palette.map((c) => (
                        <button key={c} type="button" className="iw-tap" onMouseDown={(ev) => ev.preventDefault()}
                          // EACH TOOL REMEMBERS ITS OWN COLOUR. One shared "current colour" would
                          // mean picking an ink for the T tool silently recoloured the highlighter,
                          // and the two palettes do not even overlap (washes vs inks).
                          onClick={() => { t.setColor(c); setPaletteOpen(null) }}
                          style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: t.color === c ? `2px solid ${INKP}` : '1px solid rgba(0,0,0,0.15)' }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
            {/* The PDF's eraser, glyph for glyph (Peter: "the erasor button needs to look same as
                for pdfs"). Same tool, same picture — a different icon reads as a different thing. */}
            <button type="button" title="Eraser — click a mark to remove it" className="iw-tap"
              onClick={() => setTool((cur) => (cur === 'erase' ? null : 'erase'))}
              style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${tool === 'erase' ? INKP : EDGE}`, background: tool === 'erase' ? TINT : CTL }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#e8a0c0" stroke="#c76fa0" strokeWidth="1.1"
                  d="M15.6 3.5 3.5 15.6a2 2 0 0 0 0 2.8l2.1 2.1a2 2 0 0 0 2.8 0L20.5 8.4a2 2 0 0 0 0-2.8l-2.1-2.1a2 2 0 0 0-2.8 0Z" />
                <path fill="none" stroke="#c76fa0" strokeWidth="1.1" d="m10.2 8.8 5 5" />
              </svg>
            </button>

            <span style={{ width: 1, height: 16, background: HAIR, margin: '0 3px' }} />
            {/* Reading face — Peter's "preset sexy fonts". Reader mode only; a live page's
                typography is the publisher's. */}
            <select value={font} title="Reading font"
              onChange={(e) => { setFont(e.target.value); try { localStorage.setItem('inkwave:readerFont', e.target.value) } catch { /* private */ } }}
              className="iw-nightable iw-reader-field"
              style={{ height: isPhone ? TOUCH_FIELD_H : 26, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, fontSize: '0.76rem', padding: '0 4px', cursor: 'pointer' }}>
              {READER_FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>
            {/* Line spacing (Peter, 2026-08-28). Sits beside the face because they are one decision
                — how this article should read — and a source you are working THROUGH wants more air
                than one you are skimming. */}
            <select value={String(leading)} title="Line spacing"
              onChange={(e) => { const v = Number(e.target.value); setLeading(v); try { localStorage.setItem('inkwave:readerLeading', String(v)) } catch { /* private */ } }}
              className="iw-nightable iw-reader-field"
              style={{ height: isPhone ? TOUCH_FIELD_H : 26, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, fontSize: '0.76rem', padding: '0 4px', cursor: 'pointer' }}>
              <option value="1.35">Tight</option>
              <option value="1.62">Normal</option>
              <option value="1.9">Airy</option>
              <option value="2.3">Double</option>
            </select>

            {/* ── ZOOM (D3 — Peter: "and all the same zoom settings etc") ────────────────────────
                The PDF's gesture and the PDF's curve (zoomGesture.ts), applied to TYPE rather than
                to a raster: the column reflows to the panel at every step, so this reader never
                grows the second scrollbar the PDF has to. ⌘/Ctrl+wheel over the article does the
                same thing; the percentage is a button because a number you cannot get back to 100%
                from is a trap. */}
            <span style={{ width: 1, height: 16, background: HAIR, margin: '0 3px' }} />
            <div className="flex items-center" style={{ gap: 2, ['--iw-tap-x' as string]: '2px' }}>
              <button type="button" title="Smaller text" aria-label="Smaller text" className="iw-tap"
                onClick={() => applyZoom(readerZoomStep(zoom, -1))}
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, cursor: 'pointer', lineHeight: 1 }}>−</button>
              <button type="button" title="Back to 100%" onClick={() => applyZoom(1)} className="iw-tap"
                style={{ minWidth: 42, height: 22, borderRadius: 6, border: '1px solid transparent', background: 'transparent',
                  color: MUTED_PAPER, cursor: 'pointer', fontSize: '11px', fontFamily: 'system-ui, sans-serif' }}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" title="Bigger text" aria-label="Bigger text" className="iw-tap"
                onClick={() => applyZoom(readerZoomStep(zoom, 1))}
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, cursor: 'pointer', lineHeight: 1 }}>+</button>
            </div>

            {/* ⚠ WHOSE CONNECTION FETCHED THIS. Always visible in reader mode, because the whole
                difference between the two paths is invisible otherwise — the article looks the
                same either way. When the extension is installed but has not been granted
                permission this is also the BUTTON that offers to fix it, which is the moment the
                offer is worth anything (the popup is where the grant must actually happen). */}
            {/* One right-aligned group: two `ml-auto` siblings would leave the second with no free
                space to claim, so the pill and the orphan note would end up jammed together in the
                wrong order. */}
            <span className="ml-auto" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {located.orphaned.length > 0 && (
              // A mark whose text the publisher has since changed. Said out loud rather than
              // silently dropped OR silently re-placed over words the reader never marked.
              <span className="text-stone-500" style={{ fontSize: '11px' }}
                title="These marks covered text that is no longer on the page — the publisher has edited it.">
                {located.orphaned.length} mark{located.orphaned.length === 1 ? '' : 's'} lost their place
              </span>
            )}
            {doc && via && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {via === 'extension' ? (
                  <span title="Fetched by the Inkwave extension, from your own connection and address. Inkwave’s server was not involved and never saw this address."
                    style={{ fontSize: '11px', color: 'var(--iw-reader-ok, #15803d)', whiteSpace: 'nowrap' }}>
                    ⌂ your connection
                  </span>
                ) : extState === 'blocked' ? (
                  <button type="button" onClick={askForFetchPermission}
                    title="The Inkwave extension is installed but hasn’t been allowed to fetch pages. Turning that on loads sources from your own connection instead."
                    style={{ fontSize: '11px', color: 'var(--iw-reader-ink, #2c2a28)', background: 'transparent', border: `1px solid ${EDGE}`,
                      borderRadius: 999, padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    ☁ Inkwave’s server — use my connection
                  </button>
                ) : (
                  <span title="Fetched by Inkwave’s server, which sees the address for the moment it takes to fetch it and keeps no log or copy. Installing the Inkwave extension moves this to your own connection."
                    style={{ fontSize: '11px', color: MUTED_PAPER, whiteSpace: 'nowrap' }}>
                    ☁ Inkwave’s server
                  </span>
                )}
              </span>
            )}

            </span>
          </div>
        )}

        {/* WHERE AM I (Peter, 2026-08-28: "an indicator at bottom left of both pdf and webpage of
            which page n/x you're at"). A web article has no pages, so the honest unit is its own
            SECTIONS — which is also what you cite by. With no headings it falls back to a
            percentage rather than inventing a page number the source does not have. */}
        {!framed && doc && (
          <div style={{ position: 'absolute', left: 8, bottom: 42, zIndex: 401, pointerEvents: 'none',
            background: CTL, color: INKP, border: `1px solid ${EDGE}`,
            borderRadius: 999, padding: '3px 11px', fontSize: '12px', fontWeight: 600,
            fontFamily: 'system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
            {headings.length > 1 ? `§ ${Math.min(headings.length, sectionNow + 1)} / ${headings.length}` : `${readPct}%`}
          </div>
        )}

        {toast && (
          <div style={{ position: 'absolute', left: '50%', bottom: 54, transform: 'translateX(-50%)', zIndex: 402,
            background: INK, color: '#fff', fontSize: '12px', padding: '6px 12px', borderRadius: 999,
            boxShadow: '0 3px 12px rgba(0,0,0,0.25)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{toast}</div>
        )}

        {/* LIVE MODE gets its own thin bar — the width choice and the zoom. It is not a fifth header
            button (Peter asked for four, symmetric) and it is not a markup tool, because there is
            nothing in a live page we are allowed to mark.
            ⚠ IT WRAPS. At 375px the label, a three-option select and four controls do not fit on one
            line, and a bar that overflows takes its own controls off the screen — the failure this
            file has already been audited for once. `--iw-tap-x` is this row's own gap (8px), so each
            `.iw-tap` control claims 4px per side and no two neighbours contend. */}
        {framed && !frameRefused && !selfOpen && (
          <div className="flex items-center gap-2 px-2 py-1.5 border-t border-stone-200 flex-wrap"
            style={{ fontSize: '11px', background: 'var(--iw-reader-bar, #faf8fc)', color: MUTED_PAPER, borderTopColor: EDGE,
              ['--iw-tap-x' as string]: '8px' }}>
            <span>{isPhone ? 'Width' : 'Page width'}</span>
            <select value={pageWidth} title="How wide a screen the site should lay out for"
              onChange={(e) => { const v = e.target.value as PageWidth; setPageWidth(v); try { localStorage.setItem('inkwave:readerPageWidth', v) } catch { /* private */ } }}
              className="iw-nightable iw-reader-field"
              style={{ height: isPhone ? TOUCH_FIELD_H : 22, minWidth: 0, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, fontSize: '11px', padding: '0 4px', cursor: 'pointer' }}>
              <option value="auto">Fit the panel</option>
              <option value="narrow">Big text (phone layout)</option>
              <option value="wide">Wide (desktop layout)</option>
            </select>
            {/* THE PDF's −/%/+ PAIR AND ITS FIT BUTTON, PORTED (Peter: "copy a bunch of the editing
                and the centre around text buttons from the pdf viewer").
                ⚠ AND ONE OF THEM IS DELIBERATELY NOT PORTED. The PDF's ⤢ is "fit the TEXT to the
                window" — it reads the page's own text bounding box out of the text layer and scales
                so the ink is flush. Nothing here can read where the text sits: the page is
                cross-origin, so its layout, its scroll position and its DOM are all closed to us.
                A button labelled "centre on the text" would be a promise we cannot keep, so the
                honest equivalent is offered instead: fit the page to the panel and reset the pan. */}
            <div className="flex items-center ml-auto" style={{ gap: 2, ['--iw-tap-x' as string]: '2px' }}>
              <button type="button" title="Zoom out" aria-label="Zoom out" className="iw-tap"
                onClick={() => applyLiveZoom(liveZoomStep(liveZoom, -1))}
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, cursor: 'pointer', lineHeight: 1 }}>−</button>
              <button type="button" title="Fit the page to the panel width" data-iw-live-fit
                onClick={() => { applyLiveZoom(1); const el = frameHostRef.current; if (el) el.scrollLeft = 0 }} className="iw-tap"
                style={{ minWidth: 42, height: 22, borderRadius: 6, border: '1px solid transparent', background: 'transparent',
                  color: MUTED_PAPER, cursor: 'pointer', fontSize: '11px', fontFamily: 'system-ui, sans-serif' }}>
                {Math.round(liveZoom * 100)}%
              </button>
              <button type="button" title="Zoom in" aria-label="Zoom in" className="iw-tap"
                onClick={() => applyLiveZoom(liveZoomStep(liveZoom, 1))}
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, cursor: 'pointer', lineHeight: 1 }}>+</button>
              <button type="button" title="Fit the page to the panel width and re-centre" aria-label="Fit to width"
                onClick={() => { applyLiveZoom(1); const el = frameHostRef.current; if (el) el.scrollLeft = 0 }} className="iw-tap"
                style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${EDGE}`, background: CTL, color: INKP, cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}>⤢</button>
            </div>
          </div>
        )}

        {/* ⚠ DISMISSIBLE, NOT DELETED. The framed case's line is the one that explains why selecting
            text does nothing there, so it is worth keeping available — the × remembers per document
            and the ☰/mode change brings it back for a source where it matters. */}
        {showNotice && (
          <div className="px-3 py-1.5 border-t border-stone-200 text-stone-500 flex items-start gap-2" style={{ fontSize: '11px' }}>
            {/* ⚠ THIS SENTENCE IS A CLAIM ABOUT WHERE THE REQUEST WENT, so it is a function of
                `via` and never a constant. Through the extension our server is not in the path at
                all — strictly stronger than the "sees it for an instant, logs nothing" posture
                api/_reader-core.mjs documents, and the copy says the stronger thing only when the
                stronger thing is what happened. Nothing here claims the fetch carried the writer's
                SESSION: an extension-worker request is cross-site by initiator, so a site's
                SameSite cookies are not sent, and the address is the part that is simply true. */}
            {/* ⚠ AND THE SIGNED-OUT SENTENCE IS NOT A HEDGE — IT IS MEASURED. Three cookies, one
                origin, read first-party and then framed: SameSite=Lax (the DEFAULT a cookie gets
                when it says nothing) and Strict are both dropped; only None survives. So a site the
                writer is logged into renders logged OUT here, and no header the extension removes
                can change that — it is the browser's third-party context rule. Saying it at the
                moment it happens is the difference between a known limit and Inkwave looking
                broken; a writer who sees their own account signed out and is told nothing
                reasonably concludes the panel is faulty. */}
            <span style={{ flex: 1 }}>{framed
              ? (framingOn
                ? 'Live page, opened by the Inkwave extension from your own connection. Sites you’re signed in to will show as signed out — a page in a panel doesn’t carry your session.'
                : 'Live page — your browser keeps it separate from Inkwave, so text selected here can’t be picked up.')
              : via === 'extension'
                ? 'Article text, fetched by the Inkwave extension from your own connection. Inkwave’s server was not involved and never saw this address.'
                : 'Article text, fetched for you. Inkwave keeps no log and no copy of what you read — but it does see the address for the moment it takes to fetch.'}</span>
            {/* MEASURED 12.7×14 at 375px — the smallest control in the panel, and the one a reader
                reaches for first (it is how you get the privacy footer off a phone screen). */}
            <button type="button" onClick={dismissNotice} title="Hide this note" aria-label="Hide this note"
              className="iw-tap"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED_CHROME, fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
