// ── Scrub raster layer (round 3, 2026-07-12 — Peter: "preload their views as PNGs or something
//    so that the user can scroll through real fast … same with the minimap … raster them as PNGs
//    at current resolution of screen") ─────────────────────────────────────────────────────────
//
// During RAPID snapshot stepping (armed multi-scrub, or single flips <~250ms apart) the doc pane,
// the diff panel and the minimap flip through PRE-RASTERISED bitmaps: one <canvas> per pane,
// swapped into an absolutely-positioned overlay per step — zero layout work on the input path.
// At rest (~150ms after the last step, once the live DOM for the landing snapshot has painted)
// the overlay hides and the real view shows — bitmap and DOM are pixel-aligned because each
// bitmap is captured from the live pane at its own scroll offset + the current zoom.
//
// CAPTURE — SVG foreignObject rasterisation, no dependencies: clone the pane subtree, inline the
// app stylesheet (same-origin CSSOM text; `:root`/`html` selectors re-pointed at the clone
// wrapper so theme vars + wave-tile URIs still resolve) and the LOADED webfont faces as data:
// URIs (fonts are self-hosted → same-origin fetch; an SVG-image document may not fetch ANYTHING,
// so every subresource must be a data: URI — that also satisfies the strict CSP: img-src has
// data:, not blob:). The crop is the pane's viewport region (thesis panes are >60,000px tall —
// a full strip would blow any budget), selected by negative margins inside a pane-sized
// foreignObject (NOT viewBox/transform cropping — WebKit's foreignObject handling of those is
// historically buggy). Raster = draw the SVG <img> into a canvas at DEVICE resolution: pane box
// × DPR × (CSS zoom where the zoom wraps the pane — the diff panel). Peter said "current
// resolution of screen": desktop captures at full DPR; phone caps at 2 (memory).
//
// CACHE — LRU keyed `${kind}|${snapshot.id}|${paneW}x${paneH}|z${zoom}|d${dpr}` under a hard
// byte budget (60MB desktop / 24MB touch). Snapshot content is immutable, so entries only go
// stale on scroll (the owning pane recaptures on scroll settle) or on a key change (zoom /
// pane size / DPR → different bucket, old bucket ages out). Misses during a scrub show the
// NEAREST cached snapshot's bitmap (by snapshot order) — never a blank flash; the live counter
// stays truthful (it renders outside the overlays) and the real render catches up at rest.
// Capture runs strictly OFF the input path: idle-pumped, paused while scrubbing or within
// 350ms of any nav input.

import { probePerf } from './perflog'
import { snapThumbsEnabled, thumbScale, putThumb, getThumb, hasThumb, loadThumbIndex, thumbHash, type ThumbPane } from './snapThumbs'

export type ScrubPaneKind = 'doc' | 'diff' | 'map'

// Per-kind capture semantics: the diff panel's CSS `zoom` wraps the WHOLE pane (its scroller
// measures in local/zoomed-space px), so its raster scale must include the zoom to be
// device-exact. The doc pane's zoom lives INSIDE the content (on the paper — cloned with it)
// and the minimap has none, so both raster at plain DPR.
const ZOOM_IN_SCALE: Record<ScrubPaneKind, boolean> = { doc: false, diff: true, map: false }

// Byte budgets. Round 5 (2026-07-14 — Peter "keep + salvage"): the raster DPR is now CAPPED (see
// RASTER_DPR_CAP / dprOf), so each doc-pane bitmap is ~¼ its DPR2 size and 60MB again holds ~38
// entries (~12 snapshots × doc/diff/map — the round-3 measured depth). Deep enough that a fast
// scrub finds the intermediate versions CACHED instead of falling back to a stale nearest — the
// regression-#3 fix ("only some versions seen; lags; catches up on stop"). Bitmaps are GPU-backed
// (ImageBitmap) → bounded native memory, not JS heap.
const DESKTOP_BUDGET = 60 * 1024 * 1024
const TOUCH_BUDGET = 24 * 1024 * 1024
// Cap the RASTER DPR (NOT the display). The felt scrub jank was the per-step compositor texture
// upload of a full-DPR bitmap (measured DPR2 ≈ 20MB/swap → 28% of burst frames >32ms); capping to
// 1 quarters that upload AND ~4×s the cache depth (more intermediate versions stay cached → fewer
// stale-nearest skips). Text at reading size stays crisp at 1. A harness may override via
// window.__iwRasterDprCap to A/B the cap.
const RASTER_DPR_CAP = 1
const REST_MS = 150          // quiet time after the last step before the at-rest swap arms
const CAPTURE_QUIET_MS = 350 // captures never run this close to a nav input
const SAFETY_HIDE_MS = 1500  // overlay can never stick past this after the last step
const FONT_FILE_CAP = 400 * 1024  // skip absurdly large font files
const FONT_TOTAL_CAP = 3 * 1024 * 1024

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────────────────────

export function rasterKey(kind: ScrubPaneKind, snapId: string, w: number, h: number, zoom: number, dpr: number): string {
  return `${kind}|${snapId}|${Math.round(w)}x${Math.round(h)}|z${zoom.toFixed(3)}|d${dpr.toFixed(2)}`
}

/** Among cached candidate snapshot ids, the one nearest `target` in the snapshot order.
 *  Exact hit wins; unknown target → exact-only (never show an arbitrary version). */
export function pickNearest(order: string[], candidates: Iterable<string>, target: string): string | null {
  const cand = new Set(candidates)
  if (cand.has(target)) return target
  const ti = order.indexOf(target)
  if (ti < 0) return null
  let best: string | null = null, bestD = Infinity
  for (const id of cand) {
    const i = order.indexOf(id)
    if (i < 0) continue
    const d = Math.abs(i - ti)
    if (d < bestD) { bestD = d; best = id }
  }
  return best
}

