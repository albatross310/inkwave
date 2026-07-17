// SYNTHETIC CITATION-HEAVY FIXTURE — the shape of a real Honours proposal, none of its content.
//
// THESIS INTEGRITY (hard boundary): Peter's real Honours document must NEVER enter the repo — not as
// a fixture, not in probe output, not in a screenshot, not in a log. This fixture reproduces the
// STRUCTURE that matters to the renderer (word count, citation density, marked citations, headings,
// lists, a reference list) using invented prose and invented sources, so coverage is measured on
// something structurally comparable without touching his writing.
//
// Shape targets (his real proposal, per the brief): ~2,200 words, ~29 citations. The 13k fixture is
// ~6× that. What actually drives the renderer is: citations per paragraph, whether they carry a
// textStyle{fontFamily} mark (his do — ~all 174 in the thesis, which is why an early "marked ⇒ skip"
// gate silently skipped 216/218), headings, lists, and a refList block.

const SRC = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter ' +
  'section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment ' +
  'perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds ' +
  'difficult waffles first fifth flourish effigy scaffold inference semantics formal notation encyclopaedia ' +
  'combinatorial mathesis universalis rational grammar concept primitive alphabet thought demonstration').split(/\s+/)

const AUTHORS = [
  ['Couturat', 'Louis'], ['Rescher', 'Nicholas'], ['Mates', 'Benson'], ['Adams', 'Robert'],
  ['Mercer', 'Christia'], ['Garber', 'Daniel'], ['Look', 'Brandon'], ['Rutherford', 'Donald'],
  ['Arthur', 'Richard'], ['Antognazza', 'Maria'], ['Jolley', 'Nicholas'], ['Wilson', 'Catherine'],
  ['Parkinson', 'George'], ['Ishiguro', 'Hide'], ['Sleigh', 'Robert'],
]

/** Deterministic PRNG so every run measures the same document. */
function rng(seed = 20260717) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

/**
 * @param opts.words   target word count (his proposal ≈ 2200)
 * @param opts.cites   target citation count (his proposal ≈ 29)
 * @param opts.marked  fraction of citations carrying a textStyle{fontFamily} mark (his: ~all)
 * @param opts.lists   include bullet/ordered lists
 * @param opts.refList include a reference list block
 * @param opts.maths  number of INLINE MATH pills to place mid-paragraph (the other NodeView whose
 *                    interior rects the line collector used to mistake for extra lines)
 * @param opts.refVariety  OPT-IN (default false, so every existing probe's document is byte-identical).
 *   THE 14x49.13px PROBLEM. With uniform sources every bibliography entry wraps to exactly 2 lines and
 *   every entry measures 49.13px — so a layout that returns a CONSTANT scores 14/14 and a probe cannot
 *   tell it from one that actually lays the entries out. That is `paginate()`'s blind suite again (it
 *   passed straight through a live drift for months because every fixture line was its own block).
 *   This option varies what the renderer must actually model:
 *     • TITLE LENGTH — short/medium/long sources ⇒ 1-, 2- and 3-line entries.
 *     • QUOTES — `quote` attrs on some citations ⇒ back-refs grow `<span class="iw-backref-quote">`
 *       previews (0.86em italic), the term the chrome composition was NEVER exercising.
 *     • LOCATORS — `locator` attrs ⇒ `esp. pp 2, 4-6` spans (0.95em italic) appear at all.
 *   Without it, `quote` and `esp` are never even harvested and their code paths are unproven.
 * @param opts.listWords  words per list ITEM. Default 9 — which is ONE LINE at canonical width, so
 *   every existing probe's document stays byte-identical.
 *   THE 9-WORD PROBLEM (2026-07-17), the same shape as refVariety's above. The container-box bug
 *   turns on an item's LINE COUNT: a container box is admitted as a line only when it is under the
 *   80px cut, so a 2-line `<li>` (58.2px) reproduces it and a 1-line (29.1px) or 3-line (87.3px)
 *   one CANNOT. Every list fixture here was 9 words, so `halvesbisect`'s `+ lists` row printed a
 *   confident "OFFSETS IDENTICAL" against a shape structurally incapable of failing — a green tick
 *   from a document with no way to be wrong. Pass ~22 to get 2-line items.
 */
