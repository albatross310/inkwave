// THE MARKED-UP PDF, as pages — the ONE mechanism behind both Print and Export.
//
// The marks are not in the PDF bytes (they live on `_iw.highlights` as DOM overlays), so "export
// the marked-up PDF" means PRODUCING A NEW DOCUMENT. This makes it once, as page images, and Print
// and Export hand the SAME pixels to the writer.
//
// ⚠ NEVER REUSE THE ON-SCREEN CANVASES. Three facts in PdfViewer.tsx rule it out, each of which
// would silently degrade or blank a page: far pages hold a 0.2–0.45× BASE canvas (a smear, and the
// state most pages are in); `evictFarPages` frees far sharp canvases on touch, so a print would
// vary with how the reader scrolled; and the on-screen size follows the READER'S ZOOM, a viewing
// choice that is well under 150 dpi at fit-to-width.
// ⚠ THE MARKS ARE PAINTED ONTO THE PAGE CANVAS, not kept as overlays, so exported bytes and printed
// sheet are the same picture BY CONSTRUCTION — "two rules, one pane" is unrepresentable here.
// → docs/archive/panels-and-popovers.md#pdfpages-one-mechanism

import type { PdfHighlight } from '../citations/pdfHighlights'
import type { PdfImagePage } from './minimalPdf'

// ── Resolution and memory ────────────────────────────────────────────────────────────────────────

/** 2× points = 144 dpi. Matches the viewer's own supersampling floor (`pdfOutputScale`). */
export const PRINT_SCALE = 2
/** 72 dpi. Soft, but honestly readable; below this we refuse rather than pretend. */
export const MIN_PRINT_SCALE = 1
/**
 * Estimated JPEG bytes per rendered pixel at q0.82 for a text page. Deliberately generous — the
 * budget's job is to stop a 900-page export from taking the tab down, and an estimate that runs low
 * is one that lets it through.
 */
export const JPEG_BYTES_PER_PX = 0.12
/** Total encoded-JPEG budget held in memory at once, before the file is assembled. */
export const EXPORT_BYTE_BUDGET = 96 * 1024 * 1024
/** Past this many pages we warn before starting — it is a minute of work, not an instant. */
export const SLOW_PAGE_COUNT = 150

export type RenderPlan =
  | { ok: true; scale: number; estBytes: number; degraded: boolean }
  | { ok: false; reason: string }

/**
 * Choose the render scale for a whole-document export, or REFUSE.
 *
 * ⚠ REFUSE RATHER THAN TRUNCATE: a document too large to hold at the 72-dpi floor returns
 * `ok: false` naming the page count, instead of exporting the first N pages and looking like it
 * worked.
 */
export function planAnnotatedRender(
  pageCount: number,
  pageWidthPt: number,
  pageHeightPt: number,
  budget = EXPORT_BYTE_BUDGET,
): RenderPlan {
  if (pageCount <= 0) return { ok: false, reason: 'This PDF has no pages.' }
  const pxPerPageAt1 = Math.max(1, pageWidthPt * pageHeightPt)
  const bytesAt = (scale: number) => pageCount * pxPerPageAt1 * scale * scale * JPEG_BYTES_PER_PX

  if (bytesAt(PRINT_SCALE) <= budget) {
    return { ok: true, scale: PRINT_SCALE, estBytes: bytesAt(PRINT_SCALE), degraded: false }
  }
  // Solve for the scale that just fits, then clamp. Anything below the floor is a refusal, not a
  // smaller number: a 40-dpi page of philosophy is not a document anyone can read.
  const fitted = Math.sqrt(budget / (pageCount * pxPerPageAt1 * JPEG_BYTES_PER_PX))
  if (fitted < MIN_PRINT_SCALE) {
    return {
      ok: false,
      reason: `This PDF is ${pageCount} pages — too many to render into one file on this device ` +
        `without dropping below readable resolution. Export a shorter source, or print it in ranges ` +
        `from your browser's print dialog.`,
    }
  }
  const scale = Math.min(PRINT_SCALE, fitted)
  return { ok: true, scale, estBytes: bytesAt(scale), degraded: true }
}

/**
 * The marks this mechanism CANNOT burn in: the ones with no rectangle on the page.
 *
 * ⚠ ABOUT GEOMETRY, NOT ABOUT WHICH VIEW MADE THE MARK — the obvious assumption is wrong, since
 * `PdfReaderView.createFromSelection` stores page rects too, so reader-made marks DO normally
 * export. What cannot is any mark whose `rects` came back EMPTY. Such a mark is real and must NOT
 * be deleted; it simply has no position to paint at. The caller COUNTS them and tells the writer,
 * because an export quietly missing marks looks exactly like a correct one.
 * → docs/archive/panels-and-popovers.md#pdfpages-marks-without-geometry
 */
export function marksWithoutGeometry(marks: readonly PdfHighlight[]): PdfHighlight[] {
  return marks.filter(m => !m.rects?.length)
}

