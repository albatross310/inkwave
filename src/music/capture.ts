// ─── Score capture (build-spec §A1) ──────────────────────────────────────────
//
// "Camera capture or import of page images (JPG/PNG) and PDF pages."
//
// This is the ONLY file in the module that touches a canvas. Everything downstream (`reflow.ts`,
// `leader.ts`) is pure and takes plain buffers — which is what makes the detector testable in node
// against fixtures with known ground truth, instead of being provable only in a browser.
//
// ⚠️ STORAGE: pages are written to OPFS in the clear, like every other Inkwave document. There is no
// at-rest encryption in this build (verified in the code — see types.ts). Do not write copy here or
// anywhere else claiming there is.

import { getPdfjs, PDF_DOC_PARAMS } from '../citations/pdfjsSetup'
import { analysePage, binarise, deskew, estimateSkew, type GrayImage } from './reflow'
import type { PiecePage, Region, System } from './types'

// ─── Decoding ────────────────────────────────────────────────────────────────

/**
 * The longest edge we keep, in px.
 *
 * A 12MP phone photo is ~4000×3000. The detector is O(pixels) with a few passes, and the skew search
 * runs the profile ~30 times — at full resolution that is seconds of main thread, which is precisely
 * the class of work CLAUDE.md forbids near the load path. 1600px keeps a stave line ~2px thick
 * (plenty for `rowLongestRun`) and the analysis in the tens of milliseconds. The DISPLAYED image is
 * the original file, untouched — this cap applies to the ANALYSIS buffer only, so nothing the
 * student sees or writes on is ever downscaled.
 */
const ANALYSIS_MAX_EDGE = 1600

async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

function canvasOf(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    return { canvas, ctx: ctx as OffscreenCanvasRenderingContext2D }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  return { canvas, ctx }
}

/** ImageData → single-channel luminance, the only form `reflow.ts` understands. */
export function toGray(img: ImageData): GrayImage {
  const { width, height, data } = img
  const out = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma. Integer weights — this runs over ~2.5M pixels per page.
    out[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  }
  return { width, height, data: out }
}

/** Decode any image blob to the analysis buffer (downscaled to ANALYSIS_MAX_EDGE). */
export async function blobToGray(blob: Blob): Promise<{ gray: GrayImage; naturalWidth: number; naturalHeight: number }> {
  const bmp = await bitmapOf(blob)
  try {
    const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const { ctx } = canvasOf(w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return { gray: toGray(ctx.getImageData(0, 0, w, h)), naturalWidth: bmp.width, naturalHeight: bmp.height }
  } finally {
    bmp.close()
  }
}

// ─── PDF pages ───────────────────────────────────────────────────────────────

/**
 * Render each page of a PDF to a PNG blob.
 *
 * REUSES the app's existing pdf.js setup (`citations/pdfjsSetup`) — the same lazily-imported,
 * self-hosted build with the wasm decoders that make SCANNED PDFs usable, which is exactly what a
 * photographed-then-PDF'd score is. A second pdf.js entry point would double a large dependency and
 * give the module a subtly different decoder from the rest of the app.
 */
export async function pdfToPageBlobs(
  data: ArrayBuffer, opts: { scale?: number; onPage?: (i: number, total: number) => void } = {},
): Promise<Blob[]> {
  const pdfjs = await getPdfjs()
  // slice(): pdf.js takes ownership of the buffer, and the caller's copy must stay usable.
  const task = pdfjs.getDocument({ data: data.slice(0), ...PDF_DOC_PARAMS })
  const doc = await task.promise
  const out: Blob[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      // 2× for crispness — the student writes on this, and a soft score is unreadable under Pencil
      // marks. (The app's PdfViewer supersamples ≥2× for the same reason.)
      const viewport = page.getViewport({ scale: opts.scale ?? 2 })
      const { canvas, ctx } = canvasOf(Math.ceil(viewport.width), Math.ceil(viewport.height))
      // A PDF page is transparent where it is blank; the analysis reads luminance, so an unpainted
      // background would decode as BLACK and the whole page would binarise to ink.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, viewport.width, viewport.height)
      await page.render({
        canvas: canvas as HTMLCanvasElement,
        canvasContext: ctx as CanvasRenderingContext2D,
        viewport,
      }).promise
      out.push(await toBlob(canvas))
      page.cleanup()
      opts.onPage?.(i, doc.numPages)
    }
  } finally {
    // Destroy the LOADING TASK, not the doc — the same disposal the app's PdfViewer uses. It tears
    // down the worker port too; destroying the proxy alone leaves it up.
    await task.destroy().catch(() => {})
  }
  return out
}

