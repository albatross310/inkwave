// CSS Custom Highlight API wrapper for hover-to-source.
// Finds a citation's stored source quote in the DOM and highlights it without any DOM mutation.
// Falls back silently when: Custom Highlight API absent, no match, or a hallucinated quote.
// See citations spec §8.

const HIGHLIGHT_NAME = 'inkwave-source'

// normNode: per-node normaliser — NO trim. Preserves trailing/leading spaces so that
// cross-element names ("Tyler " in one span + "Graham" in the next) concatenate with
// a space rather than collapsing to "tylergraham".
function normNode(s: string): string {
  return s
    .normalize('NFC')
    .replace(/ | | /g, ' ')   // NBSP + narrow spaces → regular space
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/­/g, '')        // soft hyphens
    .replace(/[​-‏⁠﻿]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .toLowerCase()
  // no .trim() — trimming strips the inter-node space that cross-element names need
}

// norm: used for the search needle only — trim is fine here.
function norm(s: string): string {
  return normNode(s).trim()
}

interface TextNode { node: Text; start: number; end: number }

// Build a flat list of (text-node, start, end) with character positions in the page's text.
function collectTextNodes(root: Element): { flat: string; nodes: TextNode[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: TextNode[] = []
  let pos = 0
  const flatParts: string[] = []
  let node: Text | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement
    if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue
    const raw = node.textContent ?? ''
    if (!raw) continue
    const normed = normNode(raw)  // no trim per-node
    flatParts.push(normed)
    nodes.push({ node, start: pos, end: pos + normed.length })
    pos += normed.length
  }
  return { flat: flatParts.join(''), nodes }
}

// Given a flat-text offset, find the DOM text node + character offset within it.
function resolveOffset(offset: number, nodes: TextNode[]): { node: Text; offset: number } | null {
  for (const n of nodes) {
    if (offset >= n.start && offset < n.end) {
      return { node: n.node, offset: offset - n.start }
    }
  }
  return null
}

/** Remove any active source highlight. */
export function clearHighlight(): void {
  if (!CSS.highlights) return
  CSS.highlights.delete(HIGHLIGHT_NAME)
}

/**
 * Highlight `quote` text in the page body using the CSS Custom Highlight API.
 * Returns true if a match was found, false on no-match/API-absent/error.
 */
export function highlightQuote(quote: string): boolean {
  try {
    if (!CSS.highlights) return false
    clearHighlight()
    const target = document.body
    const { flat, nodes } = collectTextNodes(target)
    const needle = norm(quote)
    if (!needle) return false

    // Build a regex that allows \s+ between words. This handles the double-space that
    // arises when two adjacent text nodes each contribute whitespace between them
    // (e.g. "Tyler " + " Graham" → "tyler  graham" in flat, but needle is "tyler graham").
    const pattern = needle.replace(/\s+/g, '\\s+')
    const re = new RegExp(pattern)
    const match = re.exec(flat)
    if (!match) return false

    const idx = match.index
    const endIdx = idx + match[0].length  // actual matched length (may differ from needle.length)

    const startNode = resolveOffset(idx, nodes)
    const endNode = resolveOffset(endIdx - 1, nodes)
    if (!startNode || !endNode) return false

    const range = document.createRange()
    range.setStart(startNode.node, startNode.offset)
    range.setEnd(endNode.node, endNode.offset + 1)

    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))

    // Scroll the match into view via window.scrollTo (not scrollIntoView, which targets
    // the nearest scroll ancestor — often the site's own container — and silently does nothing).
    const rect = range.getBoundingClientRect()
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - window.innerHeight / 2),
      behavior: motionOk ? 'smooth' : 'instant',
    })

    return true
  } catch {
    return false
  }
}
