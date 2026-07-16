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
 */
export function buildCitationDoc(opts = {}) {
  const { words = 2200, cites = 29, marked = 1, lists = true, refList = true, id = 'fixture-cites', headings = true } = opts
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
  let para = 0

  const CITE_FONT = "'EB Garamond', Georgia, serif"
  const mkCite = () => {
    const k = usedKeys[Math.floor(rnd() * usedKeys.length)]
    const node = { type: 'citation', attrs: { citekeys: [k], prefix: '', suffix: '', locator: '', suppressAuthor: false } }
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
    content.push({ type: 'paragraph', content: inline })
    wordsSoFar += n
    para++

    if (lists && para % 9 === 0) {
      content.push({
        type: 'bulletList',
        content: Array.from({ length: 3 }, () => ({
          type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence(9) + '.' }] }],
        })),
      })
      wordsSoFar += 27
    }
  }

  if (refList) content.push({ type: 'referenceList', attrs: {} })

  const entries = usedKeys.map((k, i) => {
    const [family, given] = AUTHORS[i % AUTHORS.length]
    return {
      id: k, type: 'book', title: sentence(6),
      author: [{ family, given }],
      issued: { 'date-parts': [[1990 + (i % 25)]] },
      'container-title': sentence(3),
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