/** Which entries to evict to free `over` bytes — least-recently-used first, protected last.
 *  Protected entries (the scrub window around the current target) are only taken when nothing
 *  else can cover the deficit. */
export function planEviction(
  items: Array<{ key: string; bytes: number; lastUsed: number; protected: boolean }>,
  over: number,
): string[] {
  if (over <= 0) return []
  const out: string[] = []
  let freed = 0
  const byAge = [...items].sort((a, b) => a.lastUsed - b.lastUsed)
  for (const pass of [false, true]) {
    for (const it of byAge) {
      if (freed >= over) return out
      if (it.protected !== pass) continue
      if (out.includes(it.key)) continue
      out.push(it.key)
      freed += it.bytes
    }
  }
  return out
}

// ── Style / font / image inlining (session-cached) ───────────────────────────────────────────

let cssBundlePromise: Promise<string> | null = null
const assetDataUris = new Map<string, Promise<string | null>>()

async function fetchAsDataUri(url: string): Promise<string | null> {
  let p = assetDataUris.get(url)
  if (!p) {
    p = (async () => {
      try {
        const abs = new URL(url, window.location.href)
        if (abs.origin !== window.location.origin) return null // CSP/CORS: same-origin only
        const res = await fetch(abs.href)
        if (!res.ok) return null
        const blob = await res.blob()
        if (blob.size > FONT_FILE_CAP && /\.(woff2?|ttf|otf)(\?|$)/.test(abs.pathname)) return null
        return await new Promise<string | null>((resolve) => {
          const r = new FileReader()
          r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
          r.onerror = () => resolve(null)
          r.readAsDataURL(blob)
        })
      } catch { return null }
    })()
    assetDataUris.set(url, p)
  }
  return p
}

const normFam = (f: string) => f.replace(/["']/g, '').trim().toLowerCase()
const normRange = (r: string) => r.replace(/\s+/g, '').toLowerCase()

/** @font-face rules for the LOADED faces of webfont families, src re-pointed at data: URIs —
 *  an SVG-image document can't fetch, so fonts must ride inside the SVG itself. */
async function inlineFontFaces(): Promise<string> {
  const loadedKeys = new Set<string>()
  const loadedFams = new Set<string>()
  try {
    document.fonts.forEach((f) => {
      if (f.status !== 'loaded') return
      loadedKeys.add(`${normFam(f.family)}|${f.style}|${f.weight}|${normRange(f.unicodeRange)}`)
      loadedFams.add(normFam(f.family))
    })
  } catch { /* FontFaceSet unavailable → system fonts only */ }
  if (!loadedFams.size) return ''
  const out: string[] = []
  let total = 0
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { continue } // cross-origin sheet
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const st = rule.style
      const fam = normFam(st.getPropertyValue('font-family'))
      if (!loadedFams.has(fam)) continue
      const style = (st.getPropertyValue('font-style') || 'normal').trim()
      const weight = (st.getPropertyValue('font-weight') || 'normal').trim()
      const range = normRange(st.getPropertyValue('unicode-range') || 'u+0-10ffff')
      const key = `${fam}|${style}|${weight}|${range}`
      // Exact loaded-face match, else the latin subsets of a loaded family (per-subset files:
      // FontFace normalisation differs across engines, so the fallback keeps latin text right).
      if (!loadedKeys.has(key) && !(range.includes('u+0000') || range.includes('u+0-'))) continue
      const src = st.getPropertyValue('src')
      const m = /url\((['"]?)([^'")]+)\1\)/.exec(src)
      if (!m) continue
      const data = await fetchAsDataUri(m[2])
      if (!data) continue
      total += data.length
      if (total > FONT_TOTAL_CAP) return out.join('\n')
      // Format from the file extension — the six-font palette ships .otf/.ttf too, and a wrong
      // format() hint makes the SVG document skip the face entirely.
      const fmt = /\.otf(\?|$)/i.test(m[2]) ? 'opentype' : /\.ttf(\?|$)/i.test(m[2]) ? 'truetype' : /\.woff(\?|$)/i.test(m[2]) ? 'woff' : 'woff2'
      out.push(`@font-face{font-family:${st.getPropertyValue('font-family')};font-style:${style};font-weight:${weight};unicode-range:${st.getPropertyValue('unicode-range') || 'U+0-10FFFF'};src:url("${data}") format("${fmt}");}`)
    }
  }
  return out.join('\n')
}

/** The whole app stylesheet as text (same-origin sheets), @font-face swapped for the inlined
 *  set, `:root`/`html` selectors re-pointed at `.iw-raster-root` (the clone wrapper) so theme
 *  tokens + wave-tile vars resolve inside the SVG document (whose real :root is the <svg>). */
function collectCss(): Promise<string> {
  if (!cssBundlePromise) {
    cssBundlePromise = (async () => {
      const parts: string[] = [await inlineFontFaces()]
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList
        try { rules = sheet.cssRules } catch { continue }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSFontFaceRule) continue
          parts.push(rule.cssText)
        }
      }
      return parts.join('\n')
        .replace(/:root\b/g, '.iw-raster-root')
        .replace(/(^|[\s,}])html\b/g, '$1.iw-raster-root')
    })()
  }
  return cssBundlePromise
}