export function buildCitationDoc(opts = {}) {
  const { words = 2200, cites = 29, marked = 1, lists = true, refList = true, id = 'fixture-cites', headings = true, maths = 0, refVariety = false, listWords = 9 } = opts
  const rnd = rng()
  const keys = AUTHORS.map(([fam], i) => `${fam.toLowerCase()}${1990 + (i % 25)}`)
  const usedKeys = keys.slice(0, Math.max(1, Math.min(keys.length, Math.ceil(cites / 2))))

  const sentence = (n) => {
    const o = []
    for (let i = 0; i < n; i++) o.push(SRC[Math.floor(rnd() * SRC.length)])
    const t = o.join(' ')
    return t[0].toUpperCase() + t.slice(1)
  }

  const content = []
  let wordsSoFar = 0
  let citesPlaced = 0
  let mathsPlaced = 0
  let para = 0

  const CITE_FONT = "'EB Garamond', Georgia, serif"
  // Inline math pills: the SECOND inline-atom NodeView. KaTeX's internal sub/superscript and
  // fraction spans emit rects BELOW the baseline, which the 3px dedup used to split into spurious
  // extra lines — the same artifact as the citation's ⤵ button, documented in arithmeticLayout.ts.
  // Formulas are deliberately sub/superscript- and fraction-heavy: a plain `x+1` pill has no
  // off-baseline interior and would make the fixture blind to exactly the bug it exists to catch.
  const MATH = ['x^2 + y_1', '\\frac{a}{b}', '\\sum_{i=0}^{n} x_i', 'e^{i\\pi} + 1 = 0', '\\sqrt{x_j^2}']
  const mkMath = () => ({ type: 'mathInline', attrs: { latex: MATH[Math.floor(rnd() * MATH.length)] } })
  const mkCite = () => {
    const k = usedKeys[Math.floor(rnd() * usedKeys.length)]
    const node = { type: 'citation', attrs: { citekeys: [k], prefix: '', suffix: '', locator: '', suppressAuthor: false } }
    if (refVariety) {
      // A pinpoint locator (⇒ an `esp. pp …` span on the entry) on ~40% of citations, and a pinpoint
      // QUOTE (⇒ a back-ref quote preview) on ~35%. Both are real Inkwave features that change the
      // bibliography's WIDTH and therefore its line count; neither existed in the uniform fixture.
      const roll = rnd()
      if (roll < 0.4) {
        const a = 1 + Math.floor(rnd() * 40)
        node.attrs.locator = rnd() < 0.5 ? `${a}` : `${a}–${a + 1 + Math.floor(rnd() * 3)}`
      }
      if (rnd() < 0.35) node.attrs.quote = sentence(4 + Math.floor(rnd() * 5))
    }
    // A MARKED citation is the realistic case and the one that used to break: its label inherits the
    // mark's font, so it caches under a different font key (citeFontKey) — not an unmeasurable box.
    if (rnd() < marked) node.marks = [{ type: 'textStyle', attrs: { fontFamily: CITE_FONT } }]
    return node
  }

  while (wordsSoFar < words) {
    if (headings && para % 6 === 0) {
      content.push({ type: 'heading', attrs: { level: para === 0 ? 1 : 2 }, content: [{ type: 'text', text: sentence(4) }] })
      wordsSoFar += 4
    }
    // Distribute citations across paragraphs the way real prose does: most paragraphs carry one,
    // some carry two, some none.
    const n = 28 + Math.floor(rnd() * 40)
    const inline = []
    const citesHere = citesPlaced < cites ? (rnd() < 0.25 ? 2 : rnd() < 0.85 ? 1 : 0) : 0
    if (citesHere === 0) {
      inline.push({ type: 'text', text: sentence(n) + '.' })
    } else {
      const chunk = Math.max(6, Math.floor(n / (citesHere + 1)))
      for (let c = 0; c < citesHere && citesPlaced < cites; c++) {
        inline.push({ type: 'text', text: (c === 0 ? sentence(chunk) : ' ' + sentence(chunk).toLowerCase()) + ' ' })
        inline.push(mkCite())
        citesPlaced++
      }
      inline.push({ type: 'text', text: ' ' + sentence(chunk).toLowerCase() + '.' })
    }
    // Drop a math pill MID-paragraph (never at the start/end): the artifact only shows when the
    // pill's interior sits inside a real line's run of rects.
    if (mathsPlaced < maths && inline.length && para % 2 === 0) {
      inline.splice(1, 0, { type: 'text', text: ' ' }, mkMath(), { type: 'text', text: ' as shown. ' })
      mathsPlaced++
    }
    content.push({ type: 'paragraph', content: inline })
    wordsSoFar += n
    para++

    if (lists && para % 9 === 0) {
      content.push({
        type: 'bulletList',
        content: Array.from({ length: 3 }, () => ({
          type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence(listWords) + '.' }] }],
        })),
      })
      wordsSoFar += 3 * listWords
    }
  }

  if (refList) content.push({ type: 'referenceList', attrs: {} })

  const entries = usedKeys.map((k, i) => {
    const [family, given] = AUTHORS[i % AUTHORS.length]
    // TITLE LENGTH drives the entry's LINE COUNT — the thing a real layout computes and a constant
    // cannot. The uniform fixture made every entry 2 lines / 49.13px, so a renderer returning one
    // number scored 14/14. Cycling short/medium/long spreads entries across 1, 2 and 3 lines.
    const titleWords = refVariety ? [3, 6, 14, 22, 8][i % 5] : 6
    const containerWords = refVariety ? [2, 3, 7][i % 3] : 3
    return {
      id: k, type: 'book', title: sentence(titleWords),
      author: refVariety && i % 4 === 3
        // A multi-author source lengthens the author run too (real bibliographies are not uniform).
        ? [{ family, given }, { family: AUTHORS[(i + 1) % AUTHORS.length][0], given: AUTHORS[(i + 1) % AUTHORS.length][1] },
           { family: AUTHORS[(i + 2) % AUTHORS.length][0], given: AUTHORS[(i + 2) % AUTHORS.length][1] }]
        : [{ family, given }],
      issued: { 'date-parts': [[1990 + (i % 25)]] },
      'container-title': sentence(containerWords),
    }
  })

  return {
    id, title: 'citation fixture',
    contentJson: { type: 'doc', content },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fixture',
    citationStyle: 'apa',
    bibliography: { source: 'manual', entries, generatedAt: new Date().toISOString(), style: 'apa' },
    _stats: { targetWords: words, targetCites: cites },
  }
}
