// Bidirectional citation ↔ bibliography navigation.
//
// In-text citations link forward to their reference entry; reference entries carry back-reference
// markers ("↩ 1 2 3") — one per place the source is cited — that link back to each occurrence.
// Both directions share: the DOM anchor id scheme below, one injected stylesheet (hover = light
// purple, click destination flashes a dark-purple outline), and one navigate-and-flash helper.
//
// Occurrence numbering is document-order, per citekey, 1-based, counting each citekey-appearance in
// each citation node. The in-text NodeView and the reference list compute it the same way so the
// anchors on both ends line up.

import type { Node as PMNode } from '@tiptap/pm/model'
import { getPaperSize, getOrientation } from '../editor/pageSettings'
import { gappedPagesEnabled } from '../editor/pageView'

const INK = '#5c2d8a'
const STYLE_ID = 'iw-citation-nav-styles'

// ── Anchor ids ────────────────────────────────────────────────────────────────
// Read back with getElementById (NOT querySelector) so odd citekey characters need no CSS escaping.

export const bibAnchorId = (key: string) => `iwbib-${key}`
export const citeAnchorId = (key: string, occ: number) => `iwcite-${key}-${occ}`

// ── Stylesheet (injected once) ──────────────────────────────────────────────────

export function ensureNavStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
    .iw-cite-link { cursor: pointer; border-radius: 3px; text-decoration: none; transition: background-color 120ms ease; }
    .iw-cite-link:hover { background-color: rgba(92,45,138,0.14); }
    /* Destination flash: a DARK purple wash that decays roughly exponentially over ~1.6s to orient the
       reader after a jump. The keyframe stops approximate e^-t (big early drop, long tail). */
    .iw-cite-flash { animation: iw-cite-flash-kf 1.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards; border-radius: 3px; }
    @keyframes iw-cite-flash-kf {
      0%   { background-color: rgba(92,45,138,0.42); color: #fff; box-shadow: 0 0 0 3px rgba(92,45,138,0.42); }
      25%  { background-color: rgba(92,45,138,0.24); box-shadow: 0 0 0 3px rgba(92,45,138,0.24); }
      55%  { background-color: rgba(92,45,138,0.10); box-shadow: 0 0 0 3px rgba(92,45,138,0.10); }
      100% { background-color: transparent; color: inherit; box-shadow: 0 0 0 3px transparent; }
    }
    .iw-backref-group { margin-left: 0.5em; font-size: 1em; color: ${INK}99; user-select: none; white-space: nowrap; }
    .iw-backref-group .iw-backref-arrow { font-size: 1.15em; }
    .iw-backref-group .iw-cite-link { color: ${INK}; font-weight: 600; padding: 0 0.22em; }
    .iw-note-add {
      margin-left: 0.5em; font-size: 0.95em; line-height: 1; color: ${INK}; cursor: pointer;
      border: 1px solid ${INK}44; border-radius: 4px; background: transparent; padding: 0 0.35em;
      user-select: none; transition: background-color 120ms ease, border-color 120ms ease;
    }
    .iw-note-add:hover { background-color: rgba(92,45,138,0.12); border-color: ${INK}88; }
    .iw-esp { font-style: italic; color: #3a1e5e; font-size: 0.95em; }
    .iw-cite-biblink {
      margin-left: 0.1em; font-size: 0.62em; vertical-align: super; line-height: 0;
      color: var(--iw-cite-color, ${INK}); opacity: 0.55; cursor: pointer; border: none;
      background: transparent; padding: 0 0.1em; user-select: none; font-family: inherit;
    }
    .iw-cite-biblink:hover { opacity: 1; }
  `
  document.head.appendChild(el)
}

// ── Navigate + flash ────────────────────────────────────────────────────────────

// The reader's last position BEFORE a citation jump, so clicking a citation can bring them straight
// back to where they were reading. Stored as the editor scroll container's scrollTop (or window scrollY
// on phone). Remembered on every navigate; restored by goToLastPosition().
let returnScroll: { el: HTMLElement | Window; top: number } | null = null
function editorScroller(): HTMLElement | Window {
  return (document.querySelector('.inkwave-editor-surface.iw-fill') as HTMLElement | null)
    ?? (document.querySelector('.inkwave-editor-surface') as HTMLElement | null)
    ?? window
}
export function rememberReturn(): void {
  const s = editorScroller()
  returnScroll = { el: s, top: s === window ? window.scrollY : (s as HTMLElement).scrollTop }
}
/** Scroll back to where the reader was before their last citation jump. */
export function goToLastPosition(): void {
  if (!returnScroll) return
  const { el, top } = returnScroll
  if (el === window) window.scrollTo({ top, behavior: 'smooth' })
  else (el as HTMLElement).scrollTo({ top, behavior: 'smooth' })
}

let flashTimer: number | undefined
export function navigateToAnchor(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  rememberReturn() // so a citation click can return the reader to here
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Clear any prior flash, force reflow, re-add so the animation restarts even on repeat clicks.
  document.querySelectorAll('.iw-cite-flash').forEach(n => n.classList.remove('iw-cite-flash'))
  void (el as HTMLElement).offsetWidth
  el.classList.add('iw-cite-flash')
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => el.classList.remove('iw-cite-flash'), 1700)
}

// ── Occurrence counting ─────────────────────────────────────────────────────────

// Document page (1-based) a citation element sits on, per the NONGAPPED pagination guides (page height
// = sheet width × paper ratio, same as Scroll.tsx's PageGuides). null when pages don't apply (scroll /
// gapped mode) or it can't be measured — callers then fall back to occurrence ordinals.
function docPageOf(el: HTMLElement): number | null {
  if (typeof document === 'undefined' || gappedPagesEnabled()) return null
  const paper = getPaperSize()
  if (paper === 'scroll') return null
  const sheet = el.closest('.scroll-paper') as HTMLElement | null
  if (!sheet || !sheet.clientWidth) return null
  const landscape = getOrientation() === 'landscape'
  const ratio = paper === 'letter' ? (landscape ? 8.5 / 11 : 11 / 8.5) : (landscape ? 1 / Math.SQRT2 : Math.SQRT2)
  const pageH = sheet.clientWidth * ratio
  const y = el.getBoundingClientRect().top - sheet.getBoundingClientRect().top
  return Math.max(1, Math.floor(y / pageH) + 1)
}

/** For each in-text occurrence of a citekey, the document page it sits on (measured from the DOM). */
export function occurrencePages(key: string, count: number): Array<{ occ: number; page: number | null }> {
  const out: Array<{ occ: number; page: number | null }> = []
  for (let n = 1; n <= count; n++) {
    const el = document.getElementById(citeAnchorId(key, n))
    out.push({ occ: n, page: el ? docPageOf(el) : null })
  }
  return out
}

/** Total in-text occurrences per citekey across the whole document, in order. */
export function occurrenceCounts(doc: PMNode): Map<string, number> {
  const counts = new Map<string, number>()
  doc.descendants(node => {
    if (node.type.name !== 'citation') return
    for (const k of (node.attrs.citekeys as string[]) ?? []) {
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  })
  return counts
}

// Parse a locator string ("2", "2-4", "2–4, 6") into [start,end] ranges.
function parseRanges(loc: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /(\d+)\s*[–-]\s*(\d+)|(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(loc))) {
    if (m[1] && m[2]) out.push([Number(m[1]), Number(m[2])])
    else if (m[3]) out.push([Number(m[3]), Number(m[3])])
  }
  return out
}

/** All distinct page numbers cited for a source across the document (from citation locators), sorted. */
export function citedPages(doc: PMNode, key: string): number[] {
  const set = new Set<number>()
  doc.descendants(node => {
    if (node.type.name !== 'citation') return
    const keys = (node.attrs.citekeys as string[]) ?? []
    if (!keys.includes(key)) return
    const loc = node.attrs.locator as string | null
    if (!loc) return
    for (const [a, b] of parseRanges(loc)) for (let p = a; p <= Math.min(b, a + 999); p++) set.add(p)
  })
  return [...set].sort((x, y) => x - y)
}

/** Merge a locator string's pages with extra page numbers (e.g. highlighted pages) into "2, 4–6".
 *  A non-numeric locator ("ch. 3") is preserved when there are no numeric pages to merge. */
export function mergePages(locator: string | null | undefined, extra: number[]): string {
  const set = new Set<number>(extra)
  if (locator) for (const [a, b] of parseRanges(locator)) for (let p = a; p <= Math.min(b, a + 999); p++) set.add(p)
  const s = formatPages([...set].sort((x, y) => x - y))
  return s || (locator ?? '')
}

/** Merge sorted page numbers into a compact "2, 4–6, 9" string. */
export function formatPages(nums: number[]): string {
  if (!nums.length) return ''
  const parts: string[] = []
  let start = nums[0], prev = nums[0]
  for (let i = 1; i <= nums.length; i++) {
    if (i < nums.length && nums[i] === prev + 1) { prev = nums[i]; continue }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (i < nums.length) { start = prev = nums[i] }
  }
  return parts.join(', ')
}

/** Occurrence index (1-based) of each citekey AT the citation node located at `targetPos`. */
export function occurrencesAt(doc: PMNode, targetPos: number): Map<string, number> {
  const counts = new Map<string, number>()
  const result = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'citation') return
    const keys = (node.attrs.citekeys as string[]) ?? []
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
    if (pos === targetPos) for (const k of keys) result.set(k, counts.get(k) as number)
  })
  return result
}