async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((res, rej) =>
    (canvas as HTMLCanvasElement).toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
  )
}

// ─── Deskew at capture ───────────────────────────────────────────────────────

/**
 * Rotate a captured page so the staves are level, and store THAT.
 *
 * WHY AT CAPTURE, ONCE: it gives the page exactly ONE coordinate space. The stored image, every
 * annotation anchor, the reflow layout and the bar regions then all agree by construction. The
 * alternative — keeping the skewed original and carrying an angle through every consumer — is two
 * spaces for one page, which is the shape of CLAUDE.md's round-11 bug ("two rules, one pane"), and
 * it would put a rotation into the render path of every mark the student draws.
 */
export async function deskewBlob(blob: Blob, deg: number): Promise<Blob> {
  if (Math.abs(deg) < 0.1) return blob          // not worth a re-encode
  const bmp = await bitmapOf(blob)
  try {
    const { canvas, ctx } = canvasOf(bmp.width, bmp.height)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, bmp.width, bmp.height)
    ctx.translate(bmp.width / 2, bmp.height / 2)
    ctx.rotate((-deg * Math.PI) / 180)
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
    return await toBlob(canvas)
  } finally {
    bmp.close()
  }
}

// ─── The capture pipeline ────────────────────────────────────────────────────

export interface CapturedPage {
  /** The page image to STORE and display — deskewed, otherwise the original bytes. */
  blob: Blob
  page: PiecePage
}

function toRegion(top: number, bottom: number, h: number): Region {
  return { x: 0, y: top / h, w: 1, h: (bottom - top) / h }
}

function toPieceSystems(systems: System[] | ReturnType<typeof analysePage>['systems'], h: number): System[] {
  return (systems as ReturnType<typeof analysePage>['systems']).map((s, index) => ({
    index,
    region: toRegion(s.top, s.bottom, h),
    staves: s.staves.map(st => ({ region: toRegion(st.top, st.bottom, h) })),
    is_grand_stave: s.isGrandStave,
    confidence: s.confidence,
  }))
}

/**
 * Capture one page: decode → estimate skew → deskew the stored image → detect systems → build the
 * `PiecePage` with a sensible default reflow gap.
 *
 * The default gap is derived from the page's own stave spacing rather than being a fixed fraction:
 * a tightly-engraved page needs proportionally less room than a large-print one, and "room to write
 * a bar number and a word" is about three stave-spaces. The student adjusts it either way (§A1's
 * manual handles) — this only has to be a good starting point.
 */
export async function capturePage(
  blob: Blob, opts: { assumeDeskewed?: boolean } = {},
): Promise<CapturedPage> {
  const first = await blobToGray(blob)
  const bin = binarise(first.gray)

  const skewDeg = opts.assumeDeskewed ? 0 : estimateSkew(bin)
  const stored = opts.assumeDeskewed ? blob : await deskewBlob(blob, skewDeg)

  // Re-analyse the DESKEWED buffer rather than mapping the first pass's coordinates through the
  // rotation. Mapping would be cheaper and is how you end up with regions that are subtly wrong at
  // the page edges — the stored image is the source of truth, so measure the stored image.
  const straight = skewDeg === 0 ? bin : deskew(bin, skewDeg)
  const analysis = analysePage(straight, { assumeDeskewed: true })
  const h = straight.height

  const defaultGap = analysis.staveSpacing > 0
    ? Math.min(0.25, (analysis.staveSpacing * 3) / h)
    : 0.06

  return {
    blob: stored,
    page: {
      image_ref: '',                    // assigned by the store when the bytes are written
      source_width: first.naturalWidth,
      source_height: first.naturalHeight,
      systems: toPieceSystems(analysis.systems, h),
      bars: [],                         // §A4: the student taps barlines; CV auto-detect is later
      reflow: {
        enabled: analysis.systems.length > 1,
        default_gap: defaultGap,
        gaps: {},
      },
    },
  }
}

/** Capture every page of a PDF (§A1's "PDF pages"). */
export async function capturePdf(
  data: ArrayBuffer, opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<CapturedPage[]> {
  const blobs = await pdfToPageBlobs(data, { onPage: (i, n) => opts.onProgress?.(i, n) })
  const pages: CapturedPage[] = []
  for (const b of blobs) {
    // A PDF page is already square — its "skew" is whatever was photographed INTO it, so the
    // estimate still runs. A born-digital PDF simply returns ~0 and the re-encode is skipped.
    pages.push(await capturePage(b))
  }
  return pages
}
