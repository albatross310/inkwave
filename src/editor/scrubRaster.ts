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

export type ScrubPaneKind = 'doc' | 'diff' | 'map'

// Per-kind capture semantics: the diff panel's CSS `zoom` wraps the WHOLE pane (its scroller
// measures in local/zoomed-space px), so its raster scale must include the zoom to be
// device-exact. The doc pane's zoom lives INSIDE the content (on the paper — cloned with it)
// and the minimap has none, so both raster at plain DPR.
const ZOOM_IN_SCALE: Record<ScrubPaneKind, boolean> = { doc: false, diff: true, map: false }

const DESKTOP_BUDGET = 60 * 1024 * 1024
const TOUCH_BUDGET = 24 * 1024 * 1024
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
      out.push(`@font-face{font-family:${st.getPropertyValue('font-family')};font-style:${style};font-weight:${weight};unicode-range:${st.getPropertyValue('unicode-range') || 'U+0-10FFFF'};src:url("${data}") format("woff2");}`)
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
  clone.querySelectorAll('script, iframe, video, audio, .iw-scrub-overlay').forEach((n) => n.remove())
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
    jobs.push(fetchAsDataUri(src).then((data) => {
      if (data) img.setAttribute('src', data)
      else img.removeAttribute('src') // unloadable in an SVG image doc — blank beats a broken glyph
    }))
  })
  await Promise.all(jobs)
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

export interface CaptureResult { canvas: HTMLCanvasElement; bytes: number }

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
  const img = new Image()
  img.decoding = 'async'
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
  })
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  if (!(await loaded)) return null
  try { await img.decode() } catch { /* decode() is advisory — drawImage below still works */ }

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
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
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
  probePerf('scrub.capture', performance.now() - t0)
  return { canvas, bytes: canvas.width * canvas.height * 4 }
}

// ── Presenter — overlay surfaces + cache + scrub-mode lifecycle ───────────────────────────────

interface Entry {
  key: string
  snapId: string
  kind: ScrubPaneKind
  canvas: HTMLCanvasElement
  scrollTop: number
  scrollLeft: number
  bytes: number
  lastUsed: number
}

interface Surface {
  host: HTMLElement
  getEl: () => HTMLElement | null
  getZoom: () => number
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
  dispose(): void
  disposed: boolean
}

export function createScrubPresenter(opts: { touch: boolean; getLiveId: () => string | null }): ScrubPresenter {
  const budget = opts.touch ? TOUCH_BUDGET : DESKTOP_BUDGET
  const dprOf = () => {
    const d = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    return opts.touch ? Math.min(d, 2) : d // Peter: desktop = full screen resolution; phone caps at 2
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

  const p: ScrubPresenter = {
    disposed: false,

    registerSurface(kind, host, getEl, getZoom) {
      if (!host) { surfaces.delete(kind); return }
      surfaces.set(kind, { host, getEl, getZoom })
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
          entry.lastUsed = ++tick
          if (attached.get(kind) !== entry) {
            s.host.replaceChildren(entry.canvas)
            attached.set(kind, entry)
          }
          s.host.style.display = 'block'
          shown++
        } else {
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

    dispose() {
      p.disposed = true
      window.clearTimeout(pumpTimer); window.clearTimeout(restTimer); window.clearTimeout(safetyTimer)
      cancelAnimationFrame(hideRaf)
      queue.clear()
      for (const e of entries.values()) { e.canvas.width = 0; e.canvas.height = 0 }
      entries.clear()
      bytes = 0
      for (const s of surfaces.values()) { s.host.style.display = 'none'; s.host.replaceChildren() }
      surfaces.clear()
      attached.clear()
    },
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
    const first = queue.entries().next().value as [string, Job] | undefined
    if (!first) return
    const [jobKey, job] = first
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
          if (res && !p.disposed) {
            if (existing) evictOne(existing)
            const entry: Entry = {
              key, snapId: job.snapId, kind: job.kind, canvas: res.canvas,
              scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, bytes: res.bytes, lastUsed: ++tick,
            }
            entries.set(key, entry)
            bytes += res.bytes
            enforceBudget()
            probePerf('scrub.mem', bytes / 1e6)
          }
        } catch { /* capture failed — stay uncached, the live path still works */ }
        busy = false
      }
    }
    if (queue.size) pump()
  }

  function evictOne(e: Entry) {
    entries.delete(e.key)
    bytes -= e.bytes
    if (attached.get(e.kind) === e) { attached.set(e.kind, null) }
    else { e.canvas.width = 0; e.canvas.height = 0 } // release the backing store now
  }

  function enforceBudget() {
    if (bytes <= budget) return
    const ti = target ? order.indexOf(target) : -1
    const items = [...entries.values()].map((e) => ({
      key: e.key, bytes: e.bytes, lastUsed: e.lastUsed,
      // Protect the scrub window around the target (and whatever is on screen right now).
      protected: (attached.get(e.kind) === e) ||
        (ti >= 0 && Math.abs(order.indexOf(e.snapId) - ti) <= 2),
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
