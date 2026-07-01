// CSS Custom Highlight API wrapper for hover-to-source.
// Finds a citation's stored source quote in the DOM and highlights it without any DOM mutation.
// Falls back silently when: Custom Highlight API absent, no match, or a hallucinated quote.
// See citations spec §8.

const HIGHLIGHT_NAME = 'inkwave-source'

// Normalise text for robust matching: NFC, NBSP→space, smart quotes/dashes, collapsed whitespace.
function norm(s: string): string {
  return s
    .normalize('NFC')
    .replace(/ | | /g, ' ')   // NBSP + narrow spaces
    .replace(/['']/g, "'")                    // smart apostrophes
    .replace(/[""]/g, '"')                   // smart double-quotes
    .replace(/[–—]/g, '-')                    // en/em dashes
    .replace(/­/g, '')                   // soft hyphens
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

interface TextNode { node: Text; start: number; end: number }

// Build a flat list of (text-node, start, end) with character positions in the page's text.
function collectTextNodes(root: Element): { flat: string; nodes: TextNode[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: TextNode[] = []
  let pos = 0
  let flatParts: string[] = []
  let node: Text | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement
    // Skip script/style/invisible nodes.
    if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue
    const raw = node.textContent ?? ''
    if (!raw) continue
    const normed = norm(raw)
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

    const idx = flat.indexOf(needle)
    if (idx === -1) return false

    const startNode = resolveOffset(idx, nodes)
    const endNode = resolveOffset(idx + needle.length - 1, nodes)
    if (!startNode || !endNode) return false

    const range = document.createRange()
    range.setStart(startNode.node, startNode.offset)
    range.setEnd(endNode.node, endNode.offset + 1)

    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))

    // Scroll the match into view (respect prefers-reduced-motion).
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    try {
      range.startContainer.parentElement?.scrollIntoView({
        behavior: motionOk ? 'smooth' : 'instant',
        block: 'center',
      })
    } catch {
      // scrollIntoView may fail on detached nodes.
    }

    return true
  } catch {
    return false
  }
}
