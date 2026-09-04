// Client-side enforcement of the two rules the prompt can only REQUEST — spec §A6.2 and §A6.4.
//
// ⚠ THESE FLAG; THEY NEVER REWRITE (§A9). A narrative quietly edited by Inkwave would be its own
// integrity problem, and the writer would never know their model had misbehaved.
// ⚠ ONE-DIRECTIONAL: a clean result means "nothing detected", NEVER "verified honest". Both are
// heuristics over prose and the panel says so. The misses, in the order you will hit them: no
// marker ⇒ no flag ("your best writing came after the walk"); a hedge anywhere in the claim's OWN
// clause exempts it; a run-on with no punctuation is one clause; and a number written as a word is
// invisible to `findUnverifiedNumbers`. → docs/archive/productivity-email-build.md#claims-limits

// ─── §A6.2 — daily must not ASSERT cause or pattern. A hedged guess is not an assertion. ────
// ⚠ THE RULE IS THE HEDGE, NOT THE SUBJECT. Peter asked for hazarded guesses, so a scan on causal
// language as such would flag exactly the feature:
//     "the break helped."        → an assertion from one data point.  FLAGGED.
//     "the break maybe helped."  → a hypothesis, announced as one.    NOT flagged.
// This sits INSIDE §A6.2, not against it. Spec v0.2 §A6.2, verbatim: "Confident *pattern* claims
// (breaks help/hurt, best time of day) are permitted only at weekly+ where there's enough data."
// Hedging removes the confidence; the ban is on the CERTAINTY, not the subject.
// → docs/archive/productivity-email-build.md#claims-hedge

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
 * Words that mark a claim as a GUESS — what separates a hypothesis the writer can weigh from a
 * finding they are asked to swallow. Consulted ONLY for a sentence in which a causal or pattern
 * marker already fired, so an ordinary "could not find the thread" is never at risk.
 */
const HEDGE_MARKERS: readonly RegExp[] = [
  /\bmaybe\b/i, /\bperhaps\b/i, /\bpossibly\b/i, /\bpossible\b/i, /\bprobably\b/i,
  /\bmight\b/i, /\bcould\b/i, /\bcould'?ve\b/i, /\bseems?\b/i, /\bseemed\b/i,
  /\bappears?\b/i, /\blooks like\b/i, /\bfeels like\b/i, /\bsuspect\b/i, /\bguess\b/i,
  /\bhunch\b/i, /\bwonder\b/i, /\bhard to say\b/i, /\bcan'?t tell\b/i, /\bunclear\b/i,
  /\bnot sure\b/i, /\bworth (?:testing|trying|watching)\b/i, /\bone reading\b/i,
  /\barguably\b/i, /\bif anything\b/i, /\bmy sense\b/i, /\btempting to think\b/i,
  /\bwould'?ve\b/i, /\bimagine\b/i, /\bsuggests?\b/i,
  // ⚠ `may` IS CASE-SENSITIVE and that is the whole fix (F18): `/\bmay\b/i` matched the MONTH, so
  // "…as you have since May." was exempted by a date. The modal is lower-case in every sentence
  // anyone writes; the month is always capitalised.
  /\bmay\b/,
]

/**
 * Split a sentence into clauses on PUNCTUATION ONLY.
 *
 * ⚠ NEVER SPLIT ON CONNECTIVES. "which is why" is itself a causal marker and "because" is the
 * commonest one, so splitting there destroys the very thing being looked for and the scan goes
 * quiet on its own controls. Punctuation cannot collide with a marker.
 */
function clauses(sentence: string): string[] {
  return sentence.split(/[,;:—–]|\s+-\s+/).map(c => c.trim()).filter(Boolean)
}

/**
 * Is this CLAUSE marked as a guess?
 *
 * ⚠ THE HEDGE MUST GOVERN THE CLAUSE IT EXEMPTS (F18) — modality belongs to a clause, not to a
 * string. A whole-sentence match exempted confident claims sitting beside a hedge ("your peak
 * hours are nine to eleven, which suggests protecting them"). Exported for tests;
 * `findCausalClaims` consults it per clause, never per sentence.
 * → docs/archive/productivity-email-build.md#claims-hedge-clause
 */
export function isHedged(clause: string): boolean {
  return HEDGE_MARKERS.some(re => re.test(clause))
}

