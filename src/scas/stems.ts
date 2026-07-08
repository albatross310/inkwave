// Candidate base forms for a word, so inflections match their base in a vocabulary:
// "working"→"work", "quickly"→"quick", "runs"→"run". Pure string ops, no data tables.
// (Moved out of the deleted ranking.ts — the Week-2 per-paragraph vocab model that
// scas/engine.ts replaced; getStems was the only part the engine still used.)

/**
 * Generate candidate base forms for a word so inflections match their base
 * in the vocabulary. e.g. "working"→"work", "quickly"→"quick", "runs"→"run".
 */
export function getStems(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>([w])
  const add = (s: string) => { if (s.length > 2) out.add(s) }

  // Remove doubled final consonant: "running" → "run", "bigger" → "big"
  const undbl = (s: string) =>
    s.length > 2 && s[s.length - 1] === s[s.length - 2] ? s.slice(0, -1) : s

  // -ies → -y  (libraries → library)
  if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y')

  // -ing  (working→work, running→run, making→make)
  if (w.endsWith('ing') && w.length > 5) {
    const b = w.slice(0, -3)
    add(b); add(undbl(b)); add(b + 'e')
  }

  // -ed  (worked→work, stopped→stop, loved→love)
  if (w.endsWith('ed') && w.length > 4) {
    const b = w.slice(0, -2)
    add(b); add(undbl(b)); add(b + 'e')
  }

  // -es  (watches→watch, makes→make)
  if (w.endsWith('es') && w.length > 4) {
    add(w.slice(0, -2)); add(w.slice(0, -1))
  }

  // -s  (runs→run) — skip -ss words like "glass"
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) add(w.slice(0, -1))

  // -ily → -y  (happily→happy)
  if (w.endsWith('ily') && w.length > 5) add(w.slice(0, -3) + 'y')

  // -ly  (quickly→quick)
  if (w.endsWith('ly') && w.length > 4) add(w.slice(0, -2))

  // -ier → -y, -iest → -y  (easier→easy, easiest→easy)
  if (w.endsWith('ier') && w.length > 5) add(w.slice(0, -3) + 'y')
  if (w.endsWith('iest') && w.length > 6) add(w.slice(0, -4) + 'y')

  // -er, -est comparative  (faster→fast, bigger→big)
  if (w.endsWith('er') && w.length > 4) { const b = w.slice(0, -2); add(b); add(undbl(b)) }
  if (w.endsWith('est') && w.length > 5) { const b = w.slice(0, -3); add(b); add(undbl(b)) }

  // -ness  (darkness→dark)
  if (w.endsWith('ness') && w.length > 6) add(w.slice(0, -4))

  // -ment  (movement→move)
  if (w.endsWith('ment') && w.length > 6) { add(w.slice(0, -4)); add(w.slice(0, -4) + 'e') }

  // -ation → base (slice -5): organisation→organis, organise. Works for -ise/-ize roots;
  // note that -ion appended roots (creation = creat+ion) are NOT correctly reduced here
  // (the real product ships a curated surface→lemma map — this is that seam).
  // -tion → base (slice -4): solution→solu, solue. Handles -tion endings not caught above.
  if (w.endsWith('ation') && w.length > 7) {
    const b = w.slice(0, -5)
    add(b); add(b + 'e'); add(b + 'ise'); add(b + 'ize')
  } else if (w.endsWith('tion') && w.length > 6) {
    add(w.slice(0, -4)); add(w.slice(0, -4) + 'e')
  }

  // -ise / -ize normalization (AU/UK ↔ US spelling)
  // standardised→standard, organise→organ is too aggressive — only strip to check
  // the cross-spelling variant so "standardised" matches "standardize" in the list
  if (w.endsWith('ised') && w.length > 5) add(w.slice(0, -4) + 'ize')
  if (w.endsWith('ized') && w.length > 5) add(w.slice(0, -4) + 'ise')
  if (w.endsWith('ising') && w.length > 6) add(w.slice(0, -5) + 'izing')
  if (w.endsWith('izing') && w.length > 6) add(w.slice(0, -5) + 'ising')
  if (w.endsWith('ise') && w.length > 4) add(w.slice(0, -3) + 'ize')
  if (w.endsWith('ize') && w.length > 4) add(w.slice(0, -3) + 'ise')

  // Agent nouns: -er with silent e  (writer→write, teacher→teach)
  if (w.endsWith('er') && w.length > 4) add(w.slice(0, -2) + 'e')

  return [...out]
}