/** Strip what an SVG-image document can't/mustn't render and inline same-origin <img> srcs. */
async function prepareClone(clone: HTMLElement): Promise<void> {
  // Twinkle/spark fields: hundreds of instances each carrying its own PNG data URI — the SVG
  // document would decode every one (the pool's raster art). They're WAAPI-driven ephemera the
  // bitmap doesn't need (the wave lines are CSS pseudos and survive); the live view hides them
  // on hidden layers anyway.
  clone.querySelectorAll('script, iframe, video, audio, .iw-scrub-overlay, .iw-wave-twinkles, .iw-twk-field, .iw-twk-rest').forEach((n) => n.remove())
  // Canvases lose their pixels on cloneNode — bake them to data URIs (best-effort; tainted → drop).
  // (The snapshot panes have none today; belt-and-braces for future content.)
  clone.querySelectorAll('canvas').forEach((c) => {
    try {
      const img = document.createElement('img')
      img.src = (c as HTMLCanvasElement).toDataURL()
      img.style.cssText = (c as HTMLElement).style.cssText
      img.width = (c as HTMLCanvasElement).width
      img.height = (c as HTMLCanvasElement).height
      c.replaceWith(img)
    } catch { c.remove() }
  })
  const jobs: Promise<void>[] = []
  clone.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    if (!src || src.startsWith('data:')) return
    // SMALL-RENDERED images (page-number seals, minimap logos — declared inline px) get a
    // DOWNSCALED data URI: the 95KB logo × ~125 sheet copies serialised to ~13MB of XML per
    // capture (measured — THE capture-cost bomb; the SVG doc decoded every copy).
    const m = /width:\s*([\d.]+)px/.exec(img.getAttribute('style') || '')
    const declared = m ? parseFloat(m[1]) : (Number(img.getAttribute('width')) || null)
    const job = declared !== null && declared > 0 && declared <= 128
      ? smallDataUri(src, declared)
      : fetchAsDataUri(src)
    jobs.push(job.then((data) => {
      if (data) img.setAttribute('src', data)
      else img.removeAttribute('src') // unloadable in an SVG image doc — blank beats a broken glyph
    }))
  })
  await Promise.all(jobs)
}

/** Downscaled data URI for an image rendered at `displayPx` (2× for crispness, cached per
 *  src+bucket). Falls back to the full data URI when decode/canvas fails. */
function smallDataUri(src: string, displayPx: number): Promise<string | null> {
  const px = Math.min(128, Math.max(16, Math.ceil(displayPx / 16) * 16)) * 2
  const key = `${src}@${px}`
  let p = assetDataUris.get(key)
  if (!p) {
    p = (async () => {
      const full = await fetchAsDataUri(src)
      if (!full) return null
      const img = new Image()
      const ok = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true)
        img.onerror = () => resolve(false)
        img.src = full
      })
      if (!ok || img.naturalWidth <= px) return full
      const c = document.createElement('canvas')
      c.width = px
      c.height = Math.max(1, Math.round(px * (img.naturalHeight / Math.max(1, img.naturalWidth))))
      const ctx = c.getContext('2d')
      if (!ctx) return full
      ctx.drawImage(img, 0, 0, c.width, c.height)
      try { return c.toDataURL('image/png') } catch { return full }
    })()
    assetDataUris.set(key, p)
  }
  return p
}

// ── Band trimming — the capture-cost fix ─────────────────────────────────────────────────────
// Serialising + laying out the WHOLE pane in the SVG document cost seconds on a thesis-scale doc
// (measured 4.5-13s per capture). Only the crop band matters, so the clone is trimmed to it:
// far content is Range-deleted at SAFE block boundaries and a pixel-exact spacer preserves the
// kept band's offsets. Safe boundaries: the canonical `.inkwave-page-gap` widgets (block-in-
// inline — text after one always starts a fresh line, so removing content before an earlier gap
// or after a later one can't re-wrap the kept band; the absolute `.inkwave-sheets` panel layer
// lives OUTSIDE the text flow and is untouched); fallback for the diff panel: its own block
// children. The minimap (short content) skips trimming entirely.
function trimCloneToBand(liveEl: HTMLElement, clone: HTMLElement, y0: number, y1: number): void {
  if (liveEl.scrollHeight <= (y1 - y0) * 3 + 400) return // short content — not worth it
  const elRect = liveEl.getBoundingClientRect()
  // CSS `zoom` (the diff pane's wrapper / the doc paper) renders rects in VISUAL px while
  // scrollTop/clientHeight stay LOCAL — divide rect deltas by the effective zoom factor.
  const zf = elRect.width > 0 && liveEl.offsetWidth > 0 ? elRect.width / liveEl.offsetWidth : 1
  const yTop = (r: DOMRect) => (r.top - elRect.top) / zf + liveEl.scrollTop
  const mkSpacer = (h: number) => {
    const sp = document.createElement('div')
    sp.style.cssText = `display:block;height:${Math.max(0, h)}px;margin:0;padding:0;border:0;overflow:hidden;`
    return sp
  }
  const liveGaps = Array.from(liveEl.querySelectorAll<HTMLElement>('.inkwave-page-gap'))
  const liveFlow = liveEl.querySelector<HTMLElement>('.tiptap-editor')
  const cloneFlow = clone.querySelector<HTMLElement>('.tiptap-editor')
  if (liveGaps.length >= 2 && liveFlow && cloneFlow) {
    const cloneGaps = Array.from(clone.querySelectorAll<HTMLElement>('.inkwave-page-gap'))
    if (cloneGaps.length !== liveGaps.length) return
    let si = -1, ei = -1
    for (let i = 0; i < liveGaps.length; i++) {
      const r = liveGaps[i].getBoundingClientRect()
      if (yTop(r) + r.height < y0) si = i          // last gap fully above the band
      if (ei < 0 && yTop(r) > y1) { ei = i; break } // first gap fully below the band
    }
    if (ei >= 0) { // suffix first — earlier indices/rects stay valid
      const r = document.createRange()
      r.setStartAfter(cloneGaps[ei])
      r.setEnd(cloneFlow, cloneFlow.childNodes.length)
      r.deleteContents()
    }
    if (si >= 0) {
      const r = document.createRange()
      r.setStart(cloneFlow, 0)
      r.setEndBefore(cloneGaps[si])
      r.deleteContents()
      const fr = liveFlow.getBoundingClientRect()
      const fcs = getComputedStyle(liveFlow)
      const gcs = getComputedStyle(liveGaps[si])
      // The spacer lives INSIDE the (possibly zoomed) flow — its height must be flow-local px.
      const fzf = fr.width > 0 && liveFlow.offsetWidth > 0 ? fr.width / liveFlow.offsetWidth : 1
      const h = (liveGaps[si].getBoundingClientRect().top - fr.top) / fzf
        - (parseFloat(fcs.paddingTop) || 0) - (parseFloat(fcs.borderTopWidth) || 0)
        - (parseFloat(gcs.marginTop) || 0)
      cloneFlow.insertBefore(mkSpacer(h), cloneFlow.firstChild)
    }
    return
  }
  // Fallback: direct block children of the scroller (the diff panel's hunk list).
  const liveKids = Array.from(liveEl.children) as HTMLElement[]
  const cloneKids = Array.from(clone.children) as HTMLElement[]
  if (liveKids.length !== cloneKids.length || liveKids.length < 8) return
  let first = -1, last = -1
  const rects = liveKids.map((k) => k.getBoundingClientRect())
  for (let i = 0; i < liveKids.length; i++) {
    const pos = getComputedStyle(liveKids[i]).position
    const inBand = pos === 'absolute' || pos === 'fixed' || pos === 'sticky' ||
      (yTop(rects[i]) + rects[i].height >= y0 && yTop(rects[i]) <= y1)
    if (inBand) { if (first < 0) first = i; last = i }
  }
  if (first < 0) return
  for (let i = cloneKids.length - 1; i > last; i--) cloneKids[i].remove()
  for (let i = first - 1; i >= 0; i--) cloneKids[i].remove()
  if (first > 0) {
    const cs = getComputedStyle(liveEl)
    const kcs = getComputedStyle(liveKids[first])
    const h = yTop(rects[first]) - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.borderTopWidth) || 0)
      - (parseFloat(kcs.marginTop) || 0)
    clone.insertBefore(mkSpacer(h), clone.firstChild)
  }
}