/**
 * UNHEDGED cause/pattern claims in a narrative. ⚠ DAILY ONLY — at weekly+ these claims are
 * legitimate (§A6.2) and the caller must not run this. A marker plus a hedge is a hypothesis, and
 * Peter asked for those explicitly: flagging them would be flagging the feature.
 */
export function findCausalClaims(markdown: string): CausalClaim[] {
  const out: CausalClaim[] = []
  for (const sentence of sentences(markdown)) {
    // Per CLAUSE (F18): a hedge exempts only the claim it governs. The reported `sentence` stays
    // the whole sentence — that is what the writer needs to read — but the VERDICT is per clause.
    for (const clause of clauses(sentence)) {
      if (isHedged(clause)) continue
      const hit = [...CAUSAL_MARKERS, ...PATTERN_MARKERS]
        .map(re => re.exec(clause))
        .find(Boolean)
      if (hit) { out.push({ sentence, marker: hit[0] }); break }
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
 * Numbers in the narrative that appear nowhere in the payload Inkwave sent — a model that totals,
 * averages or rounds a measured number produces one, which is the §A6.4 corruption made visible.
 * `payload` is the compiled payload TEXT including its data section: anything Inkwave showed the
 * model is fair to quote back.
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


// ─── §A5 — verdicts on the PERSON (the re-derived guilt list) ────────────────
// ⚠ THE BAN IS ON THE SUBJECT AND THE STANDARD, NEVER ON VOCABULARY. The old kind/non-shaming word
// list would now ban the feature — "you failed to touch it since Tuesday" is exactly what a goal
// the writer SET licenses.
//   · measured against a goal THEY SET     → accountability. Any word goes.
//   · measured against a standard WE chose → guilt. Banned however politely put.
//   · a verdict on the PERSON, not the work → banned, and no goal licenses it.
// The first two are STRUCTURAL (goals travel only on their own tick, so a model sent none is told
// it has no standard) — no matcher could see them. Only the third is matchable, which is why
// PERSON_MARKERS stays short: every entry must FAIL "could a comedian say this about the WEEK?".
// ⚠ ONE-DIRECTIONAL, and blind to an imposed standard ("200 words is a thin day" carries no banned
// word). Quoted spans are skipped — the writer may be quoted calling themself lazy.
// → docs/archive/productivity-email-build.md#claims-person-verdicts

/** A sentence that appears to pass a verdict on the writer rather than on their week. */
export interface PersonVerdict {
  sentence: string
  marker: string
}

// Each of these is a judgement of a person. None can be said about a Tuesday.
const PERSON_MARKERS: readonly RegExp[] = [
  /\blazy\b/i, /\bpathetic\b/i, /\bshameful\b/i, /\bembarrassing\b/i,
  /\bdisappointing\b/i, /\byou disappointed\b/i, /\bpoor effort\b/i, /\bno excuse\b/i,
  /\bslacking\b/i, /\byou'?re a (?:failure|waste|mess)\b/i, /\bsloppy of you\b/i,
  /\bundisciplined\b/i, /\bpitiful\b/i, /\bfeeble\b/i, /\bsad(?:ly)? excuse\b/i,
  // Ranking / comparison to others — §A5 keeps these banned, and they were never about kindness.
  /\bmost (?:writers|people)\b/i, /\bother writers\b/i, /\baverage writer\b/i,
  /\bcompared to (?:most|other)/i, /\bout of (?:ten|10)\b/i, /\bscore of\b/i,
  /\bI'?d rate you\b/i, /\bgrade\b.{0,12}\byour (?:week|month|day)\b/i,
]

/** Strip quoted spans — the narrative may quote the writer's own words back at them. */
function stripQuoted(text: string): string {
  return text
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/'[^'\n]{6,}'/g, ' ')   // long single-quoted spans only; apostrophes are not quotes
}

/**
 * Sentences that appear to judge the writer rather than the work. Runs at EVERY window — unlike
 * the causal scan, this is not a statistical rule and a month does not license it either.
 */
export function findPersonVerdicts(markdown: string): PersonVerdict[] {
  const out: PersonVerdict[] = []
  for (const s of sentences(markdown)) {
    const scannable = stripQuoted(s)
    for (const re of PERSON_MARKERS) {
      const m = re.exec(scannable)
      if (m) { out.push({ sentence: s, marker: m[0] }); break }
    }
  }
  return out
}