// ── Painting the marks ───────────────────────────────────────────────────────────────────────────

/**
 * The slice of CanvasRenderingContext2D the painter uses. Structural, so a test can hand it a
 * recorder and assert what was drawn without a DOM. A real 2D context satisfies it.
 */
export interface PaintCtx {
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  rect(x: number, y: number, w: number, h: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  globalAlpha: number
  globalCompositeOperation: string
  // The real context's fill/stroke styles accept a gradient or a pattern too. Narrowing them to
  // `string` here made a genuine CanvasRenderingContext2D UN-assignable to this interface — a fake
  // that is easier to satisfy than the real thing is a fake that can certify code the browser
  // rejects.
  fillStyle: CanvasFillStrokeStyles['fillStyle']
  strokeStyle: CanvasFillStrokeStyles['strokeStyle']
  lineWidth: number
  font: string
  textBaseline: string
}

/** Canvas geometry for one page: pixel size, and pixels per point. */
export interface PageGeom { width: number; height: number; scale: number }

export const NOTE_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const NOTE_LINE_HEIGHT = 1.35   // matches redrawOverlays' note style
const NOTE_PAD_X = 6
const NOTE_PAD_Y = 3
const NOTE_MIN_W = 60
const NOTE_MIN_H = 20
const NOTE_RADIUS = 4

/**
 * Break a note's text into rendered lines, mirroring the on-screen note's CSS: `pre-wrap` (explicit
 * newlines kept) plus `overflow-wrap: break-word`. Pure — `measure` is all it needs from a canvas.
 */
export function wrapNoteText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') { out.push(''); continue }
    let line = ''
    for (const word of para.split(/(\s+)/).filter(s => s !== '')) {
      const candidate = line + word
      if (line !== '' && measure(candidate) > maxWidth) {
        out.push(line.replace(/\s+$/, ''))
        line = word.replace(/^\s+/, '')
      } else {
        line = candidate
      }
      // A word that cannot fit on a line of its own must be broken, or it renders outside the box.
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    out.push(line.replace(/\s+$/, ''))
  }
  return out
}

function roundRectPath(ctx: PaintCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y)
  ctx.closePath()
}

/**
 * Paint one page's annotations onto a rendered page canvas.
 *
 * ⚠ NOT PAINTED: the × delete handles and the selection outline — editing furniture, and a print
 * with a red ✕ beside every highlight is a screenshot of the app, not the annotated source.
 * ⚠ PAINTED: an EMPTY sticky note. It is a box the writer placed on purpose, and omitting a mark
 * for holding no words is the deletion-by-omission this codebase refuses everywhere else.
 * → docs/archive/panels-and-popovers.md#pdfpages-what-is-painted
 */
export function paintAnnotations(
  ctx: PaintCtx,
  marks: readonly PdfHighlight[],
  page: number,
  geom: PageGeom,
): void {
  const { width: W, height: H, scale: s } = geom
  const onPage = marks.filter(m => m.page === page)
  // Notes last, so they sit above the rects — the same order the overlay's z-index gives on screen.
  const rectMarks = onPage.filter(m => (m.kind ?? 'highlight') !== 'text')
  const noteMarks = onPage.filter(m => (m.kind ?? 'highlight') === 'text')

  for (const hl of rectMarks) {
    const kind = hl.kind ?? 'highlight'
    if (kind === 'highlight') {
      // ONE path for all of a highlight's line rects, filled ONCE. That is what the overlay's
      // opacity-isolation group buys on screen: overlapping consecutive-line rects union instead of
      // each multiplying separately and double-darkening the middle of a multi-line highlight.
      ctx.save()
      ctx.globalAlpha = 0.4
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = hl.color
      ctx.beginPath()
      for (const r of hl.rects) ctx.rect(r.x * W, r.y * H, r.w * W, r.h * H)
      ctx.fill()
      ctx.restore()
      continue
    }
    // Underline / strikethrough. Neither can be CREATED any more (Peter removed the tools), but a
    // source annotated before today carries them and they must still come out — see the standing
    // note on TOOLS in PdfViewer.tsx.
    ctx.save()
    ctx.fillStyle = hl.color
    for (const r of hl.rects) {
      const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H
      const thickness = Math.max(1, 2 * s)
      ctx.fillRect(x, kind === 'underline' ? y + h - thickness : y + h / 2 - thickness / 2, w, thickness)
    }
    ctx.restore()
  }

  for (const hl of noteMarks) {
    const r0 = hl.rects[0]
    if (!r0) continue
    // The stored font size is px at the page's SCALE-1 size (the reference the note's own geometry
    // uses), so 12 on a 612pt-wide page prints as 12pt. Reading it as px at whatever zoom the reader
    // last used would make the same note a different size in every export.
    const fontPx = (hl.size ?? 12) * s
    ctx.save()
    ctx.font = `${fontPx}px ${NOTE_FONT}`
    const boxW = Math.max(NOTE_MIN_W * s, (r0.w || 0.3) * W)
    const padX = NOTE_PAD_X * s, padY = NOTE_PAD_Y * s
    const text = hl.note || hl.text || ''
    const lines = text ? wrapNoteText(text, Math.max(1, boxW - 2 * padX), t => ctx.measureText(t).width) : []
    const lineH = fontPx * NOTE_LINE_HEIGHT
    const dragH = (r0.h || 0) > 0.001 ? Math.max(NOTE_MIN_H * s, r0.h * H) : 0
    const boxH = Math.max(lines.length * lineH + 2 * padY, dragH, lineH + 2 * padY)
    const x = r0.x * W, y = r0.y * H

    ctx.fillStyle = hl.color
    roundRectPath(ctx, x, y, boxW, boxH, NOTE_RADIUS * s)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'
    ctx.lineWidth = Math.max(1, s)
    ctx.stroke()

    ctx.fillStyle = '#2a2a2a'
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      ctx.fillText(line, x + padX, y + padY + i * lineH + (lineH - fontPx) / 2)
    })
    ctx.restore()
  }
}

