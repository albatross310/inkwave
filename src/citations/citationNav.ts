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
    .iw-cite-flash { animation: iw-cite-flash-kf 1.6s ease-out forwards; border-radius: 3px; }
    @keyframes iw-cite-flash-kf {
      0%, 55% { outline: 2px solid ${INK}; outline-offset: 2px; background-color: rgba(92,45,138,0.12); }
      100%    { outline: 2px solid transparent; outline-offset: 2px; background-color: transparent; }
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
  `
  document.head.appendChild(el)
}

// ── Navigate + flash ────────────────────────────────────────────────────────────

let flashTimer: number | undefined
export function navigateToAnchor(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Clear any prior flash, force reflow, re-add so the animation restarts even on repeat clicks.
  document.querySelectorAll('.iw-cite-flash').forEach(n => n.classList.remove('iw-cite-flash'))
  void (el as HTMLElement).offsetWidth
  el.classList.add('iw-cite-flash')
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => el.classList.remove('iw-cite-flash'), 1700)
}

// ── Occurrence counting ─────────────────────────────────────────────────────────

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
