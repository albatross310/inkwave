// Tiny shared bus for citation rendering: the current CSL style id (so in-text nodes and the
// reference-list node render in the doc's chosen style without prop-drilling), plus a change tick
// the reference list subscribes to when the displayed citation set may have changed.

type Cb = () => void

let style = 'apa'
const styleSubs = new Set<Cb>()

export function getCitationStyle(): string { return style }
export function setCitationStyle(s: string): void {
  if (s && s !== style) { style = s; for (const cb of styleSubs) cb() }
}
export function subscribeCitationStyle(cb: Cb): () => void {
  styleSubs.add(cb); return () => styleSubs.delete(cb)
}