// ── Rendering the document ───────────────────────────────────────────────────────────────────────

/** The bits of a pdf.js document/page this module touches. */
export interface PdfPageLike {
  getViewport(o: { scale: number; rotation?: number }): { width: number; height: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(o: any): { promise: Promise<void> }
}
export interface PdfDocLike { numPages: number; getPage(n: number): Promise<PdfPageLike> }

export interface AnnotatedRenderOptions {
  doc: PdfDocLike
  marks: readonly PdfHighlight[]
  /** The reader's current rotation, so the output is what they are looking at. */
  rotation?: number
  scale: number
  quality?: number
  onProgress?: (done: number, total: number) => void
  /** Cooperative cancel — checked between pages. */
  cancelled?: () => boolean
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('canvas encode failed')); return }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject)
    }, 'image/jpeg', quality)
  })
}

/**
 * Render every page with its annotations burned in, one at a time.
 *
 * ⚠ SEQUENTIAL AND YIELDING: a `Promise.all` over 200 pages allocates 200 canvases before the first
 * encode and takes the tab down on iOS. Each canvas is zeroed (`width = 0`) the instant its JPEG
 * exists — GC alone is too late for iOS's canvas accounting — so peak canvas memory is ONE page.
 * → docs/archive/panels-and-popovers.md#pdfpages-sequential
 */
export async function renderAnnotatedPages(opts: AnnotatedRenderOptions): Promise<PdfImagePage[]> {
  const { doc, marks, scale, rotation = 0, quality = 0.82, onProgress, cancelled } = opts
  const out: PdfImagePage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    if (cancelled?.()) break
    const page = await doc.getPage(n)
    const vp1 = page.getViewport({ scale: 1, rotation })
    const vp = page.getViewport({ scale, rotation })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(vp.width))
    canvas.height = Math.max(1, Math.floor(vp.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    // A JPEG has no alpha: an unpainted canvas encodes as BLACK, not white. Paint the sheet first.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    paintAnnotations(ctx, marks, n, { width: canvas.width, height: canvas.height, scale })
    const jpeg = await canvasToJpeg(canvas, quality)
    canvas.width = 0; canvas.height = 0 // release now — iOS accounts canvas bytes, GC is too late
    out.push({ jpeg, widthPt: vp1.width, heightPt: vp1.height })
    onProgress?.(n, doc.numPages)
    await new Promise<void>(r => setTimeout(r, 0)) // yield: the tab stays responsive through a long doc
  }
  return out
}

// ── The print view ───────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

/**
 * The printable document: one image per sheet, at the source's own page size, no margins.
 *
 * `@page size` can name only ONE size, so it takes page 1's; mixed-size PDFs still print, scaled to
 * the sheet width — stated rather than silently wrong, since a refusal would be worse.
 * ⚠ blob: URLs, never data: — a 200-page data: document is tens of MB of base64 on the main thread,
 * the exact stall the PDF store's hand-rolled btoa caused.
 */
export function buildPrintHtml(pages: Array<{ url: string; widthPt: number; heightPt: number }>, title: string): string {
  const first = pages[0]
  const imgs = pages.map(p =>
    `<div class="pg"><img src="${p.url}" width="${p.widthPt}" height="${p.heightPt}" alt=""></div>`).join('')
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title><style>` +
    `@page { size: ${first.widthPt}pt ${first.heightPt}pt; margin: 0 }` +
    'html,body { margin:0; padding:0; background:#fff }' +
    '.pg { page-break-after: always; break-after: page; overflow: hidden }' +
    '.pg:last-child { page-break-after: auto; break-after: auto }' +
    'img { display:block; width:100%; height:auto }' +
    '</style></head><body>' + imgs + '</body></html>'
}
