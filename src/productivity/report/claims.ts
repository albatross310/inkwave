// Client-side enforcement of the two rules the prompt can only REQUEST — spec §A6.2 and §A6.4.
//
// "A prompt is a request, not a guarantee." Both checks below run on the reply, on the device,
// after the fact. They FLAG; they do not rewrite (§A9: never silently drop data — a narrative
// quietly edited by Inkwave would be its own integrity problem, and the writer would never know
// their model had misbehaved).
//
// HONEST LIMITS — these are heuristics over prose, and they are stated in the panel too:
//   • findCausalClaims is a marker-word scan. It cannot catch a causal claim made without any
//     causal word ("your best writing came after the walk"), and it will flag a hedged sentence
//     that merely contains a marker. It is a flag for the reader's judgement, not a proof.
//   • findUnverifiedNumbers only knows the numerals Inkwave actually sent. It cannot check a
//     number written as a word ("forty minutes") — which the fixed prompt encourages for exactly
//     the small counts where a numeral would be noise.
// Both are one-directional: a clean result means "nothing detected", never "verified honest".

// ─── §A6.2 — daily must not assert cause or pattern ─────────────────────────────────────────

export interface CausalClaim {
  /** The sentence, trimmed. */
  sentence: string
  /** The marker that fired, for the panel's explanation. */
  marker: string
}

// Markers of CAUSE (x did y to z) and of PATTERN (x is generally so). Deliberately narrow: each
// is a phrase that carries a claim on its own. Bare "so"/"then"/"after" are excluded — they are
// ordinary narration and would fire on every kind recap ever written.
const CAUSAL_MARKERS: readonly RegExp[] = [
  /\bbecause\b/i, /\bcaused?\b/i, /\bdue to\b/i, /\bthanks to\b/i, /\bled to\b/i,
  /\bresulted? in\b/i, /\bdrove\b/i, /\bmeant that\b/i, /\bhelped\b/i, /\bhurt\b/i,
  /\btherefore\b/i, /\bas a result\b/i, /\bwhich is why\b/i, /\bpaid off\b/i,
]
const PATTERN_MARKERS: readonly RegExp[] = [
  /\balways\b/i, /\bnever\b/i, /\bevery time\b/i, /\beach time\b/i, /\bwhenever\b/i,
  /\btends? to\b/i, /\btended to\b/i, /\bconsistently\b/i, /\busually\b/i, /\btypically\b/i,
  /\byour pattern\b/i, /\bthe pattern\b/i, /\ba pattern\b/i, /\bcorrelat/i, /\btrend\b/i,
  /\bbest time\b/i, /\bworst time\b/i, /\bpeak (?:time|hours?)\b/i, /\byou work best\b/i,
  /\bin general\b/i, /\bas a rule\b/i,
]

/** Split prose into sentences. Crude by design — it only has to bound a flag. */
function sentences(markdown: string): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')          // never read the CSV block as prose
    .replace(/^#{1,6}\s+.*$/gm, ' ')          // nor headings
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.replace(/^[-*+\s>]+/, '').trim())
    .filter(Boolean)
}

/**
 * Cause/pattern claims in a narrative. Meaningful only on the DAILY window — at weekly+ these
 * claims are legitimate (§A6.2) and the caller must not run this.
 */
export function findCausalClaims(markdown: string): CausalClaim[] {
  const out: CausalClaim[] = []
  for (const s of sentences(markdown)) {
    for (const re of [...CAUSAL_MARKERS, ...PATTERN_MARKERS]) {
      const m = re.exec(s)
      if (m) { out.push({ sentence: s, marker: m[0] }); break }
    }
  }
  return out
}

// ─── §A6.4 — numbers Inkwave did not send ───────────────────────────────────────────────────

const NUMBER = /\d[\d,]*(?:\.\d+)?/g

/** Normalise so "1,240" and "1240" match, and "07" and "7" match. */
function normNumber(raw: string): string | null {
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? String(n) : null
}

/** Every numeral in a text, normalised. */
export function numbersIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(NUMBER)) {
    const n = normNumber(m[0])
    if (n !== null) out.push(n)
  }
  return out
}

/**
 * Numbers in the narrative that do not appear anywhere in the payload Inkwave sent. A model that
 * totals, averages or rounds a measured number produces one of these — which is exactly the
 * corruption §A6.4 exists to prevent, made visible.
 *
 * `payload` should be the compiled payload text (the data section included): anything Inkwave
 * showed the model is fair to quote back.
 */
export function findUnverifiedNumbers(narrative: string, payload: string): string[] {
  const allowed = new Set(numbersIn(payload))
  const prose = narrative
    .replace(/```[\s\S]*?```/g, ' ')          // the judged block is validated elsewhere
    .replace(/^\s{0,3}\d+[.)]\s+/gm, ' ')     // markdown list numbering isn't a claim
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of numbersIn(prose)) {
    if (allowed.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}
