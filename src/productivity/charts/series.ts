// The measured/estimated/judged visual contract — build-spec §A6.1, §A8.
//
// THE STRUCTURAL POINT. A series' appearance is a FUNCTION of where its numbers came from. There is
// no `fill`/`style`/`hatched` prop anywhere in this chart set, so there is no argument a caller can
// pass — or forget to pass — that paints an AI judgement as a measurement. Getting this wrong is not
// a cosmetic bug for this product: an academic reader who catches "vibes-as-numbers" once discounts
// every number on the page, including the true ones.
//
// THREE provenances, not two. The spec names measured and judged (§A6.1), but the deep-vs-shallow
// heuristic (§A3.3) is neither: it is a deterministic RULE over measured fields — reproducible by
// anyone from the ledger, so not an AI judgement; but still an inference, so not a measurement. It
// gets its own tag and its own legend line rather than being quietly folded into either.

export type Provenance = 'measured' | 'estimated' | 'judged'

export interface SeriesStyle {
  /** Solid fill, or `none` for outline-only marks. */
  fill: string
  stroke: string
  /** SVG dash pattern for the outline; empty = solid. */
  dash: string
  /** id of the <pattern> overlay painted over the mark, or null for a plain fill. */
  hatch: string | null
  /** The legend's plain-English gloss — the sentence that says which is which (§A8). */
  legend: string
}

/**
 * Palette notes (§A5, §C3 — kind, non-shaming):
 * NO RED-MEANS-BAD anywhere in this chart set. A low day is not an alarm and deleted words are not
 * damage — cutting is writing. Measured series use the app's calm ink purple; the judged overlay
 * borrows `--iw-badge-ai`, the amber this app ALREADY uses to mark AI-sourced material in
 * CitationPanel, so "amber = a machine said this" stays consistent across the product.
 * Every colour is a theme token with a day fallback (CLAUDE.md THEMING), so night mode is automatic.
 */
export const SERIES_STYLE: Record<Provenance, SeriesStyle> = {
  measured: {
    fill: 'var(--iw-ink, #302438)',
    stroke: 'var(--iw-ink, #302438)',
    dash: '',
    hatch: null,
    legend: 'measured — counted from your own writing record',
  },
  estimated: {
    fill: 'none',
    stroke: 'var(--iw-light, #41425b)',
    dash: '3 2',
    hatch: null,
    legend: 'estimated — a rule applied to the measured numbers, not a measurement',
  },
  judged: {
    fill: 'var(--iw-badge-ai, #b45309)',
    stroke: 'var(--iw-badge-ai, #b45309)',
    dash: '2 2',
    hatch: 'iw-hatch-judged',
    legend: 'AI interpretation — an opinion about the numbers, not a number',
  },
}

/** One plotted series. `provenance` is mandatory: there is no way to plot untagged data. */
export interface Series {
  provenance: Provenance
  /** Short name shown in the legend beside the provenance gloss. */
  label: string
  values: number[]
}

/** Opacity for a hatched (judged) mark — deliberately lighter so it reads as an overlay, not a bar. */
export const JUDGED_FILL_OPACITY = 0.22