function resolveBg(el: HTMLElement): string {
  let n: HTMLElement | null = el
  while (n) {
    const c = getComputedStyle(n).backgroundColor
    if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) return c
    n = n.parentElement
  }
  return '#ffffff'
}

export interface CaptureResult {
  bitmap: ImageBitmap | null   // GPU-ready; drawImage(bitmap) into a persistent canvas = a cheap blit
  canvas: HTMLCanvasElement | null // fallback when createImageBitmap is unavailable/throws
  width: number; height: number
  bytes: number
}

/** Rasterise the viewport-region crop of `el` (its own scroll offset) into a canvas at
 *  `scale`× device resolution. Returns null when the engine produced nothing (e.g. a WebKit
 *  foreignObject failure) — callers just don't cache. */
export async function captureRegion(el: HTMLElement, scale: number): Promise<CaptureResult | null> {
  const w = el.clientWidth, h = el.clientHeight
  if (w < 10 || h < 10) return null
  const x = el.scrollLeft, y = el.scrollTop
  const css = await collectCss()
  const t0 = performance.now()

  const clone = el.cloneNode(true) as HTMLElement
  await prepareClone(clone)
  // Pin the live client box EXACTLY: width w (clientWidth excludes the scrollbar; with overflow
  // visible the clone grows none, so line wrapping is identical) AND height h — percent-height
  // children (the diff panel's lead/trail spacers, the minimap's 1fr grid rows) resolve against
  // the box height and would collapse under height:auto. Taller content simply overflows
  // (visible) and the crop picks the scrolled band.
  clone.style.margin = '0'
  clone.style.width = `${w}px`
  clone.style.height = `${h}px`
  clone.style.overflow = 'visible'
  // Trim the clone to the crop band (± half a viewport of slack) — the SVG document then lays
  // out ~2-3 pages instead of a whole thesis (whole-pane captures measured 4.5-13s; trimmed
  // captures are a few hundred ms).
  try { trimCloneToBand(el, clone, y - h / 2, y + h + h / 2) } catch { /* untrimmed still correct */ }

  const wrap = document.createElement('div')
  wrap.className = 'iw-raster-root'
  const theme = document.documentElement.getAttribute('data-theme')
  if (theme) wrap.setAttribute('data-theme', theme)
  const rootInline = document.documentElement.getAttribute('style')
  if (rootInline) wrap.setAttribute('style', rootInline)
  const cs = getComputedStyle(el)
  wrap.style.margin = '0'
  wrap.style.fontFamily = cs.fontFamily
  wrap.style.fontSize = cs.fontSize
  wrap.style.lineHeight = cs.lineHeight
  wrap.style.color = cs.color
  wrap.style.letterSpacing = cs.letterSpacing
  // Crop by layout (negative margins inside a pane-sized foreignObject with its default
  // overflow:hidden) — NOT viewBox/transform, which WebKit mishandles for foreignObject.
  wrap.style.marginLeft = `${-x}px`
  wrap.style.marginTop = `${-y}px`
  const styleEl = document.createElement('style')
  styleEl.textContent = css
  wrap.insertBefore(styleEl, wrap.firstChild)
  wrap.appendChild(clone)

  const xml = new XMLSerializer().serializeToString(wrap)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`
  probePerf('scrub.capture.xmlKB', xml.length / 1024)
  probePerf('scrub.capture.prep', performance.now() - t0)
  const tImg = performance.now()
  const img = new Image()
  img.decoding = 'async'
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
  })
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  if (!(await loaded)) return null
  try { await img.decode() } catch { /* decode() is advisory — drawImage below still works */ }
  probePerf('scrub.capture.img', performance.now() - tImg)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const tDraw = performance.now()
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  probePerf('scrub.capture.draw', performance.now() - tDraw)
  // Blank-detect BEFORE the opaque backstop: engines that refuse foreignObject-in-image (the
  // documented WebKit failure mode) paint nothing — don't cache an empty rectangle. A tainted
  // canvas throws here; it still displays fine, so treat taint as success.
  try {
    const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 8))
    let any = false
    for (let py = step >> 1; py < canvas.height && !any; py += step) {
      const row = ctx.getImageData(0, py, canvas.width, 1).data
      for (let px = 3; px < row.length; px += 4 * step) if (row[px] !== 0) { any = true; break }
    }
    if (!any) return null
  } catch { /* tainted → display-only, keep */ }
  // Opaque backstop UNDER the raster: a transparent bitmap would let the frozen pane's different
  // text peek through mid-scrub.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = resolveBg(el)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
  // Prefer a GPU-ready ImageBitmap: at show() time drawImage(bitmap) into ONE persistent per-pane
  // canvas is a GPU blit (probed max 0.1ms at DPR2), vs attaching a fresh ~12MB canvas element per
  // step which forced per-step layerization + texture upload the JS timer never saw (Peter's felt
  // lag — "not as fast as you said"). Backstop is already baked in, so the bitmap is opaque.
  let bitmap: ImageBitmap | null = null
  if (typeof createImageBitmap === 'function') {
    try { bitmap = await createImageBitmap(canvas) } catch { bitmap = null }
  }
  probePerf('scrub.capture', performance.now() - t0)
  return { bitmap, canvas: bitmap ? null : canvas, width: canvas.width, height: canvas.height, bytes: canvas.width * canvas.height * 4 }
}

// ── Presenter — overlay surfaces + cache + scrub-mode lifecycle ───────────────────────────────

interface Entry {
  key: string
  snapId: string
  kind: ScrubPaneKind
  bitmap: ImageBitmap | null   // GPU-ready source (preferred)
  canvas: HTMLCanvasElement | null // fallback source when createImageBitmap was unavailable
  width: number; height: number // backing-store dims (device px)
  scrollTop: number
  scrollLeft: number
  bytes: number
  lastUsed: number
  src: 'capture' | 'thumb' // where the pixels came from — the debug overlay separates these
}

interface Surface {
  host: HTMLElement
  getEl: () => HTMLElement | null
  getZoom: () => number
  // ONE persistent canvas per pane, attached ONCE = one stable compositor layer; show() blits into
  // it via drawImage (no per-step element attach / texture re-upload — the round-4 felt-lag fix).
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

interface Job { kind: ScrubPaneKind; snapId: string; getEl: () => HTMLElement | null }

export interface ScrubPresenter {
  registerSurface(kind: ScrubPaneKind, host: HTMLElement | null, getEl: () => HTMLElement | null, getZoom: () => number): void
  setOrder(ids: string[]): void
  noteInput(): void
  /** Flip the overlays to `snapId`'s bitmaps (nearest-cached on a miss). Call per rapid step. */
  show(snapId: string): void
  /** The live DOM committed for `snapId` — if it's the scrub target and inputs are quiet, swap. */
  notifyLanded(snapId: string | null): void
  hide(): void
  isActive(): boolean
  queueCapture(kind: ScrubPaneKind, snapId: string, getEl?: () => HTMLElement | null): void
  stats(): { entries: number; bytes: number }
  /** Does a baked thumbnail already exist for this pane+snapshot at the CURRENT signature? (sweep) */
  isThumbBaked(kind: ScrubPaneKind, snapId: string): boolean
  /** Live diagnostic state for the `?snapThumbs=debug` overlay. */
  debugInfo(): ScrubDebugInfo
  resetBurst(): void
  dispose(): void
  disposed: boolean
}

export interface ScrubPaneDebug {
  kind: ScrubPaneKind
  hitCapture: number   // exact, from a live render capture
  hitThumb: number     // exact, HYDRATED from the OPFS thumbnail store
  nearest: number      // stale fallback — a DIFFERENT version's pixels
  none: number         // nothing to show → overlay hidden, the frozen live pane shows
  // Is the overlay actually PAINTED? (the wave-video bug class: "playing" into an invisible node)
  visible: boolean
  display: string; opacity: string; visibility: string; zIndex: string
  rectW: number; rectH: number      // on-screen box
  canvasW: number; canvasH: number  // canvas BACKING STORE (0 = nothing ever drawn)
}
export interface ScrubDebugInfo {
  entries: number; bytes: number
  shows: number           // show() calls this burst
  panes: ScrubPaneDebug[]
}

export function createScrubPresenter(opts: { touch: boolean; getLiveId: () => string | null; getDocId?: () => string | null }): ScrubPresenter {
  const budget = opts.touch ? TOUCH_BUDGET : DESKTOP_BUDGET
  const dprOf = () => {
    const d = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const cap = (typeof window !== 'undefined' && (window as unknown as { __iwRasterDprCap?: number }).__iwRasterDprCap) || RASTER_DPR_CAP
    return Math.min(d, opts.touch ? Math.min(2, cap) : cap)
  }

  const surfaces = new Map<ScrubPaneKind, Surface>()
  const entries = new Map<string, Entry>()
  const queue = new Map<string, Job>()
  let order: string[] = []
  let bytes = 0
  let tick = 0
  let lastInput = 0
  let active = false
  let target: string | null = null
  let busy = false
  let pumpTimer = 0
  let restTimer = 0
  let safetyTimer = 0
  let hideRaf = 0

  const attached = new Map<ScrubPaneKind, Entry | null>()

  // Per-burst diagnostic counters (the `?snapThumbs=debug` overlay). Zero cost when unread.
  type Cnt = { hitCapture: number; hitThumb: number; nearest: number; none: number }
  const dbg = new Map<ScrubPaneKind, Cnt>()
  let dbgShows = 0
  const cntOf = (k: ScrubPaneKind): Cnt => {
    let c = dbg.get(k)
    if (!c) { c = { hitCapture: 0, hitThumb: 0, nearest: 0, none: 0 }; dbg.set(k, c) }
    return c
  }

  const p: ScrubPresenter = {
    disposed: false,

    registerSurface(kind, host, getEl, getZoom) {
      const existing = surfaces.get(kind)
      if (!host) {
        if (existing) { existing.host.replaceChildren(); surfaces.delete(kind) }
        attached.set(kind, null)
        return
      }
      // Reuse the persistent canvas if the same host re-registers (StrictMode / re-render); else
      // mint one and attach it ONCE.
      let canvas = existing && existing.host === host ? existing.canvas : null
      let ctx = existing && existing.host === host ? existing.ctx : null
      if (!canvas || !ctx) {
        canvas = document.createElement('canvas')
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
        ctx = canvas.getContext('2d')
        if (!ctx) { surfaces.delete(kind); return }
        host.replaceChildren(canvas)
        attached.set(kind, null) // the fresh canvas holds nothing yet
      }
      surfaces.set(kind, { host, getEl, getZoom, canvas, ctx })
    },

    setOrder(ids) { order = ids },

    noteInput() { lastInput = performance.now() },

    show(snapId) {
      if (p.disposed) return
      const t0 = performance.now()
      target = snapId
      active = true
      const dpr = dprOf()
      let shown = 0
      dbgShows++
      probePerf('scrub.want', order.indexOf(snapId)) // version-fidelity: commanded target index
      preloadThumbs(snapId) // hydrate this + a small direction window from the OPFS thumbnail cache
      for (const [kind, s] of surfaces) {
        const el = s.getEl()
        if (!el) { s.host.style.display = 'none'; continue }
        const zoom = s.getZoom()
        const exact = entries.get(rasterKey(kind, snapId, el.clientWidth, el.clientHeight, zoom, dpr))
        let entry: Entry | null = exact ?? null
        if (!entry) {
          // Miss → nearest cached snapshot in the SAME bucket (never a blank flash).
          // rasterKey(kind, '', …) = `${kind}||WxH|z…|d…` — slicing off `${kind}|` leaves the
          // `|WxH|z…|d…` suffix every same-bucket key ends with.
          const bucketSuffix = rasterKey(kind, '', el.clientWidth, el.clientHeight, zoom, dpr).slice(kind.length + 1)
          const cands = new Map<string, Entry>()
          for (const e of entries.values()) {
            if (e.kind !== kind) continue
            if (!e.key.endsWith(bucketSuffix)) continue
            const prev = cands.get(e.snapId)
            if (!prev || e.lastUsed > prev.lastUsed) cands.set(e.snapId, e)
          }
          const near = pickNearest(order, cands.keys(), snapId)
          entry = near ? cands.get(near) ?? null : null
        }
        if (entry) {
          // version-fidelity, PER PANE: was this pane an EXACT hit (real content — a live capture
          // or a hydrated thumbnail) vs a nearest-fallback (stale). scrub.shown/scrub.exact keep
          // the doc-pane series; scrub.exact.<kind> reports each pane separately.
          probePerf('scrub.exact.' + kind, entry === exact ? 1 : 0)
          if (kind === 'doc') { probePerf('scrub.shown', order.indexOf(entry.snapId)); probePerf('scrub.exact', entry === exact ? 1 : 0) }
          const c = cntOf(kind)
          if (entry === exact) { if (entry.src === 'thumb') c.hitThumb++; else c.hitCapture++ } else c.nearest++
          entry.lastUsed = ++tick
          if (attached.get(kind) !== entry) {
            drawEntry(s, entry) // GPU blit into the persistent canvas — no element churn
            attached.set(kind, entry)
          }
          s.host.style.display = 'block'
          shown++
        } else {
          cntOf(kind).none++ // nothing cached for this bucket at all — the frozen live pane shows
          s.host.style.display = 'none' // no bitmap → the frozen live pane shows (not blank)
          attached.set(kind, null)
        }
      }
      armRest()
      probePerf(shown ? 'scrub.step' : 'scrub.step.miss', performance.now() - t0)
    },

    notifyLanded(snapId) {
      if (!active || snapId === null || snapId !== target) return
      if (performance.now() - lastInput < REST_MS - 10) return // still scrubbing — rest timer re-arms
      scheduleHide()
    },

    hide() { doHide() },

    isActive() { return active },

    queueCapture(kind, snapId, getEl) {
      if (p.disposed) return
      const s = surfaces.get(kind)
      const resolve = getEl ?? s?.getEl
      if (!resolve) return
      queue.set(`${kind}|${snapId}`, { kind, snapId, getEl: resolve })
      pump()
    },

    stats() { return { entries: entries.size, bytes } },

    isThumbBaked(kind, snapId) {
      const docId = opts.getDocId?.(); if (!docId) return false
      const s = surfaces.get(kind); const el = s?.getEl(); if (!s || !el) return false
      const zoom = s.getZoom(), dpr = dprOf()
      return hasThumb(docId, snapId, kind as ThumbPane, thumbSig(kind, el.clientWidth, el.clientHeight, zoom, dpr))
    },

    resetBurst() { dbg.clear(); dbgShows = 0 },

    debugInfo() {
      const panes: ScrubPaneDebug[] = []
      for (const [kind, s] of surfaces) {
        const c = cntOf(kind)
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(s.host) : null
        const r = s.host.getBoundingClientRect()
        const display = cs?.display ?? '?', opacity = cs?.opacity ?? '?', visibility = cs?.visibility ?? '?'
        panes.push({
          kind, hitCapture: c.hitCapture, hitThumb: c.hitThumb, nearest: c.nearest, none: c.none,
          // "Painted" = the overlay box is displayed, non-transparent, on-screen, AND its canvas has
          // a real backing store. A 0×0 canvas or display:none = swapping into nothing (the bug class
          // the wave-video overlay caught: perfect state, zero pixels).
          visible: display !== 'none' && visibility !== 'hidden' && parseFloat(opacity || '0') > 0.01
            && r.width > 1 && r.height > 1 && s.canvas.width > 1 && s.canvas.height > 1,
          display, opacity, visibility, zIndex: cs?.zIndex ?? '?',
          rectW: Math.round(r.width), rectH: Math.round(r.height),
          canvasW: s.canvas.width, canvasH: s.canvas.height,
        })
      }
      return { entries: entries.size, bytes, shows: dbgShows, panes }
    },

    dispose() {
      p.disposed = true
      window.clearTimeout(pumpTimer); window.clearTimeout(restTimer); window.clearTimeout(safetyTimer)
      cancelAnimationFrame(hideRaf)
      queue.clear()
      for (const e of entries.values()) { e.bitmap?.close(); if (e.canvas) { e.canvas.width = 0; e.canvas.height = 0 } }
      entries.clear()
      bytes = 0
      for (const s of surfaces.values()) { s.host.style.display = 'none'; s.host.replaceChildren() }
      surfaces.clear()
      attached.clear()
    },
  }

  // Blit an entry's source (ImageBitmap preferred; canvas fallback) into the surface's persistent
  // canvas. Resizing the backing store clears it — only happens across zoom/width buckets, not
  // step-to-step — so the common path is a single drawImage.
  function drawEntry(s: Surface, e: Entry) {
    const cv = s.canvas
    if (cv.width !== e.width || cv.height !== e.height) { cv.width = e.width; cv.height = e.height }
    const src = (e.bitmap ?? e.canvas) as CanvasImageSource | null
    if (src) s.ctx.drawImage(src, 0, 0) // backstop is baked into the source → opaque, no clear needed
  }

  // ── OPFS thumbnail cache (snapThumbs) — bake on capture, hydrate on a cold miss ───────────────
  // Per-pane RENDER-SIGNATURE: a pane only re-bakes / matches when an input that changes ITS pixels
  // changes. doc/diff depend on body font + theme + their pane box + zoom; the minimap depends only
  // on its box + theme (its diff ticks come from immutable snapshot geometry, not the body font).
  const HYDRATE_AHEAD = 5
  const hydrating = new Set<string>()
  let fontsSigCache = ''
  let fontsSigAt = 0
  function fontsSig(): string {
    const now = performance.now()
    if (now - fontsSigAt < 2000 && fontsSigCache) return fontsSigCache
    let s = '0'
    try {
      const fams = new Set<string>()
      document.fonts.forEach((f) => { if (f.status === 'loaded') fams.add(f.family) })
      s = thumbHash([...fams].sort().join(','))
    } catch { /* system fonts only */ }
    fontsSigCache = s; fontsSigAt = now
    return s
  }
  function thumbSig(kind: ScrubPaneKind, w: number, h: number, zoom: number, dpr: number): string {
    const theme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'day'
    const box = `${Math.round(w)}x${Math.round(h)}|d${dpr.toFixed(2)}`
    if (kind === 'map') return `${box}|${theme}` // minimap: box + theme only (no body-font/zoom dep)
    return `${box}|z${zoom.toFixed(3)}|${theme}|f${fontsSig()}`
  }
  function bakeThumb(kind: ScrubPaneKind, snapId: string, w: number, h: number, zoom: number, dpr: number, src: CanvasImageSource | null, srcW: number, srcH: number) {
    if (!src || !snapThumbsEnabled()) return
    const docId = opts.getDocId?.(); if (!docId) return
    // Draw the downscaled thumb SYNCHRONOUSLY (the source bitmap is alive now) into a detached
    // canvas, so the async WebP encode can't race the entry's eviction/close.
    const scale = thumbScale(kind as ThumbPane)
    const tw = Math.max(1, Math.round(srcW * scale)), th = Math.max(1, Math.round(srcH * scale))
    try {
      const tc = document.createElement('canvas'); tc.width = tw; tc.height = th
      const tctx = tc.getContext('2d'); if (!tctx) return
      tctx.drawImage(src, 0, 0, tw, th)
      void putThumb(docId, snapId, kind as ThumbPane, thumbSig(kind, w, h, zoom, dpr), tc, tw, th, 1)
    } catch { /* thumbnail is best-effort */ }
  }
  function hydrate(kind: ScrubPaneKind, snapId: string) {
    const docId = opts.getDocId?.(); if (!docId) return
    const s = surfaces.get(kind); const el = s?.getEl(); if (!s || !el) return
    const zoom = s.getZoom(), dpr = dprOf()
    const w = el.clientWidth, h = el.clientHeight
    const key = rasterKey(kind, snapId, w, h, zoom, dpr)
    if (entries.has(key) || hydrating.has(key)) return
    const sig = thumbSig(kind, w, h, zoom, dpr)
    if (!hasThumb(docId, snapId, kind as ThumbPane, sig)) return
    hydrating.add(key)
    void (async () => {
      try {
        const blob = await getThumb(docId, snapId, kind as ThumbPane, sig)
        if (!blob || p.disposed || entries.has(key)) return
        const bmp = await createImageBitmap(blob)
        const b = bmp.width * bmp.height * 4
        entries.set(key, { key, snapId, kind, bitmap: bmp, canvas: null, width: bmp.width, height: bmp.height, scrollTop: 0, scrollLeft: 0, bytes: b, lastUsed: ++tick, src: 'thumb' })
        bytes += b; enforceBudget()
      } catch { /* decode failed — the live path still renders */ } finally { hydrating.delete(key) }
    })()
  }
  function preloadThumbs(center: string) {
    if (!snapThumbsEnabled()) return
    const docId = opts.getDocId?.(); if (!docId) return
    void loadThumbIndex(docId) // idempotent; until it resolves hasThumb() is false (safe)
    const ci = order.indexOf(center); if (ci < 0) { for (const k of surfaces.keys()) hydrate(k, center); return }
    for (let d = 0; d <= HYDRATE_AHEAD; d++) {
      for (const dir of d === 0 ? [0] : [1, -1]) {
        const i = ci + d * dir
        if (i < 0 || i >= order.length) continue
        for (const k of surfaces.keys()) hydrate(k, order[i])
      }
    }
  }

  function armRest() {
    window.clearTimeout(restTimer)
    window.clearTimeout(safetyTimer)
    restTimer = window.setTimeout(() => {
      if (!active) return
      if (opts.getLiveId() === target) scheduleHide()
      // else: the landing snapshot is still rendering — notifyLanded finishes the swap.
      safetyTimer = window.setTimeout(doHide, SAFETY_HIDE_MS) // overlay may never stick
    }, REST_MS)
  }

  function scheduleHide() {
    // Two rAFs after the live commit ≈ after its first paint — the bitmap lifts off an
    // already-painted identical frame (the seamless swap).
    cancelAnimationFrame(hideRaf)
    hideRaf = requestAnimationFrame(() => { hideRaf = requestAnimationFrame(doHide) })
  }

  function doHide() {
    if (!active) return
    active = false
    target = null
    window.clearTimeout(restTimer); window.clearTimeout(safetyTimer)
    cancelAnimationFrame(hideRaf)
    for (const s of surfaces.values()) s.host.style.display = 'none'
    probePerf('scrub.swap', 0)
    pump() // captures deferred during the scrub can run now
  }

  function pump() {
    if (p.disposed || pumpTimer || busy || !queue.size) return
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const idle = (cb: () => void) => {
      if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 800 })
      else window.setTimeout(cb, 180) // WebKit has no rIC
    }
    pumpTimer = window.setTimeout(() => {
      pumpTimer = 0
      idle(() => { void runOne() })
    }, 60)
  }

  async function runOne() {
    if (p.disposed || busy) return
    if (active || performance.now() - lastInput < CAPTURE_QUIET_MS || document.hidden) {
      if (queue.size) { pumpTimer = window.setTimeout(() => { pumpTimer = 0; pump() }, 400) }
      return
    }
    const picked = pickJob()
    if (!picked) return
    const [jobKey, job] = picked
    queue.delete(jobKey)
    const el = job.getEl()
    const s = surfaces.get(job.kind)
    if (el && el.isConnected && s) {
      const dpr = dprOf()
      const zoom = s.getZoom()
      const key = rasterKey(job.kind, job.snapId, el.clientWidth, el.clientHeight, zoom, dpr)
      const existing = entries.get(key)
      if (!existing || existing.scrollTop !== el.scrollTop || existing.scrollLeft !== el.scrollLeft) {
        busy = true
        try {
          const scale = dpr * (ZOOM_IN_SCALE[job.kind] ? zoom : 1)
          const res = await captureRegion(el, scale)
          if (res && (res.bitmap || res.canvas) && !p.disposed) {
            if (existing) evictOne(existing)
            const entry: Entry = {
              key, snapId: job.snapId, kind: job.kind, bitmap: res.bitmap, canvas: res.canvas,
              width: res.width, height: res.height,
              scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, bytes: res.bytes, lastUsed: ++tick,
              src: 'capture',
            }
            entries.set(key, entry)
            bytes += res.bytes
            enforceBudget()
            probePerf('scrub.mem', bytes / 1e6)
            bakeThumb(job.kind, job.snapId, el.clientWidth, el.clientHeight, zoom, dpr, res.bitmap ?? res.canvas, res.width, res.height)
          } else if (res && res.bitmap) { res.bitmap.close() }
        } catch { /* capture failed — stay uncached, the live path still works */ }
        busy = false
      }
    }
    if (queue.size) pump()
  }

  // Capture PRIORITY (round 4): nearest-to-the-scrub-position first, and within the same
  // proximity DOC then MAP then DIFF — the doc pane + minimap are the slow, felt-laggy ones Peter
  // named ("summaries faster than the minimap and editor"); capturing them ahead of the diff
  // covers the reachable window fastest.
  const KIND_RANK: Record<ScrubPaneKind, number> = { doc: 0, map: 1, diff: 2 }
  function pickJob(): [string, Job] | null {
    const focus = target ?? opts.getLiveId()
    const fi = focus ? order.indexOf(focus) : -1
    let best: [string, Job] | null = null, bestScore = Infinity
    for (const kv of queue) {
      const oi = order.indexOf(kv[1].snapId)
      const prox = oi >= 0 && fi >= 0 ? Math.abs(oi - fi) : 50
      const score = prox * 10 + KIND_RANK[kv[1].kind]
      if (score < bestScore) { bestScore = score; best = kv }
    }
    return best
  }

  function evictOne(e: Entry) {
    entries.delete(e.key)
    bytes -= e.bytes
    e.bitmap?.close(); e.bitmap = null
    if (e.canvas) { e.canvas.width = 0; e.canvas.height = 0; e.canvas = null } // release now
    for (const [k, v] of attached) if (v === e) attached.set(k, null)
  }

  function enforceBudget() {
    if (bytes <= budget) return
    const ti = target ? order.indexOf(target) : -1
    const items = [...entries.values()].map((e) => ({
      key: e.key, bytes: e.bytes, lastUsed: e.lastUsed,
      // Protect the scrub window around the target (±3 — widened for full-res retention) and
      // whatever is on screen right now.
      protected: (attached.get(e.kind) === e) ||
        (ti >= 0 && Math.abs(order.indexOf(e.snapId) - ti) <= 3),
    }))
    for (const key of planEviction(items, bytes - budget)) {
      const e = entries.get(key)
      if (e && attached.get(e.kind) !== e) evictOne(e)
    }
  }

  if (typeof window !== 'undefined') {
    ;(window as unknown as { __iwScrub?: ScrubPresenter }).__iwScrub = p // probe hook (like __iwTwkPool)
  }
  return p
}
